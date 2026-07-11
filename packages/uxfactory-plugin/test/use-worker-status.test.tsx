// @vitest-environment jsdom
/**
 * use-worker-status.test.tsx — RTL tests for the useWorkerStatus hook.
 *
 * Two writers, one shape (spec 2026-07-09-worker-liveness):
 *   1. snapshot arrivals seed the store's `workers` slice;
 *   2. `worker-status` SSE frames for the ACTIVE root update it, others ignored.
 */
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Bridge, BridgeEvent } from "../ui/lib/bridge.js";
import { useWorkerStatus } from "../ui/lib/use-worker-status.js";
import { useAppStore } from "../ui/stores/app.js";

const ROOT = "/repo/demo";

// Mirrors the required Bridge members (screen-artifacts.test.tsx:270); the
// task brief's fixture listed a nonexistent `result` member and included
// `skills`, which is optional and unused here — both dropped.
function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: async () => ({ ok: true }),
    connectProject: async () => ({ ok: false, reason: "not-found" as const }),
    snapshot: async () => ({
      name: "demo",
      root: ROOT,
      hasClassification: false,
      hasProfile: false,
      classification: null,
      profile: null,
      artifacts: [],
      requirements: [],
      workers: [],
    }),
    putClassification: async () => ({ ok: true }),
    putProfile: async () => ({ ok: true }),
    getLinks: async () => ({ links: [] }),
    putLinks: async () => ({ ok: true }),
    openPath: async () => ({ ok: true }),
    stats: async () => ({ version: "0", uptimeMs: 0, runsRelayed: 0, tokenCount: null }),
    logs: async () => ({ lines: [] }),
    enqueue: async () => ({ id: "pr_1" }),
    events: () => () => {},
    latestRender: async () => null,
    verify: async () => null,
    getProjectRoot: () => ROOT,
    ...overrides,
  };
}

function Harness({ bridge }: { bridge: Bridge }): React.JSX.Element {
  useWorkerStatus(bridge);
  return <></>;
}

describe("useWorkerStatus", () => {
  beforeEach(() => {
    useAppStore.setState({ workers: null, managedWorker: null, workerBannerDismissed: false });
  });

  it("seeds the store from the snapshot's workers field", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness bridge={makeBridge()} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(useAppStore.getState().workers).toEqual([]));
  });

  it("seeds managedWorker from the snapshot's managed field", async () => {
    const bridge = makeBridge({
      snapshot: async () => ({
        name: "demo",
        root: ROOT,
        hasClassification: false,
        hasProfile: false,
        classification: null,
        profile: null,
        artifacts: [],
        requirements: [],
        workers: [],
        managed: { kinds: ["generate-artifact"] },
      }),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness bridge={bridge} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(useAppStore.getState().managedWorker).toEqual({ kinds: ["generate-artifact"] }),
    );
  });

  it("legacy bridge: a snapshot omitting `workers`/`managed` entirely leaves both null (unknown)", async () => {
    // Seed non-null state first — if the effect never fired (or a fallback
    // were missing), the pre-seeded values would simply survive and this
    // test would still pass without seeding, which is precisely the
    // vacuous-assertion trap to avoid: prove the hook actively resets to
    // null rather than merely inheriting the describe block's beforeEach.
    useAppStore.setState({ workers: [{ connectedAt: 1 }], managedWorker: {} });

    const bridge = makeBridge({
      snapshot: async () => ({
        name: "demo",
        root: ROOT,
        hasClassification: false,
        hasProfile: false,
        classification: null,
        profile: null,
        artifacts: [],
        requirements: [],
        // `workers`/`managed` deliberately omitted — a bridge predating the
        // worker-liveness fields. useWorkerStatus's `data.workers ?? null` /
        // `data.managed ?? null` fallback must resolve this to unknown, not
        // covered/uncovered.
      }),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness bridge={bridge} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(useAppStore.getState().workers).toBeNull());
    expect(useAppStore.getState().managedWorker).toBeNull();
  });

  it("applies worker-status frames for the active root and ignores other roots", async () => {
    let emit: ((ev: BridgeEvent) => void) | null = null;
    const bridge = makeBridge({
      events: (onEvent) => {
        emit = onEvent;
        return () => {};
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness bridge={bridge} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(emit).not.toBeNull());
    // Let the initial snapshot fetch settle (workers: [], managed: undefined)
    // before dispatching frames — otherwise its effect can resolve AFTER the
    // frame and clobber the just-applied SSE state with the stale fetch.
    await waitFor(() => expect(useAppStore.getState().workers).toEqual([]));

    emit!({
      requestId: "worker-status",
      seq: 1,
      event: { type: "worker-status", root: "/repo/other", workers: [{ connectedAt: 5 }] },
    });
    expect(useAppStore.getState().workers).not.toEqual([{ connectedAt: 5 }]);

    emit!({
      requestId: "worker-status",
      seq: 2,
      event: { type: "worker-status", root: ROOT, workers: [{ connectedAt: 9 }], managed: {} },
    });
    await waitFor(() =>
      expect(useAppStore.getState().workers).toEqual([{ connectedAt: 9 }]),
    );
    expect(useAppStore.getState().managedWorker).toEqual({});
  });
});

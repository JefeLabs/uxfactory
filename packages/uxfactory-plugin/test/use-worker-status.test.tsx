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
import { render, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Bridge, BridgeEvent } from "../ui/lib/bridge.js";
import { useWorkerStatus } from "../ui/lib/use-worker-status.js";
import { queryKeys, activeRoot } from "../ui/queries.js";
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

/**
 * Flushes one macrotask so a query-cache update from `invalidateQueries`
 * (which resolves as soon as the refetch settles, ahead of the observer
 * notification reaching React) has time to reach the component's effect.
 * Needed only when asserting an EFFECT DIDN'T fire — asserting immediately
 * after `invalidateQueries` would pass vacuously before the effect runs at
 * all, guard or no guard.
 */
async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

  // ─── Frame-epoch provenance guard (spec 2026-07-11-followup-sweep-2 §1) ───
  // Within one live SSE subscription, frames are TCP-ordered and cannot be
  // missed, so once a frame for the active root has been applied, a snapshot
  // can never carry anything newer — frames win.

  it("frames win over a stale snapshot that resolves later within the same SSE epoch (race)", async () => {
    let emit: ((ev: BridgeEvent) => void) | null = null;
    let snapshotCalls = 0;
    const bridge = makeBridge({
      // `name` differs across calls solely so react-query's structural
      // sharing (which reuses the old `data` reference on a deep-equal
      // refetch) doesn't mask this as a no-op — the bridge's real staleness
      // scenario is a poll that differs from the live frame, not an inert one.
      snapshot: async () => {
        snapshotCalls += 1;
        return {
          name: snapshotCalls === 1 ? "demo" : "demo-stale",
          root: ROOT,
          hasClassification: false,
          hasProfile: false,
          classification: null,
          profile: null,
          artifacts: [],
          requirements: [],
          workers: [],
        };
      },
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
    // Let the initial snapshot seed (workers: []) before the frame lands.
    await waitFor(() => expect(useAppStore.getState().workers).toEqual([]));

    emit!({
      requestId: "worker-status",
      seq: 1,
      event: { type: "worker-status", root: ROOT, workers: [{ connectedAt: 9 }], managed: {} },
    });
    await waitFor(() =>
      expect(useAppStore.getState().workers).toEqual([{ connectedAt: 9 }]),
    );

    // A stale snapshot — computed by the bridge BEFORE the presence change —
    // resolves after the frame. It must not clobber the frame's fresher data.
    await act(async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
    });
    await flushEffects();

    expect(useAppStore.getState().workers).toEqual([{ connectedAt: 9 }]);
    expect(useAppStore.getState().managedWorker).toEqual({});
  });

  it("a stale snapshot does not spuriously re-arm a dismissed banner after a frame reports coverage", async () => {
    let emit: ((ev: BridgeEvent) => void) | null = null;
    let snapshotCalls = 0;
    const bridge = makeBridge({
      // See the race test above for why `name` must differ across calls.
      snapshot: async () => {
        snapshotCalls += 1;
        return {
          name: snapshotCalls === 1 ? "demo" : "demo-stale",
          root: ROOT,
          hasClassification: false,
          hasProfile: false,
          classification: null,
          profile: null,
          artifacts: [],
          requirements: [],
          workers: [],
        };
      },
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
    // Snapshot seeds uncovered ([]) — the user dismisses that warning.
    await waitFor(() => expect(useAppStore.getState().workers).toEqual([]));
    useAppStore.getState().dismissWorkerBanner();
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);

    // A frame reports a worker connecting — now covered.
    emit!({
      requestId: "worker-status",
      seq: 1,
      event: { type: "worker-status", root: ROOT, workers: [{ connectedAt: 9 }] },
    });
    await waitFor(() =>
      expect(useAppStore.getState().workers).toEqual([{ connectedAt: 9 }]),
    );
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);

    // A stale snapshot (still carrying the pre-frame uncovered []) resolves
    // after the frame. Applying it would look like a fresh covered→uncovered
    // transition and spuriously un-dismiss the banner — it must not apply.
    await act(async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
    });
    await flushEffects();

    expect(useAppStore.getState().workers).toEqual([{ connectedAt: 9 }]);
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);
  });

  it("a connection reset (workers: null) re-opens snapshot writes even after a frame was seen", async () => {
    let emit: ((ev: BridgeEvent) => void) | null = null;
    const snapshotCalls: number[] = [];
    const bridge = makeBridge({
      snapshot: async () => {
        snapshotCalls.push(snapshotCalls.length);
        const workers = snapshotCalls.length === 1 ? [] : [{ connectedAt: 20 }];
        return {
          name: "demo",
          root: ROOT,
          hasClassification: false,
          hasProfile: false,
          classification: null,
          profile: null,
          artifacts: [],
          requirements: [],
          workers,
        };
      },
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
    await waitFor(() => expect(useAppStore.getState().workers).toEqual([]));

    emit!({
      requestId: "worker-status",
      seq: 1,
      event: { type: "worker-status", root: ROOT, workers: [{ connectedAt: 9 }] },
    });
    await waitFor(() =>
      expect(useAppStore.getState().workers).toEqual([{ connectedAt: 9 }]),
    );

    // Simulate the connection-reset path: connectFailed/cancelReconnect null
    // the workers slice, signaling "no live signal" (unknown, not uncovered).
    useAppStore.getState().cancelReconnect();
    expect(useAppStore.getState().workers).toBeNull();

    await act(async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
    });

    await waitFor(() =>
      expect(useAppStore.getState().workers).toEqual([{ connectedAt: 20 }]),
    );
  });

  it("switching the active root lets the new root's snapshot apply despite a frame seen for the old root", async () => {
    let emit: ((ev: BridgeEvent) => void) | null = null;
    let currentRoot = ROOT;
    const ROOT_B = "/repo/other-active";
    const bridge = makeBridge({
      getProjectRoot: () => currentRoot,
      snapshot: async () => ({
        name: "demo",
        root: currentRoot,
        hasClassification: false,
        hasProfile: false,
        classification: null,
        profile: null,
        artifacts: [],
        requirements: [],
        workers: currentRoot === ROOT ? [] : [{ connectedAt: 42 }],
      }),
      events: (onEvent) => {
        emit = onEvent;
        return () => {};
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <Harness bridge={bridge} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(emit).not.toBeNull());
    await waitFor(() => expect(useAppStore.getState().workers).toEqual([]));

    emit!({
      requestId: "worker-status",
      seq: 1,
      event: { type: "worker-status", root: ROOT, workers: [{ connectedAt: 9 }] },
    });
    await waitFor(() =>
      expect(useAppStore.getState().workers).toEqual([{ connectedAt: 9 }]),
    );

    // Switch the active root (no new SSE subscription — same bridge, same
    // epoch). The new root's snapshot must still apply: the ref only marks
    // root ROOT as frame-seen, not ROOT_B.
    currentRoot = ROOT_B;
    rerender(
      <QueryClientProvider client={qc}>
        <Harness bridge={bridge} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(useAppStore.getState().workers).toEqual([{ connectedAt: 42 }]),
    );
  });
});

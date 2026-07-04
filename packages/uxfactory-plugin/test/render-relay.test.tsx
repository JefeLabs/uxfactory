// @vitest-environment jsdom
/**
 * render-relay.test.tsx — the tabs shell polls the bridge render queue and
 * relays jobs to the plugin main thread (and reports back).
 *
 * This loop lived in the legacy src/ui.ts pill panel and was lost in the React
 * panel rewrite; these tests pin its return. Root-awareness is covered by the
 * wire contract in bridge-contract.test.ts — here we cover the relay behavior.
 */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { useAppStore } from "../ui/stores/app.js";
import { useRunsStore, DEFAULT_DEVICE_CONFIG } from "../ui/stores/runs.js";
import { renderWithProviders } from "./test-utils.js";
import { createAppRouter } from "../ui/router.js";
import { makeQueryClient } from "../ui/queries.js";
import type { Bridge, ProjectSnapshot } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";

afterEach(cleanup);

const SNAPSHOT: ProjectSnapshot = {
  name: "Demo Shop",
  root: "/home/user/demo-shop",
  hasClassification: true,
  hasProfile: true,
  classification: { category: "ecommerce", platforms: ["desktop"], layout: "responsive" },
  profile: null,
  artifacts: [],
  requirements: [],
};

const JOB_SPEC = { editor: "figma", frames: [{ name: "home", x: 0, y: 0, width: 390, height: 800 }] };

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi.fn().mockResolvedValue({ ok: true, snapshot: SNAPSHOT }),
    snapshot: vi.fn().mockResolvedValue(SNAPSHOT),
    putClassification: vi.fn().mockResolvedValue({ ok: true }),
    putProfile: vi.fn().mockResolvedValue({ ok: true }),
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    stats: vi.fn().mockResolvedValue({ version: "0.0.0", uptimeMs: 0, runsRelayed: 0, tokenCount: null }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    skills: vi.fn().mockResolvedValue({ skills: [] }),
    enqueue: vi.fn().mockResolvedValue({ id: "test-id" }),
    events: vi.fn().mockReturnValue(() => {}),
    latestRender: vi.fn().mockResolvedValue(null),
    verify: vi.fn().mockResolvedValue({}),
    nextRenderJob: vi.fn().mockResolvedValue(null),
    postRenderReport: vi.fn().mockResolvedValue({ renderId: "r1" }),
    ...overrides,
  };
}

function makeBus(): PluginBus & {
  postRender: ReturnType<typeof vi.fn>;
  firedRendered: (report: unknown) => void;
  firedRenderError: (message: string) => void;
} {
  const renderedListeners = new Set<(report: unknown) => void>();
  const errorListeners = new Set<(message: string) => void>();
  return {
    storageGet: vi.fn().mockResolvedValue(undefined),
    storageSet: vi.fn().mockResolvedValue(undefined),
    fileInfo: vi.fn().mockResolvedValue({ name: "Demo Shop", fileKey: "file-abc" }),
    insertIcon: vi.fn().mockResolvedValue("node-1"),
    notify: vi.fn(),
    close: vi.fn(),
    onSelection: vi.fn().mockReturnValue(() => {}),
    selectNodes: vi.fn(),
    postReview: vi.fn(),
    postRender: vi.fn(),
    onRendered: vi.fn().mockImplementation((cb: (report: unknown) => void) => {
      renderedListeners.add(cb);
      return () => renderedListeners.delete(cb);
    }),
    onRenderError: vi.fn().mockImplementation((cb: (message: string) => void) => {
      errorListeners.add(cb);
      return () => errorListeners.delete(cb);
    }),
    firedRendered(report: unknown) {
      for (const cb of renderedListeners) cb(report);
    },
    firedRenderError(message: string) {
      for (const cb of errorListeners) cb(message);
    },
  };
}

beforeEach(() => {
  useAppStore.setState({
    connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/home/user/demo-shop", mode: "local" },
    fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
    snapshot: SNAPSHOT,
    toasts: [],
  });
  useRunsStore.setState({
    runs: [],
    composerUnitType: "page",
    composerPlatforms: [],
    composerVariations: 1,
    composerFidelity: "medium",
    deviceConfig: DEFAULT_DEVICE_CONFIG,
  });
});

async function renderShell(bridge: Bridge, bus: PluginBus) {
  const queryClient = makeQueryClient();
  const router = createAppRouter({ bridge, bus, queryClient }, ["/tabs/prompt"]);
  await renderWithProviders(null, { router, queryClient });
  await waitFor(() =>
    expect(screen.getByRole("tablist", { name: "Panel tabs" })).toBeInTheDocument(),
  );
}

describe("render relay: tabs shell ↔ bridge render queue", () => {
  it("polls nextRenderJob on mount and forwards the job to the main thread", async () => {
    const bridge = makeBridge({
      nextRenderJob: vi
        .fn()
        .mockResolvedValueOnce({ jobId: "job_1", spec: JOB_SPEC })
        .mockResolvedValue(null),
    });
    const bus = makeBus();

    await renderShell(bridge, bus);

    await waitFor(() => expect(bus.postRender).toHaveBeenCalledWith(JOB_SPEC, "job_1"));
  });

  it("forwards the main thread's rendered report back to the bridge", async () => {
    const bridge = makeBridge();
    const bus = makeBus();

    await renderShell(bridge, bus);

    const report = { ok: true, pageId: "0:1", jobId: "job_1" };
    act(() => bus.firedRendered(report));

    await waitFor(() => expect(bridge.postRenderReport).toHaveBeenCalledWith(report));
  });

  it("surfaces a main-thread render-error as a toast (never silent)", async () => {
    const bridge = makeBridge();
    const bus = makeBus();

    await renderShell(bridge, bus);

    act(() => bus.firedRenderError("createConnector is FigJam-only"));

    await waitFor(() =>
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes("createConnector is FigJam-only")),
      ).toBe(true),
    );
  });

  it("surfaces a failed report delivery as a toast (never silent)", async () => {
    const bridge = makeBridge({
      postRenderReport: vi.fn().mockRejectedValue(new Error("403")),
    });
    const bus = makeBus();

    await renderShell(bridge, bus);

    act(() => bus.firedRendered({ ok: true }));

    await waitFor(() =>
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.message.includes("Render report failed to reach the bridge")),
      ).toBe(true),
    );
  });
});

// @vitest-environment jsdom
/**
 * screen-settings.test.tsx — RTL tests for the Settings screen.
 *
 * Test names map to PRD §6 acceptance criteria:
 *   AC-1  stats render + 10s repoll (fake timers) + cleanup
 *   AC-2  endpoint copy + edit flow toast
 *   AC-3  Restart popover shows copyable command
 *   AC-4  logs drawer fetches + refresh + toggle cleanup
 *   AC-5  keys row always renders invariant; no sk- strings
 *   AC-6  skills rows from fake bridge
 *   AC-7  storage meter math + Compact behavior
 *   AC-8  graceful stats() failure → down state w/ start command
 *
 * Bridge and bus are always injected as fakes; no module mocks.
 * Selector discipline: stores are reset to primitives before each test.
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  screen,
  waitFor,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";

import type { Bridge, BridgeStats } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";
import { Settings } from "../ui/screens/Settings.js";
import { useAppStore } from "../ui/stores/app.js";
import { useRunsStore, DEFAULT_DEVICE_CONFIG } from "../ui/stores/runs.js";
import { renderWithProviders } from "./test-utils.js";

// ─── Store reset ─────────────────────────────────────────────────────────────

const BASE_STORE = {
  connection: {
    status: "connected" as const,
    endpoint: "http://localhost:3779",
    repoPath: "/home/user/meridian",
    mode: "local" as const,
  },
  fileInfo: { name: "Meridian Health", fileKey: "file-abc" },
  snapshot: null,
  toasts: [],
};

beforeEach(() => useAppStore.setState(BASE_STORE));
afterEach(() => {
  cleanup();
  // Ensure fake timers are never leaked between tests
  vi.useRealTimers();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STATS_DATA: BridgeStats = {
  version: "0.4.2",
  uptimeMs: 8040000, // 2h 14m
  runsRelayed: 38,
  tokenCount: 1204,
};

// ─── Fake bridge factory ──────────────────────────────────────────────────────

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi.fn().mockResolvedValue({ ok: false, reason: "not-found" }),
    snapshot: vi.fn().mockResolvedValue(null),
    putClassification: vi.fn().mockResolvedValue({ ok: true }),
    putProfile: vi.fn().mockResolvedValue({ ok: true }),
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    stats: vi.fn().mockResolvedValue(STATS_DATA),
    logs: vi.fn().mockResolvedValue({ lines: ["GET /health 200", "GET /stats 200"] }),
    skills: vi.fn().mockResolvedValue({ skills: [] }),
    enqueue: vi.fn().mockResolvedValue({ id: "req-1" }),
    events: vi.fn().mockReturnValue(() => {}),
    latestRender: vi.fn().mockResolvedValue(null),
    verify: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

// ─── Fake bus factory ─────────────────────────────────────────────────────────

function makeBus(storedByKey: Record<string, unknown> = {}): PluginBus {
  return {
    storageGet: vi.fn().mockImplementation(async (key: string) => storedByKey[key]),
    storageSet: vi.fn().mockResolvedValue(undefined),
    fileInfo: vi.fn().mockResolvedValue({ name: "Meridian Health", fileKey: "file-abc" }),
    insertIcon: vi.fn().mockResolvedValue("node-1"),
    notify: vi.fn(),
    close: vi.fn(),
    onSelection: vi.fn().mockReturnValue(() => {}),
    selectNodes: vi.fn(),
    postReview: vi.fn(),
  };
}

/**
 * Test-scoped QueryClient: no retries so error states are immediate and
 * timer-based tests are deterministic (no race with retry delay timeouts).
 */
function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: 0 },
    },
  });
}

// ─── AC-1: stats render + 10s repoll (fake timers) + cleanup ─────────────────

describe("AC-1: stats render + 10s repoll + cleanup", () => {
  it("renders version badge and formatted uptime from stats response", async () => {
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await waitFor(() =>
      expect(screen.getByText(/v0\.4\.2/)).toBeInTheDocument(),
    );
    // Uptime: 8040000ms = 2h 14m
    await waitFor(() =>
      expect(screen.getByText(/2h 14m · 38 runs relayed/)).toBeInTheDocument(),
    );
    // Token index
    await waitFor(() =>
      expect(screen.getByText(/1,204 resolved tokens/)).toBeInTheDocument(),
    );
  });

  it("polls stats again after 10s (fake timers)", async () => {
    vi.useFakeTimers();
    const statsMock = vi.fn().mockResolvedValue(STATS_DATA);
    const bridge = makeBridge({ stats: statsMock });
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    // Flush the initial effect + promise
    await act(async () => {
      await Promise.resolve();
    });
    expect(statsMock).toHaveBeenCalledTimes(1);

    // Advance 10 seconds and flush promises from the timer callback
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(statsMock).toHaveBeenCalledTimes(2);
  });

  it("re-fetches stats via Query refetchInterval after 10s (fake timers)", async () => {
    vi.useFakeTimers();
    const statsMock = vi.fn().mockResolvedValue(STATS_DATA);
    const bridge = makeBridge({ stats: statsMock });
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await act(async () => {
      await Promise.resolve();
    });
    expect(statsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(statsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("cleans up interval on unmount — no more calls after unmount", async () => {
    vi.useFakeTimers();
    const statsMock = vi.fn().mockResolvedValue(STATS_DATA);
    const bridge = makeBridge({ stats: statsMock });
    const bus = makeBus();

    const { unmount } = await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await act(async () => {
      await Promise.resolve();
    });
    expect(statsMock).toHaveBeenCalledTimes(1);

    // Unmount → Query observer removed → refetchInterval cleared
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    // Still 1 — no more calls after unmount
    expect(statsMock).toHaveBeenCalledTimes(1);
  });
});

// ─── AC-2: endpoint copy + edit flow ─────────────────────────────────────────

describe("AC-2: endpoint copy + edit flow", () => {
  it("clicking the endpoint button shows a copy toast", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    // Wait for bridge card to show the endpoint (stats must have loaded)
    const endpointBtn = await screen.findByRole("button", {
      name: /Bridge endpoint:/i,
    });
    await user.click(endpointBtn);

    await waitFor(() =>
      expect(
        useAppStore.getState().toasts.some((t) => t.message === "Endpoint copied"),
      ).toBe(true),
    );
  });

  it("Edit → shows input with current endpoint; Reconnect → updates store + toast", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Edit endpoint/i })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Edit endpoint/i }));

    // Input should be pre-filled
    const input = screen.getByRole("textbox", { name: /Bridge endpoint/i });
    expect(input).toHaveValue("http://localhost:3779");

    // Change endpoint
    await user.clear(input);
    await user.type(input, "http://localhost:4000");

    // Click Reconnect
    await user.click(screen.getByRole("button", { name: /Reconnect/i }));

    // Store updated
    expect(useAppStore.getState().connection.endpoint).toBe("http://localhost:4000");

    // Toast shown
    await waitFor(() =>
      expect(
        useAppStore.getState().toasts.some((t) =>
          t.message.includes("Reconnect from the Connect screen to apply"),
        ),
      ).toBe(true),
    );

    // Input is gone
    expect(
      screen.queryByRole("textbox", { name: /Bridge endpoint/i }),
    ).not.toBeInTheDocument();
  });
});

// ─── AC-3: Restart popover shows command ─────────────────────────────────────

describe("AC-3: Restart popover shows copyable command", () => {
  it("clicking Restart reveals the uxfactory bridge command", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await user.click(screen.getByRole("button", { name: /Restart bridge/i }));

    // Command text visible
    expect(screen.getByText("uxfactory bridge")).toBeInTheDocument();

    // Copy button present with specific aria-label
    expect(
      screen.getByRole("button", { name: /Copy restart command/i }),
    ).toBeInTheDocument();
  });

  it("Copy in restart popover fires toast and closes popover", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await user.click(screen.getByRole("button", { name: /Restart bridge/i }));
    await user.click(screen.getByRole("button", { name: /Copy restart command/i }));

    await waitFor(() =>
      expect(
        useAppStore.getState().toasts.some((t) => t.message === "Command copied"),
      ).toBe(true),
    );

    // Popover closed (copy button gone)
    expect(
      screen.queryByRole("button", { name: /Copy restart command/i }),
    ).not.toBeInTheDocument();
  });
});

// ─── AC-4: logs drawer fetches + refresh + toggle cleanup ────────────────────

describe("AC-4: logs drawer", () => {
  it("clicking View logs opens the drawer and fetches logs", async () => {
    const user = userEvent.setup();
    const logsMock = vi.fn().mockResolvedValue({
      lines: ["GET /health 200", "POST /pipeline/request 200"],
    });
    const bridge = makeBridge({ logs: logsMock });
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await user.click(screen.getByRole("button", { name: /View logs/i }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    // Logs fetched with tail=200
    expect(logsMock).toHaveBeenCalledWith(200);

    // Log lines rendered
    await waitFor(() =>
      expect(screen.getByText(/GET \/health 200/)).toBeInTheDocument(),
    );
  });

  it("Refresh button re-fetches logs", async () => {
    const user = userEvent.setup();
    const logsMock = vi
      .fn()
      .mockResolvedValueOnce({ lines: ["line 1"] })
      .mockResolvedValueOnce({ lines: ["line 1", "line 2"] });

    const bridge = makeBridge({ logs: logsMock });
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });
    await user.click(screen.getByRole("button", { name: /View logs/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    // First fetch on open
    expect(logsMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => expect(logsMock).toHaveBeenCalledTimes(2));

    await waitFor(() =>
      expect(screen.getByText(/line 2/)).toBeInTheDocument(),
    );
  });

  it("Live toggle starts repoll every 2s; disabling stops it (cleanup)", async () => {
    const user = userEvent.setup();
    const logsMock = vi.fn().mockResolvedValue({ lines: [] });
    const bridge = makeBridge({ logs: logsMock });
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    // Open drawer with real timers first
    await user.click(screen.getByRole("button", { name: /View logs/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    // Wait for initial fetch to complete
    await waitFor(() => expect(logsMock).toHaveBeenCalledTimes(1));
    const callsAfterOpen = logsMock.mock.calls.length;

    // Switch to fake timers for interval control
    vi.useFakeTimers();

    const liveCheckbox = screen.getByRole("checkbox", { name: /Live repoll/i });

    // Enable Live toggle
    await act(async () => {
      liveCheckbox.click();
    });

    // Advance 2s → one repoll fires
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(logsMock.mock.calls.length).toBeGreaterThan(callsAfterOpen);

    // Disable Live toggle
    const callsBeforeDisable = logsMock.mock.calls.length;
    await act(async () => {
      liveCheckbox.click();
    });

    // Advance 2s → no more calls
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(logsMock.mock.calls.length).toBe(callsBeforeDisable);
  });
});

// ─── AC-5: keys row always renders invariant; no sk- strings ─────────────────

describe("AC-5: keys row invariant + no key material", () => {
  it("Keys row always renders the invariant line", async () => {
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    // The keys row is static — no need to wait for stats
    const keysRow = screen.getByText(/Held by bridge — never in this plugin/i);
    expect(keysRow).toBeInTheDocument();
  });

  it("no sk- substring appears anywhere in the rendered DOM", async () => {
    const bridge = makeBridge({
      skills: vi.fn().mockResolvedValue({
        skills: [
          { name: "craft-review", rev: "a1b2c3d", pinned: true },
          { name: "vision-review", rev: "e4f5g6h", pinned: false },
        ],
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    // Wait for skills to load so the DOM is fully populated
    await waitFor(() =>
      expect(screen.getByText("craft-review")).toBeInTheDocument(),
    );

    // Assert no API key patterns anywhere
    expect(document.body.textContent).not.toMatch(/sk-/);
  });
});

// ─── AC-6: skills rows from fake bridge ──────────────────────────────────────

describe("AC-6: skills rows from bridge.skills()", () => {
  it("renders skill name and rev; shows · pinned badge when pinned", async () => {
    const bridge = makeBridge({
      skills: vi.fn().mockResolvedValue({
        skills: [
          { name: "craft-review", rev: "a1b2c3d", pinned: true },
          { name: "intake", rev: "e4f5678", pinned: false },
        ],
      }),
    });
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await waitFor(() =>
      expect(screen.getByText("craft-review")).toBeInTheDocument(),
    );

    expect(screen.getByText("intake")).toBeInTheDocument();
    expect(screen.getByText(/rev a1b2c3d/)).toBeInTheDocument();
    expect(screen.getByText(/rev e4f5678/)).toBeInTheDocument();

    // "· pinned" badge only for craft-review
    expect(screen.getByText(/· pinned/)).toBeInTheDocument();
  });

  it("shows empty state when bridge returns no skills", async () => {
    const bridge = makeBridge({
      skills: vi.fn().mockResolvedValue({ skills: [] }),
    });
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await waitFor(() =>
      expect(screen.getByText(/No skills loaded/i)).toBeInTheDocument(),
    );
  });
});

// ─── AC-7: storage meter math + Compact behavior ──────────────────────────────

describe("AC-7: storage meter math + Compact", () => {
  it("computes meter display from JSON-stringified lengths of storage keys", async () => {
    const connData = { endpoint: "http://localhost:3779", mode: "local" };
    const runsData = Array.from({ length: 20 }, (_, i) => ({ id: `run-${i}` }));
    const checksData = { entries: [], runCounter: 1 };

    const bus = makeBus({
      "conn:v1:file-abc": connData,
      "runs:v1:file-abc": runsData,
      "checks:v1:file-abc": checksData,
    });

    await renderWithProviders(<Settings bridge={makeBridge()} bus={bus} />, { queryClient: makeTestQueryClient() });

    await waitFor(() =>
      expect(bus.storageGet).toHaveBeenCalledWith("runs:v1:file-abc"),
    );

    const totalBytes =
      JSON.stringify(connData).length +
      JSON.stringify(runsData).length +
      JSON.stringify(checksData).length;

    const expected = `${(totalBytes / 1024).toFixed(1)} / 100 kb`;

    await waitFor(() =>
      expect(document.body.textContent).toContain(expected),
    );
  });

  it("shows amber Compact button when usage exceeds 80% of 100kb", async () => {
    // Need >80kb: 10 entries × ~8.5kb each ≈ 85kb
    const bigRuns = Array.from({ length: 10 }, (_, i) => ({
      id: `run-${i}`,
      data: "x".repeat(8500),
    }));

    const bus = makeBus({ "runs:v1:file-abc": bigRuns });

    await renderWithProviders(<Settings bridge={makeBridge()} bus={bus} />, { queryClient: makeTestQueryClient() });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Compact storage/i }),
      ).toBeInTheDocument(),
    );
  });

  it("Compact trims runs:v1 to the first 5 entries via storageSet", async () => {
    const runsData = Array.from({ length: 10 }, (_, i) => ({
      id: `run-${i}`,
      data: "x".repeat(8500),
    }));

    const storageSetMock = vi.fn().mockResolvedValue(undefined);
    const bus: PluginBus = {
      ...makeBus({ "runs:v1:file-abc": runsData }),
      storageSet: storageSetMock,
    };

    await renderWithProviders(<Settings bridge={makeBridge()} bus={bus} />, { queryClient: makeTestQueryClient() });

    const compactBtn = await screen.findByRole("button", {
      name: /Compact storage/i,
    });
    await userEvent.click(compactBtn);

    await waitFor(() =>
      expect(storageSetMock).toHaveBeenCalledWith(
        "runs:v1:file-abc",
        runsData.slice(0, 5),
      ),
    );
  });
});

// ─── AC-8: graceful stats() failure → down state ─────────────────────────────

describe("AC-8: graceful stats() failure → down state", () => {
  it("shows down state (red dot + start command) when stats() throws", async () => {
    const bridge = makeBridge({
      stats: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    const bus = makeBus();

    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await waitFor(() =>
      expect(screen.getByText(/Bridge not reachable/i)).toBeInTheDocument(),
    );

    // Start command visible in the down state card
    expect(screen.getByText("uxfactory bridge")).toBeInTheDocument();
  });

  it("recovers to healthy state when stats() starts succeeding after a failure", async () => {
    const statsMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(STATS_DATA);

    const bridge = makeBridge({ stats: statsMock });
    const bus = makeBus();

    const { queryClient } = await renderWithProviders(
      <Settings bridge={bridge} bus={bus} />,
      { queryClient: makeTestQueryClient() },
    );

    // Initial call fails → down state (retry:false means error is immediate)
    await waitFor(() =>
      expect(screen.getByText(/Bridge not reachable/i)).toBeInTheDocument(),
    );

    // Simulate bridge recovery: invalidate the stats cache to trigger a re-fetch.
    // TanStack Query v5 does not auto-reschedule refetchInterval from error state
    // when there is no prior successful data; invalidateQueries is the correct
    // recovery trigger in this model (matches what a "Reconnect" action would do).
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    });

    // Stats now returns STATS_DATA → healthy state
    await waitFor(() => {
      expect(screen.queryByText(/Bridge not reachable/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/v0\.4\.2/)).toBeInTheDocument();
  });
});

// ─── Devices card: per-category viewport device presets ───────────────────────

describe("Devices card: define the device behind each viewport category", () => {
  beforeEach(() => {
    useRunsStore.setState({ deviceConfig: DEFAULT_DEVICE_CONFIG });
  });

  it("renders Desktop/Tablet/Mobile device selects with the default presets", async () => {
    const bridge = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    const desktop = screen.getByLabelText("Desktop device") as HTMLSelectElement;
    const tablet = screen.getByLabelText("Tablet device") as HTMLSelectElement;
    const mobile = screen.getByLabelText("Mobile device") as HTMLSelectElement;
    expect(desktop.value).toBe("Laptop");
    expect(tablet.value).toBe("iPad Mini/Air");
    expect(mobile.value).toBe("iPhone 14/15");
    // Options carry the actual dimensions.
    expect(screen.getByRole("option", { name: "Desktop HD · 1920×1080" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "iPhone Pro Max · 430×932" })).toBeInTheDocument();
  });

  it("changing a device preset updates the runs-store deviceConfig", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Settings bridge={bridge} bus={bus} />, { queryClient: makeTestQueryClient() });

    await user.selectOptions(screen.getByLabelText("Mobile device"), "iPhone Pro Max");

    expect(useRunsStore.getState().deviceConfig.mobile).toEqual({
      name: "iPhone Pro Max",
      width: 430,
      height: 932,
    });
  });
});

// ─── Danger zone: Reset repo ──────────────────────────────────────────────────

describe("Danger zone: Reset repo", () => {
  function makeResetBridge(overrides: Partial<Bridge> = {}): Bridge {
    return makeBridge({
      resetProject: vi.fn().mockResolvedValue({ ok: true, removed: ["links.json", "renders"] }),
      setProjectRoot: vi.fn(),
      ...overrides,
    });
  }

  it("renders the danger card with a Reset repo action and warning copy", async () => {
    await renderWithProviders(
      <Settings bridge={makeResetBridge()} bus={makeBus()} />,
      { queryClient: makeTestQueryClient() },
    );

    expect(screen.getByText("Danger zone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset repo/i })).toBeInTheDocument();
  });

  it("clicking Reset repo opens a confirm dialog; Cancel does nothing", async () => {
    const user = userEvent.setup();
    const bridge = makeResetBridge();
    await renderWithProviders(
      <Settings bridge={bridge} bus={makeBus()} />,
      { queryClient: makeTestQueryClient() },
    );

    await user.click(screen.getByRole("button", { name: /reset repo/i }));
    // Destructive intent is spelled out before anything happens.
    expect(screen.getByText(/can('|’)t be undone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset & disconnect/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(bridge.resetProject).not.toHaveBeenCalled();
    expect(screen.queryByText(/can('|’)t be undone/i)).not.toBeInTheDocument();
  });

  it("confirming resets the repo, forgets the stored connection, and disconnects to /connect", async () => {
    const user = userEvent.setup();
    const bridge = makeResetBridge();
    const bus = makeBus();
    useRunsStore.setState({ runs: [{ id: "r1" } as never] });

    const { router } = await renderWithProviders(
      <Settings bridge={bridge} bus={bus} />,
      { queryClient: makeTestQueryClient() },
    );

    await user.click(screen.getByRole("button", { name: /reset repo/i }));
    await user.click(screen.getByRole("button", { name: /reset & disconnect/i }));

    await waitFor(() => expect(bridge.resetProject).toHaveBeenCalledTimes(1));
    // Plugin-side association for THIS file is forgotten — no auto-reconnect.
    await waitFor(() =>
      expect(bus.storageSet).toHaveBeenCalledWith("conn:v1:file-abc", null),
    );
    expect(useRunsStore.getState().runs).toEqual([]);
    expect(bridge.setProjectRoot).toHaveBeenCalledWith(null);
    expect(useAppStore.getState().connection.status).toBe("none");
    await waitFor(() => expect(router.state.location.pathname).toBe("/connect"));
  });

  it("bridge failure surfaces a toast and does NOT disconnect", async () => {
    const user = userEvent.setup();
    const bridge = makeResetBridge({
      resetProject: vi.fn().mockRejectedValue(new Error("bridge down")),
    });
    const bus = makeBus();

    const { router } = await renderWithProviders(
      <Settings bridge={bridge} bus={bus} />,
      { queryClient: makeTestQueryClient() },
    );

    await user.click(screen.getByRole("button", { name: /reset repo/i }));
    await user.click(screen.getByRole("button", { name: /reset & disconnect/i }));

    await waitFor(() => expect(useAppStore.getState().toasts.length).toBeGreaterThan(0));
    expect(bus.storageSet).not.toHaveBeenCalledWith("conn:v1:file-abc", null);
    expect(useAppStore.getState().connection.status).toBe("connected");
    expect(router.state.location.pathname).not.toBe("/connect");
  });
});

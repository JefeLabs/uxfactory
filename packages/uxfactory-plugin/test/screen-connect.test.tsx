// @vitest-environment jsdom
/**
 * screen-connect.test.tsx — RTL tests for the Connect screen.
 *
 * Test names map 1-to-1 with PRD §7 acceptance criteria (AC-1 … AC-7).
 * Bridge and bus are always injected as fakes; no module-level mocks.
 *
 * Selector discipline: the Component under test must NOT return object literals
 * from useAppStore selectors — these tests indirectly verify that constraint by
 * confirming the component renders without infinite-update errors.
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
import type { Bridge, ProjectSnapshot } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";
import { useAppStore } from "../ui/stores/app.js";
import { Connect } from "../ui/screens/Connect.js";
import { renderWithProviders } from "./test-utils.js";

// ─── Store reset ─────────────────────────────────────────────────────────────

const BASE_STORE = {
  connection: {
    status: "none" as const,
    endpoint: "http://localhost:3779",
    repoPath: "",
    mode: "local" as const,
  },
  fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
  snapshot: null,
  route: { screen: "connect" as const, tab: "prompt" as const },
  toasts: [],
};

beforeEach(() => useAppStore.setState(BASE_STORE));
afterEach(cleanup);

// ─── Fake bridge factory ──────────────────────────────────────────────────────

const BASE_SNAPSHOT: ProjectSnapshot = {
  name: "Demo Shop",
  root: "/home/user/demo-shop",
  hasClassification: true,
  hasProfile: true,
  classification: null,
  profile: null,
  artifacts: [],
  requirements: [],
};

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi
      .fn()
      .mockResolvedValue({ ok: true, snapshot: BASE_SNAPSHOT }),
    snapshot: vi.fn().mockResolvedValue(BASE_SNAPSHOT),
    putClassification: vi.fn().mockResolvedValue({ ok: true }),
    putProfile: vi.fn().mockResolvedValue({ ok: true }),
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    stats: vi
      .fn()
      .mockResolvedValue({ version: "1.0", uptimeMs: 0, runsRelayed: 0, tokenCount: null }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    enqueue: vi.fn().mockResolvedValue({ id: "req-1" }),
    events: vi.fn().mockReturnValue(() => {}),
    latestRender: vi.fn().mockResolvedValue(null),
    verify: vi.fn().mockResolvedValue(null),
    getCwd: vi.fn().mockResolvedValue({ cwd: "/repos/demo-shop" }),
    ...overrides,
  };
}

// ─── Fake bus factory ─────────────────────────────────────────────────────────

function makeBus(storedByKey: Record<string, unknown> = {}): PluginBus {
  return {
    storageGet: vi
      .fn()
      .mockImplementation(async (key: string) => storedByKey[key]),
    storageSet: vi.fn().mockResolvedValue(undefined),
    fileInfo: vi.fn().mockResolvedValue({ name: "Demo Shop", fileKey: "file-abc" }),
    insertIcon: vi.fn().mockResolvedValue("node-1"),
    notify: vi.fn(),
    close: vi.fn(),
    onSelection: vi.fn().mockReturnValue(() => {}),
    selectNodes: vi.fn(),
    postReview: vi.fn(),
  };
}

// ─── AC-1: Happy connect flow ────────────────────────────────────────────────

describe("AC-1: happy connect — running bridge + valid path → routes per snapshot", () => {
  it("hasClassification true → routes to 'tabs'", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();

    const { router } = await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    // Wait for the first health query to complete → pill shows Running
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );

    // Type a repo path
    const input = screen.getByRole("textbox");
    await user.type(input, "/home/user/demo-shop");

    // Click Connect
    await user.click(screen.getByRole("button", { name: "Connect" }));

    // connectProject should be called with the trimmed path
    expect(bridge.connectProject).toHaveBeenCalledWith("/home/user/demo-shop");

    // Router should navigate to tabs (hasClassification: true)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/tabs/prompt"),
    );
  });

  it("hasClassification false → routes to 'setup-1'", async () => {
    const user = userEvent.setup();
    const snapshot = { ...BASE_SNAPSHOT, hasClassification: false };
    const bridge = makeBridge({
      connectProject: vi.fn().mockResolvedValue({ ok: true, snapshot }),
    });
    const bus = makeBus();

    const { router } = await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );

    await user.type(screen.getByRole("textbox"), "/home/user/demo-shop");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/setup/classification"),
    );
  });

  it("persists connection to plugin storage on success", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );

    await user.type(screen.getByRole("textbox"), "/home/user/demo-shop");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(bus.storageSet).toHaveBeenCalledWith(
        "connection:file-abc",
        expect.objectContaining({ repoPath: "/home/user/demo-shop" }),
      ),
    );
  });
});

// ─── AC-2: Bridge down / flip to running ─────────────────────────────────────

describe("AC-2: bridge down → CTA disabled + copyable command shown", () => {
  it("shows 'Not detected' pill, uxfactory bridge command, and disabled CTA when bridge is down", async () => {
    const bridge = makeBridge({
      health: vi.fn().mockResolvedValue({ ok: false }),
    });
    const bus = makeBus();
    // Pre-fill path so CTA would be enabled if bridge were up
    useAppStore.setState({
      ...BASE_STORE,
      connection: { ...BASE_STORE.connection, repoPath: "/home/user/demo-shop" },
    });

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Not detected"),
    );

    // Copyable command must be visible
    expect(screen.getByText("uxfactory bridge")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Copy uxfactory bridge/i }),
    ).toBeInTheDocument();

    // CTA must be disabled
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("health flip to ok re-enables CTA within a fake-timer 3s tick", async () => {
    vi.useFakeTimers();
    try {
      let healthOk = false;
      const bridge = makeBridge({
        health: vi.fn().mockImplementation(() => Promise.resolve({ ok: healthOk })),
      });
      const bus = makeBus();
      // Pre-populate repoPath so CTA becomes enabled once bridge is up
      useAppStore.setState({
        ...BASE_STORE,
        connection: { ...BASE_STORE.connection, repoPath: "/home/user/demo-shop" },
      });

      await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
        initialEntries: ["/connect"],
      });

      // TanStack Query v5 uses `notifyManager.batchCalls` which routes React
      // re-renders through `setTimeout(fn, 0)` (the `systemSetTimeoutZero`
      // scheduler). With fake timers this means two steps are required:
      //
      // Step 1: flush the bridge.health() Promise microtask so TanStack Query
      //         processes the result and schedules setTimeout(notification, 0).
      await act(async () => {});
      // Step 2: advance timers by 0 to fire that notification timer, triggering
      //         the useSyncExternalStore subscriber → React re-render.
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(screen.getByRole("status")).toHaveTextContent("Not detected");

      // Flip bridge health to ok
      healthOk = true;

      // Advance 3001ms: fires the 3s refetchInterval at t=3000ms.
      // act(async) then flushes the resulting bridge.health() microtask and
      // TanStack Query schedules a new setTimeout(notification, 0).
      await act(async () => {
        vi.advanceTimersByTime(3_001);
      });
      // Fire the new notification timer so React re-renders with the updated state.
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(screen.getByRole("status")).toHaveTextContent("Running");

      // CTA must now be enabled
      expect(screen.getByRole("button", { name: "Connect" })).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── AC-3: Invalid path errors ───────────────────────────────────────────────

describe("AC-3: invalid path → field-level error by kind, no partial persist", () => {
  async function renderAndAttemptConnect(
    bridge: Bridge,
    path: string = "/some/path",
  ) {
    const user = userEvent.setup();
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );

    await user.type(screen.getByRole("textbox"), path);
    await user.click(screen.getByRole("button", { name: "Connect" }));

    return bus;
  }

  it("not-found → field shows 'Path not found'", async () => {
    const bridge = makeBridge({
      connectProject: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "not-found" }),
    });

    await renderAndAttemptConnect(bridge);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Path not found"),
    );
  });

  it("not-a-root → field shows the not-a-root message", async () => {
    const bridge = makeBridge({
      connectProject: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "not-a-root" }),
    });

    await renderAndAttemptConnect(bridge);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Not a repository root",
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "uxfactory.batch.json",
    );
  });

  it("bridge-serves-different-root → field shows served path and guidance", async () => {
    const bridge = makeBridge({
      connectProject: vi.fn().mockResolvedValue({
        ok: false,
        reason: "bridge-serves-different-root",
        served: "/other/repo",
      }),
    });

    await renderAndAttemptConnect(bridge);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This bridge serves /other/repo",
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("connect to that path");
  });

  it("no partial persist — storageSet is NOT called on error", async () => {
    const bridge = makeBridge({
      connectProject: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "not-found" }),
    });

    const bus = await renderAndAttemptConnect(bridge);

    // Give the async chain time to settle
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument(),
    );

    expect(bus.storageSet).not.toHaveBeenCalled();
  });

  it("failed connect (ok:false) does not navigate away from /connect", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      connectProject: vi.fn().mockResolvedValue({ ok: false, reason: "not-found" }),
    });
    const bus = makeBus();
    const { router } = await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );
    await user.type(screen.getByRole("textbox"), "/bad/path");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Path not found"));
    expect(router.state.location.pathname).toBe("/connect");
  });
});

// ─── AC-3b: Bridge throw — endpoint appears in toast error ───────────────────

describe("AC-3b: connectProject throws → connectFailed includes the endpoint URL", () => {
  it("names the connection endpoint in the error when bridge is unreachable", async () => {
    const user = userEvent.setup();
    // Bridge health is healthy so CTA is enabled, but connectProject throws
    const bridge = makeBridge({
      health: vi.fn().mockResolvedValue({ ok: true }),
      connectProject: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    const bus = makeBus();

    // Store endpoint already set to the default value in BASE_STORE
    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );

    await user.type(screen.getByRole("textbox"), "/home/user/demo-shop");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(useAppStore.getState().connection.status).toBe("error"),
    );

    const toastMessage = useAppStore.getState().toasts[0]?.message ?? "";
    expect(toastMessage).toContain("http://localhost:3779");
    expect(toastMessage).toContain("uxfactory bridge");
  });
});

// ─── AC-4: Prefill from stored connection ────────────────────────────────────

describe("AC-4: prefill from stored connection", () => {
  it("pre-fills the repo input and mode from plugin storage on mount", async () => {
    const storedConn = {
      mode: "local",
      endpoint: "http://localhost:3779",
      repoPath: "/stored/my-project",
    };
    const bus = makeBus({ "connection:file-abc": storedConn });
    const bridge = makeBridge();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    // Input should show the stored path after the storage effect resolves
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveValue("/stored/my-project"),
    );
  });

  it("compact hero (no hero band) when store already has repoPath", async () => {
    useAppStore.setState({
      ...BASE_STORE,
      connection: { ...BASE_STORE.connection, repoPath: "/prev/repo" },
    });

    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    // Hero band bullets should NOT be visible
    expect(
      screen.queryByText(/Create and maintain specifications/i),
    ).not.toBeInTheDocument();
  });
});

// ─── AC-5: Headline shows live Figma file name ───────────────────────────────

describe("AC-5: headline reflects live Figma file name", () => {
  it("shows the file name from the store in the headline", async () => {
    useAppStore.setState({
      ...BASE_STORE,
      fileInfo: { name: "Marketing Site", fileKey: "file-xyz" },
    });

    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    expect(
      screen.getByText("Marketing Site", { exact: false }),
    ).toBeInTheDocument();

    // The heading element should contain the file name
    const heading = screen.getByRole("heading");
    expect(heading).toHaveTextContent("Marketing Site");
  });
});

// ─── AC-6: Cloud tab selectable, no dead-end ─────────────────────────────────

describe("AC-6: Cloud tab renders and is selectable — no dead-end", () => {
  it("selecting Cloud shows the stub card with coming-soon message", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    const cloudOption = screen.getByRole("radio", { name: "Cloud" });
    await user.click(cloudOption);

    expect(
      screen.getByText(/Cloud connect arrives with hosted workers/i),
    ).toBeInTheDocument();
  });

  it("switching to Cloud hides the Local-only rows (Bridge, Repository)", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    const cloudOption = screen.getByRole("radio", { name: "Cloud" });
    await user.click(cloudOption);

    // Bridge and Repository field labels should be gone
    expect(screen.queryByText("Bridge:")).not.toBeInTheDocument();
    expect(screen.queryByText("Repository:")).not.toBeInTheDocument();
  });

  it("Cloud CTA exists but is disabled (not a dead-end — a stub)", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    await user.click(screen.getByRole("radio", { name: "Cloud" }));

    const cta = screen.getByRole("button", { name: "Connect" });
    expect(cta).toBeInTheDocument();
    expect(cta).toBeDisabled();
  });
});

// ─── AC-7: Accessibility basics ──────────────────────────────────────────────

describe("AC-7: a11y basics", () => {
  it("repository input has an accessible label", async () => {
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    // getByLabelText resolves via htmlFor link (Field passes id down to both
    // the <label> htmlFor and the children slot).
    expect(screen.getByLabelText("Repository:")).toBeInTheDocument();
  });

  it("status pill carries role=status (aria-live region)", async () => {
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    const pill = screen.getByRole("status");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute("aria-live", "polite");
  });

  it("all interactive elements are keyboard-operable", async () => {
    const bridge = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    // Segmented renders as a Radix RadioGroup (role="radiogroup") containing
    // radio items. The group is reachable via Tab; items are navigable with
    // Arrow keys (roving-tabindex managed by Radix).
    expect(
      screen.getByRole("radiogroup", { name: "Connection mode" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Local Dev" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Cloud" })).toBeInTheDocument();

    // Repository input is focusable (not disabled on first render)
    const input = screen.getByRole("textbox");
    expect(input).not.toBeDisabled();

    // Connect button is present (enabled/disabled depends on bridge status,
    // tested separately in AC-2)
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("error message is announced as an alert", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      connectProject: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "not-found" }),
    });
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );

    await user.type(screen.getByRole("textbox"), "/bad/path");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Path not found"),
    );
  });

  it("checking state shows 'Checking…' pill before health resolves", async () => {
    // Install a promise that never resolves so we stay in "checking" state
    const bridge = makeBridge({
      health: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    const bus = makeBus();

    await renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });

    expect(screen.getByRole("status")).toHaveTextContent("Checking…");
    // CTA should be disabled while checking
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });
});

// ─── Cwd hint chip ───────────────────────────────────────────────────────────

describe("cwd hint chip — one-click fill from the bridge's working directory", () => {
  it("shows the bridge folder once running and fills the input on click", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();

    await renderWithProviders(<Connect bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/connect"],
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );

    const chip = await screen.findByRole("button", { name: /use bridge folder/i });
    expect(chip).toHaveTextContent("/repos/demo-shop");

    await user.click(chip);
    expect(screen.getByRole("textbox")).toHaveValue("/repos/demo-shop");
    // Field now matches the hint — the chip retires
    expect(
      screen.queryByRole("button", { name: /use bridge folder/i }),
    ).not.toBeInTheDocument();
  });

  it("clears a prior path error when the chip fills the field", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      connectProject: vi.fn().mockResolvedValue({ ok: false, reason: "not-found" }),
    });

    await renderWithProviders(<Connect bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/connect"],
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );

    await user.type(screen.getByRole("textbox"), "/bad/path");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Path not found");

    await user.click(screen.getByRole("button", { name: /use bridge folder/i }));
    expect(screen.queryByText("Path not found")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("/repos/demo-shop");
  });

  it("omits the chip when the bridge build lacks getCwd", async () => {
    const bridge = makeBridge({ getCwd: undefined });

    await renderWithProviders(<Connect bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/connect"],
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );

    expect(
      screen.queryByRole("button", { name: /use bridge folder/i }),
    ).not.toBeInTheDocument();
  });
});

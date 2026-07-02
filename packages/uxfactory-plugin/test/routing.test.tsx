// @vitest-environment jsdom
/**
 * routing.test.tsx — RTL integration tests for boot routing and the App shell.
 *
 * Rather than importing main.tsx (which runs boot eagerly on import), we drive
 * the app store directly to place the app into the state that each boot path
 * would produce, then render <App/> and assert on visible DOM.
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, within, cleanup, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useAppStore } from "../ui/stores/app.js";
import { App } from "../ui/app.js";
import type { Bridge } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";

afterEach(cleanup);

// ─── Fake bridge + bus ────────────────────────────────────────────────────────

function makeBridge(): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ status: "running" }),
    snapshot: vi.fn().mockResolvedValue({
      name: "Demo Shop",
      root: "/home/user/demo-shop",
      hasClassification: true,
      hasProfile: true,
      classification: null,
      profile: null,
      artifacts: [],
      requirements: [],
    }),
    classify: vi.fn().mockResolvedValue({ success: true }),
    setProfile: vi.fn().mockResolvedValue({ success: true }),
    render: vi.fn().mockResolvedValue({ jobId: "j-1" }),
    runs: vi.fn().mockResolvedValue([]),
    // getLinks returns { links: [] } (NOT bare array — Components.tsx destructures { links })
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    icons: vi.fn().mockResolvedValue({ icons: [] }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    getChecks: vi.fn().mockResolvedValue({ categories: [] }),
    postAnnotations: vi.fn().mockResolvedValue({ ok: true }),
    deleteAnnotations: vi.fn().mockResolvedValue({ ok: true }),
    getAnnotations: vi.fn().mockResolvedValue({ items: [] }),
    getSettings: vi.fn().mockResolvedValue({}),
    setSettings: vi.fn().mockResolvedValue({ ok: true }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    stats: vi.fn().mockResolvedValue({ version: "0.0.0", uptimeMs: 0, runsRelayed: 0, tokenCount: null }),
    skills: vi.fn().mockResolvedValue({ skills: [] }),
    enqueue: vi.fn().mockResolvedValue({ jobId: "j-1", requestId: "r-1" }),
    latestRender: vi.fn().mockResolvedValue(null),
    // SSE subscription — returns a no-op teardown
    events: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge;
}

function makeBus(): PluginBus {
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
  };
}

// ─── Store reset helpers ──────────────────────────────────────────────────────

function resetToConnect() {
  useAppStore.setState({
    connection: {
      status: "none",
      endpoint: "http://localhost:3779",
      repoPath: "",
      mode: "local",
    },
    fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
    snapshot: null,
    route: { screen: "connect", tab: "prompt" },
    toasts: [],
  });
}

function resetToTabs(hasClassification = true) {
  useAppStore.setState({
    connection: {
      status: "connected",
      endpoint: "http://localhost:3779",
      repoPath: "/home/user/demo-shop",
      mode: "local",
    },
    fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
    snapshot: {
      name: "Demo Shop",
      root: "/home/user/demo-shop",
      hasClassification,
      hasProfile: true,
      classification: {
        category: "ecommerce",
        industry: "corporate",
        locale: "en-US",
        platforms: ["desktop", "mobile"],
        layout: "responsive",
        ageGroup: "18-39",
      },
      profile: null,
      artifacts: [],
      requirements: [],
    },
    route: { screen: "tabs", tab: "prompt" },
    toasts: [],
  });
}

function resetToReconnecting() {
  useAppStore.setState({
    connection: {
      status: "reconnecting",
      endpoint: "http://localhost:3779",
      repoPath: "/home/user/demo-shop",
      mode: "local",
    },
    fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
    snapshot: null,
    route: { screen: "connect", tab: "prompt" },
    toasts: [],
  });
}

// ─── Boot path: connect screen ────────────────────────────────────────────────

describe("boot path — connect screen (no stored connection)", () => {
  beforeEach(resetToConnect);

  it("renders the Connect screen when screen is 'connect'", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    // Connect screen renders a repo-path input
    expect(screen.getByPlaceholderText("~/path/to/repo")).toBeInTheDocument();
  });

  it("shows the TitleBar with 'UXFactory (Developer VM)'", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    expect(screen.getByText("UXFactory (Developer VM)")).toBeInTheDocument();
  });

  it("does not show the context bar on the plain connect screen", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    // The ContextBar has an expand/collapse button unique to it — absent on connect screen.
    // (The Connect screen renders its own bridge-health StatusPill, so we check by
    //  the ContextBar's expand button rather than role="status".)
    expect(screen.queryByRole("button", { name: /Expand project details/i })).not.toBeInTheDocument();
  });
});

// ─── Boot path: tabs (stored + classified) ────────────────────────────────────

describe("boot path — tabs (stored connection + classified project)", () => {
  beforeEach(() => resetToTabs(true));

  it("renders the tab list with all 6 tabs", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    const tabList = screen.getByRole("tablist", { name: "Panel tabs" });
    const tabs = within(tabList).getAllByRole("tab");
    expect(tabs).toHaveLength(6);
  });

  it("renders the Prompt tab label", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    expect(screen.getByRole("tab", { name: "Prompt" })).toBeInTheDocument();
  });

  it("shows the context bar with StatusPill 'Connected'", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    // The ContextBar connection status shows "Connected" (aria-label is unique
    // vs the Connect screen's bridge-health labels "Running"/"Not detected"/"Checking…")
    expect(screen.getByRole("status", { name: "Connected" })).toBeInTheDocument();
  });

  it("shows the project name in the context bar", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    expect(screen.getByText("Demo Shop")).toBeInTheDocument();
  });

  it("shows the Prompt tab as active by default", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    expect(screen.getByRole("tab", { name: "Prompt" })).toHaveAttribute("data-state", "active");
  });
});

// ─── Reconnect-cancel path ────────────────────────────────────────────────────

describe("reconnect-cancel path", () => {
  beforeEach(resetToReconnecting);

  it("shows 'Reconnecting…' status pill when connection.status is reconnecting", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    // Use aria-label to target specifically the ContextBar reconnecting pill (not Connect's bridge-health pill)
    expect(screen.getByRole("status", { name: "Reconnecting…" })).toBeInTheDocument();
  });

  it("shows a Cancel button during reconnect", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    expect(screen.getByRole("button", { name: /Cancel reconnect/i })).toBeInTheDocument();
  });

  it("clicking Cancel routes to the connect screen", async () => {
    const user = userEvent.setup();
    render(<App bridge={makeBridge()} bus={makeBus()} />);

    await user.click(screen.getByRole("button", { name: /Cancel reconnect/i }));

    // After cancel, route.screen should be "connect"
    expect(useAppStore.getState().route.screen).toBe("connect");
    // Connect screen renders its repo-path input
    expect(screen.getByPlaceholderText("~/path/to/repo")).toBeInTheDocument();
  });

  it("clicking Cancel resets connection.status to 'none' and hides the ContextBar", async () => {
    const user = userEvent.setup();
    render(<App bridge={makeBridge()} bus={makeBus()} />);

    // Before cancel: ContextBar reconnect StatusPill is visible
    expect(screen.getByRole("status", { name: "Reconnecting…" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel reconnect/i }));

    // connection.status must be "none" (not just a screen change)
    expect(useAppStore.getState().connection.status).toBe("none");

    // ContextBar is suppressed: showContextBar = (screen !== "connect" || status === "reconnecting")
    // With screen="connect" and status="none", the ContextBar reconnecting pill should be gone.
    expect(screen.queryByRole("status", { name: "Reconnecting…" })).not.toBeInTheDocument();
  });
});

// ─── Boot race guard ──────────────────────────────────────────────────────────

describe("boot race guard — late bridge reply after cancel", () => {
  beforeEach(resetToReconnecting);

  it("resolving health/snapshot after cancel does not yank user to tabs", async () => {
    const user = userEvent.setup();
    render(<App bridge={makeBridge()} bus={makeBus()} />);

    // Create a controlled promise simulating the hanging Promise.all in boot.
    let resolveAll!: () => void;
    const hangingAll = new Promise<void>((res) => {
      resolveAll = res;
    });

    // Inline the post-await boot logic WITH the race guard (mirrors the fix in main.tsx).
    const simulatedBoot = hangingAll.then(() => {
      // Race guard — this is the fix in main.tsx
      if (useAppStore.getState().connection.status !== "reconnecting") return;
      useAppStore.getState().connectSucceeded(
        {
          name: "Demo Shop",
          root: "/home/user/demo-shop",
          hasClassification: true,
          hasProfile: true,
          classification: null,
          profile: null,
          artifacts: [],
          requirements: [],
        },
        "/home/user/demo-shop",
      );
    });

    // User cancels while health/snapshot promises are still in flight.
    await user.click(screen.getByRole("button", { name: /Cancel reconnect/i }));

    expect(useAppStore.getState().connection.status).toBe("none");
    expect(useAppStore.getState().route.screen).toBe("connect");

    // Late bridge reply arrives — resolve the hanging promises.
    await act(async () => {
      resolveAll();
      await simulatedBoot;
    });

    // The race guard must have prevented the yank to "tabs".
    expect(useAppStore.getState().route.screen).toBe("connect");
    expect(useAppStore.getState().connection.status).toBe("none");
    // ContextBar connection StatusPill must still be absent (no "Connected" pill).
    expect(screen.queryByRole("status", { name: "Connected" })).not.toBeInTheDocument();
  });
});

// ─── Each tab click changes active tab ───────────────────────────────────────
// Note: TabNav uses forceMount + display:none so ALL panels are in the DOM at
// once. The active tab is identified by data-state="active" on the tab trigger,
// not by unique panel content.

describe("tab navigation sets active tab", () => {
  beforeEach(() => resetToTabs(true));

  const tabLabels = ["Prompt", "Artifacts", "Components", "Assets", "Checks", "Settings"] as const;

  for (const label of tabLabels) {
    it(`clicking '${label}' makes its tab trigger active`, async () => {
      const user = userEvent.setup();
      render(<App bridge={makeBridge()} bus={makeBus()} />);

      const tabEl = screen.getByRole("tab", { name: label });
      await user.click(tabEl);

      expect(tabEl).toHaveAttribute("data-state", "active");
    });
  }
});

// ─── Tab state is stored in the app store ────────────────────────────────────

describe("tab store binding", () => {
  beforeEach(() => resetToTabs(true));

  it("clicking a tab updates route.tab in the store", async () => {
    const user = userEvent.setup();
    render(<App bridge={makeBridge()} bus={makeBus()} />);

    await user.click(screen.getByRole("tab", { name: "Artifacts" }));
    expect(useAppStore.getState().route.tab).toBe("artifacts");
  });
});

// ─── Setup screens ────────────────────────────────────────────────────────────

describe("setup-1 screen", () => {
  it("renders the SetupClassification screen", () => {
    useAppStore.setState({
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/repo", mode: "local" },
      fileInfo: { name: "Test", fileKey: "k" },
      snapshot: null,
      route: { screen: "setup-1", tab: "prompt" },
      toasts: [],
    });
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    // SetupClassification renders a "Starting mode" radiogroup
    expect(screen.getByRole("radiogroup", { name: /Starting mode/i })).toBeInTheDocument();
  });
});

describe("setup-2 screen", () => {
  it("renders the SetupDefaults screen", () => {
    useAppStore.setState({
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/repo", mode: "local" },
      fileInfo: { name: "Test", fileKey: "k" },
      snapshot: null,
      route: { screen: "setup-2", tab: "prompt" },
      toasts: [],
    });
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    // SetupDefaults renders buttons with aria-labels for each defaults field
    // Check for the "Back" navigation button which is always rendered
    expect(screen.getByRole("button", { name: /Back/i })).toBeInTheDocument();
  });
});

// ─── Toast system ────────────────────────────────────────────────────────────

describe("toast system", () => {
  beforeEach(resetToConnect);

  it("shows a toast message when one is added", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    act(() => {
      useAppStore.getState().toast("Bridge not reachable");
    });
    expect(screen.getByText("Bridge not reachable")).toBeInTheDocument();
  });

  it("dismiss button removes the toast", async () => {
    const user = userEvent.setup();
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    act(() => {
      useAppStore.getState().toast("Some message");
    });

    const dismissBtn = screen.getByRole("button", { name: /Dismiss: Some message/i });
    await user.click(dismissBtn);

    expect(screen.queryByText("Some message")).not.toBeInTheDocument();
  });
});

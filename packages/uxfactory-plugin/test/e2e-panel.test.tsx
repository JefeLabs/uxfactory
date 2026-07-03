// @vitest-environment jsdom
/**
 * e2e-panel.test.tsx — Lightweight integration smoke test for the App shell.
 *
 * Drives the full app router (real screens, real store) to verify that
 * the connect→tabs routing, tab switching, and reconnect/cancel flow all
 * wire together correctly end-to-end.
 *
 * Uses the store directly to control routing rather than driving the async
 * bridge — this is intentional: the routing logic itself is what we're
 * testing here; individual screen→bridge interactions are covered by the
 * dedicated screen-*.test.tsx files.
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, act, cleanup, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useAppStore } from "../ui/stores/app.js";
import { useWizardStore } from "../ui/stores/wizard.js";
import { renderWithProviders } from "./test-utils.js";
import { createAppRouter } from "../ui/router.js";
import { makeQueryClient } from "../ui/queries.js";
import type { Bridge } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";

afterEach(cleanup);

// ─── Minimal fakes ────────────────────────────────────────────────────────────

function makeBridge(): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: false }),
    connectProject: vi.fn().mockResolvedValue({ ok: false, reason: "not-found" }),
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
  };
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

// ─── Store setup helpers ──────────────────────────────────────────────────────

const DEMO_SNAPSHOT = {
  name: "Demo Shop",
  root: "/home/user/demo-shop",
  hasClassification: true,
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
};

function resetToConnect() {
  useAppStore.setState({
    connection: { status: "none", endpoint: "http://localhost:3779", repoPath: "", mode: "local" },
    fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
    snapshot: null,
    route: { screen: "connect", tab: "prompt" },
    toasts: [],
  });
}

// ─── renderApp helper: seed router from current store state ──────────────────

function initialPathFromStore(): string {
  const { route, focus } = useAppStore.getState();
  if (route.screen === "connect") return "/connect";
  if (route.screen === "setup-1") return "/setup/classification";
  if (route.screen === "setup-2") return "/setup/defaults";
  if (route.tab === "checks")
    return focus?.runId ? `/tabs/checks?run=${focus.runId}` : "/tabs/checks";
  if (route.tab === "artifacts")
    return focus?.artifactKey
      ? `/tabs/artifacts?focus=${focus.artifactKey}`
      : "/tabs/artifacts";
  return `/tabs/${route.tab}`;
}

async function renderApp(bridge = makeBridge(), bus = makeBus()) {
  const queryClient = makeQueryClient();
  const router = createAppRouter({ bridge, bus, queryClient }, [
    initialPathFromStore(),
  ]);
  return renderWithProviders(null, { router, queryClient });
}

// ─── E2E: Connect → Tabs routing ─────────────────────────────────────────────

describe("E2E: panel lifecycle — connect screen to tabs", () => {
  beforeEach(resetToConnect);

  it("renders the Connect screen with repo-path input on initial load", async () => {
    await renderApp();
    expect(screen.getByPlaceholderText("~/path/to/repo")).toBeInTheDocument();
    // No tabs visible on connect screen
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("transitions to the Tabs screen when connectSucceeded is dispatched", async () => {
    await renderApp();

    // Verify we start on connect screen
    expect(screen.getByPlaceholderText("~/path/to/repo")).toBeInTheDocument();

    // Simulate successful connect (mirrors what Connect.tsx does on bridge success)
    act(() => {
      useAppStore.getState().connectSucceeded(DEMO_SNAPSHOT, "/home/user/demo-shop");
    });

    // StoreRouteBridge navigates to /tabs/prompt after store update
    await waitFor(() =>
      expect(screen.getByRole("tablist", { name: "Panel tabs" })).toBeInTheDocument(),
    );
    // Connect input should be gone
    expect(screen.queryByPlaceholderText("~/path/to/repo")).not.toBeInTheDocument();
  });

  it("shows the project name in the ContextBar after successful connect", async () => {
    await renderApp();

    act(() => {
      useAppStore.getState().connectSucceeded(DEMO_SNAPSHOT, "/home/user/demo-shop");
    });

    await waitFor(() =>
      expect(screen.getByText("Demo Shop")).toBeInTheDocument(),
    );
    expect(screen.getByRole("status", { name: "Connected" })).toBeInTheDocument();
  });
});

// ─── E2E: Tab navigation ──────────────────────────────────────────────────────

describe("E2E: tab navigation after connect", () => {
  beforeEach(() => {
    useAppStore.setState({
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/home/user/demo-shop", mode: "local" },
      fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
      snapshot: DEMO_SNAPSHOT,
      route: { screen: "tabs", tab: "prompt" },
      toasts: [],
    });
  });

  it("renders all 6 tabs and Prompt is active by default", async () => {
    await renderApp();
    const tabList = screen.getByRole("tablist", { name: "Panel tabs" });
    expect(tabList).toBeInTheDocument();

    const tabs = ["Generate", "Artifacts", "Components", "Assets", "Checks", "Settings"];
    for (const label of tabs) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: "Generate" })).toHaveAttribute("data-state", "active");
  });

  it("clicking Artifacts tab makes it active and updates the router location", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.click(screen.getByRole("tab", { name: "Artifacts" }));

    expect(screen.getByRole("tab", { name: "Artifacts" })).toHaveAttribute("data-state", "active");
    await waitFor(() => expect(router.state.location.pathname).toBe("/tabs/artifacts"));
  });

  it("clicking Settings tab makes it active", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("data-state", "active");
    await waitFor(() => expect(router.state.location.pathname).toBe("/tabs/settings"));
  });
});

// ─── E2E: Reconnect / cancel flow ────────────────────────────────────────────

describe("E2E: reconnect then cancel", () => {
  beforeEach(() => {
    useAppStore.setState({
      connection: { status: "reconnecting", endpoint: "http://localhost:3779", repoPath: "/home/user/demo-shop", mode: "local" },
      fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
      snapshot: null,
      route: { screen: "connect", tab: "prompt" },
      toasts: [],
    });
  });

  it("shows the Reconnecting status pill and Cancel button", async () => {
    await renderApp();
    expect(screen.getByRole("status", { name: /Reconnecting/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel reconnect/i })).toBeInTheDocument();
  });

  it("Cancel routes back to connect screen and clears connection status", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.click(screen.getByRole("button", { name: /Cancel reconnect/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/connect"));
    expect(useAppStore.getState().connection.status).toBe("none");
    // Reconnecting/Connected pill from ContextBar should be gone
    expect(screen.queryByRole("status", { name: /Reconnecting|Connected/i })).not.toBeInTheDocument();
    // Connect screen should be visible again
    expect(screen.getByPlaceholderText("~/path/to/repo")).toBeInTheDocument();
  });
});

// ─── E2E: Wizard walk — sequential UI-driven flow ────────────────────────────

describe("E2E: wizard walk — Connect → setup-1 → setup-2 → tabs", () => {
  beforeEach(() => {
    // Reset wizard store to known defaults so category is pre-selected
    useWizardStore.setState({
      classification: {
        category: "ecommerce",
        industry: "corporate",
        locale: "en-US",
        platforms: ["desktop", "mobile"],
        layout: "responsive",
        ageGroup: "18-39",
        startingMode: "start-fresh",
      },
      defaults: {
        style: "mix",
        visual: "high",
        editorial: "medium",
        flow: "low",
        coverage: "medium",
        coherence: "high",
      },
      userEdited: {
        style: false,
        visual: false,
        editorial: false,
        flow: false,
        coverage: false,
        coherence: false,
      },
    });
    resetToConnect();
  });

  it("drives boot → Connect ok (hasClassification:false) → setup-1 → Continue → setup-2 → Save → tabs+Prompt", async () => {
    const user = userEvent.setup();

    const freshSnapshot = {
      name: "Wizard Walk",
      root: "/home/user/wizard-walk",
      hasClassification: false as const,
      hasProfile: false,
      classification: null,
      profile: null,
      artifacts: [],
      requirements: [],
    };

    const bridge = makeBridge();
    bridge.health = vi.fn().mockResolvedValue({ ok: true });
    bridge.connectProject = vi.fn().mockResolvedValue({ ok: true, snapshot: freshSnapshot });
    bridge.putClassification = vi.fn().mockResolvedValue({ ok: true });
    bridge.putProfile = vi.fn().mockResolvedValue({ ok: true });

    const bus = makeBus();

    await renderApp(bridge, bus);

    // Boot: connect screen visible, no tabs
    expect(screen.getByPlaceholderText("~/path/to/repo")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    // Type repo path (health check resolves in parallel)
    await user.type(screen.getByPlaceholderText("~/path/to/repo"), "/home/user/wizard-walk");

    // Wait for health check to enable the CTA (bridgeStatus → "running")
    const connectBtn = screen.getByRole("button", { name: /^Connect$/ });
    await waitFor(() => expect(connectBtn).not.toBeDisabled());

    // Click Connect → bridge.connectProject → connectSucceeded → setup-1
    await user.click(connectBtn);

    // Assert setup-1 DOM: heading for new project + Category chip group
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /This looks like a new project/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("group", { name: /Category/i })).toBeInTheDocument();

    // Continue — category "ecommerce" is pre-selected so canContinue is true
    const continueBtn = screen.getByRole("button", { name: /^Continue$/ });
    expect(continueBtn).not.toBeDisabled();
    await user.click(continueBtn);

    // Assert setup-2 DOM: "Generation defaults" heading
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Generation defaults/i }),
      ).toBeInTheDocument(),
    );

    // Click "Save & continue" → bridge.putProfile → goto("tabs")
    await user.click(screen.getByRole("button", { name: /Save/i }));

    // Assert tabs visible + Prompt tab active
    await waitFor(() =>
      expect(
        screen.getByRole("tablist", { name: "Panel tabs" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("tab", { name: "Generate" })).toHaveAttribute("data-state", "active");
  });
});

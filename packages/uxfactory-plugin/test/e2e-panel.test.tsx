// @vitest-environment jsdom
/**
 * e2e-panel.test.tsx — Lightweight integration smoke test for the App shell.
 *
 * Drives the full App component (real screens, real store) to verify that
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
import { render, screen, act, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useAppStore } from "../ui/stores/app.js";
import { App } from "../ui/app.js";
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

// ─── E2E: Connect → Tabs routing ─────────────────────────────────────────────

describe("E2E: panel lifecycle — connect screen to tabs", () => {
  beforeEach(resetToConnect);

  it("renders the Connect screen with repo-path input on initial load", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    expect(screen.getByPlaceholderText("~/path/to/repo")).toBeInTheDocument();
    // No tabs visible on connect screen
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("transitions to the Tabs screen when connectSucceeded is dispatched", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);

    // Verify we start on connect screen
    expect(screen.getByPlaceholderText("~/path/to/repo")).toBeInTheDocument();

    // Simulate successful connect (mirrors what Connect.tsx does on bridge success)
    act(() => {
      useAppStore.getState().connectSucceeded(DEMO_SNAPSHOT, "/home/user/demo-shop");
    });

    // Should now show the tab list
    expect(screen.getByRole("tablist", { name: "Panel tabs" })).toBeInTheDocument();
    // Connect input should be gone
    expect(screen.queryByPlaceholderText("~/path/to/repo")).not.toBeInTheDocument();
  });

  it("shows the project name in the ContextBar after successful connect", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);

    act(() => {
      useAppStore.getState().connectSucceeded(DEMO_SNAPSHOT, "/home/user/demo-shop");
    });

    expect(screen.getByText("Demo Shop")).toBeInTheDocument();
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

  it("renders all 6 tabs and Prompt is active by default", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    const tabList = screen.getByRole("tablist", { name: "Panel tabs" });
    expect(tabList).toBeInTheDocument();

    const tabs = ["Prompt", "Artifacts", "Components", "Assets", "Checks", "Settings"];
    for (const label of tabs) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: "Prompt" })).toHaveAttribute("data-state", "active");
  });

  it("clicking Artifacts tab makes it active and updates the store", async () => {
    const user = userEvent.setup();
    render(<App bridge={makeBridge()} bus={makeBus()} />);

    await user.click(screen.getByRole("tab", { name: "Artifacts" }));

    expect(screen.getByRole("tab", { name: "Artifacts" })).toHaveAttribute("data-state", "active");
    expect(useAppStore.getState().route.tab).toBe("artifacts");
  });

  it("clicking Settings tab makes it active", async () => {
    const user = userEvent.setup();
    render(<App bridge={makeBridge()} bus={makeBus()} />);

    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("data-state", "active");
    expect(useAppStore.getState().route.tab).toBe("settings");
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

  it("shows the Reconnecting status pill and Cancel button", () => {
    render(<App bridge={makeBridge()} bus={makeBus()} />);
    expect(screen.getByRole("status", { name: /Reconnecting/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel reconnect/i })).toBeInTheDocument();
  });

  it("Cancel routes back to connect screen and clears connection status", async () => {
    const user = userEvent.setup();
    render(<App bridge={makeBridge()} bus={makeBus()} />);

    await user.click(screen.getByRole("button", { name: /Cancel reconnect/i }));

    expect(useAppStore.getState().route.screen).toBe("connect");
    expect(useAppStore.getState().connection.status).toBe("none");
    // Reconnecting/Connected pill from ContextBar should be gone
    expect(screen.queryByRole("status", { name: /Reconnecting|Connected/i })).not.toBeInTheDocument();
    // Connect screen should be visible again
    expect(screen.getByPlaceholderText("~/path/to/repo")).toBeInTheDocument();
  });
});

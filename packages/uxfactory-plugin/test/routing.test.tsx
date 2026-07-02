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
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { render, screen, within, cleanup, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useAppStore } from "../ui/stores/app.js";
import { App } from "../ui/app.js";

afterEach(cleanup);

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

  it("renders the connect placeholder when screen is 'connect'", () => {
    render(<App />);
    expect(screen.getByText(/Connect arrives in a later task/i)).toBeInTheDocument();
  });

  it("shows the TitleBar with 'UXFactory (Developer VM)'", () => {
    render(<App />);
    expect(screen.getByText("UXFactory (Developer VM)")).toBeInTheDocument();
  });

  it("does not show the context bar on the plain connect screen", () => {
    render(<App />);
    // The context bar shows a project name + chips; these shouldn't appear
    // when we're at the connect screen with no snapshot.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// ─── Boot path: tabs (stored + classified) ────────────────────────────────────

describe("boot path — tabs (stored connection + classified project)", () => {
  beforeEach(() => resetToTabs(true));

  it("renders the tab list with all 6 tabs", () => {
    render(<App />);
    const tabList = screen.getByRole("tablist", { name: "Panel tabs" });
    const tabs = within(tabList).getAllByRole("tab");
    expect(tabs).toHaveLength(6);
  });

  it("renders the Prompt tab label", () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: "Prompt" })).toBeInTheDocument();
  });

  it("shows the context bar with StatusPill 'Connected'", () => {
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Connected");
  });

  it("shows the project name in the context bar", () => {
    render(<App />);
    expect(screen.getByText("Demo Shop")).toBeInTheDocument();
  });

  it("shows 'Prompt arrives in a later task' as the default active panel", () => {
    render(<App />);
    expect(screen.getByText(/Prompt arrives in a later task/i)).toBeInTheDocument();
  });
});

// ─── Reconnect-cancel path ────────────────────────────────────────────────────

describe("reconnect-cancel path", () => {
  beforeEach(resetToReconnecting);

  it("shows 'Reconnecting…' status pill when connection.status is reconnecting", () => {
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting");
  });

  it("shows a Cancel button during reconnect", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /Cancel reconnect/i })).toBeInTheDocument();
  });

  it("clicking Cancel routes to the connect screen", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Cancel reconnect/i }));

    // After cancel, route.screen should be "connect"
    expect(useAppStore.getState().route.screen).toBe("connect");
    // Connect placeholder should now be visible
    expect(screen.getByText(/Connect arrives in a later task/i)).toBeInTheDocument();
  });
});

// ─── Each tab click swaps placeholder ────────────────────────────────────────

describe("tab navigation swaps placeholder content", () => {
  beforeEach(() => resetToTabs(true));

  const tabs = [
    { label: "Prompt", placeholder: /Prompt arrives in a later task/i },
    { label: "Artifacts", placeholder: /Artifacts arrives in a later task/i },
    { label: "Components", placeholder: /Components arrives in a later task/i },
    { label: "Assets", placeholder: /Assets arrives in a later task/i },
    { label: "Checks", placeholder: /Checks arrives in a later task/i },
    { label: "Settings", placeholder: /Settings arrives in a later task/i },
  ] as const;

  for (const { label, placeholder } of tabs) {
    it(`clicking '${label}' shows the ${label} placeholder card`, async () => {
      const user = userEvent.setup();
      render(<App />);

      const tabEl = screen.getByRole("tab", { name: label });
      await user.click(tabEl);

      expect(screen.getByText(placeholder)).toBeInTheDocument();
    });
  }
});

// ─── Tab state is stored in the app store ────────────────────────────────────

describe("tab store binding", () => {
  beforeEach(() => resetToTabs(true));

  it("clicking a tab updates route.tab in the store", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Artifacts" }));
    expect(useAppStore.getState().route.tab).toBe("artifacts");
  });
});

// ─── Setup screens ────────────────────────────────────────────────────────────

describe("setup-1 screen placeholder", () => {
  it("renders the classification placeholder", () => {
    useAppStore.setState({
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/repo", mode: "local" },
      fileInfo: { name: "Test", fileKey: "k" },
      snapshot: null,
      route: { screen: "setup-1", tab: "prompt" },
      toasts: [],
    });
    render(<App />);
    expect(screen.getByText(/Classification.*arrives in a later task/i)).toBeInTheDocument();
  });
});

describe("setup-2 screen placeholder", () => {
  it("renders the generation defaults placeholder", () => {
    useAppStore.setState({
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/repo", mode: "local" },
      fileInfo: { name: "Test", fileKey: "k" },
      snapshot: null,
      route: { screen: "setup-2", tab: "prompt" },
      toasts: [],
    });
    render(<App />);
    expect(screen.getByText(/Generation Defaults.*arrives in a later task/i)).toBeInTheDocument();
  });
});

// ─── Toast system ────────────────────────────────────────────────────────────

describe("toast system", () => {
  beforeEach(resetToConnect);

  it("shows a toast message when one is added", () => {
    render(<App />);
    act(() => {
      useAppStore.getState().toast("Bridge not reachable");
    });
    expect(screen.getByText("Bridge not reachable")).toBeInTheDocument();
  });

  it("dismiss button removes the toast", async () => {
    const user = userEvent.setup();
    render(<App />);
    act(() => {
      useAppStore.getState().toast("Some message");
    });

    const dismissBtn = screen.getByRole("button", { name: /Dismiss: Some message/i });
    await user.click(dismissBtn);

    expect(screen.queryByText("Some message")).not.toBeInTheDocument();
  });
});

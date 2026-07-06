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
import { screen, act, cleanup, waitFor, within } from "@testing-library/react";
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
    toasts: [],
  });
}

// ─── renderApp helper: seed router from current store state ──────────────────

// Navigation is owned by the router — derive initial path from connection state.
function initialPathFromStore(): string {
  const { connection, snapshot } = useAppStore.getState();
  if (connection.status === "reconnecting") return "/connect";
  if (connection.status !== "connected") return "/connect";
  if (snapshot && !snapshot.hasClassification) return "/setup/classification";
  return "/tabs/prompt";
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
    const { router } = await renderApp();

    // Verify we start on connect screen
    expect(screen.getByPlaceholderText("~/path/to/repo")).toBeInTheDocument();

    // Simulate successful connect: store update + router navigation (mirrors Connect.tsx onSuccess).
    act(() => {
      useAppStore.getState().connectSucceeded(DEMO_SNAPSHOT, "/home/user/demo-shop");
    });
    await act(async () => { await router.navigate({ to: "/tabs/prompt" }); });

    await waitFor(() =>
      expect(screen.getByRole("tablist", { name: "Panel tabs" })).toBeInTheDocument(),
    );
    // Connect input should be gone
    expect(screen.queryByPlaceholderText("~/path/to/repo")).not.toBeInTheDocument();
  });

  it("shows the project name in the ContextBar after successful connect", async () => {
    const { router } = await renderApp();

    // Simulate successful connect: store update + router navigation (mirrors Connect.tsx onSuccess).
    act(() => {
      useAppStore.getState().connectSucceeded(DEMO_SNAPSHOT, "/home/user/demo-shop");
    });
    await act(async () => { await router.navigate({ to: "/tabs/prompt" }); });

    await waitFor(() =>
      expect(screen.getByText("Demo Shop")).toBeInTheDocument(),
    );
    expect(screen.getByRole("status", { name: "Connected" })).toBeInTheDocument();
  });
});

// ─── E2E: ContextBar name bar + chips bar ─────────────────────────────────────

describe("E2E: ContextBar shows project name with repo subtext and a compact chips bar", () => {
  // SnapshotSync refetches on mount and overwrites the store — the fake bridge
  // must serve the SAME snapshot the store is seeded with, or the chips vanish
  // as soon as an await lets the fetch land.
  function demoBridge(): Bridge {
    const bridge = makeBridge();
    (bridge.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue(DEMO_SNAPSHOT);
    return bridge;
  }

  beforeEach(() => {
    useAppStore.setState({
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/home/user/demo-shop", mode: "local" },
      // File name differs from snapshot.name (repo basename) to prove precedence.
      fileInfo: { name: "My Product", fileKey: "file-abc" },
      snapshot: DEMO_SNAPSHOT,
      toasts: [],
    });
  });

  it("shows the Figma file name as project name, repo path as subtext", async () => {
    await renderApp(demoBridge());
    expect(screen.getByText("My Product")).toBeInTheDocument();
    expect(screen.getByText("/home/user/demo-shop")).toBeInTheDocument();
  });

  it("collapsed bar shows the Project config label + one total-count chip", async () => {
    await renderApp(demoBridge());
    expect(screen.getByText("Project config:")).toBeInTheDocument();
    // No individual chips while collapsed — everything folds into the count
    // (8 = style, category, layout, industry, locale, age, 2 platforms).
    expect(screen.queryByText("ecommerce")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Style exploring" })).not.toBeInTheDocument();
    const overflow = screen.getByRole("checkbox", { name: "+7" });
    expect(overflow.className).toContain("text-[11px]");
    // The chips bar (not the name row) hosts the expand control.
    expect(
      screen.getByRole("button", { name: /Expand project details/i }),
    ).toBeInTheDocument();
  });

  it("+N click reveals every chip", async () => {
    const user = userEvent.setup();
    await renderApp(demoBridge());
    expect(screen.queryByText("corporate")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "+7" }));

    // Every chip carries its label, in the SAME order as project setup:
    // step-1 facts first, then step-2 generative defaults.
    const names = screen
      .getAllByRole("checkbox")
      .map((c) => c.getAttribute("aria-label") ?? c.textContent);
    expect(names).toEqual([
      "Category Ecommerce storefront",
      "Industry Consulting",
      "Locale en-US",
      "Platform desktop|mobile",
      "Layout responsive",
      "Age 18-39",
      "Style exploring",
    ]);
    expect(screen.queryByRole("checkbox", { name: "+7" })).not.toBeInTheDocument();
  });
});

// ─── E2E: ContextBar design-style chip + inline editor ────────────────────────

describe("E2E: design-style chip in the ContextBar opens an inline editor below it", () => {
  function demoBridge(snapshot: unknown = DEMO_SNAPSHOT): Bridge {
    const bridge = makeBridge();
    (bridge.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue(snapshot);
    return bridge;
  }

  beforeEach(() => {
    useAppStore.setState({
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/home/user/demo-shop", mode: "local" },
      fileInfo: { name: "My Product", fileKey: "file-abc" },
      snapshot: DEMO_SNAPSHOT,
      toasts: [],
    });
  });

  /** Chips fold into the +N count by default — reveal them first. */
  async function expandChips(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole("button", { name: /Expand project details/i }));
  }

  it("shows 'Style: exploring' when the project has no design-style default", async () => {
    const user = userEvent.setup();
    await renderApp(demoBridge());
    await expandChips(user);
    expect(screen.getByRole("checkbox", { name: "Style exploring" })).toBeInTheDocument();
  });

  it("shows the style label when a default is set", async () => {
    const user = userEvent.setup();
    const withStyle = {
      ...DEMO_SNAPSHOT,
      classification: { ...DEMO_SNAPSHOT.classification, designStyle: "flat" },
    };
    useAppStore.setState({ snapshot: withStyle as never });
    await renderApp(demoBridge(withStyle));
    await expandChips(user);
    expect(screen.getByRole("checkbox", { name: "Style Flat" })).toBeInTheDocument();
  });

  it("clicking the chip deploys the editor under the bar; Save merges designStyle into classification", async () => {
    const user = userEvent.setup();
    const bridge = demoBridge();
    await renderApp(bridge);

    await expandChips(user);
    await user.click(screen.getByRole("checkbox", { name: "Style exploring" }));
    const select = screen.getByLabelText("Project design style") as HTMLSelectElement;
    expect(select.value).toBe(""); // exploring
    await user.selectOptions(select, "flat");

    // The bridge serves the persisted state after save (what a real bridge does).
    (bridge.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...DEMO_SNAPSHOT,
      classification: { ...DEMO_SNAPSHOT.classification, designStyle: "flat" },
    });
    await user.click(screen.getByRole("button", { name: "Save style" }));

    await waitFor(() => expect(bridge.putClassification).toHaveBeenCalledOnce());
    expect(bridge.putClassification).toHaveBeenCalledWith({
      ...DEMO_SNAPSHOT.classification,
      designStyle: "flat",
    });
    // Editor closes; the chip reflects the new default.
    await waitFor(() =>
      expect(screen.queryByLabelText("Project design style")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Style Flat" })).toBeInTheDocument(),
    );
  });

  it("switching back to exploring saves classification WITHOUT designStyle", async () => {
    const user = userEvent.setup();
    const withStyle = {
      ...DEMO_SNAPSHOT,
      classification: { ...DEMO_SNAPSHOT.classification, designStyle: "flat" },
    };
    useAppStore.setState({ snapshot: withStyle as never });
    const bridge = demoBridge(withStyle);
    await renderApp(bridge);

    await expandChips(user);
    await user.click(screen.getByRole("checkbox", { name: "Style Flat" }));
    await user.selectOptions(screen.getByLabelText("Project design style"), "");
    await user.click(screen.getByRole("button", { name: "Save style" }));

    await waitFor(() => expect(bridge.putClassification).toHaveBeenCalledOnce());
    const body = (bridge.putClassification as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(body).not.toHaveProperty("designStyle");
  });

  it("Cancel closes the editor without saving", async () => {
    const user = userEvent.setup();
    const bridge = demoBridge();
    await renderApp(bridge);

    await expandChips(user);
    await user.click(screen.getByRole("checkbox", { name: "Style exploring" }));
    await user.selectOptions(screen.getByLabelText("Project design style"), "bento");
    await user.click(screen.getByRole("button", { name: "Cancel style edit" }));

    expect(bridge.putClassification).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Project design style")).not.toBeInTheDocument();
  });
});

// ─── E2E: every ContextBar chip is clickable and edits inline ─────────────────

describe("E2E: all project + generative chips in the ContextBar edit inline", () => {
  const DEMO_PROFILE = {
    scope: { visual: "high", editorial: "medium", coverage: "medium", flow: "low" },
    experimental: { coherence: "high" },
  };
  const FULL_SNAPSHOT = {
    ...DEMO_SNAPSHOT,
    classification: { ...DEMO_SNAPSHOT.classification, style: "formal" },
    profile: DEMO_PROFILE,
  };

  function fullBridge(): Bridge {
    const bridge = makeBridge();
    (bridge.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue(FULL_SNAPSHOT);
    return bridge;
  }

  beforeEach(() => {
    useAppStore.setState({
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/home/user/demo-shop", mode: "local" },
      fileInfo: { name: "My Product", fileKey: "file-abc" },
      snapshot: FULL_SNAPSHOT as never,
      toasts: [],
    });
  });

  it("generative default chips render alongside classification chips when expanded", async () => {
    const user = userEvent.setup();
    await renderApp(fullBridge());

    // Collapsed default: the label + one total chip covering EVERYTHING
    // (14 = style + category + layout + industry + locale + age + 2 platforms + 6 dials).
    expect(screen.getByText("Project config:")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "+13" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Tone Formal" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Expand project details/i }));

    expect(screen.getByRole("checkbox", { name: "Tone Formal" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Visual High" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Editorial Medium" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Flows Shallow" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Coverage Medium" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Coherence High" })).toBeInTheDocument();

    // Full order mirrors project setup: step-1 facts, then step-2 defaults.
    const prefixes = screen
      .getAllByRole("checkbox")
      .map((c) => (c.getAttribute("aria-label") ?? "").split(" ")[0]);
    expect(prefixes).toEqual([
      "Category", "Industry", "Locale", "Platform", "Layout", "Age",
      "Style", "Tone", "Visual", "Editorial", "Flows", "Coverage", "Coherence",
    ]);
  });

  it("clicking the category chip deploys its editor; Save merges into classification", async () => {
    const user = userEvent.setup();
    const bridge = fullBridge();
    await renderApp(bridge);

    await user.click(screen.getByRole("button", { name: /Expand project details/i }));
    const catChip = screen.getByRole("checkbox", { name: "Category Ecommerce storefront" });
    // Filled quietly by default: light gray backfill, no visible outline.
    expect(catChip.className).toContain("bg-gray-100");
    expect(catChip.className).toContain("border-gray-100");
    await user.click(catChip);
    // …and the chip being edited gets the primary border.
    expect(catChip.className).toContain("border-primary-600");
    // Every chip editor carries help text explaining what the field drives.
    expect(screen.getByText(/drives suggested styles/i)).toBeInTheDocument();
    // Grouped taxonomy droplist (legacy "ecommerce" normalizes on render);
    // the caption previews the selection's consequences before commit.
    const select = screen.getByLabelText("Category") as HTMLSelectElement;
    expect(select.value).toBe("ecommerce-storefront");
    expect(select.querySelectorAll("optgroup").length).toBe(8);
    await user.selectOptions(select, "dashboard-analytics");
    expect(screen.getByText(/Sets editorial low · activates dataviz/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save category" }));

    await waitFor(() => expect(bridge.putClassification).toHaveBeenCalledOnce());
    expect(bridge.putClassification).toHaveBeenCalledWith({
      ...FULL_SNAPSHOT.classification,
      category: "dashboard-analytics",
    });
  });

  it("clicking the Tone dial chip saves through the profile endpoint (style key)", async () => {
    const user = userEvent.setup();
    const bridge = fullBridge();
    await renderApp(bridge);

    await user.click(screen.getByRole("button", { name: /Expand project details/i }));
    await user.click(screen.getByRole("checkbox", { name: "Tone Formal" }));
    expect(screen.getByText(/voice of generated copy/i)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Informal" }));
    await user.click(screen.getByRole("button", { name: "Save tone" }));

    await waitFor(() => expect(bridge.putProfile).toHaveBeenCalledOnce());
    expect(bridge.putProfile).toHaveBeenCalledWith({ style: "informal" });
    expect(bridge.putClassification).not.toHaveBeenCalled();
  });

  it("clicking the Visual dial chip saves only that dial", async () => {
    const user = userEvent.setup();
    const bridge = fullBridge();
    await renderApp(bridge);

    await user.click(screen.getByRole("button", { name: /Expand project details/i }));
    await user.click(screen.getByRole("checkbox", { name: "Visual High" }));
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save visual" }));

    await waitFor(() => expect(bridge.putProfile).toHaveBeenCalledOnce());
    expect(bridge.putProfile).toHaveBeenCalledWith({ visual: "low" });
  });

  it("platform chips open a multi-select; Save writes the whole platforms array", async () => {
    const user = userEvent.setup();
    const bridge = fullBridge();
    await renderApp(bridge);

    await user.click(screen.getByRole("button", { name: /Expand project details/i }));
    await user.click(screen.getByRole("checkbox", { name: "Platform desktop|mobile" }));
    const group = screen.getByRole("toolbar", { name: "Platforms" });
    await user.click(within(group).getByRole("button", { name: "Tablet" }));
    await user.click(screen.getByRole("button", { name: "Save platforms" }));

    await waitFor(() => expect(bridge.putClassification).toHaveBeenCalledOnce());
    const body = (bridge.putClassification as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(body["platforms"]).toEqual(["desktop", "mobile", "tablet"]);
  });
});

// ─── E2E: Tab navigation ──────────────────────────────────────────────────────

describe("E2E: tab navigation after connect", () => {
  beforeEach(() => {
    useAppStore.setState({
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/home/user/demo-shop", mode: "local" },
      fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
      snapshot: DEMO_SNAPSHOT,
      toasts: [],
    });
  });

  it("renders the 5 tabs (Settings moved to the ContextBar) and Prompt is active by default", async () => {
    await renderApp();
    const tabList = screen.getByRole("tablist", { name: "Panel tabs" });
    expect(tabList).toBeInTheDocument();
    // The tab bar carries the primary background for emphasis.
    expect(tabList.className).toContain("bg-primary-600");

    const tabs = ["Generate", "Artifacts", "Components", "Assets", "Checks"];
    for (const label of tabs) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Generate" })).toHaveAttribute("data-state", "active");
  });

  it("clicking Artifacts tab makes it active and updates the router location", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.click(screen.getByRole("tab", { name: "Artifacts" }));

    expect(screen.getByRole("tab", { name: "Artifacts" })).toHaveAttribute("data-state", "active");
    await waitFor(() => expect(router.state.location.pathname).toBe("/tabs/artifacts"));
  });

  it("the ContextBar gear button opens Settings", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/tabs/settings"));
  });

  it("the connection indicator is an icon-only status (no text pill)", async () => {
    await renderApp();
    const indicator = screen.getByRole("status", { name: "Connected" });
    expect(indicator).toBeInTheDocument();
    expect(indicator).not.toHaveTextContent("Connected");
  });

  it("the queue icon shows the pending count and opens the Queue screen", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    (bridge as Bridge).listRenderQueue = vi.fn().mockResolvedValue({
      jobs: [
        { jobId: "pub_1", queuedAt: 1, frames: [] },
        { jobId: "pub_2", queuedAt: 2, frames: [] },
      ],
    });
    const { router } = await renderApp(bridge);

    const queueButton = await screen.findByRole("button", { name: "Render queue (2)" });
    await user.click(queueButton);

    await waitFor(() => expect(router.state.location.pathname).toBe("/tabs/queue"));
  });

  it("the Disconnect button clears the connection and returns to Connect", async () => {
    const user = userEvent.setup();
    const { router } = await renderApp();

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/connect"));
    expect(useAppStore.getState().connection.status).toBe("none");
  });
});

// ─── E2E: Reconnect / cancel flow ────────────────────────────────────────────

describe("E2E: reconnect then cancel", () => {
  beforeEach(() => {
    useAppStore.setState({
      connection: { status: "reconnecting", endpoint: "http://localhost:3779", repoPath: "/home/user/demo-shop", mode: "local" },
      fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
      snapshot: null,
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
    expect(screen.getByLabelText("Category")).toBeInTheDocument();

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

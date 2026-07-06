// @vitest-environment jsdom
/**
 * screen-prompt.test.tsx — RTL tests for the Prompt screen.
 *
 * Test names map 1-to-1 with PRD §6 acceptance criteria (AC-1 … AC-7).
 * Bridge and bus are always injected as fakes; no module-level mocks.
 *
 * Selector discipline: the component under test must NOT return object literals
 * from useAppStore / useRunsStore selectors — these tests indirectly verify that
 * constraint by confirming the component renders without infinite-update errors.
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
import type { Bridge, BridgeEvent, ProjectSnapshot } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";
import { useAppStore } from "../ui/stores/app.js";
import { useRunsStore, DEFAULT_DEVICE_CONFIG } from "../ui/stores/runs.js";
import { Prompt, UNIT_OPTIONS } from "../ui/screens/Prompt.js";
import { COMPONENT_TYPE_MAPPING } from "@uxfactory/spec";
import { renderWithProviders } from "./test-utils.js";

// ─── Snapshot factory ─────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    name: "Demo Shop",
    root: "/home/user/demo-shop",
    hasClassification: true,
    hasProfile: true,
    classification: {
      category: "ecommerce",
      industry: "retail",
      locale: "en-US",
      platforms: ["desktop", "mobile"],
      layout: "responsive",
    },
    profile: null,
    artifacts: [],
    requirements: [],
    ...overrides,
  };
}

// ─── Store reset helpers ──────────────────────────────────────────────────────

const BASE_APP_STATE = {
  connection: {
    status: "connected" as const,
    endpoint: "http://localhost:3779",
    repoPath: "/home/user/demo-shop",
    mode: "local" as const,
  },
  fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
  snapshot: makeSnapshot(),
  toasts: [],
};

function resetStores(snapshotOverride?: Partial<ProjectSnapshot>) {
  useAppStore.setState({
    ...BASE_APP_STATE,
    snapshot: snapshotOverride !== undefined
      ? makeSnapshot(snapshotOverride)
      : makeSnapshot(),
  });
  useRunsStore.setState({
    runs: [],
    composerUnitType: "page",
    composerPlatforms: [],
    composerVariations: 1,
    composerFidelity: "medium",
    composerDesignStyle: "",
    deviceConfig: DEFAULT_DEVICE_CONFIG,
  });
}

beforeEach(() => resetStores());
afterEach(cleanup);

// ─── Fake bridge factory ──────────────────────────────────────────────────────

type EventCallback = (ev: BridgeEvent) => void;

function makeBridge(overrides: Partial<Bridge> = {}): {
  bridge: Bridge;
  fireEvent: (ev: BridgeEvent) => void;
} {
  let capturedCb: EventCallback | null = null;
  const teardown = vi.fn();

  const bridge: Bridge = {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi.fn().mockResolvedValue({ ok: true, snapshot: makeSnapshot() }),
    snapshot: vi.fn().mockResolvedValue(makeSnapshot()),
    putClassification: vi.fn().mockResolvedValue({ ok: true }),
    putProfile: vi.fn().mockResolvedValue({ ok: true }),
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    stats: vi.fn().mockResolvedValue({ version: "0.0.0", uptimeMs: 0, runsRelayed: 0, tokenCount: null }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
    enqueue: vi.fn().mockResolvedValue({ id: "run-001" }),
    events: vi.fn().mockImplementation((cb: EventCallback) => {
      capturedCb = cb;
      return teardown;
    }),
    latestRender: vi.fn().mockResolvedValue(null),
    verify: vi.fn().mockResolvedValue(null),
    ...overrides,
  };

  return {
    bridge,
    fireEvent: (ev: BridgeEvent) => {
      if (capturedCb) capturedCb(ev);
    },
  };
}

// ─── Fake bus factory ─────────────────────────────────────────────────────────

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

// ─── AC-1: Submit enqueues exact payload + adds generating row + clears composer ──

/** The generate config is collapsed by default — reveal it before touching controls. */
async function openConfig(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Generate config" }));
}

describe("AC-1: submit enqueues exact payload, adds generating row, clears textarea", () => {
  it("calls bridge.enqueue with correct kind/payload and a generating row appears", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    // Type a prompt
    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    await user.type(textarea, "An order-confirmation page with delivery tracking");

    // Submit
    await user.click(screen.getByRole("button", { name: "Generate design" }));

    // bridge.enqueue called with correct shape
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-design",
      payload: {
        prompt: "An order-confirmation page with delivery tracking",
        unitType: "page",
        platforms: expect.arrayContaining(["desktop", "mobile"]),
        ungoverned: true,
      },
    });

    // A "generating" row appears in the RECENT list
    await waitFor(() =>
      expect(screen.getByText("An order-confirmation page with delivery tracking")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("generating")).toBeInTheDocument();

    // Textarea is cleared
    expect(textarea).toHaveValue("");
  });

  it("textarea is cleared but unit type chip keeps its value", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    await user.type(textarea, "A hero section");
    await user.click(screen.getByRole("button", { name: "Generate design" }));

    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());

    // Textarea cleared
    expect(textarea).toHaveValue("");

    // Unit type select still shows its value
    const unitSelect = screen.getByLabelText("Unit type") as HTMLSelectElement;
    expect(unitSelect.value).toBe("page");
  });

  it("submit button is disabled when textarea is empty", async () => {
    const { bridge } = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(screen.getByRole("button", { name: "Generate design" })).toBeDisabled();
  });
});

// ─── AC-2: Completion event → ✓ checked + View switches to Checks tab ────────

describe("AC-2: completion event flips row to checked; View → checks tab", () => {
  it("complete event with outcome=checked marks row as ✓ checked", async () => {
    const user = userEvent.setup();
    const { bridge, fireEvent } = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    // Submit a prompt
    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Homepage redesign");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());

    // Fire completion event
    act(() => {
      fireEvent({
        requestId: "run-001",
        event: { type: "complete", outcome: "checked" },
        seq: 1,
      });
    });

    // Row should now show ✓ checked
    await waitFor(() =>
      expect(screen.getByLabelText("checked")).toBeInTheDocument(),
    );
  });

  it("View button navigates to /tabs/checks?run= and selects nodes on canvas", async () => {
    const user = userEvent.setup();
    const { bridge, fireEvent } = makeBridge();
    const bus = makeBus();

    const { router } = await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    // Submit
    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Product page");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());

    // Complete the run (landing report carries node ids)
    act(() => {
      fireEvent({
        requestId: "run-001",
        event: { type: "complete", outcome: "checked", nodeIds: ["12:1", "12:2"] },
        seq: 1,
      });
    });
    await waitFor(() => expect(screen.getByLabelText("checked")).toBeInTheDocument());

    // Completion event stored the landing-report node ids on the run entry
    expect(
      useRunsStore.getState().runs.find((r) => r.id === "run-001")?.nodeIds,
    ).toEqual(["12:1", "12:2"]);

    // Click View
    await user.click(screen.getByRole("button", { name: "View" }));

    // Router navigates to /tabs/checks with run search param
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tabs/checks");
      expect(router.state.location.search).toEqual({ run: "run-001" });
    });
  });
});

// ─── AC-3: Warnings mapping with count ───────────────────────────────────────

describe("AC-3: warnings mapping — N warnings shown where N = open findings count", () => {
  it("completion event with status=warnings shows correct count", async () => {
    const user = userEvent.setup();
    const { bridge, fireEvent } = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Cart page");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());

    // Fire completion with warnings
    act(() => {
      fireEvent({
        requestId: "run-001",
        event: {
          type: "complete",
          outcome: "warnings",
          warnings: ["contrast.text-min", "a11y.hit-target"],
        },
        seq: 1,
      });
    });

    // Should show "2 warnings"
    await waitFor(() =>
      expect(screen.getByLabelText("2 warnings")).toBeInTheDocument(),
    );
  });

  it("outcome=failed maps to failed status", async () => {
    const user = userEvent.setup();
    const { bridge, fireEvent } = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "A broken run");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());

    act(() => {
      fireEvent({
        requestId: "run-001",
        event: { type: "complete", outcome: "failed" },
        seq: 1,
      });
    });

    await waitFor(() =>
      expect(screen.getByLabelText("failed")).toBeInTheDocument(),
    );
  });

  it("events for unknown run IDs are silently ignored", async () => {
    const user = userEvent.setup();
    const { bridge, fireEvent } = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Test run");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());

    // Fire event for a different run ID
    act(() => {
      fireEvent({
        requestId: "run-unknown",
        event: { type: "complete", outcome: "checked" },
        seq: 1,
      });
    });

    // The "generating" row should still be there (not flipped)
    await waitFor(() =>
      expect(screen.getByLabelText("generating")).toBeInTheDocument(),
    );
  });
});

// ─── AC-4: Grounding chips reflect artifact freshness + click → artifacts tab ─

describe("AC-4: grounding chips reflect artifact freshness; clicking chip → artifacts tab", () => {
  it("up-to-date artifact shows ✓ green chip", async () => {
    useAppStore.setState({
      ...BASE_APP_STATE,
      snapshot: makeSnapshot({
        artifacts: [
          {
            key: "requirements",
            group: "product",
            label: "Requirements",
            status: "up-to-date",
            meta: "",
            path: null,
          },
        ],
      }),
    });

    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(screen.getByLabelText("Requirements — up to date")).toBeInTheDocument();
  });

  it("draft artifact shows ! amber chip", async () => {
    useAppStore.setState({
      ...BASE_APP_STATE,
      snapshot: makeSnapshot({
        artifacts: [
          {
            key: "brand-colors",
            group: "design",
            label: "Brand colors",
            status: "draft",
            meta: "",
            path: null,
          },
        ],
      }),
    });

    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(screen.getByLabelText("Brand colors — draft")).toBeInTheDocument();
  });

  it("missing REQUIRED artifact shows the distinct required-missing chip", async () => {
    // Default snapshot has no artifacts → all missing. For the default "page"
    // type, Requirements is a REQUIRED registered artifact.
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(screen.getByLabelText("Requirements — required, missing")).toBeInTheDocument();
    // Recommended registered artifacts keep the soft missing treatment.
    expect(
      screen.getByLabelText("Tokens — missing, generation proceeds with defaults"),
    ).toBeInTheDocument();
  });

  it("grounding chip click navigates to /tabs/artifacts?focus=<key>", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    const { router } = await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    await user.click(screen.getByLabelText("Requirements — required, missing"));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tabs/artifacts");
      expect(router.state.location.search).toEqual({ focus: "requirements" });
    });
  });

  it("planned artifacts render as disabled coming-soon chips", async () => {
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    const stories = screen.getByLabelText("Stories — coming soon");
    expect(stories).toBeDisabled();
    expect(screen.getByLabelText("Typography — coming soon")).toBeDisabled();
  });

  it("chips are type-aware: the channel surface swaps the requirement set", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    await user.selectOptions(screen.getByLabelText("Unit type"), "x-post");

    // Channel types hinge on the creative brief, not ACs.
    expect(screen.queryByLabelText(/Requirements —/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Creative brief — coming soon")).toBeDisabled();
    expect(screen.getByLabelText("Brand colors — required, missing")).toBeInTheDocument();
    // x-post requires no grid/icons.
    expect(screen.queryByLabelText(/Grid —/)).not.toBeInTheDocument();
  });

  it("optional artifacts appear only when they exist", async () => {
    // page → reference-set optional+planned: never shown. illustrations is not
    // in page's requires at all; brand-usage optional on home-page only shows
    // when registered — planned, so never. Assert the optional-planned drop:
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    expect(screen.queryByLabelText(/Reference set/)).not.toBeInTheDocument();
  });

  it("unit-type ids stay in sync with the spec mapping", () => {
    expect(UNIT_OPTIONS.map((o) => o.value).sort()).toEqual(
      Object.keys(COMPONENT_TYPE_MAPPING).sort(),
    );
  });
});

// ─── Ungoverned drafts: missing blocking requirements annotate the run ────────

describe("ungoverned draft annotation", () => {
  it("submitting with missing required artifacts adds ungoverned:true + a hint", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(screen.getByText(/required artifacts? missing/i)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "A page");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
    const body = (bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      payload: Record<string, unknown>;
    };
    expect(body.payload["ungoverned"]).toBe(true);
  });

  it("with every blocking requirement satisfied the wire stays clean", async () => {
    const satisfied = (key: string, group: string) => ({
      key, group, label: key, status: "up-to-date" as const, meta: "", path: null,
    });
    useAppStore.setState({
      ...BASE_APP_STATE,
      snapshot: makeSnapshot({
        artifacts: [
          satisfied("requirements", "product"),
          satisfied("brand-colors", "design"),
          satisfied("fonts", "design"),
          satisfied("grid", "design"),
        ],
      }),
    });
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(screen.queryByText(/required artifacts? missing/i)).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "A page");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
    const body = (bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      payload: Record<string, unknown>;
    };
    expect(body.payload).not.toHaveProperty("ungoverned");
  });
});

// ─── AC-5: Empty-artifacts callout renders + generation still enqueues ────────

describe("AC-5: zero-artifacts callout renders; generation proceeds with defaults", () => {
  it("renders the callout when all grounding artifacts are missing", async () => {
    // Default snapshot has no artifacts
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(
      screen.getByText(/No artifacts yet — designs will use generation defaults only/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create artifacts →" })).toBeInTheDocument();
  });

  it("'Create artifacts →' button navigates to the artifacts tab", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    const { router } = await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    await user.click(screen.getByRole("button", { name: "Create artifacts →" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tabs/artifacts");
    });
  });

  it("callout does NOT block submission — generation still enqueues", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    // Callout is visible
    expect(
      screen.getByText(/No artifacts yet/),
    ).toBeInTheDocument();

    // Submit still works
    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Defaults-only run");
    await user.click(screen.getByRole("button", { name: "Generate design" }));

    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
    expect(bridge.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "generate-design" }),
    );
  });

  it("callout is absent when at least one artifact has a non-missing status", async () => {
    useAppStore.setState({
      ...BASE_APP_STATE,
      snapshot: makeSnapshot({
        artifacts: [
          {
            key: "requirements",
            group: "product",
            label: "Requirements",
            status: "up-to-date",
            meta: "",
            path: null,
          },
        ],
      }),
    });

    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(
      screen.queryByText(/No artifacts yet/),
    ).not.toBeInTheDocument();
  });
});

// ─── AC-6: SSE teardown on unmount ───────────────────────────────────────────

describe("AC-6: SSE subscription tears down on unmount", () => {
  it("bridge.events teardown is called when the component unmounts", async () => {
    const teardownFn = vi.fn();
    const { bridge } = makeBridge({
      events: vi.fn().mockReturnValue(teardownFn),
    });
    const bus = makeBus();

    const { unmount } = await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(bridge.events).toHaveBeenCalledOnce();
    expect(teardownFn).not.toHaveBeenCalled();

    unmount();

    expect(teardownFn).toHaveBeenCalledOnce();
  });
});

// ─── AC-7: Composer chip state persists across remount ───────────────────────

describe("AC-7: composer chip state persists across tab switches (remounts)", () => {
  it("unit type selection survives unmount + remount within session", async () => {
    // Seed the runs store with a non-default unit type (simulating user already changed it)
    useRunsStore.setState({
      runs: [],
      composerUnitType: "molecule",
      composerPlatforms: [],
    });

    const { bridge } = makeBridge();
    const bus = makeBus();

    // First mount
    const { unmount } = await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();
    const select = screen.getByLabelText("Unit type") as HTMLSelectElement;
    expect(select.value).toBe("molecule");

    unmount();

    // Second mount — store state is preserved
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();
    const select2 = screen.getByLabelText("Unit type") as HTMLSelectElement;
    expect(select2.value).toBe("molecule");
  });

  it("viewport selection survives unmount + remount", async () => {
    // Seed store: only "mobile" selected
    useRunsStore.setState({
      runs: [],
      composerUnitType: "page",
      composerPlatforms: ["mobile"],
    });

    const { bridge } = makeBridge();
    const bus = makeBus();

    const { unmount } = await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    // Verify stored viewport is shown on the trigger
    expect(screen.getByRole("button", { name: "Viewports" })).toHaveTextContent("Mobile portrait");

    unmount();

    // Remount — store unchanged
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();
    expect(screen.getByRole("button", { name: "Viewports" })).toHaveTextContent("Mobile portrait");
  });

  it("setComposerState updates the store and both selects reflect the change", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();

    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    const unitSelect = screen.getByLabelText("Unit type") as HTMLSelectElement;
    await user.selectOptions(unitSelect, "organism");

    expect(useRunsStore.getState().composerUnitType).toBe("organism");
  });
});

// ─── Enqueue failure — toast + composer preserved + no phantom row ───────────

describe("enqueue rejection: toast shown, composer preserved, no run row added", () => {
  it("rejected enqueue shows the bridge toast and keeps the composer text", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge({
      enqueue: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    const bus = makeBus();

    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    await user.type(textarea, "A run that cannot be enqueued");
    await user.click(screen.getByRole("button", { name: "Generate design" }));

    // Toast surfaces the failure
    await waitFor(() =>
      expect(
        useAppStore
          .getState()
          .toasts.some(
            (t) => t.message === "Generation failed to enqueue — is the bridge running?",
          ),
      ).toBe(true),
    );

    // Composer text is preserved for retry
    expect(textarea).toHaveValue("A run that cannot be enqueued");

    // No phantom run row was added
    expect(useRunsStore.getState().runs).toHaveLength(0);
    expect(screen.queryByLabelText("generating")).not.toBeInTheDocument();

    // Submit is re-enabled after the failure
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Generate design" })).toBeEnabled(),
    );
  });
});

// ─── Platform sentinel — "__all__" stored as [] and expanded at submit ───────

describe("platform sentinel: __all__ stores [] and expands at submit", () => {
  it("toggling a viewport checkbox stores the explicit list", async () => {
    const user = userEvent.setup();
    // Seed a concrete viewport so toggling another is a real change.
    useRunsStore.setState({
      runs: [],
      composerUnitType: "page",
      composerPlatforms: ["mobile"],
    });

    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    await user.click(screen.getByRole("button", { name: "Viewports" }));
    await user.click(screen.getByRole("checkbox", { name: "Desktop" }));

    // Explicit list in fixed option order; the bare seeded "mobile" normalizes
    // to its portrait variant on the first explicit toggle.
    expect(useRunsStore.getState().composerPlatforms).toEqual(["desktop", "mobile-portrait"]);
  });

  it("submit expands the [] sentinel to the classification platforms", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    // Default composerPlatforms is [] (the __all__ sentinel)
    expect(useRunsStore.getState().composerPlatforms).toEqual([]);

    await user.type(
      screen.getByRole("textbox", { name: "Prompt" }),
      "All-platform run",
    );
    await user.click(screen.getByRole("button", { name: "Generate design" }));

    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-design",
      payload: {
        prompt: "All-platform run",
        unitType: "page",
        platforms: ["desktop", "mobile"],
        ungoverned: true,
      },
    });
  });
});

// ─── Composer: viewports, orientation, variations, fidelity ──────────────────

describe("composer: viewports, orientation, variations, fidelity", () => {
  it("viewport popup offers device×orientation combos; trigger shows all selected", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    const trigger = screen.getByRole("button", { name: "Viewports" });
    // Default [] sentinel → classification platforms (desktop, mobile),
    // bare tokens normalize to the portrait variant for display.
    expect(trigger).toHaveTextContent("Desktop + Mobile portrait");

    await user.click(trigger);
    expect(screen.getByRole("checkbox", { name: "Desktop" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Tablet portrait" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Tablet landscape" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Mobile portrait" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Mobile landscape" })).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Tablet landscape" }));
    expect(useRunsStore.getState().composerPlatforms).toEqual([
      "desktop",
      "tablet-landscape",
      "mobile-portrait",
    ]);
    expect(trigger).toHaveTextContent("Desktop + Tablet landscape + Mobile portrait");
  });

  it("viewport rows show true dimensions per device×orientation", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    await user.click(screen.getByRole("button", { name: "Viewports" }));
    expect(screen.getByText("1440×900")).toBeInTheDocument();
    expect(screen.getByText("768×1024")).toBeInTheDocument();
    expect(screen.getByText("1024×768")).toBeInTheDocument();
    expect(screen.getByText("390×844")).toBeInTheDocument();
    expect(screen.getByText("844×390")).toBeInTheDocument();
  });

  it("viewport dims follow the configured devices; custom sizes ride the payload", async () => {
    const user = userEvent.setup();
    useRunsStore.setState({
      deviceConfig: {
        ...DEFAULT_DEVICE_CONFIG,
        mobile: { name: "iPhone Pro Max", width: 430, height: 932 },
      },
    });
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    await user.click(screen.getByRole("button", { name: "Viewports" }));
    // Portrait uses the configured size; landscape swaps it.
    expect(screen.getByText("430×932")).toBeInTheDocument();
    expect(screen.getByText("932×430")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Checkout page");
    await user.click(screen.getByRole("button", { name: "Generate design" }));

    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-design",
      payload: {
        prompt: "Checkout page",
        unitType: "page",
        platforms: ["desktop", "mobile"],
        viewportSizes: {
          desktop: "1440x900",
          tablet: "768x1024",
          mobile: "430x932",
        },
        ungoverned: true,
      },
    });
  });

  it("exploring project: the style select leads with 'Exploring'; default stays off the wire", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    const select = screen.getByLabelText("Design style") as HTMLSelectElement;
    expect(select.options).toHaveLength(37); // sentinel + 36 styles
    // No project default exists — the sentinel says so instead of implying one.
    expect(select.options[0]!.textContent).toBe("Exploring");
    expect(select.value).toBe("");
    // Same grouped droplist as the ContextBar style editor: 6 categories.
    const groups = Array.from(select.querySelectorAll("optgroup")).map((g) => g.label);
    expect(groups).toEqual([
      "Core styles",
      "Core digital paradigms",
      "Modern & dimensional",
      "Nostalgic & retro",
      "Artistic & cultural",
      "Thematic & niche",
    ]);
    // ecommerce → Flat carries the suggestion marker here too.
    expect(
      Array.from(select.options).some((o) => /^Flat \(suggested\)$/.test(o.textContent ?? "")),
    ).toBe(true);

    // Default submits WITHOUT a designStyle key (legacy wire).
    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "A page");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
    const body = (bridge.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      payload: Record<string, unknown>;
    };
    expect(body.payload).not.toHaveProperty("designStyle");
  });

  it("project WITH a style default: sentinel names it and 'Exploring' is not offered", async () => {
    resetStores({
      classification: {
        category: "ecommerce",
        industry: "corporate",
        platforms: ["desktop"],
        designStyle: "flat",
      },
    });
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    const select = screen.getByLabelText("Design style") as HTMLSelectElement;
    expect(select.options).toHaveLength(37); // sentinel + 36 styles
    expect(select.options[0]!.textContent).toBe("Default — Flat");
    expect(select.value).toBe("");
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).not.toContain("Exploring");
    expect(select.querySelectorAll("optgroup")).toHaveLength(6);
  });

  it("a picked style overrides the project default on the wire", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    await user.selectOptions(screen.getByLabelText("Design style"), "cyberpunk");
    expect(useRunsStore.getState().composerDesignStyle).toBe("cyberpunk");

    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "A dashboard");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-design",
      payload: {
        prompt: "A dashboard",
        unitType: "page",
        platforms: ["desktop", "mobile"],
        designStyle: "cyberpunk",
        ungoverned: true,
      },
    });
  });

  it("defaults to Desktop when nothing resolves selected (no classification platforms)", async () => {
    const user = userEvent.setup();
    resetStores({
      classification: {
        category: "ecommerce",
        industry: "retail",
        locale: "en-US",
        platforms: [],
        layout: "responsive",
      },
    });
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    const trigger = screen.getByRole("button", { name: "Viewports" });
    expect(trigger).toHaveTextContent("Desktop");

    await user.click(trigger);
    expect(screen.getByRole("checkbox", { name: "Desktop" })).toBeChecked();

    // Submit carries the Desktop default instead of an empty platforms list.
    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "A pricing page");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-design",
      payload: { prompt: "A pricing page", unitType: "page", platforms: ["desktop"], ungoverned: true },
    });
  });

  it("the last checked viewport cannot be unchecked", async () => {
    const user = userEvent.setup();
    useRunsStore.setState({ runs: [], composerUnitType: "page", composerPlatforms: ["tablet"] });
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    await user.click(screen.getByRole("button", { name: "Viewports" }));
    expect(screen.getByRole("checkbox", { name: "Tablet portrait" })).toBeDisabled();
  });

  it("variations and fidelity selectors render with their options", async () => {
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    // Orientation is part of the viewport combos — no standalone selector.
    expect(screen.queryByLabelText("Orientation")).not.toBeInTheDocument();

    const variations = screen.getByLabelText("Variations") as HTMLSelectElement;
    expect(Array.from(variations.options).map((o) => o.value)).toEqual(["1", "2", "3"]);
    expect(variations.value).toBe("1");

    const fidelity = screen.getByLabelText("Fidelity") as HTMLSelectElement;
    expect(Array.from(fidelity.options).map((o) => o.value)).toEqual(["low", "medium", "high"]);
    // Fidelity speaks design language, not dial language.
    expect(Array.from(fidelity.options).map((o) => o.textContent)).toEqual([
      "Wireframe",
      "Mockup",
      "Hi-fi",
    ]);
    expect(fidelity.value).toBe("medium");
  });

  it("combined viewports, variations, and fidelity ride the enqueue payload", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    await user.click(screen.getByRole("button", { name: "Viewports" }));
    await user.click(screen.getByRole("checkbox", { name: "Mobile landscape" }));
    await user.selectOptions(screen.getByLabelText("Variations"), "2");
    await user.selectOptions(screen.getByLabelText("Fidelity"), "low");
    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Hero section");
    await user.click(screen.getByRole("button", { name: "Generate design" }));

    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
    expect(bridge.enqueue).toHaveBeenCalledWith({
      kind: "generate-design",
      payload: {
        prompt: "Hero section",
        unitType: "page",
        platforms: ["desktop", "mobile-portrait", "mobile-landscape"],
        variations: 2,
        fidelity: "low",
        ungoverned: true,
      },
    });
  });

  it("high fidelity is disabled when multiple variations are set; a set high clamps to medium", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    const fidelity = screen.getByLabelText("Fidelity") as HTMLSelectElement;
    const highOption = Array.from(fidelity.options).find((o) => o.value === "high")!;

    // Single variation → high selectable
    expect(highOption.disabled).toBe(false);
    await user.selectOptions(fidelity, "high");
    expect(useRunsStore.getState().composerFidelity).toBe("high");

    // Multiple variations → high disabled AND the stored high clamps to medium
    await user.selectOptions(screen.getByLabelText("Variations"), "3");
    expect(highOption.disabled).toBe(true);
    expect(useRunsStore.getState().composerFidelity).toBe("medium");
    expect(fidelity.value).toBe("medium");
  });
});

// ─── Composer: user-flow interaction rules ────────────────────────────────────

describe("composer: user-flow unit forces single viewport and no variations", () => {
  it("selecting user-flow disables variations and clamps a multi-variation value to 1", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    await user.selectOptions(screen.getByLabelText("Variations"), "3");
    await user.selectOptions(screen.getByLabelText("Unit type"), "user-flow");

    const variations = screen.getByLabelText("Variations") as HTMLSelectElement;
    expect(variations).toBeDisabled();
    expect(useRunsStore.getState().composerVariations).toBe(1);
  });

  it("selecting user-flow clamps a multi-viewport selection to the first", async () => {
    const user = userEvent.setup();
    // Default [] sentinel → classification desktop+mobile
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    await user.selectOptions(screen.getByLabelText("Unit type"), "user-flow");

    expect(useRunsStore.getState().composerPlatforms).toEqual(["desktop"]);
    expect(screen.getByRole("button", { name: "Viewports" })).toHaveTextContent("Desktop");
  });

  it("under user-flow the viewport popup is single-select: picking one replaces the selection", async () => {
    const user = userEvent.setup();
    useRunsStore.setState({
      runs: [],
      composerUnitType: "user-flow",
      composerPlatforms: ["desktop"],
      composerVariations: 1,
    });
    const { bridge } = makeBridge();
    await renderWithProviders(<Prompt bridge={bridge} bus={makeBus()} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    await user.click(screen.getByRole("button", { name: "Viewports" }));
    await user.click(screen.getByRole("checkbox", { name: "Tablet landscape" }));

    expect(useRunsStore.getState().composerPlatforms).toEqual(["tablet-landscape"]);
    expect(screen.getByRole("button", { name: "Viewports" })).toHaveTextContent("Tablet landscape");
  });
});

// ─── Footer hint ─────────────────────────────────────────────────────────────

describe("Footer hint line", () => {
  it("renders the verbatim footer hint", async () => {
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(
      screen.getByText(
        "Generates on canvas using your artifacts & generation defaults.",
      ),
    ).toBeInTheDocument();
  });

  it("composer placeholder invites describing component(s)", async () => {
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    expect(
      screen.getByPlaceholderText("Describe the component(s) to generate"),
    ).toBeInTheDocument();
  });

  it("unit type droplist: flow/page tiers on top, Atom at the end", async () => {
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    const select = screen.getByRole("combobox", { name: "Unit type" });
    const labels = Array.from(select.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(labels).toEqual([
      "User Flow",
      "Home Page",
      "Secondary Page",
      "Tertiary Page",
      "Page",
      "Template",
      "Organism",
      "Molecule",
      "Atom",
      "Email",
      "Instagram Post",
      "Instagram Story",
      "YouTube Thumbnail",
      "Facebook Post",
      "X Post",
    ]);
  });
});

// ─── Generate config column — hidden by default, revealed by the Config chip ──

describe("Generate config column", () => {
  it("hides all five config controls until the Config chip is clicked, then stacks them; clicking again hides", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    // Collapsed default: just the toggle chip alongside the prompt input.
    expect(screen.queryByLabelText("Unit type")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Viewports" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Variations")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fidelity")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Design style")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Generate config" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Config column sits on the RIGHT of the prompt input (textarea first in DOM).
    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    expect(
      textarea.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Unit type")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Viewports" })).toBeInTheDocument();
    expect(screen.getByLabelText("Variations")).toBeInTheDocument();
    expect(screen.getByLabelText("Fidelity")).toBeInTheDocument();
    expect(screen.getByLabelText("Design style")).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByLabelText("Unit type")).not.toBeInTheDocument();
  });

  it("stacked config controls share one width (uniform column)", async () => {
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    const controls = [
      screen.getByLabelText("Unit type"),
      screen.getByRole("button", { name: "Viewports" }),
      screen.getByLabelText("Variations"),
      screen.getByLabelText("Fidelity"),
      screen.getByLabelText("Design style"),
    ];
    for (const control of controls) {
      // Selects live inside a pill wrapper that carries the shared sizing.
      const pill = control.tagName === "SELECT" ? control.parentElement! : control;
      expect(pill.className).toContain("w-full");
      // Compact sizing — matches the ContextBar's sm project-config chips.
      expect(pill.className).toContain("text-[11px]");
    }
  });

  it("each droplist shows its type label next to the selection", async () => {
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await openConfig();

    for (const label of ["Type", "Viewports", "Variations", "Fidelity", "Style"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Variations shows just the count next to its label.
    const variations = screen.getByLabelText("Variations") as HTMLSelectElement;
    expect(Array.from(variations.options).map((o) => o.textContent)).toEqual(["1", "2", "3"]);
  });

  it("submit works without ever opening the config (defaults apply)", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "A pricing page");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());
  });
});

// ─── Grounding chips follow the authoring (supply) order ──────────────────────

describe("grounding chips are listed in supply order", () => {
  it("page chips run intent → design system → assets → content", async () => {
    const { bridge } = makeBridge();
    const bus = makeBus();
    await renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });

    const section = screen.getByText("GROUNDED IN").parentElement!;
    const labels = Array.from(section.querySelectorAll("button"))
      .map((b) => (b.getAttribute("aria-label") ?? "").split(" — ")[0])
      .filter((l) => l !== "");
    expect(labels).toEqual([
      "Stories", "Requirements", "A11y spec", "Brand colors", "Fonts",
      "Typography", "Grid", "Tokens", "Glossary", "Interaction states",
      "Icons", "Copy deck",
    ]);
  });
});

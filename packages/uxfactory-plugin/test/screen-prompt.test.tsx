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
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Bridge, BridgeEvent, ProjectSnapshot } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";
import { useAppStore } from "../ui/stores/app.js";
import { useRunsStore } from "../ui/stores/runs.js";
import { Prompt } from "../ui/screens/Prompt.js";

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
  route: { screen: "tabs" as const, tab: "prompt" as const },
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
  };
}

// ─── AC-1: Submit enqueues exact payload + adds generating row + clears composer ──

describe("AC-1: submit enqueues exact payload, adds generating row, clears textarea", () => {
  it("calls bridge.enqueue with correct kind/payload and a generating row appears", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();

    render(<Prompt bridge={bridge} bus={bus} />);

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

    render(<Prompt bridge={bridge} bus={bus} />);

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

  it("submit button is disabled when textarea is empty", () => {
    const { bridge } = makeBridge();
    const bus = makeBus();

    render(<Prompt bridge={bridge} bus={bus} />);

    expect(screen.getByRole("button", { name: "Generate design" })).toBeDisabled();
  });
});

// ─── AC-2: Completion event → ✓ checked + View switches to Checks tab ────────

describe("AC-2: completion event flips row to checked; View → checks tab", () => {
  it("complete event with outcome=checked marks row as ✓ checked", async () => {
    const user = userEvent.setup();
    const { bridge, fireEvent } = makeBridge();
    const bus = makeBus();

    render(<Prompt bridge={bridge} bus={bus} />);

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

  it("View button switches the active tab to checks", async () => {
    const user = userEvent.setup();
    const { bridge, fireEvent } = makeBridge();
    const bus = makeBus();

    render(<Prompt bridge={bridge} bus={bus} />);

    // Submit
    await user.type(screen.getByRole("textbox", { name: "Prompt" }), "Product page");
    await user.click(screen.getByRole("button", { name: "Generate design" }));
    await waitFor(() => expect(bridge.enqueue).toHaveBeenCalledOnce());

    // Complete the run
    act(() => {
      fireEvent({
        requestId: "run-001",
        event: { type: "complete", outcome: "checked" },
        seq: 1,
      });
    });
    await waitFor(() => expect(screen.getByLabelText("checked")).toBeInTheDocument());

    // Click View
    await user.click(screen.getByRole("button", { name: "View" }));

    // Tab switched to checks
    expect(useAppStore.getState().route.tab).toBe("checks");
  });
});

// ─── AC-3: Warnings mapping with count ───────────────────────────────────────

describe("AC-3: warnings mapping — N warnings shown where N = open findings count", () => {
  it("completion event with status=warnings shows correct count", async () => {
    const user = userEvent.setup();
    const { bridge, fireEvent } = makeBridge();
    const bus = makeBus();

    render(<Prompt bridge={bridge} bus={bus} />);

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

    render(<Prompt bridge={bridge} bus={bus} />);

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

    render(<Prompt bridge={bridge} bus={bus} />);

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
  it("up-to-date artifact shows ✓ green chip", () => {
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
    render(<Prompt bridge={bridge} bus={bus} />);

    expect(screen.getByLabelText("Requirements — up to date")).toBeInTheDocument();
  });

  it("draft artifact shows ! amber chip", () => {
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
    render(<Prompt bridge={bridge} bus={bus} />);

    expect(screen.getByLabelText("Brand colors — draft")).toBeInTheDocument();
  });

  it("missing artifact shows hollow gray chip with defaults tooltip", () => {
    // Default snapshot has no artifacts → all missing
    const { bridge } = makeBridge();
    const bus = makeBus();
    render(<Prompt bridge={bridge} bus={bus} />);

    // All grounding chips should be missing (hollow)
    expect(
      screen.getByLabelText("Requirements — missing, generation proceeds with defaults"),
    ).toBeInTheDocument();
  });

  it("clicking a grounding chip switches to the artifacts tab", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    render(<Prompt bridge={bridge} bus={bus} />);

    await user.click(
      screen.getByLabelText("Requirements — missing, generation proceeds with defaults"),
    );

    expect(useAppStore.getState().route.tab).toBe("artifacts");
  });
});

// ─── AC-5: Empty-artifacts callout renders + generation still enqueues ────────

describe("AC-5: zero-artifacts callout renders; generation proceeds with defaults", () => {
  it("renders the callout when all grounding artifacts are missing", () => {
    // Default snapshot has no artifacts
    const { bridge } = makeBridge();
    const bus = makeBus();
    render(<Prompt bridge={bridge} bus={bus} />);

    expect(
      screen.getByText(/No artifacts yet — designs will use generation defaults only/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create artifacts →" })).toBeInTheDocument();
  });

  it("'Create artifacts →' button switches to the artifacts tab", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    render(<Prompt bridge={bridge} bus={bus} />);

    await user.click(screen.getByRole("button", { name: "Create artifacts →" }));
    expect(useAppStore.getState().route.tab).toBe("artifacts");
  });

  it("callout does NOT block submission — generation still enqueues", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    render(<Prompt bridge={bridge} bus={bus} />);

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

  it("callout is absent when at least one artifact has a non-missing status", () => {
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
    render(<Prompt bridge={bridge} bus={bus} />);

    expect(
      screen.queryByText(/No artifacts yet/),
    ).not.toBeInTheDocument();
  });
});

// ─── AC-6: SSE teardown on unmount ───────────────────────────────────────────

describe("AC-6: SSE subscription tears down on unmount", () => {
  it("bridge.events teardown is called when the component unmounts", () => {
    const teardownFn = vi.fn();
    const { bridge } = makeBridge({
      events: vi.fn().mockReturnValue(teardownFn),
    });
    const bus = makeBus();

    const { unmount } = render(<Prompt bridge={bridge} bus={bus} />);

    expect(bridge.events).toHaveBeenCalledOnce();
    expect(teardownFn).not.toHaveBeenCalled();

    unmount();

    expect(teardownFn).toHaveBeenCalledOnce();
  });
});

// ─── AC-7: Composer chip state persists across remount ───────────────────────

describe("AC-7: composer chip state persists across tab switches (remounts)", () => {
  it("unit type selection survives unmount + remount within session", () => {
    // Seed the runs store with a non-default unit type (simulating user already changed it)
    useRunsStore.setState({
      runs: [],
      composerUnitType: "molecule",
      composerPlatforms: [],
    });

    const { bridge } = makeBridge();
    const bus = makeBus();

    // First mount
    const { unmount } = render(<Prompt bridge={bridge} bus={bus} />);
    const select = screen.getByLabelText("Unit type") as HTMLSelectElement;
    expect(select.value).toBe("molecule");

    unmount();

    // Second mount — store state is preserved
    render(<Prompt bridge={bridge} bus={bus} />);
    const select2 = screen.getByLabelText("Unit type") as HTMLSelectElement;
    expect(select2.value).toBe("molecule");
  });

  it("platform selection survives unmount + remount", () => {
    // Seed store: only "mobile" selected
    useRunsStore.setState({
      runs: [],
      composerUnitType: "page",
      composerPlatforms: ["mobile"],
    });

    const { bridge } = makeBridge();
    const bus = makeBus();

    const { unmount } = render(<Prompt bridge={bridge} bus={bus} />);

    // Verify stored platform is used (select shows "mobile")
    const platformSelect = screen.getByLabelText("Platform target") as HTMLSelectElement;
    expect(platformSelect.value).toBe("mobile");

    unmount();

    // Remount — store unchanged
    render(<Prompt bridge={bridge} bus={bus} />);
    const platformSelect2 = screen.getByLabelText("Platform target") as HTMLSelectElement;
    expect(platformSelect2.value).toBe("mobile");
  });

  it("setComposerState updates the store and both selects reflect the change", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();

    render(<Prompt bridge={bridge} bus={bus} />);

    const unitSelect = screen.getByLabelText("Unit type") as HTMLSelectElement;
    await user.selectOptions(unitSelect, "organism");

    expect(useRunsStore.getState().composerUnitType).toBe("organism");
  });
});

// ─── Footer hint ─────────────────────────────────────────────────────────────

describe("Footer hint line", () => {
  it("renders the verbatim footer hint", () => {
    const { bridge } = makeBridge();
    const bus = makeBus();
    render(<Prompt bridge={bridge} bus={bus} />);

    expect(
      screen.getByText(
        "Generates on canvas using your artifacts & generation defaults.",
      ),
    ).toBeInTheDocument();
  });
});

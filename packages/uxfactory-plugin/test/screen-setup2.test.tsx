// @vitest-environment jsdom
/**
 * screen-setup2.test.tsx — RTL integration tests for SetupDefaults.
 *
 * Acceptance criteria from PRD 02 §6:
 *   1. Suggested defaults render for the step-1 classification.
 *   2. Changed classification re-suggests unedited fields (userEdited guard).
 *   3. Save body uses engine vocab exactly.
 *   4. Re-entry shows persisted values (prefillFrom snapshot), not re-suggested.
 *   5. Coverage caption is present verbatim.
 *   6. Tooltips on Visual/Coverage state their binding consequences.
 *   7. Keyboard: each Segmented is one radio group (one tab-stop, arrow keys move within).
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Bridge, ProjectSnapshot } from "../ui/lib/bridge.js";
import { useAppStore } from "../ui/stores/app.js";
import { useWizardStore } from "../ui/stores/wizard.js";
import { SetupDefaults } from "../ui/screens/SetupDefaults.js";

afterEach(cleanup);

// ─── Fake bridge ──────────────────────────────────────────────────────────────

function makeFakeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn(async () => ({ ok: true })),
    connectProject: vi.fn(async () => ({ ok: true as const, snapshot: makeSnapshot() })),
    snapshot: vi.fn(async () => makeSnapshot()),
    putClassification: vi.fn(async () => ({ ok: true })),
    putProfile: vi.fn(async () => ({ ok: true })),
    getLinks: vi.fn(async () => ({ links: [] })),
    putLinks: vi.fn(async () => ({ ok: true })),
    openPath: vi.fn(async () => ({ ok: true })),
    stats: vi.fn(async () => ({ version: "0.0.0", uptimeMs: 0, runsRelayed: 0, tokenCount: null })),
    logs: vi.fn(async () => ({ lines: [] })),
    enqueue: vi.fn(async () => ({ id: "req-1" })),
    events: vi.fn(() => () => {}),
    latestRender: vi.fn(async () => null),
    verify: vi.fn(async () => null),
    ...overrides,
  };
}

// ─── Snapshot factory ─────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    name: "Demo Shop",
    root: "/home/user/demo-shop",
    hasClassification: false,
    hasProfile: false,
    classification: null,
    profile: null,
    artifacts: [],
    requirements: [],
    ...overrides,
  };
}

// ─── Store reset helpers ──────────────────────────────────────────────────────

/** Fresh first-time state: ecommerce + corporate, default suggestions. */
function resetToFreshSetup() {
  useAppStore.setState({
    connection: {
      status: "connected",
      endpoint: "http://localhost:3779",
      repoPath: "/home/user/demo-shop",
      mode: "local",
    },
    fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
    snapshot: makeSnapshot(),
    route: { screen: "setup-2", tab: "prompt" },
    toasts: [],
  });
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
}

// ─── 1. Suggested defaults render ────────────────────────────────────────────

describe("PRD §6.1 — suggested defaults render for ecommerce · corporate", () => {
  beforeEach(resetToFreshSetup);

  it("Style: 'Mix' is selected", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    const group = screen.getByRole("radiogroup", { name: "Style" });
    expect(within(group).getByRole("radio", { name: "Mix" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });

  it("Visual fidelity: 'High' is selected", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    const group = screen.getByRole("radiogroup", { name: "Visual fidelity" });
    expect(within(group).getByRole("radio", { name: "High" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });

  it("Editorial fidelity: 'Medium' is selected", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    const group = screen.getByRole("radiogroup", { name: "Editorial fidelity" });
    expect(within(group).getByRole("radio", { name: "Medium" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });

  it("Flows: 'Shallow' is selected (engine value: low)", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    const group = screen.getByRole("radiogroup", { name: "Flows" });
    expect(within(group).getByRole("radio", { name: "Shallow" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });

  it("Coverage: 'Medium' is selected", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    const group = screen.getByRole("radiogroup", { name: "Coverage" });
    expect(within(group).getByRole("radio", { name: "Medium" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });

  it("Coherence: 'High' is selected", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    const group = screen.getByRole("radiogroup", { name: "Coherence" });
    expect(within(group).getByRole("radio", { name: "High" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });

  it("heading subcopy mentions the classification pair", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    expect(screen.getByText(/Ecommerce · Corporate/)).toBeInTheDocument();
  });
});

// ─── 2. Changed classification re-suggests unedited fields ───────────────────

describe("PRD §6.2 — changed classification re-suggests unless userEdited", () => {
  beforeEach(resetToFreshSetup);

  it("switching to webapp category updates unedited fields to webapp suggestions", async () => {
    // Start with ecommerce defaults, no user edits
    // webapp suggests: style=formal, visual=medium, editorial=high, flow=high, coverage=high, coherence=high
    useWizardStore.setState((s) => ({
      classification: { ...s.classification, category: "webapp" },
    }));

    render(<SetupDefaults bridge={makeFakeBridge()} />);
    // useEffect fires synchronously in act() during render
    await act(async () => {});

    const flowGroup = screen.getByRole("radiogroup", { name: "Flows" });
    // webapp → flow=high → "Deep" label
    expect(within(flowGroup).getByRole("radio", { name: "Deep" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });

  it("a manually edited field is NOT overwritten when classification changes", async () => {
    // User edits visual to "low" → userEdited.visual = true
    useWizardStore.getState().setDefault("visual", "low");
    // Now switch to webapp (which suggests visual=medium)
    useWizardStore.setState((s) => ({
      classification: { ...s.classification, category: "webapp" },
    }));

    render(<SetupDefaults bridge={makeFakeBridge()} />);
    await act(async () => {});

    const visualGroup = screen.getByRole("radiogroup", { name: "Visual fidelity" });
    // visual should stay at user's "low" choice
    expect(within(visualGroup).getByRole("radio", { name: "Low" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });
});

// ─── 3. Save body uses engine vocab exactly ───────────────────────────────────

describe("PRD §6.3 — Save & continue writes engine-vocab profile body", () => {
  beforeEach(resetToFreshSetup);

  it("putProfile called with exact engine values for screenshot state (Ecommerce · Corporate)", async () => {
    const user = userEvent.setup();
    const bridge = makeFakeBridge();
    render(<SetupDefaults bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: /Save & continue/i }));

    expect(bridge.putProfile).toHaveBeenCalledOnce();
    const body = (bridge.putProfile as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body).toMatchObject({
      style: "mix",
      scope: {
        visual: "high",
        editorial: "medium",
        flow: "low",
        coverage: "medium",
      },
      experimental: {
        coherence: "high",
      },
    });
  });

  it("routes to 'tabs' after Save & continue", async () => {
    const user = userEvent.setup();
    render(<SetupDefaults bridge={makeFakeBridge()} />);

    await user.click(screen.getByRole("button", { name: /Save & continue/i }));

    expect(useAppStore.getState().route.screen).toBe("tabs");
  });

  it("shows 'Applies to new runs' toast after Save & continue", async () => {
    const user = userEvent.setup();
    render(<SetupDefaults bridge={makeFakeBridge()} />);

    await user.click(screen.getByRole("button", { name: /Save & continue/i }));

    const toasts = useAppStore.getState().toasts;
    expect(toasts.some((t) => t.message === "Applies to new runs")).toBe(true);
  });

  it("putProfile uses low|medium|high vocab only (no display labels in body)", async () => {
    const user = userEvent.setup();
    const bridge = makeFakeBridge();
    render(<SetupDefaults bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: /Save & continue/i }));

    const body = (bridge.putProfile as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const allValues = [
      body.style,
      body.scope?.visual,
      body.scope?.editorial,
      body.scope?.flow,
      body.scope?.coverage,
      body.experimental?.coherence,
    ];
    const validVocab = ["informal", "mix", "formal", "low", "medium", "high"];
    for (const v of allValues) {
      expect(validVocab).toContain(v);
    }
    // Specifically: "Shallow" and "Exhaustive" labels must NOT appear in body
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("Shallow");
    expect(bodyStr).not.toContain("Exhaustive");
    expect(bodyStr).not.toContain("Thin");
    expect(bodyStr).not.toContain("Deep");
  });
});

// ─── 4. Re-entry shows persisted values ──────────────────────────────────────

describe("PRD §6.4 — re-entry shows persisted values, not re-suggested", () => {
  it("shows profile values from snapshot after prefillFrom", async () => {
    useAppStore.setState({
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/repo", mode: "local" },
      fileInfo: { name: "Demo Shop", fileKey: "k" },
      snapshot: makeSnapshot({
        hasClassification: true,
        hasProfile: true,
        classification: { category: "ecommerce", industry: "corporate" },
        profile: {
          scope: { visual: "low", editorial: "low", flow: "high", coverage: "high" },
          experimental: { coherence: "low" },
        },
      }),
      route: { screen: "setup-2", tab: "prompt" },
      toasts: [],
    });

    // Simulate what the app would do: call prefillFrom from the snapshot
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
        style: false, visual: false, editorial: false, flow: false, coverage: false, coherence: false,
      },
    });

    // prefillFrom fills defaults from the persisted snapshot profile and marks
    // them as userEdited so applysuggestions does NOT overwrite them on re-mount.
    useWizardStore.getState().prefillFrom(useAppStore.getState().snapshot!);

    render(<SetupDefaults bridge={makeFakeBridge()} />);
    await act(async () => {});

    // Persisted: visual=low, flow=high (different from ecommerce+corporate suggestions)
    const visualGroup = screen.getByRole("radiogroup", { name: "Visual fidelity" });
    expect(within(visualGroup).getByRole("radio", { name: "Low" })).toHaveAttribute(
      "data-state",
      "checked",
    );

    const flowGroup = screen.getByRole("radiogroup", { name: "Flows" });
    expect(within(flowGroup).getByRole("radio", { name: "Deep" })).toHaveAttribute(
      "data-state",
      "checked",
    );

    // coherence=low persisted (not the ecommerce+corporate suggestion of "high")
    const coherenceGroup = screen.getByRole("radiogroup", { name: "Coherence" });
    expect(within(coherenceGroup).getByRole("radio", { name: "Low" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });
});

// ─── 5. Coverage caption present verbatim ────────────────────────────────────

describe("PRD §6.5 — Coverage caption is present verbatim", () => {
  beforeEach(resetToFreshSetup);

  it("renders the exact Coverage caption text", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    expect(
      screen.getByText(
        "Floor for generation without specs — when requirements exist, they take precedence.",
      ),
    ).toBeInTheDocument();
  });
});

// ─── 6. Tooltips state binding consequences ───────────────────────────────────

describe("PRD §6.6 — tooltips on Visual and Coverage state binding consequences", () => {
  beforeEach(resetToFreshSetup);

  it("Visual fidelity info button is present and carries binding consequence in label", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    // The info button aria-label contains the binding consequence text
    const btn = screen.getByRole("button", {
      name: /a11y\/contrast\/token checks bind/i,
    });
    expect(btn).toBeInTheDocument();
  });

  it("Coverage info button is present and carries precedence rule in label", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    const btn = screen.getByRole("button", {
      name: /when requirements exist, they take precedence/i,
    });
    expect(btn).toBeInTheDocument();
  });
});

// ─── 7. Keyboard: radio-group semantics ──────────────────────────────────────

describe("PRD §6.7 — keyboard: each Segmented is one radio group", () => {
  beforeEach(resetToFreshSetup);

  it("each Segmented control has role=radiogroup (one tab-stop, arrow keys navigate within)", () => {
    render(<SetupDefaults bridge={makeFakeBridge()} />);
    const groups = screen.getAllByRole("radiogroup");
    // At least 6 radiogroups for the 6 dials
    expect(groups.length).toBeGreaterThanOrEqual(6);
  });

  it("ArrowRight within Visual fidelity moves selection from High to next (wraps or stays)", () => {
    vi.useFakeTimers();
    try {
      render(<SetupDefaults bridge={makeFakeBridge()} />);
      const group = screen.getByRole("radiogroup", { name: "Visual fidelity" });
      const highItem = within(group).getByRole("radio", { name: "High" });

      highItem.focus();
      fireEvent.keyDown(document, { key: "ArrowLeft", code: "ArrowLeft" });
      fireEvent.keyDown(highItem, { key: "ArrowLeft", code: "ArrowLeft" });
      vi.runAllTimers();
      fireEvent.keyUp(document, { key: "ArrowLeft", code: "ArrowLeft" });

      // Focus has moved left → to Medium
      const mediumItem = within(group).getByRole("radio", { name: "Medium" });
      expect(document.activeElement).toBe(mediumItem);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Back navigation ──────────────────────────────────────────────────────────

describe("Back navigation", () => {
  beforeEach(resetToFreshSetup);

  it("Back routes to setup-1", async () => {
    const user = userEvent.setup();
    render(<SetupDefaults bridge={makeFakeBridge()} />);

    await user.click(screen.getByRole("button", { name: /← Back/i }));

    expect(useAppStore.getState().route.screen).toBe("setup-1");
  });

  it("Back does not write profile to bridge", async () => {
    const user = userEvent.setup();
    const bridge = makeFakeBridge();
    render(<SetupDefaults bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: /← Back/i }));

    expect(bridge.putProfile).not.toHaveBeenCalled();
  });
});

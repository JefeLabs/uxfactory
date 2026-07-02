// @vitest-environment jsdom
/**
 * screen-setup1.test.tsx — RTL integration tests for SetupClassification.
 *
 * Acceptance criteria from PRD 01 §6:
 *   1. Exact screenshot defaults on empty repo.
 *   2. Continue writes classification body + routes to setup-2.
 *   3. Scan variant "found existing work" pre-selects use-existing + names artifacts.
 *   4. Back returns to connect without dropping values.
 *   5. No classification write on unmount-without-continue.
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, within, cleanup, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Bridge, ProjectSnapshot } from "../ui/lib/bridge.js";
import { useAppStore } from "../ui/stores/app.js";
import { useWizardStore } from "../ui/stores/wizard.js";
import { SetupClassification } from "../ui/screens/SetupClassification.js";

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

function resetStores(snapshot: ProjectSnapshot | null = makeSnapshot()) {
  useAppStore.setState({
    connection: {
      status: "connected",
      endpoint: "http://localhost:3779",
      repoPath: "/home/user/demo-shop",
      mode: "local",
    },
    fileInfo: { name: "Demo Shop", fileKey: "file-abc" },
    snapshot,
    route: { screen: "setup-1", tab: "prompt" },
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

// ─── 1. Defaults exact on empty repo ─────────────────────────────────────────

describe("PRD §6.1 — empty repo renders screenshot defaults exactly", () => {
  beforeEach(() => resetStores(makeSnapshot()));

  it("Category 'Ecommerce' chip is selected", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    const group = screen.getByRole("radiogroup", { name: "Category" });
    expect(within(group).getByRole("radio", { name: "Ecommerce" })).toHaveAttribute(
      "data-state",
      "on",
    );
  });

  it("Industry select shows 'Corporate'", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    const select = screen.getByLabelText("Industry") as HTMLSelectElement;
    expect(select.value).toBe("corporate");
    // Displayed option text
    expect(screen.getByDisplayValue("Corporate")).toBeInTheDocument();
  });

  it("Locale select shows 'English (US)'", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    const select = screen.getByLabelText("Locale") as HTMLSelectElement;
    expect(select.value).toBe("en-US");
    expect(screen.getByDisplayValue("English (US)")).toBeInTheDocument();
  });

  it("Platforms: Desktop + Mobile selected, Tablet unselected", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    const group = screen.getByRole("toolbar", { name: "Platforms" });
    expect(within(group).getByRole("button", { name: "Desktop" })).toHaveAttribute(
      "data-state",
      "on",
    );
    expect(within(group).getByRole("button", { name: "Mobile" })).toHaveAttribute(
      "data-state",
      "on",
    );
    expect(within(group).getByRole("button", { name: "Tablet" })).toHaveAttribute(
      "data-state",
      "off",
    );
  });

  it("Layout: Responsive selected", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    const group = screen.getByRole("radiogroup", { name: "Layout" });
    expect(within(group).getByRole("radio", { name: "Responsive" })).toHaveAttribute(
      "data-state",
      "checked",
    );
  });

  it("Layout helper caption shows 'One fluid layout across your platforms'", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    expect(
      screen.getByText("One fluid layout across your platforms"),
    ).toBeInTheDocument();
  });

  it("Age group: 18–39 selected", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    const group = screen.getByRole("radiogroup", { name: "Age group" });
    expect(within(group).getByRole("radio", { name: "18–39" })).toHaveAttribute(
      "data-state",
      "on",
    );
  });

  it("'Start fresh' radio card is selected with 'Detected — project is empty' badge", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    const card = screen.getByRole("radio", { name: /Start fresh/i });
    expect(card).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Detected — project is empty")).toBeInTheDocument();
  });

  it("'Use existing work' card has dimmed wrapper (opacity-50) on empty repo but remains selectable", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    const card = screen.getByRole("radio", { name: /Use existing work/i });
    // Card is wrapped in opacity-50 div — pointer events not disabled
    expect(card.parentElement).toHaveClass("opacity-50");
    // Still selectable — no aria-disabled on the radio card
    expect(card).not.toHaveAttribute("aria-disabled", "true");
  });

  it("Continue button is enabled (Category is set)", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    const btn = screen.getByRole("button", { name: "Continue" });
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute("aria-disabled", "true");
  });

  it("Continue is disabled when Category is cleared", async () => {
    // Override classification to have no category
    useWizardStore.setState((s) => ({
      classification: { ...s.classification, category: "" as never },
    }));
    render(<SetupClassification bridge={makeFakeBridge()} />);
    const btn = screen.getByRole("button", { name: "Continue" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });
});

// ─── 2. Continue writes classification + routes ───────────────────────────────

describe("PRD §6.2 — Continue writes classification body + routes to setup-2", () => {
  beforeEach(() => resetStores(makeSnapshot()));

  it("calls putClassification with the correct field set (no style)", async () => {
    const user = userEvent.setup();
    const bridge = makeFakeBridge();
    render(<SetupClassification bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(bridge.putClassification).toHaveBeenCalledOnce();
    expect(bridge.putClassification).toHaveBeenCalledWith({
      category: "ecommerce",
      industry: "corporate",
      locale: "en-US",
      platforms: ["desktop", "mobile"],
      layout: "responsive",
      ageGroup: "18-39",
    });
    // style is NOT in the body — it's written by Screen 2
    const body = (bridge.putClassification as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body).not.toHaveProperty("style");
  });

  it("routes to setup-2 after Continue", async () => {
    const user = userEvent.setup();
    render(<SetupClassification bridge={makeFakeBridge()} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(useAppStore.getState().route.screen).toBe("setup-2");
  });
});

// ─── 2b. Error path — failed PUT does not navigate ───────────────────────────

describe("PRD §6.2 (error path) — failed bridge write stays on setup-1", () => {
  beforeEach(() => resetStores(makeSnapshot()));

  it("stays on setup-1 when putClassification rejects", async () => {
    const user = userEvent.setup();
    const bridge = makeFakeBridge({
      putClassification: vi.fn(() => Promise.reject(new Error("network error"))),
    });
    render(<SetupClassification bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(useAppStore.getState().route.screen).toBe("setup-1");
  });

  it("fires 'Could not save — is the bridge running?' toast when putClassification rejects", async () => {
    const user = userEvent.setup();
    const bridge = makeFakeBridge({
      putClassification: vi.fn(() => Promise.reject(new Error("network error"))),
    });
    render(<SetupClassification bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    const toasts = useAppStore.getState().toasts;
    expect(toasts.some((t) => t.message === "Could not save — is the bridge running?")).toBe(true);
  });

  it("re-enables Continue button after putClassification rejects", async () => {
    const user = userEvent.setup();
    const bridge = makeFakeBridge({
      putClassification: vi.fn(() => Promise.reject(new Error("network error"))),
    });
    render(<SetupClassification bridge={bridge} />);

    const btn = screen.getByRole("button", { name: "Continue" });
    await user.click(btn);

    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute("aria-disabled", "true");
  });
});

// ─── 3. Scan variant — found existing work ────────────────────────────────────

describe("PRD §6.3 — scan variant: 'found existing work' pre-selects use-existing", () => {
  const existingSnapshot = makeSnapshot({
    hasClassification: false,
    artifacts: [
      { key: "a1", group: "design", label: "Design tokens", status: "up-to-date", meta: "", path: null },
    ],
    requirements: [
      { id: "r1", title: "Homepage layout" },
      { id: "r2", title: "Product detail page" },
    ],
  });

  beforeEach(() => resetStores(existingSnapshot));

  it("heading shows 'We found existing work'", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    expect(
      screen.getByRole("heading", { name: /We found existing work/i }),
    ).toBeInTheDocument();
  });

  it("'Use existing work' card is pre-selected after mount", async () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    // useEffect fires synchronously in act() during render
    await act(async () => {});
    const card = screen.getByRole("radio", { name: /Use existing work/i });
    expect(card).toHaveAttribute("aria-checked", "true");
  });

  it("badge names detected artifacts (requirements + design tokens)", async () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    await act(async () => {});
    expect(
      screen.getByText("Detected — 2 requirements · design tokens"),
    ).toBeInTheDocument();
  });
});

// ─── 4. Back preserves values ─────────────────────────────────────────────────

describe("PRD §6.4 — Back returns to connect without dropping entered values", () => {
  beforeEach(() => resetStores());

  it("clicking Back routes to 'connect'", async () => {
    const user = userEvent.setup();
    render(<SetupClassification bridge={makeFakeBridge()} />);

    await user.click(screen.getByRole("button", { name: /← Back/i }));

    expect(useAppStore.getState().route.screen).toBe("connect");
  });

  it("wizard store classification is unchanged after Back", async () => {
    const user = userEvent.setup();
    render(<SetupClassification bridge={makeFakeBridge()} />);

    const beforeCategory = useWizardStore.getState().classification.category;
    await user.click(screen.getByRole("button", { name: /← Back/i }));

    expect(useWizardStore.getState().classification.category).toBe(beforeCategory);
  });

  it("wizard store platforms are unchanged after Back", async () => {
    const user = userEvent.setup();
    render(<SetupClassification bridge={makeFakeBridge()} />);

    const beforePlatforms = useWizardStore.getState().classification.platforms;
    await user.click(screen.getByRole("button", { name: /← Back/i }));

    expect(useWizardStore.getState().classification.platforms).toEqual(beforePlatforms);
  });
});

// ─── 5. No classification write on unmount-without-continue ──────────────────

describe("PRD §6.5 — no classification write when plugin closes mid-wizard", () => {
  beforeEach(() => resetStores());

  it("putClassification is NOT called if the component is unmounted without clicking Continue", () => {
    const bridge = makeFakeBridge();
    const { unmount } = render(<SetupClassification bridge={bridge} />);

    unmount();

    expect(bridge.putClassification).not.toHaveBeenCalled();
  });

  it("putClassification is NOT called when Back is clicked", async () => {
    const user = userEvent.setup();
    const bridge = makeFakeBridge();
    render(<SetupClassification bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: /← Back/i }));

    expect(bridge.putClassification).not.toHaveBeenCalled();
  });
});

// ─── Project header bar ───────────────────────────────────────────────────────

describe("Project header bar", () => {
  beforeEach(() => resetStores());

  it("shows the project name", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    expect(screen.getAllByText("Demo Shop")[0]).toBeInTheDocument();
  });

  it("shows the repo path in the header", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    expect(screen.getByText("/home/user/demo-shop")).toBeInTheDocument();
  });

  it("shows a 'Connected' status pill", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Connected");
  });
});

// ─── Layout caption swaps ─────────────────────────────────────────────────────

describe("Layout caption swaps when Adaptive is selected", () => {
  beforeEach(() => {
    resetStores();
    useWizardStore.setState((s) => ({
      classification: { ...s.classification, layout: "adaptive" },
    }));
  });

  it("shows 'Distinct layouts per platform' when Adaptive is active", () => {
    render(<SetupClassification bridge={makeFakeBridge()} />);
    expect(screen.getByText("Distinct layouts per platform")).toBeInTheDocument();
  });
});

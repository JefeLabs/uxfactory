// @vitest-environment jsdom
/**
 * identity-inventory.test.tsx — RTL tests for IdentityInventory (Task 13),
 * the Components tab's node-identity suggest→confirm surface. Mounted via
 * the real Components screen (same harness as screen-components.test.tsx)
 * since IdentityInventory is a Components-tab sub-component, not a route.
 *
 * Fixture: a 2-record manifest (n-hero root, n-cta composed child via
 * n-hero.composition) exercising every provenance tier plus a low-confidence
 * coordinate, so tree derivation, chip styling, confirm/override wiring, and
 * batch-exclude-low-confidence can all be asserted deterministically.
 */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import type { ComponentTypeEntry, NodeIdentityRecord, NodeManifest } from "@uxfactory/spec";
import type { Bridge, ProjectSnapshot } from "../ui/lib/bridge.js";
import type { PluginBus } from "../ui/lib/plugin-bus.js";
import { Components } from "../ui/screens/Components.js";
import { useAppStore } from "../ui/stores/app.js";
import { renderWithProviders } from "./test-utils.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeRecord(
  overrides: Partial<NodeIdentityRecord> & { durableId: string },
): NodeIdentityRecord {
  return {
    figmaNodeId: `fig-${overrides.durableId}`,
    address: overrides.durableId,
    scope: [],
    path: [],
    coordinates: {},
    kind: "FRAME",
    pathRoleDefault: "section",
    isDefinition: false,
    composition: [],
    currentName: overrides.durableId,
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

/** Root record — page-child tier (nobody's `composition` lists it). */
const heroRecord = makeRecord({
  durableId: "n-hero",
  address: "hero@desktop",
  currentName: "Hero Frame",
  composition: ["n-cta"],
  definitionRef: "comp-1",
  reasoning: 'named "hero" because it is the first full-bleed frame on the page',
  path: [{ label: "hero", provenance: "inferred", confirmed: false }],
  coordinates: {
    viewport: { value: "desktop", provenance: "inferred", confidence: "high" },
    mode: { value: "light", provenance: "derived" },
  },
});

/** Composed child — reached only via n-hero.composition, depth 1. */
const ctaRecord = makeRecord({
  durableId: "n-cta",
  address: "hero/cta-button@desktop",
  currentName: "CTA",
  path: [
    { label: "hero", provenance: "inferred", confirmed: false },
    { label: "cta-button", provenance: "elicited", source: "user" },
  ],
  coordinates: {
    // low confidence — must be individually confirmable but NEVER batched.
    theme: { value: "dark", provenance: "inferred", confidence: "low" },
    state: { value: "default", provenance: "defaulted" },
  },
});

const registry: ComponentTypeEntry[] = [
  { key: "comp-1", roleName: "hero-section", source: "figma-document", matchability: "matchable" },
];

function makeManifestResponse(): { manifest: NodeManifest } {
  return {
    manifest: {
      version: 1,
      records: { "n-hero": heroRecord, "n-cta": ctaRecord },
    },
  };
}

// ─── Fake bus — the inventory now drives the identity-apply round-trip
// (Task 14) through it: `requestIdentityApply` is asserted on directly, and
// `emitIdentityApplied` lets a test simulate the plugin main thread's ack
// (the real bus dispatches this from an `identity-applied` MainToUi message —
// see plugin-bus.ts's onIdentityApplied contract).  ──────────────────────

function makeBus(): PluginBus & { emitIdentityApplied: (payload: unknown) => void } {
  let identityAppliedCb: ((payload: unknown) => void) | null = null;
  return {
    storageGet: vi.fn().mockResolvedValue(undefined),
    storageSet: vi.fn().mockResolvedValue(undefined),
    fileInfo: vi.fn().mockResolvedValue({ name: "Test", fileKey: "fk" }),
    insertIcon: vi.fn().mockResolvedValue("node-1"),
    notify: vi.fn(),
    close: vi.fn(),
    onSelection: vi.fn().mockReturnValue(() => {}),
    selectNodes: vi.fn(),
    postReview: vi.fn(),
    requestIdentityApply: vi.fn(),
    onIdentityApplied: vi.fn((cb: (payload: unknown) => void) => {
      identityAppliedCb = cb;
      return () => {
        identityAppliedCb = null;
      };
    }),
    emitIdentityApplied: (payload: unknown) => identityAppliedCb?.(payload),
  };
}

// ─── Fake bridge ────────────────────────────────────────────────────────────

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    connectProject: vi.fn(),
    snapshot: vi.fn().mockResolvedValue({}),
    putClassification: vi.fn().mockResolvedValue({ ok: true }),
    putProfile: vi.fn().mockResolvedValue({ ok: true }),
    getLinks: vi.fn().mockResolvedValue({ links: [] }),
    putLinks: vi.fn().mockResolvedValue({ ok: true }),
    openPath: vi.fn().mockResolvedValue({ ok: true }),
    stats: vi.fn(),
    logs: vi.fn(),
    enqueue: vi.fn().mockResolvedValue({ id: "run-abc" }),
    events: vi.fn().mockReturnValue(() => {}),
    latestRender: vi.fn(),
    verify: vi.fn(),
    getIdentityManifest: vi.fn().mockResolvedValue(makeManifestResponse()),
    getIdentityComponents: vi.fn().mockResolvedValue({ components: registry }),
    confirmIdentity: vi.fn().mockResolvedValue({ ok: true, updated: 1 }),
    postIdentityApplied: vi.fn().mockResolvedValue({ ok: true, stamped: 1 }),
    ...overrides,
  } as unknown as Bridge;
}

// ─── Snapshot + store reset (same pattern as screen-components.test.tsx) ──────

function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    name: "Test Project",
    root: "/home/user/test",
    hasClassification: true,
    hasProfile: true,
    classification: null,
    profile: null,
    artifacts: [],
    requirements: [],
    ...overrides,
  };
}

function resetStores(): void {
  useAppStore.setState({
    connection: {
      status: "connected" as const,
      endpoint: "http://localhost:3779",
      repoPath: "/home/user/test",
      mode: "local" as const,
    },
    fileInfo: null,
    snapshot: makeSnapshot(),
    toasts: [],
  });
}

beforeEach(() => {
  resetStores();
});
afterEach(cleanup);

// ─── Helper: mount Components and wait for the inventory rows to appear ───────

async function renderInventory(bridge: Bridge, bus = makeBus()) {
  const result = await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
    initialEntries: ["/tabs/components"],
  });
  await waitFor(() => expect(bridge.getIdentityManifest).toHaveBeenCalled());
  await screen.findByText("hero@desktop");
  return { ...result, bus };
}

function rowFor(container: HTMLElement, durableId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-durable-id="${durableId}"]`);
  if (row === null) throw new Error(`row not found for ${durableId}`);
  return row;
}

function segmentChip(
  container: HTMLElement,
  durableId: string,
  segment: string,
): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `[data-durable-id="${durableId}"] [data-segment="${segment}"]`,
  );
  if (el === null) throw new Error(`segment chip not found for ${durableId}.${segment}`);
  return el;
}

// ─── Tree + addresses ───────────────────────────────────────────────────────

describe("Identity inventory: tree rendering", () => {
  it("renders both records with their suggested addresses, child indented deeper than root", async () => {
    const bridge = makeBridge();
    const { container } = await renderInventory(bridge);

    expect(screen.getByText("hero@desktop")).toBeInTheDocument();
    expect(screen.getByText("hero/cta-button@desktop")).toBeInTheDocument();

    const heroRow = rowFor(container, "n-hero");
    const ctaRow = rowFor(container, "n-cta");
    expect(heroRow.dataset["depth"]).toBe("0");
    expect(ctaRow.dataset["depth"]).toBe("1");
  });

  it("shows the current layer name and a reasoning tooltip trigger for the root row", async () => {
    const bridge = makeBridge();
    await renderInventory(bridge);

    expect(screen.getByText("Hero Frame")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: 'Reasoning: named "hero" because it is the first full-bleed frame on the page',
      }),
    ).toBeInTheDocument();
  });
});

// ─── Provenance chip styling per tier ───────────────────────────────────────

describe("Identity inventory: provenance chip tiers", () => {
  it("styles an inferred segment with the accent tier class", async () => {
    const bridge = makeBridge();
    const { container } = await renderInventory(bridge);

    const chip = segmentChip(container, "n-hero", "label");
    expect(chip.dataset["provenance"]).toBe("inferred");
    expect(chip.className).toContain("bg-primary-50");
  });

  it("styles a derived segment as quiet/settled text with no chip surface", async () => {
    const bridge = makeBridge();
    const { container } = await renderInventory(bridge);

    const chip = segmentChip(container, "n-hero", "mode");
    expect(chip.dataset["provenance"]).toBe("derived");
    expect(chip.className).toContain("text-gray-500");
    expect(chip.className).not.toContain("bg-primary-50");
    expect(chip.className).not.toContain("bg-gray-100");
  });

  it("styles an elicited segment as a muted chip", async () => {
    const bridge = makeBridge();
    const { container } = await renderInventory(bridge);

    const chip = segmentChip(container, "n-cta", "label");
    expect(chip.dataset["provenance"]).toBe("elicited");
    expect(chip.className).toContain("bg-gray-100");
  });

  it("styles a defaulted segment as a muted chip", async () => {
    const bridge = makeBridge();
    const { container } = await renderInventory(bridge);

    const chip = segmentChip(container, "n-cta", "state");
    expect(chip.dataset["provenance"]).toBe("defaulted");
    expect(chip.className).toContain("bg-gray-100");
  });

  it("flags a low-confidence inferred coordinate", async () => {
    const bridge = makeBridge();
    const { container } = await renderInventory(bridge);

    const chip = segmentChip(container, "n-cta", "theme");
    expect(within(chip).getByLabelText("Low confidence theme")).toBeInTheDocument();
  });

  it("does not flag a high-confidence inferred coordinate", async () => {
    const bridge = makeBridge();
    const { container } = await renderInventory(bridge);

    const chip = segmentChip(container, "n-hero", "viewport");
    expect(within(chip).queryByLabelText(/Low confidence/)).not.toBeInTheDocument();
  });
});

// ─── Per-segment confirm ────────────────────────────────────────────────────

describe("Identity inventory: per-row confirm", () => {
  it("fires confirmIdentity with the exact per-segment confirmation for an inferred label", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderInventory(bridge);

    const btn = screen.getByRole("button", { name: "Confirm label for hero@desktop" });
    await user.click(btn);

    await waitFor(() =>
      expect(bridge.confirmIdentity).toHaveBeenCalledWith([
        { durableId: "n-hero", segment: "label", action: "confirm" },
      ]),
    );
  });

  it("fires confirmIdentity for an inferred coordinate segment", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderInventory(bridge);

    const btn = screen.getByRole("button", { name: "Confirm viewport for hero@desktop" });
    await user.click(btn);

    await waitFor(() =>
      expect(bridge.confirmIdentity).toHaveBeenCalledWith([
        { durableId: "n-hero", segment: "viewport", action: "confirm" },
      ]),
    );
  });

  it("offers no confirm button for a derived segment (nothing to ratify)", async () => {
    const bridge = makeBridge();
    await renderInventory(bridge);

    expect(
      screen.queryByRole("button", { name: "Confirm mode for hero@desktop" }),
    ).not.toBeInTheDocument();
  });

  it("invalidates the manifest query after a successful confirm", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderInventory(bridge);

    const callsBefore = (bridge.getIdentityManifest as ReturnType<typeof vi.fn>).mock.calls
      .length;
    await user.click(screen.getByRole("button", { name: "Confirm label for hero@desktop" }));

    await waitFor(() =>
      expect(
        (bridge.getIdentityManifest as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsBefore),
    );
  });
});

// ─── Header batch confirm ───────────────────────────────────────────────────

describe("Identity inventory: Confirm all high-confidence", () => {
  it("composes every inferred, unconfirmed, non-low-confidence segment into ONE call", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderInventory(bridge);

    const btn = screen.getByRole("button", { name: "Confirm all high-confidence" });
    expect(btn).toHaveTextContent("Confirm all high-confidence (2)");
    await user.click(btn);

    await waitFor(() => expect(bridge.confirmIdentity).toHaveBeenCalledTimes(1));
    expect(bridge.confirmIdentity).toHaveBeenCalledWith([
      { durableId: "n-hero", segment: "label", action: "confirm" },
      { durableId: "n-hero", segment: "viewport", action: "confirm" },
    ]);
  });

  it("excludes the low-confidence theme segment from the batch", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderInventory(bridge);

    await user.click(screen.getByRole("button", { name: "Confirm all high-confidence" }));

    await waitFor(() => expect(bridge.confirmIdentity).toHaveBeenCalledTimes(1));
    const items = (bridge.confirmIdentity as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<{
      durableId: string;
      segment: string;
    }>;
    expect(items.some((i) => i.durableId === "n-cta" && i.segment === "theme")).toBe(false);
    // The low-confidence segment stays individually confirmable, just not batched.
    expect(
      screen.getByRole("button", { name: "Confirm theme for hero/cta-button@desktop" }),
    ).toBeInTheDocument();
  });

  it("scopes the batch to visible rows only — a row hidden by the library filter is excluded", async () => {
    const user = userEvent.setup();
    const twoSourceRegistry: ComponentTypeEntry[] = [
      { key: "comp-a", roleName: "section-a", source: "figma-document", matchability: "matchable" },
      { key: "comp-b", roleName: "section-b", source: "figma-library", matchability: "matchable" },
    ];
    const recA = makeRecord({
      durableId: "n-a",
      address: "a@desktop",
      currentName: "A",
      definitionRef: "comp-a",
      path: [{ label: "a", provenance: "inferred", confirmed: false }],
    });
    const recB = makeRecord({
      durableId: "n-b",
      address: "b@desktop",
      currentName: "B",
      definitionRef: "comp-b",
      path: [{ label: "b", provenance: "inferred", confirmed: false }],
    });
    const bridge = makeBridge({
      getIdentityManifest: vi.fn().mockResolvedValue({
        manifest: { version: 1, records: { "n-a": recA, "n-b": recB } },
      }),
      getIdentityComponents: vi.fn().mockResolvedValue({ components: twoSourceRegistry }),
    });
    const bus = makeBus();
    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await screen.findByText("a@desktop");
    await screen.findByText("b@desktop");

    // Both visible, both batch-eligible, before any filtering.
    expect(
      screen.getByRole("button", { name: "Confirm all high-confidence" }),
    ).toHaveTextContent("Confirm all high-confidence (2)");

    // Hide the figma-library row (n-b) — reviewing internal-DS components only.
    const filterGroup = screen.getByRole("toolbar", {
      name: "Filter by component-registry source",
    });
    await user.click(within(filterGroup).getByRole("button", { name: "figma-library" }));
    await waitFor(() => expect(screen.queryByText("b@desktop")).not.toBeInTheDocument());

    const btn = screen.getByRole("button", { name: "Confirm all high-confidence" });
    expect(btn).toHaveTextContent("Confirm all high-confidence (1)");
    await user.click(btn);

    await waitFor(() => expect(bridge.confirmIdentity).toHaveBeenCalledTimes(1));
    expect(bridge.confirmIdentity).toHaveBeenCalledWith([
      { durableId: "n-a", segment: "label", action: "confirm" },
    ]);
  });

  it("is disabled once nothing inferred remains unconfirmed/high-confidence", async () => {
    const bridge = makeBridge({
      getIdentityManifest: vi.fn().mockResolvedValue({
        manifest: {
          version: 1,
          records: {
            "n-hero": makeRecord({
              durableId: "n-hero",
              address: "hero@desktop",
              path: [{ label: "hero", provenance: "derived" }],
            }),
          },
        },
      }),
    });
    const bus = makeBus();
    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await screen.findByText("hero@desktop");

    expect(screen.getByRole("button", { name: "Confirm all high-confidence" })).toBeDisabled();
  });
});

// ─── Override ────────────────────────────────────────────────────────────────

describe("Identity inventory: override", () => {
  it("fires an override confirmation with the edited value", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderInventory(bridge);

    await user.click(screen.getByRole("button", { name: "Override label for hero@desktop" }));
    const input = screen.getByLabelText("Override label for hero@desktop");
    await user.clear(input);
    await user.type(input, "landing{Enter}");

    await waitFor(() =>
      expect(bridge.confirmIdentity).toHaveBeenCalledWith([
        { durableId: "n-hero", segment: "label", action: "override", value: "landing" },
      ]),
    );
  });

  it("invalidates the manifest query after a successful override", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderInventory(bridge);

    const callsBefore = (bridge.getIdentityManifest as ReturnType<typeof vi.fn>).mock.calls
      .length;
    await user.click(screen.getByRole("button", { name: "Override label for hero@desktop" }));
    const input = screen.getByLabelText("Override label for hero@desktop");
    await user.clear(input);
    await user.type(input, "landing{Enter}");

    await waitFor(() =>
      expect(
        (bridge.getIdentityManifest as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsBefore),
    );
  });

  it("cancels without calling confirmIdentity when Escape is pressed", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderInventory(bridge);

    await user.click(screen.getByRole("button", { name: "Override label for hero@desktop" }));
    const input = screen.getByLabelText("Override label for hero@desktop");
    await user.type(input, "abc{Escape}");

    expect(bridge.confirmIdentity).not.toHaveBeenCalled();
  });

  it("fires an override confirmation for a coordinate axis (not just label)", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderInventory(bridge);

    await user.click(screen.getByRole("button", { name: "Override viewport for hero@desktop" }));
    const input = screen.getByLabelText("Override viewport for hero@desktop");
    await user.clear(input);
    await user.type(input, "tablet{Enter}");

    await waitFor(() =>
      expect(bridge.confirmIdentity).toHaveBeenCalledWith([
        { durableId: "n-hero", segment: "viewport", action: "override", value: "tablet" },
      ]),
    );
  });
});

// ─── Per-item confirm/override errors (route 200s with errors[] on tier-2
// rejection — e.g. a bad override value, or a confirm that raced a
// provenance change) ─────────────────────────────────────────────────────

describe("Identity inventory: per-item confirm/override errors", () => {
  it("surfaces a non-empty errors[] from a 200 response via the panel's toast idiom", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      confirmIdentity: vi.fn().mockResolvedValue({
        ok: true,
        updated: 0,
        errors: ['n-hero.label: override value "???" is not a valid label'],
      }),
    });
    await renderInventory(bridge);

    await user.click(screen.getByRole("button", { name: "Override label for hero@desktop" }));
    const input = screen.getByLabelText("Override label for hero@desktop");
    await user.clear(input);
    await user.type(input, "???{Enter}");

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts;
      expect(
        toasts.some((t) =>
          t.message.includes('n-hero.label: override value "???" is not a valid label'),
        ),
      ).toBe(true);
    });
  });

  it("still invalidates the manifest query even when errors[] is non-empty", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      confirmIdentity: vi.fn().mockResolvedValue({
        ok: true,
        updated: 0,
        errors: ["n-hero.label: rejected"],
      }),
    });
    await renderInventory(bridge);

    const callsBefore = (bridge.getIdentityManifest as ReturnType<typeof vi.fn>).mock.calls
      .length;
    await user.click(screen.getByRole("button", { name: "Confirm label for hero@desktop" }));

    await waitFor(() =>
      expect(
        (bridge.getIdentityManifest as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsBefore),
    );
  });

  it("resyncs the override draft to the true current value after a rejected override", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      confirmIdentity: vi.fn().mockResolvedValue({
        ok: true,
        updated: 0,
        errors: ['n-hero.label: override value "???" is not a valid label'],
      }),
    });
    await renderInventory(bridge);

    await user.click(screen.getByRole("button", { name: "Override label for hero@desktop" }));
    await user.clear(screen.getByLabelText("Override label for hero@desktop"));
    await user.type(screen.getByLabelText("Override label for hero@desktop"), "???{Enter}");

    // Rejected server-side; getIdentityManifest still resolves with the
    // unchanged "hero" label. Reopening the editor must show the true
    // current value, not the stale rejected "???" draft. (Query by "textbox"
    // role, not label text — the override PENCIL BUTTON reuses the same
    // aria-label once editing closes, so a plain queryByLabelText would
    // still match it.)
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Override label for hero@desktop" }),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Override label for hero@desktop" }));
    const reopened = screen.getByLabelText(
      "Override label for hero@desktop",
    ) as HTMLInputElement;
    expect(reopened.value).toBe("hero");
  });
});

// ─── Library filter ──────────────────────────────────────────────────────────

describe("Identity inventory: library filter", () => {
  it("badges a row bound to a component-registry source", async () => {
    const bridge = makeBridge();
    const { container } = await renderInventory(bridge);

    expect(within(rowFor(container, "n-hero")).getByText("figma-document")).toBeInTheDocument();
  });

  it("hides a badged row when its source is deselected, without hiding unbadged rows", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const { container } = await renderInventory(bridge);

    const filterGroup = screen.getByRole("toolbar", {
      name: "Filter by component-registry source",
    });
    await user.click(within(filterGroup).getByRole("button", { name: "figma-document" }));

    await waitFor(() => {
      expect(container.querySelector('[data-durable-id="n-hero"]')).not.toBeInTheDocument();
    });
    expect(container.querySelector('[data-durable-id="n-cta"]')).toBeInTheDocument();
  });
});

// ─── Apply / write-back (Task 14) ────────────────────────────────────────────
//
// Fixture recap: n-hero's label is inferred+unconfirmed (no confidence field
// — the flag-eligible bucket) and its viewport is inferred+high+unconfirmed
// (also flag-eligible) — so by planIdentityWriteback's gate, n-hero is HELD
// until "include unconfirmed suggestions (flagged)" is turned on. n-cta's
// theme is inferred+LOW+unconfirmed — hold-low ALWAYS vetoes it, flag or not.

describe("Identity inventory: apply gating (default, includeFlagged off)", () => {
  it("disables Apply on a row held by an unconfirmed (flag-eligible) label/coordinate", async () => {
    const bridge = makeBridge();
    await renderInventory(bridge);

    const btn = screen.getByRole("button", { name: "Apply hero@desktop" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      "title",
      expect.stringContaining("include unconfirmed suggestions (flagged)"),
    );
  });

  it("disables Apply on a row held by a low-confidence coordinate", async () => {
    const bridge = makeBridge();
    await renderInventory(bridge);

    const btn = screen.getByRole("button", { name: "Apply hero/cta-button@desktop" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "low-confidence, needs confirmation");
  });

  it("'Apply all' is disabled with no count when nothing is currently applyable", async () => {
    const bridge = makeBridge();
    await renderInventory(bridge);

    const btn = screen.getByRole("button", { name: "Apply all" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Apply all");
    expect(btn).not.toHaveTextContent("(");
  });
});

describe("Identity inventory: includeFlagged toggle", () => {
  it("is labeled exactly 'include unconfirmed suggestions (flagged)'", async () => {
    const bridge = makeBridge();
    await renderInventory(bridge);

    expect(
      screen.getByLabelText("include unconfirmed suggestions (flagged)"),
    ).not.toBeChecked();
  });

  it("enables the flag-eligible row's Apply once checked, but never the low-confidence row's", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    await renderInventory(bridge);

    await user.click(screen.getByLabelText("include unconfirmed suggestions (flagged)"));

    expect(screen.getByRole("button", { name: "Apply hero@desktop" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Apply hero/cta-button@desktop" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply all" })).toHaveTextContent(
      "Apply all (1)",
    );
  });
});

describe("Identity inventory: per-row Apply fires the planner's exact rename", () => {
  it("sends requestIdentityApply with the planned rename for a plain FRAME (full address as newName)", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const { bus } = await renderInventory(bridge);

    await user.click(screen.getByLabelText("include unconfirmed suggestions (flagged)"));
    await user.click(screen.getByRole("button", { name: "Apply hero@desktop" }));

    expect(bus.requestIdentityApply).toHaveBeenCalledWith([
      { figmaNodeId: "fig-n-hero", durableId: "n-hero", newName: "hero@desktop" },
    ]);
  });

  it("on ack, stamps POST /project/identity/applied with the record's full canonical address and invalidates the manifest query", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const { bus } = await renderInventory(bridge);
    const callsBefore = (bridge.getIdentityManifest as ReturnType<typeof vi.fn>).mock.calls
      .length;

    await user.click(screen.getByLabelText("include unconfirmed suggestions (flagged)"));
    await user.click(screen.getByRole("button", { name: "Apply hero@desktop" }));

    bus.emitIdentityApplied({
      applied: [{ durableId: "n-hero", newName: "hero@desktop" }],
      failed: [],
    });

    await waitFor(() =>
      expect(bridge.postIdentityApplied).toHaveBeenCalledWith([
        { durableId: "n-hero", appliedAddress: "hero@desktop" },
      ]),
    );
    await waitFor(() =>
      expect(
        (bridge.getIdentityManifest as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(callsBefore),
    );
  });

  it("surfaces a failed apply via toast without stamping it", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge();
    const { bus } = await renderInventory(bridge);

    await user.click(screen.getByLabelText("include unconfirmed suggestions (flagged)"));
    await user.click(screen.getByRole("button", { name: "Apply hero@desktop" }));

    bus.emitIdentityApplied({
      applied: [],
      failed: [{ durableId: "n-hero", error: "node fig-n-hero not found" }],
    });

    await waitFor(() => {
      const toasts = useAppStore.getState().toasts;
      expect(toasts.some((t) => t.message.includes("node fig-n-hero not found"))).toBe(true);
    });
    expect(bridge.postIdentityApplied).not.toHaveBeenCalled();
  });
});

describe("Identity inventory: applied badge", () => {
  it("shows an Applied badge instead of the Apply button once address === appliedAddress", async () => {
    const applied = { ...heroRecord, appliedAddress: "hero@desktop" };
    const bridge = makeBridge({
      getIdentityManifest: vi.fn().mockResolvedValue({
        manifest: { version: 1, records: { "n-hero": applied, "n-cta": ctaRecord } },
      }),
    });
    await renderInventory(bridge);

    expect(screen.queryByRole("button", { name: "Apply hero@desktop" })).not.toBeInTheDocument();
    const heroText = screen.getByText("Applied");
    expect(heroText).toBeInTheDocument();
  });

  it("still shows the Apply button for a row whose address has drifted from its appliedAddress", async () => {
    const drifted = { ...heroRecord, appliedAddress: "old-hero@desktop" };
    const bridge = makeBridge({
      getIdentityManifest: vi.fn().mockResolvedValue({
        manifest: { version: 1, records: { "n-hero": drifted, "n-cta": ctaRecord } },
      }),
    });
    await renderInventory(bridge);

    expect(screen.getByRole("button", { name: "Apply hero@desktop" })).toBeInTheDocument();
  });
});

describe("Identity inventory: 'Apply all' scoped to visible rows", () => {
  it("excludes a row hidden by the library filter, mirroring 'Confirm all high-confidence'", async () => {
    const user = userEvent.setup();
    const twoSourceRegistry: ComponentTypeEntry[] = [
      { key: "comp-a", roleName: "section-a", source: "figma-document", matchability: "matchable" },
      { key: "comp-b", roleName: "section-b", source: "figma-library", matchability: "matchable" },
    ];
    const recA = makeRecord({
      durableId: "n-a",
      address: "a@desktop",
      currentName: "A",
      definitionRef: "comp-a",
      path: [{ label: "a", provenance: "derived" }],
    });
    const recB = makeRecord({
      durableId: "n-b",
      address: "b@desktop",
      currentName: "B",
      definitionRef: "comp-b",
      path: [{ label: "b", provenance: "derived" }],
    });
    const bridge = makeBridge({
      getIdentityManifest: vi.fn().mockResolvedValue({
        manifest: { version: 1, records: { "n-a": recA, "n-b": recB } },
      }),
      getIdentityComponents: vi.fn().mockResolvedValue({ components: twoSourceRegistry }),
    });
    const bus = makeBus();
    await renderWithProviders(<Components bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/components"],
    });
    await screen.findByText("a@desktop");
    await screen.findByText("b@desktop");

    expect(screen.getByRole("button", { name: "Apply all" })).toHaveTextContent(
      "Apply all (2)",
    );

    const filterGroup = screen.getByRole("toolbar", {
      name: "Filter by component-registry source",
    });
    await user.click(within(filterGroup).getByRole("button", { name: "figma-library" }));
    await waitFor(() => expect(screen.queryByText("b@desktop")).not.toBeInTheDocument());

    const btn = screen.getByRole("button", { name: "Apply all" });
    expect(btn).toHaveTextContent("Apply all (1)");
    await user.click(btn);

    expect(bus.requestIdentityApply).toHaveBeenCalledWith([
      { figmaNodeId: "fig-n-a", durableId: "n-a", newName: "a@desktop" },
    ]);
  });
});

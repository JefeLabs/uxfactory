import { describe, it, expect } from "vitest";
import type { NodeIdentityRecord, PathSegment, ProvenancedValue } from "@uxfactory/spec";
import { planIdentityWriteback } from "./identity-apply.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function label(overrides: Partial<PathSegment> & { label: string }): PathSegment {
  return { provenance: "derived", ...overrides };
}

function coord(overrides: Partial<ProvenancedValue> & { value: string }): ProvenancedValue {
  return { provenance: "derived", ...overrides };
}

function record(overrides: Partial<NodeIdentityRecord> & { durableId: string }): NodeIdentityRecord {
  return {
    figmaNodeId: `fig-${overrides.durableId}`,
    address: `${overrides.durableId}@desktop`,
    scope: [],
    path: [label({ label: overrides.durableId })],
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

// ---------------------------------------------------------------------------
// Storage split (grammar §3.1)
// ---------------------------------------------------------------------------

describe("planIdentityWriteback: storage split", () => {
  it("a plain FRAME gets the full address string as its stored name", () => {
    const rec = record({
      durableId: "n-hero",
      kind: "FRAME",
      address: "home/hero@desktop",
      path: [label({ label: "hero", provenance: "derived" })],
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(held).toEqual([]);
    expect(renames).toEqual([
      { figmaNodeId: "fig-n-hero", durableId: "n-hero", newName: "home/hero@desktop" },
    ]);
  });

  it("a GROUP (also non-component) gets the full address string", () => {
    const rec = record({ durableId: "n-group", kind: "GROUP", address: "home/group@desktop" });
    const { renames } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(renames).toEqual([
      { figmaNodeId: "fig-n-group", durableId: "n-group", newName: "home/group@desktop" },
    ]);
  });

  it("an INSTANCE gets the LABEL ONLY — not the full address", () => {
    const rec = record({
      durableId: "n-button",
      kind: "INSTANCE",
      address: "hero/button@desktop",
      path: [
        label({ label: "hero", provenance: "derived" }),
        label({ label: "button", provenance: "derived" }),
      ],
    });
    const { renames } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(renames).toEqual([
      { figmaNodeId: "fig-n-button", durableId: "n-button", newName: "button" },
    ]);
  });

  it("a COMPONENT gets the label only", () => {
    const rec = record({
      durableId: "n-def",
      kind: "COMPONENT",
      address: "button@desktop",
      path: [label({ label: "button", provenance: "derived" })],
    });
    const { renames } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(renames).toEqual([{ figmaNodeId: "fig-n-def", durableId: "n-def", newName: "button" }]);
  });

  it("a COMPONENT_SET gets the label only", () => {
    const rec = record({
      durableId: "n-set",
      kind: "COMPONENT_SET",
      address: "button@desktop",
      path: [label({ label: "button", provenance: "derived" })],
    });
    const { renames } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(renames).toEqual([{ figmaNodeId: "fig-n-set", durableId: "n-set", newName: "button" }]);
  });

  it("an INSTANCE's stored name drops the ordinal suffix (ordinal is render-only)", () => {
    const rec = record({
      durableId: "n-button2",
      kind: "INSTANCE",
      address: "hero/button#2@desktop",
      path: [
        label({ label: "hero", provenance: "derived" }),
        label({ label: "button", ordinal: 2, provenance: "derived" }),
      ],
    });
    const { renames } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(renames).toEqual([
      { figmaNodeId: "fig-n-button2", durableId: "n-button2", newName: "button" },
    ]);
  });

  it("an INSTANCE with off-default coordinates still writes only its label — coordinates are never appended (no variant-prop authoring)", () => {
    const rec = record({
      durableId: "n-cta",
      kind: "INSTANCE",
      address: "hero/cta@mobile@theme=students",
      path: [
        label({ label: "hero", provenance: "derived" }),
        label({ label: "cta", provenance: "derived" }),
      ],
      coordinates: {
        viewport: coord({ value: "mobile", provenance: "derived" }),
        theme: coord({ value: "students", provenance: "derived" }),
      },
    });
    const { renames } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(renames).toEqual([{ figmaNodeId: "fig-n-cta", durableId: "n-cta", newName: "cta" }]);
  });
});

// ---------------------------------------------------------------------------
// Gating — derived / elicited / confirmed-inferred apply freely
// ---------------------------------------------------------------------------

describe("planIdentityWriteback: gating — settled segments apply freely", () => {
  it("a derived label + derived coordinates apply with includeFlagged:false", () => {
    const rec = record({
      durableId: "n-a",
      path: [label({ label: "a", provenance: "derived" })],
      coordinates: { viewport: coord({ value: "desktop", provenance: "derived" }) },
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(held).toEqual([]);
    expect(renames).toHaveLength(1);
  });

  it("an elicited (user-overridden) label + coordinate apply freely", () => {
    const rec = record({
      durableId: "n-b",
      path: [label({ label: "b", provenance: "elicited", source: "user" })],
      coordinates: { theme: coord({ value: "students", provenance: "elicited", source: "user" }) },
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(held).toEqual([]);
    expect(renames).toHaveLength(1);
  });

  it("a defaulted coordinate (registry default, already settled) applies freely", () => {
    const rec = record({
      durableId: "n-c",
      coordinates: { state: coord({ value: "default", provenance: "defaulted" }) },
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(held).toEqual([]);
    expect(renames).toHaveLength(1);
  });

  it("a CONFIRMED inferred label applies freely, even with includeFlagged:false", () => {
    const rec = record({
      durableId: "n-d",
      path: [label({ label: "d", provenance: "inferred", confirmed: true })],
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(held).toEqual([]);
    expect(renames).toHaveLength(1);
  });

  it("a CONFIRMED inferred high-confidence coordinate applies freely", () => {
    const rec = record({
      durableId: "n-e",
      coordinates: {
        viewport: coord({ value: "desktop", provenance: "inferred", confidence: "high", confirmed: true }),
      },
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(held).toEqual([]);
    expect(renames).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Gating — unconfirmed inferred, high confidence (apply-with-flag)
// ---------------------------------------------------------------------------

describe("planIdentityWriteback: gating — unconfirmed inferred, high confidence", () => {
  it("is HELD when includeFlagged is false", () => {
    const rec = record({
      durableId: "n-f",
      coordinates: {
        viewport: coord({ value: "desktop", provenance: "inferred", confidence: "high", confirmed: false }),
      },
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(renames).toEqual([]);
    expect(held).toEqual([{ durableId: "n-f", reason: expect.stringContaining("unconfirmed") }]);
  });

  it("is APPLIED when includeFlagged is true (apply-with-flag)", () => {
    const rec = record({
      durableId: "n-g",
      coordinates: {
        viewport: coord({ value: "desktop", provenance: "inferred", confidence: "high", confirmed: false }),
      },
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: true });
    expect(held).toEqual([]);
    expect(renames).toHaveLength(1);
  });

  it("an unconfirmed inferred label (no confidence field at all) is treated as the high/unspecified bucket — held unless includeFlagged", () => {
    const withoutFlag = record({
      durableId: "n-h",
      path: [label({ label: "h", provenance: "inferred", confirmed: false })],
    });
    const heldResult = planIdentityWriteback([withoutFlag], { includeFlagged: false });
    expect(heldResult.renames).toEqual([]);
    expect(heldResult.held).toHaveLength(1);

    const flaggedResult = planIdentityWriteback([withoutFlag], { includeFlagged: true });
    expect(flaggedResult.held).toEqual([]);
    expect(flaggedResult.renames).toHaveLength(1);
  });

  it("an unconfirmed inferred coordinate with confidence explicitly unset behaves like high — held unless includeFlagged", () => {
    const rec = record({
      durableId: "n-i",
      coordinates: { mode: coord({ value: "dark", provenance: "inferred", confirmed: false }) },
    });
    const withoutFlag = planIdentityWriteback([rec], { includeFlagged: false });
    expect(withoutFlag.renames).toEqual([]);
    const withFlag = planIdentityWriteback([rec], { includeFlagged: true });
    expect(withFlag.held).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Gating — unconfirmed inferred, LOW confidence: always held
// ---------------------------------------------------------------------------

describe("planIdentityWriteback: gating — unconfirmed inferred, low confidence always held", () => {
  it("is held even when includeFlagged is true", () => {
    const rec = record({
      durableId: "n-j",
      coordinates: {
        theme: coord({ value: "students", provenance: "inferred", confidence: "low", confirmed: false }),
      },
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: true });
    expect(renames).toEqual([]);
    expect(held).toEqual([{ durableId: "n-j", reason: "low-confidence, needs confirmation" }]);
  });

  it("is held when includeFlagged is false", () => {
    const rec = record({
      durableId: "n-k",
      coordinates: {
        state: coord({ value: "hover", provenance: "inferred", confidence: "low", confirmed: false }),
      },
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: false });
    expect(renames).toEqual([]);
    expect(held).toEqual([{ durableId: "n-k", reason: "low-confidence, needs confirmation" }]);
  });

  it("low-confidence on ANY one segment vetoes the whole record even if another segment is only flag-eligible", () => {
    const rec = record({
      durableId: "n-l",
      path: [label({ label: "l", provenance: "inferred", confirmed: false })], // flag-eligible
      coordinates: {
        theme: coord({ value: "students", provenance: "inferred", confidence: "low", confirmed: false }), // low
      },
    });
    const { renames, held } = planIdentityWriteback([rec], { includeFlagged: true });
    expect(renames).toEqual([]);
    expect(held).toEqual([{ durableId: "n-l", reason: "low-confidence, needs confirmation" }]);
  });
});

// ---------------------------------------------------------------------------
// Held records are never silently dropped — every input record appears in
// exactly one of renames/held.
// ---------------------------------------------------------------------------

describe("planIdentityWriteback: held records are never dropped", () => {
  it("every record lands in exactly one of renames or held", () => {
    const settled = record({ durableId: "n-settled" });
    const flaggable = record({
      durableId: "n-flaggable",
      path: [label({ label: "flaggable", provenance: "inferred", confirmed: false })],
    });
    const low = record({
      durableId: "n-low",
      coordinates: {
        mode: coord({ value: "dark", provenance: "inferred", confidence: "low", confirmed: false }),
      },
    });
    const { renames, held } = planIdentityWriteback([settled, flaggable, low], {
      includeFlagged: false,
    });
    expect(renames.map((r) => r.durableId).sort()).toEqual(["n-settled"]);
    expect(held.map((h) => h.durableId).sort()).toEqual(["n-flaggable", "n-low"]);
  });

  it("held reasons distinguish low-confidence from unconfirmed-needs-flag", () => {
    const flaggable = record({
      durableId: "n-flaggable2",
      path: [label({ label: "flaggable2", provenance: "inferred", confirmed: false })],
    });
    const low = record({
      durableId: "n-low2",
      coordinates: {
        mode: coord({ value: "dark", provenance: "inferred", confidence: "low", confirmed: false }),
      },
    });
    const { held } = planIdentityWriteback([flaggable, low], { includeFlagged: false });
    const byId = Object.fromEntries(held.map((h) => [h.durableId, h.reason]));
    expect(byId["n-low2"]).toBe("low-confidence, needs confirmation");
    expect(byId["n-flaggable2"]).not.toBe("low-confidence, needs confirmation");
    expect(byId["n-flaggable2"]).toMatch(/unconfirmed/i);
  });

  it("returns empty renames/held for an empty input", () => {
    expect(planIdentityWriteback([], { includeFlagged: false })).toEqual({ renames: [], held: [] });
  });
});

// ---------------------------------------------------------------------------
// Defensive tolerance for a partial/legacy record (missing path/coordinates)
// — mirrors IdentityInventory.tsx's own `record.path ?? []` /
// `record.coordinates ?? {}` convention for minimal test fixtures.
// ---------------------------------------------------------------------------

describe("planIdentityWriteback: tolerates a minimal record missing path/coordinates", () => {
  it("a record with no path/coordinates fields at all applies using its address, no crash", () => {
    const minimal = { durableId: "n-minimal", figmaNodeId: "fig-n-minimal", address: "minimal@desktop" } as unknown as NodeIdentityRecord;
    const { renames, held } = planIdentityWriteback([minimal], { includeFlagged: false });
    expect(held).toEqual([]);
    expect(renames).toEqual([
      { figmaNodeId: "fig-n-minimal", durableId: "n-minimal", newName: "minimal@desktop" },
    ]);
  });
});

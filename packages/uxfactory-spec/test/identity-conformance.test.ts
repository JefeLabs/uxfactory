/**
 * identity-conformance.test.ts — pure fixture tests for the five
 * deterministic node-identity conformance checks (task-15-brief.md, Phase 5).
 *
 * Each check gets a firing case AND a passing/vacuous case, matching the
 * task's TDD instructions: address-validity catches an unparseable address
 * (a registry change invalidates a previously-good name); drift surfaces a
 * warning naming the matched component; composed-node conformance warns on
 * the PARENT when an INSTANCE child is unbound; the two route checks are
 * vacuous-green with no routes and fire on a genuine mismatch (constructed
 * fixtures — the real story schema carries no route field yet, see
 * identity-conformance.ts's module doc).
 */
import { describe, it, expect } from "vitest";
import {
  checkAddressValidity,
  checkComposedNodeConformance,
  checkDriftSurfacing,
  checkNavConsumesAnchors,
  checkRouteTraceableStories,
  runConformanceChecks,
  CONFORMANCE_CHECKS,
} from "../src/identity-conformance.js";
import {
  defaultIdentityRegistries,
  type ComponentTypeEntry,
  type IdentityRegistries,
  type NodeIdentityRecord,
  type NodeManifest,
} from "../src/node-identity.js";

// ─── fixture helpers ─────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<NodeIdentityRecord> & { durableId: string }): NodeIdentityRecord {
  const { durableId } = overrides;
  return {
    figmaNodeId: `f-${durableId}`,
    address: durableId,
    scope: [],
    path: [{ label: durableId, provenance: "derived", source: "structure" }],
    coordinates: {},
    kind: "FRAME",
    pathRoleDefault: "section",
    isDefinition: false,
    composition: [],
    currentName: durableId,
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function manifestOf(records: NodeIdentityRecord[]): NodeManifest {
  return { version: 1, records: Object.fromEntries(records.map((r) => [r.durableId, r])) };
}

// ─── 1. address validity ─────────────────────────────────────────────────────

describe("checkAddressValidity", () => {
  it("passes a record whose address still parses against the current registries", () => {
    const registries = defaultIdentityRegistries();
    const manifest = manifestOf([makeRecord({ durableId: "n-hero", address: "hero@desktop" })]);
    expect(checkAddressValidity(manifest, registries)).toEqual([]);
  });

  it("errors when a registry edit invalidates a previously-good address (e.g. the 'desktop' band was removed)", () => {
    const shrunkRegistries: IdentityRegistries = {
      ...defaultIdentityRegistries(),
      breakpoints: { bands: [{ name: "mobile", min: 0, max: null }] },
    };
    const manifest = manifestOf([makeRecord({ durableId: "n-hero", address: "hero@desktop" })]);
    const findings = checkAddressValidity(manifest, shrunkRegistries);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: "error", check: "address-validity", durableId: "n-hero" });
    expect(findings[0]!.message).toMatch(/hero@desktop/);
  });
});

// ─── 2. drift surfacing ──────────────────────────────────────────────────────

describe("checkDriftSurfacing", () => {
  const components: ComponentTypeEntry[] = [
    { key: "button-key", roleName: "button", source: "figma-document", matchability: "matchable" },
  ];

  it("warns 'should rebind' and names the matched component when definitionRef is present", () => {
    const manifest = manifestOf([
      makeRecord({
        durableId: "n-cta",
        address: "cta@desktop",
        resolutionStatus: "drifted",
        definitionRef: "button-key",
      }),
    ]);
    const findings = checkDriftSurfacing(manifest, components);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: "warn", check: "drift-surfacing", durableId: "n-cta" });
    expect(findings[0]!.message).toMatch(/should rebind/);
    expect(findings[0]!.message).toMatch(/"button"/);
  });

  it("still warns, without a component name, when definitionRef is absent or unmatched", () => {
    const manifest = manifestOf([
      makeRecord({ durableId: "n-cta", address: "cta@desktop", resolutionStatus: "drifted" }),
    ]);
    const findings = checkDriftSurfacing(manifest, components);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/should rebind/);
    expect(findings[0]!.message).not.toMatch(/from "/);
  });

  it("is silent for bound/custom/unset resolutionStatus", () => {
    const manifest = manifestOf([
      makeRecord({ durableId: "n-a", resolutionStatus: "bound" }),
      makeRecord({ durableId: "n-b", resolutionStatus: "custom" }),
      makeRecord({ durableId: "n-c" }),
    ]);
    expect(checkDriftSurfacing(manifest, components)).toEqual([]);
  });
});

// ─── 3. composed-node conformance ────────────────────────────────────────────

describe("checkComposedNodeConformance", () => {
  it("warns on the PARENT when an INSTANCE-kind child is unbound (drifted)", () => {
    const manifest = manifestOf([
      makeRecord({ durableId: "n-card", address: "login-card@desktop", composition: ["n-avatar", "n-button"] }),
      makeRecord({ durableId: "n-avatar", address: "login-card/avatar@desktop", kind: "INSTANCE", resolutionStatus: "bound" }),
      makeRecord({ durableId: "n-button", address: "login-card/button@desktop", kind: "INSTANCE", resolutionStatus: "drifted" }),
    ]);
    const findings = checkComposedNodeConformance(manifest);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: "warn", check: "composed-node-conformance", durableId: "n-card" });
    expect(findings[0]!.message).toMatch(/conforms iff its parts are governed/);
    expect(findings[0]!.message).toMatch(/login-card\/button@desktop/);
  });

  it("passes when every INSTANCE child is bound", () => {
    const manifest = manifestOf([
      makeRecord({ durableId: "n-card", composition: ["n-avatar"] }),
      makeRecord({ durableId: "n-avatar", kind: "INSTANCE", resolutionStatus: "bound" }),
    ]);
    expect(checkComposedNodeConformance(manifest)).toEqual([]);
  });

  it("ignores non-INSTANCE children (unbound status irrelevant) and composition entries outside manifest scope", () => {
    const manifest = manifestOf([
      makeRecord({ durableId: "n-card", composition: ["n-frame-child", "n-ghost"] }),
      makeRecord({ durableId: "n-frame-child", kind: "FRAME" }), // no resolutionStatus at all, but not an INSTANCE
    ]);
    expect(checkComposedNodeConformance(manifest)).toEqual([]);
  });

  it("is vacuous for records with empty composition", () => {
    const manifest = manifestOf([makeRecord({ durableId: "n-leaf" })]);
    expect(checkComposedNodeConformance(manifest)).toEqual([]);
  });
});

// ─── 4. route-traceable stories ──────────────────────────────────────────────

describe("checkRouteTraceableStories", () => {
  it("is vacuous-green with no story route promises (today's real-world case — see module doc)", () => {
    const manifest = manifestOf([makeRecord({ durableId: "n-pricing", route: "/pricing" })]);
    expect(checkRouteTraceableStories(manifest, [])).toEqual([]);
  });

  it("warns when a promised route has no manifest record claiming it", () => {
    const manifest = manifestOf([makeRecord({ durableId: "n-pricing", route: "/pricing" })]);
    const findings = checkRouteTraceableStories(manifest, [{ storyId: "s-checkout", route: "/checkout" }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: "warn", check: "route-traceable-stories" });
    expect(findings[0]!.message).toMatch(/s-checkout/);
    expect(findings[0]!.message).toMatch(/\/checkout/);
  });

  it("passes when a manifest record claims the promised route", () => {
    const manifest = manifestOf([makeRecord({ durableId: "n-pricing", route: "/pricing" })]);
    expect(checkRouteTraceableStories(manifest, [{ storyId: "s-pricing", route: "/pricing" }])).toEqual([]);
  });
});

// ─── 5. nav-consumes-anchors ─────────────────────────────────────────────────

describe("checkNavConsumesAnchors", () => {
  it("is vacuous-green when no record carries a route at all", () => {
    const manifest = manifestOf([makeRecord({ durableId: "n-nav-link", currentName: "Nav Link" })]);
    expect(checkNavConsumesAnchors(manifest)).toEqual([]);
  });

  it("warns when a nav/link-labeled record's route matches no OTHER record's route (broken reference)", () => {
    const manifest = manifestOf([
      makeRecord({
        durableId: "n-nav-pricing",
        path: [{ label: "nav-pricing", provenance: "derived", source: "structure" }],
        route: "/pricing",
      }),
    ]);
    const findings = checkNavConsumesAnchors(manifest);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: "warn", check: "nav-consumes-anchors", durableId: "n-nav-pricing" });
    expect(findings[0]!.message).toMatch(/broken reference/);
  });

  it("matches on the raw currentName too (not just the canonical label)", () => {
    const manifest = manifestOf([
      makeRecord({ durableId: "n-footer-link", currentName: "Footer Link", route: "/about" }),
    ]);
    expect(checkNavConsumesAnchors(manifest)).toHaveLength(1);
  });

  it("passes when a DIFFERENT record claims the nav item's route as its own anchor", () => {
    const manifest = manifestOf([
      makeRecord({
        durableId: "n-nav-pricing",
        path: [{ label: "nav-pricing", provenance: "derived", source: "structure" }],
        route: "/pricing",
      }),
      makeRecord({ durableId: "n-pricing-page", route: "/pricing" }),
    ]);
    expect(checkNavConsumesAnchors(manifest)).toEqual([]);
  });

  it("ignores a routed record whose label doesn't look like nav/link", () => {
    const manifest = manifestOf([makeRecord({ durableId: "n-pricing-page", route: "/pricing" })]);
    expect(checkNavConsumesAnchors(manifest)).toEqual([]);
  });
});

// ─── runConformanceChecks ────────────────────────────────────────────────────

describe("runConformanceChecks", () => {
  it("concatenates every check's findings in CONFORMANCE_CHECKS order and defaults storyRoutes to []", () => {
    const registries = defaultIdentityRegistries();
    const components: ComponentTypeEntry[] = [];
    const manifest = manifestOf([
      makeRecord({ durableId: "n-bad-address", address: "" }), // fails to parse -> error
      makeRecord({ durableId: "n-drifted", resolutionStatus: "drifted" }), // warn
    ]);
    const findings = runConformanceChecks({ manifest, registries, components });
    expect(findings.map((f) => f.check)).toEqual(["address-validity", "drift-surfacing"]);
    expect(findings[0]!.level).toBe("error");
    expect(findings[1]!.level).toBe("warn");
    // Every finding's check name is one of the five known checks, in the canonical set.
    for (const f of findings) expect(CONFORMANCE_CHECKS).toContain(f.check);
  });
});

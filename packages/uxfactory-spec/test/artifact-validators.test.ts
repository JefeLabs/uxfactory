/**
 * artifact-validators.test.ts — deterministic quality gate for intent artifacts.
 *
 * The product verifies designs against registered intent; these validators
 * verify the INTENT itself before anything downstream consumes it. Pure,
 * deterministic (schema · referential integrity · computed contrast), no LLM —
 * the fast inner loop a producer iterates against. A finding of severity
 * "error" fails; "warn" advises.
 */
import { describe, it, expect } from "vitest";
import { validateArtifact, contrastRatio } from "../src/artifact-validators.js";

describe("contrastRatio (WCAG)", () => {
  it("black on white is 21:1; identical colors are 1:1", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });
});

describe("validateArtifact: brand-colors", () => {
  it("errors when no color is present", () => {
    const r = validateArtifact("brand-colors", { version: 1 });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.severity === "error" && /no color/i.test(f.message))).toBe(true);
  });

  it("errors on a malformed hex under a color key", () => {
    const r = validateArtifact("brand-colors", { anchors: { primary: "#5B5BD6" }, neutrals: { "text.primary": "notahex" } });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.severity === "error" && /text\.primary/.test(f.path ?? ""))).toBe(true);
  });

  it("warns when text-on-surface contrast is below AA (4.5:1)", () => {
    const low = validateArtifact("brand-colors", { neutrals: { "text.primary": "#999999", surface: "#ffffff" } });
    expect(low.findings.some((f) => f.severity === "warn" && /contrast/i.test(f.message))).toBe(true);
    const ok = validateArtifact("brand-colors", { neutrals: { "text.primary": "#111111", surface: "#ffffff" } });
    expect(ok.findings.some((f) => /contrast/i.test(f.message))).toBe(false);
  });
});

describe("validateArtifact: features (referential integrity)", () => {
  const ctx = { storyIds: new Set(["browse-faq", "contact-support"]) };
  it("errors when a storyRef resolves to no registered story", () => {
    const r = validateArtifact("features", { features: [{ featureId: "F-01", storyRefs: ["browse-faq", "ghost"] }] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.severity === "error" && /ghost/.test(f.message))).toBe(true);
  });
  it("warns on a feature with no stories; passes clean refs", () => {
    const warn = validateArtifact("features", { features: [{ featureId: "F-02", storyRefs: [] }] }, ctx);
    expect(warn.findings.some((f) => f.severity === "warn")).toBe(true);
    const clean = validateArtifact("features", { features: [{ featureId: "F-01", storyRefs: ["browse-faq"] }] }, ctx);
    expect(clean.ok).toBe(true);
  });
});

describe("validateArtifact: audience", () => {
  it("errors when primarySegment names no segment; warns when shares don't sum to ~1", () => {
    const bad = validateArtifact("audience", {
      segments: [{ name: "a", share: 0.3 }, { name: "b", share: 0.3 }],
      primarySegment: "ghost",
    });
    expect(bad.ok).toBe(false);
    expect(bad.findings.some((f) => f.severity === "error" && /primary/i.test(f.message))).toBe(true);
    expect(bad.findings.some((f) => f.severity === "warn" && /sum/i.test(f.message))).toBe(true);
  });
  it("passes a well-formed audience", () => {
    const good = validateArtifact("audience", {
      segments: [{ name: "a", share: 0.6 }, { name: "b", share: 0.4 }],
      primarySegment: "a",
    });
    expect(good.ok).toBe(true);
  });
});

describe("validateArtifact: personas (set — array body)", () => {
  it("errors on fewer than two and on duplicate ids; warns on missing goals/frustrations", () => {
    const one = validateArtifact("personas", [{ personaId: "x", name: "X", goals: ["g"], frustrations: ["f"] }]);
    expect(one.findings.some((f) => f.severity === "error" && /two/i.test(f.message))).toBe(true);

    const dup = validateArtifact("personas", [
      { personaId: "x", name: "X", goals: ["g"], frustrations: ["f"] },
      { personaId: "x", name: "Y", goals: ["g"], frustrations: ["f"] },
    ]);
    expect(dup.findings.some((f) => f.severity === "error" && /duplicate/i.test(f.message))).toBe(true);

    const thin = validateArtifact("personas", [
      { personaId: "a", name: "A", goals: ["g"] },
      { personaId: "b", name: "B", goals: ["g"], frustrations: ["f"] },
    ]);
    expect(thin.findings.some((f) => f.severity === "warn" && /frustration/i.test(f.message))).toBe(true);
  });
});

describe("validateArtifact: stories (set — actor integrity)", () => {
  const ctx = { personaIds: new Set(["visitor"]) };
  it("errors when a story's actor is not a registered persona", () => {
    const r = validateArtifact("stories", [
      { storyId: "s1", actor: "ghost", acceptanceCriteria: [{ acId: "AC-1" }] },
    ], ctx);
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.severity === "error" && /actor/i.test(f.message))).toBe(true);
  });
  it("warns on a story with no acceptance criteria", () => {
    const r = validateArtifact("stories", [{ storyId: "s1", actor: "visitor", acceptanceCriteria: [] }], ctx);
    expect(r.findings.some((f) => f.severity === "warn" && /acceptance/i.test(f.message))).toBe(true);
  });
});

describe("validateArtifact: sitemap + copy-deck + unknown", () => {
  it("sitemap: a featureRef resolving to no feature is an error", () => {
    const r = validateArtifact("sitemap", { nodes: [{ nodeId: "N", title: "Home", featureRefs: ["F-99"] }] }, { featureIds: new Set(["F-01"]) });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => /F-99/.test(f.message))).toBe(true);
  });
  it("copy-deck: a non-dotted key is an error", () => {
    const r = validateArtifact("copy-deck", { entries: [{ key: "flatkey", text: "x" }] });
    expect(r.ok).toBe(false);
  });
  it("unknown artifact: no rules → ok with no findings", () => {
    expect(validateArtifact("glossary", {})).toEqual({ artifact: "glossary", ok: true, findings: [] });
  });
});

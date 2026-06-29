import { describe, it, expect } from "vitest";
import {
  LEVEL_ORD,
  PRESETS,
  GATE_THRESHOLDS,
  parseScope,
  resolveScope,
  binds,
  bindingGateIds,
  requiredInputs,
  declaredFuture,
  checkReadiness,
} from "../src/batch/scope.js";
import type { RenderScope, Level } from "../src/batch/scope.js";

// ---------------------------------------------------------------------------
// LEVEL_ORD
// ---------------------------------------------------------------------------

describe("LEVEL_ORD ordinal", () => {
  it("none(0) < low(1) < medium(2) < high(3)", () => {
    expect(LEVEL_ORD.none).toBe(0);
    expect(LEVEL_ORD.low).toBe(1);
    expect(LEVEL_ORD.medium).toBe(2);
    expect(LEVEL_ORD.high).toBe(3);
    expect(LEVEL_ORD.none).toBeLessThan(LEVEL_ORD.low);
    expect(LEVEL_ORD.low).toBeLessThan(LEVEL_ORD.medium);
    expect(LEVEL_ORD.medium).toBeLessThan(LEVEL_ORD.high);
  });
});

// ---------------------------------------------------------------------------
// PRESETS
// ---------------------------------------------------------------------------

describe("PRESETS (§4 table, verbatim)", () => {
  it("wireframe = (low,low,low,low)", () => {
    expect(PRESETS.wireframe).toEqual({ visual: "low", editorial: "low", coverage: "low", flow: "low" });
  });
  it("content = (low,high,medium,low)", () => {
    expect(PRESETS.content).toEqual({ visual: "low", editorial: "high", coverage: "medium", flow: "low" });
  });
  it("visual = (high,medium,medium,medium)", () => {
    expect(PRESETS.visual).toEqual({ visual: "high", editorial: "medium", coverage: "medium", flow: "medium" });
  });
  it("interactive = (high,high,high,high)", () => {
    expect(PRESETS.interactive).toEqual({ visual: "high", editorial: "high", coverage: "high", flow: "high" });
  });
  it("production = (high,high,high,high)", () => {
    expect(PRESETS.production).toEqual({ visual: "high", editorial: "high", coverage: "high", flow: "high" });
  });
});

// ---------------------------------------------------------------------------
// parseScope
// ---------------------------------------------------------------------------

describe("parseScope", () => {
  it("accepts each preset name (case-sensitive)", () => {
    for (const name of ["wireframe", "content", "visual", "interactive", "production"] as const) {
      const result = parseScope(name);
      expect(result.ok, `expected ok for preset ${name}`).toBe(true);
      if (result.ok) {
        expect(result.scope).toEqual(PRESETS[name]);
      }
    }
  });

  it("accepts a full explicit vector", () => {
    const result = parseScope({ visual: "high", editorial: "medium", coverage: "low", flow: "high" });
    expect(result).toEqual({
      ok: true,
      scope: { visual: "high", editorial: "medium", coverage: "low", flow: "high" },
    });
  });

  it("accepts a partial vector; missing dials default to low", () => {
    const result = parseScope({ visual: "high" });
    expect(result).toEqual({
      ok: true,
      scope: { visual: "high", editorial: "low", coverage: "low", flow: "low" },
    });
  });

  it("accepts an empty object; all dials default to low", () => {
    const result = parseScope({});
    expect(result).toEqual({
      ok: true,
      scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
    });
  });

  it("REJECTS an unknown preset name", () => {
    const result = parseScope("nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });

  it("REJECTS an unknown dial key", () => {
    const result = parseScope({ visual: "low", a11y: "low" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });

  it("REJECTS a non-low/medium/high value", () => {
    const result = parseScope({ visual: "extreme" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });

  it("REJECTS 'none' as a dial value", () => {
    const result = parseScope({ visual: "none" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });

  it("REJECTS numeric dial values", () => {
    const result = parseScope({ visual: 1 } as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveScope
// ---------------------------------------------------------------------------

describe("resolveScope", () => {
  it("returns null when base is undefined", () => {
    expect(resolveScope(undefined, {})).toBeNull();
  });

  it("resolves a preset base with no overrides", () => {
    expect(resolveScope("wireframe", {})).toEqual(PRESETS.wireframe);
  });

  it('resolveScope("wireframe", {visual:"high"}) → {visual:high,editorial:low,coverage:low,flow:low}', () => {
    expect(resolveScope("wireframe", { visual: "high" })).toEqual({
      visual: "high",
      editorial: "low",
      coverage: "low",
      flow: "low",
    });
  });

  it("resolves a partial vector base with overrides applied", () => {
    expect(resolveScope({ coverage: "medium" }, { flow: "high" })).toEqual({
      visual: "low",
      editorial: "low",
      coverage: "medium",
      flow: "high",
    });
  });

  it("returns null when base is an invalid preset name", () => {
    expect(resolveScope("not-a-preset", {})).toBeNull();
  });

  it("overrides replace the corresponding dial in the base", () => {
    const scope = resolveScope("visual", { visual: "low" });
    expect(scope).not.toBeNull();
    if (scope) {
      expect(scope.visual).toBe("low");
      expect(scope.editorial).toBe("medium"); // from visual preset
      expect(scope.coverage).toBe("medium");
      expect(scope.flow).toBe("medium");
    }
  });
});

// ---------------------------------------------------------------------------
// GATE_THRESHOLDS
// ---------------------------------------------------------------------------

describe("GATE_THRESHOLDS (§3 table)", () => {
  it("requirement-coverage, reuse, coverage-orphans have min_coverage=low, others none", () => {
    for (const id of ["requirement-coverage", "reuse", "coverage-orphans"]) {
      const t = GATE_THRESHOLDS[id];
      expect(t, `missing gate ${id}`).toBeDefined();
      if (t) {
        expect(t.min_coverage).toBe("low");
        expect(t.min_visual).toBe("none");
        expect(t.min_editorial).toBe("none");
        expect(t.min_flow).toBe("none");
      }
    }
  });
  it("token-conformance has min_visual=medium, others none", () => {
    const t = GATE_THRESHOLDS["token-conformance"];
    expect(t).toBeDefined();
    if (t) {
      expect(t.min_visual).toBe("medium");
      expect(t.min_editorial).toBe("none");
      expect(t.min_coverage).toBe("none");
      expect(t.min_flow).toBe("none");
    }
  });
  it("flow-reachability has min_flow=medium, others none", () => {
    const t = GATE_THRESHOLDS["flow-reachability"];
    expect(t).toBeDefined();
    if (t) {
      expect(t.min_flow).toBe("medium");
      expect(t.min_visual).toBe("none");
      expect(t.min_editorial).toBe("none");
      expect(t.min_coverage).toBe("none");
    }
  });
});

// ---------------------------------------------------------------------------
// binds
// ---------------------------------------------------------------------------

describe("binds (all four dials, LEVEL_ORD comparison)", () => {
  const wireframe: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };
  const visualMed: RenderScope = { visual: "medium", editorial: "low", coverage: "low", flow: "low" };

  it("token-conformance EXCLUDED at visual:low", () => {
    const t = GATE_THRESHOLDS["token-conformance"]!;
    expect(binds(t, wireframe)).toBe(false);
  });
  it("token-conformance INCLUDED at visual:medium", () => {
    const t = GATE_THRESHOLDS["token-conformance"]!;
    expect(binds(t, visualMed)).toBe(true);
  });
  it("flow-reachability INCLUDED at flow:medium, EXCLUDED at flow:low", () => {
    const t = GATE_THRESHOLDS["flow-reachability"]!;
    const flowMed: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "medium" };
    expect(binds(t, flowMed)).toBe(true);
    expect(binds(t, wireframe)).toBe(false);
  });
  it("coverage trio bound at coverage:low (wireframe)", () => {
    for (const id of ["requirement-coverage", "reuse", "coverage-orphans"]) {
      const t = GATE_THRESHOLDS[id]!;
      expect(binds(t, wireframe), `expected ${id} to bind at wireframe`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// bindingGateIds
// ---------------------------------------------------------------------------

describe("bindingGateIds", () => {
  it("at wireframe (low,low,low,low): coverage trio binds, token-conformance and flow-reachability do not", () => {
    const ids = bindingGateIds(PRESETS.wireframe);
    expect(ids).toContain("requirement-coverage");
    expect(ids).toContain("reuse");
    expect(ids).toContain("coverage-orphans");
    expect(ids).not.toContain("token-conformance");
    expect(ids).not.toContain("flow-reachability");
  });

  it("token-conformance excluded at visual:low, included at visual:medium", () => {
    const low: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };
    const med: RenderScope = { visual: "medium", editorial: "low", coverage: "low", flow: "low" };
    expect(bindingGateIds(low)).not.toContain("token-conformance");
    expect(bindingGateIds(med)).toContain("token-conformance");
  });

  it("flow-reachability included at flow:medium, excluded at flow:low", () => {
    const low: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };
    const med: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "medium" };
    expect(bindingGateIds(low)).not.toContain("flow-reachability");
    expect(bindingGateIds(med)).toContain("flow-reachability");
  });

  it("all five gates bind at interactive/production scope", () => {
    const ids = bindingGateIds(PRESETS.interactive);
    expect(ids.sort()).toEqual(
      ["coverage-orphans", "flow-reachability", "requirement-coverage", "reuse", "token-conformance"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// requiredInputs
// ---------------------------------------------------------------------------

describe("requiredInputs (reuse never required)", () => {
  it("stories whenever coverage>=low (always in practice since dials are low|medium|high)", () => {
    expect(requiredInputs(PRESETS.wireframe)).toContain("stories");
    expect(requiredInputs(PRESETS.interactive)).toContain("stories");
  });

  it("tokens only when visual>=medium", () => {
    const low: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };
    const med: RenderScope = { visual: "medium", editorial: "low", coverage: "low", flow: "low" };
    expect(requiredInputs(low)).not.toContain("tokens");
    expect(requiredInputs(med)).toContain("tokens");
    expect(requiredInputs(PRESETS.visual)).toContain("tokens"); // visual preset has visual:high
  });

  it("flow only when flow>=medium", () => {
    const low: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };
    const med: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "medium" };
    expect(requiredInputs(low)).not.toContain("flow");
    expect(requiredInputs(med)).toContain("flow");
    expect(requiredInputs(PRESETS.interactive)).toContain("flow"); // flow:high >= medium
  });

  it("never requires reuse", () => {
    for (const name of ["wireframe", "content", "visual", "interactive", "production"] as const) {
      expect(requiredInputs(PRESETS[name])).not.toContain("reuse");
    }
  });

  it("wireframe: only stories", () => {
    expect(requiredInputs(PRESETS.wireframe)).toEqual(["stories"]);
  });

  it("visual preset (high,medium,medium,medium): stories + tokens + flow (flow:medium>=medium)", () => {
    const inputs = requiredInputs(PRESETS.visual);
    expect(inputs).toContain("stories");
    expect(inputs).toContain("tokens");
    expect(inputs).toContain("flow"); // visual preset has flow:medium which >= medium
  });

  it("interactive (high,high,high,high): stories + tokens + flow", () => {
    const inputs = requiredInputs(PRESETS.interactive);
    expect(inputs).toContain("stories");
    expect(inputs).toContain("tokens");
    expect(inputs).toContain("flow");
  });
});

// ---------------------------------------------------------------------------
// declaredFuture
// ---------------------------------------------------------------------------

describe("declaredFuture", () => {
  it("returns an array of {artifact, dial, level}", () => {
    const d = declaredFuture(PRESETS.wireframe);
    expect(Array.isArray(d)).toBe(true);
    for (const entry of d) {
      expect(typeof entry.artifact).toBe("string");
      expect(typeof entry.dial).toBe("string");
      expect(typeof entry.level).toBe("string");
    }
  });

  it("content-voice declared at editorial:medium (content preset has editorial:high>=medium)", () => {
    const d = declaredFuture(PRESETS.content);
    expect(d.some((e) => e.artifact === "content-voice")).toBe(true);
  });

  it("i18n declared at editorial:high", () => {
    const d = declaredFuture(PRESETS.interactive);
    expect(d.some((e) => e.artifact === "i18n")).toBe(true);
  });

  it("brand declared at visual:high", () => {
    const d = declaredFuture(PRESETS.visual); // visual:high
    expect(d.some((e) => e.artifact === "brand")).toBe(true);
  });

  it("keyboard declared at flow:medium", () => {
    const s: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "medium" };
    const d = declaredFuture(s);
    expect(d.some((e) => e.artifact === "keyboard")).toBe(true);
  });

  it("brand NOT declared at visual:low (wireframe)", () => {
    const d = declaredFuture(PRESETS.wireframe);
    expect(d.some((e) => e.artifact === "brand")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkReadiness
// ---------------------------------------------------------------------------

describe("checkReadiness", () => {
  it("ready when all required inputs and specs are present (wireframe + stories + specs)", () => {
    const r = checkReadiness(PRESETS.wireframe, {
      stories: true,
      tokens: false,
      flow: false,
      specs: true,
    });
    expect(r.ready).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it("ready at visual preset when stories+tokens+flow+specs present (visual has flow:medium)", () => {
    const r = checkReadiness(PRESETS.visual, {
      stories: true,
      tokens: true,
      flow: true, // visual preset has flow:medium so flow is required
      specs: true,
    });
    expect(r.ready).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it("not ready when specs missing (specs always required)", () => {
    const r = checkReadiness(PRESETS.wireframe, {
      stories: true,
      tokens: false,
      flow: false,
      specs: false,
    });
    expect(r.ready).toBe(false);
    expect(r.missing.some((m) => m.artifact === "specs")).toBe(true);
  });

  it("missing specs entry has action=provide-or-generate and a dial+level", () => {
    const r = checkReadiness(PRESETS.wireframe, {
      stories: true,
      tokens: false,
      flow: false,
      specs: false,
    });
    const specsEntry = r.missing.find((m) => m.artifact === "specs");
    expect(specsEntry).toBeDefined();
    if (specsEntry) {
      expect(specsEntry.action).toBe("provide-or-generate");
      expect(specsEntry.dial).toBeTruthy();
      expect(specsEntry.level).toBeTruthy();
    }
  });

  it("not ready at visual preset when tokens missing (token-conformance at visual:high>=medium)", () => {
    // Use a scope with visual:medium, flow:low so only tokens can be the blocker
    const scopeVisualMed: RenderScope = { visual: "medium", editorial: "low", coverage: "low", flow: "low" };
    const r = checkReadiness(scopeVisualMed, {
      stories: true,
      tokens: false,
      flow: false,
      specs: true,
    });
    expect(r.ready).toBe(false);
    const tokEntry = r.missing.find((m) => m.artifact === "tokens");
    expect(tokEntry).toBeDefined();
    if (tokEntry) {
      expect(tokEntry.dial).toBe("visual");
      expect(tokEntry.level).toBe("medium");
      expect(tokEntry.action).toBe("provide-or-generate");
    }
  });

  it("not ready at interactive preset when flow missing", () => {
    const r = checkReadiness(PRESETS.interactive, {
      stories: true,
      tokens: true,
      flow: false,
      specs: true,
    });
    expect(r.ready).toBe(false);
    const flowEntry = r.missing.find((m) => m.artifact === "flow");
    expect(flowEntry).toBeDefined();
    if (flowEntry) {
      expect(flowEntry.dial).toBe("flow");
      expect(flowEntry.level).toBe("medium");
      expect(flowEntry.action).toBe("provide-or-generate");
    }
  });

  it("not ready at wireframe when stories missing", () => {
    const r = checkReadiness(PRESETS.wireframe, {
      stories: false,
      tokens: false,
      flow: false,
      specs: true,
    });
    expect(r.ready).toBe(false);
    const storiesEntry = r.missing.find((m) => m.artifact === "stories");
    expect(storiesEntry).toBeDefined();
    if (storiesEntry) {
      expect(storiesEntry.dial).toBe("coverage");
      expect(storiesEntry.level).toBe("low");
      expect(storiesEntry.action).toBe("provide-or-generate");
    }
  });

  it("declared is populated by declaredFuture (non-blocking)", () => {
    const r = checkReadiness(PRESETS.visual, {
      stories: true,
      tokens: true,
      flow: false,
      specs: true,
    });
    expect(Array.isArray(r.declared)).toBe(true);
    // visual preset has visual:high → brand + contrast should be declared
    expect(r.declared.some((d) => d.artifact === "brand")).toBe(true);
  });

  it("multiple missing entries when several inputs absent", () => {
    const r = checkReadiness(PRESETS.interactive, {
      stories: false,
      tokens: false,
      flow: false,
      specs: false,
    });
    expect(r.ready).toBe(false);
    expect(r.missing.length).toBeGreaterThanOrEqual(4); // specs + stories + tokens + flow
  });
});

import { describe, it, expect } from "vitest";
import {
  parseLevel,
  parseFidelity,
  resolveFidelity,
  bindingGateIds,
  requiredInputs,
  declaredFuture,
  checkReadiness,
  PRESETS,
  PRESET_NAMES,
  GATE_DIMENSION,
  GATE_MIN_LEVEL,
} from "../src/batch/fidelity.js";
import type { Fidelity } from "../src/batch/fidelity.js";

describe("parseLevel", () => {
  it("accepts integers 0-2 as number or numeric string", () => {
    expect(parseLevel(0)).toBe(0);
    expect(parseLevel(2)).toBe(2);
    expect(parseLevel("1")).toBe(1);
  });
  it("rejects out-of-range, non-integer, and junk", () => {
    expect(parseLevel(3)).toBeNull();
    expect(parseLevel(-1)).toBeNull();
    expect(parseLevel(1.5)).toBeNull();
    expect(parseLevel("nope")).toBeNull();
    expect(parseLevel("")).toBeNull();
  });
});

describe("parseFidelity", () => {
  it("expands a preset NAME to its full vector (case-insensitive)", () => {
    expect(parseFidelity("wireframe")).toEqual({ coverage: 1, editorial: 0, visual: 0, flow: 0 });
    expect(parseFidelity("Content")).toEqual({ coverage: 1, editorial: 1, visual: 0, flow: 0 });
    expect(parseFidelity("VISUAL")).toEqual({ coverage: 1, editorial: 1, visual: 1, flow: 0 });
    expect(parseFidelity("interactive")).toEqual({ coverage: 1, editorial: 1, visual: 1, flow: 1 });
    expect(parseFidelity("production")).toEqual({ coverage: 2, editorial: 2, visual: 2, flow: 2 });
  });

  it("fills a PARTIAL vector with zeros for missing dimensions", () => {
    expect(parseFidelity({ coverage: 1, flow: 1 })).toEqual({
      coverage: 1,
      editorial: 0,
      visual: 0,
      flow: 1,
    });
    expect(parseFidelity({ visual: 2 })).toEqual({ coverage: 0, editorial: 0, visual: 2, flow: 0 });
  });

  it("rejects unknown presets, unknown dimensions, out-of-range and non-integer levels", () => {
    expect(parseFidelity("nope")).toBeNull();
    expect(parseFidelity("")).toBeNull();
    expect(parseFidelity({ coverage: 3 })).toBeNull();
    expect(parseFidelity({ coverage: -1 })).toBeNull();
    expect(parseFidelity({ coverage: 1.5 })).toBeNull();
    expect(parseFidelity({ a11y: 1 } as Record<string, unknown>)).toBeNull();
  });
});

describe("resolveFidelity (base + per-dimension overrides)", () => {
  it("applies overrides on top of a preset base", () => {
    expect(resolveFidelity(PRESETS.wireframe, { flow: 1 })).toEqual({
      coverage: 1,
      editorial: 0,
      visual: 0,
      flow: 1,
    });
    expect(resolveFidelity(PRESETS.visual, { visual: 0 })).toEqual({
      coverage: 1,
      editorial: 1,
      visual: 0,
      flow: 0,
    });
  });
  it("returns a COPY of the base when there are no overrides", () => {
    const out = resolveFidelity(PRESETS.content, {});
    expect(out).toEqual(PRESETS.content);
    expect(out).not.toBe(PRESETS.content);
  });
});

describe("bindingGateIds (per-dimension) + GATE_DIMENSION/GATE_MIN_LEVEL", () => {
  it("excludes token-conformance at visual:0 and includes it at visual:1", () => {
    const v0: Fidelity = { coverage: 1, editorial: 0, visual: 0, flow: 0 };
    const v1: Fidelity = { coverage: 1, editorial: 0, visual: 1, flow: 0 };
    expect(bindingGateIds(v0)).not.toContain("token-conformance");
    expect(bindingGateIds(v1)).toContain("token-conformance");
  });
  it("includes flow-reachability at flow:1 regardless of the other dims", () => {
    const v = resolveFidelity(PRESETS.wireframe, { flow: 1 }); // {1,0,0,1}
    expect(bindingGateIds(v)).toContain("flow-reachability");
    expect(bindingGateIds(v)).not.toContain("token-conformance");
  });
  it("binds the coverage trio at coverage:1", () => {
    expect(bindingGateIds(PRESETS.wireframe).sort()).toEqual([
      "coverage-orphans",
      "requirement-coverage",
      "reuse",
    ]);
  });
  it("declares the actual gate dimension + minLevel maps", () => {
    expect(GATE_DIMENSION["requirement-coverage"]).toBe("coverage");
    expect(GATE_DIMENSION["reuse"]).toBe("coverage");
    expect(GATE_DIMENSION["coverage-orphans"]).toBe("coverage");
    expect(GATE_DIMENSION["token-conformance"]).toBe("visual");
    expect(GATE_DIMENSION["flow-reachability"]).toBe("flow");
    for (const id of Object.keys(GATE_DIMENSION)) expect(GATE_MIN_LEVEL[id]).toBe(1);
  });
});

describe("requiredInputs (per-dimension; reuse never required)", () => {
  it("stories at coverage≥1, tokens at visual≥1, flow at flow≥1", () => {
    expect(requiredInputs(PRESETS.wireframe)).toEqual(["stories"]);
    expect(requiredInputs(PRESETS.visual)).toEqual(["stories", "tokens"]);
    expect(requiredInputs(PRESETS.interactive)).toEqual(["stories", "tokens", "flow"]);
    expect(requiredInputs({ coverage: 0, editorial: 0, visual: 1, flow: 1 })).toEqual([
      "tokens",
      "flow",
    ]);
  });
  it("never requires reuse", () => {
    for (const p of PRESET_NAMES) expect(requiredInputs(PRESETS[p])).not.toContain("reuse");
  });
});

describe("declaredFuture (editorial + future dims)", () => {
  it("declares editorial when editorial≥1, plus the future a11y/seo dimensions", () => {
    const v = declaredFuture(PRESETS.content); // editorial:1
    expect(v.some((d) => d.dimension === "editorial" && d.level === 1)).toBe(true);
    expect(v.some((d) => d.dimension === "a11y")).toBe(true);
    expect(v.some((d) => d.dimension === "seo")).toBe(true);
  });
  it("omits editorial when editorial:0", () => {
    expect(declaredFuture(PRESETS.wireframe).some((d) => d.dimension === "editorial")).toBe(false);
  });
});

describe("checkReadiness", () => {
  it("ready when every required input (+specs) is present", () => {
    const r = checkReadiness(PRESETS.visual, {
      stories: true,
      tokens: true,
      flow: false,
      specs: true,
    });
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("missing tokens at visual:1 → not ready, listed with dimension+level+action", () => {
    const r = checkReadiness(PRESETS.visual, {
      stories: true,
      tokens: false,
      flow: false,
      specs: true,
    });
    expect(r.ready).toBe(false);
    expect(
      r.missing.some(
        (m) =>
          m.artifact === "tokens" &&
          m.dimension === "visual" &&
          m.level === 1 &&
          m.action === "provide-or-generate",
      ),
    ).toBe(true);
  });

  it("missing specs → not ready (specs are always required)", () => {
    const r = checkReadiness(PRESETS.wireframe, {
      stories: true,
      tokens: false,
      flow: false,
      specs: false,
    });
    expect(r.ready).toBe(false);
    expect(r.missing.some((m) => m.artifact === "specs")).toBe(true);
  });

  it("surfaces declared regardless of readiness", () => {
    const r = checkReadiness(PRESETS.content, {
      stories: true,
      tokens: false,
      flow: false,
      specs: true,
    });
    expect(r.declared.some((d) => d.dimension === "editorial")).toBe(true);
  });
});

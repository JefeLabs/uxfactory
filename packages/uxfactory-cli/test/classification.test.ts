import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateClassification,
  readClassification,
} from "../src/classify/classification.js";
import type { ProjectClassification } from "../src/classify/classification.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A fully valid ProjectClassification object for baseline tests. */
const VALID: ProjectClassification = {
  version: 1,
  category: "web_app",
  industry: "corporate",
  age_demographic: "26-35",
  style: "formal",
  scope: { visual: "high", editorial: "medium", coverage: "high", flow: "high" },
  flow_refs: ["dashboard", "settings"],
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uxf-classification-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// validateClassification — happy path
// ---------------------------------------------------------------------------

describe("validateClassification — valid vector", () => {
  it("accepts a fully valid classification with all fields", () => {
    const res = validateClassification(VALID);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.value).toEqual(VALID);
  });

  it("accepts every valid category", () => {
    for (const category of ["marketing", "ecommerce", "web_app", "news"] as const) {
      const res = validateClassification({ ...VALID, category });
      expect(res.ok).toBe(true);
    }
  });

  it("accepts every valid industry", () => {
    for (const industry of [
      "education",
      "corporate",
      "healthcare",
      "finance",
      "consumer",
    ] as const) {
      const res = validateClassification({ ...VALID, industry });
      expect(res.ok).toBe(true);
    }
  });

  it("accepts every valid age_demographic", () => {
    for (const age of ["children", "teens", "18-25", "26-35", "36-50", "50+"] as const) {
      const res = validateClassification({ ...VALID, age_demographic: age });
      expect(res.ok).toBe(true);
    }
  });

  it("accepts every valid style", () => {
    for (const style of ["informal", "mix", "formal"] as const) {
      const res = validateClassification({ ...VALID, style });
      expect(res.ok).toBe(true);
    }
  });

  it("accepts all scope dials at every valid level", () => {
    for (const level of ["low", "medium", "high"] as const) {
      const res = validateClassification({
        ...VALID,
        scope: { visual: level, editorial: level, coverage: level, flow: level },
      });
      expect(res.ok).toBe(true);
    }
  });

  it("accepts an empty flow_refs array", () => {
    const res = validateClassification({ ...VALID, flow_refs: [] });
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateClassification — version
// ---------------------------------------------------------------------------

describe("validateClassification — wrong version", () => {
  it("rejects version: 2", () => {
    const res = validateClassification({ ...VALID, version: 2 });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/version/i);
  });

  it("rejects missing version", () => {
    const { version: _v, ...rest } = VALID;
    const res = validateClassification(rest);
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateClassification — bad enums (each names the field)
// ---------------------------------------------------------------------------

describe("validateClassification — bad category", () => {
  it("rejects an unknown category and names the field", () => {
    const res = validateClassification({ ...VALID, category: "blog" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/category/i);
  });
});

describe("validateClassification — bad industry", () => {
  it("rejects an unknown industry and names the field", () => {
    const res = validateClassification({ ...VALID, industry: "government" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/industry/i);
  });
});

describe("validateClassification — bad age_demographic", () => {
  it("rejects an unknown age_demographic and names the field", () => {
    const res = validateClassification({ ...VALID, age_demographic: "senior" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/age_demographic/i);
  });
});

describe("validateClassification — bad style", () => {
  it("rejects an unknown style and names the field", () => {
    const res = validateClassification({ ...VALID, style: "casual" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/style/i);
  });
});

// ---------------------------------------------------------------------------
// validateClassification — bad scope dials
// ---------------------------------------------------------------------------

describe("validateClassification — bad scope dials", () => {
  it("rejects scope.visual: 'none' (none is not a valid dial level)", () => {
    const res = validateClassification({
      ...VALID,
      scope: { ...VALID.scope, visual: "none" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/scope\.visual|scope/i);
  });

  it("rejects scope.editorial: 'x' (arbitrary bad string)", () => {
    const res = validateClassification({
      ...VALID,
      scope: { ...VALID.scope, editorial: "x" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/scope\.editorial|scope/i);
  });

  it("rejects scope.coverage: 42 (non-string)", () => {
    const res = validateClassification({
      ...VALID,
      scope: { ...VALID.scope, coverage: 42 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/scope\.coverage|scope/i);
  });

  it("rejects scope.flow: null", () => {
    const res = validateClassification({
      ...VALID,
      scope: { ...VALID.scope, flow: null },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/scope\.flow|scope/i);
  });

  it("rejects a missing scope object entirely", () => {
    const { scope: _s, ...rest } = VALID;
    const res = validateClassification(rest);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/scope/i);
  });
});

// ---------------------------------------------------------------------------
// validateClassification — bad flow_refs
// ---------------------------------------------------------------------------

describe("validateClassification — bad flow_refs", () => {
  it("rejects a non-array flow_refs", () => {
    const res = validateClassification({ ...VALID, flow_refs: "checkout" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/flow_refs/i);
  });

  it("rejects flow_refs with a non-string element", () => {
    const res = validateClassification({ ...VALID, flow_refs: ["checkout", 42] });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/flow_refs/i);
  });

  it("rejects a missing flow_refs", () => {
    const { flow_refs: _f, ...rest } = VALID;
    const res = validateClassification(rest);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/flow_refs/i);
  });
});

// ---------------------------------------------------------------------------
// validateClassification — non-object inputs
// ---------------------------------------------------------------------------

describe("validateClassification — non-object inputs", () => {
  it("rejects null", () => {
    expect(validateClassification(null).ok).toBe(false);
  });

  it("rejects a plain string", () => {
    expect(validateClassification("web_app").ok).toBe(false);
  });

  it("rejects an array", () => {
    expect(validateClassification([]).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readClassification — fs scenarios
// ---------------------------------------------------------------------------

describe("readClassification — valid file", () => {
  it("reads and validates a valid classification JSON file", async () => {
    const filePath = path.join(dir, "uxfactory.classification.json");
    await writeFile(filePath, JSON.stringify(VALID), "utf8");
    const res = await readClassification(filePath);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.value).toEqual(VALID);
  });
});

describe("readClassification — absent file", () => {
  it("returns ok:false with a 'not found' message (does not throw)", async () => {
    const filePath = path.join(dir, "nonexistent.json");
    const res = await readClassification(filePath);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/not found|cannot read|ENOENT/i);
  });
});

describe("readClassification — malformed JSON", () => {
  it("returns ok:false with a parse error message (does not throw)", async () => {
    const filePath = path.join(dir, "uxfactory.classification.json");
    await writeFile(filePath, "{ version: 1, broken json", "utf8");
    const res = await readClassification(filePath);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/json|parse/i);
  });
});

describe("readClassification — invalid classification in valid JSON", () => {
  it("returns ok:false with a field-naming message when the file is valid JSON but fails validation", async () => {
    const filePath = path.join(dir, "uxfactory.classification.json");
    await writeFile(filePath, JSON.stringify({ ...VALID, category: "unknown-cat" }), "utf8");
    const res = await readClassification(filePath);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected not ok");
    expect(res.message).toMatch(/category/i);
  });
});

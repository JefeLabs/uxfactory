/**
 * tiers.test.ts — Unit tests for ui/lib/tiers.ts (pure transformation).
 *
 * Fixtures are Meridian-shaped (real SP2 run data shapes, not references
 * to external files — copied inline per task requirement).
 *
 * Tests cover:
 *   1. Batch report with token-conformance fail → T2 fail, T3 skipped,
 *      VLM gated, correct openFindings count.
 *   2. GateResult with geometry fail → T3 fail, VLM gated.
 *   3. CraftReport with overall=4 and one dim score=2 → VLM fail (local
 *      tiers all pass).
 *   4. Combined inputs — cascade correctly.
 *   5. Short-circuit: T1 fail → T2, T3 skipped, VLM gated.
 *   6. Defensive empties / null / unknown inputs → sensible defaults, never throw.
 */

import { describe, expect, it } from "vitest";
import { toTierModel } from "../ui/lib/tiers.js";
import type { TierModel } from "../ui/lib/tiers.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Meridian-shaped batch report:
 *   - render-coverage: pass (6/6 covered)
 *   - a11y: pass
 *   - contrast: pass
 *   - token-conformance: FAIL — #000000 is not a registered token
 */
const MERIDIAN_BATCH_REPORT = {
  scope: { min_visual: "high" },
  rubric: ["render-coverage", "a11y", "contrast", "token-conformance"],
  mustPassFailed: true,
  clean: false,
  checks: [
    {
      id: "render-coverage",
      status: "pass",
      severity: "must",
      findings: [],
    },
    {
      id: "a11y",
      status: "pass",
      severity: "must",
      findings: [],
    },
    {
      id: "contrast",
      status: "pass",
      severity: "must",
      findings: [],
    },
    {
      id: "token-conformance",
      status: "fail",
      severity: "must",
      findings: [
        {
          detail:
            "Meridian/Error State: painted color #000000 at .cta-button is not a registered token",
          ref: "#000000",
        },
      ],
    },
  ],
};

/**
 * GateResult fixture: geometry check fails on the Hero Button node.
 */
const GATE_RESULT_GEOMETRY_FAIL = {
  status: "FAIL",
  checks: [
    { id: "editorType", status: "PASS" },
    { id: "counts", status: "PASS" },
    { id: "presence", status: "PASS" },
    { id: "geometry", status: "FAIL" },
  ],
  failures: [
    {
      check: "geometry",
      nodeId: "123:456",
      name: "Hero Button",
      property: "x",
      expected: 100,
      actual: 120,
      tolerancePx: 0.5,
    },
  ],
  summary: { checks: 4, passed: 3, failed: 1, skipped: 0 },
};

/**
 * CraftReport fixture: overall=4 (above bar), but hierarchy dim score=2
 * (below CRAFT_DIM_FLOOR=3) → VLM status "fail".
 */
const CRAFT_REPORT_DIM_FAIL = {
  version: 1,
  overall: 4,
  pass: false, // judge self-report ignored; computed from scores
  reliability: "best-effort",
  dimensions: [
    {
      name: "hierarchy",
      score: 2,
      findings: [
        {
          screen: "Error State",
          issue: "Poor visual hierarchy on primary CTA",
          fix: "Increase contrast between heading and button",
        },
      ],
    },
    { name: "typography", score: 4, findings: [] },
    { name: "spacing", score: 4, findings: [] },
    { name: "color", score: 4, findings: [] },
    { name: "components", score: 4, findings: [] },
    { name: "depth", score: 4, findings: [] },
    { name: "brand-fit", score: 4, findings: [] },
    { name: "production-readiness", score: 4, findings: [] },
  ],
};

/** Passing batch report — all checks green. */
const CLEAN_BATCH_REPORT = {
  checks: [
    { id: "render-coverage", status: "pass", severity: "must", findings: [] },
    { id: "a11y", status: "pass", severity: "must", findings: [] },
    { id: "contrast", status: "pass", severity: "must", findings: [] },
    { id: "token-conformance", status: "pass", severity: "must", findings: [] },
  ],
  mustPassFailed: false,
  clean: true,
};

/** Passing GateResult. */
const GATE_RESULT_PASS = {
  status: "PASS",
  checks: [
    { id: "editorType", status: "PASS" },
    { id: "counts", status: "PASS" },
    { id: "presence", status: "PASS" },
    { id: "geometry", status: "PASS" },
  ],
  failures: [],
  summary: { checks: 4, passed: 4, failed: 0, skipped: 0 },
};

/** Passing CraftReport — all dims >= 3, overall >= 4. */
const CRAFT_REPORT_PASS = {
  version: 1,
  overall: 4,
  pass: true,
  reliability: "best-effort",
  dimensions: [
    { name: "hierarchy", score: 4, findings: [] },
    { name: "typography", score: 4, findings: [] },
    { name: "spacing", score: 4, findings: [] },
    { name: "color", score: 4, findings: [] },
    { name: "components", score: 4, findings: [] },
    { name: "depth", score: 4, findings: [] },
    { name: "brand-fit", score: 4, findings: [] },
    { name: "production-readiness", score: 4, findings: [] },
  ],
};

/** Batch report with render-coverage fail. */
const COVERAGE_FAIL_BATCH = {
  checks: [
    {
      id: "render-coverage",
      status: "fail",
      severity: "must",
      findings: [
        {
          detail:
            "story checkout-success error state is not covered by any visible rendering",
          ref: "checkout-success/error",
        },
      ],
    },
    { id: "a11y", status: "pass", severity: "must", findings: [] },
    { id: "contrast", status: "pass", severity: "must", findings: [] },
    { id: "token-conformance", status: "pass", severity: "must", findings: [] },
  ],
  mustPassFailed: true,
  clean: false,
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function row(model: TierModel, tier: string) {
  const found = model.rows.find((r) => r.tier === tier);
  if (!found) throw new Error(`Tier ${tier} not found in model`);
  return found;
}

// ─── Test suites ─────────────────────────────────────────────────────────────

describe("toTierModel — defensive empties", () => {
  it("returns a sensible all-pending model when called with no inputs", () => {
    const model = toTierModel({});
    expect(model.rows).toHaveLength(5);
    expect(model.failedTier).toBeNull();
    expect(model.openFindings).toBe(0);
    for (const r of model.rows) {
      expect(["pass", "pending"]).toContain(r.status);
    }
  });

  it("never throws on null / undefined inputs", () => {
    expect(() =>
      toTierModel({ batchReport: null, verifyResult: undefined, craftReport: null }),
    ).not.toThrow();
  });

  it("never throws on completely unknown inputs", () => {
    expect(() =>
      toTierModel({
        batchReport: "not-an-object",
        verifyResult: 42,
        craftReport: [1, 2, 3],
      }),
    ).not.toThrow();
  });

  it("T0 is always pass when no schema error data", () => {
    const model = toTierModel({});
    expect(row(model, "T0").status).toBe("pass");
  });
});

describe("toTierModel — Meridian batch report (token-conformance fail)", () => {
  const model = toTierModel({ batchReport: MERIDIAN_BATCH_REPORT });

  it("T0 is pass (implicit)", () => {
    expect(row(model, "T0").status).toBe("pass");
  });

  it("T1 Coverage is pass (render-coverage passed)", () => {
    expect(row(model, "T1").status).toBe("pass");
  });

  it("T2 Integrity is fail", () => {
    expect(row(model, "T2").status).toBe("fail");
  });

  it("T2 has exactly one finding with ruleId token.color-raw", () => {
    const t2 = row(model, "T2");
    expect(t2.findings).toHaveLength(1);
    expect(t2.findings[0]!.ruleId).toBe("token.color-raw");
  });

  it("T2 finding carries the hex color as actual", () => {
    const f = row(model, "T2").findings[0]!;
    expect(f.actual).toBe("#000000");
    expect(f.message).toContain("#000000");
  });

  it("T3 is skipped — short-circuit (T2 failed)", () => {
    const t3 = row(model, "T3");
    expect(t3.status).toBe("skipped");
    expect(t3.skipReason).toBe("short-circuit");
  });

  it("VLM is gated (requires local pass)", () => {
    const vlm = row(model, "VLM");
    expect(vlm.status).toBe("gated");
    expect(vlm.skipReason).toBe("requires local pass");
  });

  it("failedTier is T2", () => {
    expect(model.failedTier).toBe("T2");
  });

  it("openFindings is 1 (the token finding)", () => {
    expect(model.openFindings).toBe(1);
  });
});

describe("toTierModel — GateResult geometry fail (verifyResult only)", () => {
  const model = toTierModel({ verifyResult: GATE_RESULT_GEOMETRY_FAIL });

  it("T0–T2 are pending (no batch report)", () => {
    expect(row(model, "T0").status).toBe("pass"); // T0 always pass
    expect(row(model, "T1").status).toBe("pending");
    expect(row(model, "T2").status).toBe("pending");
  });

  it("T3 is fail", () => {
    expect(row(model, "T3").status).toBe("fail");
  });

  it("T3 has one finding with ruleId conform.geometry", () => {
    const t3 = row(model, "T3");
    expect(t3.findings).toHaveLength(1);
    expect(t3.findings[0]!.ruleId).toBe("conform.geometry");
  });

  it("T3 finding carries nodeId, expected, actual", () => {
    const f = row(model, "T3").findings[0]!;
    expect(f.nodeId).toBe("123:456");
    expect(f.expected).toBe(100);
    expect(f.actual).toBe(120);
  });

  it("T3 finding message contains the node name and property", () => {
    const f = row(model, "T3").findings[0]!;
    expect(f.message).toContain("Hero Button");
    expect(f.message).toContain("x");
  });

  it("T3 stats shows passed/total", () => {
    expect(row(model, "T3").stats).toBe("3/4");
  });

  it("VLM is gated (T3 failed)", () => {
    expect(row(model, "VLM").status).toBe("gated");
  });

  it("failedTier is T3", () => {
    expect(model.failedTier).toBe("T3");
  });

  it("openFindings is 1", () => {
    expect(model.openFindings).toBe(1);
  });
});

describe("toTierModel — CraftReport dim fail (local tiers all pass)", () => {
  const model = toTierModel({
    batchReport: CLEAN_BATCH_REPORT,
    verifyResult: GATE_RESULT_PASS,
    craftReport: CRAFT_REPORT_DIM_FAIL,
  });

  it("T0–T3 are all pass", () => {
    expect(row(model, "T0").status).toBe("pass");
    expect(row(model, "T1").status).toBe("pass");
    expect(row(model, "T2").status).toBe("pass");
    expect(row(model, "T3").status).toBe("pass");
  });

  it("VLM is fail (overall=4 but hierarchy dim=2 < floor=3)", () => {
    expect(row(model, "VLM").status).toBe("fail");
  });

  it("VLM stats show craft 4/5 fail", () => {
    expect(row(model, "VLM").stats).toBe("craft 4/5 · fail");
  });

  it("VLM has one finding for hierarchy dim", () => {
    const vlm = row(model, "VLM");
    expect(vlm.findings).toHaveLength(1);
    expect(vlm.findings[0]!.ruleId).toBe("craft.hierarchy");
  });

  it("VLM finding carries hint (the fix)", () => {
    const f = row(model, "VLM").findings[0]!;
    expect(f.hint).toContain("contrast");
  });

  it("failedTier is VLM (first failing row overall)", () => {
    expect(model.failedTier).toBe("VLM");
  });

  it("openFindings is 1 (VLM finding)", () => {
    expect(model.openFindings).toBe(1);
  });
});

describe("toTierModel — short-circuit at T1 (coverage fail)", () => {
  const model = toTierModel({ batchReport: COVERAGE_FAIL_BATCH });

  it("T1 is fail", () => {
    expect(row(model, "T1").status).toBe("fail");
  });

  it("T1 finding has ruleId coverage.render", () => {
    expect(row(model, "T1").findings[0]!.ruleId).toBe("coverage.render");
  });

  it("T2 is skipped — short-circuit", () => {
    const t2 = row(model, "T2");
    expect(t2.status).toBe("skipped");
    expect(t2.skipReason).toBe("short-circuit");
  });

  it("T3 is skipped — short-circuit", () => {
    expect(row(model, "T3").status).toBe("skipped");
  });

  it("VLM is gated", () => {
    expect(row(model, "VLM").status).toBe("gated");
  });

  it("failedTier is T1", () => {
    expect(model.failedTier).toBe("T1");
  });
});

describe("toTierModel — fully clean run (all pass)", () => {
  const model = toTierModel({
    batchReport: CLEAN_BATCH_REPORT,
    verifyResult: GATE_RESULT_PASS,
    craftReport: CRAFT_REPORT_PASS,
  });

  it("all rows pass", () => {
    for (const r of model.rows) {
      expect(r.status).toBe("pass");
    }
  });

  it("failedTier is null", () => {
    expect(model.failedTier).toBeNull();
  });

  it("openFindings is 0", () => {
    expect(model.openFindings).toBe(0);
  });

  it("VLM stats show craft 4/5 pass", () => {
    expect(row(model, "VLM").stats).toBe("craft 4/5 · pass");
  });
});

describe("toTierModel — a11y finding rule id extraction", () => {
  it("extracts axe rule id from detail parenthetical", () => {
    const batchReport = {
      checks: [
        {
          id: "a11y",
          status: "fail",
          severity: "must",
          findings: [
            {
              detail:
                "Meridian/Cart: Touch targets must be 44x44 minimum (target-size)",
              ref: ".icon-btn",
            },
          ],
        },
      ],
    };

    const model = toTierModel({ batchReport });
    const t2 = row(model, "T2");
    expect(t2.findings[0]!.ruleId).toBe("a11y.target-size");
  });

  it("falls back to a11y.violation when no parenthetical", () => {
    const batchReport = {
      checks: [
        {
          id: "a11y",
          status: "fail",
          severity: "must",
          findings: [
            {
              detail: "Generic accessibility issue without rule parenthetical",
            },
          ],
        },
      ],
    };

    const model = toTierModel({ batchReport });
    const t2 = row(model, "T2");
    expect(t2.findings[0]!.ruleId).toBe("a11y.violation");
  });
});

describe("toTierModel — skip and not-owed checks", () => {
  it("render-coverage skip → T1 skipped with reason", () => {
    const batchReport = {
      checks: [
        {
          id: "render-coverage",
          status: "skip",
          severity: "must",
          findings: [],
          reason: "no stories registered",
        },
      ],
    };

    const model = toTierModel({ batchReport });
    const t1 = row(model, "T1");
    expect(t1.status).toBe("skipped");
    expect(t1.skipReason).toBe("no stories registered");
  });

  it("all T2 checks not-owed → T2 skipped", () => {
    const batchReport = {
      checks: [
        { id: "a11y", status: "not-owed", severity: "must", findings: [] },
        { id: "contrast", status: "not-owed", severity: "must", findings: [] },
        {
          id: "token-conformance",
          status: "not-owed",
          severity: "must",
          findings: [],
        },
      ],
    };

    const model = toTierModel({ batchReport });
    expect(row(model, "T2").status).toBe("skipped");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { reviewDesign } from "../src/review/review.js";
import type { ReviewReport } from "../src/review/review.js";
import type { StorySet, Flow, TokenSet } from "../src/batch/checks.js";
import { PRESETS } from "../src/batch/scope.js";
import type { DesignSpec } from "@uxfactory/spec";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const wireframe = PRESETS.wireframe; // { visual:low, editorial:low, coverage:low, flow:low }
const visualMedScope = {
  visual: "medium" as const,
  editorial: "low" as const,
  coverage: "low" as const,
  flow: "low" as const,
};
const flowMedScope = {
  visual: "low" as const,
  editorial: "low" as const,
  coverage: "low" as const,
  flow: "medium" as const,
};

/** A spec that COVERS story-1 with an empty state. */
const coveringSpec: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "story-1-home",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        { type: "shape", name: "story-1-empty-state", x: 0, y: 0, width: 1, height: 1 },
        {
          type: "text",
          name: "story-1-success-banner",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          characters: "Success",
        },
      ],
    },
  ],
};

/** Stories that the covering spec satisfies. */
const storiesConformant: StorySet = {
  stories: [
    {
      id: "story-1",
      role: "user",
      goal: "see a list",
      benefit: "awareness",
      acceptanceCriteria: [
        { statement: "shows empty state when no data", impliedState: "empty" },
        { statement: "shows success state after load", impliedState: "success" },
      ],
    },
  ],
};

/** A spec MISSING the loading state for story-2. */
const missingLoadingSpec: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "story-2-detail",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        {
          type: "text",
          name: "story-2-header",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          characters: "Header",
        },
        {
          type: "text",
          name: "story-2-content",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          characters: "Content",
        },
        // No "loading" node → AC "loading" state is unmet
      ],
    },
  ],
};

/** Stories requiring loading state that missingLoadingSpec does not cover. */
const storiesRequiringLoading: StorySet = {
  stories: [
    {
      id: "story-2",
      role: "user",
      goal: "see detail",
      benefit: "comprehension",
      acceptanceCriteria: [
        { statement: "shows loading indicator during fetch", impliedState: "loading" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Test 1: conformant design
// ---------------------------------------------------------------------------

describe("reviewDesign — conformant design", () => {
  let report: ReviewReport;

  it("returns a ReviewReport when design covers all stories at wireframe scope", () => {
    report = reviewDesign({
      specs: [{ file: "story-1.uxfactory.json", spec: coveringSpec }],
      stories: storiesConformant,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report).toBeDefined();
  });

  it("conformant:true when no must gate fails", () => {
    report = reviewDesign({
      specs: [{ file: "story-1.uxfactory.json", spec: coveringSpec }],
      stories: storiesConformant,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.conformant).toBe(true);
  });

  it("no unmet findings when design covers all stories", () => {
    report = reviewDesign({
      specs: [{ file: "story-1.uxfactory.json", spec: coveringSpec }],
      stories: storiesConformant,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    const unmet = report.findings.filter((f) => f.status === "unmet");
    expect(unmet).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2: non-conformant design (missing AC-implied state)
// ---------------------------------------------------------------------------

describe("reviewDesign — non-conformant design (missing AC state)", () => {
  let report: ReviewReport;

  beforeEach(() => {
    report = reviewDesign({
      specs: [{ file: "story-2.uxfactory.json", spec: missingLoadingSpec }],
      stories: storiesRequiringLoading,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
  });

  it("conformant:false when a must gate fails", () => {
    expect(report.conformant).toBe(false);
  });

  it("produces an unmet finding", () => {
    const unmet = report.findings.filter((f) => f.status === "unmet");
    expect(unmet.length).toBeGreaterThan(0);
  });

  it("unmet finding names the story (requirement)", () => {
    const unmet = report.findings.filter((f) => f.status === "unmet");
    expect(unmet.some((f) => f.requirement === "story-2")).toBe(true);
  });

  it("unmet finding carries the implied state as property", () => {
    const unmet = report.findings.filter((f) => f.status === "unmet");
    const loadingFinding = unmet.find((f) => f.requirement === "story-2");
    expect(loadingFinding?.property).toBe("loading");
  });

  it("unmet finding has a non-empty detail", () => {
    const unmet = report.findings.filter((f) => f.status === "unmet");
    for (const f of unmet) {
      expect(f.detail.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: no stories registered → coverage check in skipped, conformant:true
// ---------------------------------------------------------------------------

describe("reviewDesign — no stories registered", () => {
  let report: ReviewReport;

  beforeEach(() => {
    report = reviewDesign({
      specs: [{ file: "story-1.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
  });

  it("does not crash", () => {
    expect(report).toBeDefined();
  });

  it("conformant:true (no must gate fails when inputs absent)", () => {
    expect(report.conformant).toBe(true);
  });

  it("requirement-coverage appears in skipped (not unmet, not a crash)", () => {
    const skip = report.skipped.find((s) => s.check === "requirement-coverage");
    expect(skip).toBeDefined();
  });

  it("no unmet findings when stories absent", () => {
    const unmet = report.findings.filter((f) => f.status === "unmet");
    expect(unmet).toHaveLength(0);
  });

  it("skipped entry has a reason string", () => {
    const skip = report.skipped.find((s) => s.check === "requirement-coverage");
    expect(typeof skip?.reason).toBe("string");
    expect((skip?.reason ?? "").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 4: rubric lists the binding gate ids for the scope
// ---------------------------------------------------------------------------

describe("reviewDesign — rubric at wireframe scope", () => {
  it("rubric contains requirement-coverage at wireframe (coverage:low binds)", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.rubric).toContain("requirement-coverage");
  });

  it("rubric contains reuse and coverage-orphans at wireframe", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.rubric).toContain("reuse");
    expect(report.rubric).toContain("coverage-orphans");
  });

  it("rubric does NOT contain token-conformance at wireframe (visual:low)", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.rubric).not.toContain("token-conformance");
  });

  it("rubric contains token-conformance at visual:medium scope", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: visualMedScope,
    });
    expect(report.rubric).toContain("token-conformance");
  });

  it("rubric contains flow-reachability at flow:medium scope", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: flowMedScope,
    });
    expect(report.rubric).toContain("flow-reachability");
  });
});

// ---------------------------------------------------------------------------
// Test 5: advisory note present
// ---------------------------------------------------------------------------

describe("reviewDesign — advisory note", () => {
  it("advisory is a non-empty string", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(typeof report.advisory).toBe("string");
    expect(report.advisory.length).toBeGreaterThan(0);
  });

  it("advisory mentions the agent/plugin layer", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.advisory.toLowerCase()).toMatch(/agent|plugin/);
  });
});

// ---------------------------------------------------------------------------
// Test 6: gates above the scope appear in notOwed
// ---------------------------------------------------------------------------

describe("reviewDesign — notOwed for out-of-scope gates", () => {
  it("token-conformance appears in notOwed at wireframe scope (visual:low does not bind)", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.notOwed).toContain("token-conformance");
  });

  it("flow-reachability appears in notOwed at wireframe scope (flow:low does not bind)", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.notOwed).toContain("flow-reachability");
  });

  it("token-conformance NOT in notOwed at visual:medium scope (does bind)", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: visualMedScope,
    });
    expect(report.notOwed).not.toContain("token-conformance");
  });
});

// ---------------------------------------------------------------------------
// Test 7: advisory gate failures produce advisory findings, not unmet
// ---------------------------------------------------------------------------

describe("reviewDesign — advisory gate findings", () => {
  it("flow-reachability failure at flow:medium produces advisory finding, conformant remains true", () => {
    const specWithFrames: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "screen-a", x: 0, y: 0, width: 375, height: 812, children: [] },
        { name: "screen-b", x: 0, y: 0, width: 375, height: 812, children: [] },
      ],
      connectors: [], // no connectors → unreachable flow
    };
    const flow: Flow = { steps: ["screen-a", "screen-b"] };
    const report = reviewDesign({
      specs: [{ file: "flow.uxfactory.json", spec: specWithFrames }],
      stories: null,
      flow,
      tokens: null,
      reuseSpecs: null,
      scope: flowMedScope,
    });
    const advisoryFindings = report.findings.filter((f) => f.status === "advisory");
    expect(advisoryFindings.length).toBeGreaterThan(0);
    expect(report.conformant).toBe(true); // advisory never gates
  });

  it("coverage-orphans failure produces advisory finding, not unmet", () => {
    const storiesWithOrphan: StorySet = {
      stories: [
        {
          id: "known",
          role: "u",
          goal: "g",
          benefit: "b",
          acceptanceCriteria: [],
        },
      ],
    };
    const specWithOrphan: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "known-screen", x: 0, y: 0, width: 375, height: 812, children: [] },
        { name: "orphan-screen", x: 0, y: 0, width: 375, height: 812, children: [] },
      ],
    };
    const report = reviewDesign({
      specs: [{ file: "orphan.uxfactory.json", spec: specWithOrphan }],
      stories: storiesWithOrphan,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    const advisoryFindings = report.findings.filter((f) => f.status === "advisory");
    const unmet = report.findings.filter((f) => f.status === "unmet");
    expect(advisoryFindings.length).toBeGreaterThan(0);
    expect(unmet).toHaveLength(0);
    expect(report.conformant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 8: scope is echoed in the report
// ---------------------------------------------------------------------------

describe("reviewDesign — scope echoed in report", () => {
  it("report.scope matches the input scope", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.scope).toEqual(wireframe);
  });
});

// ---------------------------------------------------------------------------
// Test 9 (Fix 3): hardened conformant verdict — passed[] is evidence gates ran
// ---------------------------------------------------------------------------

describe("reviewDesign — self-evidencing passed[] (Fix 3)", () => {
  it("passed includes requirement-coverage when it ran and passed", () => {
    const report = reviewDesign({
      specs: [{ file: "story-1.uxfactory.json", spec: coveringSpec }],
      stories: storiesConformant,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.rubric).toContain("requirement-coverage");
    expect(report.skipped.find((s) => s.check === "requirement-coverage")).toBeUndefined();
    expect(report.passed).toContain("requirement-coverage");
    expect(report.conformant).toBe(true);
  });

  it("passed is empty for a gate that failed", () => {
    const report = reviewDesign({
      specs: [{ file: "story-2.uxfactory.json", spec: missingLoadingSpec }],
      stories: storiesRequiringLoading,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    // requirement-coverage FAILED → must not appear in passed
    expect(report.passed).not.toContain("requirement-coverage");
  });

  it("passed is empty for a skipped gate (absent input)", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    // requirement-coverage SKIPPED → must not appear in passed
    expect(report.passed).not.toContain("requirement-coverage");
  });
});

// ---------------------------------------------------------------------------
// Test 10 (Fix 4): declared tiers surfaced in the report
// ---------------------------------------------------------------------------

describe("reviewDesign — declared tiers in report (Fix 4)", () => {
  it("declared is a non-empty array at wireframe scope (future tiers always present)", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(Array.isArray(report.declared)).toBe(true);
    expect(report.declared.length).toBeGreaterThan(0);
  });

  it("declared contains a11y at wireframe scope (always declared)", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.declared).toContain("a11y");
  });
});

// ---------------------------------------------------------------------------
// Test 12 (Task 3): reliability field defaults to "exact"
// ---------------------------------------------------------------------------

describe("reviewDesign — reliability field (Task 3)", () => {
  it("reliability defaults to 'exact' when not specified", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    expect(report.reliability).toBe("exact");
  });

  it("reliability is 'exact' when explicitly set", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
      reliability: "exact",
    });
    expect(report.reliability).toBe("exact");
  });

  it("reliability is 'best-effort' when set", () => {
    const report = reviewDesign({
      specs: [{ file: "s.uxfactory.json", spec: coveringSpec }],
      stories: null,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
      reliability: "best-effort",
    });
    expect(report.reliability).toBe("best-effort");
  });
});

// ---------------------------------------------------------------------------
// Test 11 (Fix I1): advisory findings carry property when a ref is available
// ---------------------------------------------------------------------------

describe("reviewDesign — advisory findings carry property when ref exists (Fix I1)", () => {
  it("coverage-orphans advisory finding carries property = orphan frame name", () => {
    const storiesWithOrphan: StorySet = {
      stories: [
        {
          id: "known",
          role: "u",
          goal: "see known screen",
          benefit: "b",
          acceptanceCriteria: [],
        },
      ],
    };
    const specWithOrphan: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "known-screen", x: 0, y: 0, width: 375, height: 812, children: [] },
        // orphan-screen has no matching story id
        { name: "orphan-screen", x: 0, y: 0, width: 375, height: 812, children: [] },
      ],
    };
    const report = reviewDesign({
      specs: [{ file: "orphan.uxfactory.json", spec: specWithOrphan }],
      stories: storiesWithOrphan,
      flow: null,
      tokens: null,
      reuseSpecs: null,
      scope: wireframe,
    });
    const advisoryFindings = report.findings.filter((f) => f.status === "advisory");
    // coverage-orphans produces a finding with ref = "orphan-screen";
    // after Fix I1 that ref becomes property on the advisory finding.
    expect(advisoryFindings.some((f) => f.property === "orphan-screen")).toBe(true);
  });

  it("flow-reachability advisory finding carries property = 'from->to' ref", () => {
    const specWithFrames: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "screen-a", x: 0, y: 0, width: 375, height: 812, children: [] },
        { name: "screen-b", x: 0, y: 0, width: 375, height: 812, children: [] },
      ],
      connectors: [], // no connectors → unreachable
    };
    const flow: Flow = { steps: ["screen-a", "screen-b"] };
    const report = reviewDesign({
      specs: [{ file: "flow.uxfactory.json", spec: specWithFrames }],
      stories: null,
      flow,
      tokens: null,
      reuseSpecs: null,
      scope: flowMedScope,
    });
    const advisoryFindings = report.findings.filter((f) => f.status === "advisory");
    // flow-reachability produces ref = "screen-a->screen-b"; Fix I1 surfaces it as property.
    expect(advisoryFindings.some((f) => f.property === "screen-a->screen-b")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { runBatch } from "../src/batch/run.js";
import type { LoadedSpec, TokenSet, Flow, StorySet } from "../src/batch/checks.js";
import { PRESETS } from "../src/batch/scope.js";
import type { RenderScope } from "../src/batch/scope.js";
import type { DesignSpec } from "@uxfactory/spec";

// ---------------------------------------------------------------------------
// shared fixtures
// ---------------------------------------------------------------------------

const tokens: TokenSet = { colors: { brand: "#1E88E5" } };

const adhoc: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "home",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      children: [{ type: "shape", name: "card", x: 0, y: 0, width: 1, height: 1, fill: "#abcdef" }],
    },
  ],
};

const wireframe: RenderScope = PRESETS.wireframe; // { visual:low, editorial:low, coverage:low, flow:low }
const visualMedScope: RenderScope = {
  visual: "medium",
  editorial: "low",
  coverage: "low",
  flow: "low",
};
const flowMedScope: RenderScope = {
  visual: "low",
  editorial: "low",
  coverage: "low",
  flow: "medium",
};

// ---------------------------------------------------------------------------
// Scope-scoped runBatch — Task 2 (TDD: these tests were written first, RED)
// ---------------------------------------------------------------------------

describe("runBatch — scope-scoped (Task 2)", () => {
  // ── not-owed: non-binding must gate stays out of must-pass calculation ──

  it("token-conformance NOT binding at wireframe scope → status not-owed, clean stays true", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    // wireframe has visual:low — token-conformance needs visual>=medium → does NOT bind
    // Even with a token register present and an ad-hoc color, it should be not-owed, not fail.
    const report = runBatch({
      specs,
      tokens,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: wireframe,
    });
    const tc = report.checks.find((c) => c.id === "token-conformance");
    expect(tc).toBeDefined();
    expect(tc!.status).toBe("not-owed");
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });

  it("non-binding gate: not-owed entry has no findings and does not count as must-fail regardless of severity", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: wireframe,
    });
    const tc = report.checks.find((c) => c.id === "token-conformance");
    expect(tc!.findings).toHaveLength(0);
    // status is "not-owed", not "fail" — so even if severity were "must", it doesn't gate
    expect(tc!.status).not.toBe("fail");
  });

  // ── binding must-fail gates runBatch ──

  it("token-conformance BINDING at visual:medium scope + ad-hoc color → mustPassFailed true", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: visualMedScope,
    });
    const tc = report.checks.find((c) => c.id === "token-conformance");
    expect(tc).toBeDefined();
    expect(tc!.status).toBe("fail");
    expect(tc!.severity).toBe("must");
    expect(report.mustPassFailed).toBe(true);
    expect(report.clean).toBe(false);
  });

  it("requirement-coverage binding, fails → mustPassFailed true; non-binding gates are not-owed", () => {
    // At wireframe scope: req-cov binds (coverage:low), token-conformance NOT (visual:low)
    // Give stories that DON'T cover the spec's frame → requirement-coverage fails
    const storiesInput: StorySet = {
      stories: [
        {
          id: "missing-story",
          role: "u",
          goal: "g",
          benefit: "b",
          acceptanceCriteria: [{ statement: "state shows", impliedState: "success" }],
        },
      ],
    };
    // adhoc spec has frame "home" — "missing-story" won't match → fail
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens: null,
      stories: storiesInput,
      reuseSpecs: null,
      flow: null,
      scope: wireframe,
    });
    const rc = report.checks.find((c) => c.id === "requirement-coverage");
    expect(rc!.status).toBe("fail");
    expect(rc!.severity).toBe("must");
    expect(report.mustPassFailed).toBe(true);
    expect(report.clean).toBe(false);
    // token-conformance is still not-owed at wireframe
    const tc = report.checks.find((c) => c.id === "token-conformance");
    expect(tc!.status).toBe("not-owed");
  });

  // ── declared entries surface unbuilt tiers ──

  it("declared entries appear in checks for unbuilt tiers at interactive scope", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: PRESETS.interactive, // visual:high, editorial:high, coverage:high, flow:high
    });
    const declared = report.checks.filter((c) => c.status === "declared");
    expect(declared.length).toBeGreaterThan(0);
    // a11y is always declared
    expect(declared.some((c) => c.id === "a11y")).toBe(true);
    // brand declared at visual:high
    expect(declared.some((c) => c.id === "brand")).toBe(true);
  });

  it("declared entries are always advisory and never gate (mustPassFailed unaffected)", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: PRESETS.interactive,
    });
    const declared = report.checks.filter((c) => c.status === "declared");
    for (const d of declared) {
      expect(d.severity).toBe("advisory");
    }
    // All binding gates skip (null inputs) → no must-fail
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });

  it("declared entries at wireframe: a11y is always present", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: wireframe,
    });
    const declared = report.checks.filter((c) => c.status === "declared");
    expect(declared.some((c) => c.id === "a11y")).toBe(true);
  });

  // ── report carries scope + rubric ──

  it("report carries scope matching the input scope", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: wireframe,
    });
    expect(report.scope).toEqual(wireframe);
  });

  it("report rubric contains only binding gate ids (wireframe: coverage trio, not token/flow)", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: wireframe,
    });
    expect(report.rubric).toContain("requirement-coverage");
    expect(report.rubric).toContain("reuse");
    expect(report.rubric).toContain("coverage-orphans");
    expect(report.rubric).not.toContain("token-conformance");
    expect(report.rubric).not.toContain("flow-reachability");
  });

  it("report rubric at visual:medium includes token-conformance", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: visualMedScope,
    });
    expect(report.rubric).toContain("token-conformance");
  });

  it("report rubric at flow:medium includes flow-reachability", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: flowMedScope,
    });
    expect(report.rubric).toContain("flow-reachability");
  });

  // ── advisory gates never gate, regardless of scope ──

  it("coverage-orphans advisory never gates even when it binds and fails", () => {
    // At wireframe scope coverage-orphans binds (coverage:low); a story-less frame will fail it
    const storiesInput: StorySet = {
      stories: [
        {
          id: "story-1",
          role: "u",
          goal: "g",
          benefit: "b",
          acceptanceCriteria: [{ statement: "no data", impliedState: "empty" }],
        },
      ],
    };
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "story-1-home",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          children: [{ type: "shape", name: "home-empty-state", x: 0, y: 0, width: 1, height: 1 }],
        },
        { name: "shared-toolbar", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
    };
    const report = runBatch({
      specs: [{ file: "a.uxfactory.json", spec }],
      tokens: null,
      stories: storiesInput,
      reuseSpecs: null,
      flow: null,
      scope: wireframe,
    });
    const orphanCheck = report.checks.find((c) => c.id === "coverage-orphans")!;
    expect(orphanCheck.status).toBe("fail");
    expect(orphanCheck.severity).toBe("advisory");
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });

  it("flow-reachability advisory failure at flow:medium scope never gates", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "a", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "b", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
      connectors: [],
    };
    const flow: Flow = { steps: ["a", "b"] }; // no connector → unreachable → fail
    const report = runBatch({
      specs: [{ file: "a.uxfactory.json", spec }],
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow,
      scope: flowMedScope,
    });
    const flowCheck = report.checks.find((c) => c.id === "flow-reachability")!;
    expect(flowCheck.status).toBe("fail");
    expect(flowCheck.severity).toBe("advisory");
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });

  // ── flow-reachability not-owed when flow:low ──

  it("flow-reachability NOT binding at flow:low → not-owed even with a broken flow provided", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "a", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "b", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
      connectors: [],
    };
    const flow: Flow = { steps: ["a", "b"] };
    const report = runBatch({
      specs: [{ file: "a.uxfactory.json", spec }],
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow,
      scope: wireframe, // flow:low → flow-reachability does not bind
    });
    const flowCheck = report.checks.find((c) => c.id === "flow-reachability")!;
    expect(flowCheck.status).toBe("not-owed");
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });

  // ── binding + clean (sanity: all inputs null → all binding gates skip, no must-fail) ──

  it("wireframe scope: all binding gates skip when inputs absent, not-owed for non-binding, clean=true", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({
      specs,
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: wireframe,
    });
    // Binding gates (coverage trio) skip when stories/reuseSpecs null
    const bindingGates = report.checks.filter(
      (c) => c.id === "requirement-coverage" || c.id === "coverage-orphans" || c.id === "reuse",
    );
    expect(bindingGates.every((c) => c.status === "skip")).toBe(true);
    // Non-binding gates (token-conformance, flow-reachability) are not-owed
    const notOwed = report.checks.filter(
      (c) => c.id === "token-conformance" || c.id === "flow-reachability",
    );
    expect(notOwed.every((c) => c.status === "not-owed")).toBe(true);
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Legacy runBatch tests (updated for scope-scoped signature)
// ---------------------------------------------------------------------------

describe("runBatch — legacy behavior preserved with scope", () => {
  it("interactive scope + all inputs absent → all 5 gates skip, clean (no must-fail from skipped gates)", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    // interactive binds all 5 gates; with null inputs they all skip
    const report = runBatch({
      specs,
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: PRESETS.interactive,
    });
    const gateChecks = report.checks.filter((c) => c.status !== "declared");
    expect(gateChecks.every((c) => c.status === "skip")).toBe(true);
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });

  it("mustPassFailed when a must gate fails (ad-hoc color with a token register at visual:medium scope)", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    // visual:medium → token-conformance binds; ad-hoc color #abcdef not in tokens
    const report = runBatch({
      specs,
      tokens,
      stories: null,
      reuseSpecs: null,
      flow: null,
      scope: visualMedScope,
    });
    expect(report.mustPassFailed).toBe(true);
    expect(report.clean).toBe(false);
  });

  // Fix 3 regression: story-less frames go to advisory coverage-orphans, never gate
  it("Fix 3: story-less frame → requirementCoverage passes, coverage-orphans advisory, mustPassFailed:false", () => {
    const storiesInput: StorySet = {
      stories: [
        {
          id: "story-1",
          role: "u",
          goal: "g",
          benefit: "b",
          acceptanceCriteria: [{ statement: "no data", impliedState: "empty" }],
        },
      ],
    };
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "story-1-home",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          children: [{ type: "shape", name: "home-empty-state", x: 0, y: 0, width: 1, height: 1 }],
        },
        // story-less frame: no matching story id
        { name: "shared-toolbar", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
    };
    const report = runBatch({
      specs: [{ file: "a.uxfactory.json", spec }],
      tokens: null,
      stories: storiesInput,
      reuseSpecs: null,
      flow: null,
      scope: wireframe, // coverage:low → coverage trio binds; visual:low → token-conformance not-owed
    });
    const covCheck = report.checks.find((c) => c.id === "requirement-coverage")!;
    const orphanCheck = report.checks.find((c) => c.id === "coverage-orphans")!;
    // requirementCoverage (must) passes — story-1 is covered
    expect(covCheck.status).toBe("pass");
    // coverage-orphans is advisory and reports shared-toolbar
    expect(orphanCheck.severity).toBe("advisory");
    expect(orphanCheck.findings.some((f) => f.ref === "shared-toolbar")).toBe(true);
    // batch is clean despite the orphan advisory finding
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });

  it("an advisory (flow) failure NEVER trips the must-pass set (flow:medium scope)", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "a", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "b", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
      connectors: [],
    };
    const flow: Flow = { steps: ["a", "b"] };
    // flow-reachability binds at flow:medium; advisory failure still doesn't gate
    const report = runBatch({
      specs: [{ file: "a.uxfactory.json", spec }],
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow,
      scope: flowMedScope,
    });
    const flowCheck = report.checks.find((c) => c.id === "flow-reachability")!;
    expect(flowCheck.status).toBe("fail");
    expect(flowCheck.severity).toBe("advisory");
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });
});

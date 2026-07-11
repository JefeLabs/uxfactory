/**
 * story-regression.test.ts — the `story` design unit: revise one story's
 * coverage in place without loosening the gate's grip on its neighbors
 * (spec 2026-07-10-story-unit, decision 2 severity split, delivered
 * 2026-07-11 final review).
 *
 * Two contracts, split by severity owner:
 *  1. render-coverage (must, story unit) enforces full AC coverage for ONLY
 *     the declared storyRefs — the run's purpose — via a refs-scoped story
 *     set (reusing `scopeStories`). The full denominator survives
 *     everywhere ELSE (story-regression, ac-binding-coverage, the
 *     featureCoverage metric): unlike legacy units, where the scopeStories
 *     swap narrows the WHOLE denominator, a story-unit run keeps every
 *     registered story loaded for those checks.
 *  2. story-regression (must, story unit only): every non-ref story that was
 *     covered at the last full-denominator report must still be covered now.
 *     No qualifying baseline (none persisted, or the persisted report is
 *     itself refs-scoped/component/story) → strict mode: full coverage
 *     required of every non-ref story.
 */
import { describe, it, expect } from "vitest";
import { runHtmlBatch, qualifiesAsBaseline } from "../src/batch/html-checks.js";
import type { RenderSnapshot } from "../src/batch/html-checks.js";
import type { StorySet } from "../src/batch/checks.js";
import type { RenderScope } from "../src/batch/scope.js";
import type { BatchReport } from "../src/batch/run.js";

const LOW: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };

function story(id: string): StorySet["stories"][number] {
  return {
    id, role: "user", goal: "g", benefit: "b",
    acceptanceCriteria: [{ statement: "ok", impliedState: "success" }],
  };
}

const TWO_STORIES: StorySet = { stories: [story("S1"), story("S2")] };
const THREE_STORIES: StorySet = { stories: [story("S1"), story("S2"), story("S3")] };

/** A single-viewport snapshot claiming visible coverage for each named story. */
function snap(page: string, covered: string[]): RenderSnapshot {
  return {
    page, view: "default", viewport: { width: 390, height: 844 },
    screenshot: `${page}.png`, ok: true,
    coverChecks: covered.map((s) => ({
      story: s, impliedState: "success", selector: `#${s}`, found: true, visible: true,
    })),
    paintedColors: [], axe: [],
  };
}

describe("story unit — denominator + story-regression", () => {
  it("render-coverage enforces refs only — a non-ref gap surfaces via story-regression, not render-coverage", () => {
    // S2 is registered but not covered by any snapshot. Under decision 2's
    // severity split, render-coverage's story set is scoped to the declared
    // refs (S1) — S2's gap is story-regression's job, never render-coverage's.
    const report = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1"])],
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], scope: LOW,
    });
    const coverage = report.checks.find((c) => c.id === "render-coverage")!;
    expect(coverage.status).toBe("pass");
    expect(coverage.findings.some((f) => f.ref === "S2/success")).toBe(false);

    const regression = report.checks.find((c) => c.id === "story-regression")!;
    expect(regression.status).toBe("fail");
    expect(regression.findings.some((f) => f.detail.includes("story S2 lost coverage"))).toBe(true);
  });

  it("legacy unit with storyRefs still swaps (byte-preserved behavior)", () => {
    const report = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1"])],
      stories: TWO_STORIES, tokens: null, unit: "page", storyRefs: ["S1"], scope: LOW,
    });
    const coverage = report.checks.find((c) => c.id === "render-coverage")!;
    expect(coverage.status).toBe("pass");
    expect(coverage.findings.some((f) => f.ref === "S2/success")).toBe(false);
  });

  it("story unit without storyRefs → must finding on render-coverage", () => {
    const report = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1", "S2"])],
      stories: TWO_STORIES, tokens: null, unit: "story", scope: LOW,
    });
    const coverage = report.checks.find((c) => c.id === "render-coverage")!;
    expect(coverage.status).toBe("fail");
    expect(coverage.findings.some((f) => f.ref === "storyRefs")).toBe(true);
    expect(coverage.reason).toBe("story unit requires storyRefs");
  });

  it("story unit without storyRefs, and no stories registered: forced fail gets a truthful reason (not the stale skip reason)", () => {
    // stories: null makes render-coverage return a "skip" result (reason: "no
    // stories registered") BEFORE the storyRefs-missing check forces it to
    // "fail" — the stale skip reason must not survive onto the failed check.
    const report = runHtmlBatch({
      snapshots: [snap("screens/s1.html", [])],
      stories: null, tokens: null, unit: "story", scope: LOW,
    });
    const coverage = report.checks.find((c) => c.id === "render-coverage")!;
    expect(coverage.status).toBe("fail");
    expect(coverage.findings.some((f) => f.ref === "storyRefs")).toBe(true);
    expect(coverage.reason).toBe("story unit requires storyRefs");
    expect(coverage.reason).not.toContain("no stories registered");
  });

  it("story unit: an unknown storyRef fails render-coverage; the known ref (S1) is enforced there, the non-ref (S2) is enforced by story-regression", () => {
    const report = runHtmlBatch({
      snapshots: [snap("screens/s1.html", [])], // nothing covered
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1", "NOPE"], scope: LOW,
    });
    const coverage = report.checks.find((c) => c.id === "render-coverage")!;
    expect(coverage.status).toBe("fail");
    expect(
      coverage.findings.some((f) => f.ref === "NOPE" && f.detail.includes("is not a registered story")),
    ).toBe(true);
    // render-coverage's story set is refs-scoped for the story unit — S1
    // (the declared ref) is enforced here; S2 (non-ref) is NOT — that gap is
    // story-regression's job under decision 2's severity split.
    expect(coverage.findings.some((f) => f.ref === "S1/success")).toBe(true);
    expect(coverage.findings.some((f) => f.ref === "S2/success")).toBe(false);

    const regression = report.checks.find((c) => c.id === "story-regression")!;
    expect(regression.status).toBe("fail");
    expect(regression.findings.some((f) => f.detail.includes("story S2 lost coverage"))).toBe(true);
  });

  it("story-regression binds only for the story unit", () => {
    const report = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1", "S2"])],
      stories: TWO_STORIES, tokens: null, unit: "page", scope: LOW,
    });
    const check = report.checks.find((c) => c.id === "story-regression")!;
    expect(check.status).toBe("not-owed");
    expect(check.reason).toBe("binds only for the story unit");
  });

  it("lost coverage → must finding; kept coverage → pass", () => {
    const baseline: BatchReport = runHtmlBatch({
      snapshots: [snap("screens/all.html", ["S1", "S2"])],
      stories: TWO_STORIES, tokens: null, scope: LOW,
    });
    expect(qualifiesAsBaseline(baseline)).toBe(true);
    expect(baseline.checks.find((c) => c.id === "render-coverage")!.status).toBe("pass");

    const lost = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1"])],
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], baseline, scope: LOW,
    });
    const lostCheck = lost.checks.find((c) => c.id === "story-regression")!;
    expect(lostCheck.status).toBe("fail");
    expect(lostCheck.findings.some((f) => f.detail.includes("story S2 lost coverage"))).toBe(true);

    const kept = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1", "S2"])],
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], baseline, scope: LOW,
    });
    expect(kept.checks.find((c) => c.id === "story-regression")!.status).toBe("pass");
  });

  it("HEADLINE (decision 2): qualifying baseline + refs fully covered + non-ref pre-existing gap (uncovered at baseline AND now) → clean: true", () => {
    // S2 is a non-ref story with a pre-existing gap: uncovered at baseline
    // AND still uncovered now. S1 is the declared ref and is fully covered.
    // render-coverage (refs-scoped) passes; story-regression carries S2's
    // pre-existing gap without a finding — the greenable-on-debt experience
    // the story unit exists for.
    const baseline: BatchReport = runHtmlBatch({
      snapshots: [snap("screens/all.html", ["S1"])], // S2 uncovered at baseline
      stories: TWO_STORIES, tokens: null, scope: LOW,
    });
    expect(qualifiesAsBaseline(baseline)).toBe(true);
    expect(baseline.checks.find((c) => c.id === "render-coverage")!.status).toBe("fail");

    const current = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1"])], // S2 still uncovered
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], baseline, scope: LOW,
    });
    expect(current.checks.find((c) => c.id === "render-coverage")!.status).toBe("pass");
    const regression = current.checks.find((c) => c.id === "story-regression")!;
    expect(regression.status).toBe("pass");
    expect(regression.findings).toEqual([]);
    expect(current.mustPassFailed).toBe(false);
    expect(current.clean).toBe(true);
  });

  it("sibling: non-ref story WAS covered at baseline and lost coverage → clean: false via story-regression", () => {
    const baseline: BatchReport = runHtmlBatch({
      snapshots: [snap("screens/all.html", ["S1", "S2"])], // both covered
      stories: TWO_STORIES, tokens: null, scope: LOW,
    });
    expect(qualifiesAsBaseline(baseline)).toBe(true);
    expect(baseline.checks.find((c) => c.id === "render-coverage")!.status).toBe("pass");

    const current = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1"])], // S2 lost coverage
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], baseline, scope: LOW,
    });
    expect(current.checks.find((c) => c.id === "render-coverage")!.status).toBe("pass");
    const regression = current.checks.find((c) => c.id === "story-regression")!;
    expect(regression.status).toBe("fail");
    expect(regression.findings.some((f) => f.detail.includes("story S2 lost coverage"))).toBe(true);
    expect(current.mustPassFailed).toBe(true);
    expect(current.clean).toBe(false);
  });

  it("a page-path finding whose folder segment collides with a registered story id must not poison the baseline-uncovered set", () => {
    // A render failure on page "S2/index.html" produces ref "S2/index.html ›
    // main" — its pre-slash segment happens to equal the REAL story id "S2",
    // but the finding says nothing about story S2's own coverage. Genuine
    // coverage of S2 at baseline is otherwise complete. An unguarded
    // extraction misreads this as "S2 was already uncovered at baseline",
    // silently exempting S2 from the regression check below.
    const renderFailure: RenderSnapshot = {
      page: "S2/index.html", view: "main", viewport: { width: 390, height: 844 },
      screenshot: "S2-index.png", ok: false, error: "boom",
      coverChecks: [], paintedColors: [], axe: [],
    };
    const baseline: BatchReport = runHtmlBatch({
      snapshots: [snap("screens/all.html", ["S1", "S2"]), renderFailure],
      stories: TWO_STORIES, tokens: null, scope: LOW,
    });
    expect(qualifiesAsBaseline(baseline)).toBe(true);
    const baselineCoverage = baseline.checks.find((c) => c.id === "render-coverage")!;
    expect(baselineCoverage.status).toBe("fail"); // the render failure, not a story-coverage miss
    expect(baselineCoverage.findings.some((f) => f.ref === "S2/index.html › main")).toBe(true);

    const current = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1"])], // S2 genuinely lost coverage now
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], baseline, scope: LOW,
    });
    const check = current.checks.find((c) => c.id === "story-regression")!;
    expect(check.status).toBe("fail");
    expect(check.findings.some((f) => f.detail.includes("story S2 lost coverage"))).toBe(true);
  });

  it("pre-existing gap carried without findings", () => {
    // S3 is registered but uncovered at baseline too — a pre-existing gap.
    const baseline: BatchReport = runHtmlBatch({
      snapshots: [snap("screens/all.html", ["S1", "S2"])],
      stories: THREE_STORIES, tokens: null, scope: LOW,
    });
    const baselineCoverage = baseline.checks.find((c) => c.id === "render-coverage")!;
    expect(baselineCoverage.status).toBe("fail");
    expect(baselineCoverage.findings.some((f) => f.ref === "S3/success")).toBe(true);
    expect(qualifiesAsBaseline(baseline)).toBe(true);

    const current = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1", "S2"])], // S3 still uncovered
      stories: THREE_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], baseline, scope: LOW,
    });
    const check = current.checks.find((c) => c.id === "story-regression")!;
    expect(check.status).toBe("pass");
    expect(check.findings).toEqual([]);
  });

  it("no qualifying baseline → strict mode with named reason", () => {
    // (a) no baseline at all.
    const noBaseline = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1"])],
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], scope: LOW,
    });
    const noBaselineCheck = noBaseline.checks.find((c) => c.id === "story-regression")!;
    expect(noBaselineCheck.status).toBe("fail");
    expect(noBaselineCheck.findings.some((f) => f.detail.includes("story S2 lost coverage"))).toBe(true);
    expect(noBaselineCheck.reason).toContain("strict");

    // (b) a baseline exists but is itself refs-scoped — does not qualify.
    const scopedBaseline: BatchReport = runHtmlBatch({
      snapshots: [snap("screens/all.html", ["S1", "S2"])],
      stories: TWO_STORIES, tokens: null, storyRefs: ["S1", "S2"], scope: LOW,
    });
    expect(qualifiesAsBaseline(scopedBaseline)).toBe(false);

    const withNonQualifying = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1"])],
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"],
      baseline: scopedBaseline, scope: LOW,
    });
    const nonQualifyingCheck = withNonQualifying.checks.find((c) => c.id === "story-regression")!;
    expect(nonQualifyingCheck.status).toBe("fail");
    expect(nonQualifyingCheck.reason).toContain("strict");
  });

  it("qualifiesAsBaseline: refs-scoped, component-unit, and story-unit reports do not qualify", () => {
    const base: BatchReport = { scope: LOW, rubric: [], checks: [], mustPassFailed: false, clean: true };
    expect(qualifiesAsBaseline(base)).toBe(true);
    expect(qualifiesAsBaseline({ ...base, unit: "page" })).toBe(true);
    expect(qualifiesAsBaseline({ ...base, storyRefs: ["S1"] })).toBe(false);
    expect(qualifiesAsBaseline({ ...base, unit: "atom" })).toBe(false);
    expect(qualifiesAsBaseline({ ...base, unit: "story" })).toBe(false);
  });

  it("corrupt-but-parseable baseline ({}) never crashes the gate", () => {
    // batch-html.ts loads the baseline via JSON.parse with no runtime shape
    // validation — `{}` is valid JSON, qualifiesAsBaseline({}) is true (no
    // storyRefs, no unit), but it carries no `checks` array.
    const corrupt = {} as BatchReport;
    expect(qualifiesAsBaseline(corrupt)).toBe(true);
    expect(() =>
      runHtmlBatch({
        snapshots: [snap("screens/s1.html", ["S1"])],
        stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], baseline: corrupt, scope: LOW,
      }),
    ).not.toThrow();

    const report = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1"])],
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], baseline: corrupt, scope: LOW,
    });
    const check = report.checks.find((c) => c.id === "story-regression")!;
    // A missing `checks` array is guarded as "nothing recorded uncovered" —
    // S2 (a non-ref, uncovered now) is not treated as a pre-existing gap, so
    // it fails, same as strict mode would.
    expect(check.status).toBe("fail");
    expect(check.findings.some((f) => f.detail.includes("story S2 lost coverage"))).toBe(true);
  });
});

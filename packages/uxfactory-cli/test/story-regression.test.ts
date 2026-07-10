/**
 * story-regression.test.ts — the `story` design unit: revise one story's
 * coverage in place without loosening the gate's grip on its neighbors
 * (spec 2026-07-10-story-unit).
 *
 * Two contracts:
 *  1. Denominator: the `story` unit keeps the FULL story set in scope even
 *     when `storyRefs` names the story under revision — the scopeStories
 *     swap that legacy units use to narrow the universe must NOT apply here.
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
  it("story unit keeps the full denominator (no scopeStories swap)", () => {
    // S2 is registered but not covered by any snapshot — under a legacy unit
    // with the same storyRefs, S2 would be scoped OUT and never checked.
    const report = runHtmlBatch({
      snapshots: [snap("screens/s1.html", ["S1"])],
      stories: TWO_STORIES, tokens: null, unit: "story", storyRefs: ["S1"], scope: LOW,
    });
    const coverage = report.checks.find((c) => c.id === "render-coverage")!;
    expect(coverage.status).toBe("fail");
    expect(coverage.findings.some((f) => f.ref === "S2/success")).toBe(true);
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
});

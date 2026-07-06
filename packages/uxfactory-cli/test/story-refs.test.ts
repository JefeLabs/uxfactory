/**
 * story-refs.test.ts — story-scoped generation contract.
 *
 * A run may declare `storyRefs` (registry per-run state, stamped by the
 * worker from the composer): the unit is accountable to EXACTLY those
 * stories. The coverage denominator scopes to the declared set, a declared
 * ref that names no registered story is a must finding (a contract you can't
 * verify is a broken contract), and the Coverage metric counts only features
 * fully inside the scope — a run cannot attest features it didn't render.
 */
import { describe, it, expect } from "vitest";
import { validateRegistry } from "../src/batch/registry.js";
import { runBatch } from "../src/batch/run.js";
import { runHtmlBatch } from "../src/batch/html-checks.js";
import type { RenderSnapshot } from "../src/batch/html-checks.js";
import type { LoadedSpec, StorySet, FeatureSet } from "../src/batch/checks.js";
import type { DesignSpec } from "@uxfactory/spec";

const STORIES: StorySet = {
  stories: [
    { id: "browse-faq", role: "visitor", goal: "g", benefit: "b",
      acceptanceCriteria: [{ statement: "answers visible", impliedState: "success" }] },
    { id: "contact-support", role: "visitor", goal: "g", benefit: "b",
      acceptanceCriteria: [{ statement: "banner visible", impliedState: "success" }] },
  ],
};

const FEATURES: FeatureSet = {
  features: [
    { featureId: "F-01", name: "Answers", storyRefs: ["browse-faq"] },
    { featureId: "F-02", name: "Support", storyRefs: ["contact-support"] },
  ],
};

const HIGH = { visual: "high", editorial: "high", coverage: "high", flow: "high" } as const;

/** A spec covering ONLY browse-faq (frame + success node). */
const BROWSE_ONLY: LoadedSpec = {
  file: "a.uxfactory.json",
  spec: {
    editor: "figma",
    frames: [
      { name: "browse-faq-page", x: 0, y: 0, width: 100, height: 100,
        children: [{ type: "shape", name: "faq-success-list", x: 0, y: 0, width: 10, height: 10 }] },
    ],
  } as DesignSpec,
};

describe("registry validation", () => {
  it("accepts an array of non-empty strings; rejects anything else", () => {
    const base = { version: 1, inputs: {} };
    expect(validateRegistry({ ...base, storyRefs: ["browse-faq"] }).ok).toBe(true);
    expect(validateRegistry({ ...base, storyRefs: [] }).ok).toBe(true);
    expect(validateRegistry({ ...base, storyRefs: "browse-faq" }).ok).toBe(false);
    expect(validateRegistry({ ...base, storyRefs: [""] }).ok).toBe(false);
    expect(validateRegistry({ ...base, storyRefs: [1] }).ok).toBe(false);
  });
});

describe("runBatch with storyRefs", () => {
  it("scopes the coverage denominator: out-of-scope stories never gate", () => {
    // Spec covers only browse-faq; contact-support is registered but OUT of scope.
    const report = runBatch({
      specs: [BROWSE_ONLY], tokens: null, stories: STORIES, reuseSpecs: null,
      flow: null, storyRefs: ["browse-faq"], scope: { ...HIGH },
    });
    const coverage = report.checks.find((c) => c.id === "requirement-coverage")!;
    expect(coverage.status).toBe("pass");
    expect(report.storyRefs).toEqual(["browse-faq"]);
  });

  it("a declared ref that names no registered story is a must finding", () => {
    const report = runBatch({
      specs: [BROWSE_ONLY], tokens: null, stories: STORIES, reuseSpecs: null,
      flow: null, storyRefs: ["browse-faq", "no-such-story"], scope: { ...HIGH },
    });
    const coverage = report.checks.find((c) => c.id === "requirement-coverage")!;
    expect(coverage.status).toBe("fail");
    expect(coverage.findings.some((f) => f.ref === "no-such-story")).toBe(true);
    expect(report.mustPassFailed).toBe(true);
  });

  it("Coverage metric counts only features fully inside the scope", () => {
    const report = runBatch({
      specs: [BROWSE_ONLY], tokens: null, stories: STORIES, reuseSpecs: null,
      flow: null, features: FEATURES, storyRefs: ["browse-faq"], scope: { ...HIGH },
    });
    const fc = report.featureCoverage!;
    // F-02 (contact-support) was not rendered by this run — not attested.
    expect(fc.total).toBe(1);
    expect(fc.features.map((f) => f.featureId)).toEqual(["F-01"]);
    expect(fc.conformed).toBe(1);
  });

  it("without storyRefs the full registered set gates (regression)", () => {
    const report = runBatch({
      specs: [BROWSE_ONLY], tokens: null, stories: STORIES, reuseSpecs: null,
      flow: null, scope: { ...HIGH },
    });
    const coverage = report.checks.find((c) => c.id === "requirement-coverage")!;
    expect(coverage.status).toBe("fail"); // contact-support uncovered
    expect(report.storyRefs).toBeUndefined();
  });
});

describe("runHtmlBatch with storyRefs", () => {
  const snapshot: RenderSnapshot = {
    page: "screens/faq.html", view: "default",
    viewport: { name: "desktop", width: 1440, height: 900 },
    ok: true, screenshotPath: "x.png",
    coverChecks: [
      { story: "browse-faq", impliedState: "success",
        selector: "[data-ac='x']", found: true, visible: true },
    ],
    axeViolations: [], contrastPairs: [],
    styleStats: { fontFamilies: [], radii: [], shadowCount: 0, gradientCount: 0, colors: [] },
  };

  it("scoped render coverage passes when every declared story is covered", () => {
    const report = runHtmlBatch({
      snapshots: [snapshot], stories: STORIES, tokens: null,
      storyRefs: ["browse-faq"],
      scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
    });
    const coverage = report.checks.find((c) => c.id === "render-coverage")!;
    expect(coverage.status).toBe("pass");
    expect(report.storyRefs).toEqual(["browse-faq"]);
  });

  it("unknown declared ref fails the render-coverage contract", () => {
    const report = runHtmlBatch({
      snapshots: [snapshot], stories: STORIES, tokens: null,
      storyRefs: ["ghost-story"],
      scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
    });
    const coverage = report.checks.find((c) => c.id === "render-coverage")!;
    expect(coverage.status).toBe("fail");
    expect(coverage.findings.some((f) => f.ref === "ghost-story")).toBe(true);
  });
});

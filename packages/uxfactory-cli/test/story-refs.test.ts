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

// ─── flow-story-coverage — the journey must realize its bound stories ─────────

describe("flow-story-coverage (user-flow unit)", () => {
  const LOW = { visual: "low", editorial: "low", coverage: "low", flow: "low" } as const;
  const snap = (page: string, story: string): RenderSnapshot => ({
    page, view: "default",
    viewport: { name: "desktop", width: 1440, height: 900 },
    ok: true, screenshotPath: "x.png",
    coverChecks: [{ story, impliedState: "success", selector: "[data-ac='x']", found: true, visible: true }],
    axeViolations: [], contrastPairs: [],
    styleStats: { fontFamilies: [], radii: [], shadowCount: 0, gradientCount: 0, colors: [] },
  });

  it("passes when every bound story's coverage sits on journey pages", () => {
    const report = runHtmlBatch({
      snapshots: [snap("screens/cart.html", "browse-faq"), snap("screens/pay.html", "contact-support")],
      stories: STORIES, tokens: null, unit: "user-flow",
      flow: { steps: ["screens/cart.html", "screens/pay.html"], storyRefs: ["browse-faq", "contact-support"] },
      scope: { ...LOW },
    });
    expect(report.checks.find((c) => c.id === "flow-story-coverage")!.status).toBe("pass");
  });

  it("fails when a bound story is covered on a page outside the declared steps", () => {
    const report = runHtmlBatch({
      snapshots: [snap("screens/cart.html", "browse-faq"), snap("screens/rogue.html", "contact-support")],
      stories: STORIES, tokens: null, unit: "user-flow",
      flow: { steps: ["screens/cart.html"], storyRefs: ["browse-faq", "contact-support"] },
      scope: { ...LOW },
    });
    const check = report.checks.find((c) => c.id === "flow-story-coverage")!;
    expect(check.status).toBe("fail");
    expect(check.findings.some((f) => f.ref === "contact-support@screens/rogue.html")).toBe(true);
  });

  it("an unknown bound ref and an uncovered bound story both fail loudly", () => {
    const report = runHtmlBatch({
      snapshots: [snap("screens/cart.html", "browse-faq")],
      stories: STORIES, tokens: null, unit: "user-flow",
      flow: { steps: ["screens/cart.html"], storyRefs: ["ghost", "contact-support"] },
      scope: { ...LOW },
    });
    const check = report.checks.find((c) => c.id === "flow-story-coverage")!;
    expect(check.status).toBe("fail");
    expect(check.findings.some((f) => f.ref === "ghost")).toBe(true);
    expect(check.findings.some((f) => f.ref === "contact-support")).toBe(true);
  });

  it("skips when the flow binds no stories; not-owed off the user-flow unit", () => {
    const bound = runHtmlBatch({
      snapshots: [snap("screens/cart.html", "browse-faq")],
      stories: STORIES, tokens: null, unit: "user-flow",
      flow: { steps: ["screens/cart.html"] },
      scope: { ...LOW },
    });
    expect(bound.checks.find((c) => c.id === "flow-story-coverage")!.status).toBe("skip");

    const page = runHtmlBatch({
      snapshots: [snap("screens/cart.html", "browse-faq")],
      stories: STORIES, tokens: null, unit: "page",
      flow: { steps: ["screens/cart.html"], storyRefs: ["browse-faq"] },
      scope: { ...LOW },
    });
    expect(page.checks.find((c) => c.id === "flow-story-coverage")!.status).toBe("not-owed");
  });
});

// ─── spec-mode flow-story-coverage — same contract, frame-name convention ─────

describe("flow-story-coverage (spec mode, advisory)", () => {
  const FLOW_HIGH = { visual: "low", editorial: "low", coverage: "high", flow: "high" } as const;
  const TWO_FRAMES: LoadedSpec = {
    file: "b.uxfactory.json",
    spec: {
      editor: "figma",
      frames: [
        { name: "browse-faq-page", x: 0, y: 0, width: 100, height: 100,
          children: [{ type: "shape", name: "faq-success-list", x: 0, y: 0, width: 10, height: 10 }] },
        { name: "contact-support-page", x: 0, y: 200, width: 100, height: 100,
          children: [{ type: "shape", name: "banner-success", x: 0, y: 0, width: 10, height: 10 }] },
      ],
    } as DesignSpec,
  };

  it("passes when every covering frame sits on the declared steps", () => {
    const report = runBatch({
      specs: [TWO_FRAMES], tokens: null, stories: STORIES, reuseSpecs: null,
      flow: { steps: ["browse-faq-page", "contact-support-page"], storyRefs: ["browse-faq", "contact-support"] },
      scope: { ...FLOW_HIGH },
    });
    expect(report.checks.find((c) => c.id === "flow-story-coverage")!.status).toBe("pass");
  });

  it("flags a covering frame outside the steps; stays advisory (never flips clean)", () => {
    const report = runBatch({
      specs: [TWO_FRAMES], tokens: null, stories: STORIES, reuseSpecs: null,
      flow: { steps: ["browse-faq-page"], storyRefs: ["browse-faq", "contact-support"] },
      scope: { ...FLOW_HIGH },
    });
    const check = report.checks.find((c) => c.id === "flow-story-coverage")!;
    expect(check.status).toBe("fail");
    expect(check.severity).toBe("advisory");
    expect(check.findings.some((f) => f.ref === "contact-support@contact-support-page")).toBe(true);
    expect(report.clean).toBe(true); // advisory in spec mode — mirrors flow-reachability
  });

  it("skips when the flow binds no stories; not-owed below the flow threshold", () => {
    const unbound = runBatch({
      specs: [TWO_FRAMES], tokens: null, stories: STORIES, reuseSpecs: null,
      flow: { steps: ["browse-faq-page"] }, scope: { ...FLOW_HIGH },
    });
    expect(unbound.checks.find((c) => c.id === "flow-story-coverage")!.status).toBe("skip");

    const lowFlow = runBatch({
      specs: [TWO_FRAMES], tokens: null, stories: STORIES, reuseSpecs: null,
      flow: { steps: ["browse-faq-page"], storyRefs: ["browse-faq"] },
      scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
    });
    expect(lowFlow.checks.find((c) => c.id === "flow-story-coverage")!.status).toBe("not-owed");
  });
});

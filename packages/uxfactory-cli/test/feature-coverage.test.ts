/**
 * feature-coverage.test.ts — the Coverage METRIC (mapping decision 12).
 *
 * conformed features / total, with `features` as the denominator. Pure
 * derivation over a coverage check's findings: a feature is conformed when
 * every storyRef exists in the stories input and contributes no coverage
 * finding. Advisory metadata — it NEVER gates (`features` never blocks).
 * Mode-agnostic: requirement-coverage refs are plain story ids; render-
 * coverage refs are `storyId/state[@vp]` — both key on the story-id prefix.
 */
import { describe, it, expect } from "vitest";
import { featureCoverage } from "../src/batch/checks.js";
import type { BatchFinding, FeatureSet } from "../src/batch/checks.js";
import { loadFeaturesInput } from "../src/batch/inputs.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FEATURES: FeatureSet = {
  features: [
    { featureId: "F-01", name: "Self-serve answers", storyRefs: ["browse-faq"], origin: "net-new", status: "planned" },
    { featureId: "F-02", name: "Support reach", storyRefs: ["contact-support", "browse-faq"], origin: "net-new", status: "planned" },
    { featureId: "F-03", name: "Ghost", storyRefs: ["no-such-story"], origin: "net-new", status: "planned" },
  ],
};

const STORY_IDS = new Set(["browse-faq", "contact-support"]);

describe("featureCoverage", () => {
  it("all stories covered → every integrity-clean feature is conformed", () => {
    const r = featureCoverage(FEATURES, STORY_IDS, []);
    expect(r.total).toBe(3);
    expect(r.conformed).toBe(2); // F-03 references a story that does not exist
    const f3 = r.features.find((f) => f.featureId === "F-03")!;
    expect(f3.conformed).toBe(false);
    expect(f3.uncoveredStories).toEqual(["no-such-story"]);
  });

  it("spec-mode findings (plain story-id refs) uncover the referencing features", () => {
    const findings: BatchFinding[] = [
      { detail: "story browse-faq is not covered by any frame", ref: "browse-faq" },
    ];
    const r = featureCoverage(FEATURES, STORY_IDS, findings);
    expect(r.conformed).toBe(0); // F-01 and F-02 both reference browse-faq; F-03 broken ref
    expect(r.features.find((f) => f.featureId === "F-02")!.uncoveredStories).toEqual([
      "browse-faq",
    ]);
  });

  it("HTML-mode findings (storyId/state@vp refs) key on the story-id prefix", () => {
    const findings: BatchFinding[] = [
      { detail: "…", ref: "contact-support/success@1440×900" },
      { detail: "render failed", ref: "screens/faq.html › default" }, // not a story ref — ignored
    ];
    const r = featureCoverage(FEATURES, STORY_IDS, findings);
    expect(r.features.find((f) => f.featureId === "F-01")!.conformed).toBe(true);
    expect(r.features.find((f) => f.featureId === "F-02")!.conformed).toBe(false);
    expect(r.features.find((f) => f.featureId === "F-02")!.uncoveredStories).toEqual([
      "contact-support",
    ]);
  });

  it("E2: a render-failure page-path ref never marks a feature's story uncovered (page-path guard)", () => {
    // "x/index.html › main" is a render-coverage page-path ref (render
    // failure) whose leading segment ("x") happens to equal a registered
    // story id. Without the isPagePathRef guard, storyIdOfRef would read it
    // as a finding against story "x" and wrongly uncover F-x.
    const features: FeatureSet = { features: [{ featureId: "F-x", name: "X", storyRefs: ["x"] }] };
    const storyIds = new Set(["x"]);
    const findings: BatchFinding[] = [
      { detail: "x/index.html › main failed to render: boom", ref: "x/index.html › main" },
    ];
    const r = featureCoverage(features, storyIds, findings);
    expect(r.features.find((f) => f.featureId === "F-x")!.conformed).toBe(true);
  });

  it("empty feature set → zero of zero (renders as no metric)", () => {
    const r = featureCoverage({ features: [] }, STORY_IDS, []);
    expect(r).toMatchObject({ conformed: 0, total: 0, features: [] });
  });
});

describe("loadFeaturesInput", () => {
  it("absent, ok, and broken states", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-features-"));
    try {
      expect((await loadFeaturesInput(null)).state).toBe("absent");

      const p = path.join(root, "features.json");
      await writeFile(p, JSON.stringify(FEATURES));
      const ok = await loadFeaturesInput(p);
      expect(ok.state).toBe("ok");
      if (ok.state === "ok") expect(ok.value.features).toHaveLength(3);

      await writeFile(p, JSON.stringify({ features: "nope" }));
      const broken = await loadFeaturesInput(p);
      expect(broken.state).toBe("broken");
      if (broken.state === "broken") expect(broken.message).toMatch(/features/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ─── report stamping — both gate runners carry the metric, never gate on it ───

import { runBatch } from "../src/batch/run.js";
import { runHtmlBatch } from "../src/batch/html-checks.js";
import type { RenderSnapshot } from "../src/batch/html-checks.js";
import type { LoadedSpec, StorySet } from "../src/batch/checks.js";
import type { DesignSpec } from "@uxfactory/spec";

const STORIES: StorySet = {
  stories: [
    {
      id: "browse-faq", role: "visitor", goal: "g", benefit: "b",
      acceptanceCriteria: [{ statement: "answers visible", impliedState: "success" }],
    },
    {
      id: "contact-support", role: "visitor", goal: "g", benefit: "b",
      acceptanceCriteria: [],
    },
  ],
};

const SPEC_COVERING_BROWSE_ONLY: LoadedSpec = {
  file: "a.uxfactory.json",
  spec: {
    editor: "figma",
    frames: [
      {
        name: "browse-faq-page", x: 0, y: 0, width: 100, height: 100,
        children: [{ type: "shape", name: "faq-success-list", x: 0, y: 0, width: 10, height: 10 }],
      },
    ],
  } as DesignSpec,
};

const HIGH = { visual: "high", editorial: "high", coverage: "high", flow: "high" } as const;

describe("runBatch stamps featureCoverage", () => {
  it("uncovered story → its features unconformed; metric never flips clean", () => {
    const report = runBatch({
      specs: [SPEC_COVERING_BROWSE_ONLY],
      tokens: null,
      stories: STORIES,
      reuseSpecs: null,
      flow: null,
      features: FEATURES,
      scope: { ...HIGH },
    });
    expect(report.featureCoverage).toBeDefined();
    const fc = report.featureCoverage!;
    expect(fc.total).toBe(3);
    // contact-support has no covering frame → F-02 unconformed; F-03 broken ref.
    expect(fc.features.find((f) => f.featureId === "F-01")!.conformed).toBe(true);
    expect(fc.features.find((f) => f.featureId === "F-02")!.conformed).toBe(false);
    expect(fc.conformed).toBe(1);
  });

  it("no features input → no metric field (report shape unchanged)", () => {
    const report = runBatch({
      specs: [SPEC_COVERING_BROWSE_ONLY],
      tokens: null,
      stories: STORIES,
      reuseSpecs: null,
      flow: null,
      scope: { ...HIGH },
    });
    expect(report.featureCoverage).toBeUndefined();
  });
});

describe("runHtmlBatch stamps featureCoverage", () => {
  const snapshot = (covers: Array<{ story: string; state: string }>): RenderSnapshot => ({
    page: "screens/faq.html",
    view: "default",
    viewport: { name: "desktop", width: 1440, height: 900 },
    ok: true,
    screenshotPath: "x.png",
    coverChecks: covers.map((c) => ({
      story: c.story,
      impliedState: c.state,
      selector: `[data-ac='${c.story}-${c.state}']`,
      found: true,
      visible: true,
    })),
    axeViolations: [],
    contrastPairs: [],
    styleStats: { fontFamilies: [], radii: [], shadowCount: 0, gradientCount: 0, colors: [] },
  });

  it("covered stories conform their features through the render path", () => {
    const report = runHtmlBatch({
      snapshots: [snapshot([{ story: "browse-faq", state: "success" }])],
      stories: STORIES,
      tokens: null,
      features: FEATURES,
      scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
    });
    const fc = report.featureCoverage!;
    // browse-faq covered; contact-support has NO required states (zero ACs) so
    // it contributes no findings → covered by vacuity.
    expect(fc.features.find((f) => f.featureId === "F-01")!.conformed).toBe(true);
    expect(fc.features.find((f) => f.featureId === "F-02")!.conformed).toBe(true);
    expect(fc.features.find((f) => f.featureId === "F-03")!.conformed).toBe(false);
    expect(fc.conformed).toBe(2);
  });
});

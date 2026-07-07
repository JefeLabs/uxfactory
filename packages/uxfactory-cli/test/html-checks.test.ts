import { describe, it, expect } from "vitest";
import { renderCoverage, type RenderSnapshot } from "../src/batch/html-checks.js";
import { a11y, contrast, htmlTokenConformance, runHtmlBatch } from "../src/batch/html-checks.js";
import type { StorySet, TokenSet } from "../src/batch/checks.js";
import type { RenderScope } from "../src/batch/scope.js";

function snap(p: Partial<RenderSnapshot>): RenderSnapshot {
  return {
    page: "screens/checkout.html", view: "v", viewport: { width: 390, height: 844 },
    screenshot: "checkout-v.png", ok: true, coverChecks: [], paintedColors: [], axe: [],
    ...p,
  };
}

const stories: StorySet = {
  stories: [{
    id: "checkout", role: "user", goal: "pay", benefit: "done",
    acceptanceCriteria: [
      { statement: "ok", impliedState: "success" },
      { statement: "fail", impliedState: "error" },
    ],
  }],
};

const tokens: TokenSet = { colors: { brand: "#1E88E5", ink: "#111111" } };

describe("renderCoverage", () => {
  it("skips when no stories", () => {
    const r = renderCoverage([snap({})], null);
    expect(r.status).toBe("skip");
  });

  it("passes when every required state is covered visibly", () => {
    const snaps = [
      snap({ view: "success", coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true }] }),
      snap({ view: "error", coverChecks: [{ story: "checkout", impliedState: "error", selector: "#err", found: true, visible: true }] }),
    ];
    expect(renderCoverage(snaps, stories).status).toBe("pass");
  });

  it("fails an uncovered state", () => {
    const snaps = [snap({ view: "success", coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true }] })];
    const r = renderCoverage(snaps, stories);
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.detail.includes("error state is not covered"))).toBe(true);
  });

  it("fails a dead selector and an invisible selector with distinct findings", () => {
    const snaps = [
      snap({ view: "success", coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: false, visible: false }] }),
      snap({ view: "error", coverChecks: [{ story: "checkout", impliedState: "error", selector: "#err", found: true, visible: false }] }),
    ];
    const r = renderCoverage(snaps, stories);
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.detail.includes("matched no element"))).toBe(true);
    expect(r.findings.some((f) => f.detail.includes("is not visible"))).toBe(true);
  });

  it("reports a render failure", () => {
    const snaps = [snap({ ok: false, error: "load timeout", coverChecks: [] })];
    const r = renderCoverage(snaps, stories);
    expect(r.findings.some((f) => f.detail.includes("failed to render: load timeout"))).toBe(true);
  });
});

describe("a11y / contrast partition the axe findings", () => {
  const snaps = [snap({
    view: "success",
    axe: [
      { id: "image-alt", impact: "critical", targets: ["img.hero"], help: "Images must have alt text" },
      { id: "color-contrast", impact: "serious", targets: ["p.muted"], help: "Elements must have sufficient contrast" },
    ],
  })];

  it("a11y reports non-contrast violations only", () => {
    const r = a11y(snaps);
    expect(r.status).toBe("fail");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.detail).toContain("image-alt");
    expect(r.findings[0]!.ref).toBe("img.hero");
  });

  it("contrast reports color-contrast violations only", () => {
    const r = contrast(snaps);
    expect(r.status).toBe("fail");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.ref).toBe("p.muted");
  });

  it("both pass on a clean snapshot", () => {
    const clean = [snap({ axe: [] })];
    expect(a11y(clean).status).toBe("pass");
    expect(contrast(clean).status).toBe("pass");
  });
});

describe("htmlTokenConformance", () => {
  it("skips with no token register", () => {
    expect(htmlTokenConformance([snap({})], null).status).toBe("skip");
  });
  it("passes when every painted color is registered", () => {
    const snaps = [snap({ paintedColors: [{ hex: "#1e88e5", exampleSelector: "button.cta" }, { hex: "#111111", exampleSelector: "h1" }] })];
    expect(htmlTokenConformance(snaps, tokens).status).toBe("pass");
  });
  it("fails an unregistered painted color", () => {
    const snaps = [snap({ paintedColors: [{ hex: "#ff00ff", exampleSelector: "div.x" }] })];
    const r = htmlTokenConformance(snaps, tokens);
    expect(r.status).toBe("fail");
    expect(r.findings[0]!.detail).toContain("#ff00ff");
  });
});

describe("runHtmlBatch", () => {
  const VISUAL_MEDIUM: RenderScope = { visual: "medium", editorial: "low", coverage: "medium", flow: "low" };
  const VISUAL_LOW: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };
  const goodSnap = snap({
    coverChecks: [
      { story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true },
      { story: "checkout", impliedState: "error", selector: "#err", found: true, visible: true },
    ],
    paintedColors: [{ hex: "#1e88e5", exampleSelector: "button" }],
    axe: [],
  });

  it("runs all checks at visual:medium and is clean when all binding checks pass", () => {
    const r = runHtmlBatch({ snapshots: [goodSnap], stories, tokens, scope: VISUAL_MEDIUM });
    expect(r.clean).toBe(true);
    expect(r.checks.map((c) => c.id).sort()).toEqual([
      "a11y", "contrast", "flow-steps", "flow-story-coverage", "render-coverage",
      "style-conformance", "token-conformance", "typography-conformance",
    ]);
    // flow gates/style-conformance are not-owed without a unit/style; the rest pass.
    const conditional = new Set(["flow-steps", "flow-story-coverage", "style-conformance", "typography-conformance"]);
    expect(
      r.checks.every((c) => (conditional.has(c.id) ? c.status === "not-owed" : c.status === "pass")),
    ).toBe(true);
  });

  it("marks a11y/contrast/token not-owed at visual:low; render-coverage still binds", () => {
    const r = runHtmlBatch({ snapshots: [goodSnap], stories, tokens, scope: VISUAL_LOW });
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    expect(byId["render-coverage"]).toBe("pass");
    expect(byId["a11y"]).toBe("not-owed");
    expect(byId["token-conformance"]).toBe("not-owed");
  });

  it("mustPassFailed when a binding must check fails", () => {
    const r = runHtmlBatch({ snapshots: [snap({ ok: false, error: "x" })], stories, tokens, scope: VISUAL_MEDIUM });
    expect(r.clean).toBe(false);
    expect(r.mustPassFailed).toBe(true);
  });
});

// ─── Unit-type differentiation ───────────────────────────────────────────────

describe("unit-type differentiation", () => {
  const SCOPE: RenderScope = { visual: "medium", editorial: "low", coverage: "medium", flow: "low" };
  // Covers only 'success' — story 'checkout' also requires 'error'.
  const partialSnap = snap({
    view: "default",
    coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true }],
    paintedColors: [{ hex: "#1e88e5", exampleSelector: "button" }],
  });

  it("renderCoverage claims-only mode: uncovered stories pass, with an explanatory reason", () => {
    const r = renderCoverage([partialSnap], stories, { storyCoverage: false });
    expect(r.status).toBe("pass");
    expect(r.reason).toContain("story coverage");
  });

  it("renderCoverage claims-only mode: dead and invisible claims still fail", () => {
    const snaps = [snap({ coverChecks: [{ story: "checkout", impliedState: "success", selector: "#gone", found: false, visible: false }] })];
    expect(renderCoverage(snaps, stories, { storyCoverage: false }).status).toBe("fail");
  });

  it("component units (atoms through channel graphics): uncovered stories do not fail the gate", () => {
    for (const unit of [
      "atom", "molecule", "organism",
      "email", "instagram-post", "instagram-story",
      "youtube-thumbnail", "facebook-post", "x-post",
    ]) {
      const r = runHtmlBatch({ snapshots: [partialSnap], stories, tokens, scope: SCOPE, unit });
      expect(r.clean, unit).toBe(true);
      expect(r.unit, unit).toBe(unit);
    }
  });

  it("page-tier units keep full story coverage: uncovered stories fail", () => {
    for (const unit of ["home-page", "secondary-page", "tertiary-page", "page", "template", undefined]) {
      const r = runHtmlBatch({ snapshots: [partialSnap], stories, tokens, scope: SCOPE, unit });
      expect(r.clean, String(unit)).toBe(false);
    }
  });

  it("unit user-flow: a single rendered page fails flow-steps", () => {
    const fullSnap = snap({
      coverChecks: [
        { story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true },
        { story: "checkout", impliedState: "error", selector: "#err", found: true, visible: true },
      ],
      paintedColors: [{ hex: "#1e88e5", exampleSelector: "button" }],
    });
    const r = runHtmlBatch({ snapshots: [fullSnap], stories, tokens, scope: SCOPE, unit: "user-flow" });
    const fs = r.checks.find((c) => c.id === "flow-steps")!;
    expect(fs.status).toBe("fail");
    expect(r.mustPassFailed).toBe(true);
    expect(r.rubric).toContain("flow-steps");
  });

  it("unit user-flow: two distinct pages pass flow-steps", () => {
    const snaps = [
      snap({
        page: "screens/step-1.html",
        coverChecks: [
          { story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true },
          { story: "checkout", impliedState: "error", selector: "#err", found: true, visible: true },
        ],
        paintedColors: [{ hex: "#1e88e5", exampleSelector: "button" }],
      }),
      snap({ page: "screens/step-2.html", paintedColors: [{ hex: "#111111", exampleSelector: "p" }] }),
    ];
    const r = runHtmlBatch({ snapshots: snaps, stories, tokens, scope: SCOPE, unit: "user-flow" });
    expect(r.checks.find((c) => c.id === "flow-steps")!.status).toBe("pass");
  });

  it("per-viewport coverage: a story covered at one viewport but not another fails", () => {
    const desktop = { width: 1920, height: 1080 };
    const mobile = { width: 390, height: 844 };
    const coverBoth = [
      { story: "checkout", impliedState: "success" as const, selector: "#ok", found: true, visible: true },
      { story: "checkout", impliedState: "error" as const, selector: "#err", found: true, visible: true },
    ];
    const snaps = [
      // Desktop covers both states; mobile covers neither.
      snap({ viewport: desktop, coverChecks: coverBoth }),
      snap({ viewport: mobile, view: "plain", coverChecks: [] }),
    ];
    const r = renderCoverage(snaps, stories);
    expect(r.status).toBe("fail");
    expect(
      r.findings.some((f) => f.detail.includes("not covered") && f.detail.includes("390×844")),
    ).toBe(true);
    // The desktop viewport is fully covered — no desktop finding.
    expect(r.findings.some((f) => f.detail.includes("1920×1080"))).toBe(false);
  });

  it("per-viewport coverage: covered at every viewport passes", () => {
    const coverBoth = (vp: { width: number; height: number }) =>
      snap({
        viewport: vp,
        coverChecks: [
          { story: "checkout", impliedState: "success" as const, selector: "#ok", found: true, visible: true },
          { story: "checkout", impliedState: "error" as const, selector: "#err", found: true, visible: true },
        ],
      });
    const r = renderCoverage(
      [coverBoth({ width: 1920, height: 1080 }), coverBoth({ width: 390, height: 844 })],
      stories,
    );
    expect(r.status).toBe("pass");
  });

  it("flow-steps is not-owed for non-flow units, with a unit-specific reason", () => {
    for (const unit of [undefined, "page", "atom"]) {
      const r = runHtmlBatch({ snapshots: [partialSnap], stories, tokens, scope: SCOPE, unit });
      const fs = r.checks.find((c) => c.id === "flow-steps")!;
      expect(fs.status, String(unit)).toBe("not-owed");
      expect(fs.reason, String(unit)).toContain("user-flow");
      expect(r.rubric).not.toContain("flow-steps");
    }
  });
});

// ─── style-conformance (advisory) ────────────────────────────────────────────

describe("style-conformance: advisory deterministic style checks", () => {
  const SCOPE: RenderScope = { visual: "medium", editorial: "low", coverage: "medium", flow: "low" };
  const fullCover = [
    { story: "checkout", impliedState: "success" as const, selector: "#ok", found: true, visible: true },
    { story: "checkout", impliedState: "error" as const, selector: "#err", found: true, visible: true },
  ];
  const statsSnap = (styleStats: NonNullable<RenderSnapshot["styleStats"]>) =>
    snap({
      coverChecks: fullCover,
      paintedColors: [{ hex: "#1e88e5", exampleSelector: "b" }],
      styleStats,
    });

  it("flat with painted shadows fails ADVISORY — the gate stays clean", () => {
    const r = runHtmlBatch({
      snapshots: [statsSnap({ shadowCount: 3, fontFamilies: ["inter"], visibleElements: 40, roundedBlocks: 2 })],
      stories, tokens, scope: SCOPE, designStyle: "flat",
    });
    const sc = r.checks.find((c) => c.id === "style-conformance")!;
    expect(sc.status).toBe("fail");
    expect(sc.severity).toBe("advisory");
    expect(sc.findings.some((f) => f.detail.includes("shadow"))).toBe(true);
    // Advisory failures never fail the gate.
    expect(r.mustPassFailed).toBe(false);
    expect(r.clean).toBe(true);
    expect(r.rubric).toContain("style-conformance");
    expect(r.designStyle).toBe("flat");
  });

  it("flat with zero shadows passes", () => {
    const r = runHtmlBatch({
      snapshots: [statsSnap({ shadowCount: 0, fontFamilies: ["inter"], visibleElements: 40, roundedBlocks: 2 })],
      stories, tokens, scope: SCOPE, designStyle: "flat",
    });
    expect(r.checks.find((c) => c.id === "style-conformance")!.status).toBe("pass");
  });

  it("terminal demands monospace typography", () => {
    const bad = runHtmlBatch({
      snapshots: [statsSnap({ shadowCount: 0, fontFamilies: ["inter", "menlo"], visibleElements: 40, roundedBlocks: 0 })],
      stories, tokens, scope: SCOPE, designStyle: "terminal",
    });
    const sc = bad.checks.find((c) => c.id === "style-conformance")!;
    expect(sc.status).toBe("fail");
    expect(sc.findings.some((f) => f.detail.includes("monospace"))).toBe(true);

    const good = runHtmlBatch({
      snapshots: [statsSnap({ shadowCount: 0, fontFamilies: ["menlo", "courier new"], visibleElements: 40, roundedBlocks: 0 })],
      stories, tokens, scope: SCOPE, designStyle: "terminal",
    });
    expect(good.checks.find((c) => c.id === "style-conformance")!.status).toBe("pass");
  });

  it("minimalism flags element-dense views; bento flags too few rounded blocks", () => {
    const dense = runHtmlBatch({
      snapshots: [statsSnap({ shadowCount: 0, fontFamilies: ["inter"], visibleElements: 300, roundedBlocks: 0 })],
      stories, tokens, scope: SCOPE, designStyle: "minimalism",
    });
    expect(dense.checks.find((c) => c.id === "style-conformance")!.status).toBe("fail");

    const sparseBento = runHtmlBatch({
      snapshots: [statsSnap({ shadowCount: 0, fontFamilies: ["inter"], visibleElements: 40, roundedBlocks: 1 })],
      stories, tokens, scope: SCOPE, designStyle: "bento",
    });
    const sc = sparseBento.checks.find((c) => c.id === "style-conformance")!;
    expect(sc.status).toBe("fail");
    expect(sc.findings.some((f) => f.detail.includes("rounded"))).toBe(true);
  });

  it("styles without deterministic rules skip; absent style is not-owed; missing stats skip", () => {
    const noRules = runHtmlBatch({
      snapshots: [statsSnap({ shadowCount: 0, fontFamilies: [], visibleElements: 10, roundedBlocks: 0 })],
      stories, tokens, scope: SCOPE, designStyle: "vaporwave",
    });
    expect(noRules.checks.find((c) => c.id === "style-conformance")!.status).toBe("skip");

    const noStyle = runHtmlBatch({ snapshots: [statsSnap({ shadowCount: 0, fontFamilies: [], visibleElements: 10, roundedBlocks: 0 })], stories, tokens, scope: SCOPE });
    expect(noStyle.checks.find((c) => c.id === "style-conformance")!.status).toBe("not-owed");

    const noStats = runHtmlBatch({
      snapshots: [snap({ coverChecks: fullCover, paintedColors: [{ hex: "#1e88e5", exampleSelector: "b" }] })],
      stories, tokens, scope: SCOPE, designStyle: "flat",
    });
    expect(noStats.checks.find((c) => c.id === "style-conformance")!.status).toBe("skip");
  });
});

// ─── typography-conformance: advisory limits from the typography artifact ─────

describe("typography-conformance: advisory readability limits", () => {
  const SCOPE: RenderScope = { visual: "medium", editorial: "low", coverage: "medium", flow: "low" };
  const fullCover = [
    { story: "checkout", impliedState: "success" as const, selector: "#ok", found: true, visible: true },
    { story: "checkout", impliedState: "error" as const, selector: "#err", found: true, visible: true },
  ];
  const typoSnap = (minBodyFontPx: number | null, maxLineLengthCh: number | null) =>
    snap({
      coverChecks: fullCover,
      paintedColors: [{ hex: "#1e88e5", exampleSelector: "b" }],
      styleStats: {
        shadowCount: 0, fontFamilies: ["inter"], visibleElements: 40, roundedBlocks: 0,
        minBodyFontPx, maxLineLengthCh,
      },
    });

  it("body text below the minimum and overlong measures fail ADVISORY", () => {
    const r = runHtmlBatch({
      snapshots: [typoSnap(13, 92)],
      stories, tokens, scope: SCOPE,
      typography: { minBodySizePx: 16, lineLengthChMax: 75 },
    });
    const tc = r.checks.find((c) => c.id === "typography-conformance")!;
    expect(tc.status).toBe("fail");
    expect(tc.severity).toBe("advisory");
    expect(tc.findings.some((f) => f.detail.includes("13px"))).toBe(true);
    expect(tc.findings.some((f) => f.detail.includes("92ch"))).toBe(true);
    // Advisory failures never fail the gate.
    expect(r.mustPassFailed).toBe(false);
    expect(r.rubric).toContain("typography-conformance");
  });

  it("within limits passes; without a typography artifact the check is not owed", () => {
    const ok = runHtmlBatch({
      snapshots: [typoSnap(16, 68)],
      stories, tokens, scope: SCOPE,
      typography: { minBodySizePx: 16, lineLengthChMax: 75 },
    });
    expect(ok.checks.find((c) => c.id === "typography-conformance")!.status).toBe("pass");

    const unowned = runHtmlBatch({ snapshots: [typoSnap(13, 92)], stories, tokens, scope: SCOPE });
    expect(unowned.checks.find((c) => c.id === "typography-conformance")!.status).toBe("not-owed");
  });

  it("skips when the renderer captured no typography measurements", () => {
    const legacy = snap({
      coverChecks: fullCover,
      paintedColors: [{ hex: "#1e88e5", exampleSelector: "b" }],
      styleStats: { shadowCount: 0, fontFamilies: ["inter"], visibleElements: 40, roundedBlocks: 0 },
    });
    const r = runHtmlBatch({
      snapshots: [legacy], stories, tokens, scope: SCOPE,
      typography: { minBodySizePx: 16 },
    });
    expect(r.checks.find((c) => c.id === "typography-conformance")!.status).toBe("skip");
  });
});

// ─── a11y-spec: a registered accessibility contract forces binding ────────────

describe("a11y-spec forces a11y/contrast binding below the visual threshold", () => {
  const LOW_SCOPE: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };
  const coverSnap = snap({
    coverChecks: [
      { story: "checkout", impliedState: "success" as const, selector: "#ok", found: true, visible: true },
      { story: "checkout", impliedState: "error" as const, selector: "#err", found: true, visible: true },
    ],
    paintedColors: [{ hex: "#1e88e5", exampleSelector: "b" }],
  });

  it("without the artifact, a11y/contrast stay not-owed at visual:low", () => {
    const r = runHtmlBatch({ snapshots: [coverSnap], stories, tokens, scope: LOW_SCOPE });
    expect(r.checks.find((c) => c.id === "a11y")!.status).toBe("not-owed");
    expect(r.checks.find((c) => c.id === "contrast")!.status).toBe("not-owed");
  });

  it("registering the accessibility contract binds them regardless of fidelity", () => {
    const r = runHtmlBatch({
      snapshots: [coverSnap], stories, tokens, scope: LOW_SCOPE, a11ySpec: true,
    });
    expect(r.checks.find((c) => c.id === "a11y")!.status).toBe("pass");
    expect(r.checks.find((c) => c.id === "contrast")!.status).toBe("pass");
    expect(r.rubric).toContain("a11y");
    expect(r.rubric).toContain("contrast");
  });
});


// ─── ungoverned provenance rides the report ───────────────────────────────────

describe("ungoverned provenance in the report", () => {
  const SCOPE: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };
  const okSnap = snap({
    coverChecks: [
      { story: "checkout", impliedState: "success" as const, selector: "#ok", found: true, visible: true },
      { story: "checkout", impliedState: "error" as const, selector: "#err", found: true, visible: true },
    ],
  });

  it("stamped runs carry ungoverned:true; governed runs omit the key", () => {
    const stamped = runHtmlBatch({ snapshots: [okSnap], stories, tokens, scope: SCOPE, ungoverned: true });
    expect(stamped.ungoverned).toBe(true);
    const governed = runHtmlBatch({ snapshots: [okSnap], stories, tokens, scope: SCOPE });
    expect("ungoverned" in governed).toBe(false);
  });
});

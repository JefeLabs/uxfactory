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
    expect(r.checks.map((c) => c.id).sort()).toEqual(["a11y", "contrast", "flow-steps", "render-coverage", "token-conformance"]);
    // flow-steps is not-owed without the user-flow unit; everything else passes.
    expect(
      r.checks.every((c) => (c.id === "flow-steps" ? c.status === "not-owed" : c.status === "pass")),
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

  it("component units (atom/molecule/organism): uncovered stories do not fail the gate", () => {
    for (const unit of ["atom", "molecule", "organism"]) {
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

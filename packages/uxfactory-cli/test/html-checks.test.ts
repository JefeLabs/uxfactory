import { describe, it, expect } from "vitest";
import { renderCoverage, type RenderSnapshot } from "../src/batch/html-checks.js";
import { a11y, contrast } from "../src/batch/html-checks.js";
import type { StorySet } from "../src/batch/checks.js";

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

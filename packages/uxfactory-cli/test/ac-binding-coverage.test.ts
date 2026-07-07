/**
 * ac-binding-coverage.test.ts — page components → specific ACs (advisory).
 *
 * Design (resolved 2026-07-07, page-tier + advisory): each rendered element
 * claims a specific acId via its cover; the check reports every auto-checkable
 * AC not claimed by any element. Advisory — it nudges toward binding every AC
 * without breaking existing trace files that carry no acId.
 */
import { describe, it, expect } from "vitest";
import { acBindingCoverage, runHtmlBatch } from "../src/batch/html-checks.js";
import type { RenderSnapshot } from "../src/batch/html-checks.js";
import type { StorySet } from "../src/batch/checks.js";
import { validateTrace } from "../src/batch/trace.js";

const STORIES: StorySet = {
  stories: [
    {
      id: "browse-faq", role: "visitor", goal: "g", benefit: "b",
      acceptanceCriteria: [
        { acId: "AC-001", statement: "answers visible", impliedState: "success", checkable: "auto" },
        { acId: "AC-002", statement: "an error banner explains failure", impliedState: "error", checkable: "auto" },
        { acId: "AC-003", statement: "it feels trustworthy", impliedState: "success", checkable: "manual" },
      ],
    },
  ],
};

const snap = (claims: Array<{ story: string; acId?: string; state: string }>): RenderSnapshot =>
  ({
    page: "screens/faq.html", view: "default",
    viewport: { width: 1440, height: 900 }, screenshot: "x.png", ok: true,
    coverChecks: claims.map((c) => ({
      story: c.story, acId: c.acId, impliedState: c.state,
      selector: `[data-ac='${c.story}/${c.acId ?? c.state}']`, found: true, visible: true,
    })),
    paintedColors: [], axe: [],
  }) as unknown as RenderSnapshot;

describe("acBindingCoverage", () => {
  it("passes when every auto AC is claimed by an element carrying its acId", () => {
    const r = acBindingCoverage(
      [snap([{ story: "browse-faq", acId: "AC-001", state: "success" },
             { story: "browse-faq", acId: "AC-002", state: "error" }])],
      STORIES,
    );
    expect(r.status).toBe("pass");
    expect(r.severity).toBe("advisory");
  });

  it("reports an unclaimed auto AC — never the manual one", () => {
    const r = acBindingCoverage(
      [snap([{ story: "browse-faq", acId: "AC-001", state: "success" }])],
      STORIES,
    );
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.ref === "browse-faq/AC-002")).toBe(true);
    // AC-003 is manual — human sign-off, never nudged.
    expect(r.findings.some((f) => (f.ref ?? "").includes("AC-003"))).toBe(false);
  });

  it("a claim whose acId is absent (legacy trace) does not satisfy any AC", () => {
    const r = acBindingCoverage(
      [snap([{ story: "browse-faq", state: "success" },
             { story: "browse-faq", state: "error" }])],
      STORIES,
    );
    expect(r.status).toBe("fail");
    expect(r.findings.map((f) => f.ref).sort()).toEqual(["browse-faq/AC-001", "browse-faq/AC-002"]);
  });

  it("skips when no stories are registered", () => {
    expect(acBindingCoverage([snap([])], null).status).toBe("skip");
  });

  it("is advisory in runHtmlBatch — an AC-binding gap never flips clean", () => {
    const scope = { visual: "low", editorial: "low", coverage: "low", flow: "low" } as const;
    // Both required states are covered (render-coverage passes), but the error
    // element carries no acId — so ac-binding-coverage fails on AC-002 alone.
    const report = runHtmlBatch({
      snapshots: [
        snap([
          { story: "browse-faq", acId: "AC-001", state: "success" },
          { story: "browse-faq", state: "error" },
        ]),
      ],
      stories: STORIES, tokens: null, scope: { ...scope },
    });
    expect(report.checks.find((c) => c.id === "render-coverage")!.status).toBe("pass");
    const check = report.checks.find((c) => c.id === "ac-binding-coverage")!;
    expect(check.status).toBe("fail");
    expect(check.severity).toBe("advisory");
    expect(check.findings.some((f) => f.ref === "browse-faq/AC-002")).toBe(true);
    expect(report.clean).toBe(true);
  });
});

describe("trace cover acId (optional, validated when present)", () => {
  const base = {
    version: 1,
    pages: [{ file: "screens/faq.html", views: [{ id: "default", covers: [
      { story: "browse-faq", impliedState: "success", selector: "[data-ac='x']" },
    ] }] }],
  };
  it("accepts a cover with a string acId", () => {
    const t = JSON.parse(JSON.stringify(base));
    t.pages[0].views[0].covers[0].acId = "AC-001";
    expect(validateTrace(t).ok).toBe(true);
  });
  it("accepts a cover without acId (legacy)", () => {
    expect(validateTrace(base).ok).toBe(true);
  });
  it("rejects a non-string acId", () => {
    const t = JSON.parse(JSON.stringify(base));
    t.pages[0].views[0].covers[0].acId = 7;
    const r = validateTrace(t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/acId/);
  });
});

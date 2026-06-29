import { describe, it, expect } from "vitest";
import { planAnnotations } from "../src/annotation-plan.js";
import type { ReviewReportLike, AnnotationPlan } from "../src/annotation-plan.js";

describe("planAnnotations", () => {
  it("maps an unmet finding with a property to a conformance ElementFlag", () => {
    const report: ReviewReportLike = {
      conformant: false,
      findings: [
        {
          status: "unmet",
          property: "SubmitButton",
          detail: "Button must have a visible label",
          requirement: "REQ-01",
        },
      ],
    };
    const plan = planAnnotations(report);
    expect(plan.elementFlags).toHaveLength(1);
    expect(plan.coverageGaps).toHaveLength(0);
    const flag = plan.elementFlags[0]!;
    expect(flag.kind).toBe("conformance");
    expect(flag.nodeName).toBe("SubmitButton");
    expect(flag.severity).toBe("violation");
    expect(flag.reason).toBe("Button must have a visible label");
    expect(flag.index).toBe(0);
  });

  it("maps an advisory finding with a property to an advisory ElementFlag", () => {
    const report: ReviewReportLike = {
      conformant: true,
      findings: [
        {
          status: "advisory",
          property: "HeroImage",
          detail: "Image alt text is missing",
        },
      ],
    };
    const plan = planAnnotations(report);
    expect(plan.elementFlags).toHaveLength(1);
    expect(plan.coverageGaps).toHaveLength(0);
    const flag = plan.elementFlags[0]!;
    expect(flag.kind).toBe("advisory");
    expect(flag.nodeName).toBe("HeroImage");
    expect(flag.severity).toBe("suggestion");
    expect(flag.reason).toBe("Image alt text is missing");
    expect(flag.index).toBe(0);
  });

  it("maps an unmet finding with no property to a conformance CoverageGap", () => {
    const report: ReviewReportLike = {
      conformant: false,
      findings: [
        {
          status: "unmet",
          detail: "Error state not covered",
          requirement: "REQ-02",
        },
      ],
    };
    const plan = planAnnotations(report);
    expect(plan.elementFlags).toHaveLength(0);
    expect(plan.coverageGaps).toHaveLength(1);
    const gap = plan.coverageGaps[0]!;
    expect(gap.kind).toBe("conformance");
    expect(gap.severity).toBe("violation");
    expect(gap.reason).toBe("Error state not covered");
    expect(gap.requirement).toBe("REQ-02");
    expect(gap.index).toBe(0);
  });

  it("maps an advisory finding with no property to an advisory CoverageGap", () => {
    const report: ReviewReportLike = {
      conformant: true,
      findings: [
        {
          status: "advisory",
          detail: "Consider adding a loading skeleton",
        },
      ],
    };
    const plan = planAnnotations(report);
    expect(plan.elementFlags).toHaveLength(0);
    expect(plan.coverageGaps).toHaveLength(1);
    const gap = plan.coverageGaps[0]!;
    expect(gap.kind).toBe("advisory");
    expect(gap.severity).toBe("suggestion");
    expect(gap.reason).toBe("Consider adding a loading skeleton");
    expect(gap.requirement).toBeUndefined();
    expect(gap.index).toBe(0);
  });

  it("numbers flags and gaps sequentially and stably (element flags first, then gaps)", () => {
    const report: ReviewReportLike = {
      conformant: false,
      findings: [
        { status: "unmet", property: "NavBar", detail: "Missing skip link" },
        { status: "advisory", property: "Footer", detail: "Consider adding sitemap" },
        { status: "unmet", detail: "Logged-out state missing", requirement: "REQ-03" },
        { status: "advisory", detail: "Dark mode not addressed" },
      ],
    };
    const plan = planAnnotations(report);
    expect(plan.elementFlags).toHaveLength(2);
    expect(plan.coverageGaps).toHaveLength(2);
    // flags numbered 0, 1
    expect(plan.elementFlags[0]!.index).toBe(0);
    expect(plan.elementFlags[1]!.index).toBe(1);
    // gaps continue from 2, 3
    expect(plan.coverageGaps[0]!.index).toBe(2);
    expect(plan.coverageGaps[1]!.index).toBe(3);
  });

  it("numbering is stable (same input → same indices across calls)", () => {
    const report: ReviewReportLike = {
      conformant: false,
      findings: [
        { status: "unmet", property: "Header", detail: "Wrong color" },
        { status: "unmet", detail: "Empty state missing" },
      ],
    };
    const planA = planAnnotations(report);
    const planB = planAnnotations(report);
    expect(planA).toEqual(planB);
  });

  it("ignores findings with status 'met'", () => {
    const report: ReviewReportLike = {
      conformant: true,
      findings: [
        { status: "met", property: "Header", detail: "All good" },
        { status: "met", detail: "Coverage complete" },
      ],
    };
    const plan = planAnnotations(report);
    expect(plan.elementFlags).toHaveLength(0);
    expect(plan.coverageGaps).toHaveLength(0);
  });

  it("passes through the conformant value", () => {
    const conformantReport: ReviewReportLike = { conformant: true, findings: [] };
    const nonConformantReport: ReviewReportLike = {
      conformant: false,
      findings: [{ status: "unmet", detail: "Missing", requirement: "R1" }],
    };
    expect(planAnnotations(conformantReport).conformant).toBe(true);
    expect(planAnnotations(nonConformantReport).conformant).toBe(false);
  });

  it("handles an empty findings array", () => {
    const report: ReviewReportLike = { conformant: true, findings: [] };
    const plan = planAnnotations(report);
    expect(plan).toEqual<AnnotationPlan>({
      elementFlags: [],
      coverageGaps: [],
      conformant: true,
    });
  });

  it("ignores findings with other unknown statuses", () => {
    const report: ReviewReportLike = {
      conformant: true,
      findings: [
        { status: "skipped" as string, detail: "Was skipped" },
        { status: "pending" as string, detail: "Still pending" },
      ],
    };
    const plan = planAnnotations(report);
    expect(plan.elementFlags).toHaveLength(0);
    expect(plan.coverageGaps).toHaveLength(0);
  });
});

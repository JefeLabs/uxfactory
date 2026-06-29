/**
 * Pure module: turns a conformance ReviewReport into an AnnotationPlan the
 * plugin draws on the Figma canvas. No I/O, no figma.*, no @uxfactory/cli.
 */

export type AnnotationKind = "conformance" | "advisory";

export interface ElementFlag {
  index: number;
  nodeName: string;
  kind: AnnotationKind;
  severity: string;
  reason: string;
}

export interface CoverageGap {
  index: number;
  kind: AnnotationKind;
  severity: string;
  reason: string;
  requirement?: string;
}

export interface AnnotationPlan {
  elementFlags: ElementFlag[];
  coverageGaps: CoverageGap[];
  conformant: boolean;
}

/** Structural subset of the relayed ReviewReport — do not import @uxfactory/cli. */
export interface ReviewReportLike {
  conformant: boolean;
  findings: { requirement?: string; property?: string; status: string; detail: string }[];
  skipped?: unknown[];
  /**
   * Fix I1: reliability label from the CLI review. "best-effort" means the snapshot
   * was inferred from the canvas (not rendered by UXFactory). Rendered by `drawReview`
   * so it is visible on the canvas annotation panel.
   */
  reliability?: "exact" | "best-effort";
}

/**
 * Build a pure, deterministic AnnotationPlan from a ReviewReport.
 * Walk findings in order; element flags are numbered first (in finding order),
 * then coverage gaps (in finding order). `met` and unknown statuses are ignored.
 */
export function planAnnotations(report: ReviewReportLike): AnnotationPlan {
  const elementFlags: ElementFlag[] = [];
  const coverageGaps: CoverageGap[] = [];

  for (const finding of report.findings) {
    const { status, property, detail, requirement } = finding;

    if (status === "unmet") {
      // Fix C1: a finding with a non-empty `requirement` is a requirement-coverage AC
      // finding — its `property` is a state token, not a node name — so it MUST become
      // a CoverageGap. Only a finding with `property` and NO `requirement` is an ElementFlag.
      if (requirement !== undefined && requirement !== "") {
        const gap: CoverageGap = {
          index: 0,
          kind: "conformance",
          severity: "violation",
          reason: detail,
          requirement,
        };
        coverageGaps.push(gap);
      } else if (property !== undefined && property !== "") {
        elementFlags.push({
          index: 0, // placeholder; renumbered below
          nodeName: property,
          kind: "conformance",
          severity: "violation",
          reason: detail,
        });
      } else {
        const gap: CoverageGap = {
          index: 0, // placeholder; renumbered below
          kind: "conformance",
          severity: "violation",
          reason: detail,
        };
        coverageGaps.push(gap);
      }
    } else if (status === "advisory") {
      // Same rule: requirement set → CoverageGap; property only → ElementFlag; neither → gap.
      if (requirement !== undefined && requirement !== "") {
        const gap: CoverageGap = {
          index: 0,
          kind: "advisory",
          severity: "suggestion",
          reason: detail,
          requirement,
        };
        coverageGaps.push(gap);
      } else if (property !== undefined && property !== "") {
        elementFlags.push({
          index: 0, // placeholder; renumbered below
          nodeName: property,
          kind: "advisory",
          severity: "suggestion",
          reason: detail,
        });
      } else {
        const gap: CoverageGap = {
          index: 0, // placeholder; renumbered below
          kind: "advisory",
          severity: "suggestion",
          reason: detail,
        };
        coverageGaps.push(gap);
      }
    }
    // "met" and all other statuses are ignored
  }

  // Number sequentially: element flags first, then gaps
  let counter = 0;
  for (const flag of elementFlags) {
    flag.index = counter++;
  }
  for (const gap of coverageGaps) {
    gap.index = counter++;
  }

  return { elementFlags, coverageGaps, conformant: report.conformant };
}

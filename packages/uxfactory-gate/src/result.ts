import type { Editor } from "@uxfactory/spec";

/** The five gate checks (PRD §10.2). */
export type CheckId = "editorType" | "counts" | "presence" | "geometry" | "edits";

/** A check passes, fails, or does not apply to this spec shape. */
export type CheckStatus = "PASS" | "FAIL" | "SKIP";

/** One check's outcome in the result's `checks` array. */
export interface GateCheck {
  id: CheckId;
  status: CheckStatus;
  expected?: unknown;
  actual?: unknown;
  tolerancePx?: number;
}

/** A single concrete mismatch (PRD §10.1 `failures[]`). */
export interface GateFailure {
  check: CheckId;
  nodeId?: string;
  name?: string;
  property?: string;
  expected: unknown;
  actual: unknown;
  tolerancePx?: number;
}

/** Roll-up counts across the checks that ran. */
export interface GateSummary {
  checks: number;
  passed: number;
  failed: number;
  skipped: number;
}

/** The full result of a gate run (PRD §10.1). */
export interface GateResult {
  status: "PASS" | "FAIL";
  renderId?: string;
  verifyId?: string;
  editor?: Editor;
  pageKey?: string;
  fileName?: string;
  summary: GateSummary;
  checks: GateCheck[];
  failures: GateFailure[];
}

/** Options controlling a gate run. */
export interface GateOptions {
  /** Geometry epsilon in px. Default 0.5. */
  tolerancePx?: number;
  /** Subset of checks to run. Default: all five. */
  checks?: CheckId[];
  /** Caller-supplied id echoed into the result (the gate never generates ids). */
  verifyId?: string;
}

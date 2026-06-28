import type { Spec } from "@uxfactory/spec";
import type { RenderReport } from "./report.js";
import type { CheckId, GateCheck, GateFailure, GateOptions, GateResult } from "./result.js";
import {
  checkCounts,
  checkEdits,
  checkEditorType,
  checkGeometry,
  checkPresence,
  type CheckOutput,
} from "./checks.js";

/** Canonical order the checks run and appear in the result. */
const ALL_CHECKS: CheckId[] = ["editorType", "counts", "presence", "geometry", "edits"];

const DEFAULT_TOLERANCE_PX = 0.5;

function runCheck(id: CheckId, spec: Spec, report: RenderReport, tolerancePx: number): CheckOutput {
  switch (id) {
    case "editorType":
      return checkEditorType(spec, report);
    case "counts":
      return checkCounts(spec, report);
    case "presence":
      return checkPresence(spec, report);
    case "geometry":
      return checkGeometry(spec, report, tolerancePx);
    case "edits":
      return checkEdits(spec, report, tolerancePx);
  }
}

/**
 * Compare a spec against a render report and return a structured PASS/FAIL.
 * Pure and deterministic: no I/O, no clock — `verifyId` is supplied by the caller.
 */
export function gate(spec: Spec, report: RenderReport, options: GateOptions = {}): GateResult {
  const tolerancePx = options.tolerancePx ?? DEFAULT_TOLERANCE_PX;
  const requested = options.checks ?? ALL_CHECKS;

  const checks: GateCheck[] = [];
  const failures: GateFailure[] = [];
  for (const id of ALL_CHECKS) {
    if (!requested.includes(id)) continue;
    const output = runCheck(id, spec, report, tolerancePx);
    checks.push(output.check);
    failures.push(...output.failures);
  }

  const passed = checks.filter((c) => c.status === "PASS").length;
  const failed = checks.filter((c) => c.status === "FAIL").length;
  const skipped = checks.filter((c) => c.status === "SKIP").length;

  const result: GateResult = {
    status: failed === 0 ? "PASS" : "FAIL",
    renderId: report.renderId,
    editor: report.editor,
    pageKey: report.pageKey,
    fileName: report.fileName,
    summary: { checks: checks.length, passed, failed, skipped },
    checks,
    failures,
  };
  if (options.verifyId !== undefined) result.verifyId = options.verifyId;
  return result;
}

/**
 * reviewDesign — pure conformance review core (§14).
 *
 * "The §13 rubric run in reverse": reuses runBatch + the scope-bound gates to check
 * whether a design satisfies its registered requirements. Re-shapes BatchReport into
 * ReviewReport. PURE: no I/O, no LLM, no clock, no randomness.
 *
 * REUSE: calls the EXISTING runBatch (packages/uxfactory-cli/src/batch/run.ts).
 * Do NOT duplicate the gate logic or the scope-binding logic here.
 */
import type { RenderScope } from "../batch/scope.js";
import type { CheckResult, LoadedSpec, TokenSet, StorySet, Flow } from "../batch/checks.js";
import type { Spec } from "@uxfactory/spec";
import { runBatch } from "../batch/run.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ReviewFinding {
  /** Story id (when the finding is requirement/AC conformance). */
  requirement?: string;
  /** The implied state or node name (when available). */
  property?: string;
  status: "met" | "unmet" | "advisory";
  detail: string;
}

export interface ReviewReport {
  /** The render scope that was used to run this review. */
  scope: RenderScope;
  /** No binding must-conformance check failed. */
  conformant: boolean;
  /** The binding conformance gate ids (the rubric) for this scope. */
  rubric: string[];
  /** Re-framed findings from gate results (design↔intent). */
  findings: ReviewFinding[];
  /** Gates skip-and-declared (input absent). */
  skipped: { check: string; reason: string }[];
  /** Gate ids that do not bind at this scope. */
  notOwed: string[];
  /**
   * Binding gate ids that RAN and PASSED (positive evidence: conformant because checks
   * passed, not because everything was skipped). Empty only when no binding gates ran.
   */
  passed: string[];
  /**
   * Declared future tier artifact names (informational; not binding at this scope).
   * Parity with batch's `declared` entries — surfaced so the caller knows what tiers
   * will activate when the scope is raised.
   */
  declared: string[];
  /**
   * Fixed note: heuristic-UX checks (visual hierarchy, affordances, contrast,
   * cognitive load) are the agent/plugin judgment layer and are NOT run by the engine.
   */
  advisory: string;
  /**
   * Review reliability label (§14.2).
   * - "exact": the design is a UXFactory-authored spec rendered by the engine.
   * - "best-effort": the design is a CanvasSnapshot inferred from an arbitrary canvas
   *   (source:"canvas-inferred") or the caller passed --best-effort explicitly.
   */
  reliability: "exact" | "best-effort";
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Gate ids whose failures produce advisory findings (never unmet). */
const ADVISORY_GATE_IDS = new Set<string>(["flow-reachability", "coverage-orphans"]);

/**
 * The fixed heuristic-UX advisory note. Always present on every ReviewReport.
 * Declares that vision/LLM-based checks (contrast, affordances, hierarchy,
 * cognitive load) are the agent/plugin judgment layer — not run by the engine.
 */
const ADVISORY_NOTE =
  "Heuristic-UX checks (visual hierarchy, affordances, contrast, cognitive load) " +
  "are the agent/plugin judgment layer and are not run by the engine.";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Try to extract the implied state keyword from a requirement-coverage finding detail.
 * Detail format: `story X AC "..." implies a <state> state with no matching node`
 * Returns the state token or undefined when the pattern doesn't match.
 *
 * NOTE (v1 coupling): this re-parses the human `detail` string produced by
 * `requirementCoverage` in checks.ts. If that wording changes, `property` degrades
 * to `undefined`. Keep this regex in sync with the finding detail format in checks.ts.
 */
function extractImpliedState(detail: string): string | undefined {
  const m = /implies a (\w+) state/.exec(detail);
  return m?.[1];
}

/**
 * Map a single CheckResult into ReviewFindings / skipped / notOwed / passed / declared entries.
 * Mutates the provided output arrays in-place (avoids object allocation per call).
 */
function mapCheckResult(
  check: CheckResult,
  findings: ReviewFinding[],
  skipped: { check: string; reason: string }[],
  notOwed: string[],
  passed: string[],
  declared: string[],
): void {
  switch (check.status) {
    case "not-owed":
      notOwed.push(check.id);
      return;
    case "declared":
      // Future tiers — informational only; not binding, not skipped, not owed.
      declared.push(check.id);
      return;
    case "skip":
      skipped.push({ check: check.id, reason: check.reason ?? "input absent" });
      return;
    case "pass":
      // A passing binding gate: record as positive evidence (Fix 3 — self-evidencing verdict).
      passed.push(check.id);
      return;
    case "fail": {
      const isAdvisory = ADVISORY_GATE_IDS.has(check.id) || check.severity === "advisory";
      if (isAdvisory) {
        // Fix I1: keep `property` (= the finding's ref) on advisory findings when a ref
        // is present (e.g. `coverage-orphans` carries ref = frame name). This lets
        // `planAnnotations` produce an amber ElementFlag so code.ts draws an amber badge
        // on the named frame.
        for (const f of check.findings) {
          const finding: ReviewFinding = { status: "advisory", detail: f.detail };
          if (f.ref !== undefined) finding.property = f.ref;
          findings.push(finding);
        }
      } else {
        // Must-gate failure → unmet findings, with requirement/property where available.
        for (const f of check.findings) {
          const finding: ReviewFinding = { status: "unmet", detail: f.detail };
          if (check.id === "requirement-coverage") {
            finding.requirement = f.ref;
            finding.property = extractImpliedState(f.detail);
          } else {
            // reuse, token-conformance: ref is the container name or color value.
            if (f.ref !== undefined) finding.property = f.ref;
          }
          findings.push(finding);
        }
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a conformance review of the given design against its registered requirements.
 *
 * Builds a RunBatchInput from the provided inputs and calls the existing `runBatch`
 * (§13 rubric engine). Re-shapes the BatchReport into a ReviewReport (§14 view).
 *
 * PURE: synchronous, no I/O, no LLM, no side effects. All gate logic lives in runBatch.
 */
export function reviewDesign(input: {
  specs: { file: string; spec: unknown }[];
  stories: unknown | null;
  flow: unknown | null;
  tokens: unknown | null;
  reuseSpecs: { file: string; spec: unknown }[] | null;
  scope: RenderScope;
  /** Reliability label for the report. Defaults to "exact" (UXFactory-authored spec). */
  reliability?: "exact" | "best-effort";
}): ReviewReport {
  // Build the RunBatchInput — cast external unknown types to the internal types.
  // The command layer (Task 2) is responsible for spec validation before calling here.
  const batchInput = {
    specs: input.specs as LoadedSpec[],
    stories: input.stories as StorySet | null,
    flow: input.flow as Flow | null,
    tokens: input.tokens as TokenSet | null,
    // runBatch.reuseSpecs is Spec[] (not LoadedSpec[]) — extract the spec payload.
    reuseSpecs: input.reuseSpecs !== null ? input.reuseSpecs.map((r) => r.spec as Spec) : null,
    scope: input.scope,
  };

  // REUSE: delegate all gate logic and scope-binding to the existing runBatch.
  const { checks, rubric, mustPassFailed } = runBatch(batchInput);

  // Re-shape BatchReport → ReviewReport.
  const findings: ReviewFinding[] = [];
  const skipped: { check: string; reason: string }[] = [];
  const notOwed: string[] = [];
  const passed: string[] = [];
  const declared: string[] = [];

  for (const check of checks) {
    mapCheckResult(check, findings, skipped, notOwed, passed, declared);
  }

  return {
    scope: input.scope,
    conformant: !mustPassFailed,
    rubric,
    findings,
    skipped,
    notOwed,
    passed,
    declared,
    advisory: ADVISORY_NOTE,
    reliability: input.reliability ?? "exact",
  };
}

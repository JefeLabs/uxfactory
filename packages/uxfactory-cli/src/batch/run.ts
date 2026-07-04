import {
  tokenConformance,
  requirementCoverage,
  coverageOrphans,
  reuse,
  flowReachability,
} from "./checks.js";
import type { CheckResult, LoadedSpec, TokenSet, StorySet, Flow, Severity } from "./checks.js";
import type { Spec } from "@uxfactory/spec";
import { GATE_THRESHOLDS, binds, bindingGateIds, declaredFuture } from "./scope.js";
import type { RenderScope } from "./scope.js";

/** Everything a single deterministic batch pass needs (inputs already loaded; null = absent). */
export interface RunBatchInput {
  specs: LoadedSpec[];
  tokens: TokenSet | null;
  stories: StorySet | null;
  reuseSpecs: Spec[] | null;
  flow: Flow | null;
  /** The resolved render scope — gates bind only when scope meets their per-dial thresholds. */
  scope: RenderScope;
}

/** The result of one deterministic pass — the artifact the report.json and exit code derive from. */
export interface BatchReport {
  /** The resolved render scope that was used to scope this pass. */
  scope: RenderScope;
  /** The design unit this pass was gated as (registry `unit`), when declared. */
  unit?: string;
  /** The design style advisory checks ran against (registry `designStyle`). */
  designStyle?: string;
  /** The binding gate ids (the rubric) for this scope. */
  rubric: string[];
  checks: CheckResult[];
  mustPassFailed: boolean;
  clean: boolean;
}

/**
 * Per-gate metadata: severity and runner, in the canonical output order.
 * Severity is declared here so not-owed entries can carry the gate's intended severity
 * without actually invoking the gate runner.
 */
interface GateEntry {
  id: string;
  severity: Severity;
  run: (input: RunBatchInput) => CheckResult;
}

const GATE_ENTRIES: GateEntry[] = [
  {
    id: "token-conformance",
    severity: "must",
    run: (i) => tokenConformance(i.specs, i.tokens),
  },
  {
    id: "requirement-coverage",
    severity: "must",
    run: (i) => requirementCoverage(i.specs, i.stories),
  },
  {
    id: "coverage-orphans",
    severity: "advisory",
    run: (i) => coverageOrphans(i.specs, i.stories),
  },
  {
    id: "reuse",
    severity: "must",
    run: (i) => reuse(i.specs, i.reuseSpecs),
  },
  {
    id: "flow-reachability",
    severity: "advisory",
    run: (i) => flowReachability(i.specs, i.flow),
  },
];

/**
 * Run one deterministic scope-scoped batch pass.  FULLY DETERMINISTIC:
 * no async, no clock, no randomness, no judge/LLM.
 *
 * A gate runs ONLY when `binds(GATE_THRESHOLDS[id], scope)` (the rubric).
 * Non-binding gates emit a `not-owed` result and are NOT run.
 * `declaredFuture(scope)` entries are appended as informational `declared` results.
 *
 * `mustPassFailed` is true iff any BINDING gate has severity:"must" and status:"fail".
 * not-owed / declared / advisory entries NEVER gate; `clean = !mustPassFailed`.
 */
export function runBatch(input: RunBatchInput): BatchReport {
  const { scope } = input;
  const checks: CheckResult[] = [];

  for (const entry of GATE_ENTRIES) {
    const t = GATE_THRESHOLDS[entry.id];
    const doesBind = t !== undefined && binds(t, scope);

    if (doesBind) {
      checks.push(entry.run(input));
    } else {
      checks.push({
        id: entry.id,
        status: "not-owed",
        severity: entry.severity,
        findings: [],
        reason: "does not bind at the current render scope",
      });
    }
  }

  // Append declared future tiers — informational, always advisory, never gate.
  for (const tier of declaredFuture(scope)) {
    checks.push({
      id: tier.artifact,
      status: "declared",
      severity: "advisory",
      findings: [],
      reason: `declared future tier: ${tier.artifact} at ${tier.dial}:${tier.level}`,
    });
  }

  const rubric = bindingGateIds(scope);
  // Only a BINDING must gate with status:"fail" counts — not-owed/declared/advisory never gate.
  const mustPassFailed = checks.some((c) => c.severity === "must" && c.status === "fail");
  return { scope, rubric, checks, mustPassFailed, clean: !mustPassFailed };
}

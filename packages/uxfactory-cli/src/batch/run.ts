import {
  tokenConformance,
  requirementCoverage,
  coverageOrphans,
  reuse,
  flowReachability,
} from "./checks.js";
import type { CheckResult, LoadedSpec, TokenSet, StorySet, Flow } from "./checks.js";
import type { Spec } from "@uxfactory/spec";

/** Everything a single deterministic batch pass needs (inputs already loaded; null = absent). */
export interface RunBatchInput {
  specs: LoadedSpec[];
  tokens: TokenSet | null;
  stories: StorySet | null;
  reuseSpecs: Spec[] | null;
  flow: Flow | null;
}

/** The result of one deterministic pass — the artifact the report.json and exit code derive from. */
export interface BatchReport {
  checks: CheckResult[];
  mustPassFailed: boolean;
  clean: boolean;
}

/**
 * Run all four gates ONCE over the batch and aggregate. FULLY DETERMINISTIC:
 * no async, no clock, no randomness, no judge/LLM. `mustPassFailed` is true iff any
 * `severity:"must"` gate is `"fail"` (advisory gates never count); `clean = !mustPassFailed`.
 * This single pass IS the loop-termination signal — the SKILL.md loop, not the engine, iterates.
 */
export function runBatch(input: RunBatchInput): BatchReport {
  const checks: CheckResult[] = [
    tokenConformance(input.specs, input.tokens),
    requirementCoverage(input.specs, input.stories),
    coverageOrphans(input.specs, input.stories),
    reuse(input.specs, input.reuseSpecs),
    flowReachability(input.specs, input.flow),
  ];
  const mustPassFailed = checks.some((c) => c.severity === "must" && c.status === "fail");
  return { checks, mustPassFailed, clean: !mustPassFailed };
}

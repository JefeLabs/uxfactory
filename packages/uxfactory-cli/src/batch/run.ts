import {
  featureCoverage,
  flowStoryCoverage,
  scopeStories,
  tokenConformance,
  requirementCoverage,
  coverageOrphans,
  reuse,
  flowReachability,
} from "./checks.js";
import type { CheckResult, LoadedSpec, TokenSet, StorySet, Flow, Severity , FeatureSet, FeatureCoverage} from "./checks.js";
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
  /** Feature groupings — Coverage metric denominator (decision 12). Never gates. */
  features?: FeatureSet | null;
  /** Story-scoped contract: the unit is accountable to exactly these stories. */
  storyRefs?: string[];
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
  /** Escape-hatch provenance: the run generated without its required grounding. */
  ungoverned?: true;
  /** Coverage METRIC (decision 12): conformed features / total. Never gates. */
  featureCoverage?: FeatureCoverage;
  /** Story-scoped contract this run was gated under (registry `storyRefs`). */
  storyRefs?: string[];
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
  {
    id: "flow-story-coverage",
    severity: "advisory",
    run: (i) => flowStoryCoverage(i.specs, i.flow, i.stories),
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

  // Story-scoped contract: gate against EXACTLY the declared stories; a ref
  // naming no registered story becomes a must finding on the coverage check.
  let effective = input;
  let unknownRefFindings: import("./checks.js").BatchFinding[] = [];
  if (input.storyRefs !== undefined && input.stories !== null) {
    const scoped = scopeStories(input.stories, input.storyRefs);
    effective = { ...input, stories: scoped.scoped };
    unknownRefFindings = scoped.unknownRefFindings;
  }

  const checks: CheckResult[] = [];

  for (const entry of GATE_ENTRIES) {
    const t = GATE_THRESHOLDS[entry.id];
    const doesBind = t !== undefined && binds(t, scope);

    if (doesBind) {
      const result = entry.run(effective);
      if (entry.id === "requirement-coverage" && unknownRefFindings.length > 0) {
        result.findings.push(...unknownRefFindings);
        result.status = "fail";
      }
      checks.push(result);
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

  // Coverage METRIC (decision 12) — derived from the coverage gate's findings;
  // advisory metadata only, so it can never flip mustPassFailed.
  let metric: FeatureCoverage | undefined;
  if (input.features != null && effective.stories !== null) {
    const scopedIds = new Set(effective.stories.stories.map((s) => s.id));
    // A scoped run can only attest features it actually rendered.
    const attestable: FeatureSet =
      input.storyRefs !== undefined
        ? { features: input.features.features.filter((f) => f.storyRefs.every((r) => scopedIds.has(r))) }
        : input.features;
    const coverage = checks.find((c) => c.id === "requirement-coverage");
    metric = featureCoverage(
      attestable,
      scopedIds,
      coverage?.status === "fail" ? coverage.findings : [],
    );
  }

  return {
    scope,
    rubric,
    checks,
    mustPassFailed,
    clean: !mustPassFailed,
    ...(metric !== undefined ? { featureCoverage: metric } : {}),
    ...(input.storyRefs !== undefined ? { storyRefs: input.storyRefs } : {}),
  };
}

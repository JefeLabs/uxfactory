// tiers.ts — pure transformation module (no engine imports)
// Maps raw engine outputs to a typed tier model for the Checks UI screen.

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type TierId = "T0" | "T1" | "T2" | "T3" | "VLM";

export interface TierFinding {
  ruleId: string;
  message: string;
  nodeId?: string;
  expected?: string | number;
  actual?: string | number;
  hint?: string;
  /** I-1: prefix rendered before hint. "nearest: " for token findings; undefined for craft fixes. */
  hintPrefix?: string;
  /** I-2: preferred node name for ElementFlag routing (annotation-plan.ts drawReview). */
  nodeName?: string;
  /** I-2: requirement string for CoverageGap routing (annotation-plan.ts drawReview). */
  requirement?: string;
}

export interface TierRowModel {
  tier: TierId;
  name: string;
  status: "pass" | "fail" | "skipped" | "gated" | "running" | "pending";
  stats?: string;
  skipReason?: string;
  findings: TierFinding[];
}

export interface TierModel {
  rows: TierRowModel[];
  failedTier: TierId | null;
  openFindings: number;
  /** Escape-hatch provenance: the run generated without its required grounding. */
  ungoverned?: boolean;
}

export function toTierModel(input: {
  batchReport?: unknown;
  verifyResult?: unknown;
  craftReport?: unknown;
}): TierModel {
  try {
    return buildTierModel(input);
  } catch {
    return fallbackModel();
  }
}

// ---------------------------------------------------------------------------
// Internal engine-shape mirrors (no imports from engine packages)
// ---------------------------------------------------------------------------

interface BatchFinding {
  detail: string;
  ref?: string;
}

interface BatchCheckResult {
  id: string;
  status: string;
  severity?: string;
  findings: BatchFinding[];
  reason?: string;
}

interface BatchReport {
  checks?: BatchCheckResult[];
  mustPassFailed?: boolean;
  clean?: boolean;
  /** Coverage METRIC (decision 12): conformed features / total. Advisory only. */
  featureCoverage?: { conformed: number; total: number };
  /** Escape-hatch provenance from the registry — reported verbatim, never gating. */
  ungoverned?: boolean;
}

interface GateCheck {
  id: string;
  status: string;
  expected?: unknown;
  actual?: unknown;
}

interface GateFailure {
  check: string;
  nodeId?: string;
  name?: string;
  property?: string;
  expected: unknown;
  actual: unknown;
}

interface GateResult {
  status: string;
  checks?: GateCheck[];
  failures?: GateFailure[];
  summary?: { checks: number; passed: number; failed: number; skipped: number };
}

interface CraftFinding {
  screen: string;
  issue: string;
  fix: string;
}

interface CraftDimension {
  name: string;
  score: number;
  findings?: CraftFinding[];
}

interface CraftReport {
  version?: number;
  overall?: number;
  pass?: boolean;
  reliability?: string;
  dimensions?: CraftDimension[];
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isBatchReport(v: unknown): v is BatchReport {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  // M-2: exclude GateResult shapes — they always carry status "PASS" or "FAIL" at the root,
  // ensuring dual-dispatch (batchReport: raw, verifyResult: raw) routes correctly.
  if (rec.status === "PASS" || rec.status === "FAIL") return false;
  return Array.isArray(rec.checks);
}

function isGateResult(v: unknown): v is GateResult {
  if (typeof v !== "object" || v === null) return false;
  const s = (v as Record<string, unknown>).status;
  return s === "PASS" || s === "FAIL";
}

function isCraftReport(v: unknown): v is CraftReport {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).overall === "number"
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TierStatus = TierRowModel["status"];

const SKIP_STATUSES = new Set(["skip", "not-owed", "declared"]);

function isSkipStatus(s: string): boolean {
  return SKIP_STATUSES.has(s);
}

function coerceStr(v: unknown): string | number {
  if (typeof v === "string" || typeof v === "number") return v;
  return String(v);
}

function buildGateMsg(f: GateFailure): string {
  if (f.name) {
    return `${f.name}: ${f.property ?? f.check} expected ${String(f.expected)}, got ${String(f.actual)}`;
  }
  return `${f.check}: expected ${String(f.expected)}, got ${String(f.actual)}`;
}

function fallbackRow(tier: TierId, name: string): TierRowModel {
  return { tier, name, status: "pending", findings: [] };
}

function fallbackModel(): TierModel {
  return {
    rows: [
      fallbackRow("T0", "Schema"),
      fallbackRow("T1", "Coverage"),
      fallbackRow("T2", "Integrity"),
      fallbackRow("T3", "Conformance"),
      fallbackRow("VLM", "Craft review"),
    ],
    failedTier: null,
    openFindings: 0,
  };
}

// ---------------------------------------------------------------------------
// Per-tier builders
// ---------------------------------------------------------------------------

function buildT0(batch: BatchReport | null): TierRowModel {
  const tier: TierId = "T0";
  const name = "Schema";
  // M-1: No fake "2/2" stats. Schema validation is implicit — show "implicit" as honest note.
  const skipReason = "implicit";

  if (!batch) {
    return { tier, name, status: "pass", skipReason, findings: [] };
  }

  const schemaCheck = (batch.checks ?? []).find((c) => c.id === "schema");
  if (schemaCheck && schemaCheck.status === "fail") {
    const findings: TierFinding[] = (schemaCheck.findings ?? []).map((f) => ({
      ruleId: "schema.invalid",
      message: f.detail,
      nodeId: f.ref,
    }));
    return { tier, name, status: "fail", findings };
  }

  return { tier, name, status: "pass", skipReason, findings: [] };
}

function buildT1(batch: BatchReport | null): TierRowModel {
  const tier: TierId = "T1";
  const name = "Coverage";
  // The Coverage METRIC (decision 12) — features as denominator, when stamped.
  const fc = batch?.featureCoverage;
  const metricStats =
    fc !== undefined && typeof fc.total === "number" && fc.total > 0
      ? `${fc.conformed} of ${fc.total} features conformed`
      : undefined;

  if (!batch) {
    return { tier, name, status: "pending", findings: [] };
  }

  const check = (batch.checks ?? []).find((c) => c.id === "render-coverage");

  if (!check) {
    return { tier, name, status: "pending", findings: [] };
  }

  if (isSkipStatus(check.status)) {
    return {
      tier,
      name,
      status: "skipped",
      skipReason: check.reason ?? "not-owed",
      findings: [],
    };
  }

  if (check.status === "fail") {
    const findings: TierFinding[] = (check.findings ?? []).map((f) => {
      // I-2: parse requirement from ref.
      // Coverage refs have format "story-id/impliedState" (no "›").
      // Render-failure and selector refs use "page › view › ..." (contains "›").
      const ref = f.ref ?? "";
      const requirement =
        ref && !ref.includes("›") ? ref.replace("/", " · ") : undefined;
      return {
        ruleId: "coverage.render",
        message: f.detail,
        nodeId: f.ref,
        requirement,
      };
    });
    return {
      tier,
      name,
      status: "fail",
      stats:
        metricStats !== undefined
          ? `${findings.length} uncovered · ${metricStats}`
          : `${findings.length} uncovered`,
      findings,
    };
  }

  return { tier, name, status: "pass", stats: metricStats ?? "all covered", findings: [] };
}

function buildT2(batch: BatchReport | null): TierRowModel {
  const tier: TierId = "T2";
  const name = "Integrity";

  if (!batch) {
    return { tier, name, status: "pending", findings: [] };
  }

  const checks = batch.checks ?? [];
  const a11yCheck = checks.find((c) => c.id === "a11y");
  const contrastCheck = checks.find((c) => c.id === "contrast");
  const tokenCheck = checks.find((c) => c.id === "token-conformance");

  const relevant = [a11yCheck, contrastCheck, tokenCheck].filter(
    (c): c is BatchCheckResult => c !== undefined
  );

  // All skip/not-owed/declared
  if (
    relevant.length > 0 &&
    relevant.every((c) => isSkipStatus(c.status))
  ) {
    return {
      tier,
      name,
      status: "skipped",
      skipReason: "not-owed",
      findings: [],
    };
  }

  const findings: TierFinding[] = [];

  // a11y findings — I-2: nodeName = selector string for ElementFlag routing
  if (a11yCheck && a11yCheck.status === "fail") {
    for (const f of a11yCheck.findings ?? []) {
      const match = f.detail.match(/\(([^)]+)\)\s*$/);
      const ruleId = match ? `a11y.${match[1]}` : "a11y.violation";
      findings.push({ ruleId, message: f.detail, nodeId: f.ref, nodeName: f.ref });
    }
  }

  // contrast findings — I-2: nodeName = selector string
  if (contrastCheck && contrastCheck.status === "fail") {
    for (const f of contrastCheck.findings ?? []) {
      findings.push({
        ruleId: "contrast.text-min",
        message: f.detail,
        nodeId: f.ref,
        nodeName: f.ref,
      });
    }
  }

  // token-conformance findings — I-1: parse " — nearest: xxx" into hint with prefix
  if (tokenCheck && tokenCheck.status === "fail") {
    for (const f of tokenCheck.findings ?? []) {
      const nearestMatch = f.detail.match(/ — nearest: (.+)$/);
      const hint = nearestMatch ? nearestMatch[1] : undefined;
      const message = nearestMatch
        ? f.detail.replace(/ — nearest: .+$/, "")
        : f.detail;
      findings.push({
        ruleId: "token.color-raw",
        message,
        actual: f.ref, // hex color, not a node
        hint,
        hintPrefix: hint ? "nearest: " : undefined,
      });
    }
  }

  const anyFail = relevant.some((c) => c.status === "fail");
  if (anyFail) {
    return {
      tier,
      name,
      status: "fail",
      stats: `${findings.length} fail`,
      findings,
    };
  }

  return { tier, name, status: "pass", stats: "all pass", findings: [] };
}

function buildT3(verifyResult: unknown): TierRowModel {
  const tier: TierId = "T3";
  const name = "Conformance";

  if (!isGateResult(verifyResult)) {
    return { tier, name, status: "pending", findings: [] };
  }

  const gate = verifyResult;

  // I-2: nodeName = GateFailure.name for ElementFlag routing in annotation-plan.ts
  const findings: TierFinding[] = (gate.failures ?? []).map((f) => ({
    ruleId: `conform.${f.check}`,
    message: buildGateMsg(f),
    nodeId: f.nodeId,
    nodeName: f.name,
    expected: coerceStr(f.expected),
    actual: coerceStr(f.actual),
  }));

  const status: TierStatus = gate.status === "PASS" ? "pass" : "fail";

  // Compute stats
  let passed: number;
  let total: number;
  if (gate.summary) {
    passed = gate.summary.passed;
    total = gate.summary.checks;
  } else {
    const checks = gate.checks ?? [];
    total = checks.length;
    passed = checks.filter((c) => c.status === "PASS").length;
  }

  return {
    tier,
    name,
    status,
    stats: `${passed}/${total}`,
    findings,
  };
}

function buildVLM(
  craftReport: unknown,
  localFailed: boolean
): TierRowModel {
  const tier: TierId = "VLM";
  const name = "Craft review";

  if (localFailed) {
    return {
      tier,
      name,
      status: "gated",
      skipReason: "requires local pass",
      findings: [],
    };
  }

  if (!isCraftReport(craftReport)) {
    return { tier, name, status: "pending", findings: [] };
  }

  const report = craftReport;
  const overall = report.overall as number;
  const dimensions = report.dimensions ?? [];

  const passes =
    overall >= 4 && dimensions.every((d) => d.score >= 3);

  const findings: TierFinding[] = [];
  for (const dim of dimensions) {
    if (dim.score < 3) {
      for (const f of dim.findings ?? []) {
        findings.push({
          ruleId: `craft.${dim.name}`,
          message: `${f.screen}: ${f.issue}`,
          hint: f.fix,
          // I-1: hintPrefix intentionally omitted — craft fix suggestions have no "nearest: " prefix
        });
      }
    }
  }

  return {
    tier,
    name,
    status: passes ? "pass" : "fail",
    stats: `craft ${overall}/5 · ${passes ? "pass" : "fail"}`,
    findings,
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

function buildTierModel(input: {
  batchReport?: unknown;
  verifyResult?: unknown;
  craftReport?: unknown;
}): TierModel {
  const batch = isBatchReport(input.batchReport) ? input.batchReport : null;
  const rows: TierRowModel[] = [];

  // T0 — Schema
  const t0 = buildT0(batch);
  rows.push(t0);

  // Track first local failure for short-circuit cascade
  let firstLocalFail: TierId | null = t0.status === "fail" ? "T0" : null;

  // T1 — Coverage
  let t1: TierRowModel;
  if (firstLocalFail !== null) {
    t1 = {
      tier: "T1",
      name: "Coverage",
      status: "skipped",
      skipReason: "short-circuit",
      findings: [],
    };
  } else {
    t1 = buildT1(batch);
    if (t1.status === "fail") firstLocalFail = "T1";
  }
  rows.push(t1);

  // T2 — Integrity
  let t2: TierRowModel;
  if (firstLocalFail !== null) {
    t2 = {
      tier: "T2",
      name: "Integrity",
      status: "skipped",
      skipReason: "short-circuit",
      findings: [],
    };
  } else {
    t2 = buildT2(batch);
    if (t2.status === "fail") firstLocalFail = "T2";
  }
  rows.push(t2);

  // T3 — Conformance
  let t3: TierRowModel;
  if (firstLocalFail !== null) {
    t3 = {
      tier: "T3",
      name: "Conformance",
      status: "skipped",
      skipReason: "short-circuit",
      findings: [],
    };
  } else {
    t3 = buildT3(input.verifyResult);
    if (t3.status === "fail") firstLocalFail = "T3";
  }
  rows.push(t3);

  // VLM — Craft review
  const vlm = buildVLM(input.craftReport, firstLocalFailed(rows));
  rows.push(vlm);

  // openFindings: sum of findings across all "fail" rows
  const openFindings = rows
    .filter((r) => r.status === "fail")
    .reduce((acc, r) => acc + r.findings.length, 0);

  // failedTier: first tier id where status === "fail"
  const failedRow = rows.find((r) => r.status === "fail");
  const failedTier: TierId | null = failedRow ? failedRow.tier : null;

  return {
    rows,
    failedTier,
    openFindings,
    ...(batch?.ungoverned === true ? { ungoverned: true } : {}),
  };
}

/** True when any local (non-VLM) row failed — used to gate VLM. */
function firstLocalFailed(rows: TierRowModel[]): boolean {
  return rows.some((r) => r.tier !== "VLM" && r.status === "fail");
}

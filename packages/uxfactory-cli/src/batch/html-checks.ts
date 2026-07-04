import type { BatchFinding, CheckResult, ImpliedState, Severity, StorySet, TokenSet } from "./checks.js";
import type { CapturedNode } from "../render/dom-capture.js";
import { binds } from "./scope.js";
import type { GateThresholds, RenderScope } from "./scope.js";
import type { BatchReport } from "./run.js";

/** One trace cover, resolved against the activated DOM by the render stage. */
export interface CoverCheck {
  story: string;
  impliedState: ImpliedState;
  selector: string;
  found: boolean; // selector resolved ≥1 element
  visible: boolean; // rendered + non-zero box + not display:none/visibility:hidden/opacity:0
}

/** A distinct computed color actually painted on a visible element. */
export interface PaintedColor {
  hex: string; // "#RRGGBB", normalized by the render stage
  exampleSelector: string;
}

/** An axe-core violation captured during a view's single axe run. */
export interface AxeFinding {
  id: string; // rule id, e.g. "color-contrast", "image-alt"
  impact?: "minor" | "moderate" | "serious" | "critical";
  targets: string[]; // selectors of offending nodes
  help?: string;
}

/** The deterministic per-(page,view) record the pure checks consume. */
export interface RenderSnapshot {
  page: string;
  view: string;
  viewport: { width: number; height: number };
  screenshot: string; // relative path under .uxfactory/batch/previews/
  ok: boolean; // false → render/activation/settle failed
  error?: string; // present iff ok === false
  coverChecks: CoverCheck[];
  paintedColors: PaintedColor[];
  axe: AxeFinding[];
  /** Present iff the render was requested with captureDom (SP3b extract). */
  domTree?: CapturedNode;
}

/** Key separator (NUL char) that cannot appear in a story id or impliedState. */
const NUL = String.fromCharCode(0);

/** Component-tier units: gated claims-only — one component can't cover the story set. */
export const COMPONENT_UNITS: ReadonlySet<string> = new Set(["organism", "molecule", "atom"]);

/**
 * render-coverage (must) — every story's required impliedStates must each be claimed
 * by ≥1 visible cover across the rendered views. Pure + deterministic.
 *
 * `opts.storyCoverage: false` (component units) drops the story×state requirement
 * but keeps validating what IS claimed: render failures and dead/invisible
 * selectors still fail, and the relaxation is announced via `reason`.
 */
export function renderCoverage(
  snapshots: RenderSnapshot[],
  stories: StorySet | null,
  opts?: { storyCoverage?: boolean },
): CheckResult {
  const id = "render-coverage";
  const storyCoverage = opts?.storyCoverage ?? true;
  if (stories === null) {
    return { id, status: "skip", severity: "must", findings: [], reason: "no stories registered" };
  }
  const findings: BatchFinding[] = [];
  const covered = new Set<string>();
  for (const s of snapshots) {
    for (const c of s.coverChecks) {
      if (c.found && c.visible) covered.add(`${c.story}${NUL}${c.impliedState}`);
    }
  }
  // Render failures first — loud, never silent.
  for (const s of snapshots) {
    if (!s.ok) {
      findings.push({
        detail: `${s.page} › ${s.view} failed to render: ${s.error ?? "unknown error"}`,
        ref: `${s.page} › ${s.view}`,
      });
    }
  }
  // Dead / invisible claimed selectors.
  for (const s of snapshots) {
    for (const c of s.coverChecks) {
      if (!c.found) {
        findings.push({
          detail: `${s.page} › ${s.view}: claimed selector "${c.selector}" for ${c.story}/${c.impliedState} matched no element`,
          ref: `${s.page} › ${s.view} › ${c.selector}`,
        });
      } else if (!c.visible) {
        findings.push({
          detail: `${s.page} › ${s.view}: claimed selector "${c.selector}" for ${c.story}/${c.impliedState} is not visible`,
          ref: `${s.page} › ${s.view} › ${c.selector}`,
        });
      }
    }
  }
  // Required (story × distinct impliedState) coverage — page-tier units only.
  if (storyCoverage) {
    for (const story of stories.stories ?? []) {
      const required = new Set<ImpliedState>();
      for (const ac of story.acceptanceCriteria ?? []) required.add(ac.impliedState);
      for (const state of required) {
        if (!covered.has(`${story.id}${NUL}${state}`)) {
          findings.push({
            detail: `story ${story.id} ${state} state is not covered by any visible rendering`,
            ref: `${story.id}/${state}`,
          });
        }
      }
    }
  }
  return {
    id,
    status: findings.length > 0 ? "fail" : "pass",
    severity: "must",
    findings,
    ...(storyCoverage
      ? {}
      : { reason: "component unit — story coverage not required; claims still validated" }),
  };
}

/**
 * flow-steps (must, user-flow unit only) — a flow is multi-screen by definition:
 * the rendered set must span ≥2 distinct pages.
 */
export function flowSteps(snapshots: RenderSnapshot[]): CheckResult {
  const id = "flow-steps";
  const pages = new Set(snapshots.filter((s) => s.ok).map((s) => s.page));
  const findings: BatchFinding[] =
    pages.size >= 2
      ? []
      : [{
          detail: `a user flow needs at least 2 distinct screens; ${pages.size} rendered`,
          ref: [...pages][0] ?? "trace",
        }];
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

const CONTRAST_RULE = "color-contrast";

/** a11y (must) — all non-contrast axe violations across views. */
export function a11y(snapshots: RenderSnapshot[]): CheckResult {
  const id = "a11y";
  const findings: BatchFinding[] = [];
  for (const s of snapshots) {
    for (const v of s.axe) {
      if (v.id === CONTRAST_RULE) continue;
      findings.push({
        detail: `${s.page} › ${s.view}: ${v.help ?? v.id} (${v.id})`,
        ref: v.targets[0] ?? `${s.page} › ${s.view}`,
      });
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

/** contrast (must) — the color-contrast axe violations (partition of the same run). */
export function contrast(snapshots: RenderSnapshot[]): CheckResult {
  const id = "contrast";
  const findings: BatchFinding[] = [];
  for (const s of snapshots) {
    for (const v of s.axe) {
      if (v.id !== CONTRAST_RULE) continue;
      findings.push({
        detail: `${s.page} › ${s.view}: ${v.help ?? "insufficient color contrast"}`,
        ref: v.targets[0] ?? `${s.page} › ${s.view}`,
      });
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

/** Normalize a hex string to "#rrggbb" (3- or 6-digit, case-insensitive). null if not hex. */
function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  const m6 = /^#[0-9a-f]{6}$/.exec(v);
  if (m6) return v;
  return null;
}

/** token-conformance (must) — every painted color must be a registered token. */
export function htmlTokenConformance(snapshots: RenderSnapshot[], tokens: TokenSet | null): CheckResult {
  const id = "token-conformance";
  if (tokens === null) {
    return { id, status: "skip", severity: "must", findings: [], reason: "no token register registered" };
  }
  const registered = new Set<string>();
  for (const value of Object.values(tokens.colors ?? {})) {
    const n = normalizeHex(value);
    if (n !== null) registered.add(n);
  }
  const findings: BatchFinding[] = [];
  const seen = new Set<string>();
  for (const s of snapshots) {
    for (const pc of s.paintedColors) {
      const n = normalizeHex(pc.hex);
      const key = `${s.page}${NUL}${pc.hex.toLowerCase()}`;
      if ((n === null || !registered.has(n)) && !seen.has(key)) {
        seen.add(key);
        findings.push({
          detail: `${s.page}: painted color ${pc.hex} at ${pc.exampleSelector} is not a registered token`,
          ref: pc.hex,
        });
      }
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

/** Per-gate binding thresholds for the HTML tier (kept separate from spec-mode GATE_THRESHOLDS). */
export const HTML_GATE_THRESHOLDS: Record<string, GateThresholds> = {
  "render-coverage": { min_visual: "none", min_editorial: "none", min_coverage: "low", min_flow: "none" },
  a11y: { min_visual: "medium", min_editorial: "none", min_coverage: "none", min_flow: "none" },
  contrast: { min_visual: "medium", min_editorial: "none", min_coverage: "none", min_flow: "none" },
  "token-conformance": { min_visual: "medium", min_editorial: "none", min_coverage: "none", min_flow: "none" },
  "flow-steps": { min_visual: "none", min_editorial: "none", min_coverage: "none", min_flow: "none" },
};

/** Everything one deterministic HTML gate pass needs (snapshots already captured). */
export interface RunHtmlBatchInput {
  snapshots: RenderSnapshot[];
  stories: StorySet | null;
  tokens: TokenSet | null;
  scope: RenderScope;
  /** Optional design unit (registry `unit` field) — shapes the rubric per unit. */
  unit?: string;
}

interface HtmlGateEntry {
  id: string;
  severity: Severity;
  run: (i: RunHtmlBatchInput) => CheckResult;
  /** Unit predicate — the gate binds only when this returns true (default: always). */
  bindsForUnit?: (unit: string | undefined) => boolean;
  /** not-owed reason when the unit predicate excludes the gate. */
  unitNotOwedReason?: string;
}

const HTML_GATE_ENTRIES: HtmlGateEntry[] = [
  {
    id: "render-coverage",
    severity: "must",
    run: (i) =>
      renderCoverage(i.snapshots, i.stories, {
        storyCoverage: i.unit === undefined || !COMPONENT_UNITS.has(i.unit),
      }),
  },
  { id: "a11y", severity: "must", run: (i) => a11y(i.snapshots) },
  { id: "contrast", severity: "must", run: (i) => contrast(i.snapshots) },
  { id: "token-conformance", severity: "must", run: (i) => htmlTokenConformance(i.snapshots, i.tokens) },
  {
    id: "flow-steps",
    severity: "must",
    run: (i) => flowSteps(i.snapshots),
    bindsForUnit: (unit) => unit === "user-flow",
    unitNotOwedReason: "binds only for the user-flow unit",
  },
];

/**
 * One deterministic scope-scoped HTML gate pass. PURE: no async, no clock, no LLM.
 * A gate runs only when `binds(HTML_GATE_THRESHOLDS[id], scope)`; others are `not-owed`.
 * Returns the BatchReport shape so report.json stays identical between modes.
 */
export function runHtmlBatch(input: RunHtmlBatchInput): BatchReport {
  const { scope, unit } = input;
  const checks: CheckResult[] = [];
  const rubric: string[] = [];
  for (const entry of HTML_GATE_ENTRIES) {
    const t = HTML_GATE_THRESHOLDS[entry.id];
    const unitBinds = entry.bindsForUnit?.(unit) ?? true;
    const doesBind = t !== undefined && binds(t, scope) && unitBinds;
    if (doesBind) {
      rubric.push(entry.id);
      checks.push(entry.run(input));
    } else {
      checks.push({
        id: entry.id, status: "not-owed", severity: entry.severity, findings: [],
        reason: unitBinds
          ? "does not bind at the current render scope"
          : entry.unitNotOwedReason ?? "does not bind for this unit",
      });
    }
  }
  const mustPassFailed = checks.some((c) => c.severity === "must" && c.status === "fail");
  return {
    scope,
    ...(unit !== undefined ? { unit } : {}),
    rubric,
    checks,
    mustPassFailed,
    clean: !mustPassFailed,
  };
}

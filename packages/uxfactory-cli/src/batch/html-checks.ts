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

/** Style facts the renderer captures for the advisory style-conformance check. */
export interface StyleStats {
  /** Visible elements painting a box- or text-shadow. */
  shadowCount: number;
  /** Distinct first font families in use (lowercased). */
  fontFamilies: string[];
  /** Count of visible elements in the view. */
  visibleElements: number;
  /** Visible blocks with a border radius ≥ 8px and a non-trivial area. */
  roundedBlocks: number;
  /** Smallest computed font-size (px) among body-copy elements (≥40 chars); null when none. */
  minBodyFontPx?: number | null;
  /** Longest approximate measure (chars per rendered line) among body copy; null when none. */
  maxLineLengthCh?: number | null;
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
  /** Present when the renderer captured style facts (advisory style checks). */
  styleStats?: StyleStats;
}

/** Key separator (NUL char) that cannot appear in a story id or impliedState. */
const NUL = String.fromCharCode(0);

/**
 * Component-tier units: gated claims-only — one component (or one fixed-canvas
 * channel graphic) can't plausibly cover the story set.
 */
export const COMPONENT_UNITS: ReadonlySet<string> = new Set([
  "organism",
  "molecule",
  "atom",
  "email",
  "instagram-post",
  "instagram-story",
  "youtube-thumbnail",
  "facebook-post",
  "x-post",
]);

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
  // Coverage is per viewport: a story×state must be visibly covered at EVERY
  // rendered viewport, not just any one of them.
  const vpKey = (s: RenderSnapshot): string => `${s.viewport.width}×${s.viewport.height}`;
  const viewports = new Set(snapshots.map(vpKey));
  const covered = new Set<string>();
  for (const s of snapshots) {
    for (const c of s.coverChecks) {
      if (c.found && c.visible) covered.add(`${c.story}${NUL}${c.impliedState}${NUL}${vpKey(s)}`);
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
  // Required (story × distinct impliedState × viewport) coverage — page-tier
  // units only. Single-viewport runs keep the legacy finding wording.
  if (storyCoverage) {
    const multiViewport = viewports.size > 1;
    for (const story of stories.stories ?? []) {
      const required = new Set<ImpliedState>();
      for (const ac of story.acceptanceCriteria ?? []) required.add(ac.impliedState);
      for (const state of required) {
        for (const vp of viewports) {
          if (!covered.has(`${story.id}${NUL}${state}${NUL}${vp}`)) {
            findings.push({
              detail: multiViewport
                ? `story ${story.id} ${state} state is not covered by any visible rendering at ${vp}`
                : `story ${story.id} ${state} state is not covered by any visible rendering`,
              ref: multiViewport ? `${story.id}/${state}@${vp}` : `${story.id}/${state}`,
            });
          }
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

/**
 * style-conformance (advisory) — machine-checkable traits of the declared
 * design style. Advisory by design: style is ultimately a judgment call, so
 * findings inform the craft loop but never fail the gate.
 */
const MONO_FONT = /mono|courier|consolas|menlo|terminal/;

const STYLE_RULES: Record<string, (s: RenderSnapshot) => BatchFinding[]> = {
  flat: (s) =>
    s.styleStats!.shadowCount > 0
      ? [{
          detail: `${s.page} › ${s.view}: ${s.styleStats!.shadowCount} shadowed element(s) — Flat forbids shadows and 3D effects`,
          ref: `${s.page} › ${s.view}`,
        }]
      : [],
  terminal: (s) => {
    const nonMono = s.styleStats!.fontFamilies.filter((f) => !MONO_FONT.test(f));
    return nonMono.length > 0
      ? [{
          detail: `${s.page} › ${s.view}: non-monospace font(s) ${nonMono.join(", ")} — Terminal/CLI demands monospace typography`,
          ref: `${s.page} › ${s.view}`,
        }]
      : [];
  },
  minimalism: (s) =>
    s.styleStats!.visibleElements > 120
      ? [{
          detail: `${s.page} › ${s.view}: ${s.styleStats!.visibleElements} visible elements — Minimalism wants few elements and lots of negative space`,
          ref: `${s.page} › ${s.view}`,
        }]
      : [],
  bento: (s) =>
    s.styleStats!.roundedBlocks < 4
      ? [{
          detail: `${s.page} › ${s.view}: only ${s.styleStats!.roundedBlocks} rounded content block(s) — Bento composes many rounded blocks`,
          ref: `${s.page} › ${s.view}`,
        }]
      : [],
};

export function styleConformance(
  snapshots: RenderSnapshot[],
  designStyle: string,
): CheckResult {
  const id = "style-conformance";
  const rule = STYLE_RULES[designStyle];
  if (rule === undefined) {
    return {
      id, status: "skip", severity: "advisory", findings: [],
      reason: `no deterministic rules for style "${designStyle}"`,
    };
  }
  const measured = snapshots.filter((s) => s.ok && s.styleStats !== undefined);
  if (measured.length === 0) {
    return {
      id, status: "skip", severity: "advisory", findings: [],
      reason: "renderer did not capture style stats",
    };
  }
  const findings = measured.flatMap((s) => rule(s));
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "advisory", findings };
}

/** Readability limits from the typography artifact (design-system.json#typography). */
export interface TypographyLimits {
  minBodySizePx?: number;
  lineLengthChMax?: number;
}

/**
 * Extract TypographyLimits from a parsed design-system document. Returns null
 * when no typography section exists (the check then does not bind).
 * `limits.minBodySizePx` may be a number or a per-device map — the strictest
 * (largest minimum) value applies.
 */
export function typographyLimitsFrom(designSystem: unknown): TypographyLimits | null {
  if (designSystem === null || typeof designSystem !== "object") return null;
  const typography = (designSystem as Record<string, unknown>)["typography"];
  if (typography === null || typeof typography !== "object") return null;
  const limits = (typography as Record<string, unknown>)["limits"];
  const out: TypographyLimits = {};
  if (limits !== null && typeof limits === "object") {
    const l = limits as Record<string, unknown>;
    const minBody = l["minBodySizePx"];
    if (typeof minBody === "number") out.minBodySizePx = minBody;
    else if (minBody !== null && typeof minBody === "object") {
      const values = Object.values(minBody as Record<string, unknown>).filter(
        (v): v is number => typeof v === "number",
      );
      if (values.length > 0) out.minBodySizePx = Math.max(...values);
    }
    const lineLength = l["lineLengthCh"];
    if (lineLength !== null && typeof lineLength === "object") {
      const max = (lineLength as Record<string, unknown>)["max"];
      if (typeof max === "number") out.lineLengthChMax = max;
    }
  }
  return out; // typography section exists → the check binds even with no limits
}

/** typography-conformance (advisory) — readability limits from the artifact. */
export function typographyConformance(
  snapshots: RenderSnapshot[],
  limits: TypographyLimits,
): CheckResult {
  const id = "typography-conformance";
  const measured = snapshots.filter(
    (s) => s.ok && s.styleStats !== undefined && "minBodyFontPx" in s.styleStats,
  );
  if (measured.length === 0) {
    return {
      id, status: "skip", severity: "advisory", findings: [],
      reason: "renderer did not capture typography stats",
    };
  }
  const findings = measured.flatMap((s) => {
    const out: BatchFinding[] = [];
    const stats = s.styleStats!;
    if (
      limits.minBodySizePx !== undefined &&
      typeof stats.minBodyFontPx === "number" &&
      stats.minBodyFontPx < limits.minBodySizePx
    ) {
      out.push({
        detail: `${s.page} › ${s.view}: body text at ${stats.minBodyFontPx}px is below the ${limits.minBodySizePx}px minimum`,
      });
    }
    if (
      limits.lineLengthChMax !== undefined &&
      typeof stats.maxLineLengthCh === "number" &&
      stats.maxLineLengthCh > limits.lineLengthChMax
    ) {
      out.push({
        detail: `${s.page} › ${s.view}: measure runs ${Math.round(stats.maxLineLengthCh)}ch — beyond the ${limits.lineLengthChMax}ch maximum`,
      });
    }
    return out;
  });
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "advisory", findings };
}

/** Per-gate binding thresholds for the HTML tier (kept separate from spec-mode GATE_THRESHOLDS). */
export const HTML_GATE_THRESHOLDS: Record<string, GateThresholds> = {
  "render-coverage": { min_visual: "none", min_editorial: "none", min_coverage: "low", min_flow: "none" },
  a11y: { min_visual: "medium", min_editorial: "none", min_coverage: "none", min_flow: "none" },
  contrast: { min_visual: "medium", min_editorial: "none", min_coverage: "none", min_flow: "none" },
  "token-conformance": { min_visual: "medium", min_editorial: "none", min_coverage: "none", min_flow: "none" },
  "flow-steps": { min_visual: "none", min_editorial: "none", min_coverage: "none", min_flow: "none" },
  "style-conformance": { min_visual: "none", min_editorial: "none", min_coverage: "none", min_flow: "none" },
  "typography-conformance": { min_visual: "none", min_editorial: "none", min_coverage: "none", min_flow: "none" },
};

/** Everything one deterministic HTML gate pass needs (snapshots already captured). */
export interface RunHtmlBatchInput {
  snapshots: RenderSnapshot[];
  stories: StorySet | null;
  tokens: TokenSet | null;
  scope: RenderScope;
  /** Optional design unit (registry `unit` field) — shapes the rubric per unit. */
  unit?: string;
  /** Optional design style (registry `designStyle`) — enables advisory style checks. */
  designStyle?: string;
  /** Readability limits from the typography artifact — enables typography-conformance. */
  typography?: TypographyLimits;
  /** True when an accessibility contract is registered — a11y/contrast bind at ANY fidelity. */
  a11ySpec?: boolean;
  /** Escape-hatch provenance from the registry — reported verbatim, never gating. */
  ungoverned?: boolean;
}

interface HtmlGateEntry {
  id: string;
  severity: Severity;
  run: (i: RunHtmlBatchInput) => CheckResult;
  /** Input predicate — the gate binds only when this returns true (default: always). */
  bindsWhen?: (i: RunHtmlBatchInput) => boolean;
  /** not-owed reason when the predicate excludes the gate. */
  notOwedReason?: string;
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
    bindsWhen: (i) => i.unit === "user-flow",
    notOwedReason: "binds only for the user-flow unit",
  },
  {
    id: "style-conformance",
    severity: "advisory",
    run: (i) => styleConformance(i.snapshots, i.designStyle!),
    bindsWhen: (i) => i.designStyle !== undefined,
    notOwedReason: "no design style declared",
  },
  {
    id: "typography-conformance",
    severity: "advisory",
    run: (i) => typographyConformance(i.snapshots, i.typography!),
    bindsWhen: (i) => i.typography !== undefined,
    notOwedReason: "no typography artifact registered",
  },
];

/**
 * One deterministic scope-scoped HTML gate pass. PURE: no async, no clock, no LLM.
 * A gate runs only when `binds(HTML_GATE_THRESHOLDS[id], scope)`; others are `not-owed`.
 * Returns the BatchReport shape so report.json stays identical between modes.
 */
export function runHtmlBatch(input: RunHtmlBatchInput): BatchReport {
  const { scope, unit, designStyle } = input;
  const checks: CheckResult[] = [];
  const rubric: string[] = [];
  for (const entry of HTML_GATE_ENTRIES) {
    const t = HTML_GATE_THRESHOLDS[entry.id];
    const predicateBinds = entry.bindsWhen?.(input) ?? true;
    // A registered accessibility contract escalates a11y/contrast to bound at
    // ANY fidelity (mapping decision 14: registration upgrades the posture).
    const forcedByA11ySpec =
      input.a11ySpec === true && (entry.id === "a11y" || entry.id === "contrast");
    const doesBind = t !== undefined && (binds(t, scope) || forcedByA11ySpec) && predicateBinds;
    if (doesBind) {
      rubric.push(entry.id);
      checks.push(entry.run(input));
    } else {
      checks.push({
        id: entry.id, status: "not-owed", severity: entry.severity, findings: [],
        reason: predicateBinds
          ? "does not bind at the current render scope"
          : entry.notOwedReason ?? "does not bind for this input",
      });
    }
  }
  const mustPassFailed = checks.some((c) => c.severity === "must" && c.status === "fail");
  return {
    scope,
    ...(unit !== undefined ? { unit } : {}),
    ...(designStyle !== undefined ? { designStyle } : {}),
    ...(input.ungoverned === true ? { ungoverned: true as const } : {}),
    rubric,
    checks,
    mustPassFailed,
    clean: !mustPassFailed,
  };
}

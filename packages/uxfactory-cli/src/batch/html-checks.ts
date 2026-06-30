import type { BatchFinding, CheckResult, ImpliedState, StorySet } from "./checks.js";

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
}

/** Key separator (NUL char) that cannot appear in a story id or impliedState. */
const NUL = String.fromCharCode(0);

/**
 * render-coverage (must) — every story's required impliedStates must each be claimed
 * by ≥1 visible cover across the rendered views. Pure + deterministic.
 */
export function renderCoverage(snapshots: RenderSnapshot[], stories: StorySet | null): CheckResult {
  const id = "render-coverage";
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
  // Required (story × distinct impliedState) coverage.
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

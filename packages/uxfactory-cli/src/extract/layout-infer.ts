/**
 * Aggressive auto-layout inference (SP3b §5): flex / 1-D grid / block flow →
 * AutoLayout CANDIDATES. Pure; a candidate is only kept after the geometric
 * self-check (see verifyCandidate) — never trusted directly.
 */
import type { AutoLayout, Padding } from "@uxfactory/spec";
import type { CapturedNode } from "../render/dom-capture.js";
import { px } from "./dom-to-designspec.js";

export type LayoutSource = "flex" | "grid" | "flow";
export interface LayoutCandidate { layout: AutoLayout; source: LayoutSource; }

const PRIMARY_ALIGN: Record<string, AutoLayout["primaryAlign"]> = {
  "flex-start": "start", start: "start", normal: "start", left: "start",
  center: "center", "flex-end": "end", end: "end", right: "end",
  "space-between": "space-between",
};
const COUNTER_ALIGN: Record<string, AutoLayout["counterAlign"]> = {
  "flex-start": "start", start: "start", normal: "start", stretch: "start",
  center: "center", "flex-end": "end", end: "end", baseline: "start",
};
const GAP_TOLERANCE = 1;

function paddingOf(n: CapturedNode): Padding {
  const s = n.styles;
  return { top: px(s.paddingTop), right: px(s.paddingRight), bottom: px(s.paddingBottom), left: px(s.paddingLeft) };
}

function withOptional(base: AutoLayout, gap: number, padding: Padding,
  primary?: AutoLayout["primaryAlign"], counter?: AutoLayout["counterAlign"]): AutoLayout {
  const out: AutoLayout = { mode: base.mode };
  if (gap !== 0) out.gap = gap;
  out.padding = padding;
  if (primary !== undefined && primary !== "start") out.primaryAlign = primary;
  else if (primary === "start") out.primaryAlign = "start";
  if (counter !== undefined) out.counterAlign = counter;
  return out;
}

function flexCandidate(n: CapturedNode): LayoutCandidate | null {
  const s = n.styles;
  let mode: AutoLayout["mode"];
  if (s.flexDirection === "row") mode = "horizontal";
  else if (s.flexDirection === "column") mode = "vertical";
  else return null;                                     // *-reverse not expressible
  const primary = PRIMARY_ALIGN[s.justifyContent];
  if (primary === undefined) return null;               // space-around/evenly etc.
  const counter = COUNTER_ALIGN[s.alignItems];
  if (counter === undefined) return null;
  const gap = mode === "vertical" ? px(s.rowGap) : px(s.columnGap);
  return { source: "flex", layout: withOptional({ mode }, gap, paddingOf(n), primary, counter) };
}

/** Count resolved track tokens at top level (computed lists are px values; parens guarded anyway). */
function trackCount(list: string): number {
  if (list === "none" || list === "") return 0;
  let depth = 0; let count = 0; let inToken = false;
  for (const ch of list) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === " " && depth === 0) { inToken = false; continue; }
    if (!inToken) { count += 1; inToken = true; }
  }
  return count;
}

function gridCandidate(n: CapturedNode): LayoutCandidate | null {
  const s = n.styles;
  const cols = trackCount(s.gridTemplateColumns);
  const rows = trackCount(s.gridTemplateRows);
  let mode: AutoLayout["mode"];
  if (cols === 1) mode = "vertical";
  else if (rows === 1 && cols > 1) mode = "horizontal";
  else return null;                                     // 2-D — never guessed
  const gap = mode === "vertical" ? px(s.rowGap) : px(s.columnGap);
  return { source: "grid", layout: withOptional({ mode }, gap, paddingOf(n)) };
}

function flowCandidate(n: CapturedNode): LayoutCandidate | null {
  if (n.children.length < 2) return null;
  const kids = n.children;
  // Vertical stack: strictly descending, non-overlapping, consistent gaps.
  let vOk = true;
  const vGaps: number[] = [];
  for (let i = 1; i < kids.length; i += 1) {
    const gap = kids[i]!.bbox.y - (kids[i - 1]!.bbox.y + kids[i - 1]!.bbox.height);
    if (gap < 0) { vOk = false; break; }
    vGaps.push(gap);
  }
  if (vOk && (vGaps.length === 0 || Math.max(...vGaps) - Math.min(...vGaps) <= GAP_TOLERANCE)) {
    const gap = vGaps.length === 0 ? 0 : Math.round(vGaps.reduce((a, b) => a + b, 0) / vGaps.length);
    return { source: "flow", layout: withOptional({ mode: "vertical" }, gap, paddingOf(n)) };
  }
  // Horizontal row: strictly advancing x, non-overlapping, consistent gaps.
  let hOk = true;
  const hGaps: number[] = [];
  for (let i = 1; i < kids.length; i += 1) {
    const gap = kids[i]!.bbox.x - (kids[i - 1]!.bbox.x + kids[i - 1]!.bbox.width);
    if (gap < 0) { hOk = false; break; }
    hGaps.push(gap);
  }
  if (hOk && (hGaps.length === 0 || Math.max(...hGaps) - Math.min(...hGaps) <= GAP_TOLERANCE)) {
    const gap = hGaps.length === 0 ? 0 : Math.round(hGaps.reduce((a, b) => a + b, 0) / hGaps.length);
    return { source: "flow", layout: withOptional({ mode: "horizontal" }, gap, paddingOf(n)) };
  }
  return null;
}

/** First matching source wins: flex → grid → flow. Null = stay absolute. */
export function inferCandidate(n: CapturedNode): LayoutCandidate | null {
  const d = n.styles.display;
  if (d === "flex" || d === "inline-flex") return flexCandidate(n);
  if (d === "grid" || d === "inline-grid") return gridCandidate(n);
  return flowCandidate(n);
}

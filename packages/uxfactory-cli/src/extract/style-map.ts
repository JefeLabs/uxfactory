/**
 * Pure computed-style → DesignSpec property mapping (SP3b). Fail-soft: an
 * unparseable value yields "absent", never an exception.
 */
import type { Effect, CornerRadius } from "@uxfactory/spec";
import type { CapturedStyles } from "../render/dom-capture.js";
import { px } from "./dom-to-designspec.js";

const RGB_RE = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/;

export function parseColor(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = RGB_RE.exec(s);
  if (!m) return null;
  return { r: parseInt(m[1]!, 10), g: parseInt(m[2]!, 10), b: parseInt(m[3]!, 10), a: m[4] === undefined ? 1 : parseFloat(m[4]!) };
}

function channelHex(v: number): string {
  return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0").toUpperCase();
}

function hexOf(r: number, g: number, b: number): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`;
}

function hexToRgbLocal(hex: string): { r: number; g: number; b: number } {
  const body = hex.replace("#", "");
  const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/** Alpha-composite fg over an opaque background hex → opaque hex. */
export function compositeOver(fg: { r: number; g: number; b: number; a: number }, bgHex: string): string {
  const bg = hexToRgbLocal(bgHex);
  const a = fg.a;
  return hexOf(a * fg.r + (1 - a) * bg.r, a * fg.g + (1 - a) * bg.g, a * fg.b + (1 - a) * bg.b);
}

/** Background → fill hex composited over the resolved parent fill; null = paints nothing. */
export function resolveFill(s: CapturedStyles, parentFill: string): string | null {
  const c = parseColor(s.backgroundColor);
  if (c === null || c.a === 0) return null;
  if (c.a === 1) return hexOf(c.r, c.g, c.b);
  return compositeOver(c, parentFill);
}

/** Uniform borders only (all four widths equal and > 0). */
export function mapStroke(s: CapturedStyles): { stroke: string; strokeWidth: number } | null {
  const w = px(s.borderTopWidth);
  if (w <= 0) return null;
  if (px(s.borderRightWidth) !== w || px(s.borderBottomWidth) !== w || px(s.borderLeftWidth) !== w) return null;
  const c = parseColor(s.borderTopColor);
  if (c === null || c.a === 0) return null;
  return { stroke: hexOf(c.r, c.g, c.b), strokeWidth: w };
}

/** Four computed corner radii → CornerRadius (undefined when all zero). */
export function mapCornerRadius(s: CapturedStyles): CornerRadius | undefined {
  const tl = px(s.borderTopLeftRadius); const tr = px(s.borderTopRightRadius);
  const br = px(s.borderBottomRightRadius); const bl = px(s.borderBottomLeftRadius);
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) return undefined;
  if (tl === tr && tr === br && br === bl) return tl;
  return { tl, tr, br, bl };
}

/**
 * Computed box-shadow list → Effect[]. Computed form: "<color> <x> <y> <blur> <spread>[ inset], …".
 * Entries split on top-level commas (never inside parens); unparseable entries skipped.
 */
export function mapEffects(s: CapturedStyles): Effect[] {
  if (s.boxShadow === "none" || s.boxShadow === "") return [];
  const entries: string[] = [];
  let depth = 0; let cur = "";
  for (const ch of s.boxShadow) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { entries.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim() !== "") entries.push(cur.trim());

  const out: Effect[] = [];
  for (const entry of entries) {
    const inset = /\binset\b/.test(entry);
    const colorMatch = /rgba?\([^)]*\)/.exec(entry);
    if (!colorMatch) continue;
    const color = parseColor(colorMatch[0]);
    if (color === null) continue;
    const rest = entry.replace(colorMatch[0], "").replace(/\binset\b/, "").trim();
    const lengths = rest.split(/\s+/).map(px);
    if (lengths.length < 3) continue;
    const effect: Effect = {
      type: inset ? "inner-shadow" : "drop-shadow",
      color: hexOf(color.r, color.g, color.b),
      x: lengths[0]!, y: lengths[1]!, blur: lengths[2]!, spread: lengths[3] ?? 0,
    };
    if (color.a < 1) effect.opacity = color.a;
    out.push(effect);
  }
  return out;
}

/** Element opacity, only when it actually dims (< 1). */
export function mapOpacity(s: CapturedStyles): number | undefined {
  const o = px(s.opacity); // parseFloat semantics: "0.8" → 0.8
  return o < 1 ? o : undefined;
}

/** Text color → hex (null when unparseable). */
export function mapTextFill(s: CapturedStyles): string | null {
  const c = parseColor(s.color);
  return c === null ? null : hexOf(c.r, c.g, c.b);
}

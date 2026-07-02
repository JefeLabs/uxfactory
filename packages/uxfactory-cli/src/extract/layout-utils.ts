import type { CapturedNode } from "../render/dom-capture.js";

/** Round to 2 decimals (determinism convention, matches the svg renderer). */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse a computed px length ("12px" → 12); anything non-numeric → 0. */
export function px(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Content box: bbox inset by padding. */
export function contentBox(n: CapturedNode): { x: number; y: number; width: number; height: number } {
  const s = n.styles;
  return {
    x: n.bbox.x + px(s.paddingLeft),
    y: n.bbox.y + px(s.paddingTop),
    width: n.bbox.width - px(s.paddingLeft) - px(s.paddingRight),
    height: n.bbox.height - px(s.paddingTop) - px(s.paddingBottom),
  };
}

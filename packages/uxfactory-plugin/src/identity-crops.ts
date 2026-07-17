/**
 * identity-crops.ts — pure scale computation for root-tier identity crops
 * (Task 9, node-identity Phase 3: vision). Source: task-9-brief.md.
 *
 * `node.exportAsync`'s SCALE constraint takes a single multiplier applied to
 * both width and height. `cropScaleFor` computes the multiplier that brings
 * a node's LONGEST edge down to `maxEdge` px — clamped to never exceed 1, so
 * a node smaller than `maxEdge` is exported at its native size (exportAsync
 * must never upscale). Pure — no Figma globals — so it is unit-testable
 * against plain numbers; code.ts calls it with the real node's width/height.
 */

const DEFAULT_MAX_EDGE = 1024;

/** A finite, non-negative dimension, else 0 (undefined/NaN/negative all fold to "nothing to scale"). */
function safeDim(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Scale multiplier for `exportAsync({constraint: {type: "SCALE", value}})`
 * so the node's longest edge is at most `maxEdge` px.
 *
 * - Already-small node (longest edge ≤ maxEdge) → 1 (never upscaled).
 * - Wide/tall node → `maxEdge / longestEdge`, whichever axis is longer.
 * - Missing/zero/negative/non-finite width or height → 1 (safe fallback;
 *   nothing to scale down, and a 0-valued SCALE constraint is invalid).
 */
export function cropScaleFor(
  width: number | undefined,
  height: number | undefined,
  maxEdge: number = DEFAULT_MAX_EDGE,
): number {
  const longest = Math.max(safeDim(width), safeDim(height));
  if (longest <= 0) return 1;
  return Math.min(1, maxEdge / longest);
}

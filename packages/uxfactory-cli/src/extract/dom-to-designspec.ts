/**
 * Pure DOM→DesignSpec assembler (SP3b). No I/O, no clock, no randomness:
 * extractDesignSpec(views) deep-equals itself across calls. Layout inference
 * and style mapping are layered in by sibling modules (layout-infer, style-map).
 */
import type { DesignSpec, Frame, FrameChild, TextNode, ShapeNode } from "@uxfactory/spec";
import type { CapturedNode } from "../render/dom-capture.js";
import { REPLACED_TAGS } from "../render/dom-capture.js";

export interface ExtractedView {
  page: string;
  view: string;
  viewport: { width: number; height: number };
  tree: CapturedNode;
}

export interface ExtractStats {
  views: number;
  nodes: number;
  containers: { flex: number; grid: number; flow: number; absolute: number };
  selfCheckFallbacks: number;
}

export interface ExtractResult {
  spec: DesignSpec;
  stats: ExtractStats;
}

const CANVAS_GUTTER = 100;
const PLACEHOLDER_FILL = "#E5E7EB";
const PRUNE_TOLERANCE = 2;

/** Round to 2 decimals (determinism convention, matches the svg renderer). */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse a computed px length ("12px" → 12); anything non-numeric → 0. */
export function px(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const REPLACED = new Set<string>(REPLACED_TAGS);

/** True when the container paints nothing of its own (prunable wrapper candidate). */
function hasNoVisualSignal(n: CapturedNode): boolean {
  const s = n.styles;
  const bgTransparent = s.backgroundColor === "rgba(0, 0, 0, 0)" || s.backgroundColor === "transparent";
  const noBorder =
    px(s.borderTopWidth) === 0 && px(s.borderRightWidth) === 0 &&
    px(s.borderBottomWidth) === 0 && px(s.borderLeftWidth) === 0;
  const noRadius =
    px(s.borderTopLeftRadius) === 0 && px(s.borderTopRightRadius) === 0 &&
    px(s.borderBottomRightRadius) === 0 && px(s.borderBottomLeftRadius) === 0;
  return bgTransparent && noBorder && s.boxShadow === "none" && noRadius && px(s.opacity) === 1;
}

/** Content box: bbox inset by padding. */
function contentBox(n: CapturedNode): { x: number; y: number; width: number; height: number } {
  const s = n.styles;
  return {
    x: n.bbox.x + px(s.paddingLeft),
    y: n.bbox.y + px(s.paddingTop),
    width: n.bbox.width - px(s.paddingLeft) - px(s.paddingRight),
    height: n.bbox.height - px(s.paddingTop) - px(s.paddingBottom),
  };
}

/**
 * Bottom-up wrapper pruning: a container with exactly one element child, no
 * visual signal, whose child bbox lies within PRUNE_TOLERANCE of the container's
 * content box on every edge, is dropped and its child promoted. Repeated, so
 * wrapper chains collapse fully.
 */
function prune(n: CapturedNode): CapturedNode {
  const pruned: CapturedNode = { ...n, children: n.children.map(prune) };
  if (pruned.children.length === 1 && pruned.tag !== "body" && hasNoVisualSignal(pruned)) {
    const child = pruned.children[0]!;
    if (child.tag !== "#text" && child.children !== undefined) {
      const cb = contentBox(pruned);
      const b = child.bbox;
      const fits =
        Math.abs(b.x - cb.x) <= PRUNE_TOLERANCE &&
        Math.abs(b.y - cb.y) <= PRUNE_TOLERANCE &&
        Math.abs(b.x + b.width - (cb.x + cb.width)) <= PRUNE_TOLERANCE &&
        Math.abs(b.y + b.height - (cb.y + cb.height)) <= PRUNE_TOLERANCE;
      if (fits) return child;
    }
  }
  return pruned;
}

/** Shared mutable pass state (stats accumulation). */
interface PassCtx {
  stats: ExtractStats;
}

/** Map one captured child into a FrameChild, positioned relative to (ox, oy). */
function toChild(n: CapturedNode, ox: number, oy: number, ctx: PassCtx): FrameChild {
  ctx.stats.nodes += 1;
  const x = r2(n.bbox.x - ox);
  const y = r2(n.bbox.y - oy);
  const width = r2(n.bbox.width);
  const height = r2(n.bbox.height);

  if (n.tag === "#text" || (n.children.length === 0 && n.text !== null && !REPLACED.has(n.tag))) {
    const text: TextNode = { type: "text", name: n.sel, characters: n.text ?? "", x, y, width, height };
    return text;
  }
  if (n.children.length === 0) {
    const shape: ShapeNode = { type: "shape", name: n.sel, x, y, width, height };
    if (REPLACED.has(n.tag)) shape.fill = PLACEHOLDER_FILL;
    return shape;
  }
  return toFrame(n, ox, oy, ctx);
}

/** Map a captured container into a nested Frame (children parent-relative). */
function toFrame(n: CapturedNode, ox: number, oy: number, ctx: PassCtx): Frame {
  ctx.stats.containers.absolute += 1;
  const frame: Frame = {
    name: n.sel,
    x: r2(n.bbox.x - ox),
    y: r2(n.bbox.y - oy),
    width: r2(n.bbox.width),
    height: r2(n.bbox.height),
    children: n.children.map((c) => toChild(c, n.bbox.x, n.bbox.y, ctx)),
  };
  return frame;
}

/** Assemble one DesignSpec from the captured views: one top-level frame per view. */
export function extractDesignSpec(views: ExtractedView[]): ExtractResult {
  const stats: ExtractStats = {
    views: views.length, nodes: 0,
    containers: { flex: 0, grid: 0, flow: 0, absolute: 0 },
    selfCheckFallbacks: 0,
  };
  const ctx: PassCtx = { stats };
  const frames: Frame[] = [];
  let cursorX = 0;
  for (const v of views) {
    const tree = prune(v.tree);
    stats.nodes += 1; // the view root itself
    const width = Math.max(tree.bbox.width, v.viewport.width);
    const root: Frame = {
      name: `${v.page}/${v.view}`,
      x: r2(cursorX),
      y: 0,
      width: r2(width),
      height: r2(Math.max(tree.bbox.height, v.viewport.height)),
      children: tree.children.map((c) => toChild(c, tree.bbox.x, tree.bbox.y, ctx)),
    };
    // Top-level frames NEVER emit sizing (SP3a carry-forward) and sit absolutely on the canvas.
    frames.push(root);
    cursorX += width + CANVAS_GUTTER;
  }
  return { spec: { frames }, stats };
}

/**
 * Pure DOM→DesignSpec assembler (SP3b). No I/O, no clock, no randomness:
 * extractDesignSpec(views) deep-equals itself across calls. Layout inference
 * and style mapping are layered in by sibling modules (layout-infer, style-map).
 */
import type { DesignSpec, Frame, FrameChild, TextNode, ShapeNode } from "@uxfactory/spec";
import type { CapturedNode } from "../render/dom-capture.js";
import { REPLACED_TAGS } from "../render/dom-capture.js";
import { resolveFill, mapStroke, mapCornerRadius, mapEffects, mapOpacity, mapTextFill } from "./style-map.js";
import { inferCandidate, verifyCandidate } from "./layout-infer.js";
import { px, r2, contentBox } from "./layout-utils.js";
export { px, r2, contentBox } from "./layout-utils.js";

export interface ExtractedView {
  page: string;
  view: string;
  viewport: { width: number; height: number };
  tree: CapturedNode;
}

/**
 * Extraction statistics. NOTE: `selfCheckFallbacks` is a SUBSET of
 * `containers.absolute` (candidates found but rejected by the geometric
 * self-check) — do not sum them.
 */
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

/**
 * Infer→verify→attach auto-layout onto a frame, then apply fill sizing to its
 * nested Frame children when the candidate is verified. Returns true when a
 * layout was attached, false otherwise (for stats accounting).
 *
 * Call AFTER frame.children is populated so fill-sizing can inspect them.
 */
function attachLayout(frame: Frame, n: CapturedNode, ctx: PassCtx): boolean {
  const candidate = n.children.length > 0 ? inferCandidate(n) : null;
  let attached = false;
  if (candidate !== null) {
    if (verifyCandidate(candidate, n)) {
      frame.layout = candidate.layout;
      ctx.stats.containers[candidate.source] += 1;
      attached = true;
    } else {
      ctx.stats.selfCheckFallbacks += 1;
    }
  }
  if (!attached) {
    ctx.stats.containers.absolute += 1;
    return false;
  }
  // Fill sizing: only on nested Frame children (no `type` discriminant) of this
  // verified container; leaves (ShapeNode/TextNode/InstanceNode) are skipped.
  const content = contentBox(n);
  for (const [i, childNode] of n.children.entries()) {
    const child = frame.children![i]!;
    if (!("type" in child)) { // nested Frame — leaves carry `type`
      const b = childNode.bbox;
      if (frame.layout!.mode === "vertical" && Math.abs(b.width - content.width) <= 1) {
        (child as Frame).sizing = { horizontal: "fill" };
      } else if (frame.layout!.mode === "horizontal" && Math.abs(b.height - content.height) <= 1) {
        (child as Frame).sizing = { vertical: "fill" };
      }
    }
  }
  return true;
}

/** Map one captured child into a FrameChild, positioned relative to (ox, oy). */
function toChild(n: CapturedNode, ox: number, oy: number, ctx: PassCtx, parentFill: string): FrameChild {
  ctx.stats.nodes += 1;
  const x = r2(n.bbox.x - ox);
  const y = r2(n.bbox.y - oy);
  const width = r2(n.bbox.width);
  const height = r2(n.bbox.height);

  if (n.tag === "#text" || (n.children.length === 0 && n.text !== null && !REPLACED.has(n.tag))) {
    const text: TextNode = { type: "text", name: n.sel, characters: n.text ?? "", x, y, width, height };
    const fillHex = mapTextFill(n.styles);
    if (fillHex !== null) text.fill = fillHex;
    return text;
  }
  if (n.children.length === 0) {
    const shape: ShapeNode = { type: "shape", name: n.sel, x, y, width, height };
    if (REPLACED.has(n.tag)) shape.fill = PLACEHOLDER_FILL;
    const fill = resolveFill(n.styles, parentFill);
    if (fill !== null) shape.fill = fill;
    const st = mapStroke(n.styles);
    if (st) { shape.stroke = st.stroke; shape.strokeWidth = st.strokeWidth; }
    const cr = mapCornerRadius(n.styles);
    if (cr !== undefined) shape.cornerRadius = cr;
    const fx = mapEffects(n.styles);
    if (fx.length > 0) shape.effects = fx;
    const op = mapOpacity(n.styles);
    if (op !== undefined) shape.opacity = op;
    return shape;
  }
  return toFrame(n, ox, oy, ctx, parentFill);
}

/** Map a captured container into a nested Frame (children parent-relative). */
function toFrame(n: CapturedNode, ox: number, oy: number, ctx: PassCtx, parentFill: string): Frame {
  const fill = resolveFill(n.styles, parentFill);
  const resolved = fill ?? parentFill;
  const frame: Frame = {
    name: n.sel,
    x: r2(n.bbox.x - ox),
    y: r2(n.bbox.y - oy),
    width: r2(n.bbox.width),
    height: r2(n.bbox.height),
    children: n.children.map((c) => toChild(c, n.bbox.x, n.bbox.y, ctx, resolved)),
  };
  if (fill !== null) frame.fill = fill;
  const cr = mapCornerRadius(n.styles);
  if (cr !== undefined) frame.cornerRadius = cr;
  const fx = mapEffects(n.styles);
  if (fx.length > 0) frame.effects = fx;
  attachLayout(frame, n, ctx);
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
  const ROOT_FILL = "#FFFFFF";
  let cursorX = 0;
  for (const v of views) {
    const tree = prune(v.tree);
    stats.nodes += 1; // the view root itself
    const width = Math.max(tree.bbox.width, v.viewport.width);
    const rootFill = resolveFill(tree.styles, ROOT_FILL);
    const resolved = rootFill ?? ROOT_FILL;
    const root: Frame = {
      name: `${v.page}/${v.view}`,
      x: r2(cursorX),
      y: 0,
      width: r2(width),
      height: r2(Math.max(tree.bbox.height, v.viewport.height)),
      children: tree.children.map((c) => toChild(c, tree.bbox.x, tree.bbox.y, ctx, resolved)),
    };
    if (rootFill !== null) root.fill = rootFill;
    const cr = mapCornerRadius(tree.styles);
    if (cr !== undefined) root.cornerRadius = cr;
    const fx = mapEffects(tree.styles);
    if (fx.length > 0) root.effects = fx;
    // Top-level frames get the same candidate→verify→attach treatment as nested
    // frames (body is often a flex/flow column); their children may receive fill
    // sizing, but the root frame itself NEVER gets a sizing property.
    attachLayout(root, tree, ctx);
    frames.push(root);
    cursorX += width + CANVAS_GUTTER;
  }
  return { spec: { frames }, stats };
}

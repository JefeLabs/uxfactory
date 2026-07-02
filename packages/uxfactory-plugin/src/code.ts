import { validate } from "@uxfactory/spec";
import type { Spec, Edit, EditSet } from "@uxfactory/spec";
import type { ReportNode, ReportCounts, ReportEditDiff } from "@uxfactory/gate";
import type { MainToUi, UiToMain } from "./messages.js";
import { planRender, type PlannedChild } from "./planner.js";
import { planEdit, captureInverse } from "./edits.js";
import { UndoStack } from "./undo-stack.js";
import { assembleReport, newRenderId } from "./report.js";
import { mapSelection, type RawSelNode } from "./selection.js";
import { planAnnotations } from "./annotation-plan.js";
import type { ReviewReportLike } from "./annotation-plan.js";
import { snapshotNode } from "./canvas-snapshot.js";
import type { CanvasSnapshot, SnapshotFrame, FrameLike } from "./canvas-snapshot.js";

/** The narrow node surface the orchestrator uses (cast from the real figma node). */
interface EditableNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fills: unknown;
  strokes: unknown;
  strokeWeight: number | undefined;
  cornerRadius: number | undefined;
  opacity: number | undefined;
  rotation: number | undefined;
  visible: boolean | undefined;
  characters: string | undefined;
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  effects?: unknown;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
  /** Optional font descriptor; present on TEXT nodes. */
  fontName?: { family: string; style: string };
  /** Text sublayer; present on STICKY and CONNECTOR nodes. */
  text?: { characters?: string };
  /** Present on COMPONENT nodes; clones into an INSTANCE. */
  createInstance?(): EditableNode;
  connectorStart: unknown;
  connectorEnd: unknown;
  children?: readonly EditableNode[];
  resize(w: number, h: number): void;
  appendChild(child: EditableNode): void;
  remove(): void;
  exportAsync?(settings: { format: string }): Promise<Uint8Array>;
}

/** A Figma page node. */
interface PageNode {
  id: string;
  name: string;
  selection: readonly EditableNode[];
  children: readonly EditableNode[];
  appendChild(node: EditableNode): void;
}

/** The narrow figma surface the orchestrator uses. */
interface FigmaApi {
  currentPage: PageNode;
  root: { name: string; children: readonly PageNode[] };
  fileKey?: string;
  showUI(html: string, options: { width: number; height: number }): void;
  getNodeById(id: string): EditableNode | null;
  on(type: "selectionchange", cb: () => void): void;
  createFrame(): EditableNode;
  createComponent(): EditableNode;
  createRectangle(): EditableNode;
  createText(): EditableNode;
  createSection(): EditableNode;
  createSticky(): EditableNode;
  createConnector(): EditableNode;
  createPage(): PageNode;
  loadFontAsync(name: { family: string; style: string }): Promise<void>;
  importComponentByKeyAsync(key: string): Promise<{ createInstance(): EditableNode }>;
  ui: {
    postMessage(msg: MainToUi): void;
    onmessage: ((msg: UiToMain) => void) | null;
    resize(width: number, height: number): void;
  };
}

const fig = figma as unknown as FigmaApi;
const undo = new UndoStack();
let renderCounter = 0;

fig.showUI(__html__, { width: 540, height: 220 });
fig.ui.onmessage = (msg) => handleMessage(msg);
fig.on("selectionchange", () => postSelection());

function post(msg: MainToUi): void {
  fig.ui.postMessage(msg);
}

// Fix 1: wrap the entire handler so no unhandled rejections escape.
async function handleMessage(msg: UiToMain): Promise<void> {
  try {
    if (msg.type === "render") await renderSpec(msg.spec, msg.jobId);
    else if (msg.type === "review") await drawReview(msg.report);
    else if (msg.type === "review-selection") await reviewSelection();
    else if (msg.type === "undo") applyUndo();
    else if (msg.type === "resize") fig.ui.resize(msg.width, msg.height);
  } catch (err) {
    post({ type: "render-error", message: String(err) });
  }
}

// ---- color helpers (figma uses 0..1 RGB; the report uses 6-digit hex) ----

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const body = hex.replace("#", "");
  const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body;
  const num = parseInt(full, 16);
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 };
}

function channel(v: number): string {
  return Math.round(v * 255)
    .toString(16)
    .padStart(2, "0");
}

function solidPaint(hex: string): unknown {
  const { r, g, b } = hexToRgb(hex);
  return [{ type: "SOLID", color: { r, g, b } }];
}

function paintToHex(fills: unknown): string | undefined {
  if (!Array.isArray(fills) || fills.length === 0) return undefined;
  const first = fills[0] as { type?: string; color?: { r: number; g: number; b: number } };
  if (first.type !== "SOLID" || !first.color) return undefined;
  return `#${channel(first.color.r)}${channel(first.color.g)}${channel(first.color.b)}`;
}

// ---- node read/write ----

function toReportNode(node: EditableNode): ReportNode {
  const out: ReportNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    w: node.width,
    h: node.height,
  };
  if (node.rotation !== undefined) out.rotation = node.rotation;
  if (node.opacity !== undefined) out.opacity = node.opacity;
  if (node.visible !== undefined) out.visible = node.visible;
  if (node.cornerRadius !== undefined) out.cornerRadius = node.cornerRadius;
  const fill = paintToHex(node.fills);
  if (fill !== undefined) out.fill = fill;
  const stroke = paintToHex(node.strokes);
  if (stroke !== undefined) out.stroke = stroke;
  if (node.strokeWeight !== undefined) out.strokeWidth = node.strokeWeight;
  // Fix 2: prefer text sublayer (STICKY / CONNECTOR) over direct characters.
  const chars = node.text !== undefined ? node.text.characters : node.characters;
  if (chars) out.characters = chars;
  return out;
}

function applyProps(node: EditableNode, props: Partial<EditSet>): void {
  if (props.name !== undefined) node.name = props.name;
  if (props.x !== undefined) node.x = props.x;
  if (props.y !== undefined) node.y = props.y;
  if (props.width !== undefined || props.height !== undefined) {
    node.resize(props.width ?? node.width, props.height ?? node.height);
  }
  if (props.rotation !== undefined) node.rotation = props.rotation;
  if (props.opacity !== undefined) node.opacity = props.opacity;
  if (props.visible !== undefined) node.visible = props.visible;
  if (props.cornerRadius !== undefined) node.cornerRadius = props.cornerRadius;
  if (props.fill !== undefined) node.fills = solidPaint(props.fill);
  if (props.stroke !== undefined) node.strokes = solidPaint(props.stroke);
  if (props.strokeWidth !== undefined) node.strokeWeight = props.strokeWidth;
  if (props.characters !== undefined) node.characters = props.characters;
}

function readBefore(node: EditableNode, keys: string[]): Record<string, unknown> {
  const before: Record<string, unknown> = {};
  for (const key of keys) {
    switch (key) {
      case "name":
        before.name = node.name;
        break;
      case "x":
        before.x = node.x;
        break;
      case "y":
        before.y = node.y;
        break;
      case "width":
        before.width = node.width;
        break;
      case "height":
        before.height = node.height;
        break;
      case "rotation":
        before.rotation = node.rotation;
        break;
      case "opacity":
        before.opacity = node.opacity;
        break;
      case "visible":
        before.visible = node.visible;
        break;
      case "cornerRadius":
        before.cornerRadius = node.cornerRadius;
        break;
      case "fill":
        before.fill = paintToHex(node.fills);
        break;
      case "stroke":
        before.stroke = paintToHex(node.strokes);
        break;
      case "strokeWidth":
        before.strokeWidth = node.strokeWeight;
        break;
      case "characters":
        before.characters = node.characters;
        break;
    }
  }
  return before;
}

function describeDiff(before: Record<string, unknown>, props: Partial<EditSet>): string {
  const p = props as Record<string, unknown>;
  return Object.keys(props)
    .map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(p[k])}`)
    .join(", ");
}

// ---- node lookup ----

function findByName(
  node: { children?: readonly EditableNode[] },
  name: string,
): EditableNode | null {
  for (const child of node.children ?? []) {
    if (child.name === name) return child;
    const nested = findByName(child, name);
    if (nested) return nested;
  }
  return null;
}

function findTarget(edit: Edit, byName: Map<string, EditableNode>): EditableNode | null {
  if (edit.id) {
    const byId = fig.getNodeById(edit.id);
    if (byId) return byId;
  }
  if (edit.name) return byName.get(edit.name) ?? findByName(fig.currentPage, edit.name);
  return null;
}

// ---- rendering ----

type PlannedFrameLike = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  effects?: PlannedChild["effects"];
  cornerRadius?: PlannedChild["cornerRadius"];
  layout?: PlannedChild["layout"];
  sizing?: PlannedChild["sizing"];
  children: PlannedChild[];
};

interface RenderCtx {
  byName: Map<string, EditableNode>;
  reportNodes: Map<string, ReportNode>;
  editDiffs: ReportEditDiff[];
  components: Map<string, EditableNode>;
}

const PRIMARY_ALIGN: Record<string, string> = {
  start: "MIN", center: "CENTER", end: "MAX", "space-between": "SPACE_BETWEEN",
};
const COUNTER_ALIGN: Record<string, string> = { start: "MIN", center: "CENTER", end: "MAX" };
const SIZING: Record<string, string> = { fixed: "FIXED", hug: "HUG", fill: "FILL" };

function applyAutoLayout(node: EditableNode, layout: PlannedChild["layout"], sizing: PlannedChild["sizing"]): void {
  if (!layout) return;
  node.layoutMode = layout.mode === "vertical" ? "VERTICAL" : "HORIZONTAL";
  node.primaryAxisSizingMode = "FIXED";
  node.counterAxisSizingMode = "FIXED";
  if (layout.gap !== undefined) node.itemSpacing = layout.gap;
  if (layout.padding !== undefined) {
    const p = layout.padding;
    const box = typeof p === "number" ? { top: p, right: p, bottom: p, left: p } : p;
    node.paddingTop = box.top;
    node.paddingRight = box.right;
    node.paddingBottom = box.bottom;
    node.paddingLeft = box.left;
  }
  if (layout.primaryAlign !== undefined) node.primaryAxisAlignItems = PRIMARY_ALIGN[layout.primaryAlign];
  if (layout.counterAlign !== undefined) node.counterAxisAlignItems = COUNTER_ALIGN[layout.counterAlign];
  // sizing AFTER children are appended (see renderContainer)
  if (sizing?.horizontal !== undefined) node.layoutSizingHorizontal = SIZING[sizing.horizontal];
  if (sizing?.vertical !== undefined) node.layoutSizingVertical = SIZING[sizing.vertical];
}

function toFigmaEffect(e: NonNullable<PlannedChild["effects"]>[number]): Record<string, unknown> {
  const { r, g, b } = hexToRgb(e.color);
  return {
    type: e.type === "inner-shadow" ? "INNER_SHADOW" : "DROP_SHADOW",
    color: { r, g, b, a: e.opacity ?? 1 },
    offset: { x: e.x, y: e.y },
    radius: e.blur,
    spread: e.spread ?? 0,
    visible: true,
    blendMode: "NORMAL",
  };
}

function applyEffects(node: EditableNode, effects: PlannedChild["effects"]): void {
  if (effects && effects.length > 0) node.effects = effects.map(toFigmaEffect);
}

function applyCornerRadius(node: EditableNode, cr: PlannedChild["cornerRadius"]): void {
  if (cr === undefined) return;
  if (typeof cr === "number") {
    node.cornerRadius = cr;
  } else {
    node.topLeftRadius = cr.tl;
    node.topRightRadius = cr.tr;
    node.bottomRightRadius = cr.br;
    node.bottomLeftRadius = cr.bl;
  }
}

function applyInstanceOverrides(inst: EditableNode, overrides: NonNullable<PlannedChild["overrides"]>): void {
  for (const [descName, ov] of Object.entries(overrides)) {
    const target = findByName(inst, descName);
    if (!target) continue;
    if (ov.characters !== undefined && target.characters !== undefined) target.characters = ov.characters;
    if (ov.fill !== undefined) target.fills = solidPaint(ov.fill);
    if (ov.visible !== undefined) target.visible = ov.visible;
  }
}

async function renderContainer(
  frame: PlannedFrameLike,
  parent: EditableNode,
  ctx: RenderCtx,
): Promise<EditableNode> {
  const node = fig.createFrame();
  node.name = frame.name;
  node.x = frame.x;
  node.y = frame.y;
  node.resize(frame.width, frame.height);
  if (frame.fill !== undefined) node.fills = solidPaint(frame.fill);
  applyEffects(node, frame.effects);
  applyCornerRadius(node, frame.cornerRadius);
  parent.appendChild(node);
  ctx.byName.set(frame.name, node);
  for (const child of frame.children) {
    const childNode = await renderChild(child, node, ctx);
    if (childNode) {
      ctx.byName.set(child.name, childNode);
      ctx.reportNodes.set(childNode.id, toReportNode(childNode));
    }
  }
  applyAutoLayout(node, frame.layout, frame.sizing);
  return node;
}

/**
 * Creates a single child node inside `parent`.
 * Returns `null` when an instance import fails (Fix 5 — graceful skip).
 */
async function renderChild(
  child: PlannedChild,
  parent: EditableNode,
  ctx: RenderCtx,
): Promise<EditableNode | null> {
  if (child.kind === "frame") {
    return renderContainer(child as PlannedFrameLike, parent, ctx);
  }

  if (child.kind === "component-instance") {
    const master = child.component ? ctx.components.get(child.component) : undefined;
    if (!master || typeof master.createInstance !== "function") {
      ctx.editDiffs.push({ name: child.name, diff: `skipped: component "${child.component ?? "?"}" not found` });
      return null;
    }
    let inst: EditableNode;
    try {
      inst = master.createInstance();
    } catch (err) {
      ctx.editDiffs.push({ name: child.name, diff: `skipped: instance "${child.name}" failed: ${String(err)}` });
      return null;
    }
    inst.name = child.name;
    inst.x = child.x;
    inst.y = child.y;
    if (child.width !== undefined || child.height !== undefined) {
      inst.resize(child.width ?? inst.width, child.height ?? inst.height);
    }
    if (child.rotation !== undefined) inst.rotation = child.rotation;
    if (child.opacity !== undefined) inst.opacity = child.opacity;
    if (child.overrides) applyInstanceOverrides(inst, child.overrides);
    parent.appendChild(inst);
    return inst;
  }

  let node: EditableNode;

  if (child.kind === "instance") {
    // Fix 5: catch import errors so one bad asset key doesn't abort the batch.
    try {
      const component = await fig.importComponentByKeyAsync(child.asset ?? "");
      node = component.createInstance();
    } catch (err) {
      ctx.editDiffs.push({ name: child.name, diff: `skipped: instance "${child.name}" import failed: ${String(err)}` });
      return null;
    }
  } else if (child.kind === "text") {
    node = fig.createText();
  } else if (child.kind === "sticky") {
    node = fig.createSticky();
  } else {
    node = fig.createRectangle();
  }

  node.name = child.name;
  node.x = child.x;
  node.y = child.y;
  if (child.width !== undefined || child.height !== undefined) {
    node.resize(child.width ?? node.width, child.height ?? node.height);
  }
  if (child.fill !== undefined) node.fills = solidPaint(child.fill);
  if (child.stroke !== undefined) node.strokes = solidPaint(child.stroke);
  if (child.strokeWidth !== undefined) node.strokeWeight = child.strokeWidth;
  applyCornerRadius(node, child.cornerRadius);
  applyEffects(node, child.effects);
  if (child.rotation !== undefined) node.rotation = child.rotation;
  if (child.opacity !== undefined) node.opacity = child.opacity;

  // Fix 2: route text to the correct property depending on node kind.
  if (child.characters !== undefined) {
    if (child.kind === "sticky") {
      // StickyNode.text is a TextSublayer — never use .characters directly.
      if (node.text !== undefined) node.text.characters = child.characters;
    } else if (child.kind === "text") {
      // TextNode requires loadFontAsync before characters can be set.
      await fig.loadFontAsync(node.fontName ?? { family: "Inter", style: "Regular" });
      node.characters = child.characters;
    } else {
      // Shape / other: keep existing behaviour.
      node.characters = child.characters;
    }
  }

  parent.appendChild(node);
  return node;
}

async function renderSpec(raw: unknown, jobId?: string): Promise<void> {
  const result = validate(raw);
  if (!result.valid) {
    post({
      type: "render-error",
      message: result.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
    });
    return;
  }

  // Fix 1: any throw from node creation / font loading / etc. posts render-error.
  try {
    const plan = planRender(raw as Spec);

    // Fix 3: find-or-create the target page instead of renaming currentPage.
    const existingPage = fig.root.children.find((p) => p.name === plan.page);
    if (existingPage !== undefined) {
      fig.currentPage = existingPage;
    } else {
      const newPage = fig.createPage();
      newPage.name = plan.page;
      fig.currentPage = newPage;
    }
    const page = fig.currentPage;

    const reportNodes = new Map<string, ReportNode>();
    const byName = new Map<string, EditableNode>();
    const editDiffs: ReportEditDiff[] = [];
    const ctx: RenderCtx = { byName, reportNodes, editDiffs, components: new Map() };

    if (plan.components) {
      for (const [id, def] of Object.entries(plan.components)) {
        const master = fig.createComponent();
        master.name = def.name;
        master.resize(def.width, def.height);
        if (def.fill !== undefined) master.fills = solidPaint(def.fill);
        applyEffects(master, def.effects);
        applyCornerRadius(master, def.cornerRadius);
        for (const child of def.children) {
          await renderChild(child, master, ctx);
        }
        applyAutoLayout(master, def.layout, def.sizing);
        page.appendChild(master);
        ctx.components.set(id, master);
      }
    }

    for (const frame of plan.frames) {
      await renderContainer(frame, page as unknown as EditableNode, ctx);
    }

    for (const section of plan.sections) {
      const node = fig.createSection();
      node.name = section.name;
      node.x = section.x;
      node.y = section.y;
      node.resize(section.width, section.height);
      page.appendChild(node);
      byName.set(section.name, node);
      for (const child of section.children) {
        const childNode = await renderChild(child, node, ctx);
        if (childNode) {
          byName.set(child.name, childNode);
          reportNodes.set(childNode.id, toReportNode(childNode));
        }
      }
    }

    for (const connector of plan.connectors) {
      const c = fig.createConnector();
      const from = byName.get(connector.from) ?? findByName(page, connector.from);
      const to = byName.get(connector.to) ?? findByName(page, connector.to);
      if (from) c.connectorStart = { endpointNodeId: from.id, magnet: "AUTO" };
      if (to) c.connectorEnd = { endpointNodeId: to.id, magnet: "AUTO" };
      // Fix 2: ConnectorNode label lives in .text.characters (a TextSublayer).
      if (connector.label !== undefined) {
        if (c.text !== undefined) c.text.characters = connector.label;
        else c.characters = connector.label; // fallback for non-standard mocks
      }
      page.appendChild(c);
    }

    for (const edit of plan.edits) {
      try {
        const target = findTarget(edit, byName);
        if (!target) {
          editDiffs.push({
            ...(edit.id ? { id: edit.id } : {}),
            ...(edit.name ? { name: edit.name } : {}),
            diff: "skipped (target not found)",
          });
          continue;
        }
        const resolved: Edit = { id: target.id, set: edit.set };
        const before = readBefore(target, Object.keys(edit.set));
        const planned = planEdit(resolved, true);
        // Fix 2: load font before setting characters on a TEXT node (edit path).
        if (planned.props.characters !== undefined && target.type === "TEXT") {
          await fig.loadFontAsync(target.fontName ?? { family: "Inter", style: "Regular" });
        }
        applyProps(target, planned.props);
        undo.push(captureInverse(resolved, before));
        reportNodes.set(target.id, toReportNode(target));
        editDiffs.push({
          id: target.id,
          name: target.name,
          diff: describeDiff(before, planned.props),
        });
      } catch (err) {
        // One bad edit doesn't kill the batch.
        editDiffs.push({
          ...(edit.id ? { id: edit.id } : {}),
          ...(edit.name ? { name: edit.name } : {}),
          diff: `error: ${(err as Error).message}`,
        });
      }
    }

    const counts: ReportCounts = {
      frames: plan.frames.length,
      sections: plan.sections.length,
      objects:
        plan.frames.reduce((n, f) => n + f.children.length, 0) +
        plan.sections.reduce((n, s) => n + s.children.length, 0),
      connectors: plan.connectors.length,
    };

    const report = assembleReport({
      editor: plan.editor,
      page: page.name,
      pageKey: page.id,
      fileName: fig.root.name,
      fileKey: fig.fileKey ?? "",
      renderId: newRenderId((renderCounter += 1)),
      jobId,
      nodes: [...reportNodes.values()],
      counts,
      edits: editDiffs.length > 0 ? editDiffs : undefined,
    });

    post({ type: "rendered", report });
    post({ type: "undo-count", count: undo.size });
  } catch (err) {
    // Fix 1: surface any unexpected throw as a render-error instead of silently hanging.
    post({ type: "render-error", message: String(err) });
  }
}

// ---- review annotation drawing (§7.8) ----

const REVIEW_GROUP_NAME = "UXFactory Review";
const RED_FILL = "#E53935"; // conformance violation
const AMBER_FILL = "#FB8C00"; // advisory suggestion
const BADGE_SIZE = 20;

/**
 * Draws conformance-review annotations on the current page from a ReviewReport.
 * §7.8: one removable "UXFactory Review" group; numbered badges (red=conformance,
 * amber=advisory) at found nodes; "Review notes" panel with element flags, coverage
 * gaps, legend, and verdict.
 *
 * Fix C1: unmatched ElementFlags (node not on canvas) are added to the notes panel
 *   instead of being silently dropped.
 * Fix I2: each badge has a visible number text node; notes panel lists all ElementFlags.
 * Fix I3: clipsContent=false on the group; group is appended early so the catch path
 *   can remove any partial orphan before posting review-error.
 * Fix M4: ALL prior "UXFactory Review" groups are cleared (no break).
 */
async function drawReview(report: ReviewReportLike): Promise<void> {
  let group: EditableNode | null = null;
  try {
    const plan = planAnnotations(report);
    const page = fig.currentPage;

    // Fix M4: Remove ALL top-level groups named "UXFactory Review" (no break so
    // duplicates from a prior partial run are also cleared).
    for (const child of [...page.children]) {
      if (child.name === REVIEW_GROUP_NAME) {
        child.remove();
        // no break — remove all duplicates
      }
    }

    // Create the single removable group.
    group = fig.createFrame();
    group.name = REVIEW_GROUP_NAME;
    group.x = 0;
    group.y = 0;
    group.resize(1, 1);
    // Fix I3a: do NOT clip annotations — badges + notes extend beyond the 1×1 frame.
    (group as unknown as { clipsContent: boolean }).clipsContent = false;

    // Fix I3b: append group BEFORE any drawing so the catch path can remove a
    // partial group if a draw step throws (e.g. font unavailable).
    page.appendChild(group);

    // Load font ONCE before any text-character assignment (required by real Figma
    // and enforced by the mock's TEXT node setter).
    await fig.loadFontAsync({ family: "Inter", style: "Regular" });

    // Track unmatched flags for Fix C1 notes-panel fallback.
    const unmatchedFlags = new Set<(typeof plan.elementFlags)[number]>();
    let skipped = 0;

    // Draw a numbered badge for each element flag.
    for (const flag of plan.elementFlags) {
      const target = findByName(page, flag.nodeName);
      if (!target) {
        // Fix C1: unmatched flag goes to notes panel — not silently dropped.
        unmatchedFlags.add(flag);
        skipped++;
        continue;
      }
      const badge = fig.createRectangle();
      badge.name = `Badge ${flag.index + 1}`;
      // Position badge at the top-right corner of the target node.
      badge.x = target.x + target.width;
      badge.y = target.y;
      badge.resize(BADGE_SIZE, BADGE_SIZE);
      badge.fills = solidPaint(flag.kind === "conformance" ? RED_FILL : AMBER_FILL);
      group.appendChild(badge);

      // Fix I2a: render badge NUMBER as a visible text node (named differently from
      // "Badge N" so badge-count filters still work: "badge-num-N" is lowercase).
      const badgeLabel = fig.createText();
      badgeLabel.name = `badge-num-${flag.index + 1}`;
      badgeLabel.x = badge.x;
      badgeLabel.y = badge.y;
      badgeLabel.characters = String(flag.index + 1);
      group.appendChild(badgeLabel);
    }

    // Build the "Review notes" panel (frame + text child).
    const notesFrame = fig.createFrame();
    notesFrame.name = "Review notes";
    notesFrame.x = 0;
    notesFrame.y = 260;
    notesFrame.resize(400, 120);
    group.appendChild(notesFrame);

    const lines: string[] = [];
    lines.push(`Verdict: ${plan.conformant ? "CONFORMANT" : "NON-CONFORMANT"}`);
    // Fix I1: show reliability label when best-effort so the reviewer knows the
    // annotation is canvas-inferred (not an exact UXFactory-rendered review).
    if (report.reliability === "best-effort") {
      lines.push("Reliability: best-effort (inferred from canvas)");
    }

    // Fix I2b + Fix C1: "Element flags" section — lists every ElementFlag (found or
    // unmatched) so badge N ↔ note N and no flag is invisible to the reviewer.
    if (plan.elementFlags.length > 0) {
      lines.push("Element flags:");
      for (const flag of plan.elementFlags) {
        const suffix = unmatchedFlags.has(flag) ? " [not on canvas]" : "";
        lines.push(
          `  ${flag.index + 1}. [${flag.severity}] ${flag.reason} (${flag.nodeName})${suffix}`,
        );
      }
    }

    if (plan.coverageGaps.length > 0) {
      lines.push("Coverage gaps:");
      for (const gap of plan.coverageGaps) {
        lines.push(`  ${gap.index + 1}. [${gap.severity}] ${gap.reason}`);
      }
    }
    lines.push("Legend:");
    lines.push("  RED = requirement violation");
    lines.push("  AMBER = advisory suggestion");

    const notesText = fig.createText();
    notesText.name = "notes-content";
    notesText.x = 8;
    notesText.y = 8;
    notesText.characters = lines.join("\n");
    notesFrame.appendChild(notesText);

    post({ type: "review-done", skipped });
  } catch (err) {
    // Fix I3b: remove any partial group from the page before posting review-error
    // so a mid-draw throw leaves no orphan layer.
    if (group !== null) group.remove();
    post({ type: "review-error", message: String(err) });
  }
}

// ---- canvas-snapshot review (§14.2) ----

/**
 * Reads the current selection, builds a DesignSpec-shaped CanvasSnapshot,
 * takes a PNG screenshot of the first selected node, and posts the result
 * to the UI to be relayed to the bridge /canvas endpoint.
 *
 * Error boundary: any failure posts review-selection-error (never hangs).
 * Empty selection posts a clear error message.
 */
async function reviewSelection(): Promise<void> {
  const selection = fig.currentPage.selection;

  if (selection.length === 0) {
    post({ type: "review-selection-error", message: "Select at least one frame to review." });
    return;
  }

  try {
    const pageName = fig.currentPage.name;
    const allFrames: SnapshotFrame[] = [];

    for (const node of selection) {
      const snap = snapshotNode(node as unknown as FrameLike, pageName);
      for (const f of snap.frames) {
        allFrames.push(f);
      }
    }

    const snapshot: CanvasSnapshot = {
      source: "canvas-inferred",
      page: pageName,
      frames: allFrames,
    };

    // Screenshot of the first selected node (PNG bytes → number[] for JSON transport).
    const firstNode = selection[0]!;
    const bytes = (await firstNode.exportAsync?.({ format: "PNG" })) ?? new Uint8Array(0);
    const screenshot = Array.from(bytes);

    post({ type: "review-selection-ready", snapshot, screenshot });
  } catch (err) {
    post({ type: "review-selection-error", message: String(err) });
  }
}

function applyUndo(): void {
  const inverse = undo.pop(); // popping is the only mutation — never re-push
  if (inverse && inverse.id) {
    const target = fig.getNodeById(inverse.id);
    if (target) applyProps(target, planEdit(inverse, true).props);
  }
  post({ type: "undo-count", count: undo.size });
}

function postSelection(): void {
  const page = fig.currentPage;
  const raw: RawSelNode[] = page.selection.map((n) => {
    const out: RawSelNode = {
      id: n.id,
      name: n.name,
      type: n.type,
      x: n.x,
      y: n.y,
      w: n.width,
      h: n.height,
    };
    if (n.opacity !== undefined) out.opacity = n.opacity;
    if (n.rotation !== undefined) out.rotation = n.rotation;
    if (n.visible !== undefined) out.visible = n.visible;
    if (n.cornerRadius !== undefined) out.cornerRadius = n.cornerRadius;
    if (n.characters !== undefined) out.characters = n.characters;
    return out;
  });
  post({
    type: "selection",
    selection: mapSelection(raw, {
      page: page.name,
      fileName: fig.root.name,
      fileKey: fig.fileKey ?? "",
    }),
  });
}

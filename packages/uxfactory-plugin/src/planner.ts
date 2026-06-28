import type {
  Spec,
  Editor,
  Frame,
  Section,
  Connector,
  Edit,
  FrameChild,
  SectionChild,
} from "@uxfactory/spec";

/** A normalized leaf node inside a planned frame or section. */
export interface PlannedChild {
  kind: "shape" | "text" | "instance" | "sticky";
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  rotation?: number;
  opacity?: number;
  characters?: string;
  asset?: string;
}

export interface PlannedFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: PlannedChild[];
}

export interface PlannedSection {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: PlannedChild[];
}

export interface PlannedConnector {
  from: string;
  to: string;
  label?: string;
}

/** A deterministically-ordered, defaults-resolved representation of a spec. */
export interface RenderPlan {
  editor: Editor;
  page: string;
  frames: PlannedFrame[];
  sections: PlannedSection[];
  connectors: PlannedConnector[];
  edits: Edit[];
}

function mapChild(child: FrameChild | SectionChild): PlannedChild {
  const out: PlannedChild = { kind: child.type, name: child.name, x: child.x, y: child.y };
  if ("width" in child && child.width !== undefined) out.width = child.width;
  if ("height" in child && child.height !== undefined) out.height = child.height;
  if ("fill" in child && child.fill !== undefined) out.fill = child.fill;
  if ("stroke" in child && child.stroke !== undefined) out.stroke = child.stroke;
  if ("strokeWidth" in child && child.strokeWidth !== undefined)
    out.strokeWidth = child.strokeWidth;
  if ("cornerRadius" in child && child.cornerRadius !== undefined)
    out.cornerRadius = child.cornerRadius;
  if ("rotation" in child && child.rotation !== undefined) out.rotation = child.rotation;
  if ("opacity" in child && child.opacity !== undefined) out.opacity = child.opacity;
  if ("characters" in child && child.characters !== undefined) out.characters = child.characters;
  if ("asset" in child && child.asset !== undefined) out.asset = child.asset;
  return out;
}

function planFrame(frame: Frame): PlannedFrame {
  return {
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    children: (frame.children ?? []).map(mapChild),
  };
}

function planSection(section: Section): PlannedSection {
  return {
    name: section.name,
    x: section.x,
    y: section.y,
    width: section.width,
    height: section.height,
    children: (section.children ?? []).map(mapChild),
  };
}

function planConnector(connector: Connector): PlannedConnector {
  const out: PlannedConnector = { from: connector.from, to: connector.to };
  if (connector.label !== undefined) out.label = connector.label;
  return out;
}

function cloneEdit(edit: Edit): Edit {
  const out: Edit = { set: { ...edit.set } };
  if (edit.id !== undefined) out.id = edit.id;
  if (edit.name !== undefined) out.name = edit.name;
  return out;
}

/**
 * Build a pure, deterministic render plan from a spec. Resolves defaults
 * (editor → "figma", page → "Page 1"), keeps children in given order, and
 * omits absent optional properties. No I/O, no clock, no randomness:
 * `planRender(spec)` deep-equals itself across calls.
 */
export function planRender(spec: Spec): RenderPlan {
  const editor: Editor = spec.editor ?? "figma";
  const page = ("page" in spec ? spec.page : undefined) ?? "Page 1";
  const frames = "frames" in spec ? spec.frames.map(planFrame) : [];
  const sections = "sections" in spec ? spec.sections.map(planSection) : [];
  const connectors =
    "connectors" in spec && spec.connectors ? spec.connectors.map(planConnector) : [];
  const edits = spec.edits ? spec.edits.map(cloneEdit) : [];
  return { editor, page, frames, sections, connectors, edits };
}

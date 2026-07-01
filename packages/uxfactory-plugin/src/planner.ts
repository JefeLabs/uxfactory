import type {
  Spec,
  Editor,
  Frame,
  Section,
  Connector,
  Edit,
  FrameChild,
  SectionChild,
  AutoLayout,
  SizingSpec,
  Effect,
  CornerRadius,
  InstanceOverride,
  ComponentDef,
  ComponentInstanceNode,
} from "@uxfactory/spec";

/** A normalized node inside a planned frame, section, or component. */
export interface PlannedChild {
  kind: "shape" | "text" | "instance" | "sticky" | "frame" | "component-instance";
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: CornerRadius;
  rotation?: number;
  opacity?: number;
  characters?: string;
  asset?: string;
  effects?: Effect[];
  // kind === "frame":
  layout?: AutoLayout;
  sizing?: SizingSpec;
  children?: PlannedChild[];
  // kind === "component-instance":
  component?: string;
  overrides?: Record<string, InstanceOverride>;
}

export interface PlannedFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layout?: AutoLayout;
  sizing?: SizingSpec;
  fill?: string;
  effects?: Effect[];
  cornerRadius?: CornerRadius;
  children: PlannedChild[];
}

/** A planned local component master (no canvas position — placed by the renderer). */
export interface PlannedComponent {
  name: string;
  width: number;
  height: number;
  layout?: AutoLayout;
  sizing?: SizingSpec;
  fill?: string;
  effects?: Effect[];
  cornerRadius?: CornerRadius;
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
  components?: Record<string, PlannedComponent>;
  frames: PlannedFrame[];
  sections: PlannedSection[];
  connectors: PlannedConnector[];
  edits: Edit[];
}

function mapChild(child: FrameChild | SectionChild): PlannedChild {
  // A FrameChild with no `type` discriminant is a nested Frame.
  if (!("type" in child)) {
    const f = child as Frame;
    const out: PlannedChild = {
      kind: "frame",
      name: f.name,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      children: (f.children ?? []).map(mapChild),
    };
    if (f.layout !== undefined) out.layout = f.layout;
    if (f.sizing !== undefined) out.sizing = f.sizing;
    if (f.fill !== undefined) out.fill = f.fill;
    if (f.effects !== undefined) out.effects = f.effects;
    if (f.cornerRadius !== undefined) out.cornerRadius = f.cornerRadius;
    return out;
  }
  if (child.type === "component-instance") {
    const ci = child as ComponentInstanceNode;
    const out: PlannedChild = { kind: "component-instance", name: ci.name, x: ci.x, y: ci.y, component: ci.component };
    if (ci.width !== undefined) out.width = ci.width;
    if (ci.height !== undefined) out.height = ci.height;
    if (ci.rotation !== undefined) out.rotation = ci.rotation;
    if (ci.opacity !== undefined) out.opacity = ci.opacity;
    if (ci.overrides !== undefined) out.overrides = ci.overrides;
    return out;
  }
  const out: PlannedChild = { kind: child.type, name: child.name, x: child.x, y: child.y };
  if ("width" in child && child.width !== undefined) out.width = child.width;
  if ("height" in child && child.height !== undefined) out.height = child.height;
  if ("fill" in child && child.fill !== undefined) out.fill = child.fill;
  if ("stroke" in child && child.stroke !== undefined) out.stroke = child.stroke;
  if ("strokeWidth" in child && child.strokeWidth !== undefined) out.strokeWidth = child.strokeWidth;
  if ("cornerRadius" in child && child.cornerRadius !== undefined) out.cornerRadius = child.cornerRadius;
  if ("rotation" in child && child.rotation !== undefined) out.rotation = child.rotation;
  if ("opacity" in child && child.opacity !== undefined) out.opacity = child.opacity;
  if ("characters" in child && child.characters !== undefined) out.characters = child.characters;
  if ("asset" in child && child.asset !== undefined) out.asset = child.asset;
  if ("effects" in child && child.effects !== undefined) out.effects = child.effects;
  return out;
}

function planFrame(frame: Frame): PlannedFrame {
  const out: PlannedFrame = {
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    children: (frame.children ?? []).map(mapChild),
  };
  if (frame.layout !== undefined) out.layout = frame.layout;
  if (frame.sizing !== undefined) out.sizing = frame.sizing;
  if (frame.fill !== undefined) out.fill = frame.fill;
  if (frame.effects !== undefined) out.effects = frame.effects;
  if (frame.cornerRadius !== undefined) out.cornerRadius = frame.cornerRadius;
  return out;
}

function planComponent(def: ComponentDef): PlannedComponent {
  const out: PlannedComponent = {
    name: def.name,
    width: def.width,
    height: def.height,
    children: (def.children ?? []).map(mapChild),
  };
  if (def.layout !== undefined) out.layout = def.layout;
  if (def.sizing !== undefined) out.sizing = def.sizing;
  if (def.fill !== undefined) out.fill = def.fill;
  if (def.effects !== undefined) out.effects = def.effects;
  if (def.cornerRadius !== undefined) out.cornerRadius = def.cornerRadius;
  return out;
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
  const plan: RenderPlan = { editor, page, frames, sections, connectors, edits };
  if ("components" in spec && spec.components) {
    plan.components = Object.fromEntries(
      Object.entries(spec.components).map(([id, def]) => [id, planComponent(def)]),
    );
  }
  return plan;
}

/** Target editor for a spec. */
export type Editor = "figma" | "figjam";

/** A solid color as a 3- or 6-digit hex string, e.g. "#1E88E5". */
export type HexColor = string;

/** A drop or inner shadow effect. */
export interface Effect {
  type: "drop-shadow" | "inner-shadow";
  color: HexColor;
  opacity?: number;
  x: number;
  y: number;
  blur: number;
  spread?: number;
}

/** Uniform radius (number) or per-corner radii. */
export type CornerRadius = number | { tl: number; tr: number; br: number; bl: number };

/** Common geometry for a positioned, sized node. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle-like shape, optionally carrying text. */
export interface ShapeNode extends Box {
  type: "shape";
  name: string;
  fill?: HexColor;
  stroke?: HexColor;
  strokeWidth?: number;
  cornerRadius?: CornerRadius;
  rotation?: number;
  opacity?: number;
  characters?: string;
  effects?: Effect[];
}

/** A text node. */
export interface TextNode extends Box {
  type: "text";
  name: string;
  characters: string;
  fill?: HexColor;
  rotation?: number;
  opacity?: number;
  effects?: Effect[];
}

/** A published-component instance resolved by friendly asset name (e.g. "aws:lambda"). */
export interface InstanceNode {
  type: "instance";
  name: string;
  asset: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  effects?: Effect[];
}

/** Bounded per-descendant override alphabet for a component instance (v1). */
export interface InstanceOverride {
  characters?: string;
  fill?: HexColor;
  visible?: boolean;
}

/** An instance of a local ComponentDef, resolved by `component` id. */
export interface ComponentInstanceNode {
  type: "component-instance";
  name: string;
  component: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  overrides?: Record<string, InstanceOverride>;
}

/** A reusable master: a frame-like node tree turned into a Figma component. */
export interface ComponentDef {
  name: string;
  width: number;
  height: number;
  layout?: AutoLayout;
  sizing?: SizingSpec;
  fill?: HexColor;
  children?: FrameChild[];
  effects?: Effect[];
  cornerRadius?: CornerRadius;
}

/** A FigJam sticky note. */
export interface StickyNode {
  type: "sticky";
  name: string;
  x: number;
  y: number;
  characters: string;
  fill?: HexColor;
}

/** Auto-layout alignment on either axis. */
export type Align = "start" | "center" | "end";
/** Main-axis distribution (adds space-between to Align). */
export type PrimaryAlign = Align | "space-between";
/** Auto-layout child sizing on one axis. */
export type Sizing = "fixed" | "hug" | "fill";

/** Explicit four-side padding for an auto-layout frame. */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Figma auto-layout on a frame. Absent ⇒ children are absolutely positioned. */
export interface AutoLayout {
  mode: "horizontal" | "vertical";
  gap?: number;
  padding?: number | Padding;
  primaryAlign?: PrimaryAlign;
  counterAlign?: Align;
}

/** Per-axis auto-layout sizing (FIXED | HUG | FILL). */
export interface SizingSpec {
  horizontal?: Sizing;
  vertical?: Sizing;
}

/** Children allowed inside a Figma frame. */
export type FrameChild = ShapeNode | TextNode | InstanceNode | ComponentInstanceNode | Frame;

/** Children allowed inside a FigJam section. */
export type SectionChild = ShapeNode | StickyNode | InstanceNode;

/** A Figma frame containing children. */
export interface Frame extends Box {
  name: string;
  layout?: AutoLayout;
  sizing?: SizingSpec;
  fill?: HexColor;
  children?: FrameChild[];
  effects?: Effect[];
  cornerRadius?: CornerRadius;
}

/** A FigJam section containing children. */
export interface Section extends Box {
  name: string;
  children?: SectionChild[];
}

/** A connector between two nodes, each referenced by name or id. */
export interface Connector {
  from: string;
  to: string;
  label?: string;
}

/** Properties a surgical edit may change — the v1 edit alphabet (PRD §7.2). */
export interface EditSet {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  cornerRadius?: number;
  fill?: HexColor;
  stroke?: HexColor;
  strokeWidth?: number;
  characters?: string;
}

/** A single surgical edit: target by `id` (preferred) or first-match `name`. */
export interface Edit {
  id?: string;
  name?: string;
  set: EditSet;
}

/** Design (Figma) spec: frames plus optional connectors and edits. */
export interface DesignSpec {
  editor?: "figma";
  page?: string;
  components?: Record<string, ComponentDef>;
  frames: Frame[];
  connectors?: Connector[];
  edits?: Edit[];
}

/** FigJam spec: sections plus optional connectors and edits. */
export interface FigjamSpec {
  editor: "figjam";
  page?: string;
  sections: Section[];
  connectors?: Connector[];
  edits?: Edit[];
}

/** Edit-only spec: surgical mutations, no frames or sections. */
export interface EditOnlySpec {
  editor?: Editor;
  edits: Edit[];
}

/** Any valid UXFactory spec. */
export type Spec = DesignSpec | FigjamSpec | EditOnlySpec;

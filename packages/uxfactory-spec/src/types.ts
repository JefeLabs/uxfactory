/** Target editor for a spec. */
export type Editor = "figma" | "figjam";

/** A solid color as a 3- or 6-digit hex string, e.g. "#1E88E5". */
export type HexColor = string;

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
  cornerRadius?: number;
  rotation?: number;
  opacity?: number;
  characters?: string;
}

/** A text node. */
export interface TextNode extends Box {
  type: "text";
  name: string;
  characters: string;
  fill?: HexColor;
  rotation?: number;
  opacity?: number;
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

/** Children allowed inside a Figma frame. */
export type FrameChild = ShapeNode | TextNode | InstanceNode;

/** Children allowed inside a FigJam section. */
export type SectionChild = ShapeNode | StickyNode | InstanceNode;

/** A Figma frame containing children. */
export interface Frame extends Box {
  name: string;
  children?: FrameChild[];
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

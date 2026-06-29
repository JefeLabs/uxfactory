/** A structural frame-like input node (no Figma globals — unit-testable). */
export interface FrameLike {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type?: string;
  characters?: string;
  children?: ReadonlyArray<FrameLike>;
}

/** A canvas-inferred snapshot — DesignSpec-shaped + a source marker. */
export interface CanvasSnapshot {
  source: "canvas-inferred";
  page?: string;
  frames: SnapshotFrame[];
}

export interface SnapshotFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: SnapshotChild[];
}

export interface SnapshotChild {
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  characters?: string;
}

/** Map a raw Figma node type to the spec vocabulary. */
function mapType(rawType: string | undefined): string {
  if (rawType === "TEXT") return "text";
  if (rawType === "INSTANCE" || rawType === "COMPONENT") return "instance";
  return "shape";
}

/**
 * Walks a frame-like node tree and emits a DesignSpec-shaped CanvasSnapshot.
 * PURE: takes a structural node-tree input, not Figma globals. Unit-testable.
 */
export function snapshotNode(node: FrameLike, page?: string): CanvasSnapshot {
  const children: SnapshotChild[] = (node.children ?? []).map((child) => {
    const mapped: SnapshotChild = {
      type: mapType(child.type),
      name: child.name,
      x: child.x,
      y: child.y,
      width: child.width,
      height: child.height,
    };
    if (child.characters !== undefined) mapped.characters = child.characters;
    return mapped;
  });

  const frame: SnapshotFrame = {
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    children,
  };

  const snapshot: CanvasSnapshot = {
    source: "canvas-inferred",
    frames: [frame],
  };
  if (page !== undefined) snapshot.page = page;
  return snapshot;
}

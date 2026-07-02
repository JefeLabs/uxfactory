import type { SelectionNode, SelectionPayload } from "./messages.js";

/** The §7.5 fields the main thread reads off each selected node. */
export interface RawSelNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity?: number;
  rotation?: number;
  visible?: boolean;
  cornerRadius?: number;
  characters?: string;
}

/**
 * Minimal node surface needed to walk a subtree and count distinct style keys.
 * Satisfied by Figma's SceneNode (cast) and by FakeNode in tests.
 */
export interface StyleCountNode {
  type: string;
  fills?: unknown;
  strokes?: unknown;
  fontName?: { family: string; style: string };
  children?: readonly StyleCountNode[];
}

const MAX_STYLE_WALK = 500;

function extractSolidHex(paints: unknown): string | undefined {
  if (!Array.isArray(paints) || paints.length === 0) return undefined;
  const first = paints[0] as { type?: string; color?: { r: number; g: number; b: number } };
  if (first.type !== "SOLID" || !first.color) return undefined;
  const { r, g, b } = first.color;
  const ch = (v: number): string => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

/**
 * Counts distinct style keys (solid fill hex + solid stroke hex + font family/style)
 * across the node subtree. Capped at 500 nodes for performance.
 */
export function countStylesInSubtree(root: StyleCountNode): number {
  const keys = new Set<string>();
  const queue: StyleCountNode[] = [root];
  let visited = 0;

  while (queue.length > 0 && visited < MAX_STYLE_WALK) {
    const node = queue.shift()!;
    visited++;

    const fill = extractSolidHex(node.fills);
    if (fill !== undefined) keys.add(`fill:${fill}`);

    const stroke = extractSolidHex(node.strokes);
    if (stroke !== undefined) keys.add(`stroke:${stroke}`);

    if (node.type === "TEXT" && node.fontName !== undefined) {
      keys.add(`font:${node.fontName.family}/${node.fontName.style}`);
    }

    if (node.children) {
      for (const child of node.children) {
        queue.push(child);
      }
    }
  }

  return keys.size;
}

export function mapSelection(
  nodes: RawSelNode[],
  meta: { page: string; fileName: string; fileKey: string },
  stylesInUse = 0,
): SelectionPayload {
  return {
    page: meta.page,
    fileName: meta.fileName,
    fileKey: meta.fileKey,
    nodes: nodes.map((n) => {
      const out: SelectionNode = {
        id: n.id,
        name: n.name,
        type: n.type,
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h,
      };
      if (n.opacity !== undefined) out.opacity = n.opacity;
      if (n.rotation !== undefined) out.rotation = n.rotation;
      if (n.visible !== undefined) out.visible = n.visible;
      if (n.cornerRadius !== undefined) out.cornerRadius = n.cornerRadius;
      if (n.characters !== undefined) out.characters = n.characters;
      return out;
    }),
    stylesInUse,
  };
}

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

export function mapSelection(
  nodes: RawSelNode[],
  meta: { page: string; fileName: string; fileKey: string },
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
  };
}

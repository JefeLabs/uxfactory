import type { Editor } from "@uxfactory/spec";

/** Counts of top-level structural elements in a render. */
export interface ReportCounts {
  frames: number;
  sections: number;
  objects: number;
  connectors: number;
}

/**
 * A rendered node as captured in the report. Geometry uses `w`/`h`
 * (the spec uses `width`/`height`); the optional properties mirror the
 * edit alphabet so the `edits` check can verify any set property.
 */
export interface ReportNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  cornerRadius?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  characters?: string;
}

/** A per-edit human-readable diff string plus the target it applied to. */
export interface ReportEditDiff {
  id?: string;
  name?: string;
  diff: string;
}

/**
 * The structured artifact the gate compares against a spec. The plugin
 * produces a superset of this (it also carries PNG previews, which the
 * gate ignores — gating does not need pixels, PRD §12).
 */
export interface RenderReport {
  renderId: string;
  editor: Editor;
  page: string;
  pageKey: string;
  fileName: string;
  fileKey: string;
  counts: ReportCounts;
  nodes: ReportNode[];
  edits?: ReportEditDiff[];
}

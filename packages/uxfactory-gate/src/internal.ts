import type { Spec, Editor } from "@uxfactory/spec";
import type { RenderReport, ReportNode, ReportCounts } from "./report.js";

/** True when the spec is a design spec (has `frames`). */
export function hasFrames(spec: Spec): boolean {
  return Object.prototype.hasOwnProperty.call(spec, "frames");
}

/** True when the spec is a figjam spec (has `sections`). */
export function hasSections(spec: Spec): boolean {
  return Object.prototype.hasOwnProperty.call(spec, "sections");
}

/** The editor a render of this spec should report, or undefined if unasserted. */
export function expectedEditor(spec: Spec): Editor | undefined {
  if (hasSections(spec)) return "figjam";
  if (hasFrames(spec)) return "figma";
  return spec.editor;
}

/** A child node flattened out of a frame/section, with the geometry the spec declares. */
export interface SpecChild {
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/** Flatten every child across a spec's frames or sections. Edit-only specs have none. */
export function collectChildren(spec: Spec): SpecChild[] {
  const children: SpecChild[] = [];
  const containers = hasFrames(spec)
    ? (spec as { frames: { children?: SpecChild[] }[] }).frames
    : hasSections(spec)
      ? (spec as { sections: { children?: SpecChild[] }[] }).sections
      : [];
  for (const container of containers) {
    for (const child of container.children ?? []) {
      children.push({
        name: child.name,
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
      });
    }
  }
  return children;
}

/** Structural counts a render of this spec should report. */
export function expectedCounts(spec: Spec): ReportCounts {
  const frames = hasFrames(spec) ? (spec as { frames: unknown[] }).frames.length : 0;
  const sections = hasSections(spec) ? (spec as { sections: unknown[] }).sections.length : 0;
  const objects = collectChildren(spec).length;
  const connectors =
    "connectors" in spec && Array.isArray((spec as { connectors?: unknown[] }).connectors)
      ? (spec as { connectors: unknown[] }).connectors.length
      : 0;
  return { frames, sections, objects, connectors };
}

/** Find a report node by id (preferred) or first-match name. */
export function findNode(
  report: RenderReport,
  target: { id?: string; name?: string },
): ReportNode | undefined {
  if (target.id !== undefined) {
    const byId = report.nodes.find((n) => n.id === target.id);
    if (byId) return byId;
  }
  if (target.name !== undefined) {
    return report.nodes.find((n) => n.name === target.name);
  }
  return undefined;
}

/** True when |a - b| <= tolerancePx (inclusive at the boundary). */
export function withinTolerance(a: number, b: number, tolerancePx: number): boolean {
  return Math.abs(a - b) <= tolerancePx;
}

/** Normalize a hex color for comparison (lowercased). */
export function normalizeColor(c: string): string {
  return c.toLowerCase();
}

/** Equality for non-geometry numbers, tolerant of IEEE-754 drift. */
export function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

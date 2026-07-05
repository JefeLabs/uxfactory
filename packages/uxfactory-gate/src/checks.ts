import type { Spec, Edit, EditSet } from "@uxfactory/spec";
import type { RenderReport, ReportNode } from "./report.js";
import type { GateCheck, GateFailure } from "./result.js";
import {
  collectChildren,
  expectedCounts,
  expectedEditor,
  findNode,
  hasFrames,
  hasSections,
  normalizeColor,
  numbersEqual,
  withinTolerance,
} from "./internal.js";

/** A single check's outcome plus any concrete failures it produced. */
export interface CheckOutput {
  check: GateCheck;
  failures: GateFailure[];
}

const pass = (id: GateCheck["id"], extra: Partial<GateCheck> = {}): CheckOutput => ({
  check: { id, status: "PASS", ...extra },
  failures: [],
});
const skip = (id: GateCheck["id"]): CheckOutput => ({
  check: { id, status: "SKIP" },
  failures: [],
});
const fail = (
  id: GateCheck["id"],
  failures: GateFailure[],
  extra: Partial<GateCheck> = {},
): CheckOutput => ({ check: { id, status: "FAIL", ...extra }, failures });

/** True when the spec is edit-only (no frames, no sections). */
function isEditOnly(spec: Spec): boolean {
  return !hasFrames(spec) && !hasSections(spec);
}

/** Edits carried by any spec shape. */
function editsOf(spec: Spec): Edit[] {
  return "edits" in spec && Array.isArray((spec as { edits?: Edit[] }).edits)
    ? (spec as { edits: Edit[] }).edits
    : [];
}

export function checkEditorType(spec: Spec, report: RenderReport): CheckOutput {
  const expected = expectedEditor(spec);
  if (expected === undefined) return skip("editorType");
  if (report.editor === expected) return pass("editorType", { expected, actual: report.editor });
  return fail(
    "editorType",
    [{ check: "editorType", property: "editor", expected, actual: report.editor }],
    { expected, actual: report.editor },
  );
}

export function checkCounts(spec: Spec, report: RenderReport): CheckOutput {
  if (isEditOnly(spec)) return skip("counts");
  const expected = expectedCounts(spec);
  const actual = report.counts;
  const failures: GateFailure[] = [];
  for (const key of ["frames", "sections", "objects", "connectors"] as const) {
    if (expected[key] !== actual[key]) {
      failures.push({
        check: "counts",
        property: key,
        expected: expected[key],
        actual: actual[key],
      });
    }
  }
  return failures.length === 0
    ? pass("counts", { expected, actual })
    : fail("counts", failures, { expected, actual });
}

export function checkPresence(spec: Spec, report: RenderReport): CheckOutput {
  const failures: GateFailure[] = [];
  if (isEditOnly(spec)) {
    for (const edit of editsOf(spec)) {
      if (!findNode(report, { id: edit.id, name: edit.name })) {
        failures.push({
          check: "presence",
          nodeId: edit.id,
          name: edit.name,
          expected: "present",
          actual: "missing",
        });
      }
    }
  } else {
    for (const child of collectChildren(spec)) {
      if (!findNode(report, { name: child.name })) {
        failures.push({
          check: "presence",
          name: child.name,
          expected: "present",
          actual: "missing",
        });
      }
    }
  }
  return failures.length === 0 ? pass("presence") : fail("presence", failures);
}

export function checkGeometry(spec: Spec, report: RenderReport, tolerancePx: number): CheckOutput {
  if (isEditOnly(spec)) return skip("geometry");
  const failures: GateFailure[] = [];
  for (const child of collectChildren(spec)) {
    const node = findNode(report, { name: child.name });
    if (!node) continue; // presence handles missing nodes
    // Auto-layout awareness: Figma re-flows positions of auto-layout children
    // and re-computes fill/hug axes, so the spec's static pixels are not the
    // source of truth there — comparing them would fail correct renders.
    if (child.inAutoLayout !== true) {
      compareGeo(failures, node, "x", child.x, node.x, tolerancePx);
      compareGeo(failures, node, "y", child.y, node.y, tolerancePx);
    }
    const h = child.sizing?.horizontal;
    if (child.width !== undefined && h !== "fill" && h !== "hug")
      compareGeo(failures, node, "width", child.width, node.w, tolerancePx);
    const v = child.sizing?.vertical;
    if (child.height !== undefined && v !== "fill" && v !== "hug")
      compareGeo(failures, node, "height", child.height, node.h, tolerancePx);
  }
  return failures.length === 0
    ? pass("geometry", { tolerancePx })
    : fail("geometry", failures, { tolerancePx });
}

function compareGeo(
  out: GateFailure[],
  node: ReportNode,
  property: string,
  expected: number,
  actual: number,
  tolerancePx: number,
): void {
  if (!withinTolerance(expected, actual, tolerancePx)) {
    out.push({
      check: "geometry",
      nodeId: node.id,
      name: node.name,
      property,
      expected,
      actual,
      tolerancePx,
    });
  }
}

export function checkEdits(spec: Spec, report: RenderReport, tolerancePx: number): CheckOutput {
  const edits = editsOf(spec);
  if (edits.length === 0) return skip("edits");
  const failures: GateFailure[] = [];
  for (const edit of edits) {
    const node = findNode(report, { id: edit.id, name: edit.name });
    if (!node) {
      failures.push({
        check: "edits",
        nodeId: edit.id,
        name: edit.name,
        expected: "present",
        actual: "missing",
      });
      continue;
    }
    for (const [property, value] of Object.entries(edit.set) as [keyof EditSet, unknown][]) {
      compareEditProp(failures, node, property, value, tolerancePx);
    }
  }
  return failures.length === 0 ? pass("edits") : fail("edits", failures);
}

const GEOMETRY_PROPS = new Set<keyof EditSet>(["x", "y", "width", "height"]);
const COLOR_PROPS = new Set<keyof EditSet>(["fill", "stroke"]);

function compareEditProp(
  out: GateFailure[],
  node: ReportNode,
  property: keyof EditSet,
  value: unknown,
  tolerancePx: number,
): void {
  const actual = reportValueFor(node, property);
  const base = { check: "edits" as const, nodeId: node.id, name: node.name, property };

  if (GEOMETRY_PROPS.has(property)) {
    if (
      typeof value !== "number" ||
      typeof actual !== "number" ||
      !withinTolerance(value, actual, tolerancePx)
    ) {
      out.push({ ...base, expected: value, actual, tolerancePx });
    }
    return;
  }
  if (COLOR_PROPS.has(property)) {
    if (
      typeof value !== "string" ||
      typeof actual !== "string" ||
      normalizeColor(value) !== normalizeColor(actual)
    ) {
      out.push({ ...base, expected: value, actual });
    }
    return;
  }
  if (typeof value === "number" && typeof actual === "number") {
    if (!numbersEqual(value, actual)) out.push({ ...base, expected: value, actual });
    return;
  }
  if (value !== actual) out.push({ ...base, expected: value, actual });
}

/** Read the report-node property corresponding to an edit-set property (width→w, height→h). */
function reportValueFor(node: ReportNode, property: keyof EditSet): unknown {
  if (property === "width") return node.w;
  if (property === "height") return node.h;
  return (node as unknown as Record<string, unknown>)[property];
}

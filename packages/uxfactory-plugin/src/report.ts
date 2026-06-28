import type { Editor } from "@uxfactory/spec";
import type { RenderReport, ReportNode, ReportCounts, ReportEditDiff } from "@uxfactory/gate";

export type { RenderReport, ReportNode, ReportCounts, ReportEditDiff };

/**
 * The plugin emits a SUPERSET of the gate's `RenderReport`: it echoes the
 * `jobId` (so the bridge can resolve a pending `POST /edits` waiter) and may
 * carry an optional whole-page PNG. The gate ignores both extra fields.
 */
export type PluginRenderReport = RenderReport & { jobId?: string; pagePng?: string };

/** Everything the main thread collects before posting a report. */
export interface ReportInput {
  editor: Editor;
  page: string;
  pageKey: string;
  fileName: string;
  fileKey: string;
  renderId: string;
  jobId?: string;
  nodes: ReportNode[];
  counts: ReportCounts;
  edits?: ReportEditDiff[];
  pagePng?: string;
}

/** Normalize a hex color to 6-digit lowercase (`#1E88E5`→`#1e88e5`, `#abc`→`#aabbcc`). */
function normalizeHex(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let hex = value.trim().toLowerCase();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  const body = hex.slice(1);
  if (/^[0-9a-f]{3}$/.test(body)) return `#${body.replace(/./g, (c) => c + c)}`;
  return hex;
}

/** A filename-safe render id (`[A-Za-z0-9_-]+`); the bridge sanitizes anyway. */
export function newRenderId(seedCounter: number): string {
  return `r_${seedCounter}`;
}

/** Assemble a gate-compatible render report, normalizing node colors. */
export function assembleReport(input: ReportInput): PluginRenderReport {
  const nodes: ReportNode[] = input.nodes.map((n) => {
    const out: ReportNode = { ...n };
    if (n.fill !== undefined) out.fill = normalizeHex(n.fill);
    if (n.stroke !== undefined) out.stroke = normalizeHex(n.stroke);
    return out;
  });
  const report: PluginRenderReport = {
    renderId: input.renderId,
    editor: input.editor,
    page: input.page,
    pageKey: input.pageKey,
    fileName: input.fileName,
    fileKey: input.fileKey,
    counts: input.counts,
    nodes,
  };
  if (input.edits !== undefined) report.edits = input.edits;
  if (input.jobId !== undefined) report.jobId = input.jobId;
  if (input.pagePng !== undefined) report.pagePng = input.pagePng;
  return report;
}

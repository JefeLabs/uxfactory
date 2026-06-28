import type { RenderReport, ReportNode, ReportCounts, ReportEditDiff } from "@uxfactory/gate";

export type { RenderReport, ReportNode, ReportCounts, ReportEditDiff };

/**
 * The plugin emits a SUPERSET of the gate's `RenderReport`: it echoes the
 * `jobId` (so the bridge can resolve a pending `POST /edits` waiter) and may
 * carry an optional whole-page PNG. The gate ignores both extra fields.
 */
export type PluginRenderReport = RenderReport & { jobId?: string; pagePng?: string };

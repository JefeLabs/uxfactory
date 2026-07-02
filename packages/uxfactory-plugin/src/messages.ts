import type { PluginRenderReport } from "./report.js";
import type { ReviewReportLike } from "./annotation-plan.js";
import type { CanvasSnapshot } from "./canvas-snapshot.js";

/** A selected node mapped to the §7.5 reporting fields. */
export interface SelectionNode {
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

/** The body POSTed to the bridge `POST /selection`. */
export interface SelectionPayload {
  page: string;
  fileName: string;
  fileKey: string;
  nodes: SelectionNode[];
  /** Count of distinct style keys (fill hex + stroke hex + font key) in the primary node subtree. */
  stylesInUse: number;
}

/** Messages the iframe UI sends to the main thread. */
export type UiToMain =
  | { type: "render"; spec: unknown; jobId?: string }
  | { type: "review"; report: ReviewReportLike }
  | { type: "review-selection" }
  | { type: "undo" }
  | { type: "resize"; width: number; height: number }
  | { type: "storage-get"; key: string }
  | { type: "storage-set"; key: string; value: unknown }
  | { type: "file-info-request" }
  | { type: "insert-icon"; name: string; svg: string; size: number }
  | { type: "notify"; message: string }
  | { type: "close" };

/** Messages the main thread sends to the iframe UI. */
export type MainToUi =
  | { type: "rendered"; report: PluginRenderReport }
  | { type: "selection"; selection: SelectionPayload }
  | { type: "undo-count"; count: number }
  | { type: "render-error"; message: string }
  | { type: "review-done"; skipped: number }
  | { type: "review-error"; message: string }
  | { type: "review-selection-ready"; snapshot: CanvasSnapshot; screenshot: number[] }
  | { type: "review-selection-error"; message: string }
  | { type: "storage-value"; key: string; value: unknown }
  | { type: "file-info"; name: string; fileKey: string }
  | { type: "icon-inserted"; nodeId: string };

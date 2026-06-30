import { validate } from "@uxfactory/spec";
import type { MainToUi, UiToMain } from "./messages.js";
import { nextPanel, pipelineView, type PanelState, type PanelView } from "./panel.js";
import type { ReviewReportLike } from "./annotation-plan.js";
import {
  initialState,
  reduce,
  setConnection,
  type PanelState as PipelineState,
  type PanelAction,
} from "./panel-state.js";
import { renderPanel, wirePanel } from "./pipeline-view.js";
import { createPipelineClient, type PipelineClient } from "./pipeline-client.js";

const BRIDGE = "http://localhost:3779";

export interface UiOptions {
  doc?: Document;
  fetchImpl?: typeof fetch;
  postToMain?: (msg: UiToMain) => void;
  /**
   * Factory for the pipeline client (the `/pipeline/*` + SSE wrapper). Defaults
   * to the real `createPipelineClient` bound to the injected fetch; tests inject
   * a fake to drive the mount/teardown lifecycle without a live bridge.
   */
  createClient?: (baseUrl: string) => PipelineClient;
}

export interface UiController {
  pollOnce(): Promise<void>;
  checkHealth(): Promise<void>;
  onMainMessage(msg: MainToUi): Promise<void>;
  submitManual(): void;
  clickUndo(): void;
  clickReview(): Promise<void>;
  clickReviewSelection(): void;
  start(): void;
  stop(): void;
  readonly panel: PanelState;
}

export function createUi(options: UiOptions = {}): UiController {
  const doc = options.doc ?? document;
  const doFetch = options.fetchImpl ?? fetch;
  const postToMain =
    options.postToMain ?? ((msg: UiToMain) => parent.postMessage({ pluginMessage: msg }, "*"));
  const makeClient =
    options.createClient ??
    ((baseUrl: string) => createPipelineClient(baseUrl, { fetch: doFetch }));

  let panel: PanelState = "COMPACT";
  let connected = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let keydownHandler: ((e: KeyboardEvent) => void) | undefined;

  // --- pipeline panel (mounted only when its container is present) ---
  // The store persists across reconnects; only the SSE subscription is torn
  // down + rebuilt, so we never leak a fetch-stream reader per reconnect.
  let pipelineState: PipelineState = initialState;
  let pipelineTeardown: (() => void) | undefined;

  const pipelineDispatch = (a: PanelAction): void => {
    pipelineState = reduce(pipelineState, a);
  };

  const el = (id: string): HTMLElement | null => doc.getElementById(id);

  /**
   * Mount the pipeline panel into `#pipeline` (real client → live bridge), size
   * the iframe to PIPELINE, and capture the SSE teardown. Returns false (a no-op)
   * when the container is absent — e.g. the legacy review-only UI / unit DOMs —
   * so the caller falls back to the CONNECTED_MIN pill.
   */
  function mountPipeline(): boolean {
    const root = el("pipeline");
    if (!root) return false;
    // Clean (re-)mount: release any prior subscription first.
    pipelineTeardown?.();
    pipelineTeardown = undefined;
    pipelineState = reduce(pipelineState, setConnection("connected"));
    const client = makeClient(BRIDGE);
    pipelineTeardown = wirePanel(root, {
      client,
      getState: () => pipelineState,
      dispatch: pipelineDispatch,
    });
    applyPanel(pipelineView());
    return true;
  }

  /** Tear down the SSE subscription and re-render the panel as disconnected. */
  function unmountPipeline(): void {
    pipelineTeardown?.();
    pipelineTeardown = undefined;
    pipelineState = reduce(pipelineState, setConnection("disconnected"));
    const root = el("pipeline");
    if (root) root.innerHTML = renderPanel(pipelineState);
  }

  const postInit = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const showErrors = (messages: string[]): void => {
    const box = el("errors");
    if (box) box.textContent = messages.join("\n");
  };

  const setStatus = (text: string): void => {
    const status = el("status");
    if (status) status.textContent = text;
  };

  const applyPanel = (view: PanelView): void => {
    panel = view.state;
    postToMain({ type: "resize", width: view.width, height: view.height });
    const root = el("panel");
    if (root) root.dataset.state = view.state;
  };

  async function pollOnce(): Promise<void> {
    const res = await doFetch(`${BRIDGE}/next`);
    if (res.status === 204 || !res.ok) return;
    const job = (await res.json()) as { jobId?: string; spec: unknown };
    postToMain({ type: "render", spec: job.spec, jobId: job.jobId });
  }

  async function checkHealth(): Promise<void> {
    let ok = false;
    try {
      ok = (await doFetch(`${BRIDGE}/health`)).ok;
    } catch {
      ok = false;
    }
    if (ok && !connected) {
      connected = true;
      // Prefer the live pipeline panel; fall back to the compact pill when the
      // panel container isn't present (legacy/unit DOM).
      if (!mountPipeline()) applyPanel(nextPanel(panel, "connect"));
      setStatus("Connected");
    } else if (!ok && connected) {
      connected = false;
      unmountPipeline();
      applyPanel(nextPanel(panel, "disconnect"));
      setStatus("Disconnected");
    }
  }

  async function onMainMessage(msg: MainToUi): Promise<void> {
    if (msg.type === "rendered") {
      await doFetch(`${BRIDGE}/rendered`, postInit(msg.report));
    } else if (msg.type === "selection") {
      await doFetch(`${BRIDGE}/selection`, postInit(msg.selection));
    } else if (msg.type === "undo-count") {
      const undo = el("undo");
      if (undo) undo.textContent = `Undo (${msg.count})`;
    } else if (msg.type === "render-error") {
      showErrors([msg.message]);
    } else if (msg.type === "review-done") {
      setStatus(`Review complete${msg.skipped > 0 ? ` (${msg.skipped} nodes skipped)` : ""}`);
    } else if (msg.type === "review-error") {
      showErrors([`Review error: ${msg.message}`]);
    } else if (msg.type === "review-selection-ready") {
      // Fix M3: wrap POST /canvas in try/catch so a down bridge gives user feedback.
      try {
        const canvasRes = await doFetch(
          `${BRIDGE}/canvas`,
          postInit({ snapshot: msg.snapshot, screenshot: msg.screenshot }),
        );
        if (!canvasRes.ok) {
          showErrors([`Could not post canvas request (bridge returned ${canvasRes.status})`]);
        }
      } catch (err) {
        showErrors([`Could not reach bridge: ${String(err)}`]);
      }
    } else if (msg.type === "review-selection-error") {
      showErrors([`Review selection error: ${msg.message}`]);
    }
  }

  /** Fetches the latest review report from the bridge and asks the main thread to draw it. */
  async function clickReview(): Promise<void> {
    showErrors([]);
    setStatus("Reviewing…");
    let res: Response;
    try {
      res = await doFetch(`${BRIDGE}/review`);
    } catch (err) {
      showErrors([`Could not reach bridge: ${String(err)}`]);
      // Fix M3: reset status so it is not stuck at "Reviewing…" after a network error.
      setStatus("Connected");
      return;
    }
    if (!res.ok) {
      showErrors([`No review report available (bridge returned ${res.status})`]);
      setStatus("Connected");
      return;
    }
    const report = (await res.json()) as ReviewReportLike;
    postToMain({ type: "review", report });
  }

  function submitManual(): void {
    const textarea = el("spec") as HTMLTextAreaElement | null;
    if (!textarea) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(textarea.value);
    } catch (err) {
      showErrors([`Invalid JSON: ${(err as Error).message}`]);
      return;
    }
    const result = validate(parsed);
    if (!result.valid) {
      showErrors(result.errors.map((e) => `${e.path}: ${e.message}`));
      return;
    }
    showErrors([]);
    postToMain({ type: "render", spec: parsed });
  }

  function clickUndo(): void {
    postToMain({ type: "undo" });
  }

  /** Triggers a canvas snapshot of the current Figma selection for best-effort review. */
  function clickReviewSelection(): void {
    postToMain({ type: "review-selection" });
  }

  function start(): void {
    void checkHealth();
    timer = setInterval(() => {
      void checkHealth();
      void pollOnce();
    }, 2000);
    el("undo")?.addEventListener("click", clickUndo);
    el("review")?.addEventListener("click", () => void clickReview());
    el("review-selection")?.addEventListener("click", () => clickReviewSelection());
    el("render-manual")?.addEventListener("click", submitManual);
    el("details")?.addEventListener("toggle", () => applyPanel(nextPanel(panel, "toggle-details")));
    el("expand")?.addEventListener("click", () => applyPanel(nextPanel(panel, "expand-click")));
    window.onmessage = (event: MessageEvent): void => {
      const data = event.data as { pluginMessage?: MainToUi };
      if (data && data.pluginMessage) void onMainMessage(data.pluginMessage);
    };
    // Fix 4 (§7.3): Cmd/Ctrl+Z triggers undo from anywhere in the panel.
    keydownHandler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        clickUndo();
      }
    };
    doc.addEventListener("keydown", keydownHandler);
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    if (typeof window !== "undefined") window.onmessage = null;
    if (keydownHandler) {
      doc.removeEventListener("keydown", keydownHandler);
      keydownHandler = undefined;
    }
    // Release the SSE subscription so a stopped controller leaks nothing.
    pipelineTeardown?.();
    pipelineTeardown = undefined;
  }

  return {
    pollOnce,
    checkHealth,
    onMainMessage,
    submitManual,
    clickUndo,
    clickReview,
    clickReviewSelection,
    start,
    stop,
    get panel() {
      return panel;
    },
  };
}

// Auto-start only in the real iframe (the panel markup is present). Importing
// this module in jsdom tests before the DOM is built is therefore inert.
if (typeof document !== "undefined" && document.getElementById("panel")) {
  createUi().start();
}

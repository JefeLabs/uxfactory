import type { RenderSnapshot } from "../batch/html-checks.js";
import type { TraceManifest } from "../batch/trace.js";

/** One render request: where the pages live, the manifest, and where screenshots go. */
export interface HtmlRenderRequest {
  /** Directory the trace `pages[].file` paths resolve against (the dir holding trace.json). */
  baseDir: string;
  trace: TraceManifest;
  /** Absolute directory screenshots are written to. */
  previewDir: string;
  viewport: { width: number; height: number };
}

/** Injectable renderer for deterministic testing without a real browser. */
export interface HtmlRenderDeps {
  renderViews: (req: HtmlRenderRequest) => Promise<RenderSnapshot[]>;
}

/**
 * Render every (page, view) in the trace to a screenshot + RenderSnapshot.
 * `deps.renderViews` overrides the real Playwright implementation in tests.
 * The default lazily imports the playwright module so this file (and its importers)
 * load even when playwright/axe-core are not installed — the error surfaces only on call.
 */
export async function renderHtml(
  req: HtmlRenderRequest,
  deps?: HtmlRenderDeps,
): Promise<RenderSnapshot[]> {
  const fn =
    deps?.renderViews ??
    (async (r: HtmlRenderRequest): Promise<RenderSnapshot[]> => {
      const { renderViewsPlaywright } = await import("./html-render-playwright.js");
      return renderViewsPlaywright(r);
    });
  return fn(req);
}

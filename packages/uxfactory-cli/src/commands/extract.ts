/**
 * `uxfactory extract` — render the trace's (page,view) set with DOM capture and
 * emit the extracted semantic DesignSpec, self-gated by @uxfactory/spec validate().
 * Deterministic, LLM-free; the renderer is injectable for tests (SP3b §8).
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { validate } from "@uxfactory/spec";
import type { DesignSpec, Frame, FrameChild, ComponentInstanceNode } from "@uxfactory/spec";
import { EXIT } from "../exit.js";
import { readRegistry } from "../batch/registry.js";
import type { RegistryViewport } from "../batch/registry.js";
import { readTrace } from "../batch/trace.js";
import { renderHtml, type HtmlRenderDeps } from "../render/html-render.js";
import { extractDesignSpec, type ExtractedView } from "../extract/dom-to-designspec.js";
import { componentize, type ComponentizeStats } from "../extract/componentize.js";
import type { IO } from "../io.js";

const DEFAULT_VIEWPORT = { width: 390, height: 844 };
/** Horizontal gap between per-viewport frames on the canvas. */
const VIEWPORT_GUTTER = 100;

export interface ExtractFlags {
  json?: boolean;
  dataDir: string;
  cwd: string;
  components?: boolean;
}

export async function extractCmd(
  dir: string,
  flags: ExtractFlags,
  io: IO,
  deps?: HtmlRenderDeps,
): Promise<number> {
  void dir; // like batch HTML mode, inputs come from the registry, not the positional arg

  const reg = await readRegistry(path.join(flags.cwd, "uxfactory.batch.json"));
  if (!reg.ok) { io.err(reg.message); return EXIT.TRANSPORT; }
  if (reg.inputs.screens === null || reg.inputs.trace === null) {
    io.err("extract requires registered inputs.screens and inputs.trace (like the HTML batch tier).");
    return EXIT.TRANSPORT;
  }
  const traceResult = await readTrace(reg.inputs.trace);
  if (!traceResult.ok) { io.err(traceResult.message); return EXIT.TRANSPORT; }

  // Registry viewports (stamped by the worker) each get their own DOM-capturing
  // render pass; view ids are viewport-suffixed so every (view, viewport) pair
  // becomes its own frame. Absent → the legacy single default-viewport extract.
  const multiViewport =
    reg.registry.viewports !== undefined && reg.registry.viewports.length > 0;
  const targets: RegistryViewport[] = multiViewport
    ? reg.registry.viewports!
    : [{ name: "default", ...DEFAULT_VIEWPORT }];

  const basePreviewDir = path.join(flags.dataDir, "batch", "previews");
  const views: ExtractedView[] = [];
  const excluded: { page: string; view: string; error: string }[] = [];
  try {
    for (const vp of targets) {
      const previewDir = multiViewport
        ? path.join(basePreviewDir, vp.name)
        : basePreviewDir;
      await mkdir(previewDir, { recursive: true });
      const snapshots = await renderHtml(
        {
          baseDir: path.dirname(reg.inputs.trace), trace: traceResult.trace,
          previewDir, viewport: { width: vp.width, height: vp.height }, captureDom: true,
        },
        deps,
      );
      for (const s of snapshots) {
        const viewId = multiViewport ? `${s.view}@${vp.name}` : s.view;
        if (s.ok && s.domTree !== undefined) {
          views.push({ page: s.page, view: viewId, viewport: s.viewport, tree: s.domTree });
        } else {
          excluded.push({ page: s.page, view: viewId, error: s.error ?? "no DOM tree captured" });
        }
      }
    }
  } catch (err) {
    io.err(`extract: renderer unavailable — ${(err as Error).message}`);
    return EXIT.TRANSPORT;
  }

  const { spec, stats } = extractDesignSpec(views);

  let compStats: ComponentizeStats | null = null;
  let finalSpec = spec;
  if (flags.components !== false) {
    const compResult = componentize(spec);
    finalSpec = compResult.spec;
    compStats = compResult.stats;
  }

  const result = validate(finalSpec);
  if (!result.valid) {
    const msg = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    if (flags.json === true) io.out(JSON.stringify({ ok: false, reason: "invalid-spec", errors: msg }));
    else io.err(`extract: assembled spec failed validation — ${msg}`);
    return EXIT.GATE_FAIL;
  }

  // Multi-viewport: tile frames left-to-right (per-viewport x offsets) so
  // published frames land side by side instead of stacking at the origin.
  if (multiViewport) {
    const offsets = new Map<string, number>();
    let running = 0;
    for (const vp of targets) {
      offsets.set(vp.name, running);
      running += vp.width + VIEWPORT_GUTTER;
    }
    for (const frame of finalSpec.frames) {
      const at = frame.name.lastIndexOf("@");
      const off = at === -1 ? undefined : offsets.get(frame.name.slice(at + 1));
      if (off !== undefined) frame.x = off;
    }
  }

  const outDir = path.join(flags.dataDir, "batch", "designspec");
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  const combinedPath = path.join(outDir, "design.designspec.json");
  await writeFile(combinedPath, JSON.stringify(finalSpec, null, 2), "utf8");
  files.push(combinedPath);
  for (const frame of finalSpec.frames) {
    const lastSlash = frame.name.lastIndexOf("/");
    const page = frame.name.slice(0, lastSlash);
    const view = frame.name.slice(lastSlash + 1);
    const refs = new Set<string>();
    const collectRefs = (c: FrameChild): void => {
      if ("type" in c && c.type === "component-instance") refs.add((c as ComponentInstanceNode).component);
      if (!("type" in c)) for (const cc of (c as Frame).children ?? []) collectRefs(cc);
    };
    for (const c of frame.children ?? []) collectRefs(c);
    const single: DesignSpec = {
      // Per-view specs publish independently — keep the tiling offset so the
      // landed frames sit side by side; legacy single-viewport pins x to 0.
      frames: [{ ...frame, x: multiViewport ? frame.x : 0 }],
      ...(refs.size > 0
        ? { components: Object.fromEntries([...refs].map((id) => [id, finalSpec.components![id]!])) }
        : {}),
    };
    const file = path.join(outDir, `${path.basename(page, ".html")}-${view}.designspec.json`);
    await writeFile(file, JSON.stringify(single, null, 2), "utf8");
    files.push(file);
  }

  if (flags.json === true) {
    io.out(JSON.stringify({
      ok: excluded.length === 0, views: stats.views, excluded, nodes: stats.nodes,
      containers: stats.containers, selfCheckFallbacks: stats.selfCheckFallbacks,
      componentize: compStats,
      files: files.map((f) => path.relative(flags.cwd, f)),
    }));
  } else {
    io.out(`extract: ${stats.views} view(s) → ${path.relative(flags.cwd, combinedPath)} (${stats.nodes} nodes; layout: ${stats.containers.flex} flex / ${stats.containers.grid} grid / ${stats.containers.flow} flow / ${stats.containers.absolute} absolute; ${stats.selfCheckFallbacks} self-check fallback(s))`);
    for (const e of excluded) io.err(`extract: EXCLUDED ${e.page}#${e.view} — ${e.error}`);
  }
  return excluded.length === 0 ? EXIT.OK : EXIT.GATE_FAIL;
}

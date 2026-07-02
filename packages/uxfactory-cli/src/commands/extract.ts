/**
 * `uxfactory extract` — render the trace's (page,view) set with DOM capture and
 * emit the extracted semantic DesignSpec, self-gated by @uxfactory/spec validate().
 * Deterministic, LLM-free; the renderer is injectable for tests (SP3b §8).
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { validate } from "@uxfactory/spec";
import type { DesignSpec } from "@uxfactory/spec";
import { EXIT } from "../exit.js";
import { readRegistry } from "../batch/registry.js";
import { readTrace } from "../batch/trace.js";
import { renderHtml, type HtmlRenderDeps } from "../render/html-render.js";
import { extractDesignSpec, type ExtractedView } from "../extract/dom-to-designspec.js";
import type { IO } from "../io.js";

const DEFAULT_VIEWPORT = { width: 390, height: 844 };

export interface ExtractFlags {
  json?: boolean;
  dataDir: string;
  cwd: string;
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

  const previewDir = path.join(flags.dataDir, "batch", "previews");
  await mkdir(previewDir, { recursive: true });
  let snapshots;
  try {
    snapshots = await renderHtml(
      {
        baseDir: path.dirname(reg.inputs.trace), trace: traceResult.trace,
        previewDir, viewport: DEFAULT_VIEWPORT, captureDom: true,
      },
      deps,
    );
  } catch (err) {
    io.err(`extract: renderer unavailable — ${(err as Error).message}`);
    return EXIT.TRANSPORT;
  }

  const views: ExtractedView[] = [];
  const excluded: { page: string; view: string; error: string }[] = [];
  for (const s of snapshots) {
    if (s.ok && s.domTree !== undefined) {
      views.push({ page: s.page, view: s.view, viewport: s.viewport, tree: s.domTree });
    } else {
      excluded.push({ page: s.page, view: s.view, error: s.error ?? "no DOM tree captured" });
    }
  }

  const { spec, stats } = extractDesignSpec(views);
  const result = validate(spec);
  if (!result.valid) {
    const msg = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    if (flags.json === true) io.out(JSON.stringify({ ok: false, reason: "invalid-spec", errors: msg }));
    else io.err(`extract: assembled spec failed validation — ${msg}`);
    return EXIT.GATE_FAIL;
  }

  const outDir = path.join(flags.dataDir, "batch", "designspec");
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  const combinedPath = path.join(outDir, "design.designspec.json");
  await writeFile(combinedPath, JSON.stringify(spec, null, 2), "utf8");
  files.push(combinedPath);
  for (const frame of spec.frames) {
    const lastSlash = frame.name.lastIndexOf("/");
    const page = frame.name.slice(0, lastSlash);
    const view = frame.name.slice(lastSlash + 1);
    const single: DesignSpec = { frames: [{ ...frame, x: 0 }] };
    const file = path.join(outDir, `${path.basename(page, ".html")}-${view}.designspec.json`);
    await writeFile(file, JSON.stringify(single, null, 2), "utf8");
    files.push(file);
  }

  if (flags.json === true) {
    io.out(JSON.stringify({
      ok: excluded.length === 0, views: stats.views, excluded, nodes: stats.nodes,
      containers: stats.containers, selfCheckFallbacks: stats.selfCheckFallbacks,
      files: files.map((f) => path.relative(flags.cwd, f)),
    }));
  } else {
    io.out(`extract: ${stats.views} view(s) → ${path.relative(flags.cwd, combinedPath)} (${stats.nodes} nodes; layout: ${stats.containers.flex} flex / ${stats.containers.grid} grid / ${stats.containers.flow} flow / ${stats.containers.absolute} absolute; ${stats.selfCheckFallbacks} self-check fallback(s))`);
    for (const e of excluded) io.err(`extract: EXCLUDED ${e.page}#${e.view} — ${e.error}`);
  }
  return excluded.length === 0 ? EXIT.OK : EXIT.GATE_FAIL;
}

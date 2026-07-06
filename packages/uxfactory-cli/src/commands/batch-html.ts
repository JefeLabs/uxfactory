import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../exit.js";
import { loadFeaturesInput, loadStoriesInput, loadTokensInput } from "../batch/inputs.js";
import { readTrace } from "../batch/trace.js";
import { renderHtml, type HtmlRenderDeps } from "../render/html-render.js";
import { runHtmlBatch, typographyLimitsFrom, type TypographyLimits } from "../batch/html-checks.js";
import { resolveScope, checkReadiness, parseScope } from "../batch/scope.js";
import type { Dial, DialLevel, RenderScope } from "../batch/scope.js";
import type { ResolvedInputs, RegistryViewport } from "../batch/registry.js";
import type { StorySet, TokenSet } from "../batch/checks.js";
import type { BatchReport } from "../batch/run.js";
import type { IO } from "../io.js";
import type { BatchFlags } from "./batch.js";

const DEFAULT_VIEWPORT = { width: 390, height: 844 };
const VALID_DIAL_LEVELS = new Set(["low", "medium", "high"]);

/**
 * HTML-mode batch: render the trace's (page,view) set, run the pure HTML gate over the
 * snapshots, write report.json + screenshots, and return the loop-termination exit code.
 * The renderer is injectable (`deps`) so tests run without a browser.
 */
async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Typography limits from the design-system artifact (canonical, then legacy). */
async function readTypographyLimits(projectRoot: string): Promise<TypographyLimits | null> {
  for (const rel of [
    path.join(".uxfactory", "artifacts", "design-system.json"),
    path.join("design", "design-system.json"),
  ]) {
    try {
      const raw = await readFile(path.join(projectRoot, rel), "utf8");
      return typographyLimitsFrom(JSON.parse(raw));
    } catch {
      // missing/unparseable → try the next location
    }
  }
  return null;
}

export async function batchHtmlMode(
  specsDir: string,
  flags: BatchFlags,
  io: IO,
  inputs: ResolvedInputs,
  profileScope: RenderScope | undefined,
  registryScope: string | Record<string, unknown> | undefined,
  registryUnit: string | undefined,
  registryViewports: RegistryViewport[] | undefined,
  registryDesignStyle: string | undefined,
  deps?: HtmlRenderDeps,
  registryUngoverned?: boolean,
): Promise<number> {
  void specsDir; // HTML mode reads the screens dir from the registry, not the positional arg

  // Dial-flag validation (parity with batchCmd).
  for (const [name, val] of [["visual", flags.visual], ["editorial", flags.editorial], ["coverage", flags.coverage], ["flow", flags.flow]] as const) {
    if (val !== undefined && !VALID_DIAL_LEVELS.has(val)) {
      io.err(`invalid --${name} value: "${val}". Must be one of: low, medium, high.`);
      return EXIT.TRANSPORT;
    }
  }
  if (flags.scope !== undefined) {
    const c = parseScope(flags.scope);
    if (!c.ok) { io.err(c.message); return EXIT.TRANSPORT; }
  }
  const overrides: Partial<Record<Dial, DialLevel>> = {};
  if (flags.visual !== undefined) overrides.visual = flags.visual as DialLevel;
  if (flags.editorial !== undefined) overrides.editorial = flags.editorial as DialLevel;
  if (flags.coverage !== undefined) overrides.coverage = flags.coverage as DialLevel;
  if (flags.flow !== undefined) overrides.flow = flags.flow as DialLevel;
  const rawBase =
    flags.scope !== undefined ? flags.scope : profileScope !== undefined ? profileScope : registryScope;
  const scope = resolveScope(rawBase, overrides);
  if (scope === null) {
    if (flags.json === true) io.out(JSON.stringify({ ok: false, reason: "scope-unset", missing: [], declared: [] }));
    else io.err("set a render scope before requesting a batch.");
    return EXIT.TRANSPORT;
  }

  // Load registered inputs.
  const storiesResult = await loadStoriesInput(inputs.stories);
  if (storiesResult.state === "broken") { io.err(storiesResult.message); return EXIT.TRANSPORT; }
  const stories: StorySet | null = storiesResult.state === "ok" ? storiesResult.value : null;

  const featuresResult = await loadFeaturesInput(inputs.features);
  if (featuresResult.state === "broken") {
    io.err(featuresResult.message);
    return EXIT.TRANSPORT;
  }
  const features = featuresResult.state === "ok" ? featuresResult.value : null;

  const tokensResult = await loadTokensInput(inputs.tokens);
  if (tokensResult.state === "broken") { io.err(tokensResult.message); return EXIT.TRANSPORT; }
  const tokens: TokenSet | null = tokensResult.state === "ok" ? tokensResult.value : null;

  // Readiness: stories required at coverage≥low; tokens required at visual≥medium (HTML token-conformance).
  const readiness = checkReadiness(scope, { specs: inputs.screens !== null, stories: stories !== null, tokens: tokens !== null, flow: true });
  if (!readiness.ready) {
    if (flags.json === true) io.out(JSON.stringify({ ok: false, reason: "not-ready", missing: readiness.missing, declared: readiness.declared }));
    else { io.err("batch: readiness check failed — missing required artifacts:"); for (const m of readiness.missing) io.err(`  - ${m.artifact} (${m.dial}:${m.level}) — ${m.action}`); }
    return EXIT.TRANSPORT;
  }

  if (inputs.trace === null) { io.err("HTML mode requires inputs.trace"); return EXIT.TRANSPORT; }
  const traceResult = await readTrace(inputs.trace);
  if (!traceResult.ok) { io.err(traceResult.message); return EXIT.TRANSPORT; }

  // Render (async). A renderer failure is a setup error (2), never a silent pass.
  // Registry viewports (stamped by the worker) each get their own render pass and
  // preview subdirectory; absent → the legacy single default-viewport render.
  const targets: RegistryViewport[] =
    registryViewports !== undefined && registryViewports.length > 0
      ? registryViewports
      : [{ name: "default", ...DEFAULT_VIEWPORT }];
  const basePreviewDir = path.join(flags.dataDir, "batch", "previews");
  const snapshots = [];
  try {
    for (const vp of targets) {
      const previewDir =
        registryViewports !== undefined
          ? path.join(basePreviewDir, vp.name)
          : basePreviewDir;
      await mkdir(previewDir, { recursive: true });
      const snaps = await renderHtml(
        {
          baseDir: path.dirname(inputs.trace),
          trace: traceResult.trace,
          previewDir,
          viewport: { width: vp.width, height: vp.height },
        },
        deps,
      );
      snapshots.push(...snaps);
    }
  } catch (err) {
    io.err(`HTML renderer unavailable (install playwright + axe-core): ${(err as Error).message}`);
    return EXIT.TRANSPORT;
  }

  // System-artifact inputs: typography limits enable the advisory
  // typography-conformance check; a registered accessibility contract
  // escalates a11y/contrast to bound at any fidelity.
  const projectRoot = path.dirname(flags.dataDir);
  const typography = await readTypographyLimits(projectRoot);
  const a11ySpec = await fileExists(
    path.join(projectRoot, ".uxfactory", "artifacts", "accessibility.json"),
  );

  // Pure gate over the snapshots.
  const report: BatchReport = runHtmlBatch({
    snapshots,
    stories,
    features,
    tokens,
    scope,
    ...(registryUnit !== undefined ? { unit: registryUnit } : {}),
    ...(registryDesignStyle !== undefined ? { designStyle: registryDesignStyle } : {}),
    ...(typography !== null ? { typography } : {}),
    ...(a11ySpec ? { a11ySpec } : {}),
    ...(registryUngoverned === true ? { ungoverned: true } : {}),
  });

  const reportDoc = {
    screens: snapshots.map((s) =>
      targets.length > 1
        ? `${s.page} › ${s.view} @ ${s.viewport.width}×${s.viewport.height}`
        : `${s.page} › ${s.view}`,
    ),
    ...report,
  };
  await writeFile(path.join(flags.dataDir, "batch", "report.json"), JSON.stringify(reportDoc, null, 2), "utf8");
  if (flags.json === true) {
    io.out(JSON.stringify(reportDoc));
  } else {
    io.out(`batch: ${report.clean ? "clean" : "FAILED"} — ${snapshots.length} view(s) rendered`);
    for (const c of report.checks) {
      io.out(c.status === "skip" ? `  [${c.severity}] ${c.id}: ${c.status} (${c.reason ?? "no input"})` : `  [${c.severity}] ${c.id}: ${c.status}`);
      for (const f of c.findings) io.out(`    - ${f.detail}`);
    }
  }
  return report.mustPassFailed ? EXIT.GATE_FAIL : EXIT.OK;
}

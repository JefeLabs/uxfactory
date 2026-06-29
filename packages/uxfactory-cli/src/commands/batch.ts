import { readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { EXIT, TransportError } from "../exit.js";
import { loadSpec, printSpecProblem } from "../spec-file.js";
import { readRegistry } from "../batch/registry.js";
import { loadTokensInput, loadStoriesInput, loadFlowInput } from "../batch/inputs.js";
import { runBatch } from "../batch/run.js";
import { specToSvg } from "../render/svg.js";
import { rasterize } from "../render/raster-select.js";
import { resolveScope, checkReadiness, parseScope } from "../batch/scope.js";
import type { Dial, DialLevel } from "../batch/scope.js";
import type { LoadedSpec, TokenSet, StorySet, Flow } from "../batch/checks.js";
import type { BatchReport } from "../batch/run.js";
import type { Spec } from "@uxfactory/spec";
import type { IO } from "../io.js";
import type { BridgeClient } from "../client.js";

/** Flags for `uxfactory batch`. */
export interface BatchFlags {
  json?: boolean;
  stage?: boolean;
  dataDir: string;
  /** Repo root where uxfactory.batch.json + the design/ inputs live (default process.cwd()). */
  cwd?: string;
  /** `--scope <preset>` — runtime override of the registry scope base. */
  scope?: string;
  /** Per-dial runtime overrides — each must be low|medium|high. */
  visual?: string;
  editorial?: string;
  coverage?: string;
  flow?: string;
}

/** Valid values for a dial flag (not `none` — that is threshold-only). */
const VALID_DIAL_LEVELS = new Set(["low", "medium", "high"]);

/**
 * `uxfactory batch <dir>` — ONE deterministic, self-contained offline pass (§13).
 * Reads the registry, loads + validates the batch specs, loads the registered inputs
 * that exist (skip-and-declare absent), resolves the render scope (registry base +
 * flag overrides), enforces the readiness precondition (missing REQUESTED inputs →
 * exit 2 with a structured list), runs the scope-scoped gates, writes offline previews
 * (SVG + PNG via rasterize) + a report under `.uxfactory/batch/`, optionally stages a
 * clean batch to the bridge, and returns the loop-termination exit code:
 * 0 clean / 1 must-pass failed / 2 setup or transport.
 */
export async function batchCmd(
  specsDir: string,
  flags: BatchFlags,
  io: IO,
  client: BridgeClient,
): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();

  // 1. registry (absent/invalid → 2)
  const reg = await readRegistry(path.join(cwd, "uxfactory.batch.json"));
  if (!reg.ok) {
    io.err(reg.message);
    return EXIT.TRANSPORT;
  }

  // 2. load + validate the batch specs (invalid/unreadable → 2)
  let entries: string[];
  try {
    entries = (await readdir(specsDir)).filter((f) => f.endsWith(".uxfactory.json")).sort();
  } catch {
    io.err(`cannot read specs directory ${specsDir}`);
    return EXIT.TRANSPORT;
  }
  if (entries.length === 0) {
    io.err(`no *.uxfactory.json specs found in ${specsDir}`);
    return EXIT.TRANSPORT;
  }
  const specs: LoadedSpec[] = [];
  for (const name of entries) {
    const full = path.join(specsDir, name);
    const result = await loadSpec(full);
    if (!result.ok) return printSpecProblem(io, result, flags.json);
    specs.push({ file: name, spec: result.spec as Spec });
  }

  // 3. load the registered inputs that EXIST (absent → null = skip; registered-but-unreadable → 2)
  //    Uses the shared loader in batch/inputs.ts so shape checks stay in sync with review.
  let reuseSpecs: Spec[] | null = null;

  const tokensResult = await loadTokensInput(reg.inputs.tokens);
  if (tokensResult.state === "broken") {
    io.err(tokensResult.message);
    return EXIT.TRANSPORT;
  }
  const tokens: TokenSet | null = tokensResult.state === "ok" ? tokensResult.value : null;

  const storiesResult = await loadStoriesInput(reg.inputs.stories);
  if (storiesResult.state === "broken") {
    io.err(storiesResult.message);
    return EXIT.TRANSPORT;
  }
  const stories: StorySet | null = storiesResult.state === "ok" ? storiesResult.value : null;

  const flowResult = await loadFlowInput(reg.inputs.flow);
  if (flowResult.state === "broken") {
    io.err(flowResult.message);
    return EXIT.TRANSPORT;
  }
  const flowData: Flow | null = flowResult.state === "ok" ? flowResult.value : null;

  if (reg.inputs.reuse.length > 0) {
    reuseSpecs = [];
    for (const file of reg.inputs.reuse) {
      const result = await loadSpec(file);
      if (!result.ok) {
        io.err(`unreadable/invalid reuse spec: ${file}`);
        return EXIT.TRANSPORT;
      }
      reuseSpecs.push(result.spec as Spec);
    }
  }

  // 4. Validate per-dial flag values (must be low|medium|high; `none` is threshold-only)
  const dialEntries: [string, string | undefined][] = [
    ["visual", flags.visual],
    ["editorial", flags.editorial],
    ["coverage", flags.coverage],
    ["flow", flags.flow],
  ];
  for (const [name, val] of dialEntries) {
    if (val !== undefined && !VALID_DIAL_LEVELS.has(val)) {
      io.err(`invalid --${name} value: "${val}". Must be one of: low, medium, high.`);
      return EXIT.TRANSPORT;
    }
  }

  // 4a. Fix 3: Validate --scope flag BEFORE resolveScope — give a specific error for a bad
  //     preset name or invalid vector rather than the generic "set a render scope" message.
  if (flags.scope !== undefined) {
    const scopeCheck = parseScope(flags.scope);
    if (!scopeCheck.ok) {
      io.err(scopeCheck.message);
      return EXIT.TRANSPORT;
    }
  }

  // 5. Resolve render scope: CLI --scope flag (runtime) → registry.scope (committed) → null (unset)
  const overrides: Partial<Record<Dial, DialLevel>> = {};
  if (flags.visual !== undefined) overrides.visual = flags.visual as DialLevel;
  if (flags.editorial !== undefined) overrides.editorial = flags.editorial as DialLevel;
  if (flags.coverage !== undefined) overrides.coverage = flags.coverage as DialLevel;
  if (flags.flow !== undefined) overrides.flow = flags.flow as DialLevel;

  const rawBase: string | Record<string, unknown> | undefined =
    flags.scope !== undefined ? flags.scope : reg.registry.scope;

  const scope = resolveScope(rawBase, overrides);
  if (scope === null) {
    // Fix 2: structured JSON output in --json mode; human text to stderr otherwise.
    // This path is the genuinely-undefined case: no --scope flag AND no registry scope
    // (invalid --scope is caught above in step 4a before reaching here).
    if (flags.json === true) {
      io.out(JSON.stringify({ ok: false, reason: "scope-unset", missing: [], declared: [] }));
    } else {
      io.err("set a render scope before requesting a batch.");
    }
    return EXIT.TRANSPORT;
  }

  // 6. Readiness precondition: every REQUESTED input of binding gates must be present.
  const readiness = checkReadiness(scope, {
    specs: true, // always true — specs are verified above before reaching this point
    stories: stories !== null,
    tokens: tokens !== null,
    flow: flowData !== null,
  });
  if (!readiness.ready) {
    // Fix 2: structured JSON output in --json mode; human text to stderr otherwise.
    if (flags.json === true) {
      io.out(
        JSON.stringify({
          ok: false,
          reason: "not-ready",
          missing: readiness.missing,
          declared: readiness.declared,
        }),
      );
    } else {
      io.err("batch: readiness check failed — missing required artifacts:");
      for (const m of readiness.missing) {
        io.err(`  - ${m.artifact} (${m.dial}:${m.level}) — ${m.action}`);
      }
    }
    return EXIT.TRANSPORT;
  }

  // 7. ONE deterministic scope-scoped pass
  const report: BatchReport = runBatch({
    specs,
    tokens,
    stories,
    reuseSpecs,
    flow: flowData,
    scope,
  });

  // 8. offline previews per spec (§13.6) — SVG + PNG via renderer-by-visual-dial
  const batchDir = path.join(flags.dataDir, "batch");
  const previewDir = path.join(batchDir, "previews");
  await mkdir(previewDir, { recursive: true });
  const previews = new Map<string, string>();
  const rasterizeNotes: string[] = [];
  for (const s of specs) {
    const svg = specToSvg(s.spec);
    previews.set(s.file, svg);
    const baseName = s.file.replace(/\.[^.]+$/, "");
    await writeFile(path.join(previewDir, baseName + ".svg"), svg, "utf8");

    // Rasterize to PNG: resvg at visual:low; Playwright at visual≥medium (fallback to resvg).
    const { png, note } = await rasterize(svg, scope.visual);
    await writeFile(path.join(previewDir, baseName + ".png"), png);
    if (note !== undefined) rasterizeNotes.push(note);
  }

  // 9. report.json + summary
  const reportDoc = {
    specs: specs.map((s) => s.file),
    ...report,
    ...(rasterizeNotes.length > 0 ? { rasterizeNotes } : {}),
  };
  await writeFile(path.join(batchDir, "report.json"), JSON.stringify(reportDoc, null, 2), "utf8");
  if (flags.json === true) {
    io.out(JSON.stringify(reportDoc));
  } else {
    io.out(`batch: ${report.clean ? "clean" : "FAILED"} — ${specs.length} spec(s)`);
    for (const c of report.checks) {
      const tag = `[${c.severity}] ${c.id}: ${c.status}`;
      io.out(c.status === "skip" ? `  ${tag} (${c.reason ?? "no input"})` : `  ${tag}`);
      for (const f of c.findings) io.out(`    - ${f.detail}`);
    }
  }

  // 10. stage a clean batch to the bridge (bridge error → 2)
  if (flags.stage === true && report.clean) {
    try {
      const { batchId } = await client.postBatch(
        specs.map((s) => ({ spec: s.spec, preview: previews.get(s.file) })),
      );
      io.out(`staged batch ${batchId} for approval`);
    } catch (err) {
      if (err instanceof TransportError) {
        io.err(err.message);
        return EXIT.TRANSPORT;
      }
      throw err;
    }
  }

  // 11. loop-termination exit code
  return report.mustPassFailed ? EXIT.GATE_FAIL : EXIT.OK;
}

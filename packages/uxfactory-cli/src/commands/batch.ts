import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { EXIT, TransportError } from "../exit.js";
import { loadSpec, printSpecProblem } from "../spec-file.js";
import { readRegistry } from "../batch/registry.js";
import { runBatch } from "../batch/run.js";
import { specToSvg } from "../render/svg.js";
import type { LoadedSpec, TokenSet, StorySet, Flow } from "../batch/checks.js";
import type { BatchReport } from "../batch/run.js";
import type { Spec } from "@uxfactory/spec";
import { PRESETS } from "../batch/scope.js";
import type { IO } from "../io.js";
import type { BridgeClient } from "../client.js";

/** Flags for `uxfactory batch`. */
export interface BatchFlags {
  json?: boolean;
  stage?: boolean;
  dataDir: string;
  /** Repo root where uxfactory.batch.json + the design/ inputs live (default process.cwd()). */
  cwd?: string;
}

/** Read + JSON-parse a registered input; throws on any failure (→ setup error). */
async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/**
 * `uxfactory batch <dir>` — ONE deterministic, self-contained offline pass (§13).
 * Reads the registry, loads + validates the batch specs, loads the registered inputs
 * that exist (skip-and-declare absent), runs the gates, writes offline previews + a
 * report under `.uxfactory/batch/`, optionally stages a clean batch to the bridge, and
 * returns the loop-termination exit code: 0 clean / 1 must-pass failed / 2 setup or transport.
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
  let tokens: TokenSet | null = null;
  let stories: StorySet | null = null;
  let flow: Flow | null = null;
  let reuseSpecs: Spec[] | null = null;
  try {
    if (reg.inputs.tokens !== null) {
      tokens = await readJson<TokenSet>(reg.inputs.tokens);
      // Fix 5: light shape check — malformed tokens.ds.json → exit 2
      if (
        tokens.colors === null ||
        typeof tokens.colors !== "object" ||
        Array.isArray(tokens.colors)
      ) {
        io.err(
          `malformed tokens file: "colors" must be an object (got ${JSON.stringify(typeof tokens.colors)})`,
        );
        return EXIT.TRANSPORT;
      }
    }
    if (reg.inputs.stories !== null) {
      stories = await readJson<StorySet>(reg.inputs.stories);
      // Fix 5: light shape check — malformed stories.json → exit 2
      if (!Array.isArray(stories.stories)) {
        io.err(
          `malformed stories file: "stories" must be an array (got ${JSON.stringify(typeof stories.stories)})`,
        );
        return EXIT.TRANSPORT;
      }
    }
    if (reg.inputs.flow !== null) flow = await readJson<Flow>(reg.inputs.flow);
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
  } catch (err) {
    io.err(`cannot read a registered input: ${(err as Error).message}`);
    return EXIT.TRANSPORT;
  }

  // 4. ONE deterministic pass
  // TODO(Task 3): resolve scope from registry + CLI flags; use interactive as a transitional
  // fallback so all gates bind (preserving existing gate behavior) until scope is wired.
  const report: BatchReport = runBatch({ specs, tokens, stories, reuseSpecs, flow, scope: PRESETS.interactive });

  // 5. offline previews per spec (§13.6)
  const batchDir = path.join(flags.dataDir, "batch");
  const previewDir = path.join(batchDir, "previews");
  await mkdir(previewDir, { recursive: true });
  const previews = new Map<string, string>();
  for (const s of specs) {
    const svg = specToSvg(s.spec);
    previews.set(s.file, svg);
    const out = s.file.replace(/\.[^.]+$/, "") + ".svg";
    await writeFile(path.join(previewDir, out), svg, "utf8");
  }

  // 6. report.json + summary
  const reportDoc = { specs: specs.map((s) => s.file), ...report };
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

  // 7. stage a clean batch to the bridge (bridge error → 2)
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

  // 8. loop-termination exit code
  return report.mustPassFailed ? EXIT.GATE_FAIL : EXIT.OK;
}

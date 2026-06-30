import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../exit.js";
import type { IO } from "../io.js";
import { readRegistry } from "../batch/registry.js";
import { loadStoriesInput } from "../batch/inputs.js";
import { scaffoldSpecs } from "../batch/scaffold-specs.js";

/** Flags for `uxfactory generate-specs`. */
export interface GenerateSpecsFlags {
  json?: boolean;
  /** Overwrite an existing same-named spec file instead of skipping it. */
  force?: boolean;
  /** Repo root where uxfactory.batch.json + the design/ inputs live (default process.cwd()). */
  cwd?: string;
}

/** True when `p` exists and is accessible. */
async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * `uxfactory generate-specs [dir]` — deterministically scaffold `*.uxfactory.json`
 * specs that cover the registered stories so the `batch`/`gate` requirement-coverage
 * check passes GREEN. NO LLM — pure, derived from the stories.
 *
 * Stories source: `inputs.stories` from `uxfactory.batch.json` when that registry
 * exists; otherwise `<dir>/acceptance-criteria.json`. Each story yields one spec
 * written to `<dir>/<sanitized-id>.uxfactory.json`. An existing same-named file is
 * SKIPPED (a user may have authored a real spec) unless `--force` is set.
 *
 * `--json` emits `{ written: string[], skipped: string[] }`.
 * Exit 0 on success; absent/invalid stories → EXIT.TRANSPORT (2) via io.err.
 */
export async function generateSpecsCmd(
  dir: string,
  flags: GenerateSpecsFlags,
  io: IO,
): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const designDir = path.resolve(cwd, dir);

  // Resolve the stories path: registry inputs.stories when a registry exists,
  // else the conventional <dir>/acceptance-criteria.json.
  let storiesPath: string | null = null;
  const registryPath = path.join(cwd, "uxfactory.batch.json");
  if (await fileExists(registryPath)) {
    const reg = await readRegistry(registryPath);
    if (!reg.ok) {
      io.err(reg.message);
      return EXIT.TRANSPORT;
    }
    storiesPath = reg.inputs.stories;
  }
  if (storiesPath === null) {
    storiesPath = path.join(designDir, "acceptance-criteria.json");
  }

  // Load + shape-validate the stories (absent/unreadable/invalid → setup error).
  const storiesResult = await loadStoriesInput(storiesPath);
  if (storiesResult.state !== "ok") {
    io.err(
      storiesResult.state === "broken"
        ? storiesResult.message
        : `no stories input found at ${storiesPath}`,
    );
    return EXIT.TRANSPORT;
  }
  const stories = storiesResult.value.stories;
  if (stories.length === 0) {
    io.err(`no stories to scaffold in ${storiesPath}`);
    return EXIT.TRANSPORT;
  }

  // Scaffold + write (non-clobbering unless --force).
  await mkdir(designDir, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  for (const { fileName, spec } of scaffoldSpecs(stories)) {
    const target = path.join(designDir, fileName);
    if (flags.force !== true && (await fileExists(target))) {
      skipped.push(fileName);
      continue;
    }
    await writeFile(target, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
    written.push(fileName);
  }

  if (flags.json === true) {
    io.out(JSON.stringify({ written, skipped }));
  } else {
    io.out(`generate-specs: wrote ${written.length} spec(s), skipped ${skipped.length}`);
  }
  return EXIT.OK;
}

/**
 * worker-entry — locate the private worker package the CLI spawns, and map CLI
 * flags onto the worker's env contract (spec 2026-07-09-worker-cli-supervision).
 *
 * The worker (clients/uxfactory-worker) is source-first with @helmsmith link
 * deps — the published CLI can never import it, only spawn `tsx src/main.ts`
 * from a uxfactory checkout. Resolution: UXFACTORY_WORKER_ENTRY override, else
 * walk up from THIS module's real location to the checkout root (the directory
 * containing both packages/uxfactory-cli and clients/uxfactory-worker).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkerEntry {
  tsxBin: string;
  mainTs: string;
}

export const WORKER_ENTRY_HELP =
  "worker entry not found — the worker runs from a uxfactory checkout; " +
  "set UXFACTORY_WORKER_ENTRY=<path-to-clients/uxfactory-worker> or run the CLI from the repo";

/** Both entry files present under `dir`, or null. */
function fromDir(dir: string, fileExists: (p: string) => boolean): WorkerEntry | null {
  const mainTs = path.join(dir, "src", "main.ts");
  const tsxBin = path.join(dir, "node_modules", ".bin", "tsx");
  return fileExists(mainTs) && fileExists(tsxBin) ? { tsxBin, mainTs } : null;
}

export function resolveWorkerEntry(
  cliModuleUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (p: string) => boolean = existsSync,
): WorkerEntry | null {
  const override = env["UXFACTORY_WORKER_ENTRY"];
  // An explicit override must be honored or fail — never silently fall back.
  if (override !== undefined && override.trim() !== "") {
    return fromDir(path.resolve(override), fileExists);
  }
  let dir = path.dirname(fileURLToPath(cliModuleUrl));
  for (let i = 0; i < 8; i += 1) {
    if (
      fileExists(path.join(dir, "packages", "uxfactory-cli")) &&
      fileExists(path.join(dir, "clients", "uxfactory-worker"))
    ) {
      return fromDir(path.join(dir, "clients", "uxfactory-worker"), fileExists);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Same project-root rule as the bridge (roots.ts): .git or uxfactory.batch.json. */
export function isProjectRootDir(
  dir: string,
  fileExists: (p: string) => boolean = existsSync,
): boolean {
  return (
    fileExists(path.join(dir, ".git")) || fileExists(path.join(dir, "uxfactory.batch.json"))
  );
}

/** Overlay flag-derived vars on `base`; UXFACTORY_CLI_BIN only when unset. */
export function workerEnv(
  flags: { bridge?: string; model?: string; kinds?: string; pool?: string; debug?: boolean },
  base: NodeJS.ProcessEnv,
  cliBinPath: string,
): NodeJS.ProcessEnv {
  return {
    ...base,
    ...(flags.bridge !== undefined ? { UXFACTORY_BRIDGE: flags.bridge } : {}),
    ...(flags.model !== undefined ? { UXFACTORY_WORKER_MODEL: flags.model } : {}),
    ...(flags.kinds !== undefined ? { UXFACTORY_WORKER_KINDS: flags.kinds } : {}),
    ...(flags.pool !== undefined ? { UXFACTORY_WORKER_POOL: flags.pool } : {}),
    ...(flags.debug === true ? { UXFACTORY_WORKER_DEBUG: "1" } : {}),
    ...(base["UXFACTORY_CLI_BIN"] === undefined ? { UXFACTORY_CLI_BIN: cliBinPath } : {}),
  };
}

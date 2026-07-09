/**
 * `uxfactory worker` — run a generation worker for ONE project root in the
 * foreground (spec 2026-07-09-worker-cli-supervision §2). The worker claims
 * only jobs whose root equals its cwd, so the verb's whole job is: resolve the
 * worker entry, validate the root, spawn tsx with the mapped env, and pass the
 * child's exit code through.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import { EXIT } from "../exit.js";
import type { IO } from "../io.js";
import {
  resolveWorkerEntry,
  isProjectRootDir,
  workerEnv,
  WORKER_ENTRY_HELP,
} from "../worker-entry.js";

export interface WorkerCmdFlags {
  root?: string;
  model?: string;
  kinds?: string;
  pool?: string;
  bridge?: string;
  debug?: boolean;
}

/** Minimal child surface the command needs (satisfied by ChildProcess). */
interface SpawnedChild {
  on(event: "error", cb: (err: Error) => void): unknown;
  on(event: "close", cb: (code: number | null) => void): unknown;
}

export interface WorkerCmdDeps {
  spawn?: (bin: string, args: string[], opts: SpawnOptions) => SpawnedChild;
  cliModuleUrl?: string;
  cliBinPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fileExists?: (p: string) => boolean;
}

export async function workerCmd(
  flags: WorkerCmdFlags,
  io: IO,
  deps: WorkerCmdDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const fileExists = deps.fileExists ?? existsSync;
  const root = path.resolve(flags.root ?? deps.cwd ?? process.cwd());

  if (!isProjectRootDir(root, fileExists)) {
    io.err(`not a project root (needs .git or uxfactory.batch.json): ${root}`);
    return EXIT.TRANSPORT;
  }

  const entry = resolveWorkerEntry(deps.cliModuleUrl ?? import.meta.url, env, fileExists);
  if (entry === null) {
    io.err(WORKER_ENTRY_HELP);
    return EXIT.TRANSPORT;
  }

  const spawn = deps.spawn ?? (nodeSpawn as unknown as NonNullable<WorkerCmdDeps["spawn"]>);
  const cliBin = deps.cliBinPath ?? path.resolve(process.argv[1] ?? "uxfactory");
  const child = spawn(entry.tsxBin, [entry.mainTs], {
    cwd: root,
    stdio: "inherit",
    env: workerEnv(flags, env, cliBin),
  });

  return await new Promise<number>((resolve) => {
    child.on("error", (err: Error) => {
      io.err(`spawn failed: ${err.message}`);
      resolve(EXIT.TRANSPORT);
    });
    // A signal-killed child reports code null → setup/transport (2).
    child.on("close", (code: number | null) => resolve(code ?? EXIT.TRANSPORT));
  });
}

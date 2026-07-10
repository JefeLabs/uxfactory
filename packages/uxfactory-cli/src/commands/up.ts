/**
 * `uxfactory up` — the on-demand supervised stack (spec
 * 2026-07-09-worker-cli-supervision §3): bridge in-process, workers spawned
 * only when a job is enqueued for their root, reaped after an idle timeout.
 * Connecting a root (launch root at startup, or a panel's
 * POST /project/connect) only marks it *managed* — it does not spawn a
 * worker — so panels see it advertised via managedRoots() without a
 * worker actually running until a job shows up.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { EXIT } from "../exit.js";
import type { IO } from "../io.js";
import { resolveWorkerEntry, workerEnv, WORKER_ENTRY_HELP } from "../worker-entry.js";
import { WorkerSupervisor } from "../worker-supervisor.js";
import type { SupervisedChild } from "../worker-supervisor.js";

export interface UpCmdFlags {
  port?: number;
  dataDir: string;
  model?: string;
  kinds?: string;
  pool?: string;
  debug?: boolean;
  idleMinutes?: number;
}

interface BridgeHandle {
  url: string;
  close: () => Promise<void>;
}

export interface UpCmdDeps {
  startBridge?: (opts: {
    port?: number;
    dataDir: string;
    onRootServed: (root: string) => void;
    onRequestEnqueued: (root: string, kind: string) => void;
    onRequestClaimed: (root: string, kind: string) => void;
    onRequestSettled: (root: string) => void;
    managedRoots: () => { root: string; kinds?: string[] }[];
  }) => Promise<BridgeHandle>;
  spawn?: typeof nodeSpawn;
  cliModuleUrl?: string;
  cliBinPath?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (p: string) => boolean;
  /** Signal registration seam (default process.on) so tests never trap signals. */
  onSignal?: (sig: "SIGINT" | "SIGTERM", cb: () => void) => void;
}

/** Re-emit a child stream line-by-line with the worker's root prefix. */
function prefixStream(
  stream: NodeJS.ReadableStream | null | undefined,
  prefix: string,
  log: (line: string) => void,
): void {
  if (stream === null || stream === undefined) return;
  let buf = "";
  let flushed = false;
  // A crashing child's last line often has no trailing newline — flush the
  // residual buffer once the stream ends, guarding against double-flush from
  // "end" and "close" both firing for the same stream.
  const flush = (): void => {
    if (flushed) return;
    flushed = true;
    if (buf.trim() !== "") log(`${prefix} ${buf}`);
    buf = "";
  };
  stream.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim() !== "") log(`${prefix} ${line}`);
    }
  });
  stream.on("end", flush);
  stream.on("close", flush);
}

export async function upCmd(
  flags: UpCmdFlags,
  io: IO,
  deps: UpCmdDeps = {},
): Promise<{ code: number; close?: () => Promise<void> }> {
  const env = deps.env ?? process.env;
  const fileExists = deps.fileExists ?? existsSync;

  // --idle abc parses to NaN, and setTimeout(fn, NaN) fires immediately — an
  // invalid value must fail loudly, not reap every worker instantly.
  if (
    flags.idleMinutes !== undefined &&
    (!Number.isFinite(flags.idleMinutes) || flags.idleMinutes < 0)
  ) {
    io.err("invalid --idle value: must be a non-negative number of minutes");
    return { code: EXIT.TRANSPORT };
  }

  // Fail fast: no worker entry means up cannot deliver its promise at all.
  const entry = resolveWorkerEntry(deps.cliModuleUrl ?? import.meta.url, env, fileExists);
  if (entry === null) {
    io.err(WORKER_ENTRY_HELP);
    return { code: EXIT.TRANSPORT };
  }

  const spawn = deps.spawn ?? nodeSpawn;
  const cliBin = deps.cliBinPath ?? path.resolve(process.argv[1] ?? "uxfactory");
  const launchRoot = path.dirname(path.resolve(flags.dataDir));

  const idleMinutes = flags.idleMinutes ?? 10;
  const spawnKinds =
    flags.kinds !== undefined
      ? flags.kinds.split(",").map((k) => k.trim()).filter((k) => k !== "")
      : undefined;

  // Set once startBridge resolves below; captured by reference so spawnWorker
  // (called later, per connected root) always sees the actual bridge URL
  // instead of workerEnv's :3779 default (up may be running on --port 4000).
  let bridgeUrl: string | null = null;

  const supervisor = new WorkerSupervisor({
    spawnWorker: (root): SupervisedChild => {
      const child = spawn(entry.tsxBin, [entry.mainTs], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: workerEnv(
          { ...flags, ...(bridgeUrl !== null ? { bridge: bridgeUrl } : {}) },
          env,
          cliBin,
        ),
      }) as ChildProcess;
      const prefix = `[worker ${path.basename(root)}]`;
      prefixStream(child.stdout, prefix, io.err);
      prefixStream(child.stderr, prefix, io.err);
      return child as unknown as SupervisedChild;
    },
    log: io.err,
    idleMs: idleMinutes * 60_000,
    ...(spawnKinds !== undefined ? { spawnKinds } : {}),
  });

  const startBridge =
    deps.startBridge ??
    (async (opts: {
      port?: number;
      dataDir: string;
      onRootServed: (root: string) => void;
      onRequestEnqueued: (root: string, kind: string) => void;
      onRequestClaimed: (root: string, kind: string) => void;
      onRequestSettled: (root: string) => void;
      managedRoots: () => { root: string; kinds?: string[] }[];
    }) => {
      const bridge = await import("@uxfactory/bridge");
      return bridge.startBridge(opts);
    });

  let handle: BridgeHandle;
  try {
    handle = await startBridge({
      ...(flags.port !== undefined ? { port: flags.port } : {}),
      dataDir: flags.dataDir,
      onRootServed: (root) => supervisor.trackManaged(root),
      onRequestEnqueued: (root) => supervisor.jobEnqueued(root),
      onRequestClaimed: (root) => supervisor.jobClaimed(root),
      onRequestSettled: (root) => supervisor.jobSettled(root),
      managedRoots: () => supervisor.managedRoots(),
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "EADDRINUSE") {
      const port = flags.port ?? Number(env["UXFACTORY_PORT"] ?? 3779);
      io.err(`bridge already running on :${port} — add a worker to it with 'uxfactory worker'`);
      return { code: EXIT.TRANSPORT };
    }
    throw err;
  }

  bridgeUrl = handle.url;
  io.out(`uxfactory up: bridge ${handle.url}`);
  supervisor.trackManaged(launchRoot);

  const shutdown = async (): Promise<void> => {
    supervisor.stop();
    await handle.close();
  };
  const onSignal = deps.onSignal ?? ((sig, cb) => process.on(sig, cb));
  onSignal("SIGINT", () => void shutdown().then(() => process.exit(EXIT.OK)));
  onSignal("SIGTERM", () => void shutdown().then(() => process.exit(EXIT.OK)));

  return { code: EXIT.OK, close: shutdown };
}

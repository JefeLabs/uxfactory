/**
 * WorkerSupervisor — one worker child per project root, restart-on-crash
 * (spec 2026-07-09-worker-cli-supervision §3).
 *
 * Policy: exit code 2 is a DETERMINISTIC setup failure (missing agent auth,
 * bad runtime) — restarting on a timer would crash-loop against a missing
 * credential, so the root is marked failed and retried ONCE per subsequent
 * ensure() (a fresh panel connect is a user signal that something changed).
 * Any other exit is a crash: restart with exponential backoff 1s→30s, counter
 * reset after 60s of stable uptime. Spawning/clock/timers are injected so the
 * whole state machine is unit-testable without processes.
 */

export interface SupervisedChild {
  on(event: "close", cb: (code: number | null) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  kill(signal?: string): unknown;
}

export interface SupervisorDeps {
  /** Spawn a worker for `root` (cwd, env, and output prefixing pre-bound by the caller). */
  spawnWorker(root: string): SupervisedChild;
  log(line: string): void;
  now?(): number;
  schedule?(fn: () => void, ms: number): unknown;
  cancel?(handle: unknown): void;
  /** Reap a root's worker after this long with zero outstanding jobs. 0/absent = never. */
  idleMs?: number;
  /** Kinds the spawned workers claim (from `up --kinds`); attached to managedRoots(). */
  spawnKinds?: string[];
}

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 30_000;
export const STABLE_RESET_MS = 60_000;

interface Entry {
  child: SupervisedChild | null;
  restarts: number;
  lastStartAt: number;
  failed: boolean;
  pendingRestart: unknown | null;
  reaping: boolean;
}

export class WorkerSupervisor {
  private readonly entries = new Map<string, Entry>();
  private stopped = false;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly outstanding = new Map<string, number>();
  private readonly idleTimers = new Map<string, unknown>();
  private readonly managed = new Set<string>();

  constructor(private readonly deps: SupervisorDeps) {
    this.now = deps.now ?? Date.now;
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = deps.cancel ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  }

  /** Idempotent: running root → no-op; failed root → one retry; else spawn. */
  ensure(root: string): void {
    if (this.stopped) return;
    const entry = this.entries.get(root);
    if (entry?.child !== null && entry?.child !== undefined) return;
    if (entry?.pendingRestart !== null && entry?.pendingRestart !== undefined) return;
    if (entry !== undefined) entry.failed = false; // a fresh ensure retries a failed root once
    this.start(root);
  }

  private start(root: string): void {
    const prev = this.entries.get(root);
    const entry: Entry = {
      child: null,
      restarts: prev?.restarts ?? 0,
      lastStartAt: this.now(),
      failed: false,
      pendingRestart: null,
      reaping: false,
    };
    this.entries.set(root, entry);
    const child = this.deps.spawnWorker(root);
    entry.child = child;
    // A spawn/runtime failure can emit BOTH "error" and "close" for the same
    // underlying failure (common: post-spawn ENOENT/EMFILE). `settled` ensures
    // whichever fires first drives exactly one restart decision.
    let settled = false;
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      this.onExit(root, code);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      this.onError(root, err);
    });
  }

  private onExit(root: string, code: number | null): void {
    if (this.stopped) return;
    const entry = this.entries.get(root);
    if (entry === undefined) return;
    entry.child = null;

    if (entry.reaping) {
      entry.reaping = false;
      entry.restarts = 0; // a reap is a clean lifecycle end, not a crash
      this.deps.log(`worker for ${root} reaped after idle`);
      // A job that arrived mid-reap (SIGTERM → exit window) respawns exactly once.
      if ((this.outstanding.get(root) ?? 0) > 0) this.start(root);
      return;
    }

    if (code === 2) {
      entry.failed = true;
      this.deps.log(
        `worker for ${root} exited with a setup error (code 2) — not restarting; ` +
          `fix the cause (e.g. ~/.agentx/auth.json) and reconnect the project to retry`,
      );
      return;
    }

    this.scheduleRestart(
      root,
      entry,
      (delay) => `worker for ${root} exited (code ${String(code)}) — restarting in ${delay}ms`,
    );
  }

  /** A spawn-time or runtime "error" event (deleted root, EMFILE, missing tsx, …). */
  private onError(root: string, err: Error): void {
    if (this.stopped) return;
    const entry = this.entries.get(root);
    if (entry === undefined) return;
    entry.child = null;

    if (entry.reaping) {
      entry.reaping = false;
      entry.restarts = 0; // a reap is a clean lifecycle end, not a crash
      this.deps.log(`worker for ${root} reaped after idle`);
      // A job that arrived mid-reap (SIGTERM → exit window) respawns exactly once.
      if ((this.outstanding.get(root) ?? 0) > 0) this.start(root);
      return;
    }

    // Treated the same as a non-2 exit: not a deterministic setup failure,
    // so it's worth retrying with backoff rather than giving up.
    this.scheduleRestart(
      root,
      entry,
      (delay) => `worker for ${root} spawn/runtime error: ${err.message} — restarting in ${delay}ms`,
    );
  }

  /** Shared backoff bookkeeping + restart scheduling for onExit/onError. */
  private scheduleRestart(root: string, entry: Entry, message: (delay: number) => string): void {
    // Stable run resets the backoff counter before computing the next delay.
    if (this.now() - entry.lastStartAt >= STABLE_RESET_MS) entry.restarts = 0;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** entry.restarts, BACKOFF_CAP_MS);
    entry.restarts += 1;
    this.deps.log(message(delay));
    entry.pendingRestart = this.schedule(() => {
      entry.pendingRestart = null;
      if (!this.stopped) this.start(root);
    }, delay);
  }

  /** Kill children, cancel pending restarts, refuse further ensures. */
  stop(): void {
    this.stopped = true;
    for (const entry of this.entries.values()) {
      if (entry.pendingRestart !== null) this.cancel(entry.pendingRestart);
      entry.pendingRestart = null;
      entry.child?.kill("SIGTERM");
    }
    for (const timer of this.idleTimers.values()) this.cancel(timer);
    this.idleTimers.clear();
  }

  /** Register a root as supervisor-managed (jobs for it will spawn a worker). */
  trackManaged(root: string): void {
    this.managed.add(root);
  }

  /** The managed set, each entry carrying the supervisor-wide spawn kinds. */
  managedRoots(): { root: string; kinds?: string[] }[] {
    const kinds = this.deps.spawnKinds;
    return [...this.managed].map((root) => ({
      root,
      ...(kinds !== undefined ? { kinds } : {}),
    }));
  }

  /** A job was enqueued for `root`: cancel any pending reap, count it, ensure a worker. */
  jobEnqueued(root: string): void {
    if (this.stopped) return;
    this.trackManaged(root);
    const idle = this.idleTimers.get(root);
    if (idle !== undefined) {
      this.cancel(idle);
      this.idleTimers.delete(root);
    }
    this.outstanding.set(root, (this.outstanding.get(root) ?? 0) + 1);
    this.ensure(root);
  }

  /** A job for `root` settled: at zero outstanding, start the idle clock. */
  jobSettled(root: string): void {
    if (this.stopped) return;
    const next = Math.max(0, (this.outstanding.get(root) ?? 0) - 1);
    this.outstanding.set(root, next);
    const idleMs = this.deps.idleMs ?? 0;
    if (next !== 0 || idleMs <= 0) return;
    const entry = this.entries.get(root);
    if (entry?.child === null || entry?.child === undefined) return;
    const existing = this.idleTimers.get(root);
    if (existing !== undefined) this.cancel(existing);
    this.idleTimers.set(
      root,
      this.schedule(() => {
        this.idleTimers.delete(root);
        if ((this.outstanding.get(root) ?? 0) === 0) this.reap(root);
      }, idleMs),
    );
  }

  /** SIGTERM an idle worker; its exit is handled as a clean reap, not a crash. */
  private reap(root: string): void {
    if (this.stopped) return;
    const entry = this.entries.get(root);
    if (entry?.child === null || entry?.child === undefined) return;
    entry.reaping = true;
    entry.child.kill("SIGTERM");
  }
}

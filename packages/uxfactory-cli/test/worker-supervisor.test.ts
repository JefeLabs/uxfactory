import { describe, it, expect } from "vitest";
import { WorkerSupervisor, BACKOFF_CAP_MS } from "../src/worker-supervisor.js";
import type { SupervisedChild, SupervisorDeps } from "../src/worker-supervisor.js";

/** Deterministic harness: manual clock, captured timers, scripted children. */
function harness(extra: Partial<SupervisorDeps> = {}): {
  deps: SupervisorDeps;
  spawns: string[];
  children: Array<{ close(code: number | null): void; error(err: Error): void; killed: string[] }>;
  timers: Array<{ fn: () => void; ms: number; cancelled: boolean }>;
  logs: string[];
  tick(ms: number): void;
} {
  let clock = 0;
  const spawns: string[] = [];
  const children: Array<{ close(code: number | null): void; error(err: Error): void; killed: string[] }> = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const logs: string[] = [];
  const deps: SupervisorDeps = {
    spawnWorker(root) {
      spawns.push(root);
      let onClose: ((code: number | null) => void) | null = null;
      let onError: ((err: Error) => void) | null = null;
      const killed: string[] = [];
      const child: SupervisedChild = {
        on(event, cb) {
          if (event === "close") onClose = cb as (code: number | null) => void;
          else onError = cb as (err: Error) => void;
          return child;
        },
        kill(signal) {
          killed.push(signal ?? "SIGTERM");
          return true;
        },
      };
      children.push({
        close: (code) => onClose?.(code),
        error: (err) => onError?.(err),
        killed,
      });
      return child;
    },
    log: (line) => logs.push(line),
    now: () => clock,
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return t;
    },
    cancel: (handle) => {
      (handle as { cancelled: boolean }).cancelled = true;
    },
    ...extra,
  };
  return {
    deps, spawns, children, timers, logs,
    tick(ms) {
      clock += ms;
      for (const t of timers.splice(0)) if (!t.cancelled) t.fn();
    },
  };
}

describe("WorkerSupervisor", () => {
  it("ensure spawns once per root; running root is a no-op", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    sup.ensure("/a");
    sup.ensure("/b");
    expect(h.spawns).toEqual(["/a", "/b"]);
  });

  it("crash → restarts with exponential backoff 1s, 2s, 4s … capped at 30s", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    const delays: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      h.children[h.children.length - 1]!.close(1); // crash immediately (0ms uptime)
      delays.push(h.timers[h.timers.length - 1]!.ms);
      h.tick(0); // fire the pending restart without advancing stability clock
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(delays[5]).toBe(BACKOFF_CAP_MS);
  });

  it("a run surviving 60s resets the backoff counter", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    h.children[0]!.close(1);
    expect(h.timers[0]!.ms).toBe(1000);
    h.tick(0); // restart #1
    h.tick(60_000); // stable for 60s
    h.children[1]!.close(1); // then crashes
    expect(h.timers[h.timers.length - 1]!.ms).toBe(1000); // reset, not 2000
  });

  it("exit 2 marks the root failed: no timer restart, but a later ensure retries once", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    h.children[0]!.close(2);
    expect(h.timers).toHaveLength(0); // no scheduled restart
    expect(h.logs.join("\n")).toContain("setup");
    sup.ensure("/a"); // fresh connect → one retry
    expect(h.spawns).toEqual(["/a", "/a"]);
  });

  it("spawn/runtime error with no close event → schedules a backoff restart", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    h.children[0]!.error(new Error("EMFILE"));
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(1000);
    expect(h.logs.join("\n")).toContain("worker for /a spawn/runtime error: EMFILE");
  });

  it("error immediately followed by close on the same child → exactly one restart", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    h.children[0]!.error(new Error("boom"));
    h.children[0]!.close(1); // same underlying spawn failure often fires both
    expect(h.timers).toHaveLength(1);
  });

  it("stop kills children, cancels pending restarts, and blocks further spawns", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    sup.ensure("/b");
    h.children[0]!.close(1); // pending restart for /a
    sup.stop();
    expect(h.timers[0]!.cancelled).toBe(true);
    expect(h.children[1]!.killed).toEqual(["SIGTERM"]);
    sup.ensure("/c");
    expect(h.spawns).toEqual(["/a", "/b"]); // no /c
  });
});

describe("on-demand mode", () => {
  it("jobEnqueued spawns; jobSettled to zero starts the idle clock; timer reaps without restart", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    expect(h.spawns).toEqual(["/a"]);
    sup.jobSettled("/a");
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(5000);
    h.tick(0); // idle timer fires
    expect(h.children[0]!.killed).toEqual(["SIGTERM"]);
    h.children[0]!.close(143); // SIGTERM exit
    expect(h.timers).toHaveLength(0); // NO backoff restart scheduled
    expect(h.logs.join("\n")).toContain("reaped");
  });

  it("an enqueue cancels a pending reap timer", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    sup.jobSettled("/a");
    expect(h.timers).toHaveLength(1);
    sup.jobEnqueued("/a");
    expect(h.timers[0]!.cancelled).toBe(true);
    expect(h.spawns).toEqual(["/a"]); // still the one running child, no double spawn
  });

  it("outstanding counter: reap only fires at zero (two jobs, one settle → no timer)", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    sup.jobEnqueued("/a");
    sup.jobSettled("/a");
    expect(h.timers).toHaveLength(0);
    sup.jobSettled("/a");
    expect(h.timers).toHaveLength(1);
  });

  it("settle clamps at zero (a pre-up job's result never goes negative)", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobSettled("/a"); // no enqueue ever seen — no crash, no timer (no child)
    expect(h.timers).toHaveLength(0);
    sup.jobEnqueued("/a");
    sup.jobSettled("/a"); // 1 - 1 = 0, NOT (-1 + 1 - 1)
    expect(h.timers).toHaveLength(1);
  });

  it("a job arriving mid-reap respawns exactly once after the dying child exits", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    sup.jobSettled("/a");
    h.tick(0); // reap: SIGTERM sent, child still dying
    sup.jobEnqueued("/a"); // job lands mid-reap
    expect(h.spawns).toEqual(["/a"]); // no second spawn yet (entry still occupied)
    h.children[0]!.close(143); // dying child exits
    expect(h.spawns).toEqual(["/a", "/a"]); // exactly one respawn
    expect(h.timers).toHaveLength(0); // and no backoff timer
  });

  it("idleMs 0 (or absent) never reaps", () => {
    const h = harness(); // no idleMs
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    sup.jobSettled("/a");
    expect(h.timers).toHaveLength(0);
  });

  it("a reaped exit resets the backoff counter", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    h.children[0]!.close(1); // crash → backoff 1000
    expect(h.timers[h.timers.length - 1]!.ms).toBe(1000);
    h.tick(0); // restart (restarts now 1)
    sup.jobSettled("/a"); // outstanding 1→0 (the crashed job never settles in reality; one settle reaches zero here)
    h.tick(0); // reap fires
    h.children[h.children.length - 1]!.close(143); // reaped exit → restarts reset
    sup.jobEnqueued("/a"); // respawn
    h.children[h.children.length - 1]!.close(1); // crash again
    expect(h.timers[h.timers.length - 1]!.ms).toBe(1000); // backoff starts fresh, not 2000
  });

  it("exit-2 root retries on the next jobEnqueued", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    h.children[0]!.close(2); // setup failure
    expect(h.timers).toHaveLength(0);
    sup.jobEnqueued("/a"); // fresh job = retry signal
    expect(h.spawns).toEqual(["/a", "/a"]);
  });

  it("trackManaged/managedRoots: served + job-seen roots, spawn kinds attached, persists across reaps", () => {
    const h = harness({ idleMs: 5000, spawnKinds: ["generate-artifact"] });
    const sup = new WorkerSupervisor(h.deps);
    sup.trackManaged("/served-only");
    sup.jobEnqueued("/a");
    expect(sup.managedRoots()).toEqual(
      expect.arrayContaining([
        { root: "/served-only", kinds: ["generate-artifact"] },
        { root: "/a", kinds: ["generate-artifact"] },
      ]),
    );
    sup.jobSettled("/a");
    h.tick(0);
    h.children[0]!.close(143); // reaped
    expect(sup.managedRoots().map((m) => m.root)).toContain("/a"); // persists
  });

  it("stop cancels idle timers too", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    sup.jobSettled("/a");
    sup.stop();
    expect(h.timers[0]!.cancelled).toBe(true);
    expect(h.children[0]!.killed).toEqual(["SIGTERM"]);
  });
});

describe("counter reconciliation (claim signal)", () => {
  it("three-event lifecycle: enqueue → claim → settle → idle timer → reap", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    sup.jobClaimed("/a");
    expect(h.timers).toHaveLength(0); // in flight — no idle clock
    sup.jobSettled("/a");
    expect(h.timers).toHaveLength(1);
    h.tick(0);
    expect(h.children[0]!.killed).toEqual(["SIGTERM"]);
  });

  it("HEADLINE: crash mid-job → inflight reconciled → restart arms a fresh idle window → reap", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    sup.jobClaimed("/a"); // queued 0, inflight 1
    h.children[0]!.close(1); // crash mid-job: no settle will ever come
    expect(h.timers).toHaveLength(1); // the backoff restart timer only
    expect(h.timers[0]!.ms).toBe(1000);
    h.tick(0); // backoff fires → restart → total is 0 → idle timer armed
    expect(h.spawns).toEqual(["/a", "/a"]);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(5000); // fresh full idle window
    h.tick(0); // idle fires → reap
    expect(h.children[1]!.killed).toEqual(["SIGTERM"]);
    h.children[1]!.close(143);
    expect(h.logs.join("\n")).toContain("reaped");
  });

  it("crash with queued work: queued survives, restart does NOT arm idle, normal lifecycle resumes", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    sup.jobEnqueued("/a");
    sup.jobClaimed("/a"); // queued 1, inflight 1
    h.children[0]!.close(1); // crash: inflight → 0, queued stays 1
    h.tick(0); // restart
    expect(h.spawns).toEqual(["/a", "/a"]);
    expect(h.timers).toHaveLength(0); // total is 1 — no idle timer at restart
    sup.jobClaimed("/a"); // respawned worker claims the queued job
    sup.jobSettled("/a"); // and finishes it → total 0
    expect(h.timers).toHaveLength(1);
  });

  it("settle fallback: a settle with no claim seen decrements queued (old two-event flow)", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    sup.jobSettled("/a"); // no claim event — fallback path
    expect(h.timers).toHaveLength(1); // reached zero → idle clock
  });

  it("manual-worker interleaving: claim+settle with no enqueue seen — floors hold, nothing spawns", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobClaimed("/m"); // queued floors at 0, inflight 1
    sup.jobSettled("/m"); // inflight 0
    expect(h.spawns).toEqual([]); // claim never spawns
    expect(h.timers).toHaveLength(0); // no child → no idle timer
  });

  it("stale idle timer is cancelled at crash; the restart arms a fresh one", () => {
    const h = harness({ idleMs: 5000 });
    const sup = new WorkerSupervisor(h.deps);
    sup.jobEnqueued("/a");
    sup.jobClaimed("/a");
    sup.jobSettled("/a"); // idle timer pending
    const staleIdle = h.timers[0]!;
    h.children[0]!.close(1); // crash while idle timer pending
    expect(staleIdle.cancelled).toBe(true); // F3: stale timer never reaps the fresh child
    h.tick(0); // backoff restart → fresh idle window
    expect(h.timers[h.timers.length - 1]!.ms).toBe(5000);
  });
});

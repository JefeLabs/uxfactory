import { describe, it, expect } from "vitest";
import { WorkerSupervisor, BACKOFF_CAP_MS } from "../src/worker-supervisor.js";
import type { SupervisedChild, SupervisorDeps } from "../src/worker-supervisor.js";

/** Deterministic harness: manual clock, captured timers, scripted children. */
function harness(): {
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

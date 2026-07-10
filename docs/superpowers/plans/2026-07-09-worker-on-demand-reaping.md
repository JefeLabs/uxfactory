# On-Demand Workers + Idle Reaping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under `uxfactory up`, workers spawn when jobs are enqueued and are reaped after idling, while the panel keeps showing such roots as covered via a `managed` flag on the liveness wire.

**Architecture:** Two additive `BridgeOptions` job-signal callbacks (`onRequestEnqueued`/`onRequestSettled`) drive supervisor-side outstanding counters; the idle timer only starts at zero outstanding and any enqueue cancels it, so reaping a busy worker is impossible by construction. A `managedRoots` accessor lets the bridge stamp `managed?: { kinds?: string[] }` onto snapshots and `worker-status` frames; the panel's coverage treats managed as covered.

**Tech Stack:** Fastify bridge (in-process under `up`), pure supervisor state machine with injected timers, React/Zustand panel, vitest.

**Spec:** `docs/superpowers/specs/2026-07-09-worker-on-demand-reaping-design.md` — read it first.

## Global Constraints

- Node ≥ 20.10, pnpm workspace, commands from repo root unless stated. Commit directly to `main`.
- Additive only on published packages; changesets: `@uxfactory/bridge` minor (Task 2), `@uxfactory/cli` minor (Task 4). Worker package untouched.
- Idle default: `10` minutes; `--idle <minutes>` on `up`; `0` disables reaping (spawn stays job-driven). `idleMs = minutes * 60_000`.
- Reap semantics: SIGTERM; a reaped exit does NOT backoff-restart, does NOT mark failed, resets `restarts` to 0; a job arriving mid-reap respawns exactly once after the dying child exits.
- Managed semantics: every SERVED root under `up` is managed (registered via `onRootServed → trackManaged`, plus the launch root at startup); managed persists across reaps; `managed.kinds` mirrors `up --kinds`.
- Panel: covered = live worker claims kind OR managed claims kind; `unknown` only when `workers === null` AND `managed === null`. The three WorkerDot aria-labels are UNCHANGED (test contract); only the `title` tooltip appends ` — on-demand (idle)` when coverage is entirely via managed.
- Wire type (verbatim): `interface ManagedInfo { kinds?: string[] }`; snapshot/connect + `worker-status` frames gain optional `managed?: ManagedInfo`.
- Exit-2 policy unchanged: no timer restart; the retry trigger is now the next `jobEnqueued` for that root.
- Known pre-existing failures (do NOT fix/worsen): spec typecheck (story-schema.test.ts:184); plugin 16 typecheck errors; CLI 3 fixture typecheck errors. Panel `.tsx` tests run from `packages/uxfactory-plugin`.

---

### Task 1: Bridge — job-signal callbacks

**Files:**
- Modify: `packages/uxfactory-bridge/src/server.ts` (`BridgeOptions` ~line 21; `POST /pipeline/request` handler; `POST /pipeline/result` handler)
- Test: `packages/uxfactory-bridge/test/job-signals.test.ts` (new)

**Interfaces:**
- Consumes: existing handlers (`resolution.root` at enqueue; `store.rootForRequest(id)` at result).
- Produces (used by Task 4): `BridgeOptions.onRequestEnqueued?: (root: string, kind: string) => void`; `BridgeOptions.onRequestSettled?: (root: string) => void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-bridge/test/job-signals.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

describe("BridgeOptions job-signal callbacks", () => {
  let app: FastifyInstance;
  let launchRoot: string;
  const enqueued: Array<{ root: string; kind: string }> = [];
  const settled: string[] = [];

  beforeEach(async () => {
    enqueued.length = 0;
    settled.length = 0;
    launchRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-job-signals-"));
    await mkdir(path.join(launchRoot, ".git"), { recursive: true });
    app = await createBridge({
      dataDir: path.join(launchRoot, ".uxfactory"),
      reposRegistryPath: path.join(launchRoot, "repos-registry.json"),
      onRequestEnqueued: (root, kind) => enqueued.push({ root, kind }),
      onRequestSettled: (root) => settled.push(root),
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(launchRoot, { recursive: true, force: true });
  });

  it("fires onRequestEnqueued with the resolved root and kind on every enqueue", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "generate-artifact", payload: { artifact: "brief" } },
    });
    expect(res.statusCode).toBe(200);
    expect(enqueued).toEqual([{ root: launchRoot, kind: "generate-artifact" }]);
  });

  it("does not fire onRequestEnqueued on a rejected enqueue (bad kind)", async () => {
    await app.inject({ method: "POST", url: "/pipeline/request", payload: { kind: "" } });
    expect(enqueued).toHaveLength(0);
  });

  it("fires onRequestSettled with the request's root after the result saves", async () => {
    const enq = await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "generate-artifact", payload: {} },
    });
    const { id } = enq.json() as { id: string };
    await app.inject({
      method: "POST",
      url: "/pipeline/result",
      payload: { id, status: 0, result: { ok: true } },
    });
    expect(settled).toEqual([launchRoot]);
  });

  it("does not fire onRequestSettled for an unknown request id", async () => {
    await app.inject({
      method: "POST",
      url: "/pipeline/result",
      payload: { id: "pr_never_enqueued", status: 0, result: null },
    });
    expect(settled).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/job-signals.test.ts`
Expected: FAIL — TypeScript rejects the unknown BridgeOptions members / callbacks never fire.

- [ ] **Step 3: Implement**

3a. `BridgeOptions` gains:

```ts
  /** Fired after every successful POST /pipeline/request enqueue (resolved root + kind). */
  onRequestEnqueued?: (root: string, kind: string) => void;
  /** Fired after every POST /pipeline/result save, with the settled request's root. */
  onRequestSettled?: (root: string) => void;
```

3b. In the `POST /pipeline/request` handler, after the wake-frame broadcast and before `return { id: request.id }`:

```ts
    options.onRequestEnqueued?.(resolution.root, request.kind);
```

3c. In the `POST /pipeline/result` handler: hoist the root lookup ABOVE the artifact-writes block (it currently lives inside `if (writes.length > 0)` — `savePipelineResult` deletes the mapping, so it must be read first). The writes block reuses the hoisted value:

```ts
    // Read the root BEFORE savePipelineResult forgets the id→root mapping —
    // both the artifact writes and the settled signal need it.
    const requestRoot = store.rootForRequest(body.id);
```

(replace the inner `const root = store.rootForRequest(body.id);` with `const root = requestRoot;` or use `requestRoot` directly). After `await store.savePipelineResult(...)`:

```ts
    if (requestRoot !== null) options.onRequestSettled?.(requestRoot);
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/uxfactory-bridge/test/job-signals.test.ts packages/uxfactory-bridge/test/pipeline-relay.test.ts && pnpm --filter @uxfactory/bridge typecheck`
Expected: PASS / clean

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-bridge/src/server.ts packages/uxfactory-bridge/test/job-signals.test.ts
git commit -m "feat(bridge): onRequestEnqueued/onRequestSettled job signals for the up supervisor"
```

---

### Task 2: Bridge — `managed` on snapshots and worker-status frames + changeset

**Files:**
- Modify: `packages/uxfactory-bridge/src/worker-presence.ts` (add `ManagedInfo`)
- Modify: `packages/uxfactory-bridge/src/server.ts` (`BridgeOptions.managedRoots`; `broadcastWorkerStatus`; `projectPlugin` registration)
- Modify: `packages/uxfactory-bridge/src/project.ts` (`ProjectSnapshot.managed`; `ProjectPluginOptions.managedFor`; snapshot + connect enrichment)
- Create: `.changeset/bridge-managed-roots.md`
- Test: extend `packages/uxfactory-bridge/test/job-signals.test.ts` with a second describe

**Interfaces:**
- Consumes: Task 1's test harness; existing `workersFor` plumbing pattern (step 1).
- Produces (used by Tasks 4–5): `export interface ManagedInfo { kinds?: string[] }` (from `worker-presence.ts`); `BridgeOptions.managedRoots?: () => { root: string; kinds?: string[] }[]`; snapshot/connect field `managed?: ManagedInfo`; `worker-status` frames field `managed?: ManagedInfo`.

- [ ] **Step 1: Write the failing test** (append to `job-signals.test.ts`; copy the harness `beforeEach`/`afterEach` into the new describe, constructing the bridge with `managedRoots: () => managed` where `const managed: Array<{ root: string; kinds?: string[] }> = []` resets per test)

```ts
describe("managed flag on snapshot and worker-status frames", () => {
  // harness as above, plus:
  // const managed: Array<{ root: string; kinds?: string[] }> = [];
  // createBridge({ ..., managedRoots: () => managed })

  it("snapshot carries managed for a managed root and omits it otherwise", async () => {
    const before = (await app.inject({ method: "GET", url: "/project/snapshot" })).json() as {
      managed?: unknown;
    };
    expect(before.managed).toBeUndefined();

    managed.push({ root: launchRoot, kinds: ["generate-artifact"] });
    const after = (await app.inject({ method: "GET", url: "/project/snapshot" })).json() as {
      managed?: { kinds?: string[] };
    };
    expect(after.managed).toEqual({ kinds: ["generate-artifact"] });
  });

  it("POST /project/connect response carries managed for the connected root", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "uxf-managed-conn-"));
    await mkdir(path.join(other, ".git"), { recursive: true });
    managed.push({ root: path.resolve(other) });
    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: other },
    });
    const body = res.json() as { ok: boolean; snapshot: { managed?: { kinds?: string[] } } };
    expect(body.ok).toBe(true);
    expect(body.snapshot.managed).toEqual({});
    await rm(other, { recursive: true, force: true });
  });

  it("worker-status frames carry managed (SSE, real socket)", async () => {
    managed.push({ root: launchRoot });
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    const observed: Array<{ requestId: string; event: { managed?: unknown; workers?: unknown[] } }> = [];
    const ctl = new AbortController();
    const res = await fetch(`${base}/pipeline/events`, { signal: ctl.signal });
    collectFrames(res, observed); // copy the collectFrames helper from worker-status-relay.test.ts (with its try/catch)

    const workerCtl = new AbortController();
    await fetch(
      `${base}/pipeline/events?client=worker&root=${encodeURIComponent(launchRoot)}`,
      { signal: workerCtl.signal },
    );
    await waitFor(() =>
      observed.some((f) => f.requestId === "worker-status" && f.event.workers?.length === 1),
    ); // copy waitFor from worker-status-relay.test.ts
    const frame = observed.find((f) => f.requestId === "worker-status")!;
    expect(frame.event.managed).toEqual({});
    workerCtl.abort();
    ctl.abort();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/uxfactory-bridge/test/job-signals.test.ts`
Expected: new describe FAILS (`managed` undefined everywhere / options member unknown)

- [ ] **Step 3: Implement**

3a. `worker-presence.ts`:

```ts
/** A root an in-process supervisor manages: jobs for it will spawn a worker. */
export interface ManagedInfo {
  /** Kinds the supervisor's spawned workers claim; absent = all kinds. */
  kinds?: string[];
}
```

3b. `server.ts` — `BridgeOptions` gains:

```ts
  /** Roots an in-process supervisor manages (with the kinds its workers claim). */
  managedRoots?: () => { root: string; kinds?: string[] }[];
```

Add a helper next to `broadcastWorkerStatus` and use it there:

```ts
  /** ManagedInfo for a root per options.managedRoots, or undefined. */
  const managedInfoFor = (root: string): ManagedInfo | undefined => {
    const entry = options.managedRoots?.().find((m) => m.root === root);
    if (entry === undefined) return undefined;
    return { ...(entry.kinds !== undefined ? { kinds: entry.kinds } : {}) };
  };

  const broadcastWorkerStatus = (root: string): void => {
    const managed = managedInfoFor(root);
    const frame = store.appendPipelineEvent("worker-status", {
      type: "worker-status",
      root,
      workers: presence.listFor(root),
      ...(managed !== undefined ? { managed } : {}),
    });
    broadcastPipelineFrame(frame);
  };
```

(import `ManagedInfo` from `./worker-presence.js`.) Pass `managedFor: managedInfoFor` in the `projectPlugin` registration.

3c. `project.ts` — `ProjectSnapshot` gains `managed?: ManagedInfo;` (import the type); `ProjectPluginOptions` gains `managedFor?: (root: string) => ManagedInfo | undefined;`. Snapshot route return becomes:

```ts
    const snapshot = await buildSnapshot(ctx.root, ctx.dataDir);
    const managed = opts.managedFor?.(ctx.root);
    return { ...snapshot, workers: opts.workersFor?.(ctx.root) ?? [], ...(managed !== undefined ? { managed } : {}) };
```

Connect handler return becomes the same shape for `resolved` (managed computed AFTER `onRootServed` fires, so a supervisor registering the root in that callback is visible in the response):

```ts
    opts.onRootServed?.(resolved);
    const snapshot = await buildSnapshot(resolved, registry.dataDirFor(resolved));
    const managed = opts.managedFor?.(resolved);
    return { ok: true, snapshot: { ...snapshot, workers: opts.workersFor?.(resolved) ?? [], ...(managed !== undefined ? { managed } : {}) } };
```

3d. `.changeset/bridge-managed-roots.md`:

```md
---
"@uxfactory/bridge": minor
---

Job-signal callbacks (`onRequestEnqueued`, `onRequestSettled`) and a
`managedRoots` accessor on BridgeOptions; snapshots, connect responses, and
worker-status frames now carry a `managed` flag so panels can tell
reaped-but-respawnable (on-demand) roots from genuinely unserved ones.
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/uxfactory-bridge/test/job-signals.test.ts packages/uxfactory-bridge/test/worker-status-relay.test.ts packages/uxfactory-bridge/test/on-root-served.test.ts && pnpm --filter @uxfactory/bridge typecheck`
Expected: PASS / clean

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-bridge/src/worker-presence.ts packages/uxfactory-bridge/src/server.ts packages/uxfactory-bridge/src/project.ts packages/uxfactory-bridge/test/job-signals.test.ts .changeset/bridge-managed-roots.md
git commit -m "feat(bridge): managed flag on snapshot/connect/worker-status via managedRoots accessor"
```

---

### Task 3: Supervisor — on-demand mode (jobEnqueued/jobSettled/reap/trackManaged)

**Files:**
- Modify: `packages/uxfactory-cli/src/worker-supervisor.ts`
- Test: extend `packages/uxfactory-cli/test/worker-supervisor.test.ts` (new describe; existing tests must keep passing unchanged)

**Interfaces:**
- Consumes: nothing new (timers/spawn already injected).
- Produces (used by Task 4): `SupervisorDeps` gains `idleMs?: number` (0/absent = never reap) and `spawnKinds?: string[]`; new methods `jobEnqueued(root: string): void`, `jobSettled(root: string): void`, `trackManaged(root: string): void`, `managedRoots(): { root: string; kinds?: string[] }[]`.

- [ ] **Step 1: Write the failing tests** (new describe in `worker-supervisor.test.ts`; reuse the existing `harness()` — extend it to accept deps overrides: `harness(extra?: Partial<SupervisorDeps>)` merging into the deps object)

```ts
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
```

Note on the `harness` change: change its signature to `function harness(extra: Partial<SupervisorDeps> = {})` and build `const deps: SupervisorDeps = { spawnWorker(...), log(...), now, schedule, cancel, ...extra }`. The existing describe's calls (`harness()`) are unaffected.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/uxfactory-cli/test/worker-supervisor.test.ts`
Expected: new describe FAILS (`jobEnqueued` is not a function); the original 5 tests still PASS.

- [ ] **Step 3: Implement** — modify `worker-supervisor.ts`:

3a. `SupervisorDeps` gains:

```ts
  /** Reap a root's worker after this long with zero outstanding jobs. 0/absent = never. */
  idleMs?: number;
  /** Kinds the spawned workers claim (from `up --kinds`); attached to managedRoots(). */
  spawnKinds?: string[];
```

3b. `Entry` gains `reaping: boolean;` (initialized `false` in `start()`); class gains three private fields:

```ts
  private readonly outstanding = new Map<string, number>();
  private readonly idleTimers = new Map<string, unknown>();
  private readonly managed = new Set<string>();
```

3c. New public methods:

```ts
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
```

3d. In BOTH `onExit` and `onError`, immediately after the `entry.child = null;` line, add the reaping branch (before the `code === 2` check in `onExit`):

```ts
    if (entry.reaping) {
      entry.reaping = false;
      entry.restarts = 0; // a reap is a clean lifecycle end, not a crash
      this.deps.log(`worker for ${root} reaped after idle`);
      // A job that arrived mid-reap (SIGTERM → exit window) respawns exactly once.
      if ((this.outstanding.get(root) ?? 0) > 0) this.start(root);
      return;
    }
```

3e. `stop()` additionally cancels idle timers:

```ts
    for (const timer of this.idleTimers.values()) this.cancel(timer);
    this.idleTimers.clear();
```

3f. `ensure` needs one adjustment for the mid-reap case: a `reaping` entry still has a child, so the existing `entry?.child !== null` no-op check already prevents a double spawn — no change needed; verify the mid-reap test passes through `jobEnqueued → ensure (no-op) → exit handler respawn`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/uxfactory-cli/test/worker-supervisor.test.ts`
Expected: PASS (original 5 + new 10)

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/worker-supervisor.ts packages/uxfactory-cli/test/worker-supervisor.test.ts
git commit -m "feat(cli): supervisor on-demand mode — job counters, idle reap, managed set"
```

---

### Task 4: `up` rewiring + `--idle` flag + CLI changeset

**Files:**
- Modify: `packages/uxfactory-cli/src/commands/up.ts` (flags; supervisor deps; startBridge options; drop `ensure(launchRoot)`)
- Modify: `packages/uxfactory-cli/src/cli.ts` (add `--idle <minutes>` to the `up` registration)
- Create: `.changeset/cli-on-demand-workers.md`
- Test: extend `packages/uxfactory-cli/test/up-cmd.test.ts`

**Interfaces:**
- Consumes: Task 1–2 bridge options; Task 3 supervisor methods.
- Produces: `UpCmdFlags.idleMinutes?: number`; `up` wiring — `onRequestEnqueued → jobEnqueued`, `onRequestSettled → jobSettled`, `onRootServed → trackManaged`, `managedRoots → supervisor.managedRoots`, `trackManaged(launchRoot)` at startup, NO direct ensure calls.

- [ ] **Step 1: Write the failing tests** (extend `up-cmd.test.ts`; the fake `startBridge` must now capture all four callbacks)

```ts
  it("wires job signals: enqueue spawns, settle+idle reaps; connect only tracks managed", async () => {
    const io = captureIO();
    const spawned: string[] = [];
    let hooks: {
      onRootServed?: (root: string) => void;
      onRequestEnqueued?: (root: string, kind: string) => void;
      onRequestSettled?: (root: string) => void;
      managedRoots?: () => { root: string; kinds?: string[] }[];
    } = {};
    const { code } = await upCmd(
      { dataDir: "/launch/.uxfactory", idleMinutes: 10 },
      io,
      {
        startBridge: async (opts) => {
          hooks = opts;
          return { url: "http://127.0.0.1:3779", close: async () => {} };
        },
        spawn: ((_b: string, _a: string[], o: { cwd?: string }) => {
          spawned.push(String(o.cwd));
          return fakeChild();
        }) as never,
        cliModuleUrl: CLI_URL,
        env: {},
        fileExists,
        onSignal: () => {},
      },
    );
    expect(code).toBe(0);
    expect(spawned).toEqual([]); // NOTHING spawns at startup any more
    expect(hooks.managedRoots?.().map((m) => m.root)).toEqual([path.resolve("/launch")]); // launch root tracked

    hooks.onRootServed?.("/other");
    expect(spawned).toEqual([]); // connect does not spawn
    expect(hooks.managedRoots?.().map((m) => m.root)).toContain("/other");

    hooks.onRequestEnqueued?.("/other", "generate-artifact");
    expect(spawned).toEqual(["/other"]); // job spawns
  });

  it("--kinds flows into managedRoots entries", async () => {
    const io = captureIO();
    let hooks: { managedRoots?: () => { root: string; kinds?: string[] }[] } = {};
    await upCmd(
      { dataDir: "/launch/.uxfactory", idleMinutes: 10, kinds: "generate-artifact,validate" },
      io,
      {
        startBridge: async (opts) => {
          hooks = opts as never;
          return { url: "x", close: async () => {} };
        },
        spawn: (() => fakeChild()) as never,
        cliModuleUrl: CLI_URL,
        env: {},
        fileExists,
        onSignal: () => {},
      },
    );
    expect(hooks.managedRoots?.()[0]).toEqual({
      root: path.resolve("/launch"),
      kinds: ["generate-artifact", "validate"],
    });
  });
```

Also update the EXISTING first wiring test ("starts the bridge, ensures a launch-root worker…"): its assertions change — startup no longer spawns and `onRootServed` no longer spawns. Rewrite it to assert the new behavior (or fold it into the first new test above and delete it) — state which you did in the report.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/uxfactory-cli/test/up-cmd.test.ts`
Expected: new tests FAIL (spawned == [launchRoot] at startup; hooks missing)

- [ ] **Step 3: Implement**

3a. `UpCmdFlags` gains `idleMinutes?: number;`. In `upCmd`:

```ts
  const idleMinutes = flags.idleMinutes ?? 10;
  const spawnKinds =
    flags.kinds !== undefined
      ? flags.kinds.split(",").map((k) => k.trim()).filter((k) => k !== "")
      : undefined;
```

Supervisor construction gains:

```ts
    log: io.err,
    idleMs: idleMinutes * 60_000,
    ...(spawnKinds !== undefined ? { spawnKinds } : {}),
```

3b. `startBridge` call becomes:

```ts
    handle = await startBridge({
      ...(flags.port !== undefined ? { port: flags.port } : {}),
      dataDir: flags.dataDir,
      onRootServed: (root) => supervisor.trackManaged(root),
      onRequestEnqueued: (root) => supervisor.jobEnqueued(root),
      onRequestSettled: (root) => supervisor.jobSettled(root),
      managedRoots: () => supervisor.managedRoots(),
    });
```

(widen the `deps.startBridge` fallback's parameter type accordingly). Replace `supervisor.ensure(launchRoot)` with `supervisor.trackManaged(launchRoot)`.

3c. `cli.ts` — the `up` registration gains `.option("--idle <minutes>", "reap idle workers after this many minutes (0 disables; default 10)")` and maps `...(opts.idle !== undefined ? { idleMinutes: Number(opts.idle) } : {})`.

3d. `.changeset/cli-on-demand-workers.md`:

```md
---
"@uxfactory/cli": minor
---

`uxfactory up` workers are now on-demand: jobs spawn them, a 10-minute idle
timeout reaps them (`--idle <minutes>`, 0 disables), and connected roots stay
advertised as managed so panels don't warn about reaped workers.
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run packages/uxfactory-cli/test/up-cmd.test.ts packages/uxfactory-cli/test/worker-supervisor.test.ts packages/uxfactory-cli/test/cli.test.ts && pnpm --filter @uxfactory/cli typecheck`
Expected: PASS; typecheck shows only the 3 known fixture errors (no new).

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/commands/up.ts packages/uxfactory-cli/src/cli.ts packages/uxfactory-cli/test/up-cmd.test.ts .changeset/cli-on-demand-workers.md
git commit -m "feat(cli): up goes on-demand — job-driven spawn, --idle reaping, managed tracking"
```

---

### Task 5: Panel — managed-aware coverage

**Files:**
- Modify: `packages/uxfactory-plugin/ui/lib/bridge.ts` (add `ManagedInfo`, `ProjectSnapshot.managed`)
- Modify: `packages/uxfactory-plugin/ui/lib/worker-coverage.ts` (`coverageFor`/`anyUncovered` gain a REQUIRED `managed` param)
- Modify: `packages/uxfactory-plugin/ui/stores/app.ts` (`managedWorker` slice; `workersChanged(workers, managed)`; seeds/resets)
- Modify: `packages/uxfactory-plugin/ui/lib/use-worker-status.ts` (pass `managed` through from snapshot + frames)
- Modify: `packages/uxfactory-plugin/ui/components/WorkerBanner.tsx`, `packages/uxfactory-plugin/ui/router.tsx` (thread the new params; dot tooltip)
- Test: extend `packages/uxfactory-plugin/test/worker-coverage.test.ts`, `test/use-worker-status.test.tsx`, `test/worker-dot.test.tsx` (existing assertions updated ONLY where signatures changed)

**Interfaces:**
- Consumes: wire fields from Task 2.
- Produces: `interface ManagedInfo { kinds?: string[] }` (bridge.ts); `coverageFor(workers: WorkerPresenceEntry[] | null, kind: string, managed: ManagedInfo | null): WorkerCoverage`; `anyUncovered(workers: WorkerPresenceEntry[] | null, managed: ManagedInfo | null): boolean`; store slice `managedWorker: ManagedInfo | null` + action `workersChanged(workers, managed)`.

- [ ] **Step 1: Write the failing tests** (key additions; run from `packages/uxfactory-plugin`)

```ts
// worker-coverage.test.ts — new cases (existing calls gain a third/second arg: `null`)
it("managed with no kinds covers every kind even with zero live workers", () => {
  expect(coverageFor([], "generate-artifact", {})).toBe("covered");
  expect(coverageFor(null, "generate-design", {})).toBe("covered");
});
it("managed with kinds covers only those kinds", () => {
  expect(coverageFor([], "generate-artifact", { kinds: ["generate-artifact"] })).toBe("covered");
  expect(coverageFor([], "generate-design", { kinds: ["generate-artifact"] })).toBe("uncovered");
});
it("unknown only when BOTH workers and managed are null", () => {
  expect(coverageFor(null, "generate-artifact", null)).toBe("unknown");
  expect(coverageFor([], "generate-artifact", null)).toBe("uncovered");
});

// stores test — workersChanged now takes (workers, managed); banner re-arm keys off combined coverage
it("a managed flag arriving does not re-arm, but losing managed while uncovered does arm", () => {
  useAppStore.setState({ workers: [], managedWorker: null, workerBannerDismissed: false });
  useAppStore.getState().workersChanged([], {});   // becomes covered via managed
  useAppStore.getState().workersChanged([], null); // managed lost → fresh outage
  expect(useAppStore.getState().workerBannerDismissed).toBe(false);
});

// worker-dot.test.tsx — new case (three aria-labels unchanged; tooltip via title)
it("managed-idle: green with an on-demand tooltip", () => {
  useAppStore.setState({ workers: [], managedWorker: {} });
  render(<WorkerDot />);
  const dot = screen.getByLabelText("Worker status: live");
  expect(dot).toHaveAttribute("title", "Worker status: live — on-demand (idle)");
});
```

Also update `use-worker-status.test.tsx`: the snapshot fixture gains `managed` in one new test asserting `useAppStore.getState().managedWorker` seeds from it, and the frame test's event gains `managed: {}` asserting it lands in the store.

- [ ] **Step 2: Run to verify failure**

Run (from `packages/uxfactory-plugin`): `pnpm vitest run test/worker-coverage.test.ts test/worker-dot.test.tsx test/use-worker-status.test.tsx`
Expected: FAIL (signature mismatches / managed undefined)

- [ ] **Step 3: Implement**

3a. `bridge.ts`:

```ts
/** A root managed by an up supervisor: jobs for it spawn a worker on demand. */
export interface ManagedInfo {
  kinds?: string[];
}
```

and in `ProjectSnapshot`: `managed?: ManagedInfo;`

3b. `worker-coverage.ts` — both functions take managed as a REQUIRED param (forces every call site to thread it; a forgotten site is a compile error, not a lying dot):

```ts
export function coverageFor(
  workers: WorkerPresenceEntry[] | null,
  kind: string,
  managed: ManagedInfo | null,
): WorkerCoverage {
  const liveCovers = workers !== null && workers.some((w) => w.kinds === undefined || w.kinds.includes(kind));
  const managedCovers = managed !== null && (managed.kinds === undefined || managed.kinds.includes(kind));
  if (liveCovers || managedCovers) return "covered";
  if (workers === null && managed === null) return "unknown";
  return "uncovered";
}

export function anyUncovered(
  workers: WorkerPresenceEntry[] | null,
  managed: ManagedInfo | null,
): boolean {
  return ENQUEUEABLE_KINDS.some((k) => coverageFor(workers, k, managed) === "uncovered");
}
```

(import `ManagedInfo` from `./bridge.js`.)

3c. `stores/app.ts`: state gains `managedWorker: ManagedInfo | null` (initial `null`); action becomes `workersChanged(workers: WorkerPresenceEntry[] | null, managed: ManagedInfo | null): void` with the re-arm rule on combined values:

```ts
  workersChanged(workers, managed) {
    set((s) => {
      const freshOutage = anyUncovered(workers, managed) && !anyUncovered(s.workers, s.managedWorker);
      return {
        workers,
        managedWorker: managed,
        workerBannerDismissed: freshOutage ? false : s.workerBannerDismissed,
      };
    });
  },
```

`connectSucceeded` seeds `managedWorker: snapshot.managed ?? null`; `connectFailed`/`cancelReconnect` add `managedWorker: null` beside the existing `workers: null`.

3d. `use-worker-status.ts`: the snapshot effect calls `workersChanged(data.workers ?? null, data.managed ?? null)`; the frame type gains `managed?: ManagedInfo` (guard: absent or object — extend `isWorkerStatusEvent` to accept an optional non-array object) and the handler passes `ev.event.managed ?? null`.

3e. `WorkerBanner.tsx`: read `managedWorker` from the store and pass it: `coverageFor(workers, kind, managedWorker)`. `router.tsx` `WorkerDot`:

```tsx
export function WorkerDot(): React.JSX.Element {
  const workers = useAppStore((s) => s.workers);
  const managedWorker = useAppStore((s) => s.managedWorker);
  const state =
    workers === null && managedWorker === null
      ? "unknown"
      : anyUncovered(workers, managedWorker)
        ? "uncovered"
        : "covered";
  const onDemandIdle =
    state === "covered" && (workers === null || workers.length === 0) && managedWorker !== null;
  // …existing cls/label mapping unchanged…
  return (
    <span role="status" aria-label={label} title={onDemandIdle ? `${label} — on-demand (idle)` : label} …>
```

(keep the exact existing wrapper/inner-dot structure and classes; only `title` computation changes plus the two new store reads.)

- [ ] **Step 4: Run the panel suites**

Run (from `packages/uxfactory-plugin`): `pnpm vitest run test/worker-coverage.test.ts test/worker-dot.test.tsx test/use-worker-status.test.tsx test/worker-banner.test.tsx test/stores.test.ts test/screen-artifacts.test.tsx test/screen-prompt.test.tsx test/routing.test.tsx`
Expected: all PASS. Typecheck parity: 16 known errors, none new (`pnpm --filter @uxfactory/plugin typecheck` comparison).

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-plugin/ui packages/uxfactory-plugin/test
git commit -m "feat(panel): managed-aware coverage — on-demand roots stay covered, dot tooltip"
```

---

### Task 6: Docs + full verification + live smoke

**Files:**
- Modify: `QUICK-START-TO-VIBE-FIGMA.md` (the `uxfactory up` paragraph in "The worker" section)

- [ ] **Step 1: Docs.** In the worker section's `up` paragraph, replace the sentence about restart behavior with: "`up` spawns workers on demand (the first job for a project starts one) and reaps them after 10 idle minutes (`--idle <minutes>`, `0` keeps them forever); crashed workers restart with backoff; a worker that fails setup (exit 2, e.g. missing `~/.agentx/auth.json`) is not retried until the next job. The panel shows on-demand roots as covered — a green dot with an 'on-demand (idle)' tooltip, no warning banner." Keep the flags sentence, adding `--idle` to `up`'s list.

- [ ] **Step 2: Full verification**

```bash
pnpm -r build && pnpm test && pnpm --filter @uxfactory/bridge typecheck
```
Expected: build green; suite green (~1840 tests); bridge typecheck clean; cli/plugin typecheck = known baselines only.

- [ ] **Step 3: Live smoke** (controller runs — manages the user's stack)

```bash
# stop current stack, then:
uxfactory up --idle 1        # 1-minute reap for the smoke
# connect uxfio-demo via curl → snapshot shows managed, NO worker process yet, dot would be green
# enqueue one real seed job → worker spawns, claims, result lands
# ~60s later → "reaped after idle" log; worker process count 0; snapshot: workers [] + managed present
# enqueue... (optional) or verify managed persists; Ctrl-C teardown
# restart the stack for the user: uxfactory up (default 10-minute idle)
```

- [ ] **Step 4: Commit docs**

```bash
git add QUICK-START-TO-VIBE-FIGMA.md
git commit -m "docs: quick-start — up is on-demand with --idle reaping"
```

---

## Self-review notes (kept for the implementer)

- **Spec coverage:** §1 bridge signals+managed wire (T1–T2), §2 supervisor on-demand (T3), §3 up rewire+flag (T4), §4 panel (T5), §5 edges (encoded in T3/T4/T5 tests), §6 testing (per task) + smoke (T6). Changesets T2/T4.
- **Anchors (2026-07-09 main @ 6579c9c):** `/pipeline/result` handler already reads `rootForRequest` inside its writes block — T1 hoists it; supervisor is post-b25df1c (settled flag, `onError`, `scheduleRestart`); `up.ts` is 159 lines with `bridgeUrl` closure; `WorkerDot` has the role="status" wrapper + inner aria-hidden dot from 386a892.
- **T5 ripple discipline:** `coverageFor`/`anyUncovered`/`workersChanged` signature changes are REQUIRED params precisely so the compiler finds every call site (store re-arm, banner, dot, hook, tests). Do not make them optional.
- **T4 note:** the existing up-cmd wiring test asserts the OLD spawn-on-connect behavior — rewriting it is part of the task, not a regression.

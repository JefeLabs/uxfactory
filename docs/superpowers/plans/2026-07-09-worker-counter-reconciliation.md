# Counter Reconciliation + Crash-Path Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A worker crashing mid-job no longer disables reaping for its root — the supervisor reconciles in-flight counts at the crash boundary and re-arms the idle clock after the restart; plus `--idle` input validation.

**Architecture:** A third bridge signal (`onRequestClaimed`, fired at dequeue) lets the supervisor split its counter into `queued` (enqueue +1, claim −1) and `inflight` (claim +1, settle −1), both floored at 0. A crash zeroes only `inflight` (the only component that can zombie) and cancels the stale idle timer; `start()` arms a fresh idle window whenever a worker comes up with zero outstanding work — closing the "reconciled to zero but no settle will ever come" hole.

**Tech Stack:** Fastify bridge, pure supervisor state machine with injected timers, vitest.

**Spec:** `docs/superpowers/specs/2026-07-09-worker-counter-reconciliation-design.md` — read it first (the event-algebra table is the contract).

## Global Constraints

- Node ≥ 20.10, pnpm workspace, commands from repo root unless stated. Commit directly to `main`.
- Changesets: `@uxfactory/bridge` minor (Task 1), `@uxfactory/cli` minor (Task 3).
- Event algebra (verbatim from spec §1): enqueue → queued+1, cancel idle timer, ensure; claim → queued−1 (floor 0), inflight+1; settle → inflight−1 if inflight>0 ELSE queued−1 (floor 0), arm idle timer when total hits 0 (child running, idleMs>0); crash (non-reap, non-2) → inflight→0, cancel stale idle timer, backoff restart; reaped exit unchanged.
- Post-crash re-arm (spec §2, verbatim rule): at the end of `start()`, if the root's total is 0 and `idleMs > 0`, arm the idle timer. `start()` from `jobEnqueued`/mid-reap-respawn (total ≥ 1) must arm nothing.
- `--idle` validation message (verbatim): `invalid --idle value: must be a non-negative number of minutes` → exit 2. `--idle 0` remains valid (disables reaping).
- Exit-2 branch semantics unchanged (no restart, no reconciliation — a preflight failure never claimed anything).
- ALL existing suites pass unchanged (the settle fallback guarantees the old two-event tests still reach zero).
- Known pre-existing failures (don't fix/worsen): spec typecheck story-schema.test.ts:184; plugin 16 typecheck errors; CLI 3 fixture typecheck errors.

---

### Task 1: Bridge — `onRequestClaimed` signal + changeset

**Files:**
- Modify: `packages/uxfactory-bridge/src/server.ts` (`BridgeOptions`; the `GET /pipeline/request/next` handler)
- Create: `.changeset/bridge-claim-signal.md`
- Test: extend `packages/uxfactory-bridge/test/job-signals.test.ts` (first describe's harness + one new test)

**Interfaces:**
- Consumes: existing dequeue handler (`store.dequeuePipelineRequest(resolution.root, kinds)`).
- Produces (used by Task 3): `BridgeOptions.onRequestClaimed?: (root: string, kind: string) => void` — fires after a successful dequeue with the resolved root and the claimed request's kind; silent on 204.

- [ ] **Step 1: Write the failing test.** In `job-signals.test.ts`'s FIRST describe: add `const claimed: Array<{ root: string; kind: string }> = [];` beside the existing arrays, reset it in `beforeEach` (`claimed.length = 0;`), and pass `onRequestClaimed: (root, kind) => claimed.push({ root, kind })` into the `createBridge` options. Append:

```ts
  it("fires onRequestClaimed on a successful dequeue with root and kind; silent on 204", async () => {
    await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "generate-artifact", payload: {} },
    });
    expect(claimed).toHaveLength(0); // enqueue alone is not a claim

    const res = await app.inject({ method: "GET", url: "/pipeline/request/next" });
    expect(res.statusCode).toBe(200);
    expect(claimed).toEqual([{ root: launchRoot, kind: "generate-artifact" }]);

    const empty = await app.inject({ method: "GET", url: "/pipeline/request/next" });
    expect(empty.statusCode).toBe(204);
    expect(claimed).toHaveLength(1); // no claim signal for an empty queue
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/job-signals.test.ts`
Expected: FAIL — TS rejects the unknown `onRequestClaimed` option / callback never fires.

- [ ] **Step 3: Implement.** `BridgeOptions` gains (next to `onRequestSettled`):

```ts
  /** Fired after every successful GET /pipeline/request/next dequeue (resolved root + claimed kind). */
  onRequestClaimed?: (root: string, kind: string) => void;
```

In the `/pipeline/request/next` handler, after the dequeue:

```ts
      const request = await store.dequeuePipelineRequest(resolution.root, kinds);
      if (request === null) return reply.code(204).send();
      options.onRequestClaimed?.(resolution.root, request.kind);
      return request;
```

- [ ] **Step 4: Changeset** `.changeset/bridge-claim-signal.md`:

```md
---
"@uxfactory/bridge": minor
---

BridgeOptions gains `onRequestClaimed(root, kind)`, fired when a worker
dequeues a job — the signal the up supervisor uses to split queued vs
in-flight counts so a mid-job worker crash can be reconciled.
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run packages/uxfactory-bridge/test/job-signals.test.ts packages/uxfactory-bridge/test/pipeline-relay.test.ts && pnpm --filter @uxfactory/bridge typecheck`
Expected: PASS / clean

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-bridge/src/server.ts packages/uxfactory-bridge/test/job-signals.test.ts .changeset/bridge-claim-signal.md
git commit -m "feat(bridge): onRequestClaimed dequeue signal for supervisor counter reconciliation"
```

---

### Task 2: Supervisor — split counters, crash reconciliation, post-restart re-arm

**Files:**
- Modify: `packages/uxfactory-cli/src/worker-supervisor.ts`
- Test: extend `packages/uxfactory-cli/test/worker-supervisor.test.ts` (new describe; ALL existing tests pass unchanged)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 3): new public method `jobClaimed(root: string): void`. `jobEnqueued`/`jobSettled`/`trackManaged`/`managedRoots`/`ensure`/`stop` signatures unchanged.

- [ ] **Step 1: Write the failing tests** (new describe; reuse `harness(extra)`):

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/uxfactory-cli/test/worker-supervisor.test.ts`
Expected: new describe FAILS (`jobClaimed` is not a function); all existing tests still PASS.

- [ ] **Step 3: Implement** — in `worker-supervisor.ts`:

3a. Replace the field `private readonly outstanding = new Map<string, number>();` with:

```ts
  /** Jobs enqueued but not yet claimed (bridge queue mirror). Floored at 0. */
  private readonly queued = new Map<string, number>();
  /** Jobs claimed but not yet settled. Zeroed at a crash boundary (zombies). Floored at 0. */
  private readonly inflight = new Map<string, number>();
```

Add helpers:

```ts
  /** queued + inflight for a root — the reap gate. */
  private totalOutstanding(root: string): number {
    return (this.queued.get(root) ?? 0) + (this.inflight.get(root) ?? 0);
  }

  /** Cancel + forget the root's idle timer, if any. */
  private cancelIdleTimer(root: string): void {
    const idle = this.idleTimers.get(root);
    if (idle !== undefined) {
      this.cancel(idle);
      this.idleTimers.delete(root);
    }
  }

  /**
   * Arm the idle clock iff a worker is running with zero outstanding work.
   * Called after settles AND at the end of start() — a worker that comes up
   * with nothing to do (post-crash reconciliation) gets one full idle window;
   * without this, a reconciled root would idle forever (no settle is coming).
   */
  private armIdleIfIdle(root: string): void {
    const idleMs = this.deps.idleMs ?? 0;
    if (idleMs <= 0 || this.totalOutstanding(root) !== 0) return;
    const entry = this.entries.get(root);
    if (entry?.child === null || entry?.child === undefined) return;
    this.cancelIdleTimer(root);
    this.idleTimers.set(
      root,
      this.schedule(() => {
        this.idleTimers.delete(root);
        if (this.totalOutstanding(root) === 0) this.reap(root);
      }, idleMs),
    );
  }
```

3b. `jobEnqueued`: replace the inline idle-cancel with `this.cancelIdleTimer(root);` and the counter line with `this.queued.set(root, (this.queued.get(root) ?? 0) + 1);`.

3c. New `jobClaimed` (after `jobEnqueued`):

```ts
  /** A worker dequeued a job for `root`: it moves from queued to in flight. */
  jobClaimed(root: string): void {
    if (this.stopped) return;
    this.queued.set(root, Math.max(0, (this.queued.get(root) ?? 0) - 1));
    this.inflight.set(root, (this.inflight.get(root) ?? 0) + 1);
  }
```

3d. `jobSettled` becomes:

```ts
  /** A job for `root` settled: at zero outstanding, start the idle clock. */
  jobSettled(root: string): void {
    if (this.stopped) return;
    const inflight = this.inflight.get(root) ?? 0;
    if (inflight > 0) {
      this.inflight.set(root, inflight - 1);
    } else {
      // Fallback: the claim predates this supervisor (or was never signalled) —
      // the settle proves the job left the queue.
      this.queued.set(root, Math.max(0, (this.queued.get(root) ?? 0) - 1));
    }
    this.armIdleIfIdle(root);
  }
```

3e. Crash reconciliation — in BOTH `onExit` (replacing nothing, inserted just before the `scheduleRestart` call, i.e. after the `code === 2` branch) and `onError` (before its `scheduleRestart` call):

```ts
    // Reconcile: the dead worker's claimed jobs can never settle (zombies).
    // Queued jobs survive — the respawned worker will claim them.
    this.inflight.set(root, 0);
    this.cancelIdleTimer(root); // F3: a stale timer must not reap the fresh child early
```

(Exit-2 branch: untouched. Reaping branches: untouched, but replace their `(this.outstanding.get(root) ?? 0) > 0` reads with `this.totalOutstanding(root) > 0`.)

3f. `start()` — add as the LAST line of the method: `this.armIdleIfIdle(root);`

3g. The old idle-timer block inside `jobSettled` and its `outstanding` reads in the reap-timer callback are gone (subsumed by `armIdleIfIdle`); grep the file for `outstanding` — zero references must remain.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/uxfactory-cli/test/worker-supervisor.test.ts packages/uxfactory-cli/test/up-cmd.test.ts`
Expected: PASS — all existing (17) + new (6); up-cmd untouched and green.

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/worker-supervisor.ts packages/uxfactory-cli/test/worker-supervisor.test.ts
git commit -m "feat(cli): supervisor counter reconciliation — split queued/inflight, crash re-arm"
```

---

### Task 3: `up` wiring + `--idle` validation + changeset + verification

**Files:**
- Modify: `packages/uxfactory-cli/src/commands/up.ts` (fourth hook; validation)
- Modify: `docs/superpowers/specs/2026-07-09-worker-on-demand-reaping-design.md` (mark the §5 known limitation resolved)
- Create: `.changeset/cli-counter-reconciliation.md`
- Test: extend `packages/uxfactory-cli/test/up-cmd.test.ts`

**Interfaces:**
- Consumes: Task 1's `onRequestClaimed` option; Task 2's `jobClaimed`.
- Produces: user-facing `--idle` validation; complete wiring.

- [ ] **Step 1: Write the failing tests** (extend `up-cmd.test.ts`):

```ts
  it("wires onRequestClaimed to the supervisor (claim then settle reaches the idle path without throwing)", async () => {
    const io = captureIO();
    let hooks: {
      onRequestEnqueued?: (root: string, kind: string) => void;
      onRequestClaimed?: (root: string, kind: string) => void;
      onRequestSettled?: (root: string) => void;
    } = {};
    await upCmd(
      { dataDir: "/launch/.uxfactory", idleMinutes: 10 },
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
    expect(typeof hooks.onRequestClaimed).toBe("function");
    hooks.onRequestEnqueued?.("/other", "generate-artifact");
    hooks.onRequestClaimed?.("/other", "generate-artifact");
    hooks.onRequestSettled?.("/other"); // full lifecycle drives the supervisor without throwing
  });

  it("--idle validation: non-finite or negative → exit 2 with the canonical message; 0 stays valid", async () => {
    const io = captureIO();
    const deps = {
      startBridge: async () => ({ url: "x", close: async () => {} }),
      spawn: (() => fakeChild()) as never,
      cliModuleUrl: CLI_URL,
      env: {},
      fileExists,
      onSignal: () => {},
    };
    expect((await upCmd({ dataDir: "/l/.uxfactory", idleMinutes: Number.NaN }, io, deps)).code).toBe(2);
    expect((await upCmd({ dataDir: "/l/.uxfactory", idleMinutes: -5 }, io, deps)).code).toBe(2);
    expect(io.errs.join("\n")).toContain("invalid --idle value: must be a non-negative number of minutes");
    expect((await upCmd({ dataDir: "/l/.uxfactory", idleMinutes: 0 }, io, deps)).code).toBe(0);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/uxfactory-cli/test/up-cmd.test.ts`
Expected: FAIL (`onRequestClaimed` undefined; NaN currently sails through to code 0)

- [ ] **Step 3: Implement.** In `upCmd`, FIRST thing after `const fileExists = ...`:

```ts
  // --idle abc parses to NaN, and setTimeout(fn, NaN) fires immediately — an
  // invalid value must fail loudly, not reap every worker instantly.
  if (
    flags.idleMinutes !== undefined &&
    (!Number.isFinite(flags.idleMinutes) || flags.idleMinutes < 0)
  ) {
    io.err("invalid --idle value: must be a non-negative number of minutes");
    return { code: EXIT.TRANSPORT };
  }
```

In the `startBridge` call, add the fourth hook (and widen `deps.startBridge`'s type + the dynamic-import fallback signature to match):

```ts
      onRequestClaimed: (root) => supervisor.jobClaimed(root),
```

- [ ] **Step 4: Docs + changeset.** In `docs/superpowers/specs/2026-07-09-worker-on-demand-reaping-design.md`, append to the §5 known-limitation sentence: ` **Resolved 2026-07-09** by the counter-reconciliation follow-up (spec 2026-07-09-worker-counter-reconciliation-design.md): a claim signal splits queued/in-flight counts, crashes zero the in-flight component, and restarts re-arm the idle clock.` Create `.changeset/cli-counter-reconciliation.md`:

```md
---
"@uxfactory/cli": minor
---

`uxfactory up` reconciles job counters across mid-job worker crashes (the
root is reaped again after the respawn instead of idling forever) and
validates `--idle` input instead of treating a typo as reap-immediately.
```

- [ ] **Step 5: Full verification**

```bash
pnpm vitest run packages/uxfactory-cli/test/up-cmd.test.ts packages/uxfactory-cli/test/worker-supervisor.test.ts packages/uxfactory-cli/test/cli.test.ts
pnpm --filter @uxfactory/cli typecheck   # 3 known fixture errors only
pnpm -r build && pnpm test               # full suite green
```

- [ ] **Step 6: Live smoke** (controller runs — manages the user's stack): `up --idle 1`; enqueue a real job; `kill -9` the worker's node process mid-run; observe backoff respawn; confirm "reaped after idle" fires ~60s after the restart (the sequence that previously disabled reaping); snapshot stays `managed`.

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-cli/src/commands/up.ts packages/uxfactory-cli/test/up-cmd.test.ts docs/superpowers/specs/2026-07-09-worker-on-demand-reaping-design.md .changeset/cli-counter-reconciliation.md
git commit -m "feat(cli): wire claim signal into up; validate --idle; mark limitation resolved"
```

---

## Self-review notes (kept for the implementer)

- **Spec coverage:** §1 algebra (T2 3b-3e + tests), §2 re-arm (T2 3a `armIdleIfIdle` + 3f + headline test), §3 claim signal (T1), §4 wiring + F10 validation (T3), §5 internals (T2), §6 tests (all) + smoke (T3 step 6, controller).
- **Anchors (main @ 6af25f7):** supervisor is 237 lines post-step-3 (fields at ~52-54; jobEnqueued ~197; jobSettled ~210; reaping branches read `outstanding` at lines 112/144 — become `totalOutstanding`); dequeue handler in server.ts returns 204 then `return request`.
- **T2 discipline:** after the refactor, `grep -n outstanding packages/uxfactory-cli/src/worker-supervisor.ts` must return nothing — a missed read is a silent logic hole.
- **Behavior note encoded in armIdleIfIdle:** a direct `ensure()` call with `idleMs > 0` and no jobs now arms an idle window for that worker — semantically intended ("a running worker with no work gets an idle window"); existing step-2 tests use `harness()` without `idleMs`, so they are unaffected.

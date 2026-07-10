# On-demand workers + idle reaping — step 3 of the worker-availability ladder

**Date:** 2026-07-09
**Status:** approved (design), pending implementation plan
**Scope:** step 3, final rung. Step 1 (liveness presence + panel surface, `d135cd5..386a892`) and step 2 (`uxfactory worker`/`up` verbs + supervision, `6fbe522..cbda7ab`) are shipped. This step changes WHEN workers exist under `uxfactory up`: spawned by jobs, reaped when idle — without making the step-1 liveness surface lie about reaped-but-respawnable roots.

## Problem

Step 2's `up` spawns a worker per *connected* root and keeps it forever. Connecting three projects in a panel session leaves three idle node processes (each ~a tsx wrapper + node child + SSE connection) running indefinitely, even though workers only do anything when a job is enqueued. And the trigger is wrong for the actual cost model: a worker is needed exactly when work exists, not when a panel looks at a project.

The naive fix (kill idle workers) breaks the step-1 contract: presence is structural (open SSE = live), so a reaped worker makes the panel show "no worker is serving this project — jobs will queue until one connects," which under `up` is false — the next job respawns a worker in ~2s. The panel needs to distinguish *unmanaged-absent* (warn) from *managed-idle* (fine).

## Decisions (with user)

1. **Pure on-demand** (over warm-on-connect + reap, or reap-only): connect no longer spawns anything; the first job enqueued for a root spawns its worker; idle timeout reaps it; the next job respawns. Worker cold-start (~2s) is noise next to LLM job runtimes. `onRootServed`-driven spawning is removed from `up` (the `BridgeOptions.onRootServed` option itself stays — published, additive, harmless).
2. **Idle timeout: 10 minutes default, `--idle <minutes>` flag, `0` disables reaping** (spawn stays job-driven either way).
3. **Managed = covered**: coverage answers "will my job run?" A root with no live worker but a managing supervisor counts as covered — green dot, no banner; the tooltip and wire distinguish "on-demand" from "live."

## Constraints

- Additive only on the published packages: new optional `BridgeOptions` members; snapshot/frame fields optional. Changesets: `@uxfactory/bridge` minor, `@uxfactory/cli` minor. Panel/worker private.
- The worker package stays untouched (it already exits cleanly on SIGTERM; reaping is just the supervisor killing it).
- `uxfactory worker` (manual, foreground) is NOT reaped — reaping is an `up`-supervisor behavior only.
- Kinds honesty: if `up --kinds <csv>` restricts what spawned workers claim, the managed flag must carry that restriction so the panel never claims coverage for a kind the on-demand worker won't serve.
- Step-1/2 contracts preserved: presence stays structural; banner copy/aria contracts unchanged; exit-2 = setup failure, no timer restart (retry trigger becomes the next job signal instead of the next connect).

## Design

### 1. Bridge — job signals + managed flag (`packages/uxfactory-bridge/src/server.ts`, `project.ts`)

Three additive `BridgeOptions` members:

```ts
  /** Fired after every successful POST /pipeline/request enqueue (resolved root + kind). */
  onRequestEnqueued?: (root: string, kind: string) => void;
  /** Fired after every POST /pipeline/result save, with the request's root. */
  onRequestSettled?: (root: string) => void;
  /** Roots an in-process supervisor manages (with the kinds its spawned workers claim). */
  managedRoots?: () => { root: string; kinds?: string[] }[];
```

- `onRequestEnqueued` fires in the `POST /pipeline/request` handler after `store.enqueuePipelineRequest(...)`, with `resolution.root` and the request kind.
- `onRequestSettled` fires in `POST /pipeline/result` — the root is read via `store.rootForRequest(id)` BEFORE `savePipelineResult` deletes the mapping; fires only when a root was known (unknown/duplicate result ids fire nothing).
- Wire shape `ManagedInfo = { kinds?: string[] }`:
  - `GET /project/snapshot` + connect response gain `managed?: ManagedInfo` for the resolved root (present iff `managedRoots()` names it). Plumbed like `workersFor`: a `managedFor?: (root) => ManagedInfo | undefined` option on `ProjectPluginOptions`, provided by server.ts from `options.managedRoots`.
  - `worker-status` frames gain the same `managed?: ManagedInfo` field, computed at broadcast time. Reaping closes the worker's SSE socket, so the existing presence machinery already emits the transition frame — it now says `workers: [], managed: {…}` instead of implying an outage. `broadcastWorkerStatus` is the single place frames are built, so this is one function.

### 2. Supervisor — on-demand mode (`packages/uxfactory-cli/src/worker-supervisor.ts`)

New constructor deps: `idleMs: number` (0 = never reap). New per-root state: `outstanding: number` (jobs enqueued minus settled, clamped ≥ 0 — a result for a job enqueued before `up` started must not go negative), `idleTimer: unknown | null`, `reaping: boolean`.

New methods:

- `jobEnqueued(root)`: cancel the root's idle timer; `outstanding += 1`; `ensure(root)`. A `failed` (exit-2) root retries once per job signal — the on-demand analogue of step 2's retry-per-connect.
- `jobSettled(root)`: `outstanding = max(0, outstanding - 1)`; if `outstanding === 0` and a child is running and `idleMs > 0`, start the idle timer.
- Idle timer fires: if `outstanding === 0` and a child is running → **reap**: set `reaping = true`, `child.kill("SIGTERM")`. In `onExit`/`onError`, a `reaping` entry is treated like `stop()`: no backoff restart, no failure marking; the entry's child/timers clear and `reaping` resets. `restarts` also resets to 0 on a completed reap (a reap is a clean lifecycle end, not a crash).
- Mid-reap job arrival (enqueued between SIGTERM and the child's exit): `jobEnqueued` bumps the counter and calls `ensure`, but the dying child still occupies the entry — `ensure` must respawn AFTER the reaped child's exit clears it. Mechanism: `onExit` of a `reaping` entry checks `outstanding > 0` and, if so, immediately starts a fresh child (this is the only path where a reap is followed by an auto-spawn).
- `trackManaged(root)`: registers a root in the managed set WITHOUT spawning. `jobEnqueued` calls it implicitly; `up` calls it for served roots (§3). Managed status persists across reaps — it means "jobs for this root will be served."
- `managedRoots(): { root: string; kinds?: string[] }[]`: the tracked-managed set, each entry carrying the supervisor-wide spawn kinds (from `up --kinds`), attached uniformly.
- `ensure(root)` keeps its step-2 semantics and remains the internal spawn gate — now invoked via `jobEnqueued` rather than directly by `up`.
- `stop()` unchanged (kills children including mid-reap ones, cancels idle + restart timers).

### 3. `up` rewires (`packages/uxfactory-cli/src/commands/up.ts`)

- New flag: `--idle <minutes>` (default `10`; `0` disables reaping). Passed to the supervisor as `idleMs = minutes * 60_000`.
- `startBridge` options change: drop the `onRootServed → ensure` wiring and the startup `ensure(launchRoot)`; add `onRequestEnqueued: (root) => supervisor.jobEnqueued(root)`, `onRequestSettled: (root) => supervisor.jobSettled(root)`, `managedRoots: () => supervisor.managedRoots()`.
- Managed-before-first-job: decision 3 defines managed as "will my job run?" — and under `up`, ANY served root's job spawns a worker. `managedRoots()` must therefore cover every SERVED root, not just roots with job history; otherwise a freshly-connected root would show a false warning until its first job. So `up` keeps a minimal `onRootServed` wiring: `onRootServed: (root) => supervisor.trackManaged(root)` (register as managed, no spawn), plus `trackManaged(launchRoot)` at startup.
- Everything else (entry resolution, env mapping, bridgeUrl injection, prefix streams, signal teardown, EADDRINUSE message) unchanged.

### 4. Panel — managed-aware coverage (`packages/uxfactory-plugin/ui/`)

- `lib/bridge.ts`: `ProjectSnapshot.managed?: { kinds?: string[] }`; the `worker-status` event type used by the hook gains the same optional field.
- Store (`stores/app.ts`): new slice `managedWorker: ManagedInfo | null` (null = unknown/none). Both values always arrive together (same snapshot, same frame), so the existing action's signature widens: `workersChanged(workers: WorkerPresenceEntry[] | null, managed: ManagedInfo | null)`. `connectSucceeded` seeds both; `connectFailed`/`cancelReconnect` reset both to null. The banner re-arm rule keys off combined `anyUncovered` exactly as before.
- `lib/worker-coverage.ts`: `coverageFor(workers, kind, managed?)` — covered if any live worker claims the kind OR `managed` is non-null and (`managed.kinds` undefined or includes kind); `anyUncovered` threads the same param. `unknown` only when BOTH `workers === null` and `managed === null`.
- `use-worker-status.ts`: passes `data.managed ?? null` / frame `managed ?? null` through.
- Banner: unchanged logic (renders on `uncovered`) — managed roots are covered, so it disappears under `up` and still warns under bare `uxfactory bridge`.
- Dot: unchanged three states; tooltip appends `— on-demand (idle)` when coverage is entirely via `managed` (no live workers). The dismiss/re-arm rule inherits automatically via `anyUncovered`.

### 5. Error handling & edge cases

- **Reap vs in-flight job**: impossible by construction — the timer only fires at `outstanding === 0`, and any enqueue cancels it first.
- **Counter drift**: results for pre-`up` jobs clamp at 0; a settle with no prior enqueue never goes negative.
- **Job for a root whose worker died mid-job** (crash, not reap): step-2 backoff restart still applies — the respawned worker re-claims nothing (the job died with its runner and the result never posts). The panel's 5-minute pending timeout still owns that failure surface; unchanged from today. **Known limitation (final review):** because that job never settles, the root's `outstanding` counter stays ≥ 1 for the rest of the `up` session, so its worker is no longer reaped — a silent degrade to step-2 behavior for that root. Reconciling the counter on a non-reap crash is a ledgered follow-up (a naive reset would under-count still-queued jobs and reap a worker with pending work, so it needs care). **Resolved 2026-07-09** by the counter-reconciliation follow-up (spec 2026-07-09-worker-counter-reconciliation-design.md): a claim signal splits queued/in-flight counts, crashes zero the in-flight component, and restarts re-arm the idle clock.
- **`--idle 0`**: reaping disabled; spawn remains job-driven; managed flag still advertised.
- **Kinds-filtered `up`**: `managed.kinds` mirrors `--kinds`; the panel treats non-matching kinds as uncovered (banner shows for those, correctly).
- **Manual `uxfactory worker` alongside `up`**: presence shows the live worker; the supervisor's counters are unaffected (it may also spawn on jobs — two workers claiming one root is already pool-safe by the atomic claim design).
- **Version skew**: old panel + new bridge ignores `managed` (shows amber while reaped — step-2 behavior, safe). New panel + old bridge: `managed` absent → null → exact step-2 semantics. Old `up` (step 2) + new bridge library: impossible in-process (co-released).

### 6. Testing

- **Bridge**: enqueue fires `onRequestEnqueued(resolvedRoot, kind)`; result fires `onRequestSettled(root)` once, nothing for unknown ids; snapshot + connect + `worker-status` frames carry `managed` from the accessor (inject `managedRoots`, assert all three surfaces).
- **Supervisor** (fake timers/children): job-enqueued spawns; settle-to-zero starts idle clock; enqueue cancels pending reap; reap kills without restart and resets `restarts`; mid-reap enqueue respawns exactly once after the old child exits; `idleMs 0` never reaps; exit-2 root retries on next `jobEnqueued`; `trackManaged`/`managedRoots` reflect served + job-seen roots with the spawn kinds.
- **`up` wiring**: fake bridge fires the callbacks → spawn/reap observed through the fake spawn seam; `managedRoots` output includes launch root at startup and connected roots (via `onRootServed → trackManaged`).
- **Panel**: coverage truth table with `managed` (incl. kinds-filtered); combined `workersChanged(workers, managed)` transitions; dot tooltip for managed-idle; banner absent when managed.
- **Live smoke**: `up --idle 1`; connect a root (dot green via managed, zero worker processes); enqueue a seed via curl → worker spawns, claims, result lands; ~60s later worker reaped (process count drops, dot stays green, frame shows `workers: [], managed`); second enqueue respawns.

## Out of scope

- Reaping for manually-started `uxfactory worker` processes.
- Per-root idle overrides or job-kind-aware idle policies.
- Recovering jobs whose worker died mid-run (panel timeout owns it, as today).
- The hosted tier's AgentCore supervisor (this local model deliberately mirrors its contract: spawn-on-demand, reap-on-idle).

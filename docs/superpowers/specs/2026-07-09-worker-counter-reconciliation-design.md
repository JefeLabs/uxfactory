# Counter reconciliation across mid-job crashes + crash-path hardening

**Date:** 2026-07-09
**Status:** approved (design), pending implementation plan
**Scope:** closes the step-3 known limitation (spec `2026-07-09-worker-on-demand-reaping-design.md` §5: a worker crashing mid-job leaves its root's `outstanding` counter stuck ≥ 1, silently disabling reaping for the session) and folds in the two crash-path follow-ups from the step-3 final review: F3 (stale idle timer survives a crash/restart and reaps the fresh child early) and F10 (`--idle <non-numeric>` → NaN → immediate reap).

## Problem

The supervisor's `outstanding` counter is edge-triggered on a two-event pair (enqueue +1, settle −1). A worker that crashes after claiming a job but before posting its result drops the settle forever: the counter never returns to zero, the idle timer never starts, and that root's worker runs for the rest of the `up` session — the exact idle-worker leak step 3 exists to prevent. A naive fix (zero the counter on crash) under-counts jobs still sitting in the bridge queue and would reap a worker that has pending work.

## Decisions (with user)

1. **Scope: reconciliation + crash-path hardening** — the fix plus F3 and F10, which live on the same code paths. The test-strengthening and docs-legend follow-ups stay ledgered.
2. **Mechanism: a third bridge signal (`onRequestClaimed`) + split counters** (over a `queuedFor` query on the bridge handle, or periodic polling): stays in the established bridge→supervisor callback pattern, and makes the crash reconciliation surgical — zero only the component that can zombie.

## Design

### 1. Event algebra (supervisor)

Per root, two counters, both floored at 0; reap-eligibility = `queued + inflight === 0`:

| Event | queued | inflight | idle timer | worker |
|---|---|---|---|---|
| `jobEnqueued(root)` | +1 | — | cancel | ensure (spawn if none) |
| `jobClaimed(root)` (new) | −1 (floor 0) | +1 | — | — |
| `jobSettled(root)` | −1 (floor 0) ONLY when inflight was 0 (fallback) | −1 if > 0 | start when total hits 0 (child running, idleMs > 0) | — |
| crash (non-reap exit/error) | unchanged | **→ 0** | **cancel stale timer** (F3) | backoff restart (unchanged) |
| reaped exit | unchanged | unchanged | — | no restart; respawn once if total > 0 (unchanged) |

- **Settle fallback** (`inflight === 0` → decrement `queued`): keeps the algebra correct for jobs claimed before `up` started (their claim signal was never seen), and preserves every existing two-event test (`enqueue → settle` still reaches zero) — no test rewrites.
- **Crash zeroes only `inflight`**: a dead worker's claimed jobs can never settle (zombies); jobs still queued live in the bridge and WILL be claimed+settled by the respawned worker, so `queued` must survive. Known miscount, accepted: zeroing `inflight` also forgets a *manual* worker's in-flight job on the same root — worst case the idle `up`-worker is reaped while the manual worker finishes; harmless (manual worker untouched; its settle hits the floor; the next job respawns).

### 2. Post-crash re-arming (the hole a naive reconciliation leaves)

After a mid-job crash reconciles `inflight` to 0, the total may be 0 — but no settle will ever arrive to start the idle clock, so the respawned worker would idle forever (the same bug, one layer deeper). Rule: **at the end of `start()`, if the root's total is 0 and `idleMs > 0`, arm the idle timer** — a freshly (re)started worker with no outstanding work gets one full idle window. This subsumes F3: the crash branch cancels the stale timer, and the restart arms a fresh full-window one. `start()` from `jobEnqueued` (total ≥ 1) and from mid-reap respawn (total ≥ 1) arm nothing — the condition is false.

### 3. Bridge — claim signal

`BridgeOptions.onRequestClaimed?: (root: string, kind: string) => void`, fired in `GET /pipeline/request/next` after a successful dequeue, with the resolved root and the claimed request's kind. Not fired on 204 (empty queue). Additive; changeset `@uxfactory/bridge` minor.

### 4. `up` wiring + `--idle` validation (F10)

- Wire `onRequestClaimed: (root) => supervisor.jobClaimed(root)` alongside the existing three hooks.
- Validate `--idle` in `upCmd` before anything else: `flags.idleMinutes` present but non-finite or negative → `io.err("invalid --idle value: must be a non-negative number of minutes")`, exit 2. (Currently `--idle abc` → NaN → `setTimeout(fn, NaN)` → immediate reap after every job — a silent failure.) Changeset `@uxfactory/cli` minor.

### 5. Supervisor internals

- Replace the single `outstanding: Map<string, number>` with `queued` and `inflight` maps (both private, floored). `jobClaimed(root)` is a new public method; `trackManaged` unchanged.
- Crash branches (`onExit` non-2/non-reaping, `onError` non-reaping): set `inflight` to 0, cancel + delete the root's idle timer, then `scheduleRestart` as today.
- Exit-2 branch: unchanged (no restart, no re-arm — there is no child to reap).
- `stop()`: unchanged (already cancels idle timers).

### 6. Testing

- **Supervisor** (fake timers/children): three-event lifecycle (enqueue→claim→settle→timer→reap); **headline: enqueue→claim→crash → inflight zeroed → backoff respawn → idle timer armed at restart → reap** (previously impossible); crash with queued work (enqueue×2, claim×1, crash → respawn, NO idle timer at restart since queued=1; claim+settle both → timer); settle fallback (enqueue→settle, no claim); manual-worker interleaving (claim+settle with no enqueue seen — floors hold, no timer without a child); stale-timer-cancelled-on-crash (settle→timer pending→crash→timer cancelled→restart arms a fresh one). Existing suites pass unchanged.
- **Bridge**: `onRequestClaimed` fires on successful dequeue with resolved root + kind; silent on 204.
- **`up`**: wiring test for the fourth hook; `--idle` invalid → exit 2 with the verbatim message; `--idle 0` still disables.
- **Live smoke**: `up --idle 1`; enqueue a job; `kill -9` the worker mid-run; watch backoff respawn; confirm the reap fires ~60s after the restart (the sequence that used to disable reaping); snapshot stays `managed`.

## Out of scope

- Attributing claims to specific workers (would remove the manual-worker miscount; not worth the tracking).
- The remaining ledgered follow-ups: connect-path managed-absent test, re-arm test strengthening, docs dot-legend, the panel two-writer race.

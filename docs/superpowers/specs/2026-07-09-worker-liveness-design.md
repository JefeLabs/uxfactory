# Worker liveness — presence via tagged SSE + panel surface

**Date:** 2026-07-09
**Status:** approved (design), pending implementation plan
**Scope:** step 1 of the worker-availability ladder (detect + surface). Steps 2 (`uxfactory worker`/`uxfactory up` CLI verbs with supervision) and 3 (on-demand worker spawn) are explicitly out of scope.

## Problem

A panel Seed/Generate click enqueues a `generate-artifact` (or `generate-design`) job scoped to the panel's project root. The bridge is a pure broker: it accepts the job with `200` whether or not any worker will ever claim it. Workers claim only jobs matching their own root (`store.dequeuePipelineRequest` filters on `r.root === root`), so a job for a root with no live worker sits in the in-memory FIFO forever. The only failure signal is the panel's client-side 5-minute pending timeout — a generic "Generation failed" that hides the real cause.

Diagnosed in the field 2026-07-09: six seed jobs for `uxfio-demo` queued invisibly because no worker was running for that root; the pipeline itself was healthy end-to-end.

The bridge has no concept of worker liveness today: workers are anonymous pollers. Nothing can warn "no worker is serving this project" because nothing knows.

## Load-bearing facts (verified in code)

- The worker holds a **persistent, auto-reconnecting SSE connection** to `GET /pipeline/events` as its wake signal (`clients/uxfactory-worker/src/bridge-client.ts`, `subscribeEvents`, 1s reconnect backoff). It does **not** poll `/pipeline/request/next` on a timer — it drains on start and on wake frames only. Poll-timestamp liveness would therefore false-negative during idle.
- The bridge already tracks every SSE socket in `sseClients: Map<socket, keepAliveTimer>` with a `close` handler, and writes keep-alive comments on an interval (which forces dead-TCP detection) — `packages/uxfactory-bridge/src/server.ts`, `/pipeline/events` handler.
- The panel splits state between a Zustand `useAppStore` (session state: `connection`, `fileInfo`, connect-time `snapshot`, `toasts`) and react-query (fetch-cycle data; `snapshotQuery` has `staleTime: 5s`, no polling interval). Instant banner updates therefore need a push nudge, not polling.
- Workers may be kind-filtered pools (`UXFACTORY_WORKER_KINDS`, e.g. only `generate-artifact`), so "a worker is live" is not the same as "this job kind is covered."

## Decisions (with user)

1. **Mechanism: tag the worker's existing SSE connection** (over poll-timestamp heartbeats or a new registration protocol). Presence is structural — an open socket — so there are no staleness thresholds, no new endpoints, no timers. Trade-offs accepted: an old worker binary won't be counted until restarted (same-repo version skew), and "SSE open" means "subscribed," not "actively claiming" — a wedged worker still shows live. Both noted as step-1 limitations.
2. **Panel behavior: warning banner + enqueue-anyway.** Seed/Generate stay enabled; jobs queue and run the moment a worker connects. No disabled buttons, no confirm dialog.
3. **Surfaces: Artifacts tab + Prompt composer banners, plus a ContextBar status dot** — one shared component + one store selector.
4. **Panel state: centrally managed in Zustand** (app store slice), seeded by snapshot fetches and updated live by bridge broadcast frames.

## Design

### 1. Worker self-identification (`clients/uxfactory-worker/src/bridge-client.ts`)

`WorkerBridgeClient.subscribeEvents` appends query params to its events URL:

```
GET /pipeline/events?client=worker&root=<projectRoot>&kinds=<csv>
```

- `root` is the worker's `cfg.projectRoot` (its cwd), verbatim — the same value it passes to `/pipeline/request/next`.
- `kinds` is the comma-joined `cfg.kinds`, omitted when the worker claims all kinds.
- Params are omitted entirely for non-worker callers, so panels and legacy connections look exactly like today.
- Reconnects re-announce for free (the params are on the URL the reconnect loop refetches).

### 2. Bridge presence registry (`packages/uxfactory-bridge/src/server.ts` + a small new module)

A `WorkerPresence` registry — `Map<socket, { root: string; kinds?: string[]; connectedAt: number }>` — owned by a new `packages/uxfactory-bridge/src/worker-presence.ts` (pure add/remove/list/serialize; unit-testable without HTTP).

In the `/pipeline/events` handler:

- When the request carries `client=worker` and a `root`, resolve the root through the existing `registry.resolveRequestRoot` choke point. A resolvable, served root → register presence on the socket. An unserved/unknown root → do **not** register (the connection still streams events; the worker's own claim polls will 403 as they do today).
- Deregister in the same `close` handler that already cleans up `sseClients`.
- On every add and remove, broadcast a normal pipeline frame through the existing ring + fan-out:

```json
{ "type": "worker-status", "root": "<root>", "workers": [{ "kinds": ["generate-artifact"], "connectedAt": 1783617000000 }] }
```

(`workers` is the full current list for that root — idempotent, no delta bookkeeping for consumers. The frame rides `appendPipelineEvent` with a synthetic requestId of `"worker-status"`. Replay convergence: every presence transition emits a frame, so a panel replaying the ring via `Last-Event-ID` always ends on the newest frame, which by construction agrees with the newest snapshot — stale replayed frames cannot leave the store regressed.)

`GET /project/snapshot` gains a field for the resolved root:

```ts
workers: { kinds?: string[]; connectedAt: number }[]
```

Snapshot remains the pull-truth; frames are the push-nudge. `GET /health` is unchanged.

### 3. Panel state (`packages/uxfactory-plugin/ui/stores/app.ts`)

- New slice: `workers: WorkerPresence[] | null` — `null` means *unknown* (no snapshot yet, or an older bridge that doesn't send the field), `[]` means *known none*.
- New action: `workersChanged(workers: WorkerPresence[] | null)`.
- Writers: (a) every snapshot arrival (connect + refetches) seeds the slice from `snapshot.workers ?? null`; (b) the panel's existing global SSE listener applies `worker-status` frames whose `root` matches the connected root. Last write wins; both writers carry the same shape.
- Selector: `workerCoverage(kind: string): "covered" | "uncovered" | "unknown"` — `unknown` when the slice is `null`; `covered` when any live worker's `kinds` is undefined (claims all) or includes `kind`; else `uncovered`. Version skew in either direction degrades to `unknown` → the UI shows nothing rather than a false warning.

### 4. Panel UI

One shared `WorkerBanner` component (amber warning), rendered only when coverage is `uncovered`:

> ⚠ No worker is serving this project — jobs will queue until one connects.
> Start a worker from this project's root (see the quick-start's worker section).

No copyable command in step 1 — the panel cannot know the engine checkout path, and showing a not-yet-existing `uxfactory worker` verb would lie. When step 2 ships the CLI verb, the banner gains the copyable `cd <repoPath> && uxfactory worker` line (noted in Out of scope).

Dismiss behavior: the ✕ hides the banner until the panel reloads **or** coverage transitions back to `uncovered` after having been `covered` (a fresh outage re-shows a dismissed banner).

- **Artifacts tab**: banner above the table, checking `workerCoverage("generate-artifact")`.
- **Prompt composer**: banner above the composer, checking `workerCoverage("generate-design")`.
- **ContextBar**: small status dot — green / amber / grey — where the kind set is a panel constant `ENQUEUEABLE_KINDS = ["generate-artifact", "generate-design"]` (extend here when the panel gains new job kinds): green = every kind in the set covered, amber = any kind uncovered, grey = unknown. Tooltip names the live workers and their kinds.
- Seed/Generate/Compose stay **enabled** regardless (decision 2).

### 5. Error handling & edge cases

- **Multiple workers per root** (pools): array semantics; coverage is any-of.
- **Kind-filtered worker live but wrong kind**: banner still shows for the uncovered kind (this is why coverage is per-kind, not boolean).
- **Worker wedged mid-job**: shows live — accepted step-1 limitation (liveness ≠ throughput).
- **Bridge restart**: all sockets drop; workers reconnect within ~1s and re-announce; presence self-heals without operator action.
- **Worker killed (including SIGKILL)**: socket close (forced promptly by the bridge's existing keep-alive writes) deregisters and broadcasts.
- **Unserved root at connect time** (worker started before any panel `POST /project/connect`, e.g. right after a bridge restart): not counted until served; the worker's reconnect loop re-announces on its next drop, and panel connect broadcasts no presence by itself — the plan should verify the worker's SSE reconnect cadence suffices here, or have the bridge re-evaluate tagged-but-unregistered sockets when a root becomes served. **Resolution chosen: on `POST /project/connect`, the bridge re-scans open tagged sockets and registers any whose root just became served** (cheap: iterate the socket map once per connect).
- **No persistence**: presence is process-lifetime state by definition; nothing written to disk.

### 6. Testing

- **Bridge** (`packages/uxfactory-bridge/test/`): presence module unit tests (add/remove/list/kinds); relay-level tests via the existing pipeline test harness — tagged SSE connect → snapshot `workers` populated; socket drop → empty + `worker-status` frame observed; `kinds` round-trip; unserved root not counted; connect-rescan registers a pre-connected worker.
- **Worker** (`clients/uxfactory-worker/test/`): `subscribeEvents` URL carries `client/root/kinds` (and omits `kinds` when unset) against the existing fake-bridge fetch capture.
- **Panel** (`packages/uxfactory-plugin/test/`): store tests for seeding from snapshot, frame application, root filtering, and `workerCoverage` truth table; screen tests asserting the banner renders on `workers: []`, hides on coverage and on `null`, and that the ContextBar dot maps the three states (mirroring `screen-artifacts.test.tsx` / `routing.test.tsx` patterns).

### Changesets

`@uxfactory/bridge` is published — the presence + snapshot-field change needs a `.changeset/*.md` entry. Plugin and worker are private (no changeset).

## Shipped 2026-07-09 (commits d135cd5..386a892) — follow-ups from review

Implemented and signed off (whole-branch review). Non-blocking follow-ups carried out of the review:

- Assert the promotion **broadcast** frame in the connect-rescan test (today it asserts the connect response only).
- Hook test for a snapshot **without** the `workers` field (the `?? null` legacy-bridge branch).
- Render the banner in the Artifacts screen's in-panel ArtifactEditor subview too (its Regenerate button is an enqueue entry point).
- Two-writer race: a late snapshot refetch can briefly clobber a newer `worker-status` frame (self-heals on next update; consider a provenance guard on the seed effect).
- Old-worker + new-bridge skew makes the banner copy actively false ("jobs will queue" while an untagged worker is serving them) — soften the copy or detect legacy claims when step 2 ships.

## Out of scope (later rungs)

- `uxfactory worker` / `uxfactory up` CLI verbs and crash-restart supervision (step 2) — includes upgrading the banner with the copyable start command.
- On-demand worker spawn per enqueue + idle reaping (step 3).
- Worker identity/telemetry beyond `kinds` + `connectedAt` (pid, model, current job) — the wire shapes above can grow these fields additively.

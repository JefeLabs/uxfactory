# Follow-up sweep 2 — the three design-level follow-ups (2026-07-11)

The mechanical sweep (71f0936, 8818c94) deliberately excluded three ledgered
follow-ups because each needed a design call. This spec makes the calls.

## 1. Panel two-writer race — frame-epoch provenance guard (N1/F8)

**Problem.** `useWorkerStatus` has two writers into the store's worker slice:
snapshot arrivals (10s poll + refetches) and `worker-status` SSE frames. A poll
response the bridge computed *before* a presence change can resolve *after* the
frame that reported it, briefly clobbering newer data. It self-heals on the next
frame or poll, but meanwhile the banner/dot flash — and `workersChanged`'s
fresh-outage rule resets a user's dismissal for an outage that isn't real.

**Design: frames win within an SSE epoch.** On one live SSE subscription,
frames are TCP-ordered and cannot be missed, so once a frame for the active
root has been applied, a snapshot can never carry anything newer. The hook
keeps a ref `{ root, seen }`:

- set on every applied frame (to the frame's root);
- reset when the events subscription (re)establishes — a new epoch;
- snapshot arrivals apply ONLY when the store's `workers` is `null`
  (unknown → seed; `connectFailed`/`cancelReconnect` null the slice, so any
  connection reset re-opens seeding) or the ref doesn't mark the *active* root
  as frame-seen (root switches re-seed from snapshot, since frames for inactive
  roots are filtered and may have been skipped).

**Accepted transient.** `managed` changes with no accompanying presence change
(the supervisor tracks a root on first enqueue, before the spawned worker's SSE
lands) reach the panel only via snapshot; under the guard they wait the few
seconds until the worker-connect frame. Every durable coverage change is
accompanied by a presence frame or a connection-level reset — the bridge
broadcasts only on worker connect / disconnect / promotion.

**Tests.** Seed-from-snapshot still works; frame-then-stale-snapshot keeps the
frame's list; a dismissed banner stays dismissed through a stale snapshot
(no spurious fresh-outage reset); `workers: null` re-opens snapshot writes;
switching the active root lets the new root's snapshot apply.

## 2. Banner copy under legacy-worker skew (N3)

**Problem.** A pre-liveness worker claims jobs via untagged polls; the bridge
cannot see it. The banner then asserts a falsehood: "No worker **is serving**
this project" while one is quietly serving it.

**Decision: soften the copy; do not build poll-inferred presence.** Synthesizing
TTL presence entries from `/pipeline/next` hits would add expiry timers and a
new entry shape to serve a skew window that only occurs when someone manually
runs an old checkout's worker — YAGNI at dogfood stage. The liveness spec
itself recommended softening once the CLI verbs shipped.

**Copy.** Banner line 1 becomes
`No worker detected for this project — jobs will queue until one connects.`
"Detected" is honest in both worlds: detection is exactly what the bridge
lacks for a legacy worker. Command hint and dismiss behavior unchanged.

## 3. `uxfactory batch --full` — restore full-project gating

**Problem.** A scoped Generate stamps `unit`/`storyRefs` into
`uxfactory.batch.json`; a plain `uxfactory batch` inherits that scope. Recon
finding: the worker ALREADY clears the stamp on an unscoped Generate
(set-or-clear semantics, `generative.ts` → `ensureBatchRegistry`), so the
panel path heals itself. The unfixed path is CLI-only: re-gating the full
project *without* running a new Generate requires hand-editing JSON — which is
what the docs currently instruct.

**Decision: `--full` ignores AND clears.**

- For this run, `unit` and `storyRefs` are treated as absent — both the
  HTML-mode and spec-mode paths (achieved by dropping them from the parsed
  registry before either path consumes it).
- On disk, if either key is present, the file is rewritten without them —
  all other fields preserved — with a stderr note. Clearing (not just
  ignoring) makes the flag a restoration verb: subsequent plain runs are full
  again. The clear happens before gating; an explicit `--full` keeps the stamp
  cleared even when the gate then fails.
- No stamp present → byte-identical file, no note: the flag is a safe no-op.
- Other worker stamps (`viewports`, `designStyle`, `ungoverned`,
  `maxIterations`) are not scope and are untouched.

**Docs.** QUICK-START's recovery sentence points at `--full` instead of manual
JSON edits; the quoted banner copy updates to match §2. Changeset:
`@uxfactory/cli` minor.

## Out of scope

- Poll-inferred legacy presence (§2 rationale).
- The full-suite flake stays a watch item (non-reproducible; SSE suites
  stable 3/3 on repetition).

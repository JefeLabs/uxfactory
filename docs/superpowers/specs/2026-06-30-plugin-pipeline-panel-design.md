# UXFactory — Plugin Pipeline Panel (Subsystem A) design

**Date:** 2026-06-30
**Status:** draft — awaiting user review
**Supersedes:** the plugin-UI section (§5, the "4-step wizard") of `2026-06-29-plugin-pipeline-ui-and-worker-design.md` — that doc's **worker** half is built (Phase 11B); this refines the **panel** into a hybrid `project → job → gates` experience.
**Builds on:** Phase 11B (bridge `/pipeline/*` relay + SSE; `clients/uxfactory-worker`); the existing Phase 9/10 plugin (vanilla-TS + esbuild UI, `code.ts`/`ui.ts`/`ui.html`/`messages.ts`/`panel.ts`).

## 1 · Goal
A Figma-plugin panel that lets a user drive the whole UX pipeline: **define a project** (classification), then work it as **jobs** (Stories · Acceptance Criteria · User Journeys), each with **gates** (pass/fail + conformance) — generating artifacts via the worker and watching progress stream live. The panel is a **pure relay + UI**: it enqueues `/pipeline/*` requests, subscribes to SSE, and renders results. **It holds no LLM and has no helmsmith/cloud awareness** (the engine-self-contained invariant; the worker does all generation).

## 2 · Information architecture: `project → job → gates`
```
Project            classification vector (category·industry·age·style·4 scope dials)
  └─ Job           a requirement-artifact workstream: Stories · ACs · Journeys
       └─ Gates    per-job checks: requirement-coverage · flow-reachability · coverage-orphans · token-conformance
```
- **Project** is defined once via intake (chips) → `classify` → a **manifest** (which artifacts are requested/generatable/suppressed) → the manifest *derives which jobs are active* and *which gates are hard/soft*.
- **v1 = one project** (the connected worker's `projectRoot`/`uxfactory.classification.json`). Multi-project switching is future (the `Checkout ▾` header is a placeholder).

## 3 · Layout (hybrid: rail + per-job thread)
```
┌─ UXFactory ───────────────────────────── ● connected ┐
│ Checkout ▾          [ Stories ][ ACs • ][ Journeys ]  │  header: project ▾ + job tabs (chips)
│ gates  ✓ coverage   ⚠ tokens   ✗ flow                 │  gate-status strip (active job)
├───────────────────────────────────────────────────────┤
│ Job · Acceptance Criteria                             │
│ inputs   scope [ visual ◖med◗ ] [ flow ◖high◗ ]       │  chips
│          seed  [ Stories: 4 ✓ ]                       │  upstream-seed indicator
│ ◐ drafting AC-2 "empty cart"…              (live)     │  SSE stream line
│ ✓ AC-1  checkout success → Story S-1                  │  artifacts accrue + cross-link
│ ✓ AC-2  empty cart       → Story S-2                  │
│ ○ AC-3  …                                             │
│ [ Generate ]   [ Provide my own ]                     │
│ ── gate ───────────────────────────────────────────  │
│ requirement-coverage  ✓ pass   ·   orphans  ✓         │
│ [ Run gates ]                              report ▸   │
└───────────────────────────────────────────────────────┘
```
- **Header** (persistent): project name ▾, the 3 **job tabs** as chips (active highlighted), and the **gate-status strip** for the active job (✓ pass / ⚠ soft / ✗ hard-fail / ○ not-run).
- **Body** (active job): an `inputs` row (scope-dial chips + the upstream-seed indicator), a chat-like **stream/artifact area** (live SSE line on top, accrued artifacts below with cross-links), the `Generate` / `Provide my own` actions, and the **gate panel** (per-gate result + `Run gates` + a `report ▸` expander).
- **States** (`panel.ts`): keep the existing `COMPACT`/`CONNECTED_MIN`; add a `PIPELINE` size (e.g. 600×640) for this richer panel. Intake (project definition) is a first-run overlay/step in the body before any job exists.

## 4 · The 3 jobs (Stories → ACs → Journeys)
| Job tab | Underlying artifact | Generates via | Depends on (seed) | Primary gate(s) |
|---|---|---|---|---|
| **User Stories** | `AcceptanceCriterion` (story narratives) | `generate-artifact` `target:'user-story'` | the project classification | requirement-coverage |
| **Acceptance Criteria** | `AcceptanceCriterion` (criteria per story) | `generate-artifact` `target:'acceptance-criteria'` | the **Stories** job | requirement-coverage, coverage-orphans |
| **User Journeys** | `UserFlow` | `generate-artifact` `target:'user-journey'` | the **Stories** job | flow-reachability |
- **Build chain + cross-links:** ACs trace to their Story; a Journey spans Stories. A downstream job shows its seed status (`Stories: 4 ✓`) and is gently gated on the upstream existing (you *can* generate ACs before stories, but the panel nudges the order).
- **Persistence:** Stories + ACs persist into the `AcceptanceCriterion` artifact (stories carrying their ACs); Journeys into `UserFlow` — i.e. 3 *workstreams/views*, 2 underlying artifact files.

## 5 · Flow mapped to `/pipeline/*` (Phase 11B contract)
| Step | Pipeline call | Result | Live |
|---|---|---|---|
| Define project | `POST /pipeline/request {kind:'classify', payload:{classification}}` → poll `result/:id` | manifest (requested/generatable/suppressed + gate effects) | — |
| Generate (per job) | `{kind:'generate-artifact', payload:{target, classification, seedRefs, scope}}` | the drafted artifact (path + content) | **SSE** |
| Provide my own | (panel-local) paste → POST as the artifact (or write via a `provide` kind) | stored artifact | — |
| Run gates (per job) | `{kind:'gate', payload:{dir, scope}}` (+ `{kind:'review'}` for conformance) | gate report (per-gate pass/fail) | **SSE** |
- The panel opens **one** `GET /pipeline/events` SSE connection and **routes** each event by `requestId` to the originating job's stream / gate strip. Results are polled via `GET /pipeline/result/:id` (202 pending → 200 done), with the SSE acting as the low-latency progress + completion nudge.
- **`sk-…`/secret masking** already happens worker-side (Phase 11B); the panel renders events verbatim and ignores unrecognized event types (forward-compatible).

## 6 · Cross-component contract (the one worker/skill extension)
3 distinct generation workstreams require `generate-artifact` to accept a **`target`** discriminator (`'user-story' | 'acceptance-criteria' | 'user-journey'`) and **`seedRefs`** (upstream artifact refs). The plan extends:
- `clients/uxfactory-worker` generative dispatch + `skill/generate/SKILL.md` to honor `target` (draft the targeted artifact, seeded by `seedRefs`) and write to the correct artifact file.
- This is the only non-panel change; everything else is additive panel code. (If we'd rather keep v1 zero-worker-change, the fallback is: generate Stories+ACs together as one `AcceptanceCriterion` call and make the Stories/ACs tabs two *views* — noted as the smaller alternative.)

## 7 · Modules & build (vanilla TS + esbuild, no React)
New panel modules under `packages/uxfactory-plugin/src/`:
- `pipeline-client.ts` — the `/pipeline/*` + SSE wrapper: `enqueue(kind,payload)→id`, `pollResult(id)`, `subscribe(onEvent)` (EventSource/`fetch`-stream to `/pipeline/events`, `Last-Event-ID` resume, reconnect). Mirrors the existing health/poll style; the **only** new bridge surface.
- `panel-state.ts` — the store: `{ connection, project:{classification,manifest}, jobs:{[type]:{artifacts,gates,stream,seedStatus}}, activeJob }` + reducers; pure, unit-testable.
- `chips.ts` — the chip component (single- & multi-select; `low|med|high` dial chips; selected/disabled states) driven by the enums in §8.
- `pipeline-view.ts` — renders the header (project/job tabs/gate strip) + the active-job body from state; wires chip/button events to `pipeline-client` + state.
- Reuse the existing connection/health polling and `parent.postMessage` plumbing. `code.ts` (main thread) is **untouched in v1**. `messages.ts` gains UI-internal types only if needed (no new main↔ui messages for v1).
- Build: extend the esbuild step that inlines `ui.ts` into `ui.html`; `manifest.json` already allows `localhost:3779`.

## 8 · Chip vocabulary (the enums, from the engine)
- **category** `marketing·ecommerce·web_app·news` · **industry** `education·corporate·healthcare·finance·consumer` · **age** `children·teens·18-25·26-35·36-50·50+` · **style** `informal·mix·formal`
- **scope dials** (each `low·medium·high`): `visual·editorial·coverage·flow`; **presets** `wireframe·content·visual·interactive·production`
- **gates** `requirement-coverage·token-conformance·flow-reachability·coverage-orphans·reuse` (effect `hard·soft·suppressed`)
- Compliance badges (derived, read-only): `FERPA·COPPA·HIPAA·disclosure`.

## 9 · Errors & edge cases
- **Bridge disconnected** → the existing connection dot + a disabled body ("start the bridge"). **Worker absent** → requests enqueue but never resolve; show a "no worker connected" hint after a timeout (the bridge has no worker-liveness signal in v1 — surface pending-too-long).
- **Generation/setup error (status 2)** → the job shows the failure inline (the AdapterError class/message), `Generate` re-enabled.
- **Gate hard-fail (status 1)** → the gate strip shows ✗ + the failing gate's report; the job stays open for re-generate.
- **SSE drop** → `pipeline-client` reconnects with `Last-Event-ID`; the panel is resilient to replayed events (idempotent by event id).

## 10 · v1 scope
**In:** intake (classification chips → manifest); the 3 job tabs with generate (SSE) / provide; per-job gates with live report; the gate-status strip; the `generate-artifact` `target`/`seedRefs` worker+skill extension. **Out (future):** multi-project switching; rendering generated specs onto the Figma canvas (reuse the existing Phase-9/10 render flow as a later tie-in); auth; the non-requirement artifacts (TokenSet/BrandGuide/A11y) as their own tabs (they condition the project/gates in v1).

## 11 · Self-contained / boundary invariants (must hold)
- Panel imports **no** `@helmsmith/*`, no LLM, no `agentcore`/`runpod`/`cloud`. Only the bridge HTTP surface.
- The bridge stays an opaque relay (no `@uxfactory/cli` import). The worker remains the only helmsmith consumer.
- The cc-invariant (skills carry no `agentcore`/`runpod`/`cloud`) continues to hold for the extended `skill/generate`.

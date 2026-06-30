# UXFactory — Plugin Pipeline UI + Agent Worker (design)

**Date:** 2026-06-29
**Status:** draft — awaiting user review
**Grounds in:** Implementation PRD §5–7 (plugin), companion PRD §3/§5.8/§6.6 (intake/conditioning); builds on Phase 8 (`classify`/intake skill), Phase 6 (`batch`), Phase 9/10 (bridge relay → plugin annotate; the `/canvas`→`/review` pattern).
**The ask:** the Figma plugin panel should drive the WHOLE pipeline — define a project, collect/generate the gating artifacts, then gate — not just render/review. And that requires a real **agent + loop that runs the skills we built** when the panel (not a human terminal) initiates the work.

## 1. Problem

Today the intake→artifact→gating pipeline runs only from a terminal: the `uxfactory-intake` SKILL.md conducts it interactively and a human runs `uxfactory classify`/`batch`. The plugin panel only renders + reviews. We want the **panel to be the front-end for the entire pipeline**, and an **autonomous worker** to fulfill the generative steps so nobody has to sit in a terminal. The engine stays deterministic and LLM-free; the worker is a new *client* that runs our skills.

## 2. Three tiers (the engine stays self-contained)

```
Figma plugin PANEL (no LLM)        bridge (pure relay + SSE)        worker  (clients/uxfactory-worker — NEW client)
─────────────────────────         ─────────────────────────        ──────────────────────────────────────────────
1 Define project   ── POST /pipeline/classify ──►  queue  ◄──── SSE subscribe (push)
2 Scoping (manifest)◄─ result/event ◄──────────────relay  ◄───── dispatch by request kind:
3 Collect/Generate ── POST /pipeline/generate ──►  queue          • deterministic (classify/gate/batch/render/review)
   per artifact: [Provide]│[Generate]                                  → run `uxfactory` CLI (child_process) — NO LLM
4 Confirm & gate   ── POST /pipeline/gate ─────►  queue           • generative (generate-artifact / canvas-review)
   panel ◄─ gate report + live events ◄──────────relay               → @helmsmith/agent-adapter invoke({system: SKILL.md, user: task})
                                                                   post result + stream .events back ──► bridge ──► panel
```

- **Engine (`packages/*`) is unchanged and self-contained** — no LLM, no helmsmith awareness. The bridge gains relay endpoints + an SSE stream but stays pure relay (stores requests, serves them, streams worker events back). The CLI gains nothing new for this (it already has classify/batch/review/render/canvas).
- **Worker (`clients/uxfactory-worker`) is a NEW client** (like `uxfactory-cc`), the autonomous fulfiller of the same relay contract the terminal agent already satisfies. It depends on `@helmsmith/agent-adapter` (local file/link dep for now).
- **Panel (`packages/uxfactory-plugin`)** gains a pipeline wizard that posts requests + subscribes to the event stream.

## 3. The worker (`clients/uxfactory-worker`)

A long-running Node process. The integration is small because the adapter contract is small:
```ts
// @helmsmith/agent-adapter
interface InvocationSpec { system?: string; user: string }
interface AgentAdapter { readonly events: AdapterEventSource; invoke(spec): Promise<string> }
```

**Loop:** subscribe to the bridge event stream (SSE/long-poll) → on a pending request, **dispatch by kind**:
- **Deterministic** (`classify`, `gate`, `batch`, `render`, `review`): run the `uxfactory` CLI via `child_process` in the project dir, capture exit code + stdout (`--json`), post the result. NO LLM — fast + cheap. (The worker is the panel's hands for CLI commands the iframe can't run.)
- **Generative** (`generate-artifact`, `canvas-review`): build `InvocationSpec{ system: <the matching SKILL.md content>, user: <the task + project context> }` and `adapter.invoke(spec)`. The adapter (ClaudeSdk / OpenCode / … selected via `bindingToAdapter`) supplies the file+shell tools, so the skill runs exactly as in a terminal — it calls the `uxfactory` CLI and writes `stories.json`/`tokens.ds.json` in the project dir. The skills are reused **verbatim as system prompts** — no skill rewrites.

**Streaming:** forward `adapter.events` (`AdapterEventBus`) to the bridge → SSE → the panel shows live progress. `replayThenSubscribe` covers a late/reconnecting panel.

**Errors map to our exit contract:** the adapter's classified errors (`AuthError`/`BillingError`/`RateLimitError`/`NetworkError` = transport/setup → `2`; a gate FAIL from the CLI → `1`; clean → `0`) are posted to the panel so the panel speaks the same `0 ok / 1 real signal / 2 setup` language as the CLI.

**Project context:** each request carries (or the worker is configured with) the project root, so the CLI + file writes land where `uxfactory.classification.json` / the inputs registry live.

**Auth / credentials:** the worker uses `@helmsmith/agent-auth` DIRECTLY (not just transitively): every adapter's options require a `CredentialBroker`, and `CredentialBroker` / `AuthStore` / the binding-resolver live in agent-auth — it resolves the provider + the subscription/credentials. So the worker builds a broker (agent-auth) → selects an adapter (`bindingToAdapter`) → `invoke`.

**Consumption (TWO helmsmith packages, chain stops there):** the worker links `@helmsmith/agent-adapter` AND `@helmsmith/agent-auth` from the local helmsmith checkout (`file:`/`pnpm link`). `agent-auth` has `dependencies: {}` — no further workspace deps — so the link surface is exactly these two. Both are source-first ESM (`exports → ./src/index.ts`, no built `dist`), so the worker must run/compile their TS source (a `tsx`/TS-runtime worker, or fold them into the worker's build). Documented as a dev-link; not portable without helmsmith present (productionize via publish later). The ENGINE never depends on either — only this client.

## 4. The bridge additions (still a pure relay)

Mirror the Phase 9/10 relay pattern. New request queues + result store + an event stream:
- `POST /pipeline/<kind>` (kind ∈ classify|generate|gate|…) — store a pipeline request (the panel's payload: classification vector, or artifact kind + context, or the confirmed profile). `GET /pipeline/next` (or the SSE stream) — the worker pulls pending work.
- `POST /pipeline/result` — the worker posts a request's result (manifest / drafted artifact / gate report). `GET /pipeline/result/:id` — the panel fetches it.
- `GET /pipeline/events` (SSE) — the worker pushes `AdapterEvent`s; the bridge fans them out to the panel (and to the worker for pull). Long-poll fallback for clients without SSE.
- No business logic in the bridge — it stores + serves + streams. No `@uxfactory/cli` import (no cycle).

## 5. The plugin panel (`packages/uxfactory-plugin`)

A wizard in the existing panel (`panel.ts`/`ui.ts`), build-to-spec (pure state machine + a focused harness; live DOM noted in the contract notes):
1. **Define project** — a form for the 7 classification dims (category/industry/age/style/4 scope dials/flow_refs) → `POST /pipeline/classify`.
2. **Scoping** — render the returned manifest: requested/generatable/suppressed artifacts + provenance (`derived_from`).
3. **Collect/Generate** — per REQUESTED artifact: status (provided/missing) + `[Provide]` (paste/upload → the panel POSTs the artifact for the worker/CLI to write) or `[Generate]` (→ `POST /pipeline/generate` → the worker drafts it via the skill → the panel shows it for approval/edit). Asymmetric friction (removing a requested artifact needs justification, citing `derived_from`).
4. **Confirm & gate** — on sign-off → `POST /pipeline/gate` → the worker runs `classify --confirm` + `batch` → the panel shows pass/fail per gate + the report inline. Iterate.
Live `AdapterEvent`s stream into a progress strip throughout.

**Complement, not replace:** the panel and the `uxfactory-intake` SKILL.md produce the SAME files (`uxfactory.classification.json` / artifacts / `uxfactory.profile.json`). Interchangeable front-ends over one engine; the terminal agent can fulfill panel requests too (same relay). The worker just makes it autonomous.

## 6. Engine vs. agent split (preserved)

| Concern | Owner |
| --- | --- |
| Classification schema, `condition()`, `classify`, `batch`, `review`, `render` (deterministic) | **Engine** (`packages/*`, unchanged) |
| Bridge relay queues + result store + SSE fan-out (pure relay) | **Engine** (`bridge`, no LLM, no cycle) |
| The pipeline wizard UI + live event display | **Engine** (`plugin`, no LLM) |
| Running the deterministic CLI on the panel's behalf | **Worker** (`clients/uxfactory-worker`, child_process — no LLM) |
| **Generating artifacts / the vision mapping** (running the SKILLs) | **Worker** via `@helmsmith/agent-adapter` (the LLM tier) |

## 7. Build order (decomposes into two subsystems)

**Subsystem B — the worker runtime (foundational; testable against the EXISTING `/canvas` relay first):**
1. Bridge: the `/pipeline/*` relay queues + result store + SSE event stream (pure relay; mirror Phase 9/10).
2. `clients/uxfactory-worker` scaffold: the process, config (project root, bridge URL, the adapter binding + agent-auth), the `@helmsmith/agent-adapter` local link, the SSE subscribe loop.
3. Worker deterministic dispatch: `classify`/`gate`/`batch`/`render`/`review` via `child_process` → post results (+ map exit codes).
4. Worker generative dispatch: `generate-artifact` + `canvas-review` via `adapter.invoke({system: SKILL.md, user})` → post results + stream `.events`.

**Subsystem A — the panel wizard (the front-end):**
5. Plugin pipeline wizard: the 4-step state machine (pure) + the bridge calls + the live event strip (build-to-spec).
6. End-to-end integration: panel → bridge → worker → CLI/skill → results → panel, on a sample project; document the dev-link setup + the live-Figma steps.

(Each subsystem becomes its own implementation plan; the worker lands first so the panel has something to talk to. Both can be exercised before the other is done — the worker against the existing `/canvas` relay + the CLI; the panel against a stub.)

## 8. Decisions (locked)

- **Artifact generation is agent-delegated** via the bridge relay (the panel never holds an LLM); the worker runs the SKILLs.
- **The v1 panel does the FULL pipeline** through gating + results inline.
- **The panel complements the terminal intake skill** — same files, interchangeable front-ends.
- **The worker uses `@helmsmith/agent-adapter`** (runtime-agnostic `AgentAdapter`; skills reused verbatim as `system` prompts; classified errors → our exit contract), **SSE/long-poll push**, **local file/link dep** for now.
- **The engine stays self-contained** — only `clients/uxfactory-worker` (a client) depends on helmsmith; `packages/*` learn nothing about it.

# Plugin Pipeline Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the Figma-plugin **pipeline panel** — a hybrid `project → job → gates` UI (3 job tabs: Stories · Acceptance Criteria · User Journeys) with chip selectors — that drives the Phase-11B pipeline (`/pipeline/*` + SSE), plus the one cross-component worker/skill extension (`generate-artifact` `target`/`seedRefs`) that makes the 3 jobs real workstreams.

**Architecture:** The panel is a pure relay + UI (no LLM, no helmsmith, no cloud): it enqueues `/pipeline/*` requests, subscribes to one SSE stream, and renders results. New vanilla-TS modules (`pipeline-client`/`panel-state`/`chips`/`pipeline-view`) wire into the existing esbuild-inlined `ui.ts`/`ui.html`. `code.ts` (main thread) is untouched in v1. The worker gains a `target` discriminator so Stories→ACs→Journeys generate as seeded workstreams.

**Tech Stack:** TS 6.x ESM/NodeNext, `.js` import specifiers, `verbatimModuleSyntax`; esbuild (inlines `ui.ts` into `ui.html` at `/*__UI_BUNDLE__*/`); Vitest 4.1.9; Figma plugin (`figma.ui.postMessage`/`parent.postMessage`). Bridge at `http://localhost:3779`. Worker under `tsx` on `@helmsmith/agent-adapter`.

**Authoritative design:** `docs/superpowers/specs/2026-06-30-plugin-pipeline-panel-design.md`.

## Global Constraints
- **Engine self-contained / boundary (load-bearing):** the panel imports NO `@helmsmith/*`, NO LLM, and NO `agentcore`/`runpod`/`cloud` strings — only the bridge HTTP surface (`/pipeline/*`, reusing the existing `/health`). The bridge stays an opaque relay (no `@uxfactory/cli` import). The worker remains the only helmsmith consumer. The cc-invariant (skills carry no `agentcore`/`runpod`/`cloud`) holds for the extended `skill/generate`.
- **WORK ON `main`.** Scoped commits (never `git add -A`; leave unrelated `.gitignore`/scratch). Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>.
- **No new runtime deps in the plugin** (vanilla TS + esbuild; no React). The worker may use only what it already has.
- **Pipeline contract (Phase 11B, fixed):** `POST /pipeline/request {kind,payload}`→`{id}`; `GET /pipeline/result/:id` 200/202/404; `GET /pipeline/events` SSE (`id:`/`data:` frames, `Last-Event-ID` resume). Kinds: `classify`/`gate`/`batch`/`review`/`render` (deterministic) + `generate-artifact`/`canvas-review` (generative). Status 0 ok / 1 gate-fail / 2 setup.
- **Enums (chips) — copy verbatim:** category `marketing·ecommerce·web_app·news`; industry `education·corporate·healthcare·finance·consumer`; age `children·teens·18-25·26-35·36-50·50+`; style `informal·mix·formal`; scope dials `visual·editorial·coverage·flow` each `low·medium·high`; presets `wireframe·content·visual·interactive·production`; gates `requirement-coverage·token-conformance·flow-reachability·coverage-orphans·reuse`.

---

## Task 1: Worker `generate-artifact` `target` + `seedRefs` (the cross-component extension)
**Files:** Modify `clients/uxfactory-worker/src/generative.ts`, `skill/generate/SKILL.md`; Test `clients/uxfactory-worker/test/generative.test.ts` (or the existing worker test).
**Interfaces — Produces:** `generate-artifact` payload now `{ target: 'user-story'|'acceptance-criteria'|'user-journey'; classification?: unknown; seedRefs?: string[]; scope?: ScopeFlags; path?: string }`. `runGenerative` maps `target` → the artifact file path + the skill emphasis, and threads `seedRefs` into the user message.

- [ ] **Step 1 — Failing test:** with a FAKE `AgentAdapter` (records the `AgentInput`), a `generate-artifact` request `{target:'acceptance-criteria', seedRefs:['S-1','S-2'], classification:{...}}` → assert the built `AgentInput.systemPrompt` = the `generate` skill body AND `messages[0].content` contains the target (`acceptance-criteria`), the seed refs (`S-1`,`S-2`), and the resolved artifact path. Add a second case: `target:'user-journey'` resolves the `UserFlow` path; `target:'user-story'`/`'acceptance-criteria'` resolve the `AcceptanceCriterion` path. A missing/invalid `target` → status 2 (typed error).
- [ ] **Step 2 — RED:** run the worker tests, confirm the new cases fail.
- [ ] **Step 3 — Implement:** in `runGenerative`, add a `TARGET_MAP: Record<target,{artifact, pathHint, emphasis}>` (`user-story`→AcceptanceCriterion/"draft the user-story narratives", `acceptance-criteria`→AcceptanceCriterion/"draft testable acceptance criteria for the seeded stories", `user-journey`→UserFlow/"draft the user journey/UserFlow spanning the seeded stories"). Build the user message to include the emphasis + `seedRefs` + the path; validate `target` (reject→status 2). Keep the existing `canvas-review` path unchanged.
- [ ] **Step 4 — Skill:** extend `skill/generate/SKILL.md` to branch on the stated target (draft ONE of: user-story narratives / acceptance criteria for given stories / a user journey spanning given stories), honor seeds, write to the named path. Keep it self-contained — NO `agentcore`/`runpod`/`cloud` strings (cc-invariant).
- [ ] **Step 5 — GREEN + verify:** `pnpm --filter uxfactory-worker test` green; `pnpm --filter uxfactory-worker typecheck` 0; grep `skill/generate` clean of forbidden strings.
- [ ] **Step 6 — Commit** `clients/uxfactory-worker skill`.

## Task 2: `pipeline-client.ts` — the `/pipeline/*` + SSE wrapper
**Files:** Create `packages/uxfactory-plugin/src/pipeline-client.ts`; Test `packages/uxfactory-plugin/src/pipeline-client.test.ts`.
**Interfaces — Produces:**
```ts
export interface PipelineClient {
  enqueue(kind: string, payload?: unknown): Promise<string>;            // POST /pipeline/request -> id
  pollResult(id: string): Promise<{ status: 'pending' } | { status: 'done'; result: { status: number; result: unknown } } | { status: 'unknown' }>;
  subscribe(onEvent: (e: { requestId: string; event: unknown; seq: number }) => void): () => void; // SSE; returns unsubscribe
}
export function createPipelineClient(baseUrl: string, deps?: { fetch?: typeof fetch; EventSourceCtor?: typeof EventSource }): PipelineClient;
```
- [ ] **Step 1 — Failing test:** inject a fake `fetch`. `enqueue('classify',{...})` POSTs `/pipeline/request` with `{kind,payload}` and returns the `id`. `pollResult(id)` maps 200→`done` (with `{status,result}`), 202→`pending`, 404→`unknown`. `subscribe` parses `data:` frames (ignoring `:`-comment keep-alives) into `onEvent`, dedupes by `seq`/event id, and the returned fn unsubscribes (closes the source). Reconnect uses `Last-Event-ID`.
- [ ] **Step 2 — RED.**
- [ ] **Step 3 — Implement** using `fetch` + an injectable `EventSource` (or a `fetch`-stream reader if EventSource isn't available in the plugin iframe — pick what the manifest/iframe supports; document). NO helmsmith/LLM imports.
- [ ] **Step 4 — GREEN + verify:** `pnpm --filter @uxfactory/plugin test` green (or the plugin's test runner) + typecheck 0.
- [ ] **Step 5 — Commit** `packages/uxfactory-plugin`.

## Task 3: `panel-state.ts` — the store
**Files:** Create `packages/uxfactory-plugin/src/panel-state.ts`; Test `packages/uxfactory-plugin/src/panel-state.test.ts`.
**Interfaces — Consumes:** the `target` job ids `'user-story'|'acceptance-criteria'|'user-journey'`. **Produces:**
```ts
export type JobId = 'user-story' | 'acceptance-criteria' | 'user-journey';
export interface PanelState {
  connection: 'connected' | 'disconnected';
  project: { classification: Partial<Classification>; manifest?: Manifest } | null;
  jobs: Record<JobId, { artifacts: Artifact[]; gates: GateResult[]; streamLine?: string; seedStatus?: string; pendingId?: string }>;
  activeJob: JobId;
}
export const initialState: PanelState;
export function reduce(s: PanelState, a: PanelAction): PanelState; // pure
// actions: setConnection, setClassification(field,value), setManifest, setActiveJob, jobEnqueued(job,id),
//          jobEvent(job,event), jobResult(job,{status,result}), gateResult(job,gates)
```
- [ ] **Step 1 — Failing test:** `reduce` is pure (no mutation of input). `setActiveJob` switches; `jobEnqueued` records `pendingId`; `jobEvent` updates `streamLine` for the right job ONLY; `jobResult` appends artifacts + clears `pendingId`; `gateResult` sets the job's gates; `setManifest` derives which jobs are active/seed-gated (e.g. `acceptance-criteria`/`user-journey` show `seedStatus` from the `user-story` artifact count). Routing by job is correct (an event for job A never mutates job B).
- [ ] **Step 2 — RED → Step 3 — Implement** (immutable reducers) → **Step 4 — GREEN + typecheck 0.**
- [ ] **Step 5 — Commit.**

## Task 4: `chips.ts` — the chip component
**Files:** Create `packages/uxfactory-plugin/src/chips.ts`; Test `packages/uxfactory-plugin/src/chips.test.ts`.
**Interfaces — Produces:** pure render + event helpers (no framework):
```ts
export interface ChipGroup { id: string; options: { value: string; label: string }[]; mode: 'single'|'multi'; selected: string[]; disabled?: boolean }
export function renderChips(g: ChipGroup): string;                 // returns HTML string (esbuild-inlined UI uses string templating)
export function toggleChip(g: ChipGroup, value: string): string[]; // returns the next `selected` (single replaces; multi toggles)
export function dialChip(id: string, level: 'low'|'medium'|'high'): string; // the low/med/high dial control
```
- [ ] **Step 1 — Failing test:** `toggleChip` single-mode replaces selection; multi-mode adds/removes; `renderChips` marks selected + disabled; the dial renders the 3 levels with the active one marked; output is safe HTML (escape labels). Use the verbatim enums from Global Constraints in a fixture.
- [ ] **Step 2 — RED → Step 3 — Implement → Step 4 — GREEN + typecheck 0.**
- [ ] **Step 5 — Commit.**

## Task 5: `pipeline-view.ts` — render header/body from state + wire events
**Files:** Create `packages/uxfactory-plugin/src/pipeline-view.ts`; Test `packages/uxfactory-plugin/src/pipeline-view.test.ts`.
**Interfaces — Consumes:** `PanelState`/`reduce` (Task 3), `renderChips`/`toggleChip`/`dialChip` (Task 4), `PipelineClient` (Task 2). **Produces:**
```ts
export function renderPanel(s: PanelState): string;  // header (project ▾ + job tabs + gate strip) + active-job body + intake overlay when project===null
export function wirePanel(root: HTMLElement, opts: { client: PipelineClient; getState(): PanelState; dispatch(a: PanelAction): void }): void; // attaches click/SSE handlers
```
- [ ] **Step 1 — Failing test (jsdom/string):** `renderPanel` with `project===null` renders the **intake** (classification chips + a Define button); with a project + `activeJob='acceptance-criteria'` renders the 3 job tabs (active marked), the gate strip, the scope-dial chips, the seed indicator, the stream line, the artifact list with cross-links, and Generate/Provide/Run-gates. `wirePanel`: clicking a job tab dispatches `setActiveJob`; Generate calls `client.enqueue('generate-artifact',{target:activeJob,seedRefs,...})` then records `jobEnqueued`; an incoming SSE event for that `requestId` dispatches `jobEvent`/`jobResult` to the right job; Run-gates calls `enqueue('gate',...)`→`gateResult`. Assert no `@helmsmith`/LLM/`agentcore` strings anywhere in the module (boundary test).
- [ ] **Step 2 — RED → Step 3 — Implement** (string-render + delegated event handlers; map `requestId`→job via the store's `pendingId`s) → **Step 4 — GREEN + typecheck 0.**
- [ ] **Step 5 — Commit.**

## Task 6: Integrate into `ui.ts`/`ui.html`, build, e2e, boundary verification
**Files:** Modify `packages/uxfactory-plugin/src/ui.ts` (mount the pipeline panel + the connection/health reuse), `src/ui.html` (a container for the panel), `src/panel.ts` (add a `PIPELINE` size ~600×640), the esbuild config if needed; Test `packages/uxfactory-plugin/src/pipeline-e2e.test.ts`.
- [ ] **Step 1 — Failing e2e:** stand up an in-process bridge (reuse `@uxfactory/bridge` `startBridge` in the test) + a FAKE worker loop (drains `/pipeline/request/next`, posts canned `result`/`event`s). Drive the panel store+view through: intake `classify` → manifest → switch to Stories → Generate (event stream → artifacts) → switch to ACs (seedStatus reflects Stories) → Run gates → gate strip updates. Assert the full state transitions.
- [ ] **Step 2 — RED → Step 3 — Wire** `ui.ts`: on health-connected, mount `renderPanel`/`wirePanel` with a real `pipeline-client` against `localhost:3779`, reusing the existing poll/connection plumbing; the existing render/review UI stays. Add the `PIPELINE` panel size + resize on mount.
- [ ] **Step 4 — Build:** run the esbuild step; confirm `dist/ui.html` inlines the new bundle (the panel renders) and `dist/code.js` is unchanged. `pnpm --filter @uxfactory/plugin typecheck` 0.
- [ ] **Step 5 — Boundary verification (load-bearing):** grep the whole plugin `src/` — NO `@helmsmith`, no `agentcore`/`runpod`/`cloud`, no LLM. Confirm the bridge still has no `@uxfactory/cli` import. Run `pnpm -r test` → green (incl. the new suites). Run the cc-invariant test.
- [ ] **Step 6 — Commit** `packages/uxfactory-plugin`.

## Self-Review
- Panel is pure relay + UI: no `@helmsmith`/LLM/`agentcore`/`cloud` (boundary tested in Tasks 5+6). ✓
- `project → job → gates`: intake `classify`→manifest; 3 job tabs generate via `generate-artifact` `target`/`seedRefs` (Task 1); gates via `gate`/`review`; one SSE routed by `requestId`. ✓
- Stories→ACs→Journeys seeding + cross-links surfaced (state Task 3, view Task 5). ✓
- Vanilla TS + esbuild, no React/new deps; `code.ts` untouched; the existing render/review UI preserved. ✓
- TDD per task; each task independently testable + committable; `pnpm -r test` green at the end. ✓
- v1 excludes (per spec): multi-project switching, canvas auto-render, auth, non-requirement-artifact tabs. ✓

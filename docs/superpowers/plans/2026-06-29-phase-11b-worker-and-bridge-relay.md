# Phase 11B — Pipeline Worker + Bridge Relay Implementation Plan (v2: new agent-adapter surface)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the runtime that lets the (future) plugin panel drive the whole pipeline: a bridge `/pipeline/*` relay + SSE event stream, and a NEW `clients/uxfactory-worker` that subscribes to the bridge and fulfills requests — running the `uxfactory` CLI for deterministic work and running our SKILLs (via the rebuilt `@helmsmith/agent-adapter`) for generative work.

**Architecture:** The engine stays self-contained. The **bridge** gains a pure relay: pipeline-request queue + result store + an SSE event stream (no business logic, no `@uxfactory/cli` import). The **worker** (a client, like `uxfactory-cc`) subscribes and **dispatches by request kind** — *deterministic* (`classify`/`gate`/`batch`/`render`/`review`) → run the `uxfactory` CLI via `child_process`; *generative* (`generate-artifact`/`canvas-review`) → run a SKILL via a `@helmsmith/agent-adapter` **autonomous** adapter. The worker depends on the new `AgentAdapter` interface so its logic is testable with a fake; the real adapter is constructed only in the composition root (Task 2). Authoritative design: `docs/superpowers/specs/2026-06-29-plugin-pipeline-ui-and-worker-design.md`.

**Tech Stack:** Node `>=20.10`, TS 6.0.3, ESM/NodeNext, `.js` imports (uxfactory side), `verbatimModuleSyntax`. Bridge = Fastify 5 (raw-`reply` SSE, no new dep). Worker runs under **`tsx`** (the helmsmith libs are source-first, `.ts` import specifiers). Vitest 4.1.9.

## NEW `@helmsmith/agent-adapter` surface (the rebuild — now on helmsmith main)
```ts
import { createAgent, listAdapterTypes } from '@helmsmith/agent-adapter';
import type { AgentAdapter, AgentInput, AgentInvocationResult, AgentChunk } from '@helmsmith/agent-adapter';
import { FileBroker, bridgeBroker } from '@helmsmith/agent-auth';
// createAgent({ spec:{type, model}, workdir, credentialBroker }) -> AgentAdapter
// AgentAdapter { type; capabilities; workdir; invoke(AgentInput): Promise<AgentInvocationResult>; stream(AgentInput): AsyncIterable<AgentChunk> }
// AgentInput { messages: {role,content}[]; systemPrompt?; tools?; toolChoice? }
// AgentInvocationResult { content: string; usage?; finishReason?; durationMs }
// listAdapterTypes({ toolUseMode:'autonomous' }) -> the 6 skill-runners: claude-agent-sdk, claude-code-cli, opencode-cli, copilot-cli, gemini-cli, codex-cli
```

## Global Constraints
- WORK ON `main`. Engine SELF-CONTAINED — the **bridge/CLI/plugin gain NO LLM and NO helmsmith awareness**. Only `clients/uxfactory-worker` depends on helmsmith. No package cycle: the bridge relays opaquely.
- **Reuse:** mirror the Phase 9/10 relay pattern (`saveReviewReport`/`/review`, `saveCanvasRequest`/`/canvas`) for the pipeline queue/result; mirror the `/edits` long-poll waiter; reuse the skills VERBATIM as `systemPrompt` (no skill rewrites except the one small new `skill/generate`).
- **The worker depends on the new `AgentAdapter` INTERFACE, not a concrete adapter** — inject it; tests use a FAKE adapter (`{ type, capabilities, workdir, invoke, stream }`). The real adapter is constructed only in the composition root (Task 2).
- **Runtime = an AUTONOMOUS adapter (a skill-runner).** A skill must run `uxfactory …` + write files → that needs `toolUseMode:'autonomous'` (NOT the host-loop SDK chat adapters). **Default `claude-code-cli`** (the `claude` v2.1.195 binary is installed + verified headless; no deps-bump dependency). Config can select any of the 6 autonomous types; validate the chosen type is in `listAdapterTypes({toolUseMode:'autonomous'})` (else exit 2). (Note: `claude-agent-sdk` needs the deferred F1 deps-bump for live; prefer `claude-code-cli` until then.)
- **Auth:** the chosen adapter resolves credentials from the injected `CredentialBroker`. Use `bridgeBroker(new FileBroker(authPath))` from `@helmsmith/agent-auth` (FileBroker reads `~/.agentx/auth.json`, mode 0600, `{version:1,providers:{anthropic:{apiKey}}}`; `bridgeBroker` adapts it to the lib's structural broker — Provider→string + expiresAt→Date). If `bridgeBroker` isn't exported, the worker defines the 4-line wrapper itself.
- **workdir:** `createAgent` REQUIRES a git working tree. The worker passes the **project root** (the uxfactory project where skills run the CLI + write artifacts) — must be a git repo (the agent's tools operate there).
- **Live events via `stream()`:** the new adapter has no event bus — iterate `adapter.stream(input)` and forward each `AgentChunk` to the bridge (→ SSE → panel). AgentChunks are `text-delta`/`tool-call-*`/`usage`/`message-stop` — they do NOT echo the systemPrompt/secrets (cleaner than the old event bus), but still mask any `sk-…`-shaped string in `text-delta` before forwarding.
- **Error→status:** the new adapters throw the `AdapterError` hierarchy (`AuthError`/`BillingError`/`RateLimitError`/`ConfigError`/`NetworkError`/`ProviderError`/`BinaryNotFoundError`/`MissingCredentialError`/`CapabilityMismatchError`) → map ALL to `status 2` (setup/transport). A `result` with a non-conformant gate is the CLI's job (status 1), not the adapter's.
- `clients/*` is in `pnpm-workspace.yaml`. Worker `private: true`. Scoped commits (never `git add -A`).

---

## Task 1: Bridge `/pipeline/*` relay + SSE event stream
**Files:** Modify `packages/uxfactory-bridge/src/store.ts` (pipeline request queue + result store + recent-event ring) + `src/server.ts` (endpoints + SSE). Test: the bridge suite.

**Interfaces (store.ts — mirror existing relay methods):**
```ts
export interface PipelineRequest { id: string; kind: string; payload: unknown; createdAt: number }
export interface PipelineResult { id: string; status: number; result: unknown }
export interface PipelineEvent { requestId: string; event: unknown; seq: number }
class BridgeStore {
  enqueuePipelineRequest(kind, payload, createdAt): Promise<PipelineRequest>;
  dequeuePipelineRequest(): Promise<PipelineRequest | null>;     // FIFO
  savePipelineResult(id, status, result): Promise<PipelineResult>;
  getPipelineResult(id): Promise<PipelineResult | null>;
  appendPipelineEvent(requestId, event): PipelineEvent;          // in-memory ring, assigns seq
  recentPipelineEvents(afterSeq): PipelineEvent[];               // SSE replay
}
```
**Behavior (server.ts):** `POST /pipeline/request {kind,payload}` → validate kind → enqueue → `{id}`. `GET /pipeline/request/next` → dequeue; 204 if none. `POST /pipeline/result {id,status,result}` → save → `{ok:true}`. `GET /pipeline/result/:id` → 404 unknown / 202 `{pending:true}` known-pending / 200 result. `POST /pipeline/event {requestId,event}` → append + broadcast `data: …\n\n` to SSE clients. `GET /pipeline/events` → SSE (`reply.hijack()`, headers, register `reply.raw`, replay via `Last-Event-ID`, 25s keep-alive, remove on close). No `@uxfactory/cli` import; payloads opaque.
**Steps (TDD):** RED→GREEN; tests: enqueue→dequeue FIFO + result roundtrip + 404/pending; POST /pipeline/event reaches a connected SSE client (in-process `startBridge` + raw `fetch` reading the SSE body, assert the `data:` frame); replay via `Last-Event-ID`. `pnpm vitest run packages/uxfactory-bridge` + `pnpm --filter @uxfactory/bridge typecheck`. Commit `packages/uxfactory-bridge`.

## Task 2: `clients/uxfactory-worker` scaffold + adapter composition root
**Files:** Create `clients/uxfactory-worker/` (`package.json`, `tsconfig.typecheck.json`, `src/adapter.ts`, `src/config.ts`, `src/preflight.ts`, `src/spike.ts`). Modify nothing in `packages/`.

**Composition root (`src/adapter.ts`):**
```ts
import { createAgent, listAdapterTypes } from '@helmsmith/agent-adapter';
import type { AgentAdapter } from '@helmsmith/agent-adapter';
import { FileBroker, bridgeBroker } from '@helmsmith/agent-auth';
export function createWorkerAdapter(cfg: WorkerConfig): AgentAdapter {
  if (!listAdapterTypes({ toolUseMode: 'autonomous' }).includes(cfg.runtime))
    throw new Error(`runtime ${cfg.runtime} is not autonomous (need a skill-runner)`);
  return createAgent({
    spec: { type: cfg.runtime, model: cfg.model },   // default runtime 'claude-code-cli'
    workdir: cfg.projectRoot,                          // git working tree
    credentialBroker: bridgeBroker(new FileBroker(cfg.authPath)),
  });
}
```
- `package.json`: `private:true`, `type:module`, deps `@helmsmith/agent-adapter` + `@helmsmith/agent-auth` via `file:` paths to the local helmsmith checkout (`"file:../../../helmsmith/core/agent-adapter-lib"`, `"…/agent-auth-lib"`); devDeps `tsx`, `@types/node`, `vitest`. Scripts: `typecheck`, `start` (`tsx src/main.ts` — Task 3), `spike` (`tsx src/spike.ts`). `pnpm install`.
- `src/config.ts`: `WorkerConfig { bridgeUrl; projectRoot; authPath; runtime: AgentSpecType; model: string }` from env (`UXFACTORY_BRIDGE`, `cwd`, `UXFACTORY_WORKER_AUTH` default `~/.agentx/auth.json`, `UXFACTORY_WORKER_RUNTIME` default `claude-code-cli`, `UXFACTORY_WORKER_MODEL`).
- `src/preflight.ts`: assert `projectRoot` is a git tree, `authPath` exists at mode 0600, and the runtime is autonomous — clear errors → exit 2.
- `src/spike.ts` (manual, real creds): `createWorkerAdapter(cfg)` then `await adapter.invoke({ messages:[{role:'user', content:'Create ./SPIKE_OK.txt with the word OK, then say done.'}], systemPrompt:'You can run shell + write files.' })`; assert `SPIKE_OK.txt` written. Proves the autonomous path end-to-end.
**Steps:** scaffold + `file:` link + `pnpm install` (the helmsmith pkgs resolve under tsx) → `pnpm --filter uxfactory-worker typecheck` 0 → run `spike` IF the `claude` binary + creds present (else document as a manual step) → commit `clients/uxfactory-worker`. REPORT: whether `bridgeBroker` is exported (or you wrote the wrapper), the spike result, any type mismatch. Verify ONLY the worker package.

## Task 3: Worker subscribe loop + deterministic dispatch
**Files:** Create `src/main.ts` (loop), `src/bridge-client.ts`, `src/dispatch.ts`, `src/run-cli.ts`. Test against a FAKE bridge + a stub `uxfactory` (or inject `runCli`).
```ts
class WorkerBridgeClient { pullRequest(); postResult(id,status,result); postEvent(requestId,event); subscribeEvents(onWake): ()=>void; }
export async function runCli(bin, args, cwd): Promise<{status:number; json:unknown|null; stderr:string}>;
export const DETERMINISTIC: Record<string,(payload,ctx)=>Promise<{status:number; result:unknown}>>;
//   classify -> runCli(['classify','--json']) ; gate -> ['classify','--confirm'] then ['batch',dir,'--json']
//   batch -> ['batch',dir,'--json',...scope] ; review -> ['review',design,'--json'] ; render -> ['render',spec,'--out',out]
```
**Behavior:** `main.ts` — on start + each SSE wake, drain `pullRequest()`; a DETERMINISTIC kind → run its handler (write any payload input file first), `postResult(id, status, json)` (CLI exit code = status 0/1/2). Generative kinds → call Task 4's module. `runCli` spawn failure → status 2.
**Steps (TDD):** RED→GREEN; tests (fake bridge + stub `uxfactory`): classify→runs CLI in projectRoot, posts JSON status 0; batch exit 1→status 1; spawn failure→2; loop pulls until 204. `pnpm --filter uxfactory-worker typecheck`. Commit.

## Task 4: Worker generative dispatch (skills via the adapter) + `skill/generate`
**Files:** Create `src/generative.ts` + `src/skills.ts`; create `skill/generate/SKILL.md`; wire `src/dispatch.ts`. Test with a FAKE AgentAdapter.
```ts
export function loadSkill(name: 'generate'|'vision-review'|'intake'|'batch'): string;  // reads skill/<name>/SKILL.md body
export async function runGenerative(req, adapter: AgentAdapter, bridge, ctx): Promise<{status:number; result:unknown}>;
//   generate-artifact -> systemPrompt=loadSkill('generate'), user=`Draft ${kind} for ${classification}; write to ${path} in ${root}. Honor: ${constraints}`
//   canvas-review     -> systemPrompt=loadSkill('vision-review'), user=`Review the pending canvas request; post the best-effort report.`
```
**Behavior:** build `AgentInput { messages:[{role:'user', content:user}], systemPrompt:skillBody }`; iterate `adapter.stream(input)` → for each `AgentChunk` mask `sk-…` in any `text-delta`, `bridge.postEvent(req.id, chunk)` (→ SSE → panel), and accumulate (via the lib's `reduceStream` if exported, or accumulate text-deltas) → the final result. On success `{status:0, result:{content, artifactPath?}}`. A thrown `AdapterError` (any subclass) → `{status:2}`. `skill/generate/SKILL.md`: frontmatter `name: uxfactory-generate` + a focused instruction — draft ONE UX artifact (AcceptanceCriterion stories / TokenSet / UserFlow) for a classification + project, write it to the registry's expected path, honor the profile constraints; self-contained; NO external-project refs.
**Steps (TDD):** RED→GREEN with a FAKE `AgentAdapter` (records the AgentInput, yields a couple of fake AgentChunks from `stream`, returns an AgentInvocationResult from `invoke`). Tests: generate-artifact → `stream`/`invoke` called with `systemPrompt`=the generate skill body + `user` containing the artifact kind + path; the fake's chunks are forwarded via `postEvent` (and `sk-…` masked); a thrown `RateLimitError` → status 2; canvas-review → the vision-review skill. Wire `dispatch.ts`. Built artifact: `tsx`-run `main.ts` against the in-process bridge + the FAKE adapter end-to-end (generate-artifact flows request→event→result). `pnpm --filter uxfactory-worker typecheck` + worker tests green. Record live-only items (real adapter creds/run) in `docs/superpowers/notes/cross-phase-contract-notes.md`. Commit `clients/uxfactory-worker skill docs/superpowers/notes`.

## Self-Review
- Engine self-contained: bridge/CLI/plugin no LLM, no helmsmith import; only the worker depends on helmsmith. ✓
- Bridge = pure relay (queue + result + SSE), no cycle, opaque payloads. ✓
- Worker depends on the new `AgentAdapter` interface (fake in tests); real adapter via `createAgent` at the composition root. ✓
- Runtime = an AUTONOMOUS adapter (default `claude-code-cli`), validated via `listAdapterTypes({toolUseMode:'autonomous'})`; broker via `bridgeBroker(FileBroker)`; `workdir`=project git tree. ✓
- Deterministic kinds run the CLI (exit=status); generative kinds run SKILLs verbatim as `systemPrompt` via `invoke`/`stream`; chunks stream to the panel (sk-… masked); AdapterError→2. ✓
- `tsx` runtime; two-package `file:` link to local helmsmith. ✓

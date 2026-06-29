# UXFactory — Implementation Decomposition & Design

> **Status:** Approved decomposition (master plan) · **Date:** 2026-06-28 · **Owner:** Edwin Cruz
> **Source contracts:** [`.plans/UXFactory-Implementation-PRD.md`](../../../.plans/UXFactory-Implementation-PRD.md) and [`.plans/UXFactory-Design-Artifacts-and-Models-PRD.md`](../../../.plans/UXFactory-Design-Artifacts-and-Models-PRD.md)

This document is **not** a re-statement of the PRDs. The two PRDs are the detailed design and the build contract; they own _what_ to build and _why_. This document owns the **decomposition into buildable sub-projects, their dependency order, the cross-cutting technical decisions the PRDs leave open, and the execution discipline**. Each phase below defers to the PRD sections it implements.

## Scope (confirmed)

Full build, maximum scope:

- v1.0 core + Figma plugin + agent surfaces (PRD §4–§10).
- Post-v1 roadmap: drift (§11), headless preview (§12), offline batch (§13), conformance review (§14).
- Companion **Artifacts & Models** data model: trace graph, 0–9 tiered gate ladder, fidelity ramp, compile pipeline, Figma-variable materialization.

The two LLM-judgment seams (§13.3 iterate-to-threshold scoring, §14 heuristic-UX review) ship as a **`Judge` interface with a deterministic no-op default**. Real model wiring is an explicit, separate later effort — no API keys live in this repo, and the engine is BYO-compute by design (§16.3).

## Cross-cutting technical decisions

| Concern                   | Decision                                                                                               | Rationale                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Language / modules        | TypeScript **6.0.x**, ESM (`"type": "module"`, `module`/`moduleResolution: NodeNext`), target Node 20+ | latest stable TS (confirmed 6.0.3); ESM is the Node 20+ default                                                  |
| Monorepo                  | pnpm workspaces                                                                                        | mandated by PRD §18                                                                                              |
| Lib build                 | `tsc` emitting `.js` + `.d.ts` per package                                                             | simple, no bundler needed for pure libs                                                                          |
| Plugin build              | **esbuild** (single IIFE `code.js`, browser-target `ui.js` inlined into `ui.html`)                     | Figma sandbox needs one bundled file per side                                                                    |
| Tests                     | **Vitest 4.x**                                                                                         | TS-native; runs `validate()` under both Node and jsdom to prove the §19 "identical verdict both sides" criterion |
| Schema validation         | **ajv 8.x**; schema **hand-authored & committed**                                                      | honors §3 decision 4 ("no build-time codegen"); §9 "generated from types" yields to that                         |
| Bridge HTTP               | **Fastify 5.x** + CORS for the Figma iframe origin                                                     | clean routing for ~13 endpoints incl. path params (`/verify/:id`, `/batch/:id/approve`)                          |
| CLI parsing               | **commander 15.x**                                                                                     | ubiquitous, simple, good `--json`/exit-code ergonomics                                                           |
| SVG raster (§12)          | **@resvg/resvg-js 2.x**                                                                                | no system deps; pure SVG→PNG                                                                                     |
| Figma typings             | **@figma/plugin-typings 1.x** (pinned)                                                                 | PRD §21 calls out pinning typings against API drift                                                              |
| Companion store (Phase 8) | **file-based committed JSON** behind a repository interface                                            | matches §15.2 "local store, version-controlled"; hosted SQL adapter is the documented later seam (§3 seam c)     |

## The three architecture seams (designed now, second impl only when needed — PRD §3.9)

1. **Clients** — the CLI is the shared executable; VS Code / Claude Code wrappers spawn it; the Figma plugin is a protocol _peer_ (HTTP), not a CLI wrapper.
2. **Targets** — spec, gate, generation are target-agnostic; the Figma plugin + bridge are one _render adapter_. A target is "anything that emits a render report."
3. **Compute** — generation/judgment runs behind a pluggable backend; the `Judge` interface is the first realization of this seam.

## Phase decomposition (strict dependency order)

Each phase is independently testable before the next. Each gets its own short spec → `writing-plans` plan → **TDD** cycle, with a verification + checkpoint at the phase boundary.

### Phase 0 — Monorepo foundation

pnpm workspace, root `package.json`, base `tsconfig`, Vitest config, lint/format, CI (GitHub Actions), `.gitignore` for `.uxfactory/`. Repo layout per PRD §18.
**Done when:** `pnpm install` + `pnpm -r build` + `pnpm -r test` run green on an empty workspace.

### Phase 1a — `uxfactory-spec` ① (keystone)

`src/types.ts`, `schema/uxfactory.schema.json`, `src/validate.ts` (ajv). Three spec shapes: design / figjam / edit-only. _(PRD §9)_
**Done when (§19):** types compile; schema validates the three shapes and rejects unknown edit properties; `validate()` returns identical verdict in Node and jsdom.

### Phase 1b — `uxfactory-gate` ②

Pure `gate(spec, report) → GateResult`, no I/O. Checks: `editorType`, `counts`, `presence`, `geometry`, `edits` with `tolerancePx`. _(PRD §10.2)_
**Done when (§19):** pure & deterministic; each check has passing + failing tests; tolerance boundary tests.

### Phase 1c — `uxfactory-bridge` ③

Fastify relay. Endpoints §6.1: `/health`, `/next`, `POST|GET /rendered`, `POST|GET /selection`, `POST /edits`, `POST /verify`, `GET /verify/:id`, `POST /batch`, `GET /batch`, `POST /batch/:id/approve`. Queue + persistence under `.uxfactory/` (§6.2). Wires `uxfactory-gate` into `/verify`.
**Done when (§19):** all endpoints behave per spec; `/next` 204 on empty; queue survives restart; `/verify` returns §10.1 shapes with correct HTTP codes (409 no-report / 404 unknown-id / 503 no-plugin); nothing written outside `.uxfactory/`.

### Phase 1d — `uxfactory-cli` ④

commander CLI: `bridge`, `publish`, `verify`, `selection`, `scan`, `lint`, `map`, `drift`, `render`, `batch`, `review`, `snapshot` _(stub)_. Shared flags §5.2. Exit codes §5.3 (`0` pass / `1` gate fail / `2` transport). `--json`.
**Done when (§19):** each command works against a live bridge; exit codes match §5.3; `--verify` runs the §10.3 sequence; `--json` is machine-parseable. (Commands for later phases land in their own phases; the v1 set lands here.)

### Phase 2 — `uxfactory-plugin` ⑤

`manifest.json` (`networkAccess: ["http://localhost:3779"]`), `code.ts` (render, `applyEdits`, inverse capture, render report §7.4, selection §7.5), `ui.html`/`ui.ts` (poll, 3-state panel §7.6, undo §7.3, batch review §7.7, conformance annotation §7.8). esbuild build.
**Approach:** extract all pure logic (geometry layout, inverse computation, report assembly, panel state machine) into testable modules unit-tested with Vitest; the thin `figma.*` glue is build-to-spec and structurally checked (manifest truthfulness, bundle builds).
**Done when (§19, to the extent verifiable headlessly):** pure-logic units tested; manifest `networkAccess` truthful; bundles build clean.

### Phase 3 — skill ⑥ + `uxfactory-cc` ⑦

Vendor `.plans/SKILL.md` → `skill/SKILL.md` (canonical). `clients/uxfactory-cc/`: `.claude-plugin/{plugin.json,marketplace.json}`, `commands/*.md`, `hooks/hooks.json` (PostToolUse sync-on-edit + SessionStart drift-notify), vendored skill copy, `README.md`. _(PRD §4, §8)_
**Done when (§19):** skill carries valid frontmatter & covers the publish→verify loop; cc plugin is structurally valid (manifest parses, commands scope `Bash(uxfactory:*)`, build step vendors the skill).

### Phase 4 — Drift §11

`uxfactory.map.json` schema; `uxfactory map scaffold` (tf/k8s/compose + spec name-match), `uxfactory map check` (both-sides resolution), `uxfactory drift` (field diff via `source.compare`, git-staleness fallback, orphan detection both directions). Auto-fill `figmaId`/`lastSynced` on render; never edit maintained fields.
**Done when (§19):** `map check` flags a dangling entry; `drift` detects a field change + both orphan kinds, exits `1`; map's maintained fields are never auto-edited.

### Phase 5 — Headless preview §12

`uxfactory render <spec> --out <file>` → deterministic SVG builder (frames/shapes/connectors/geometry) → raster via resvg. Figma-accurate REST export path (token-gated) documented + implemented. Explicitly labeled approximate.
**Done when:** a fixture spec renders to a stable PNG; SVG output is deterministic; REST export path callable with a token.

### Phase 6 — Offline batch §13

`uxfactory.batch.json` inputs registry; input-conditional checks (token conformance, requirement/state coverage, reuse) — a check exists only if its input does, else "skipped & declared." Iterate-to-threshold loop (mechanical gate + `Judge` residue, max-iteration cap, no-regression, human-approval backstop). Staged approval: `/batch` endpoints + plugin review mode (§7.7) consuming §12 previews. Outputs under `.uxfactory/batch/`.
**Done when:** mechanical checks run input-conditionally with skip-and-declare; loop honors cap + no-regression; staged-approval round-trips through the bridge.

### Phase 7 — Conformance review §14

`uxfactory review <design>` — state coverage, traceability, optional soft flow-sequence (gate layer) + advisory heuristic-UX (`Judge` layer, clearly secondary). Reliable case = UXFactory-rendered (spec exists); best-effort case = arbitrary canvas (inferred). Plugin annotation mode §7.8 (gate vs advisory visually distinct). Clean exit-code contract + `--json`.
**Done when:** review of a rendered design produces deterministic coverage/traceability verdicts; absent inputs skip-and-declare; CLI exit/`--json` contract holds.

### Phase 8 — Companion Artifacts & Models data model

1. **Artifact store + trace graph:** spine (StoryMap→Activity→Task→Story→AcceptanceCriterion→ViewState→View→Component), `Binding`/trace, `BrandGuide`/`DesignGuide`; file-based committed store behind a repository interface. _(Models PRD §5)_
2. **Figma-variable materialization:** raw `VariableCollection`/`Variable` mirror (+ provenance hash), `ResolvedToken` index (alias-walked, keeps alias chain), ingestion via plugin-export-via-bridge (primary) + REST (Enterprise). _(Models PRD §5.4, §7)_
3. **Tiered gate ladder (0–9) + fidelity ramp:** `GateProfile`/`GateCheck`/`GateRun`/`GateResult`; compile pipeline (AC / principle / rule → check with tier, verifier, hardness, `min_fidelity`); fidelity as ordinal selector + promotion ratchet. _(Models PRD §6)_
   **Done when:** entities round-trip through the store; a sample AC + design principle + brand rule compile into GateChecks with correct tier/hardness/min_fidelity; a fidelity level selects the correct check subset; token materialization resolves an alias chain to a concrete value + code symbol.

## Execution discipline

- **Per phase:** short spec → `writing-plans` plan → TDD (red→green→refactor) against the named §19 / Models-PRD acceptance criteria → `verification-before-completion` → checkpoint with the user.
- **Parallelism:** independent intra-phase work may fan out via parallel subagents. The heavy multi-agent `Workflow` tool is **not** used without explicit opt-in.
- **Determinism is a feature** (§G1): every render/gate/compile path is tested for identical output on identical input.
- **Nothing leaves the machine** in local mode (§NF2): bridge is localhost-only; no telemetry.

## Out of scope for this build

- Hosted `uxfactory.io` backend, accounts, billing, multi-tenant control plane (§16) — the local/solo engine only.
- The generation subsystem (HTML→screenshot→spec pipeline) — NG1 promises it but the PRD defers its subsystem spec.
- Real LLM/vision model wiring behind the `Judge` interface (interface + deterministic default only).
- VS Code extension (roadmap; the CLI it would wrap is built).

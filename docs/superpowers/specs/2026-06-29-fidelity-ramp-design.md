# UXFactory — Render Scope (Four Dials) + Rubric Assembly (design)

**Date:** 2026-06-29
**Status:** approved — **four-dial render scope** (revises the earlier 0–2 vector to match the companion PRD §6.5)
**Grounds in:** Implementation PRD §13 (batch), §14 (review); **Companion PRD `.plans/UXFactory-Design-Artifacts-and-Models-PRD.md` §6.5 (Render Scope — Four Dials)**, §5.8 (ProjectClassification — deferred), §6.6 (conditioning + Confirm gate — deferred).
**Extends Phase 6 (batch); feeds Phase 7 (review). The §5.8/§6.6 intake layer is a deferred follow-on phase.**

## 1. Problem

Not every render owes every gate. A render's **scope** selects which gates bind — a greybox shouldn't fail "uses tokens"; a happy-path snapshot shouldn't fail "renders the error state"; a single screen shouldn't fail "back-navigation works." Before a batch is requested, the scope is set; it determines the **required artifacts** (the REQUESTED set); present artifacts **compile into the rubric** (the binding gates); the loop **judges state against that rubric each iteration**, ratcheting per dial as the design matures.

## 2. The model — render scope is FOUR DIALS in two pairs

Two **fidelity** dials (depth of one rendered ViewState) and two **completeness** dials (traversal of the spec graph). The pairs are independent — any dial moves without the others.

| Dial | Pair | Measures | low | medium | high |
| --- | --- | --- | --- | --- | --- |
| `visual` | fidelity | how it *looks* | greybox/wireframe | tokens/type/color applied | full visual, production-styled |
| `editorial` | fidelity | what it *says* | placeholder/lorem | draft real copy | final, on-voice, i18n |
| `coverage` | completeness | states *within* a view (AC→ViewState) | success only | + empty·loading·error | + all AC edge states |
| `flow` | completeness | paths *across* views (View→View) | single screen / happy snapshot | primary flow end-to-end | all branches, back/cancel, deep-link |

**Levels are an ordinal `none < low < medium < high`.** A scope dial is set to `low|medium|high` (the user never sets `none`). `none` exists only as a **check threshold** meaning "this check does not gate on this dial."

```
Level ordinal     none(0) < low(1) < medium(2) < high(3)
RenderScope       { visual, editorial, coverage, flow }   (each low|medium|high)
```

## 3. Per-check binding — a threshold on EVERY dial

Each gate declares four thresholds `{ min_visual, min_editorial, min_coverage, min_flow }` (each a Level, default `none`). **A gate binds iff the scope meets every threshold:**

```
binds(check, scope) ⇔  scope.visual    >= check.min_visual
                  AND  scope.editorial >= check.min_editorial
                  AND  scope.coverage  >= check.min_coverage
                  AND  scope.flow      >= check.min_flow
```

Most checks key off one dial (the others `none`); a few are multi-dial. This replaces the earlier one-gate-one-dimension rule.

### v1 gate → thresholds (mapping the 4 implemented gates onto the tier dials)

| Gate (existing id) | Binds on | Threshold | Required input |
| --- | --- | --- | --- |
| `requirement-coverage` | coverage (Tier 0·1) | `min_coverage = low` | `stories` |
| `reuse` | coverage | `min_coverage = low` | — (optional; skip-and-declare) |
| `coverage-orphans` (advisory) | coverage | `min_coverage = low` | — |
| `token-conformance` | visual (Tier 3) | `min_visual = medium` | `tokens` |
| `flow-reachability` | flow (Tier 2) | `min_flow = medium` | `flow` |

(Thresholds align to §6.5: Visual `medium` = tokens applied; Flow `medium` = primary flow end-to-end; Coverage `low` = success/populated baseline.)

## 4. Presets — points in the 4-cube, not a forced ladder

Named presets are convenient `(visual, editorial, coverage, flow)` coordinates; the dials move independently, so any off-preset combo is first-class (e.g. `(visual:high, editorial:low, coverage:low, flow:low)` = the "hero vibe": one pixel-complete screen, lorem copy, happy state — gated for craft, with error-state/navigation checks dormant).

| Preset | visual | editorial | coverage | flow |
| --- | --- | --- | --- | --- |
| `wireframe` | low | low | low | low |
| `content` | low | high | medium | low |
| `visual` | high | medium | medium | medium |
| `interactive` | high | high | high | high |
| `production` | high | high | high | high |

(`interactive`/`production` coincide on the *implemented* dials; their real difference is the deferred a11y/i18n/code tiers.) **Resolution:** start from the preset (or a raw partial vector; missing dials → their preset/low default), then apply per-dial overrides.

## 5. Engine vs. agent split (self-contained; loop in the SKILL.md; no in-engine LLM)

| Concern | Owner |
| --- | --- |
| Dials, levels, presets, per-check `min_<dial>` thresholds, required-input manifest | Engine |
| Resolve scope (preset + overrides → vector); **readiness** (REQUESTED artifacts present vs missing-to-generate); rubric (binding gates) | Engine (deterministic, `--json`) |
| The deterministic gates | Engine |
| Renderer by the `visual` dial (resvg at `visual:low`; Playwright at `visual ≥ medium`) | Engine |
| **Generating** missing artifacts; judging soft residue; iterating/ratcheting per dial | Agent, via `SKILL.md` |

**Confirmed decisions:** engine *reports* missing REQUESTED artifacts (skill drives generation, no `--generate`); unimplemented tiers are *declared* (never silently passed, never blocking). The §5.8/§6.6 ProjectClassification → conditioning-function → Confirm-gate pipeline is a **deferred follow-on** that will *derive* the scope + the REQUESTED/GENERATABLE/SUPPRESSED manifest; this phase ships the render-scope selector it builds on.

## 6. Surfaces

- **`uxfactory.batch.json`** gains `scope`: a preset name **or** a partial vector `{ visual?, editorial?, coverage?, flow? }` (low|medium|high). `--scope <preset>` + per-dial flags (`--visual`/`--editorial`/`--coverage`/`--flow <low|medium|high>`) override. Unset → exit 2: "set a render scope before requesting a batch."
- **Readiness precondition:** for the resolved scope, every REQUESTED input (a required input of a binding gate — §3) must be present; missing → exit 2 with a structured list (each: artifact, the dial+level that requires it, action `provide-or-generate`). Declared-future tiers are listed `declared`, non-blocking.
- **`runBatch` is scope-scoped:** runs only gates where `binds(check, scope)` (the **rubric**); non-binding gates report status `not-owed`; declared-future tiers report `declared`. `mustPassFailed`/`clean` consider only **binding must** gates. The report carries the resolved scope + the rubric (binding gate ids).
- **Renderer by the `visual` dial:** resvg at `visual:low`; **Playwright at `visual ≥ medium`** (tokens applied). Playwright optional; unavailable → fall back to resvg + a declared note (never a hard error).
- **`SKILL.md` (the loop):** set scope (preset + overrides) → readiness check → generate missing REQUESTED artifacts (agent) → run `uxfactory batch` (the rubric) → on exit 1 read findings + revise → repeat to exit 0 (binding hard checks pass) or maxIterations → optionally ratchet a dial and re-run readiness.

## 7. Phase 7 (review) reuses the same render scope

`uxfactory review <design> --scope <preset|vector>` reuses the same dial/threshold selection + the same gates, pointed at a single design. Render scope is shared infrastructure built here.

## 8. Build order (tasks)

1. **`src/batch/scope.ts`** — `Level` ordinal (`none<low<medium<high`), `RenderScope` type, `PRESETS` (the §4 coordinates), `parseScope` (preset name or partial vector; dials low|medium|high; reject unknown dials/levels), `resolveScope(base, overrides)`, `GATE_THRESHOLDS` (per-gate `{min_visual,min_editorial,min_coverage,min_flow}`), `binds(checkThresholds, scope)`, `bindingGateIds(scope)`, required-input manifest, `declaredFuture(scope)`, `checkReadiness(scope, present)`. Pure.
2. **Scope-scoped `runBatch`** (`src/batch/run.ts`) — `scope: RenderScope` input; `binds()` selection; `not-owed`/`declared` statuses; rubric = binding gates; must-gating only on binding must-fails; report carries scope + rubric.
3. **Registry `scope` + flags + readiness precondition** wired into `batchCmd` (unset → 2; missing REQUESTED → 2 with the list; ready → scope-scoped run; `--json` carries the scope report) + built artifact + monorepo green.
4. **Playwright renderer** (`src/render/raster-playwright.ts`, lazy, fallback+declare) + renderer-by-`visual`-dial selector in batch previews + `playwright` devDep; live render test SKIPS when the browser is unavailable (hermetic suite never depends on it).
5. **`skill/batch/SKILL.md`** scope-aware loop + re-vendor into uxfactory-cc (byte-match) + tests (no external refs).

## 9. Sub-decisions (confirmed)

- Scope unset → exit 2 (required, no silent default).
- Ratcheting = one resolved scope per CLI call; the SKILL.md walks dials/levels.
- Playwright missing at `visual ≥ medium` → fall back to resvg + declare (not a hard error).
- `none` is a threshold value only; scope dials are low|medium|high.
- §5.8/§6.6 ProjectClassification + Confirm-gate intake = deferred follow-on phase.

# UXFactory — Fidelity Ramp + Rubric Assembly (design)

**Date:** 2026-06-29
**Status:** approved — **multi-dimensional fidelity with presets**
**Grounds in:** Implementation PRD §13 (batch), §14 (review); Companion PRD §6.5 (fidelity), §15 ("authoring is gate-authoring").
**Extends Phase 6 (batch); feeds Phase 7 (review).**

## 1. Problem

A batch job must not run "all gates always." Per companion §6.5, fidelity selects which slice of the rubric binds — a wireframe doesn't owe "uses tokens" or "on-brand." Before a batch is requested, a **fidelity** is set; it determines the **required specs + UX artifacts**; the present artifacts **compile into the rubric** (the binding gates); the loop **judges state against that rubric each iteration**, promoting as the design matures.

## 2. The model — fidelity is a VECTOR, not a scalar

Different concerns advance **independently**: final copy on a greybox; a complete flow with placeholder content; styled visuals with no flow. A single ordinal collapses these. So fidelity is a **vector over dimensions**, and **each gate owes on its own dimension** — `token-conformance` binds on `visual`, `flow-reachability` on `flow`, regardless of the other dimensions.

**Dimensions (v1) — each an ordinal 0–2:**

| Dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `coverage` | none | core (required stories/states) | full |
| `editorial` | placeholder | real copy | reviewed/voice |
| `visual` | greybox | tokenized | branded |
| `flow` | none | connected | all-states |

(`a11y`, `seo` are future dimensions — declared, not yet checkable.)

**A gate binds iff `vector[gate.dimension] ≥ gate.minLevel`.** Otherwise the gate reports status `not-owed`. This is one comparison per gate, on the gate's own axis — not a 5×2 matrix to author.

```
fidelity vector   { coverage, editorial, visual, flow }   (each 0–2)
gate selection    a gate binds  ⇔  vector[gate.dimension] ≥ gate.minLevel
```

## 3. Presets — keep the simple "set one level" UX

Named presets expand to a **default vector** (a strict superset ramp, matching §6.5). Set one preset and you get a sensible vector for free; override any single dimension to express uneven maturity.

| Preset | coverage | editorial | visual | flow |
| --- | --- | --- | --- | --- |
| `wireframe` | 1 | 0 | 0 | 0 |
| `content` | 1 | 1 | 0 | 0 |
| `visual` | 1 | 1 | 1 | 0 |
| `interactive` | 1 | 1 | 1 | 1 |
| `production` | 2 | 2 | 2 | 2 |

**Resolution:** start from the preset's vector (or all-zero if a raw vector is given), then apply per-dimension overrides. So `--fidelity wireframe --flow 1` = greybox **with a connected flow** → `flow-reachability` binds, `token-conformance` does not.

## 4. Gate → dimension binding (v1)

| Gate (existing id) | Dimension | minLevel | Required input (mandatory) |
| --- | --- | --- | --- |
| `requirement-coverage` | coverage | 1 | `stories` |
| `reuse` | coverage | 1 | — (optional; skip-and-declare) |
| `coverage-orphans` (advisory) | coverage | 1 | — |
| `token-conformance` | visual | 1 | `tokens` |
| `flow-reachability` | flow | 1 | `flow` |

**Required inputs by dimension level** (mandatory to *request* a batch): `coverage ≥ 1 → stories`; `visual ≥ 1 → tokens`; `flow ≥ 1 → flow`. `editorial ≥ 1` requires real content but has no checkable gate yet → **declared, not blocking**. Future dims (a11y/seo) likewise declared.

## 5. Engine vs. agent split (self-contained; loop in the SKILL.md; no in-engine LLM)

| Concern | Owner |
| --- | --- |
| The dimensions, presets, `GATE_DIMENSION`/`minLevel`, required-input manifest | Engine |
| Resolve fidelity (preset + overrides → vector); **readiness** (present vs missing-to-generate per the vector); rubric (binding gates) | Engine (deterministic, `--json`) |
| The deterministic gates | Engine |
| **Generating** missing artifacts; judging soft residue; iterating/promoting | Agent, via `SKILL.md` |
| Renderer by the `visual` dimension (resvg at visual 0; Playwright at visual ≥ 1) | Engine |

**Confirmed decisions:** engine *reports* missing required artifacts (skill drives generation, no `--generate`); unimplemented tiers are *declared* `required, not yet checked` (never silently passed, never blocking).

## 6. Surfaces

- **`uxfactory.batch.json`** gains `fidelity`: a preset name **or** a partial vector object `{ coverage?, editorial?, visual?, flow? }`. `--fidelity <preset>` + per-dimension flags (`--coverage`/`--editorial`/`--visual`/`--flow <0-2>`) override. Unset → exit 2: "set a fidelity before requesting a batch."
- **Readiness precondition (gates whether a batch can be requested):** for the resolved vector, every mandatory required input (per §4) must be present; missing → exit 2 with a structured list (each: artifact, the dimension+level that requires it, action `provide-or-generate`). Editorial/future requirements are listed as `declared`, non-blocking.
- **`runBatch` is vector-scoped:** runs only gates where `vector[dimension] ≥ minLevel` (the **rubric**); gates below their threshold report status `not-owed`; declared-future artifacts report `declared`. `mustPassFailed`/`clean` consider only **binding must** gates. The report carries the resolved vector + the rubric (binding gate ids).
- **Renderer by the `visual` dimension:** previews use resvg at `visual = 0` (greybox) and **Playwright at `visual ≥ 1`** (tokenized/branded). Playwright is an optional dep; unavailable → fall back to resvg + a declared note (never a hard error).
- **`SKILL.md` (the loop):** set fidelity (preset + overrides) → readiness check → generate missing required artifacts (agent) → run `uxfactory batch` (the rubric) → on exit 1 read findings + revise → repeat to exit 0 (the level's binding hard checks pass) or maxIterations → optionally promote a dimension and re-run readiness.

## 7. Phase 7 (review) reuses the same fidelity

`uxfactory review <design> --fidelity <preset|vector>` reuses the same dimension/binding selection + the same gates, pointed at a single design, emitting a review report scoped to the binding criteria. Fidelity is shared infrastructure built here, reused by review.

## 8. Build order (tasks)

1. **`src/batch/fidelity.ts`** — dimensions, `Fidelity` vector type, `PRESETS`, `parseFidelity` (preset name or vector), override resolution, `GATE_DIMENSION`+`GATE_MIN_LEVEL`, required-input manifest, declared-future, helpers (`bindingGateIds(vector)`, `requiredInputs(vector)`, `declaredFuture(vector)`), `checkReadiness(vector, present)`. Pure.
2. **Vector-scoped `runBatch`** (`src/batch/run.ts`) — `fidelity: Fidelity` input; `not-owed`/`declared` statuses; rubric = binding gates; must-gating only on binding must-fails; report carries the vector + rubric.
3. **Registry `fidelity` (preset|vector) + flags + readiness precondition** wired into `batchCmd` (unset → 2; missing required → 2 with the list; ready → vector-scoped run; `--json` carries the vector report) + built artifact + monorepo green.
4. **Playwright renderer** (`src/render/raster-playwright.ts`, lazy import, fallback+declare) + renderer-by-`visual`-dimension selector in batch previews + `playwright` devDep; the live Playwright render test SKIPS when the browser is unavailable (suite stays hermetic).
5. **`skill/batch/SKILL.md`** vector-aware loop + re-vendor into uxfactory-cc (byte-match) + tests (no external refs).

## 9. Sub-decisions (confirmed defaults)

- Fidelity unset → exit 2 (required, no silent default).
- Promotion = single resolved vector per CLI call; the SKILL.md walks dimensions/levels.
- Playwright missing at `visual ≥ 1` → fall back to resvg + declare (not a hard error).

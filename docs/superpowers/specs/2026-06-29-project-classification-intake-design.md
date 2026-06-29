# UXFactory — Project Classification Intake (design)

**Date:** 2026-06-29
**Status:** approved (decisions locked)
**Grounds in:** Companion PRD `.plans/UXFactory-Design-Artifacts-and-Models-PRD.md` §3 (intake), §4 (artifact catalog), §5.8 (ProjectClassification), §6.6 (conditioning + Confirm gate); builds on the four-dial render scope (§6.5 / Phase 6.5) and batch (§13 / Phase 6).
**The deferred §5.8/§6.6 layer — "the intake above the spec tree."**

## 1. Problem

Before a batch renders, the free-form `DesignBrief` is hardened into a small **enumerated classification vector** answered once. A pure **conditioning function** derives, from that vector alone, which artifacts are **requested / generatable / suppressed** and a tuned **GateProfile** (render scope + compliance constraints + tier weighting). A human approves the derived plan at a **Confirm gate** — the compute-commit boundary — and the profile is **pinned**; only then does the batch render. This makes the classification the _enforced parameter source_ with total provenance: every gate in a run traces to the dimension that forced it.

Three-phase shape: **Intake → Scoping → Confirm**.

## 2. The classification vector (§5.8)

`uxfactory.classification.json` (committed, OWNED — the intake answer). Controlled vocabulary:

```jsonc
{
  "version": 1,
  "category":       "marketing" | "ecommerce" | "web_app" | "news",       // archetype
  "industry":       "education" | "corporate" | "healthcare" | "finance" | "consumer",
  "age_demographic":"children" | "teens" | "18-25" | "26-35" | "36-50" | "50+",
  "style":          "informal" | "mix" | "formal",
  "scope": { "visual": "low|medium|high", "editorial": "...", "coverage": "...", "flow": "..." }, // the 4 dials (§6.5)
  "flow_refs": ["checkout", "..."]    // which User Flows seed the batch (≠ the flow dial's depth)
}
```

## 3. The conditioning function (§6.6 Stage 2) — pure, deterministic, NO LLM

`condition(classification) → GateProfile`. A **fixed per-dimension effect map**; conflicting effects resolve **strictest-wins** (a compliance/raising effect always dominates a relaxing one). The output:

```
GateProfile (the pinned plan)
  scope: RenderScope { visual, editorial, coverage, flow }   // derived (category defaults ⊕ explicit dials, floors applied)
  manifest: ManifestEntry[]                                   // per §4 catalog artifact
  constraints: string[]                                       // forced compliance (FERPA/COPPA, HIPAA, disclosure)
  notes: string[]                                             // tier-weighting + archetype notes (recorded; engine doesn't weight yet)
  confirm_status: "draft" | "approved"
ManifestEntry
  artifact_kind     // a §4 catalog kind (AcceptanceCriterion, TokenSet, UserFlow, A11yProfile, BrandGuide, EditorialStyle, MotionSystem, DiscoverabilityStrategy, ...)
  requirement       // "requested" | "generatable" | "suppressed"
  gate_effect       // "hard" | "soft" | "suppressed"
  enforced          // boolean — true only for artifacts the engine can CHECK today (decision: full catalog, enforce checkable)
  derived_from      // string[] — the dimension(s) that forced this entry (provenance)
```

### 3.1 Effect map (the authoritative table — implement verbatim)

**Category (archetype):**

| category    | requests / view-state archetypes                                                             | scope defaults                              | tier notes                 |
| ----------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------- |
| `ecommerce` | cart/checkout/PDP states; **payment-failure ACs** (requested); trust-badge `BrandGuide.Rule` | —                                           | Tier 2 up                  |
| `news`      | article/feed/section; **`DiscoverabilityStrategy` → requested**; gentler reading-level       | —                                           | Tier 9 up                  |
| `marketing` | hero/CTA/landing states; `BrandGuide` requested                                              | **coverage `low`, flow `low`** (shallow)    | Tiers 6–7 up; Tier 2 light |
| `web_app`   | dashboard/CRUD/auth/empty states; **`DiscoverabilityStrategy` → suppressed**                 | **coverage `high`, flow `high`** (stateful) | Tiers 2–4 up               |

**Industry:**

| industry                 | effect                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| `education`              | `constraints += FERPA, COPPA`; A11yProfile floor raised; age-appropriate copy |
| `healthcare`             | `constraints += HIPAA`; raises Tier 5 + Tier 8 rigor                          |
| `finance`                | `constraints += disclosure`; raises Tier 5 + Tier 8 rigor                     |
| `corporate` / `consumer` | defaults                                                                      |

**Age demographic:**

| age        | effect                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `children` | `A11yProfile` requested (stricter target size/contrast); `reading_level` low; **dark-pattern ban**; simplified flows |
| others     | defaults                                                                                                             |

**Style:** `formal` → `EditorialStyle.voice` = formal, tightens Tier 8 voice threshold; `informal`/`mix` → defaults.

**Scope dials:** `scope.visual/editorial/coverage/flow` set the `min_*` cuts → the `RenderScope` (reuse Phase 6.5). Category provides **defaults**; the classification's explicit dials **override**; compliance **floors** can't be lowered (strictest-wins).

**flow_refs:** enumerate which flows seed the batch's view-states (expected sequence → Tier 2).

### 3.2 Per-artifact disposition (the manifest, v1)

Each §4 catalog kind gets a `requirement` + `gate_effect` + `enforced` + `derived_from`. **`enforced: true`** only for artifacts the engine can gate today; everything else is `enforced: false` (declared — recorded with provenance; the agent provides/drafts it; the engine doesn't gate it yet).

| artifact_kind                       | requirement                                                                        | enforced? (engine gate)                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `AcceptanceCriterion` (→ `stories`) | always **requested** (the moat)                                                    | **yes** → batch `requirement-coverage` / readiness `stories` |
| `TokenSet` (→ `tokens`)             | requested if `scope.visual ≥ medium`, else generatable/suppressed                  | **yes** → `token-conformance` / readiness `tokens`           |
| `UserFlow` (→ `flow`)               | requested if `scope.flow ≥ medium`                                                 | **yes** → `flow-reachability` / readiness `flow`             |
| reuse specs                         | generatable/optional                                                               | yes → `reuse` (optional)                                     |
| `A11yProfile`                       | requested if `age=children` or `industry=education`                                | no (declared)                                                |
| `BrandGuide.Rule`                   | requested if `category ∈ {marketing, ecommerce}`                                   | no (declared)                                                |
| `EditorialStyle`                    | generatable (drafted from style+industry); requested if `scope.editorial ≥ medium` | no (declared)                                                |
| `MotionSystem`                      | suppressed if `scope.visual=low`; generatable otherwise                            | no (declared)                                                |
| `DiscoverabilityStrategy`           | requested if `category=news`; suppressed if `category=web_app`; else generatable   | no (declared)                                                |

## 4. Surfaces

- **`uxfactory.classification.json`** — the committed vector (Intake output).
- **`uxfactory classify`** — read the classification → `condition()` → write a PROPOSED `uxfactory.profile.json` (`confirm_status: "draft"`); `--json` emits the GateProfile. `--confirm` PINS it (`confirm_status: "approved"`) — the compute-commit boundary. Absent/invalid classification → exit 2.
- **`uxfactory.profile.json`** — the GENERATED/pinned GateProfile (the plan).
- **Batch integration:** `uxfactory batch` reads the pinned profile when present — its `scope` becomes the batch scope, its **REQUESTED + enforced** artifacts feed readiness (overriding/augmenting the registry). A batch refuses to render against an UN-pinned (draft) profile (`confirm_status` must be `approved`) — the §6.6 compute-commit boundary. `uxfactory.batch.json` (the inputs registry) still maps each artifact → file path.
- **The intake `SKILL.md`** (`skill/intake/SKILL.md`, vendored into `uxfactory-cc`): the agent runs **Intake → Scoping → Confirm** —
  1. **Intake:** ask the 7 dimensions one at a time (progressive disclosure; each answer narrows the next) → write `uxfactory.classification.json`.
  2. **Scoping:** run `uxfactory classify` → read the derived manifest.
  3. **Confirm:** **assert the needed (REQUESTED) artifacts; for each one not already provided, PROMPT the user: provide it, or confirm the agent should build it.** Draft the agent-build / GENERATABLE ones. Apply **asymmetric friction** — adding is easy; removing a REQUESTED artifact needs justification (the manifest's `derived_from` says which dimension forced it). On sign-off → `uxfactory classify --confirm` (pin) → `uxfactory batch` (which now reads the pinned profile).

## 5. Engine vs. agent split (self-contained; no in-engine LLM)

| Concern                                                                                                                                                       | Owner                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| classification schema + validate; the conditioning function (effect map, strictest-wins); `classify` (derive/propose/pin); batch reads the pinned profile     | **Engine** (pure/deterministic)        |
| Conducting the intake conversation; the Confirm-gate prompting (assert needed → provide-or-build); **drafting** GENERATABLE artifacts; asymmetric-friction UX | **Agent**, via `skill/intake/SKILL.md` |

## 6. Build order (tasks)

1. **`src/classify/classification.ts`** — `ProjectClassification` types + controlled-vocab `validateClassification` + `readClassification`. Pure.
2. **`src/classify/condition.ts`** — `condition(classification) → GateProfile` (the §3 effect map, strictest-wins, scope derivation reusing `scope.ts`, the §3.2 manifest). Pure. The biggest/most-tested task.
3. **`uxfactory classify` command** (derive → write draft `uxfactory.profile.json` → `--confirm` pins) + `--json` + cli/index wiring + **batch integration** (batch reads the pinned profile: scope + REQUESTED-enforced readiness; refuses a draft profile) + built artifact.
4. **`skill/intake/SKILL.md`** (Intake → Scoping → Confirm; assert-needed + provide-or-build; draft; pin; batch) + vendor into `uxfactory-cc` (byte-match) + tests (no external refs).

## 7. Decisions (locked)

- **Full §4 catalog manifest; enforce the checkable, declare the rest** (`enforced` flag + provenance).
- **The pinned profile is the plan `batch` reads** (separate `uxfactory.profile.json`; `confirm_status` draft→approved is the compute-commit boundary; batch refuses a draft).
- Conditioning is a **pure deterministic map** (no LLM); strictest-wins on conflicts; drafting GENERATABLE artifacts is the agent's job (skill).
- Reuses the Phase 6.5 `RenderScope`/`scope.ts` for the scope dials; reuses batch readiness for the enforced REQUESTED artifacts.

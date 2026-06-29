---
name: uxfactory-intake
description: "Conduct the UXFactory project classification intake — harden a design brief into a classification vector, derive and review a GateProfile manifest, and pin it at the Confirm gate before a batch renders. Use when the user wants to start or scope a new design project or batch: classify a project, pick a render scope, or lock in which artifacts are needed before generating screens."
compatibility: "Requires uxfactory-cli (Node 20+). Conditioning is deterministic and runs fully offline — no external service needed."
---

# UXFactory — Project Classification Intake

This skill drives three sequential phases: **Intake → Scoping → Confirm**. It produces a committed `uxfactory.classification.json`, a derived `uxfactory.profile.json`, and triggers `uxfactory batch` only after the profile is pinned at the Confirm gate.

The conditioning function is **pure and deterministic** — no LLM. Every artifact in the manifest traces to the exact dimension that forced it (`derived_from`). Compliance constraints (e.g. FERPA/COPPA from `education`+`children`, HIPAA from `healthcare`) are recorded in the profile and re-derived on every `classify`; the agent must honor them.

---

## Phase 1: Intake

Ask the **dimensions** one at a time using **progressive disclosure** — each answer narrows the options for the next. Do not batch questions. Write the completed answers to `uxfactory.classification.json`.

### Dimensions (ask in order)

**1. `category` — project archetype**
`marketing` | `ecommerce` | `web_app` | `news`

_Shapes scope defaults (marketing→coverage:low,flow:low; web_app→coverage:high,flow:high) and which artifact types are requested._

**2. `industry` — domain**
`education` | `corporate` | `healthcare` | `finance` | `consumer`

_Forces compliance constraints: education→FERPA, COPPA; healthcare→HIPAA; finance→disclosure._

**3. `age_demographic` — primary user age**
`children` | `teens` | `18-25` | `26-35` | `36-50` | `50+`

_`children` forces A11yProfile (stricter targets), low reading level, and a dark-pattern ban._

**4. `style` — editorial voice**
`informal` | `mix` | `formal`

_`formal` tightens the EditorialStyle voice threshold._

**5–8. Scope dials — four independent render-depth controls**
Each dial: `low` | `medium` | `high`

| Dial        | What it controls                                        |
| ----------- | ------------------------------------------------------- |
| `visual`    | Fidelity depth (greybox → tokens/color → full styling)  |
| `editorial` | Copy depth (placeholder → draft → final on-voice)       |
| `coverage`  | State breadth (happy path → empty/loading/error → all)  |
| `flow`      | Path breadth (single screen → primary flow → all paths) |

Category sets **floors** on the four dials — a dial you set below its category floor is raised to the floor (strictest-wins); dials at or above the floor take your value. Only `web_app` has non-trivial floors (coverage/flow = high). Industry/age/style affect compliance constraints, the A11y/voice/reading-level requirements, and tier notes — NOT the scope dials.

**9. `flow_refs` — which user flows seed the batch**
Array of named flows (e.g. `["checkout", "sign-up"]`). These enumerate the view-state sequences Tier 2 expects — distinct from the `flow` dial's depth.

### Output: `uxfactory.classification.json`

```json
{
  "version": 1,
  "category": "ecommerce",
  "industry": "consumer",
  "age_demographic": "26-35",
  "style": "mix",
  "scope": { "visual": "medium", "editorial": "medium", "coverage": "medium", "flow": "medium" },
  "flow_refs": ["checkout", "pdp"]
}
```

---

## Phase 2: Scoping

Run:

```bash
uxfactory classify
```

This reads `uxfactory.classification.json`, applies the conditioning function, and writes a **proposed** `uxfactory.profile.json` with `confirm_status: "draft"`.

Read the manifest. Each entry declares:

- `artifact_kind` — catalog kind (AcceptanceCriterion, TokenSet, UserFlow, A11yProfile, BrandGuide, EditorialStyle, MotionSystem, DiscoverabilityStrategy, …)
- `requirement` — `requested` | `generatable` | `suppressed`
- `enforced` — `true` if the engine gates it today (stories, tokens, flow, reuse); `false` if declared only
- `derived_from` — which dimension(s) forced this entry (provenance)

Present the manifest summary to the user: REQUESTED artifacts (needed), GENERATABLE ones (the agent will draft them), SUPPRESSED ones (excluded by the classification).

Also show any `constraints` (compliance strings) — these are forced and cannot be removed.

---

## Phase 3: Confirm

This is the **compute-commit boundary**. `uxfactory batch` refuses to render against a draft profile (`confirm_status` must be `"approved"`). Nothing renders until Confirm.

### Step 1 — Assert REQUESTED artifacts

For each `requirement: "requested"` artifact in the manifest:

- If it **already exists** at the registered path in `uxfactory.batch.json` → acknowledge.
- If it does **not exist** → **PROMPT the user**: "Provide `<artifact_kind>` at `<expected-path>`, or confirm the agent should build it."

Do not skip this step. Every requested artifact must be resolved (provided or agent-build confirmed) before pinning.

### Step 2 — Draft GENERATABLE artifacts

For each `requirement: "generatable"` artifact, draft it now if the user has not provided one. Write it to the registered path.

### Step 3 — Asymmetric friction

- **Adding** an artifact to the plan: easy — just add it to the batch inputs.
- **Removing a REQUESTED artifact**: requires explicit justification. Cite the `derived_from` dimension that forced it (e.g. "A11yProfile is required because `age_demographic: children`"). If the user cannot justify removing it, it stays.

Compliance constraints (FERPA/COPPA, HIPAA, disclosure) are recorded in the profile and re-derived whenever you re-run `uxfactory classify` — they are not gated by the engine reading the profile back, but the agent must honor them. Re-classifying re-imposes them.

### Step 4 — Pin and run

On user sign-off:

```bash
uxfactory classify --confirm   # pins the profile (confirm_status → "approved")
uxfactory batch <specs-dir>    # reads the pinned profile; renders at profile scope
```

`uxfactory batch` now reads the pinned `uxfactory.profile.json`: the profile's `scope` becomes the batch scope; REQUESTED + enforced artifacts feed readiness (a missing one → exit 2 with a missing list).

If `classify --confirm` has not been run, `uxfactory batch` exits 2 with: _"profile not confirmed — run `uxfactory classify --confirm`"_.

---

## Quick reference

| Command                        | Effect                                                           |
| ------------------------------ | ---------------------------------------------------------------- |
| `uxfactory classify`           | Derive and write draft `uxfactory.profile.json`                  |
| `uxfactory classify --confirm` | Pin the profile (`confirm_status → "approved"`) — the gate opens |
| `uxfactory classify --json`    | Emit GateProfile to stdout (scope + manifest + constraints)      |
| `uxfactory batch <dir>`        | Render; reads pinned profile; refuses a draft (`exit 2`)         |

---
name: uxfactory-batch
description: "Create one or more UI components, a screen, or a set of pages OFFLINE as UXFactory specs at a declared render scope — no Figma required — using only the uxfactory CLI and this loop. Set a four-dial scope (visual/editorial/coverage/flow), drive the batch to a clean mechanical bar, and ratchet dials as the design matures. Use WHENEVER the user wants to generate a batch of screens/components/pages as structured specs and have them gated for the gates that bind at the chosen scope. Do NOT use it for the online single-spec render→verify loop (that is the main uxfactory skill) or for pixel-faithful sign-off."
compatibility: "Requires the uxfactory-cli (Node 20+). Gating and previews run fully offline — no bridge or Figma needed until the optional --stage hand-off."
---

# UXFactory — scope-aware offline batch loop

This skill teaches you to author **one or more UI components / a screen / a set of pages** as UXFactory specs, offline, driven by a **render scope** — four dials that select which gates bind. The CLI runs **one deterministic gate pass** and its **exit code** tells you whether to stop or revise. You are the loop; `uxfactory batch` is the gate.

## The four-dial render scope

A scope is a vector of **four dials** in two pairs. Every dial is **`low | medium | high`**.

**Fidelity pair** — depth of one rendered ViewState:

| Dial        | Measures       | `low`               | `medium`                      | `high`                  |
| ----------- | -------------- | ------------------- | ----------------------------- | ----------------------- |
| `visual`    | how it _looks_ | greybox / wireframe | tokens + type + color applied | full production styling |
| `editorial` | what it _says_ | placeholder / lorem | draft real copy               | final, on-voice copy    |

**Completeness pair** — traversal of the spec graph:

| Dial       | Measures                                | `low`                          | `medium`                  | `high`                               |
| ---------- | --------------------------------------- | ------------------------------ | ------------------------- | ------------------------------------ |
| `coverage` | states _within_ a view (AC → ViewState) | success/populated only         | + empty · loading · error | + all AC edge states                 |
| `flow`     | paths _across_ views (View → View)      | single screen / happy snapshot | primary flow end-to-end   | all branches, back/cancel, deep-link |

The four dials move **independently** — raising `visual` does not raise `flow`.

### Presets

A named preset is a convenient starting coordinate. Overrides apply on top.

| Preset        | visual | editorial | coverage | flow   |
| ------------- | ------ | --------- | -------- | ------ |
| `wireframe`   | low    | low       | low      | low    |
| `content`     | low    | high      | medium   | low    |
| `visual`      | high   | medium    | medium   | medium |
| `interactive` | high   | high      | high     | high   |
| `production`  | high   | high      | high     | high   |

(`interactive` and `production` coincide on the currently implemented gates; their difference is in deferred tiers.)

### Setting the scope

In `uxfactory.batch.json` set the `scope` field (preset name **or** partial vector):

```jsonc
{
  "version": 1,
  "scope": "wireframe", // or { "visual": "high", "coverage": "medium" }
  "inputs": {
    "tokens": "design/tokens.ds.json",
    "stories": "design/stories.json",
    "flow": "design/flow.json",
  },
  "maxIterations": 6,
}
```

Or pass flags at the CLI (flags override the registry):

```bash
uxfactory batch specs --scope visual           # preset
uxfactory batch specs --scope wireframe --visual high  # preset + per-dial override
uxfactory batch specs --visual high --coverage medium  # raw vector (partial; missing dials default to low)
```

Per-dial flags: `--visual`, `--editorial`, `--coverage`, `--flow` each take `low | medium | high`.

**Scope unset** → exit 2. Set a scope before running a batch.

## Per-dial gate binding

A gate binds **only when the scope meets every one of its per-dial thresholds**. Non-binding gates report `not-owed` and never gate the batch.

| Gate                          | Binds when         | Required input                           |
| ----------------------------- | ------------------ | ---------------------------------------- |
| `requirement-coverage`        | `coverage >= low`  | `stories`                                |
| `reuse`                       | `coverage >= low`  | — (optional; skip-and-declare if absent) |
| `coverage-orphans` (advisory) | `coverage >= low`  | —                                        |
| `token-conformance`           | `visual >= medium` | `tokens`                                 |
| `flow-reachability`           | `flow >= medium`   | `flow`                                   |

At `--scope wireframe` (all low): `token-conformance` is `not-owed` (tokens not required); `flow-reachability` is `not-owed`; only the coverage trio binds — `stories` is required (readiness fails if absent; see real-use note in Gotchas).

### Declared tiers (acknowledged, not yet gated)

The following quality tiers are **declared** in the report but never block a batch in this version: brand, contrast, motion, keyboard, content-voice, a11y, i18n, discoverability. They appear in the report as `declared` — never silently ignored, never blocking.

## The loop

### Step 0 — Set scope

Pick a preset (or raw vector) in `uxfactory.batch.json` or via `--scope`. Start low and ratchet up.

### Step 1 — Readiness check (exit 2 + missing list)

Run `uxfactory batch <dir>`. If the scope requires an artifact that is absent, the command exits 2.

**Human mode (stderr):**

```
batch: readiness check failed — missing required artifacts:
  - tokens (visual:medium) — provide-or-generate
  - flow (flow:medium) — provide-or-generate
```

**`--json` mode (stdout):**

```json
{
  "ok": false,
  "reason": "not-ready",
  "missing": [
    { "artifact": "tokens", "dial": "visual", "level": "medium", "action": "provide-or-generate" },
    { "artifact": "flow", "dial": "flow", "level": "medium", "action": "provide-or-generate" }
  ],
  "declared": []
}
```

Scope unset (no `--scope` flag and no `scope` in the registry) also exits 2. In `--json` mode: `{ "ok": false, "reason": "scope-unset", "missing": [], "declared": [] }`.

When you receive exit 2 with a missing list, **generate the missing artifacts** (stories, tokens, flow) based on the user's content, then re-run. Do not spin: count generate-and-retry attempts against `maxIterations`.

Exit 2 without a missing list means a registry or input problem — fix the setup, not the spec.

### Step 2 — Iterate on the rubric (exit 1 → revise)

Once ready, `uxfactory batch` runs only the **binding gates** (the rubric at this scope). On exit `1`, read `.uxfactory/batch/report.json` findings and **revise the specs or artifacts**, then re-run. The rubric is stable for a fixed scope — the same gates re-run each iteration.

Author specs so the gate can trace them:

- story id in the **frame name** (`story-1-home`)
- acceptance-criterion state keyword in a **node name** (`home-empty-state`, `home-success-view`)
- registered token colors for every fill/stroke
- reference existing registered specs instead of regenerating

### Step 3 — Stop

Stop when `uxfactory batch` exits `0` (every binding must-pass gate is green) **or** you have spent `maxIterations` total attempts (generate + revise combined). If the budget runs out, surface the **best-effort** batch with the open findings listed. **Never spin.**

### Step 4 — Ratchet (optional)

To promote the design, raise one dial:

```bash
uxfactory batch specs --visual medium   # raises visual; re-runs readiness
```

New binding gates may require new artifacts (e.g. `tokens` now required at `visual:medium`). Follow the readiness loop again for the new scope. Ratchet one dial at a time; each new scope is its own iteration budget.

## Exit codes — the termination contract

| Code | Meaning                                                            | What to do                                                       |
| ---- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `0`  | Every binding must-pass gate is green                              | **Stop.** Hand off for human approval.                           |
| `1`  | A binding must-pass gate failed                                    | Read `report.json` findings; revise specs/artifacts; re-run.     |
| `2`  | Scope unset, missing REQUESTED artifact, or registry/input problem | See the `missing` list; generate artifacts or fix setup; re-run. |

`exit 2` is **never a quality signal** — it means setup. Do not revise specs for it.

## Outputs

Ephemeral under `.uxfactory/batch/` (gitignored): `report.json` (gates + findings + `scope` + `rubric`) and `previews/<spec>.png` (offline preview per spec; rendered by the `visual` dial — resvg at `low`, high-fidelity renderer at `medium/high` when available). Committed inputs are never written to.

## Gotchas

- **One call = one deterministic pass.** You iterate; the exit code stops you.
- **Non-binding gates are `not-owed`** — `token-conformance` at `wireframe` is not a skip, it is genuinely not owed.
- **`coverage-orphans` is advisory** — story-less frames never gate the batch.
- **`stories.json` is always required.** `coverage >= low` holds for every valid scope, so `requirement-coverage` always binds and `stories` is always a REQUESTED input. For a pure component batch with no stories yet, use `{"stories":[]}` as a placeholder.
- **`flow.json` is required at `flow >= medium`** (e.g. the `visual` and `interactive` presets) even though `flow-reachability` is advisory. Readiness enforces presence before the gate even runs.
- **Previews at `visual:low`** are approximate raster; `visual>=medium` uses the high-fidelity renderer (falls back to resvg with a declared note if unavailable — not a hard error).
- **Name for traceability** — gates match on **names**: story ids in frame names, state keywords in node names, flow step names matching node/frame names.
- **Respect `maxIterations`**; count both generate attempts (step 1) and revise attempts (step 2).

---
name: uxfactory-design
description: "Author REAL high-fidelity UI design specs (*.uxfactory.json) that cover a project's user stories and acceptance criteria, then drive the deterministic `uxfactory batch` gate to a green bar — authoring matching design tokens when the visual dial demands them. Use WHENEVER the user wants production-shaped UI screens generated from stories/acceptance-criteria and gated PASS/FAIL, not a freeform sketch. You are the agentic loop: you draft specs, run the gate, read its report, revise, and stop when the gate is clean (exit 0) or the iteration budget is spent. Do NOT use it for the single-spec online render→verify loop (that is the main uxfactory skill) or for drafting one upstream artifact (that is the generate skill)."
compatibility: "Requires the uxfactory-cli (Node 20+). Gating and previews run fully offline — no bridge or Figma needed. Self-contained: the engine stays LLM-free and only gates; you author the content."
---

# UXFactory — author real UI specs, drive the gate green

You are an autonomous designer-in-the-loop. Your job: turn a project's **stories + acceptance criteria** into **real `*.uxfactory.json` UI specs** that pass the deterministic `uxfactory batch` gate at the project's render scope. You author the content; `uxfactory batch` is the gate. One `batch` call = one deterministic pass; its **exit code** stops you.

The loop is: **author → gate → read the report → revise → green**. Drop to a deterministic fallback to cover any gap. Never spin: every draft/revise counts against `maxIterations`.

## Step 0 — Read the pinned context

Read these from the project root before authoring anything:

- **`design/acceptance-criteria.json`** — the stories: `{ "stories": [ { "id", "role", "goal", "benefit", "acceptanceCriteria": [ { "statement", "impliedState" } ] } ] }`. `impliedState` is one of exactly `empty` · `loading` · `error` · `success` · `edge`. These are the requirements you must cover.
- **`uxfactory.profile.json`** — the pinned scope dials (`visual` / `editorial` / `coverage` / `flow`, each `low|medium|high`) plus non-negotiable `constraints`. The dials decide which gates bind and how deep your specs must go. Honor every constraint (accessibility, reading level, disclosure, …).
- **`uxfactory.batch.json`** — `maxIterations` (your hard iteration budget) and `inputs` (the registry paths the gate reads — `inputs.stories`, `inputs.tokens`, `inputs.flow`). **Write artifacts to the registered paths.** If `inputs.tokens` is unset and you need tokens, write `design/tokens.ds.json` and register that path in `inputs.tokens`.

## Step 1 — Author REAL specs (one file per story)

For **each story**, write `design/<story.id>.uxfactory.json` as a valid `DesignSpec`:

```json
{
  "frames": [
    {
      "name": "<story.id>-success",
      "x": 0,
      "y": 0,
      "width": 390,
      "height": 844,
      "children": [
        {
          "type": "shape",
          "name": "<story.id>-success-card",
          "x": 24,
          "y": 96,
          "width": 342,
          "height": 220,
          "fill": "#FFFFFF",
          "stroke": "#E5E7EB",
          "cornerRadius": 12
        },
        {
          "type": "text",
          "name": "<story.id>-success-heading",
          "x": 40,
          "y": 120,
          "width": 300,
          "height": 32,
          "characters": "Order confirmed",
          "fill": "#111827"
        }
      ]
    }
  ]
}
```

Rules the deterministic gate enforces — author so it can trace your specs by **name**:

- **Frame names token-match the story id.** Names split on `[-_/\s]+`; the story id's segments must appear as a contiguous run. `checkout` → frame `checkout-success` ✓; `story-1` → frame `story-1-empty` ✓. (`story-1` will NOT match `story-12-home` — the `12` ≠ `1`.)
- **One frame per AC `impliedState`.** Each acceptance criterion implies a view-state; give that story a frame (or a node within it) whose name contains the state keyword. For impliedState `empty`/`loading`/`error`/`success`/`edge`, a node named `<story.id>-<state>-…` (e.g. `checkout-error-banner`) satisfies it — the keyword must appear **inside a node name of that story's own frames**.
- **Realistic children.** Use real shapes + text with real copy and sensible `x`/`y`/`width`/`height` layout — a heading, body, primary action, and the state-specific content (an empty-state illustration label, an error message, a loading placeholder, a success confirmation). At `editorial >= medium` write draft real copy, not lorem. Honor profile constraints in the copy.
- **Valid `DesignSpec` only.** Children are `shape` / `text` / `instance`. A `shape` carries `type,name,x,y,width,height` (+ optional `fill`,`stroke`,`strokeWidth`,`cornerRadius`,`characters`,…); a `text` additionally requires `characters`. No extra properties — the validator rejects unknown keys.

## Step 2 — Author tokens (only when `visual >= medium`)

`token-conformance` binds at `visual >= medium`: **every** `fill`/`stroke` hex used anywhere in your specs must be a registered token color. When the profile's `visual` dial is `medium` or `high`:

- Write `design/tokens.ds.json` = `{ "colors": { "<name>": "#RRGGBB", … } }` registering EVERY color your specs use (background, surface, border, text, brand, state colors — success/error/etc.), and use those exact hexes in the specs.
- Register it: ensure `uxfactory.batch.json` `inputs.tokens` points at your tokens file. You MUST do this yourself — there is no auto-registration inside this loop, so an unregistered tokens file at `visual >= medium` makes `batch` exit 2 (missing required input). Keep the spec hexes and the registered hexes identical (the check normalizes 3- and 6-digit hex, case-insensitively).

At `visual: low` tokens are **not owed** — skip them; a greybox/wireframe with no color is fine.

## Step 3 — The loop: gate → read report → revise

Run the gate over your specs directory:

```bash
uxfactory batch --json -- design
```

This writes `.uxfactory/batch/report.json` (gates + findings + `scope` + `rubric`) and returns a **loop-termination exit code**:

| Code | Meaning                                              | What to do                                                       |
| ---- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `0`  | every binding `must` gate is green                   | **Stop.** The batch is clean.                                    |
| `1`  | a binding `must` gate failed                         | read the findings; revise; re-run                                |
| `2`  | scope unset / missing required input / setup problem | fix setup (e.g. register `inputs.stories`); NOT a quality signal |

On **exit 1**, read `.uxfactory/batch/report.json` and act on every `must` check with `status: "fail"`, using its `findings[].detail` / `findings[].ref`:

- **`requirement-coverage` fail** — a story has no covering frame, or an AC's `impliedState` has no matching node. Add a covering frame named for the story id, or add a node whose name contains the missing state keyword to that story's frames.
- **`token-conformance` fail** — an ad-hoc color is not a registered token. Either add that hex to `design/tokens.ds.json`, or change the spec to use an already-registered hex.
- `coverage-orphans` is **advisory** (never blocks) — but a frame flagged here has no story basis; rename it to match a story id or fold it into a story's spec.

Revise the specs/tokens, then re-run `uxfactory batch --json -- design`. The rubric is stable for a fixed scope — the same gates re-run each pass.

## Step 4 — Coverage fallback (deterministic)

If you cannot cover a story or state with real authored content, scaffold the gap deterministically:

```bash
uxfactory generate-specs --force
```

This writes skeleton frames + labels derived from the registered stories (a covering frame per story with state-keyword nodes), so `requirement-coverage` can go green. Then **refine real content on top** of the scaffold — replace the skeleton labels with real copy and layout. Treat the scaffold as a floor, not the deliverable.

## Step 5 — Stop

Stop when `uxfactory batch` returns **exit 0** (clean) **or** you have spent `maxIterations` total attempts (each draft and each revise counts as one). If the budget runs out, surface the best-effort specs with the open findings listed. **Never spin** — do not re-run the gate without changing anything.

## Progress feedback (emit at EVERY step)

The loop runs for minutes and a panel renders your progress. At each loop step, print **exactly one line** to stdout, compact JSON on its own line:

```
UXF::PROGRESS {"iter":<n>,"phase":"draft"|"gate"|"revise"|"done","gate":<gate-id-or-null>,"status":"pass"|"fail"|null,"findings":<count>,"note":"<short note>"}
```

Emit it:

- **before drafting** — `{"iter":1,"phase":"draft","gate":null,"status":null,"findings":0,"note":"authoring 3 story specs"}`
- **after each `uxfactory batch` run** — `phase:"gate"` with the first failing gate id + `status:"fail"` + the `findings` count, or `status:"pass"` when clean: `{"iter":2,"phase":"gate","gate":"requirement-coverage","status":"fail","findings":2,"note":"2 stories uncovered"}`
- **before each revise** — `{"iter":3,"phase":"revise","gate":"requirement-coverage","status":null,"findings":2,"note":"fixing checkout/success"}`
- **once at the end** — `phase:"done"` with `status` from the clean result: `{"iter":4,"phase":"done","gate":null,"status":"pass","findings":0,"note":"gate green"}`

Keep `note` SHORT and secret-free (never echo keys or tokens). The line is in addition to your normal narration.

## Report

When you stop, report briefly: the spec files you wrote (`design/<id>.uxfactory.json`), whether `design/tokens.ds.json` was authored (and why — the `visual` dial), whether the gate reached **green** (exit 0) or you hit the iteration budget with open findings, and the **iteration count** you spent.

## Quick reference

| Step | Action                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 0    | Read `design/acceptance-criteria.json`, `uxfactory.profile.json`, `uxfactory.batch.json`                        |
| 1    | Author `design/<story.id>.uxfactory.json` per story — frame names match story ids, state keywords in node names |
| 2    | If `visual >= medium`, author `design/tokens.ds.json` registering every fill/stroke hex                         |
| 3    | `uxfactory batch --json -- design` → read `.uxfactory/batch/report.json` → revise `must` fails → re-run         |
| 4    | `uxfactory generate-specs --force` to scaffold any gap, then refine real content on top                         |
| 5    | Stop at exit 0 (clean) or `maxIterations`; emit `UXF::PROGRESS` at every step                                   |

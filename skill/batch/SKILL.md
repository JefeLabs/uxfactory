---
name: uxfactory-batch
description: "Create one or more UI components, a screen, or a set of pages OFFLINE as UXFactory specs — no Figma required — using only the uxfactory CLI and this loop. Use this skill WHENEVER the user wants to generate a batch of screens/components/pages as structured specs and have them mechanically gated for token conformance, requirement/state coverage, reuse, and flow reachability before a human reviews them. Run the deterministic gate, read its findings, revise the specs, and re-run until the gate is green or the iteration budget is spent, then hand the batch to the human. Do NOT use it for the online single-spec render→verify loop (that is the main uxfactory skill) or for pixel-faithful sign-off."
compatibility: "Requires the uxfactory-cli (Node 20+). Gating and previews run fully offline — no bridge or Figma needed until the optional --stage hand-off."
---

# UXFactory — offline batch loop

This skill teaches you to author **one or more UI components / a screen / a set of pages** entirely offline as UXFactory specs, and to drive them to a clean mechanical bar before a human ever looks. There is no judge and no scoring engine here: the CLI runs **one deterministic gate pass** and its **exit code** tells you whether to stop or revise. The subjective judgment — is the flow sensible, is the labeling clear — is **yours**, guided by the gate's findings. You are the loop; `uxfactory batch` is the gate.

## When to use this skill

Use it when the user wants to **generate a batch of UI** — components, a page, or several pages / a screen-flow — as UXFactory specs, offline, and have it mechanically checked before review. Lead with this when there is no Figma session and the goal is to assemble and self-check a set of specs.

Do **not** use it for: the online single-spec render→verify loop (use the main `uxfactory` skill), pixel-faithful sign-off (the previews here are approximate), or freeform black-box UI with no structured spec.

## The inputs

Two committed, authored things drive the gate (you do not invent these — the user owns them):

- **`uxfactory.batch.json`** at the repo root — the registry. It points at the guidance inputs and carries an optional `maxIterations` budget:

```jsonc
{
  "version": 1,
  "inputs": {
    "tokens": "design/tokens.ds.json", // name → hex color register
    "stories": "design/stories.json", // stories + acceptance criteria
    "flow": "design/flow.json", // a declared step order
    "reuse": ["specs/existing.uxfactory.json"], // specs to compose against, not duplicate
  },
  "maxIterations": 6,
}
```

- The **`design/`** folder it points at — the actual tokens, stories, and flow files.

The specs you author live in their own directory (e.g. `specs/`), one `*.uxfactory.json` per component/screen/page.

### Minimal input shapes (v1)

- **tokens** (`tokens.ds.json`): `{ "colors": { "brand": "#1E88E5" } }`
- **stories** (`stories.json`): `{ "stories": [ { "id": "story-1", "role": "...", "goal": "...", "benefit": "...", "acceptanceCriteria": [ { "statement": "...", "impliedState": "empty|loading|error|success|edge" } ] } ] }`
- **flow** (`flow.json`): `{ "steps": ["<node-or-frame-name>", "..."] }` — an ordered sequence

## The loop

1. **Author / revise the spec(s)** under a directory (e.g. `specs/`). Name things so the gate can trace them:
   - put each story's id in the **frame name** it satisfies (e.g. `story-1-home`),
   - put each acceptance-criterion **state keyword** in a node name (e.g. `home-empty-state`, `home-success-view`),
   - use **registered token colors** for every fill/stroke,
   - **reference** an existing spec's screen instead of redrawing it.
2. **Run the deterministic gate** and write offline previews:
   ```bash
   uxfactory batch specs            # the single deterministic pass; writes .uxfactory/batch/report.json + previews/
   uxfactory render specs/home.uxfactory.json --out home.svg   # optional: an offline preview of one spec
   ```
3. **On exit `1`**, read the findings in `.uxfactory/batch/report.json` (uncovered stories/states, ad-hoc colors, duplicates) and **revise the spec(s)** to address each one — then re-run step 2.
4. **Stop** when `uxfactory batch` exits `0` (every must-pass gate is green) **or** you have spent `maxIterations` revisions. If the budget runs out with findings still open, surface the **best-effort** batch with the unmet findings listed — do **not** spin.
5. **Hand to the human.** Once it is clean and the human approves, stage it:
   ```bash
   uxfactory batch specs --stage    # posts the specs + previews to the bridge for review/approval
   ```

The gate's **exit code is the termination condition** — you never decide "good enough" from a score; you decide from the binary gate plus your own read of the findings.

## The gates

`uxfactory batch` runs four gates in one pass. Three are **must-pass** (they set the exit code); one is **advisory** (it never fails the batch):

- **token conformance** (must) — every fill/stroke must be a registered token color; ad-hoc values are findings.
- **requirement & state coverage** (must) — every story id maps to ≥1 frame, every acceptance-criterion state maps to a node, and no frame is story-less.
- **reuse** (must) — a screen/component that already exists in a registered spec must be referenced, not regenerated.
- **flow reachability** (advisory) — if a flow declares a step order, each consecutive pair must be reachable along your connectors; unreachable pairs are advisory findings only.

## Skip-and-declare

A gate whose **input is not registered** is reported as `skipped` with a reason — never silently passed and never failed. "No stories registered" is honestly distinct from "coverage passed." If you need a check to run, make sure its input is registered in `uxfactory.batch.json`.

## Exit codes — the loop-termination contract

| Code | Meaning                                                                        | What to do                                               |
| ---- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `0`  | Every must-pass gate is green                                                  | **Stop the loop.** Hand off for human approval.          |
| `1`  | A must-pass gate failed                                                        | Read `report.json` findings, revise the spec(s), re-run. |
| `2`  | Setup/transport (bad/missing registry, unreadable input, --stage bridge error) | Fix the environment; not a quality signal.               |

## Outputs

Everything the pass produces is ephemeral and lives under **`.uxfactory/batch/`** (gitignored): `report.json` (the gates + findings) and `previews/<spec>.svg` (one approximate offline preview per spec). The committed inputs (`uxfactory.batch.json`, `design/`) are never written to.

## Gotchas worth internalizing

- **The engine does not loop or score.** One call = one deterministic pass. You iterate; the exit code stops you.
- **Name for traceability.** Coverage and flow gates match on **names** — story ids in frame names, state keywords in node names, flow steps as node/frame names.
- **Previews are approximate** (offline raster) — good for review, not for pixel sign-off.
- **`exit 2` is never a quality signal** — it means a registry/input/bridge problem; fix the setup, do not "revise the spec."
- **Don't spin.** Respect `maxIterations`; surface best-effort with the open findings when the budget is spent.
- **Pure reusable components (no 1:1 story):** leave `stories` unregistered so requirement coverage skip-and-declares; story-less frames surface only as an advisory `coverage-orphans` finding and never gate the batch.

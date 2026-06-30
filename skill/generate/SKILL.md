---
name: uxfactory-generate
description: "Draft ONE missing UX input artifact — an AcceptanceCriterion story set, a TokenSet, or a UserFlow — for a classified UXFactory project, then write it to the path the registry expects so a batch can read it. Use when the classification's GateProfile marks an artifact `generatable` (or a REQUESTED one is absent) and the agent has been asked to build it before the Confirm gate. Drafts exactly one artifact per run, deterministically honoring the profile's compliance constraints."
compatibility: "Requires uxfactory-cli (Node 20+). Runs fully offline against the project's pinned profile — no external service needed."
---

# UXFactory — Draft One UX Artifact

You draft **a single UX input artifact** for an already-classified project and write it to the exact path the registry expects, so the deterministic `uxfactory batch` gate can read it. You author the content; the engine stays LLM-free and only gates.

You will be told the **artifact kind**, the **target path**, and the **constraints** to honor. Produce exactly that one artifact — do not generate others, do not run the batch, do not pin the profile.

## Step 1 — Read the pinned context

Read the project's classification and derived profile so your draft matches the scope and constraints:

```bash
uxfactory classify --json   # GateProfile: scope (four dials) + manifest + constraints
```

Also read these if present (use the Read tool):

- `uxfactory.classification.json` — the committed classification vector.
- `uxfactory.batch.json` — `inputs.{stories,tokens,flow}` register the expected path for each artifact kind. **Write to the registered path** for your kind.

The `constraints` array on the profile (e.g. accessibility targets, reading-level limits, disclosure or privacy obligations forced by industry/age) is **non-negotiable**. Every artifact you draft must satisfy them.

## Step 2 — Draft the one artifact

Match the artifact kind to its shape and the depth implied by the scope dials:

### AcceptanceCriterion (stories) — `inputs.stories`

A JSON array of stories. Each story has an `id` and acceptance criteria naming the view-states it owns. Cover the states the `coverage` dial demands (success only at `low`; add empty / loading / error at `medium`; all edge states at `high`). Keep story ids stable and filename-safe — the gate traces them by name.

### TokenSet (design tokens) — `inputs.tokens`

A JSON token set: color, type, spacing, radius. Every color a spec fills or strokes must exist here — `token-conformance` binds at `visual >= medium` and matches by registered token. Honor any contrast obligation in the constraints.

### UserFlow — `inputs.flow`

A JSON flow: named steps and the transitions between them. Each step name should match the frame/node it refers to. Cover the paths the `flow` dial demands (single screen at `low`; the primary end-to-end path at `medium`; branches, back/cancel, and deep-links at `high`). `flow-reachability` binds at `flow >= medium`.

Author for **traceability**: story ids in frame names, state keywords in node names, registered token colors, real step names. The gate matches on names.

## Step 3 — Write it to the registered path

Write the drafted artifact as JSON to the path you were given (the registry's `inputs.<kind>` entry). Create parent directories if needed. Do not overwrite a different artifact kind, and do not touch committed inputs you were not asked to draft.

## Step 4 — Report

Tell the user, briefly:

- which artifact kind you drafted and the exact path you wrote;
- which `derived_from` dimension forced it (provenance) and which constraints you honored;
- that the artifact is a **draft** for review — they should inspect it, then run the Confirm gate and `uxfactory batch` themselves.

Draft **one** artifact, honestly. If the classification or constraints are ambiguous, state the assumption you made rather than inventing requirements.

## Quick reference

| Step | Command / action                                                        |
| ---- | ----------------------------------------------------------------------- |
| 1    | `uxfactory classify --json` — read scope + manifest + constraints       |
| 1    | Read `uxfactory.batch.json` → `inputs.<kind>` for the expected path     |
| 2    | Draft ONE artifact (AcceptanceCriterion / TokenSet / UserFlow) at scope |
| 3    | Write the JSON to the registered path                                   |
| 4    | Report kind + path + provenance + honored constraints                   |

---
name: uxfactory-generate
description: "Draft ONE missing UX input artifact — an AcceptanceCriterion story set, a TokenSet, or a UserFlow — for a classified UXFactory project, then write it to the path the registry expects so a batch can read it. Use when the classification's GateProfile marks an artifact `generatable` (or a REQUESTED one is absent) and the agent has been asked to build it before the Confirm gate. Drafts exactly one artifact per run, deterministically honoring the profile's compliance constraints."
compatibility: "Requires uxfactory-cli (Node 20+). Runs fully offline against the project's pinned profile — no external service needed."
---

# UXFactory — Draft One UX Artifact

You draft **a single UX input artifact** for an already-classified project and write it to the exact path the registry expects, so the deterministic `uxfactory batch` gate can read it. You author the content; the engine stays LLM-free and only gates.

You will be told a **target**, the **target path**, optional **seed refs**, and the **constraints** to honor. Produce exactly that one artifact — do not generate others, do not run the batch, do not pin the profile.

## Targets — pick the one you were told

The pipeline panel drives three seeded workstreams via a `target`. Draft **exactly one**, matching the target you were handed:

| Target                 | Draft                                                  | Underlying artifact            | Seeds (honor the given `seedRefs`)            |
| ---------------------- | ------------------------------------------------------ | ------------------------------ | --------------------------------------------- |
| `user-story`           | the user-story narratives                              | `AcceptanceCriterion` (stories) | the project classification                    |
| `acceptance-criteria`  | testable acceptance criteria for the **seeded stories** | `AcceptanceCriterion`          | the upstream **story** refs in `seedRefs`     |
| `user-journey`         | a user journey / `UserFlow` spanning the **seeded stories** | `UserFlow`                  | the upstream **story** refs in `seedRefs`     |

When `seedRefs` are given (e.g. story ids `S-1`, `S-2`), every criterion or journey step you draft must **trace back to one of them by name** — acceptance criteria reference their story; a journey's steps span the seeded stories. If `seedRefs` is empty, you are the upstream/seed job: draft from the classification alone.

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

### AcceptanceCriterion — `inputs.stories` — serves `user-story` and `acceptance-criteria`

The file is a JSON **object** `{ "stories": [ … ] }` — NOT a bare array. The deterministic gate parses this exact schema and rejects anything else, so every field below is mandatory and the field names must match verbatim:

```json
{
  "stories": [
    {
      "id": "checkout",
      "role": "returning customer",
      "goal": "complete a purchase",
      "benefit": "receive my order",
      "acceptanceCriteria": [
        { "statement": "payment is accepted and the order is confirmed", "impliedState": "success" },
        { "statement": "a declined card shows a recoverable error", "impliedState": "error" }
      ]
    }
  ]
}
```

- Each **story** has exactly: `id` (stable, name-safe — letters/digits/hyphens; the gate traces frames by it), `role` (who), `goal` (what), `benefit` (why), and `acceptanceCriteria` (a non-empty array). Do NOT use `title`/`narrative` — the gate ignores them and validation fails.
- Each **acceptance criterion** has exactly: `statement` (a testable string) and `impliedState`, which MUST be one of exactly `"empty"`, `"loading"`, `"error"`, `"success"`, `"edge"` (no other values). Cover the states the `coverage` dial demands: `success` only at `low`; add `empty` / `loading` / `error` at `medium`; add `edge` at `high`.

- For `target: user-story`, author the stories (each with `id`/`role`/`goal`/`benefit` and at least one `acceptanceCriteria`), seeded by the classification.
- For `target: acceptance-criteria`, add/refine the `acceptanceCriteria` of the stories named in `seedRefs` (each criterion's `impliedState` from the allowed set). Do not invent stories not in `seedRefs`.
  - **Merge, never replace.** `user-story` and `acceptance-criteria` write the **same** `inputs.stories` file. So for `acceptance-criteria` you MUST first **Read** the existing `{ "stories": [ … ] }`, then **attach** your criteria to the matching seeded stories *in place* — preserve every existing story's `id`/`role`/`goal`/`benefit` verbatim, and keep stories you were not asked about untouched. Never overwrite the stories array wholesale; doing so destroys the upstream job's work.

### TokenSet (design tokens) — `inputs.tokens`

A JSON token set: color, type, spacing, radius. Every color a spec fills or strokes must exist here — `token-conformance` binds at `visual >= medium` and matches by registered token. Honor any contrast obligation in the constraints.

### UserFlow — `inputs.flow` — serves `user-journey`

A JSON flow: named steps and the transitions between them. Each step name should match the frame/node it refers to. Cover the paths the `flow` dial demands (single screen at `low`; the primary end-to-end path at `medium`; branches, back/cancel, and deep-links at `high`). `flow-reachability` binds at `flow >= medium`.

For `target: user-journey`, the journey must **span the stories named in `seedRefs`** — name the steps after the seed stories' screens/states so the flow stays traceable to them.

Author for **traceability**: story ids in frame names, state keywords in node names, registered token colors, real step names. The gate matches on names.

## Step 3 — Write it to the registered path

Write the drafted artifact as JSON to the path you were given (the registry's `inputs.<kind>` entry). Create parent directories if needed. Do not overwrite a different artifact kind, and do not touch committed inputs you were not asked to draft.

**When your target shares a file with an upstream target** — `acceptance-criteria` writes the same `AcceptanceCriterion` file as `user-story` — **Read the existing file first and merge into it**: add your content to the existing entries, preserving everything already there. Only when the file is absent (you are the first/seed job) do you write it fresh.

## Step 4 — Report

Tell the user, briefly:

- which artifact kind you drafted and the exact path you wrote;
- which `derived_from` dimension forced it (provenance) and which constraints you honored;
- that the artifact is a **draft** for review — they should inspect it, then run the Confirm gate and `uxfactory batch` themselves.

Draft **one** artifact, honestly. If the classification or constraints are ambiguous, state the assumption you made rather than inventing requirements.

## Quick reference

| Step | Command / action                                                                        |
| ---- | --------------------------------------------------------------------------------------- |
| 0    | Read the **target** (`user-story` / `acceptance-criteria` / `user-journey`) + `seedRefs` |
| 1    | `uxfactory classify --json` — read scope + manifest + constraints                       |
| 1    | Read `uxfactory.batch.json` → `inputs.<kind>` for the expected path                     |
| 2    | Draft ONE artifact for the target (AcceptanceCriterion / UserFlow) at scope, honoring seeds |
| 3    | Write the JSON to the registered path                                                   |
| 4    | Report target + path + provenance + honored constraints                                 |

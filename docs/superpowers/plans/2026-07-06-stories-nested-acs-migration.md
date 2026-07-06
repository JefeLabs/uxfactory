# Stories with nested ACs — migration plan

Sources: `.plans/artifact-schemas-and-elicitation.md` (`stories` section, `acceptance-criteria`
deprecation path), `.plans/component-type-artifact-mapping.md` (decision 6, resolved: nest).

## What is true today

- The gate reads `inputs.stories` (default `design/acceptance-criteria.json`) as
  `{stories: [{id, role, goal, benefit, acceptanceCriteria: [{statement, impliedState}]}]}` —
  already story-shaped, ACs already nested. `requirementCoverage` consumes only `story.id`
  (frame token-boundary match) and `ac.impliedState`/`ac.statement` (finding text).
- Registry: `acceptance-criteria` = registered (label "Requirements", the legacy file);
  `stories` = planned. Every page-class `requires` block lists both in lockstep.
- Panel key `requirements` ↔ registry id `acceptance-criteria`; bridge resolves the path
  registry-first via `resolveInputPaths`. `ARTIFACT_PREREQS` already has `stories ← personas`
  and `flows ← acceptance-criteria + sitemap`.

## Target state

One artifact, `stories`: a **set** at `.uxfactory/artifacts/stories/*.json`, one story per
file, canonical PRD schema with nested ACs. `acceptance-criteria` is **superseded** — the
legacy file remains only as the migration source; per-project migration state is carried by
`inputs.stories` in `uxfactory.batch.json` (string file path = legacy, directory = migrated).
No MATERIALIZED compatibility file; the verify loop never loses its input.

### Canonical story (per-file)

```json
{
  "storyId": "browse-faq",
  "actor": "persona-id",
  "want": "string",
  "soThat": "string",
  "featureRef": null,
  "acceptanceCriteria": [
    { "acId": "AC-001", "given": "…", "when": "…", "then": "…", "checkable": "auto" }
  ],
  "status": "registered"
}
```

Pragmatic deviation from the PRD, for near-zero migration: an AC carries **either** the GWT
triple **or** a legacy `statement`, plus optional explicit `impliedState`. Normalization
(shared, in `@uxfactory/spec`):

- GWT → engine statement: `Given {given}, when {when}, then {then}`.
- `impliedState` derivation when absent: first of error/empty/loading whose keyword appears
  in the then/statement text, else `success`.
- `checkable: "manual"` ACs are **excluded** from the deterministic implied-state check
  (they cannot be auto-verified); story-level frame coverage still applies.
- Legacy story fields map 1:1: `id↔storyId`, `role↔actor`, `goal↔want`, `benefit↔soThat`.

## Phases (each: red test → green → commit to main)

1. **Spec** — `story-schema.ts`: canonical types, `normalizeStoryFile` (canonical or legacy
   member → canonical), `storyToEngine` (canonical → engine `{id, role, goal, benefit,
   acceptanceCriteria:[{statement, impliedState}]}` + per-AC `checkable`). Registry:
   `stories` → registered; `acceptance-criteria` → new status `"superseded"` +
   `supersededBy: "stories"`. All `requires` blocks drop `acceptance-criteria` (lockstep
   invariant inverts: it must appear in NO requires block). `ARTIFACT_PREREQS.flows`
   swaps to `["stories", "sitemap"]`; `AUTHORING_ORDER` drops `acceptance-criteria`.
   Add the `stories` elicitation interview (PRD's 6 questions, personas hard-prereq).
2. **CLI** — `loadStoriesInput`: directory path → read all `*.json` members, normalize each
   into one engine `StorySet`; file path → legacy shape, byte-identical behavior. Broken
   member → `broken` state with the file named. Manual-AC exclusion in
   `requirementCoverage`. New `migrate-stories` command: legacy file → one canonical file
   per story + stub personas for distinct legacy roles (satisfies the actor hard-dep,
   keeps the trace graph whole) + `inputs.stories` flipped to the directory. Legacy file
   left in place (it is the migration source, not waste).
3. **Bridge** — the `requirements` row becomes the `stories` row: when the resolved
   stories path is a directory → `checkSetArtifact` semantics (member count); when a file
   → today's single-file semantics. In-panel Open hidden (set artifact).
4. **Worker** — conventional registration prefers `.uxfactory/artifacts/stories` (dir
   exists) over `design/acceptance-criteria.json`; `PANEL_ARTIFACT_MAP` gains
   `stories` (set:true). Worker stays spec-independent (its map is deliberately local).
5. **Panel** — `ARTIFACT_KEY_BY_ID`: `stories → "stories"`, drop `acceptance-criteria`;
   `SET_ARTIFACT_KEYS` += stories. Grounding chip label becomes "Stories" (one chip where
   two ids used to ride). Artifacts screen set row + CreateArtifactDialog story interview
   (chains from personas via existing prereq rail).
6. **Docs + demo** — mark decision 6 sub-decision resolved in the mapping PRD; run
   `migrate-stories` on uxf-demo; full gate e2e verify on the migrated project.

## Compatibility invariants

- An **unmigrated** project (registry points at the legacy file) behaves byte-identically:
  same gate results, same skip/pass/fail, same bridge row semantics.
- A **migrated** project satisfies the same `requires` slots — the `stories` chip is green
  whether the resolved input is the legacy file or the set directory.
- Wire: the snapshot artifact key renames `requirements` → `stories` (panel + bridge +
  worker version together in this repo; contract tests updated deliberately).

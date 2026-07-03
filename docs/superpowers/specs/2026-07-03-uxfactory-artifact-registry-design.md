# Manifest-Driven Artifact Registry — one declaration, four consumers (Design)

**Date:** 2026-07-03
**Status:** Approved (user, after design presentation). Sequenced after the TanStack adoption; independent of the Queue tab (registry is bridge/worker-side, Queue is panel-side) and of the multi-root bridge (each resolved registry is naturally per-root).

## 1. Problem

Artifact types are hardcoded in four places that must agree: bridge (`CONCERN_CANONICAL` + `buildSnapshot` rows + `resolveConcernPath`), panel (`ui/lib/artifact-schemas.ts` guidance/sections), worker (`generate-artifact` plan table), and — for the two verification-feeding types — the gate. Partial registration fails silently at the last layer (a Create job no worker recipe fulfills — the stuck-Create bug from the acceptance walk). Adding a type is a three-package PR; per-project custom artifacts are impossible.

## 2. Design

### 2.1 Built-in catalog moves to `@uxfactory/spec`
The 12 v1 concerns (key, label, group, canonical path, format, sections+guidance, create-guidance, generation recipe) become data in `@uxfactory/spec` — the shared, LLM-free package — as `ARTIFACT_CATALOG`. The brief's five-section schema and no-restatement rule move here verbatim. This is the single source; bridge, panel fallback, and worker all derive from it.

### 2.2 Project manifest: `uxfactory.artifacts.json` (optional)
Sibling of `uxfactory.classification.json` / `uxfactory.profile.json`. Shape:

```json
{
  "artifacts": [
    {
      "key": "personas",                    // kebab-case, unique after merge
      "label": "Personas",
      "group": "product",                   // built-in group id or one declared below
      "path": "design/personas.md",         // root-relative; containment-enforced
      "format": "markdown",                 // "markdown" | "json"
      "section": null,                      // optional: named region of a shared file (design-system pattern)
      "createGuidance": "…",                // dialog helper copy
      "sections": [{ "title": "…", "guidance": "…" }],   // markdown only
      "recipe": "…",                        // inline generation instructions…
      "recipePath": "skill/artifacts/personas.md",       // …or a file (recipePath wins if both)
      "disabled": false
    }
  ],
  "groups": [{ "id": "research", "label": "RESEARCH", "after": "product" }]
}
```

**Merge semantics (by `key`, manifest over catalog):** unknown key → new type; known key → per-field override (path, label, guidance, sections, recipe, group); `disabled: true` → hidden built-in. Group list = built-in four (`product`, `ia-ux`, `design`, `assets`) with declared groups spliced by `after`.

**Validation is tolerant:** a malformed entry is skipped with a log-ring warning — the snapshot never breaks. Hard rules: kebab-case keys; `path` resolves inside the project root (`..` rejected); `format` ∈ {markdown, json}; duplicate keys → last wins with a warning.

### 2.3 Resolved registry (bridge)
At snapshot/connect time the bridge merges catalog + manifest into the **resolved registry** and derives from it:
- `buildSnapshot` artifact rows (label, group, freshness, path). Built-ins keep their bespoke meta enhancers (e.g., Requirements' "N stories"); custom types get the same generic freshness rule built-ins use today: absent → `missing`; JSON that parses without a `"draft": true` flag (markdown: non-empty) → `up-to-date`; unparseable or draft-flagged → `draft`.
- `resolveConcernPath` for `GET/PUT /project/artifact` (registry-first `uxfactory.batch.json` `inputs` overrides still win where they exist today).
- **New route** `GET /project/artifact-registry` → `{ groups: [{id,label}], artifacts: [{key, label, group, format, path, createGuidance, sections}] }` (recipes are NOT served here — they're worker-facing; the panel never needs them).
- Manifest changes are picked up per request (stat/mtime cache) — no bridge restart.

### 2.4 Consumers
- **Panel:** Artifacts tab groups/rows and the editor's section cards + guidance and the Create dialog copy all render from `getArtifactRegistry?.()` (optional client method). `ui/lib/artifact-schemas.ts` shrinks to the legacy-bridge fallback (three-tier degradation: registry route → built-in fallback schemas → generic guidance).
- **Worker:** `generate-artifact` resolves the recipe from the bridge at job time — **new route** `GET /project/artifact-recipe?key=` → `{key, path, format, sections, recipe}` (resolves `recipePath` file content server-side, containment-enforced). Manifest edits apply to the next job without a worker restart; per-root registries come free with the multi-root bridge.
- **Gate:** unchanged in v1. Checks remain key-wired to `tokens` / `requirements`. Custom artifacts participate in generation, editing, and freshness only.

## 3. Compatibility matrix
- No manifest → byte-for-byte today's behavior (catalog only).
- Old panel + new bridge → new/overridden rows appear via the snapshot and render generically; editor guidance falls back to generic strings.
- New panel + old bridge → no registry route → panel falls back to its built-in schemas (current behavior).
- Old worker + new bridge → built-ins generate from its static table; custom-type jobs fail with an honest "unknown artifact key" result surfaced on the row.

## 4. Testing
Spec: catalog completeness (12 keys, schema-valid). Bridge: merge semantics (add/override/disable/group splice), tolerant validation (malformed entry skipped + warned, snapshot intact), containment rejection, registry + recipe routes, mtime cache invalidation, snapshot rows for a custom type. Contract (`bridge-contract.test.ts`): `getArtifactRegistry` + recipe route shapes against the real server. Panel: rows/groups/dialog/editor render from an injected registry incl. a custom markdown type; fallback tier when the method is absent. Worker: recipe fetched per job; unknown-key job → failure result. **Cross-layer drift test:** bridge rows, panel fallback, and worker built-in behavior all derive from `ARTIFACT_CATALOG` — asserted by importing the catalog in each package's test and diffing key sets (kills the partial-registration bug class for built-ins).

## 5. Non-goals
Data-driven gate hooks (custom checks per artifact type — later, with the rule-taxonomy work); JSON structured editing; per-artifact model/effort selection; registry management UI (the manifest is edited as a file in v1); marketplace/shared catalogs; migrating `uxfactory.batch.json` `inputs` (still honored, still wins for paths).

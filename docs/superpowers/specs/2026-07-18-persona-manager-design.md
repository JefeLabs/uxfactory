# In-Panel Persona Manager

*Design spec. Replaces the Finder-window behavior on the Artifacts→Persona row with an in-panel CRUD UI for managing persona instances. Downstream: an implementation plan via writing-plans.*

## 1. Problem

`personas` is a **set artifact** — one JSON file per persona under `.uxfactory/artifacts/personas/<id>.json`. The Artifacts tab gates set artifacts out of the in-panel editor (`!SET_ARTIFACT_KEYS.has(row.key)` in `ui/screens/Artifacts.tsx`), so the only action on the Persona row is "↗ open externally" → `bridge.openPath(<personas directory>)` → the bridge shells `open <dir>` (`project.ts` ~L2339) → macOS **Finder**. There is no way to view or manage individual personas in the panel.

Goal: clicking Persona opens an **in-panel Persona Manager** with full CRUD (list, add, edit, delete each persona). Whole-set AI regeneration stays available.

Non-goals: managing `stories` (the other set artifact with the same gap) — build the list/read layer generically enough to reuse later, but scope this to personas. No per-instance AI regeneration (generation stays whole-set). No change to the persona JSON schema.

## 2. Persona shape (existing, unchanged)

Per file (`artifact-validators.ts` `personas` rule + `.plans/artifact-schemas-and-elicitation.md`):
```json
{
  "personaId": "P-01",
  "name": "string",
  "archetype": "string",
  "segmentRef": "audience segment name | null",
  "goals": ["string"],
  "frustrations": ["string"],
  "context": { "expertise": "novice|intermediate|expert", "frequency": "string", "environment": "string" },
  "quote": "string | null"
}
```
Set-level rules (soft, surfaced in the row status, NOT enforced by the manager): ≥2 personas recommended; `personaId` unique; warn if a persona has no goals/frustrations.

## 3. Bridge — persona instance routes

New routes in `packages/uxfactory-bridge/src/project.ts`, all `?root=`-scoped, following the existing project-route conventions. The personas directory is `<dataDir>/artifacts/personas/`.

- **`GET /project/personas`** → `{ personas: PersonaInstance[] }`. Reads every `*.json` in the dir, parses each, tolerates malformed/unreadable files (skips them, never 500s) — mirrors `readTraceStories`'s parse-every-file discipline. Each item: the parsed persona object plus a guaranteed `personaId` (fall back to the filename stem if the file omits it). Missing dir → `{ personas: [] }`.
- **`PUT /project/personas/:id`** → body `{ persona }`. Validates `:id` against `/^P-\d+$/` (path-safety — reject anything else with 400 before any path.join, same discipline as the identity crops `durableId` check). Writes `<personas dir>/<id>.json` via the existing `applyArtifactWrite` `instanceFile` mode (single-writer, per-path lock). Ensures the persisted body's `personaId === id` (server sets it, so the file and id can't drift). Creates the dir if absent. Reply `{ ok: true }`. Malformed body (not an object) → 400.
- **`DELETE /project/personas/:id`** → same `:id` validation; removes `<id>.json` (missing file → still `{ ok: true }`, idempotent). Reply `{ ok: true, deleted }`.

`PersonaInstance` is the persona object (§2) — no new spec type is strictly required, but a small `parsePersonaFile`/list helper in the bridge (or a shared `@uxfactory/spec` parse used by both the route and any future stories reuse) keeps the parsing in one place. Prefer a bridge-local helper unless a spec-level type is trivially clean.

## 4. Panel — the Persona Manager

### 4.1 Entry (un-gate personas from Finder)
In `ui/screens/Artifacts.tsx`, allow the in-panel "Open" action for `personas`: the row's "Open" button sets `editingKey = "personas"` (today gated by `!SET_ARTIFACT_KEYS.has(row.key)`). Keep the ↗ external-open available as a secondary affordance. When `editingKey === "personas"`, render `<PersonaManager>` instead of `<ArtifactEditor>` (branch on set-ness / a `personas` check). The manager takes over the same in-panel-editor surface (with its back-to-inventory affordance).

### 4.2 The manager component (`ui/screens/PersonaManager.tsx`, new)
- Loads via a new `personasQuery(bridge)` (`GET /project/personas`) in `ui/queries.ts`, with a `queryKeys.personas(root)` entry.
- **List:** one card per persona — name (or `personaId` if unnamed), archetype, and small goals/frustrations counts. A header count ("N personas") and the whole-set actions.
- **Edit:** clicking a card (or an Edit affordance) expands it into a form rendered by the existing `<JsonFormEditor>` fed a **new `personas` field spec** (§4.3). Save serializes the form back to the persona JSON and calls `bridge.putPersona(id, persona)` → `PUT /project/personas/:id`; on success, invalidate `personasQuery` + the project snapshot.
- **Add:** "+ Add persona" computes the next id client-side (max existing `P-NN` + 1, zero-padded) and opens a blank persona form (empty name/archetype, empty goals/frustrations arrays, a default `context`). Save writes via `putPersona`. (Client-side id minting is acceptable for the single-user panel; the `PUT` upsert tolerates it.)
- **Delete:** a per-card delete with a confirm (`window.confirm` or the panel's existing confirm idiom) → `bridge.deletePersona(id)` → `DELETE /project/personas/:id`; invalidate on success. Deleting below 2 personas is allowed — the row's soft "≥2" status warning is the only signal, not a block.
- **Regenerate all:** keep the existing whole-set AI action (the current `openDialog(personasRow)` → `handleGenerate` path). Since it overwrites the whole directory (losing manual edits), gate it behind a confirm noting that.
- **Errors:** a failed put/delete surfaces via the panel's existing toast/row-note idiom; the list still renders.

### 4.3 Persona field spec (`ui/lib/artifact-forms.ts`)
Add a `personas` entry to `ARTIFACT_FORMS` modeling ONE persona object (personas is a set-of-files, so the spec is per-instance, unlike `audience` which is one file with a `segments` array). Fields, reusing the existing `FieldSpec` kinds: `name` (text), `archetype` (text), `segmentRef` (text — or an `enum` sourced from the audience segments if readily available; text is the safe default), `goals` (chips/array), `frustrations` (chips/array), `context` (object → `expertise` enum novice/intermediate/expert, `frequency` text, `environment` text), `quote` (textarea). `personaId` is NOT an editable field (server-owned). `formSpecFor("personas")` then returns this spec; the manager passes it to `JsonFormEditor`.

### 4.4 Bridge client (`ui/lib/bridge.ts`)
Add `getPersonas(): Promise<{ personas }>` (GET), `putPersona(id, persona): Promise<{ok}>` (PUT), `deletePersona(id): Promise<{ok}>` (DELETE), following the file's existing `rooted(...)` + typed-fetch idioms. These are optional-typed if the codebase marks newer bridge methods optional (legacy-safe), matching how `getPipelineResult?` etc. are declared.

## 5. Data flow

```
Click Persona row → editingKey="personas" → <PersonaManager>
  → GET /project/personas → list cards
  → Edit a card → JsonFormEditor (personas field spec) → PUT /project/personas/:id (instanceFile write) → invalidate list + snapshot
  → Add → next P-NN + blank form → PUT
  → Delete (confirm) → DELETE /project/personas/:id → invalidate
  → Regenerate all (confirm) → existing generate-artifact whole-set job
```
The manager reads/writes individual instance files through the new routes; whole-set generation is unchanged.

## 6. Files touched (orientation)

- **Bridge:** `packages/uxfactory-bridge/src/project.ts` (3 routes + a `parsePersonaFile`/list helper); relies on existing `applyArtifactWrite` `instanceFile` mode. Tests in `packages/uxfactory-bridge/test/`.
- **Panel:** `ui/screens/PersonaManager.tsx` (new); `ui/screens/Artifacts.tsx` (un-gate personas → mount the manager); `ui/lib/artifact-forms.ts` (`personas` field spec); `ui/lib/bridge.ts` (`getPersonas`/`putPersona`/`deletePersona`); `ui/queries.ts` (`personasQuery` + `queryKeys.personas`). Reuses `ui/screens/JsonFormEditor.tsx` unchanged. Tests in `packages/uxfactory-plugin/test/`.

## 7. Testing

- **Bridge:** `GET` parses multiple instances + tolerates a malformed file (skips it); `PUT` writes the instance file and stamps `personaId===:id`; `DELETE` removes the file and is idempotent; `:id` path-safety rejects `../`-style and non-`P-NN` ids with 400 and writes/deletes nothing; missing dir → empty list.
- **Panel:** clicking Persona opens the manager (not Finder / not `openPath`); the list renders one card per instance; Edit → save calls `putPersona` with the right id + body and invalidates; Add mints the next `P-NN` and writes; Delete confirms then calls `deletePersona`; the personas field spec renders in `JsonFormEditor`; Regenerate-all still enqueues the whole-set job behind its confirm.

## 8. Non-goals / open

- Stories (same Finder gap) is out of scope; the bridge list/parse helper should be written so a `stories` analog is a small follow-up, not a rewrite.
- No per-persona AI regeneration; generation stays whole-set.
- Client-side id minting (next `P-NN`) is acceptable for the single-user panel; a server-side mint (`POST /project/personas`) is a possible future hardening if concurrent adds ever matter.

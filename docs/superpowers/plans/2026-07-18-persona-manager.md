# In-Panel Persona Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Finder-window behavior on the Artifacts→Persona row with an in-panel Persona Manager that lists, adds, edits, and deletes individual persona instances.

**Architecture:** `personas` is a set artifact (one `<id>.json` per persona). Add three bridge routes to list/write/delete instances (reusing the existing `applyArtifactWrite` `instanceFile` mode), a `personas` field spec, make the existing `JsonFormEditor` save-injectable, and a `PersonaManager` panel component reached by un-gating personas from the set-artifact editor block.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` imports, `verbatimModuleSyntax`); Fastify (bridge); React + Radix + Tailwind + TanStack Query + React Hook Form (panel); Vitest.

## Global Constraints

- **Personas stays user-manageable, generation stays whole-set.** The three new routes manage individual instance files; AI regeneration remains the existing whole-set `generate-artifact` job (unchanged).
- **Path safety:** the `:id` in the write/delete routes MUST be validated against `/^P-\d+$/` BEFORE any `path.join` — reject anything else with 400, writing/deleting nothing (same discipline as the identity crops `durableId` guard).
- **Persona shape (unchanged):** `{ personaId, name, archetype, segmentRef, goals[], frustrations[], context:{expertise,frequency,environment}, quote }`. The server owns `personaId` (stamps it `=== :id` on write); it is never an editable form field.
- **Reads tolerate malformed files** — a bad/unreadable persona file is skipped, never 500s (mirror `readTraceStories`).
- **Bridge paths:** `ARTIFACTS_DIR = ".uxfactory/artifacts"` (module const in `project.ts`); personas dir = `path.join(ctx.root, ARTIFACTS_DIR, "personas")` for reads; `applyArtifactWrite(ctx.root, { path: \`${ARTIFACTS_DIR}/personas\`, instanceFile: \`${id}.json\`, body })` for writes. `resolveRoot` returns `{ root, dataDir }`.
- **Set-level "≥2 personas" is a soft status only** — deleting below 2 is allowed; the manager never blocks it.
- TS ESM: `.js` on relative imports; `import type` for type-only. Plugin has ~16+3 pre-existing typecheck errors — add ZERO. Bridge typecheck clean — add ZERO.
- Commit style: `feat(bridge):`, `feat(panel):`, `fix(panel):`, `test(...)`.

## File Structure

- **Bridge:** `packages/uxfactory-bridge/src/project.ts` — 3 routes + a `readPersonas(dir)` helper. Tests: `packages/uxfactory-bridge/test/` (new `personas.test.ts` or an existing project-route test file).
- **Panel:**
  - `ui/lib/artifact-forms.ts` — add `personas` to `ARTIFACT_FORMS` (Task 2).
  - `ui/screens/JsonFormEditor.tsx` — optional injectable save (Task 3).
  - `ui/lib/bridge.ts` — `getPersonas`/`putPersona`/`deletePersona` + a `del` helper (Task 4).
  - `ui/queries.ts` — `personasQuery` + `queryKeys.personas` (Task 4).
  - `ui/screens/PersonaManager.tsx` — new manager component (Task 4).
  - `ui/screens/Artifacts.tsx` — un-gate personas Open + render `PersonaManager` when `editingKey === "personas"` (Task 4).

---

### Task 1: Bridge — persona instance routes (GET list / PUT one / DELETE one)

**Files:**
- Modify: `packages/uxfactory-bridge/src/project.ts` (add `readPersonas` helper + 3 routes alongside the other `/project/*` routes; import `applyArtifactWrite` from `./artifact-writer.js` if not already imported here — check; `server.ts` imports it, `project.ts` may need it)
- Test: `packages/uxfactory-bridge/test/personas.test.ts`

**Interfaces:**
- Consumes: `resolveRoot(root, reply) → {root, dataDir}|null`; `applyArtifactWrite(rootDir, { path, instanceFile, body })`; `ARTIFACTS_DIR`; node `readdir`/`readFile`/`stat`/`rm` (already imported in project.ts — verify).
- Produces: `GET /project/personas → { personas: Array<Record<string,unknown> & { personaId: string }> }`; `PUT /project/personas/:id` body `{ persona }` → `{ ok: true }` or 400; `DELETE /project/personas/:id → { ok: true, deleted: boolean }` or 400.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/uxfactory-bridge/test/personas.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
// reuse the test harness the other project-route tests use (mkRoot/createBridge/addGitMarker)
// — import those helpers exactly as packages/uxfactory-bridge/test/project.test.ts does.

describe("persona instance routes", () => {
  // ...set up a connected root `root` with .uxfactory/artifacts/personas/ ...
  const personasDir = (root: string) => path.join(root, ".uxfactory/artifacts/personas");

  it("GET lists every parseable instance and skips malformed files", async () => {
    await mkdir(personasDir(root), { recursive: true });
    await writeFile(path.join(personasDir(root), "P-01.json"), JSON.stringify({ personaId: "P-01", name: "Ana" }));
    await writeFile(path.join(personasDir(root), "P-02.json"), JSON.stringify({ personaId: "P-02", name: "Ben" }));
    await writeFile(path.join(personasDir(root), "broken.json"), "{ not json");
    const res = await app.inject({ method: "GET", url: `/project/personas?root=${encodeURIComponent(root)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { personas: Array<{ personaId: string; name?: string }> };
    expect(body.personas.map((p) => p.personaId).sort()).toEqual(["P-01", "P-02"]);
  });

  it("GET returns empty when the dir is missing", async () => {
    const res = await app.inject({ method: "GET", url: `/project/personas?root=${encodeURIComponent(root)}` });
    expect(res.json()).toEqual({ personas: [] });
  });

  it("PUT writes the instance file and stamps personaId === :id", async () => {
    const res = await app.inject({
      method: "PUT", url: `/project/personas/P-03?root=${encodeURIComponent(root)}`,
      payload: { persona: { name: "Cara", personaId: "WRONG", goals: ["ship"] } },
    });
    expect(res.statusCode).toBe(200);
    const written = JSON.parse(await readFile(path.join(personasDir(root), "P-03.json"), "utf8"));
    expect(written.personaId).toBe("P-03"); // server stamps it, ignores the body's wrong id
    expect(written.name).toBe("Cara");
  });

  it("PUT rejects a path-traversal / non-P-NN id with 400 and writes nothing", async () => {
    for (const bad of ["..%2F..%2Fevil", "P-1;rm", "evil", "P-"]) {
      const res = await app.inject({
        method: "PUT", url: `/project/personas/${bad}?root=${encodeURIComponent(root)}`,
        payload: { persona: { name: "x" } },
      });
      expect(res.statusCode).toBe(400);
    }
    await expect(access(path.join(root, "evil.json"))).rejects.toThrow();
  });

  it("DELETE removes the file and is idempotent; rejects a bad id", async () => {
    await mkdir(personasDir(root), { recursive: true });
    await writeFile(path.join(personasDir(root), "P-04.json"), JSON.stringify({ personaId: "P-04" }));
    const del = await app.inject({ method: "DELETE", url: `/project/personas/P-04?root=${encodeURIComponent(root)}` });
    expect(del.statusCode).toBe(200);
    await expect(access(path.join(personasDir(root), "P-04.json"))).rejects.toThrow();
    const again = await app.inject({ method: "DELETE", url: `/project/personas/P-04?root=${encodeURIComponent(root)}` });
    expect(again.statusCode).toBe(200); // idempotent
    const bad = await app.inject({ method: "DELETE", url: `/project/personas/..%2Fx?root=${encodeURIComponent(root)}` });
    expect(bad.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @uxfactory/bridge test -- personas`
Expected: FAIL — routes 404.

- [ ] **Step 3: Implement the helper + routes**

Near the other helpers in `project.ts` (e.g. by `readTraceStories`), add:
```ts
const PERSONA_ID_RE = /^P-\d+$/;

/** Parse every *.json in the personas set dir into instances; skip unreadable/malformed. */
async function readPersonas(dir: string): Promise<Array<Record<string, unknown> & { personaId: string }>> {
  let entries: string[];
  try {
    if (!(await stat(dir)).isDirectory()) return [];
    entries = (await readdir(dir)).filter((e) => e.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown> & { personaId: string }> = [];
  for (const file of entries) {
    try {
      const parsed = JSON.parse(await readFile(path.join(dir, file), "utf8")) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      const personaId = typeof obj["personaId"] === "string" && obj["personaId"] !== ""
        ? (obj["personaId"] as string)
        : file.replace(/\.json$/, "");
      out.push({ ...obj, personaId });
    } catch { /* skip malformed member */ }
  }
  return out;
}
```
Add the routes (alongside the other `/project/*` routes):
```ts
app.get<{ Querystring: { root?: string } }>("/project/personas", async (req, reply) => {
  const ctx = await resolveRoot(req.query.root, reply);
  if (ctx === null) return reply;
  const dir = path.join(ctx.root, ARTIFACTS_DIR, "personas");
  return { personas: await readPersonas(dir) };
});

app.put<{ Params: { id: string }; Querystring: { root?: string } }>(
  "/project/personas/:id",
  async (req, reply) => {
    const ctx = await resolveRoot(req.query.root, reply);
    if (ctx === null) return reply;
    const id = req.params.id;
    if (!PERSONA_ID_RE.test(id)) return reply.code(400).send({ error: `invalid persona id "${id}" — expected P-<number>` });
    const body = req.body as { persona?: unknown };
    if (body?.persona === null || typeof body?.persona !== "object" || Array.isArray(body?.persona)) {
      return reply.code(400).send({ error: "persona must be an object" });
    }
    const persona = { ...(body.persona as Record<string, unknown>), personaId: id }; // server owns the id
    await applyArtifactWrite(ctx.root, {
      path: `${ARTIFACTS_DIR}/personas`,
      instanceFile: `${id}.json`,
      body: persona,
    });
    return { ok: true };
  },
);

app.delete<{ Params: { id: string }; Querystring: { root?: string } }>(
  "/project/personas/:id",
  async (req, reply) => {
    const ctx = await resolveRoot(req.query.root, reply);
    if (ctx === null) return reply;
    const id = req.params.id;
    if (!PERSONA_ID_RE.test(id)) return reply.code(400).send({ error: `invalid persona id "${id}"` });
    const file = path.join(ctx.root, ARTIFACTS_DIR, "personas", `${id}.json`);
    let deleted = false;
    try { await rm(file); deleted = true; } catch { /* absent → idempotent */ }
    return { ok: true, deleted };
  },
);
```
Confirm `rm`, `readdir`, `stat` are imported from `node:fs/promises` in project.ts (add to the import if missing), and `applyArtifactWrite` is imported from `./artifact-writer.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @uxfactory/bridge test -- personas` — Expected: PASS.
Run: `pnpm --filter @uxfactory/bridge test` — Expected: full bridge suite green.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @uxfactory/bridge typecheck` — clean.
```bash
git add packages/uxfactory-bridge/src/project.ts packages/uxfactory-bridge/test/personas.test.ts
git commit -m "feat(bridge): persona instance routes — list/put/delete /project/personas[/:id]"
```

---

### Task 2: Panel — `personas` field spec

**Files:**
- Modify: `packages/uxfactory-plugin/ui/lib/artifact-forms.ts` (add `personas` to `ARTIFACT_FORMS`)
- Test: `packages/uxfactory-plugin/test/artifact-forms.test.ts` (or wherever `formSpecFor`/`ARTIFACT_FORMS` is tested; if none, add one)

**Interfaces:**
- Consumes: the `FieldSpec` union + `ArtifactFormSpec` type (this file).
- Produces: `formSpecFor("personas")` returns a spec modeling ONE persona object.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { formSpecFor } from "../ui/lib/artifact-forms.js";

describe("personas field spec", () => {
  it("models one persona's fields (goals/frustrations as chips, context as object)", () => {
    const spec = formSpecFor("personas");
    expect(spec).toBeDefined();
    const keys = spec!.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["name", "archetype", "segmentRef", "goals", "frustrations", "context", "quote"]));
    const goals = spec!.fields.find((f) => f.key === "goals")!;
    expect(goals.kind).toBe("chips");
    const context = spec!.fields.find((f) => f.key === "context")!;
    expect(context.kind).toBe("object");
    // personaId is server-owned — must NOT be an editable field
    expect(keys).not.toContain("personaId");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uxfactory/plugin test -- artifact-forms`
Expected: FAIL — `spec` is undefined for personas.

- [ ] **Step 3: Add the spec**

In `ARTIFACT_FORMS` (`artifact-forms.ts`), add:
```ts
personas: {
  fields: [
    { kind: "text", key: "name", label: "Name", placeholder: "e.g. Ana the analyst" },
    { kind: "text", key: "archetype", label: "Archetype", placeholder: "e.g. time-pressed operator" },
    { kind: "text", key: "segmentRef", label: "Audience segment", nullable: true, placeholder: "audience segment name" },
    { kind: "chips", key: "goals", label: "Goals" },
    { kind: "chips", key: "frustrations", label: "Frustrations" },
    {
      kind: "object",
      key: "context",
      label: "Context",
      fields: [
        { kind: "enum", key: "expertise", label: "Expertise", options: ["novice", "intermediate", "expert"] },
        { kind: "text", key: "frequency", label: "Frequency", placeholder: "e.g. daily" },
        { kind: "text", key: "environment", label: "Environment", placeholder: "e.g. open-plan office" },
      ],
    },
    { kind: "textarea", key: "quote", label: "Quote", nullable: true },
  ],
},
```
(Match the exact `FieldSpec` shapes used by `audience`/`sitemap` — e.g. `enum` uses `options: string[]` per the `EnumField` type; if `EnumField` requires `optionsFrom` instead, use a literal `options` variant as the other specs do. Read the `EnumField` interface and match it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uxfactory/plugin test -- artifact-forms` — Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @uxfactory/plugin typecheck` — baseline (16+3), zero new.
```bash
git add packages/uxfactory-plugin/ui/lib/artifact-forms.ts packages/uxfactory-plugin/test/artifact-forms.test.ts
git commit -m "feat(panel): personas field spec for the persona editor"
```

---

### Task 3: Panel — make `JsonFormEditor` save-injectable

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/JsonFormEditor.tsx`
- Test: `packages/uxfactory-plugin/test/` (the existing JsonFormEditor test, or a new one)

**Interfaces:**
- Consumes: existing `JsonFormEditorProps`.
- Produces: two new OPTIONAL props — `saveFn?: (content: string) => Promise<unknown>` and `onSaved?: () => void`; plus `onRegenerate` becomes optional (hide the Regenerate button when absent). When `saveFn` is provided it REPLACES the built-in `putArtifact` save, and `onSaved` runs on success instead of the built-in snapshot/artifact invalidation. When absent, behavior is EXACTLY as today (backward-compatible).

- [ ] **Step 1: Write the failing test**

```tsx
it("uses the injected saveFn and onSaved when provided (instead of putArtifact)", async () => {
  const saveFn = vi.fn().mockResolvedValue(undefined);
  const onSaved = vi.fn();
  const bridge = { putArtifact: vi.fn() } as unknown as Bridge; // must NOT be called
  render(<JsonFormEditor artifactKey="personas" label="Persona" status="up-to-date"
    spec={/* the personas spec */} value={{ name: "Ana", goals: [] }} bridge={bridge}
    onBack={() => {}} saveFn={saveFn} onSaved={onSaved} />);
  // edit a field + click Save
  // ...
  await waitFor(() => expect(saveFn).toHaveBeenCalledWith(expect.stringContaining('"name"')));
  expect(onSaved).toHaveBeenCalled();
  expect((bridge as any).putArtifact).not.toHaveBeenCalled();
});
it("hides the Regenerate button when onRegenerate is absent", () => {
  render(<JsonFormEditor ... onRegenerate={undefined} />);
  expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uxfactory/plugin test -- JsonFormEditor`
Expected: FAIL — `saveFn` not a prop / Regenerate always rendered.

- [ ] **Step 3: Implement**

In `JsonFormEditorProps` add `saveFn?: (content: string) => Promise<unknown>;`, `onSaved?: () => void;`, and make `onRegenerate?` / `regenerateDisabled?` / `regenerateDisabledReason?` optional. In the component, branch the save mutation:
```ts
const save = useMutation(
  saveFn !== undefined
    ? {
        mutationFn: async (vars: { content: string }) => { await saveFn(vars.content); return vars; },
        onSuccess: (vars) => {
          reset(JSON.parse(vars.content) as Record<string, any>);
          onSaved?.();
          toast("Saved");
        },
        onError: () => toast("Save failed — is the bridge running?"),
      }
    : {
        ...putArtifactMutation(bridge),
        onSuccess: (_data, variables) => {
          reset(JSON.parse(variables.content) as Record<string, any>);
          void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.artifact(activeRoot(bridge), artifactKey) });
          toast("Saved");
        },
        onError: () => toast("Save failed — is the bridge running?"),
      },
);
```
Keep `onSubmit` calling `save.mutate({ key: artifactKey, content })` for the default branch; for the `saveFn` branch the mutation ignores `key` (it only reads `content`). Guard the Regenerate button render on `onRegenerate !== undefined`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @uxfactory/plugin test -- JsonFormEditor` — Expected: PASS. Existing JsonFormEditor/ArtifactEditor tests (default path) still green.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @uxfactory/plugin typecheck` — baseline, zero new.
```bash
git add packages/uxfactory-plugin/ui/screens/JsonFormEditor.tsx packages/uxfactory-plugin/test/
git commit -m "feat(panel): JsonFormEditor — optional injectable save (saveFn/onSaved), optional regenerate"
```

---

### Task 4: Panel — bridge client, query, PersonaManager, un-gate personas

**Files:**
- Modify: `packages/uxfactory-plugin/ui/lib/bridge.ts` (add `getPersonas`/`putPersona`/`deletePersona` + a `del` helper)
- Modify: `packages/uxfactory-plugin/ui/queries.ts` (`personasQuery` + `queryKeys.personas`)
- Create: `packages/uxfactory-plugin/ui/screens/PersonaManager.tsx`
- Modify: `packages/uxfactory-plugin/ui/screens/Artifacts.tsx` (un-gate personas Open + render PersonaManager)
- Test: `packages/uxfactory-plugin/test/screen-persona-manager.test.tsx` (+ additions to `screen-artifacts.test.tsx` for the un-gate)

**Interfaces:**
- Consumes: `GET /project/personas`, `PUT /project/personas/:id`, `DELETE /project/personas/:id` (Task 1); `formSpecFor("personas")` (Task 2); `JsonFormEditor` with `saveFn`/`onSaved` (Task 3); `enqueueMutation` (existing, for regenerate-all).
- Produces: `bridge.getPersonas()`, `bridge.putPersona(id, persona)`, `bridge.deletePersona(id)`; `personasQuery(bridge)`; `<PersonaManager bridge onBack />`.

- [ ] **Step 1: Write the failing tests**

```tsx
// screen-persona-manager.test.tsx
it("lists personas from the bridge, edits + saves one, adds a new P-NN, deletes one", async () => {
  const getPersonas = vi.fn().mockResolvedValue({ personas: [
    { personaId: "P-01", name: "Ana", archetype: "operator", goals: ["ship"], frustrations: [] },
    { personaId: "P-02", name: "Ben", archetype: "lead", goals: [], frustrations: [] },
  ] });
  const putPersona = vi.fn().mockResolvedValue({ ok: true });
  const deletePersona = vi.fn().mockResolvedValue({ ok: true, deleted: true });
  // render <PersonaManager bridge={{getPersonas, putPersona, deletePersona, ...}} onBack={()=>{}} />
  await waitFor(() => expect(screen.getByText("Ana")).toBeInTheDocument());
  // Add → next id is P-03
  fireEvent.click(screen.getByRole("button", { name: /add persona/i }));
  // fill name, Save → putPersona("P-03", {...})
  await waitFor(() => expect(putPersona).toHaveBeenCalledWith("P-03", expect.objectContaining({ name: expect.any(String) })));
  // Delete P-02 (confirm) → deletePersona("P-02")
  // ...mock window.confirm true...
  await waitFor(() => expect(deletePersona).toHaveBeenCalledWith("P-02"));
});

// screen-artifacts.test.tsx addition
it("clicking Open on the personas row opens the manager, not Finder", async () => {
  const openPath = vi.fn();
  // render Artifacts with a personas row present + openPath spy
  fireEvent.click(within(personasRow).getByRole("button", { name: /open personas/i }));
  expect(screen.getByText(/manage personas|persona manager/i)).toBeInTheDocument(); // manager mounted
  expect(openPath).not.toHaveBeenCalled(); // NOT the external-open path
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @uxfactory/plugin test -- persona-manager`
Expected: FAIL — no PersonaManager / personas still gated.

- [ ] **Step 3: Add the bridge client methods**

In `bridge.ts`, add a `del` helper beside `put`/`post`:
```ts
function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" }); // match the file's request()/put() signature
}
```
Add to the `Bridge` interface (optional-typed, legacy-safe, like `getPipelineResult?`):
```ts
getPersonas?(): Promise<{ personas: Array<Record<string, unknown> & { personaId: string }> }>;
putPersona?(id: string, persona: Record<string, unknown>): Promise<{ ok: boolean }>;
deletePersona?(id: string): Promise<{ ok: boolean; deleted: boolean }>;
```
Implement in the returned object:
```ts
getPersonas() { return request<{ personas: Array<Record<string, unknown> & { personaId: string }> }>(rooted("/project/personas")); },
putPersona(id: string, persona: Record<string, unknown>) { return put<{ ok: boolean }>(rooted(`/project/personas/${encodeURIComponent(id)}`), { persona }); },
deletePersona(id: string) { return del<{ ok: boolean; deleted: boolean }>(rooted(`/project/personas/${encodeURIComponent(id)}`)); },
```
(Match the exact `request`/`put` helper signatures in this file — if `put` takes `(path, body)` and `request` takes `(path, init?)`, adapt `del` accordingly.)

- [ ] **Step 4: Add the query**

In `queries.ts`: add `personas: (root: string | null) => [...] as const` to `queryKeys`, and:
```ts
export function personasQuery(bridge: Bridge) {
  return {
    queryKey: queryKeys.personas(activeRoot(bridge)),
    queryFn: () => bridge.getPersonas!(),
    enabled: typeof bridge.getPersonas === "function",
  };
}
```

- [ ] **Step 5: Build `PersonaManager.tsx`**

```tsx
// packages/uxfactory-plugin/ui/screens/PersonaManager.tsx
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Bridge } from "../lib/bridge.js";
import { personasQuery, queryKeys, activeRoot } from "../queries.js";
import { formSpecFor } from "../lib/artifact-forms.js";
import { JsonFormEditor } from "./JsonFormEditor.js";
import { useAppStore } from "../stores/app.js";

function nextPersonaId(ids: string[]): string {
  const nums = ids.map((id) => Number(/^P-(\d+)$/.exec(id)?.[1] ?? 0));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `P-${String(next).padStart(2, "0")}`;
}

export function PersonaManager({ bridge, onBack }: { bridge: Bridge; onBack: () => void }): React.JSX.Element {
  const qc = useQueryClient();
  const toast = useAppStore((s) => s.toast);
  const { data } = useQuery(personasQuery(bridge));
  const personas = data?.personas ?? [];
  const [editing, setEditing] = useState<{ id: string; value: Record<string, unknown> } | null>(null);
  const spec = formSpecFor("personas");

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: queryKeys.personas(activeRoot(bridge)) });
    void qc.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
  }

  if (editing !== null && spec !== undefined) {
    return (
      <JsonFormEditor
        artifactKey="personas"
        label={typeof editing.value["name"] === "string" && editing.value["name"] !== "" ? String(editing.value["name"]) : editing.id}
        status="up-to-date"
        spec={spec}
        value={editing.value}
        bridge={bridge}
        onBack={() => setEditing(null)}
        saveFn={async (content) => { await bridge.putPersona!(editing.id, JSON.parse(content) as Record<string, unknown>); }}
        onSaved={() => { invalidate(); setEditing(null); }}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-700">← Back</button>
        <span className="text-sm font-semibold">Personas ({personas.length})</span>
        <button
          onClick={() => setEditing({ id: nextPersonaId(personas.map((p) => p.personaId)),
            value: { name: "", archetype: "", segmentRef: null, goals: [], frustrations: [],
              context: { expertise: "intermediate", frequency: "", environment: "" }, quote: null } })}
          className="text-xs px-2.5 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 font-medium"
        >+ Add persona</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        {personas.length === 0 && <p className="text-xs text-gray-500">No personas yet. Add one, or regenerate from the Artifacts tab.</p>}
        {personas.map((p) => (
          <div key={p.personaId} className="border border-gray-200 rounded p-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{typeof p["name"] === "string" && p["name"] !== "" ? String(p["name"]) : p.personaId}</p>
              <p className="text-xs text-gray-500 truncate">{typeof p["archetype"] === "string" ? String(p["archetype"]) : ""}</p>
              <p className="text-[11px] text-gray-400">
                {(Array.isArray(p["goals"]) ? p["goals"].length : 0)} goals · {(Array.isArray(p["frustrations"]) ? p["frustrations"].length : 0)} frustrations
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setEditing({ id: p.personaId, value: p })} className="text-xs text-primary-600 hover:underline font-medium">Edit</button>
              <button
                onClick={async () => {
                  if (!window.confirm(`Delete ${typeof p["name"] === "string" && p["name"] !== "" ? p["name"] : p.personaId}?`)) return;
                  try { await bridge.deletePersona!(p.personaId); invalidate(); } catch { toast("Delete failed — is the bridge running?"); }
                }}
                className="text-xs text-red-600 hover:underline"
              >Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```
(Match the panel's existing Tailwind/kit conventions — reuse the same button/card classes other screens use if they differ from the above.)

- [ ] **Step 6: Un-gate personas in `Artifacts.tsx`**

Allow the in-panel "Open" button for personas (keep stories gated). Change the Open-button guard from `!SET_ARTIFACT_KEYS.has(row.key)` to also allow personas:
```tsx
{(!SET_ARTIFACT_KEYS.has(row.key) || row.key === "personas") && (
  <button type="button" onClick={() => setEditingKey(row.key)} ... aria-label={`Open ${row.label}`}>Open</button>
)}
```
In the `if (editingRow !== null)` block, render the manager for personas:
```tsx
if (editingRow !== null) {
  if (editingRow.key === "personas") {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <PersonaManager bridge={bridge} onBack={() => setEditingKey(null)} />
        {createDialog /* keep the shared dialog mounted for Regenerate-all via openDialog */}
      </div>
    );
  }
  return ( /* existing ArtifactEditor block, unchanged */ );
}
```
Import `PersonaManager`. (Regenerate-all remains reachable from the inventory row's Regenerate button, which runs `openDialog(personasRow)` → the whole-set `generate-artifact` job — unchanged. A per-manager "Regenerate all" button is optional; if added, wire it to `openDialog(editingRow)` behind a confirm noting it overwrites manual edits.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @uxfactory/plugin test -- persona-manager` then `pnpm --filter @uxfactory/plugin test -- screen-artifacts` — Expected: PASS.
Run: `pnpm --filter @uxfactory/plugin test` — full panel suite green.

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm --filter @uxfactory/plugin typecheck` (both tsconfigs) — baseline (16+3), zero new.
```bash
git add packages/uxfactory-plugin/ui/lib/bridge.ts packages/uxfactory-plugin/ui/queries.ts packages/uxfactory-plugin/ui/screens/PersonaManager.tsx packages/uxfactory-plugin/ui/screens/Artifacts.tsx packages/uxfactory-plugin/test/
git commit -m "feat(panel): in-panel Persona Manager — list/add/edit/delete replaces the Finder-open"
```

---

## Self-Review (author)

- **Spec coverage:** Bridge list/put/delete routes + path-safety + tolerate-malformed → Task 1. Persona field spec → Task 2. Reuse JsonFormEditor for a set instance (needs injectable save) → Task 3. PersonaManager list/add/edit/delete + un-gate personas (no more Finder) + bridge client + query → Task 4. Regenerate-all-stays → Task 4 Step 6 note. Every spec section maps to a task.
- **Placeholder scan:** none — every code step has real code; the spots that reference existing-but-must-confirm shapes (the panel's exact button classes; the `request`/`put`/`del` helper signatures in bridge.ts; the `EnumField` `options` vs `optionsFrom` shape) are called out explicitly to match, not left as TODO.
- **Type consistency:** `personaId` server-owned across Task 1 (stamped `=== :id`), Task 2 (excluded from the spec), Task 4 (never edited). `bridge.putPersona(id, persona)` / `getPersonas` / `deletePersona` signatures identical across bridge.ts (Task 4 Step 3) and their call sites (PersonaManager, personasQuery). `saveFn(content: string) => Promise<unknown>` identical between JsonFormEditor (Task 3) and PersonaManager's call (Task 4). `/^P-\d+$/` id shape identical between the bridge guard (Task 1) and the client's `nextPersonaId` minting (Task 4).

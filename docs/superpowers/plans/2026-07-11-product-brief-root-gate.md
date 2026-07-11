# Product Brief Root Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No artifact can be seeded/created until a user-authored product brief exists; the brief itself can never be AI-invented (its producer only structures the user's interview answers).

**Architecture:** One new spec-layer concept (the root artifact) enforced at two layers — the panel (disabled actions + banner + intake copy + answer passthrough) and the worker (fail-closed refusals for enqueues that bypass the panel). Bridge untouched (pure relay). Spec: `docs/superpowers/specs/2026-07-11-product-brief-root-gate-design.md`.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` import extensions), vitest, React + Radix (panel), worker is tsx source-first.

## Global Constraints

- Work directly on `main`. No branches. Every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- TDD per step: failing test → run RED → implement → run GREEN → commit.
- Panel typecheck (`pnpm --filter @uxfactory/plugin typecheck`) has EXACTLY 16 pre-existing errors — no new ones.
- Vocabulary: registry id `product-brief` (spec layer) ↔ panel/worker concern key `brief` (payload field `artifact`, path `.uxfactory/artifacts/brief.md`, legacy `brief.md`, `design/brief.md` — mirrors bridge `CONCERN_CANONICAL`/`CONCERN_LEGACY` in `packages/uxfactory-bridge/src/project.ts:137-172`).
- Exact copy (verbatim, everywhere they appear):
  - Tooltip: `Supply your product brief first — every artifact derives from it.`
  - Banner heading: `Start with your product brief`; body: `Every other artifact derives from it. Answer four questions or paste what you have — the AI structures your words, it never invents.`; CTA label: `Write the brief`
  - Dialog note (brief only): `Your answers become the brief. The AI structures and formats them — it never invents content you didn't provide.`
  - Worker refusal (no brief): `no product brief found — supply one in the panel (Artifacts → Product Brief) or at .uxfactory/artifacts/brief.md before seeding other artifacts`
  - Worker refusal (brief w/o answers): `a product brief must be user-authored — provide interview answers (the panel's brief dialog) instead of seeding it from nothing`
- Payload contract: `{ artifact: string, guidance: string, answers?: Record<string, string> }` — `answers` present only when the Create dialog collected at least one non-empty answer; Seed never sends it.
- The bridge and `ARTIFACT_PREREQS`/`AUTHORING_ORDER`/chaining machinery are NOT modified.

---

### Task 1: Spec-layer root-artifact concept

**Files:**
- Modify: `packages/uxfactory-spec/src/artifact-elicitation.ts` (after the `ARTIFACT_PREREQS` block, ~line 145)
- Modify: `packages/uxfactory-spec/src/index.ts` (add to the existing export list that already re-exports `ARTIFACT_PREREQS`)
- Test: `packages/uxfactory-spec/test/artifact-elicitation.test.ts`

**Interfaces:**
- Produces: `ROOT_ARTIFACT: "product-brief"` and `requiresRootArtifact(artifactId: string): boolean` — Task 4 imports both from `@uxfactory/spec`.

- [ ] **Step 1: Write the failing test** (append to the existing test file)

```ts
describe("root artifact gate (spec 2026-07-11-product-brief-root-gate)", () => {
  it("product-brief is the root and gates every other artifact", () => {
    expect(ROOT_ARTIFACT).toBe("product-brief");
    expect(requiresRootArtifact("product-brief")).toBe(false);
    expect(requiresRootArtifact("audience")).toBe(true);
    expect(requiresRootArtifact("stories")).toBe(true);
    expect(requiresRootArtifact("brand-colors")).toBe(true);
    expect(requiresRootArtifact("not-a-real-artifact")).toBe(true);
  });

  it("the brief intake stays four all-essential questions (the base minimum)", () => {
    const qs = ARTIFACT_ELICITATION["product-brief"] ?? [];
    expect(qs.map((q) => q.id)).toEqual(["problem", "outcomes", "out-of-scope", "constraints"]);
    expect(qs.every((q) => q.tag === "E")).toBe(true);
  });
});
```

Extend the file's existing import from `../src/artifact-elicitation.js` (or `../src/index.js`, matching its current style) with `ROOT_ARTIFACT, requiresRootArtifact`.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run packages/uxfactory-spec/test/artifact-elicitation.test.ts` → FAIL (`ROOT_ARTIFACT` not exported).

- [ ] **Step 3: Implement**

In `artifact-elicitation.ts`, directly after the `ARTIFACT_PREREQS` const:

```ts
// ─── The root artifact ────────────────────────────────────────────────────────

/**
 * The root of the artifact graph: user-authored intent nothing else can
 * derive. Deliberately NOT an ARTIFACT_PREREQS edge — prereqs auto-chain AI
 * interviews before a dependent artifact, which is exactly what the brief
 * must never be. Prereqs order derivations; the root is the axiom.
 */
export const ROOT_ARTIFACT = "product-brief";

/** True when creating `artifactId` requires the root artifact to exist first. */
export function requiresRootArtifact(artifactId: string): boolean {
  return artifactId !== ROOT_ARTIFACT;
}
```

Add `ROOT_ARTIFACT,` and `requiresRootArtifact,` to the `artifact-elicitation` export group in `src/index.ts`.

- [ ] **Step 4: Run to verify it passes** — same command → PASS. Also `pnpm --filter @uxfactory/spec build` → clean.

- [ ] **Step 5: Commit** — `feat(spec): ROOT_ARTIFACT — product-brief gates all artifact creation`

---

### Task 2: Worker fail-closed root gate

**Files:**
- Modify: `clients/uxfactory-worker/src/generative.ts`
- Test: `clients/uxfactory-worker/test/worker.test.ts` (follow the fakes/tmp-dir conventions of its `generative branch routing` describe)

**Interfaces:**
- Consumes: payload contract from Global Constraints (`answers?: Record<string, string>` — Task 3 makes the panel send it).
- Produces: `briefExists(projectRoot: string): Promise<boolean>` (exported for tests); refusal outcomes `{ status: 2, result: { error: <exact copy> } }`.

- [ ] **Step 1: Write the failing tests** (new describe in `worker.test.ts`; reuse the file's existing fake adapter/bridge/ctx helpers and tmp project-root setup — read that describe first and mirror it; the fake adapter must record whether it was invoked)

Cases (all via `runGenerative` with `req.kind === 'generate-artifact'`):
1. payload `{artifact: 'audience', guidance: 'x'}`, NO brief file anywhere → resolves `{status: 2}`, `result.error` contains `no product brief found`, adapter NOT invoked.
2. same payload, `.uxfactory/artifacts/brief.md` containing `# Acme\nBrief.` → adapter IS invoked (gate passes).
3. same payload, brief only at legacy `design/brief.md` → gate passes.
4. same payload, `.uxfactory/artifacts/brief.md` containing only whitespace → refused (whitespace is not a brief).
5. payload `{artifact: 'brief', guidance: 'x'}` (no `answers`) → `{status: 2}`, `result.error` contains `must be user-authored`, adapter NOT invoked.
6. payload `{artifact: 'brief', guidance: 'x', answers: {problem: 'Ops teams drown in spreadsheets', outcomes: '', 'out-of-scope': '', constraints: ''}}` → adapter invoked, and the user prompt it received contains `Ops teams drown in spreadsheets` and the clause `do not add claims the user did not make`.
7. `req.kind === 'generate-design'` with no brief file → NOT gated (adapter invoked; design generation keeps its own grounding-chip semantics).

- [ ] **Step 2: Run to verify RED** — `npx vitest run clients/uxfactory-worker/test/worker.test.ts` (cases 1, 4, 5, 6 must fail; 2, 3, 7 may pass trivially — that asserts existing behavior survives, which is correct).

- [ ] **Step 3: Implement**

(a) Near `PANEL_ARTIFACT_MAP`:

```ts
// ─── Root gate (spec 2026-07-11-product-brief-root-gate) ─────────────────────

/** Brief locations, canonical first — mirrors bridge CONCERN_CANONICAL/LEGACY. */
const BRIEF_CANDIDATES = ['.uxfactory/artifacts/brief.md', 'brief.md', 'design/brief.md'];

/** True when a non-empty product brief exists at any known location. */
export async function briefExists(projectRoot: string): Promise<boolean> {
  for (const rel of BRIEF_CANDIDATES) {
    try {
      const text = await fs.readFile(path.join(projectRoot, rel), 'utf8');
      if (text.trim().length > 0) return true;
    } catch {
      // missing/unreadable → try the next candidate
    }
  }
  return false;
}

/** A record with at least one non-empty string value — the user's own words. */
function hasUserAnswers(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).some(
    (a) => typeof a === 'string' && a.trim() !== '',
  );
}
```

(use the module's existing `fs`/`path` imports; add them if the promises API isn't already imported).

(b) At the top of `runGenerative`'s `try` block (before any adapter work):

```ts
// Root gate: every artifact derives from the brief; the brief itself is
// user-authored (the producer structures answers, never invents).
if (req.kind === 'generate-artifact') {
  const p = asObject(req.payload);
  const artifactKey = str(p, 'artifact');
  if (artifactKey !== undefined && artifactKey !== 'brief' && !(await briefExists(ctx.projectRoot))) {
    return {
      status: 2,
      result: {
        error:
          'no product brief found — supply one in the panel (Artifacts → Product Brief) ' +
          'or at .uxfactory/artifacts/brief.md before seeding other artifacts',
      },
    };
  }
  if (artifactKey === 'brief' && !hasUserAnswers(p['answers'])) {
    return {
      status: 2,
      result: {
        error:
          'a product brief must be user-authored — provide interview answers ' +
          "(the panel's brief dialog) instead of seeding it from nothing",
      },
    };
  }
}
```

(c) In the artifact route of `planGenerative` (the `PANEL_ARTIFACT_MAP` branch, ~line 1175-1226): when `artifact === 'brief'` and the payload has answers, append to the composed user prompt:

```ts
const answerEntries = Object.entries(asObject(p['answers']))
  .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== '');
if (artifact === 'brief' && answerEntries.length > 0) {
  user +=
    "\nThe user's answers (their words — the brief's entire factual content):\n" +
    answerEntries.map(([id, v]) => `- ${id}: ${v.trim()}`).join('\n') +
    '\nStructure and format these answers into the brief; do not add claims the user did not make.';
}
```

Adapt variable names to the route's actual locals (`user` may need `let`). If `planGenerative` cannot see the payload record there, thread it — smallest change wins.

- [ ] **Step 4: Run to verify GREEN** — worker suite green: `npx vitest run clients/uxfactory-worker/test/`.

- [ ] **Step 5: Commit** — `feat(worker): root gate — refuse artifact seeds without a brief; brief jobs require user answers`

---

### Task 3: Dialog answers passthrough (panel plumbing)

**Files:**
- Modify: `packages/uxfactory-plugin/ui/components/CreateArtifactDialog.tsx`
- Modify: `packages/uxfactory-plugin/ui/screens/Artifacts.tsx` (`handleGenerate` ~line 318, dialog `onGenerate` ~line 436)
- Test: `packages/uxfactory-plugin/test/screen-artifacts.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CreateArtifactDialogProps.onGenerate: (guidance: string, answers: Record<string, string>) => void`; enqueue payload gains `answers` per the Global Constraints contract. Task 4 relies on the dialog's brief-note copy being in place.

- [ ] **Step 1: Write the failing tests** (screen-artifacts; use the existing fake-bridge enqueue capture the file already uses for payload assertions)

1. Open the Product Brief row's Create/Regenerate dialog, fill the four interview fields, click Generate → the enqueued payload has `artifact: "brief"` and an `answers` record whose values include the typed text.
2. The open brief dialog shows the note `Your answers become the brief. The AI structures and formats them — it never invents content you didn't provide.`; a NON-brief artifact's dialog does NOT show it.
3. Click a row's Seed button → the enqueued payload has NO `answers` key.

- [ ] **Step 2: Run RED** — `cd packages/uxfactory-plugin && pnpm vitest run test/screen-artifacts.test.tsx`.

- [ ] **Step 3: Implement**

`CreateArtifactDialog.tsx`:
- Prop type: `onGenerate: (guidance: string, answers: Record<string, string>) => void`.
- Generate button: `onClick={() => onGenerate(composeGuidance(questions, answers, guidance), answers)}`.
- Below the dialog's guiding copy, render (following the file's existing muted-text classes):

```tsx
{artifactKey === "brief" && (
  <p className="...">
    Your answers become the brief. The AI structures and formats them — it never
    invents content you didn't provide.
  </p>
)}
```

`Artifacts.tsx`:
- `async function handleGenerate(row: ArtifactRow, guidance: string, answers?: Record<string, string>)`; payload becomes:

```ts
payload: {
  artifact: row.key,
  guidance,
  ...(answers !== undefined && Object.values(answers).some((v) => v.trim() !== "")
    ? { answers }
    : {}),
},
```

- Dialog wiring: `onGenerate={(guidance, answers) => { if (dialogRow !== null) void handleGenerate(dialogRow, guidance, answers); }}`. `handleSeed` stays `handleGenerate(row, SEED_GUIDANCE)` — no answers.

- [ ] **Step 4: Run GREEN** — same file, then the full plugin suite: `pnpm vitest run`.

- [ ] **Step 5: Commit** — `feat(panel): Create dialog passes structured answers through the enqueue payload`

---

### Task 4: Panel root-gate UI

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/Artifacts.tsx`
- Modify: `packages/uxfactory-plugin/ui/screens/ArtifactEditor.tsx` (Regenerate button gains `disabled` + tooltip support)
- Test: `packages/uxfactory-plugin/test/screen-artifacts.test.tsx`

**Interfaces:**
- Consumes: `ROOT_ARTIFACT`/`requiresRootArtifact` from `@uxfactory/spec` (Task 1) — note the panel key for the root is `"brief"` (`ARTIFACT_KEY_BY_ID[ROOT_ARTIFACT]`); dialog note copy (Task 3).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests** (fixture note: `makeMeridianSnapshot` has a brief row — override its status per case via the snapshot passed to `resetStores`)

1. Brief row status `"missing"` → the banner renders: heading `Start with your product brief`, body text, and a `Write the brief` button; clicking it opens the brief interview dialog (assert the dialog title contains `Product Brief`).
2. Brief missing → a non-brief row's Seed and Create buttons are disabled, with the tooltip text `Supply your product brief first — every artifact derives from it.` reachable (follow the file's existing ActionTooltip test pattern).
3. Brief present (`"draft"` or `"up-to-date"`) → banner absent, non-brief Seed/Create enabled.
4. The brief row NEVER shows a Seed button — assert absence both when brief is missing and when present.
5. Brief missing + navigate with `?focusArtifact=<non-brief missing key>` → the dialog that auto-opens is the BRIEF interview, not the focused artifact's.
6. Brief missing + editor subview open on a non-brief artifact → Regenerate is disabled with the same tooltip; on the brief itself (editor open on brief) → enabled.

- [ ] **Step 2: Run RED.**

- [ ] **Step 3: Implement**

`Artifacts.tsx`:
- Derivation (after `const artifacts = snapshot?.artifacts ?? []`, ~line 391):

```ts
// Root gate: the brief is user-authored intent — nothing else seeds without it.
const briefRow = artifacts.find((r) => r.key === "brief");
const briefMissing = (briefRow?.status ?? "missing") === "missing";
```

- Banner (top of the inventory list, styled per the panel's existing note/callout tokens — mirror WorkerBanner's structure, `role="note"`):

```tsx
{briefMissing && (
  <div role="note" className="...">
    <p className="font-medium">Start with your product brief</p>
    <p>
      Every other artifact derives from it. Answer four questions or paste what
      you have — the AI structures your words, it never invents.
    </p>
    <button type="button" onClick={() => { if (briefRow) openDialog(briefRow); }}>
      Write the brief
    </button>
  </div>
)}
```

- Row actions: for rows with `row.key !== "brief"`, `disabled={briefMissing}` on Seed and Create/Regenerate buttons, each wrapped in the screen's ActionTooltip pattern showing the tooltip copy when gated (Radix tooltips on disabled buttons need the existing wrapper approach — follow how the codebase already tooltips disabled controls, or wrap the disabled button in a span trigger). For the brief row: remove the Seed button entirely (Create/edit paths remain).
- Focus-intent redirect (~line 188):

```ts
if (row !== undefined && row.status === "missing") {
  const gated = row.key !== "brief" && briefMissing;
  const target = gated ? artifacts.find((r) => r.key === "brief") : undefined;
  openDialog(target ?? row); // root gate: intent starts at the brief
}
```

(compute from the effect's own `snapshot` reference, not stale closures).

`ArtifactEditor.tsx`: add optional props `regenerateDisabled?: boolean` and `regenerateDisabledReason?: string`; the Regenerate button honors them (disabled + tooltip). `Artifacts.tsx` editor branch passes `regenerateDisabled={briefMissing && editingRow.key !== "brief"}` and the tooltip copy.

- [ ] **Step 4: Run GREEN** — screen-artifacts, then full plugin suite + typecheck (16 errors exactly).

- [ ] **Step 5: Commit** — `feat(panel): root gate — brief-first banner, gated seed/create, no brief Seed`

---

### Task 5: Docs, changeset, verification (controller-run)

**Files:**
- Modify: `QUICK-START-TO-VIBE-FIGMA.md` (the worker/§2 seeding paragraph)
- Create: `.changeset/product-brief-root-gate.md`

- [ ] **Step 1: Docs.** In the §2 worker section (after the seeding-buttons paragraph), add:

> **The first artifact is yours.** Seeding anything requires a product brief first — it's the intent everything else derives from, so no model is allowed to invent it. Answer the four-question interview in the panel (the AI structures your words, it never invents) or drop your own markdown at `.uxfactory/artifacts/brief.md`. Until then, Seed/Create stay disabled and the worker refuses artifact jobs.

- [ ] **Step 2: Changeset:**

```
---
"@uxfactory/spec": minor
---

`ROOT_ARTIFACT` + `requiresRootArtifact()`: the product brief is the user-authored root of the artifact graph; seeding any other artifact requires it to exist.
```

- [ ] **Step 3: Full verification** — `npx vitest run` (monorepo green), `pnpm -r build`, plugin typecheck parity (16).
- [ ] **Step 4: Live smoke** — tmp project with no brief: panel shows banner + disabled actions; direct CLI enqueue for `audience` settles status 2 with the no-brief message; add a brief file → gate lifts. uxfio-demo (has a brief): unaffected.
- [ ] **Step 5: Commit docs + changeset**, restart the stack, update ledger.

---

## Self-review

- Spec coverage: decision 1 (all artifacts) → Tasks 2 & 4 gate by "not brief" — every non-root id, matching `requiresRootArtifact`. Decision 2 (user-authored, AI-structured) → Task 2 (answers required + structure-only clause), Task 3 (answers passthrough + dialog note), Task 4 (no Seed on brief). "Exists = non-empty file, legacy fallback" → Task 2 `briefExists`, panel uses row status (bridge already resolves legacy). Banner/CTA/tooltips → Task 4. Worker messages → Task 2. Unchanged list → no bridge/prereq edits anywhere.
- Placeholders: none — every step carries code or exact copy.
- Type consistency: `onGenerate(guidance, answers)` (T3) matches T3's Artifacts wiring; `answers?: Record<string,string>` payload (T3) matches T2's `hasUserAnswers`/prompt-weave; `briefExists` exported (T2) matches its tests; `ROOT_ARTIFACT` (T1) consumed in T4 via `ARTIFACT_KEY_BY_ID`.

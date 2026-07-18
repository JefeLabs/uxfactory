# Product Brief — Full-Screen Intake + Demo Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the product-brief root-gate intake a full-screen 4-question layout and a Demo button that fills the four questions with an LLM-generated idea grounded in the whole project config.

**Architecture:** Two independent slices. (1) Full-screen: the brief dialog resizes the plugin window up and renders full-bleed, restoring on close. (2) Demo: the panel resolves the project config into a prompt-ready `configContext` string, enqueues a new `demo-brief` worker kind whose SKILL invents one config-matched concept and writes the 4 answers to `.uxfactory/demo-brief.json`; the worker reads that back into the job result; the panel polls the result (reusing the Interpret button's `getPipelineResult` poll) and populates the dialog fields. Read-only until the user hits Generate.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` import extensions, `verbatimModuleSyntax`); React + Radix Dialog + Tailwind + TanStack Query (panel); `@helmsmith/agent-adapter` (worker); Vitest.

## Global Constraints

- **LLM-free engine.** The panel and bridge contain no model/vision calls; the LLM call lives only in the worker skill (`skill/demo-brief/SKILL.md`), run by the injected adapter. The panel enqueues + polls; nothing else.
- **Read-only until Generate.** The Demo path writes nothing to project state — it reads config and returns ephemeral answers. Only the user's subsequent Generate writes the brief (unchanged producer path).
- **Brief authorship contract unchanged.** The answerless-refusal gate (`generative.ts` `hasUserAnswers`) stays; a demo populates the same `answers` fields the user would type, keyed to the four elicitation ids: `problem`, `outcomes`, `out-of-scope`, `constraints`.
- **Full-screen is brief-only.** `artifactKey === "brief"`; every other artifact keeps the current compact `max-w-sm` modal untouched.
- **TS/ESM conventions:** `.js` import extensions on relative imports; `verbatimModuleSyntax` (use `import type` for type-only imports). Panel has ~16+3 pre-existing typecheck errors unrelated to this work — add zero. Spec has 4 pre-existing `story-schema.test.ts` typecheck errors — add zero.
- **Design-style group names live only in the plugin** (`ui/lib/design-styles.ts` `DESIGN_STYLE_GROUPS`), not in the worker's `STYLE_GUIDANCE` — this is why config enrichment happens panel-side.
- Commit style: `feat(panel):`, `feat(worker):`, `test(...)`, `fix(...)` matching repo history.

## File Structure

- **Create** `packages/uxfactory-plugin/ui/lib/demo-config.ts` — pure `buildDemoConfigContext(classification, profile)` → prompt-ready string (Task 1). Colocated test.
- **Create** `skill/demo-brief/SKILL.md` — the demo-idea generation skill (Task 2).
- **Modify** `clients/uxfactory-worker/src/skills.ts` — add `'demo-brief'` to `SkillName` (Task 2).
- **Modify** `clients/uxfactory-worker/src/generative.ts` — `planGenerative` branch for `demo-brief`; `runGenerative` post-stream read of `.uxfactory/demo-brief.json` → `{ answers }`; `readDemoAnswers` helper (Task 2).
- **Modify** `packages/uxfactory-plugin/ui/components/CreateArtifactDialog.tsx` — full-bleed brief layout (Task 3); `initialAnswers` prop + Demo button (Task 4).
- **Modify** `packages/uxfactory-plugin/ui/screens/Artifacts.tsx` — window resize on brief-dialog open/close (Task 3); demo enqueue + poll + hold answers + pass `initialAnswers` (Task 4).

Tests live in `packages/uxfactory-plugin/test/` (panel; e.g. `test/demo-config.test.ts`, additions to a screen test) and `clients/uxfactory-worker/test/` (worker).

---

### Task 1: Pure `buildDemoConfigContext` — resolve the whole config into a prompt block

**Files:**
- Create: `packages/uxfactory-plugin/ui/lib/demo-config.ts`
- Test: `packages/uxfactory-plugin/test/demo-config.test.ts`

**Interfaces:**
- Consumes: `@uxfactory/spec` exports `CATEGORY_TAXONOMY`, `CATEGORY_GROUPS`, `normalizeCategory`, `INDUSTRY_TAXONOMY`, `INDUSTRY_SECTORS`, `normalizeIndustry`; plugin `ui/lib/design-styles.ts` exports `DESIGN_STYLES` (array of `{ value, label, group, traits }`) and `DESIGN_STYLE_GROUPS` (`{ id, label }[]`).
- Produces: `export function buildDemoConfigContext(classification: Record<string, unknown> | null | undefined, profile: Record<string, unknown> | null | undefined): string` — a multi-line, human-readable context block naming each setting's group + label + metadata. Never throws; missing/unknown fields are omitted gracefully. An entirely empty config yields a short generic line (not an empty string).

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-plugin/test/demo-config.test.ts
import { describe, it, expect } from "vitest";
import { buildDemoConfigContext } from "../ui/lib/demo-config.js";

describe("buildDemoConfigContext", () => {
  it("names category group+label+one-liner and industry sector+label+drivers+compliance", () => {
    const ctx = buildDemoConfigContext(
      { category: "productivity-collaboration", industry: "k12", locale: "en-US",
        platforms: ["desktop", "mobile"], layout: "responsive", ageGroup: "18-39",
        style: "informal", designStyle: "y2k" },
      { scope: { visual: "medium", editorial: "high", coverage: "high", flow: "high" },
        experimental: { coherence: "high" } },
    );
    expect(ctx).toContain("SaaS & tools › Productivity & collaboration");
    expect(ctx).toContain("Education › K-12");
    expect(ctx).toContain("Nostalgic & retro › Y2K Aesthetic"); // design-style group+label
    expect(ctx).toContain("en-US");
    expect(ctx).toContain("desktop, mobile");
    expect(ctx).toContain("informal");
    expect(ctx).toMatch(/coverage[^\n]*high/i);
  });

  it("omits the design-style vibe line when style is unset/exploring", () => {
    const ctx = buildDemoConfigContext(
      { category: "ecommerce-storefront", industry: "fashion-apparel", designStyle: "" },
      null,
    );
    expect(ctx).toContain("Commerce & transactions › Ecommerce storefront");
    expect(ctx).not.toMatch(/design style/i); // exploring → no style line
  });

  it("never throws and yields a generic line for an empty config", () => {
    expect(buildDemoConfigContext(null, null)).toMatch(/\S/); // non-empty
    expect(() => buildDemoConfigContext({ category: 42 as unknown as string }, {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uxfactory/plugin test -- demo-config`
Expected: FAIL — cannot find module `../ui/lib/demo-config.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/uxfactory-plugin/ui/lib/demo-config.ts
/**
 * demo-config.ts — resolve the project config into a prompt-ready context block
 * for the Demo button's `demo-brief` worker job. Panel-side because the
 * design-style GROUP names live only in ui/lib/design-styles.ts. Pure, never
 * throws: unknown/missing fields are omitted; the three taxonomy-backed
 * settings (category, industry, design-style) carry their dropdown GROUP names.
 */
import {
  CATEGORY_TAXONOMY, CATEGORY_GROUPS, normalizeCategory,
  INDUSTRY_TAXONOMY, INDUSTRY_SECTORS, normalizeIndustry,
} from "@uxfactory/spec";
import { DESIGN_STYLES, DESIGN_STYLE_GROUPS } from "./design-styles.js";

function str(o: Record<string, unknown> | null | undefined, k: string): string {
  const v = o?.[k];
  return typeof v === "string" ? v : "";
}
function groupLabel(groups: { id: string; label: string }[], id: string): string {
  return groups.find((g) => g.id === id)?.label ?? id;
}

export function buildDemoConfigContext(
  classification: Record<string, unknown> | null | undefined,
  profile: Record<string, unknown> | null | undefined,
): string {
  const lines: string[] = [];

  const catSlug = normalizeCategory(str(classification, "category"));
  const cat = CATEGORY_TAXONOMY[catSlug];
  if (cat !== undefined) {
    lines.push(
      `Product type: ${groupLabel(CATEGORY_GROUPS, cat.group)} › ${cat.label} — ${cat.oneLiner}.` +
        (cat.iaSeed.length > 0 ? ` Typical pages: ${cat.iaSeed.join(", ")}.` : ""),
    );
  }

  const indSlug = normalizeIndustry(str(classification, "industry"));
  const ind = INDUSTRY_TAXONOMY[indSlug];
  if (ind !== undefined) {
    lines.push(
      `Industry: ${groupLabel(INDUSTRY_SECTORS, ind.sector)} › ${ind.label}. ${ind.drivers}` +
        (ind.complianceFlags.length > 0
          ? ` Compliance to respect: ${ind.complianceFlags.join(", ")}.`
          : ""),
    );
  }

  const styleSlug = str(classification, "designStyle");
  const style = DESIGN_STYLES.find((s) => s.value === styleSlug);
  if (style !== undefined) {
    lines.push(
      `Design style (vibe/archetype only, do not name it in the answers): ` +
        `${groupLabel(DESIGN_STYLE_GROUPS, style.group)} › ${style.label}` +
        (style.traits.length > 0 ? ` (${style.traits.slice(0, 3).join(", ")})` : "") + ".",
    );
  }

  const locale = str(classification, "locale");
  if (locale !== "") lines.push(`Locale: ${locale}.`);
  const platforms = Array.isArray(classification?.["platforms"])
    ? (classification!["platforms"] as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  if (platforms.length > 0) lines.push(`Platforms: ${platforms.join(", ")}.`);
  const layout = str(classification, "layout");
  if (layout !== "") lines.push(`Layout: ${layout}.`);
  const age = str(classification, "ageGroup");
  if (age !== "") lines.push(`Target age group: ${age}.`);
  const tone = str(classification, "style");
  if (tone !== "") lines.push(`Tone of voice: ${tone}.`);

  const scope = (profile?.["scope"] ?? null) as Record<string, unknown> | null;
  if (scope !== null) {
    const dials = ["visual", "editorial", "coverage", "flow"]
      .map((d) => `${d} ${str(scope, d) || "?"}`)
      .join(", ");
    lines.push(`Scope/ambition: ${dials}.`);
  }
  const coherence = str((profile?.["experimental"] ?? null) as Record<string, unknown> | null, "coherence");
  if (coherence !== "") lines.push(`Coherence: ${coherence}.`);

  return lines.length > 0
    ? lines.join("\n")
    : "No project configuration set — invent a broadly appealing web app idea.";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uxfactory/plugin test -- demo-config`
Expected: PASS (3/3).

Note: confirm `DESIGN_STYLES` exports each entry with `value`, `label`, `group`, `traits` (read `ui/lib/design-styles.ts`); if the export name differs (e.g. a default array), adapt the import — the test asserts behavior, not the export name.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @uxfactory/plugin typecheck` — Expected: baseline (16+3), zero new.
```bash
git add packages/uxfactory-plugin/ui/lib/demo-config.ts packages/uxfactory-plugin/test/demo-config.test.ts
git commit -m "feat(panel): buildDemoConfigContext — full project config → prompt block"
```

---

### Task 2: Worker `demo-brief` kind + skill + result read-back

**Files:**
- Create: `skill/demo-brief/SKILL.md`
- Modify: `clients/uxfactory-worker/src/skills.ts` (add `'demo-brief'` to `SkillName`)
- Modify: `clients/uxfactory-worker/src/generative.ts` (`planGenerative` branch; `runGenerative` demo read-back; `readDemoAnswers` helper)
- Test: `clients/uxfactory-worker/test/generative.test.ts` (or the existing worker test file that covers `planGenerative`/skill routing — match the repo's location)

**Interfaces:**
- Consumes: the enqueued request `{ kind: "demo-brief", payload: { configContext: string } }`; `loadSkill('demo-brief')`; `ctx.projectRoot`.
- Produces: on success, `runGenerative` returns `{ status: 0, result: { answers: { problem, outcomes, "out-of-scope", constraints } } }`; on a missing/malformed `.uxfactory/demo-brief.json`, `{ status: 2, result: { error, content } }`.

- [ ] **Step 1: Add `demo-brief` to `SkillName`**

In `clients/uxfactory-worker/src/skills.ts`, extend the union (currently ends with `| 'node-identity'`):
```ts
export type SkillName =
  | 'generate' | 'vision-review' | 'intake' | 'batch'
  | 'design' | 'craft-review' | 'node-identity' | 'demo-brief';
```

- [ ] **Step 2: Write the failing worker tests**

Add to the worker test that exercises `planGenerative`/skill routing (mirror the existing `identity-interpret` routing test):
```ts
it("routes demo-brief to the demo-brief skill and injects the configContext", () => {
  const plan = planGenerative(
    { id: "r1", kind: "demo-brief", payload: { configContext: "Product type: SaaS & tools › X" } },
    { projectRoot: "/tmp/x" } as never,
    {},
  );
  expect(plan.systemPrompt).toBe(loadSkill("demo-brief"));
  expect(plan.user).toContain("SaaS & tools › X");
});

it("readDemoAnswers returns the answers object, or null when the file is absent/malformed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "demo-"));
  await writeFile(
    path.join(dir, "demo-brief.json"),
    JSON.stringify({ answers: { problem: "p", outcomes: "o", "out-of-scope": "s", constraints: "c" } }),
  );
  expect(await readDemoAnswers(path.join(dir, "demo-brief.json"))).toEqual({
    problem: "p", outcomes: "o", "out-of-scope": "s", constraints: "c",
  });
  expect(await readDemoAnswers(path.join(dir, "missing.json"))).toBeNull();
});
```
(Import `planGenerative`, `loadSkill`, `readDemoAnswers` from the worker source; add `mkdtemp`/`writeFile`/`tmpdir`/`path` imports. If `planGenerative`/`readDemoAnswers` aren't exported yet, export them.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run clients/uxfactory-worker/test -t "demo-brief"` (the worker package has no `test` script — invoke vitest directly on its test dir)
Expected: FAIL — `demo-brief` not routed / `readDemoAnswers` undefined.

- [ ] **Step 4: Implement the `planGenerative` branch + `readDemoAnswers` + result read-back**

In `clients/uxfactory-worker/src/generative.ts`, add a `demo-brief` branch in `planGenerative` (beside the `identity-interpret` branch, ~line 1337):
```ts
if (req.kind === 'demo-brief') {
  const configContext = str(asObject(req.payload), 'configContext') ?? '';
  return {
    systemPrompt: loadSkill('demo-brief'),
    user:
      'Invent ONE specific, plausible website/app concept that fits this project ' +
      'configuration, then write the four product-brief answers per the skill.\n\n' +
      'Project configuration:\n' + configContext,
  };
}
```
Add the read-back helper (near the other file readers, e.g. after `readAudienceNote`):
```ts
/** Read the four demo-brief answers the agent wrote; null if absent/malformed. */
export async function readDemoAnswers(
  filePath: string,
): Promise<Record<string, string> | null> {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    const answers = asObject(raw)['answers'];
    const obj = asObject(answers);
    const ids = ['problem', 'outcomes', 'out-of-scope', 'constraints'];
    const out: Record<string, string> = {};
    for (const id of ids) {
      const v = obj[id];
      if (typeof v !== 'string' || v.trim() === '') return null;
      out[id] = v.trim();
    }
    return out;
  } catch {
    return null;
  }
}
```
In `runGenerative`, immediately after the `for await (const chunk of adapter.stream(input))` loop finishes (after the trailing-progress flush, BEFORE the `artifacts`/`landing`/`writes` blocks), add an early return for demo-brief:
```ts
if (req.kind === 'demo-brief') {
  const answers = await readDemoAnswers(
    path.join(ctx.projectRoot, '.uxfactory', 'demo-brief.json'),
  );
  if (answers === null) {
    return { status: 2, result: { error: 'demo idea generation produced no answers', content } };
  }
  return { status: 0, result: { answers } };
}
```
Ensure `planGenerative` and `readDemoAnswers` are `export`ed (the tests import them). Confirm `demo-brief` is NOT in the `DETERMINISTIC` table (`dispatch.ts`) so it routes to `runGenerative` — no change needed there (only listed kinds are deterministic), but verify.

- [ ] **Step 5: Write `skill/demo-brief/SKILL.md`**

```markdown
---
name: demo-brief
description: Generate a demo product brief — invent one plausible website/app concept that matches the project configuration and write the four brief answers. For the panel's Demo button (showcase, not the user's real brief).
---

# Demo Brief Generator

You produce a DEMO example product brief to showcase what the tool does. You are given a project configuration; invent ONE specific, plausible website or application concept that fits it, then answer the four product-brief questions **as if you were the product's owner** (first person, concrete, specific — plausible names, numbers, and constraints).

This is a demo, so inventing a concept is expected and correct. Ground every choice in the configuration you were given: the product type shapes what it is, the industry shapes the domain and its constraints (fold any named compliance into the constraints answer), the design style is a vibe/archetype signal only — never name the style in the answers. When the configuration is sparse, invent sensibly.

Write ONLY a JSON file — no prose, no other files — to `.uxfactory/demo-brief.json` in the project root, with exactly this shape:

```json
{
  "answers": {
    "problem": "What problem does this product solve, and for whom? (2–4 sentences, first person)",
    "outcomes": "How will you measure success? 1–3 outcomes with concrete targets.",
    "out-of-scope": "What is explicitly out of scope for this version?",
    "constraints": "Non-negotiable constraints (technical, legal, brand, budget) — include any compliance the industry implies."
  }
}
```

All four keys are required and must be non-empty. Keep each answer tight (a few sentences). Do not include the design-style name, the config field names, or meta-commentary in the answers — write them as a real founder's brief.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run clients/uxfactory-worker/test -t "demo-brief"` — Expected: PASS.
Run: `pnpm vitest run clients/uxfactory-worker/test` — Expected: full worker suite green (no regression).

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter uxfactory-worker typecheck` (or `pnpm exec tsc -p clients/uxfactory-worker/tsconfig.json --noEmit` if no filter script) — Expected: clean.
```bash
git add skill/demo-brief/SKILL.md clients/uxfactory-worker/src/skills.ts clients/uxfactory-worker/src/generative.ts clients/uxfactory-worker/test/
git commit -m "feat(worker): demo-brief kind — config-grounded example brief, answers read back into result"
```

---

### Task 3: Full-screen brief intake (resize + full-bleed, restore on close)

**Files:**
- Modify: `packages/uxfactory-plugin/ui/components/CreateArtifactDialog.tsx` (conditional full-bleed `Dialog.Content` for the brief)
- Modify: `packages/uxfactory-plugin/ui/screens/Artifacts.tsx` (post `resize` on brief-dialog open; restore on close)
- Test: `packages/uxfactory-plugin/test/screen-artifacts.test.tsx` (or the existing Artifacts/dialog screen test)

**Interfaces:**
- Consumes: the existing `resize` plugin-message channel (`parent.postMessage({ pluginMessage: { type: "resize", width, height } })`, handled by `code.ts` → `figma.ui.resize`; `router.tsx` `RESIZE_MAP` `/tabs` default is `560×640`).
- Produces: no new exports; behavior change only.

- [ ] **Step 1: Write the failing test**

```tsx
// in the Artifacts screen test — assert brief-open posts an enlarged resize, close restores
it("enlarges the plugin window for the brief intake and restores on close", async () => {
  const posts: Array<{ type: string; width?: number; height?: number }> = [];
  const origParent = window.parent;
  // capture postMessage to the plugin host
  vi.spyOn(window.parent, "postMessage").mockImplementation((msg: unknown) => {
    const pm = (msg as { pluginMessage?: { type: string; width?: number; height?: number } }).pluginMessage;
    if (pm?.type === "resize") posts.push(pm);
  });
  // render Artifacts with a brief row missing, open the brief dialog
  // ...render + click "Write the brief"...
  await waitFor(() => expect(posts.some((p) => (p.width ?? 0) > 560)).toBe(true)); // enlarged
  // close the dialog (Esc/Cancel)
  // ...
  await waitFor(() => expect(posts.at(-1)).toMatchObject({ width: 560, height: 640 })); // restored
  void origParent;
});
```
(Adapt to the screen test's existing render/harness for `Artifacts.tsx`; the assertion is: opening the brief dialog posts a resize with width > 560, closing posts the `/tabs` default 560×640.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uxfactory/plugin test -- screen-artifacts`
Expected: FAIL — no enlarged resize posted on brief open.

- [ ] **Step 3: Implement the resize effect in `Artifacts.tsx`**

Add near the other effects (after the dialog state is known; `dialogRow` holds the open row, `BRIEF_KEY` is defined). Constants at module top:
```ts
const BRIEF_INTAKE_SIZE = { width: 900, height: 720 }; // full-screen brief intake
const TABS_SIZE = { width: 560, height: 640 };          // /tabs default (RESIZE_MAP)
function postResize(width: number, height: number): void {
  if (typeof parent !== "undefined" && parent !== window) {
    parent.postMessage({ pluginMessage: { type: "resize", width, height } }, "*");
  }
}
```
Effect (keyed on whether the brief dialog is open):
```ts
const briefDialogOpen = dialogRow?.key === BRIEF_KEY;
useEffect(() => {
  if (briefDialogOpen) {
    postResize(BRIEF_INTAKE_SIZE.width, BRIEF_INTAKE_SIZE.height);
    return () => postResize(TABS_SIZE.width, TABS_SIZE.height); // restore on close/unmount
  }
  return undefined;
}, [briefDialogOpen]);
```
(The cleanup fires when `briefDialogOpen` flips false or the component unmounts — covering Generate, Cancel, Esc, overlay click, and navigation. `900×720` is clamped by Figma to the window bounds automatically.)

- [ ] **Step 4: Implement the full-bleed layout in `CreateArtifactDialog.tsx`**

Make the `Dialog.Content` className conditional on the brief. Replace the single `className="fixed left-1/2 ..."` string with:
```tsx
<Dialog.Content
  className={
    artifactKey === "brief"
      ? "fixed inset-0 w-full h-full bg-white z-50 flex flex-col gap-3 p-6 overflow-y-auto"
      : "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm max-h-[85vh] overflow-y-auto bg-white rounded-lg shadow-xl z-50 flex flex-col gap-3 p-4"
  }
>
```
For the brief, give the question textareas more room — make `rows` conditional so the brief's four questions get taller fields:
```tsx
rows={artifactKey === "brief" ? 4 : 2}
```
(One-line change on the interview `<textarea>`; other artifacts unaffected.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @uxfactory/plugin test -- screen-artifacts`
Expected: PASS. Then `pnpm --filter @uxfactory/plugin test -- CreateArtifactDialog` (existing dialog tests still green).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @uxfactory/plugin typecheck` — baseline, zero new.
```bash
git add packages/uxfactory-plugin/ui/components/CreateArtifactDialog.tsx packages/uxfactory-plugin/ui/screens/Artifacts.tsx packages/uxfactory-plugin/test/
git commit -m "feat(panel): full-screen brief intake — enlarge window + full-bleed layout, restore on close"
```

---

### Task 4: Demo button — enqueue `demo-brief`, poll result, populate the four fields

**Files:**
- Modify: `packages/uxfactory-plugin/ui/components/CreateArtifactDialog.tsx` (`initialAnswers` prop + merge; Demo button; overwrite-confirm; disabled/generating states)
- Modify: `packages/uxfactory-plugin/ui/screens/Artifacts.tsx` (demo enqueue + `getPipelineResult` poll + hold demo answers + pass `initialAnswers`; worker-presence gating)
- Test: `packages/uxfactory-plugin/test/screen-artifacts.test.tsx`

**Interfaces:**
- Consumes: `enqueueMutation(bridge)` (Task-existing) → `bridge.enqueue({ kind: "demo-brief", payload: { configContext } })`; `bridge.getPipelineResult(id)` → `{ state: "done"|"pending"|"unknown", status, result }` (the same poll the Interpret button uses); `buildDemoConfigContext` (Task 1); the snapshot's `classification`/`profile`; the worker-presence signal already used to gate the Interpret/enqueue UI.
- Produces: new prop `initialAnswers?: Record<string, string>` on `CreateArtifactDialogProps`; behavior only otherwise.

- [ ] **Step 1: Write the failing test**

```tsx
it("Demo enqueues demo-brief with the config context and fills the four answers from the result", async () => {
  const enqueue = vi.fn().mockResolvedValue({ id: "job-1" });
  let poll = 0;
  const getPipelineResult = vi.fn().mockImplementation(async () => {
    poll += 1;
    return poll < 2
      ? { state: "pending" as const }
      : { state: "done" as const, status: 0, result: { answers: {
          problem: "P", outcomes: "O", "out-of-scope": "S", constraints: "C" } } };
  });
  // render Artifacts with a bridge mock exposing { enqueue, getPipelineResult, ...worker present },
  // a snapshot with classification/profile, open the brief dialog, click "Demo"
  // ...
  await waitFor(() => expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
    kind: "demo-brief",
    payload: expect.objectContaining({ configContext: expect.stringContaining("›") }),
  })));
  await waitFor(() => expect(screen.getByLabelText(/What problem does this product solve/i))
    .toHaveValue("P"));
});

it("Demo is disabled when no worker is connected", async () => {
  // render with the no-worker snapshot; open brief dialog
  expect(screen.getByRole("button", { name: /demo/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uxfactory/plugin test -- screen-artifacts`
Expected: FAIL — no Demo button / not wired.

- [ ] **Step 3: Add `initialAnswers` prop + Demo button to `CreateArtifactDialog.tsx`**

Extend the props and merge `initialAnswers` into the reset effect (last-write-wins over defaults/prefills):
```ts
export interface CreateArtifactDialogProps {
  // ...existing...
  /** Answers to seed on open / when a demo result arrives (brief Demo button). */
  initialAnswers?: Record<string, string>;
  /** Fired when the user clicks Demo (brief only) — parent runs the demo job. */
  onDemo?: () => void;
  /** True while a demo job is generating (disables Demo, shows "Generating…"). */
  demoRunning?: boolean;
  /** True when a worker is connected (Demo disabled without one). */
  workerConnected?: boolean;
}
```
In the reset `useEffect`, merge `initialAnswers` after defaults/prefills:
```ts
setAnswers({
  ...Object.fromEntries(questionsFor(artifactKey).filter((q) => q.defaultValue !== undefined).map((q) => [q.id, q.defaultValue!])),
  ...dynamicPrefills(artifactKey),
  ...(initialAnswers ?? {}),
});
```
Add a second effect so a demo result arriving *while the dialog is already open* merges in (with overwrite-confirm if the user has typed):
```ts
useEffect(() => {
  if (!open || initialAnswers === undefined) return;
  setAnswers((prev) => {
    const hasTyped = questions.some((q) => (prev[q.id] ?? "").trim() !== "" &&
      (prev[q.id] ?? "") !== (initialAnswers[q.id] ?? ""));
    if (hasTyped && !window.confirm("Replace your answers with the demo example?")) return prev;
    return { ...prev, ...initialAnswers };
  });
}, [initialAnswers]); // eslint note: intentional — react only to a NEW demo result
```
Render a **Demo** button in the brief-only footer, beside Cancel/Generate (guard `artifactKey === "brief"`):
```tsx
{artifactKey === "brief" && onDemo !== undefined && (
  <button
    type="button"
    onClick={onDemo}
    disabled={demoRunning === true || workerConnected === false}
    title={workerConnected === false ? "Connect a worker to generate a demo" : ""}
    className="text-xs px-3 py-1.5 rounded border border-primary-300 text-primary-700 hover:bg-primary-50 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {demoRunning === true ? "Generating…" : "Demo"}
  </button>
)}
```

- [ ] **Step 4: Wire the demo flow in `Artifacts.tsx`**

Add state + the poll (mirror Components.tsx's `getPipelineResult` poll, `INTERPRET_POLL_MS = 1800`):
```ts
const DEMO_POLL_MS = 1800;
const [demoRunning, setDemoRunning] = useState(false);
const [demoJobId, setDemoJobId] = useState<string | null>(null);
const [demoAnswers, setDemoAnswers] = useState<Record<string, string> | undefined>(undefined);
const demoPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
function clearDemo(): void {
  if (demoPollRef.current !== null) { clearInterval(demoPollRef.current); demoPollRef.current = null; }
  setDemoRunning(false); setDemoJobId(null);
}

async function handleDemo(): Promise<void> {
  const configContext = buildDemoConfigContext(
    (snapshot?.classification ?? null) as Record<string, unknown> | null,
    (snapshot?.profile ?? null) as Record<string, unknown> | null,
  );
  setDemoRunning(true);
  try {
    const { id } = await enqueue.mutateAsync({ kind: "demo-brief", payload: { configContext } });
    setDemoJobId(id);
  } catch {
    clearDemo();
    // reuse the panel's toast idiom for a failed enqueue
  }
}

useEffect(() => {
  if (!demoRunning || demoJobId === null) return;
  if (typeof bridge.getPipelineResult !== "function") return;
  const id = demoJobId;
  const poll = async (): Promise<void> => {
    const res = await bridge.getPipelineResult!(id);
    if (res.state !== "done") return;
    clearDemo();
    const answers = ((res.result as { answers?: Record<string, string> } | null)?.answers) ?? null;
    if (res.status === 0 && answers !== null) setDemoAnswers({ ...answers });
    // else: toast the error (res.result?.error), same discipline as Interpret
  };
  void poll();
  const interval = setInterval(() => void poll(), DEMO_POLL_MS);
  demoPollRef.current = interval;
  const timeout = setTimeout(() => clearDemo(), 5 * 60 * 1000); // backstop
  return () => { clearInterval(interval); clearTimeout(timeout); if (demoPollRef.current === interval) demoPollRef.current = null; };
}, [demoRunning, demoJobId, bridge]);
```
Pass the new props into `CreateArtifactDialog` (in the JSX around line 453):
```tsx
<CreateArtifactDialog
  // ...existing props...
  initialAnswers={dialogRow?.key === BRIEF_KEY ? demoAnswers : undefined}
  onDemo={dialogRow?.key === BRIEF_KEY ? () => void handleDemo() : undefined}
  demoRunning={demoRunning}
  workerConnected={/* the existing worker-presence boolean this screen already computes for enqueue gating */}
/>
```
Reset `demoAnswers` to `undefined` when the dialog row changes/closes (in `openDialog` and the close handler) so a stale demo doesn't leak across opens.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @uxfactory/plugin test -- screen-artifacts`
Expected: PASS (Demo enqueues `demo-brief` with `configContext`; result fills the four fields; Demo disabled without a worker).

- [ ] **Step 6: Full panel suite + typecheck + commit**

Run: `pnpm --filter @uxfactory/plugin test` — Expected: green.
Run: `pnpm --filter @uxfactory/plugin typecheck` — baseline, zero new.
```bash
git add packages/uxfactory-plugin/ui/components/CreateArtifactDialog.tsx packages/uxfactory-plugin/ui/screens/Artifacts.tsx packages/uxfactory-plugin/test/
git commit -m "feat(panel): Demo button — config-grounded example brief fills the four questions"
```

---

## Notes for the implementer

- **Worker-presence boolean:** `Artifacts.tsx` (or a shared hook) already computes whether a worker is connected for enqueue gating — reuse it for `workerConnected`; do not invent a new presence signal. If it isn't readily available in this screen, read it from the same store/query `Components.tsx` uses for the Interpret button's disabled state.
- **`enqueue.mutateAsync` returns `{ id }`** (confirmed: `Artifacts.tsx handleGenerate` destructures `const { id } = await enqueue.mutateAsync(...)`). The demo poll keys on that id.
- **`getPipelineResult` is optional on the bridge type** (`getPipelineResult?`) — guard `typeof bridge.getPipelineResult === "function"` before polling (legacy-bridge safe), exactly as Components.tsx does.
- **Do not** thread the demo through `handleGenerate` — the demo is a separate enqueue (`demo-brief`), not `generate-artifact`. The user's later Generate click still runs the normal `generate-artifact` path with the (now demo-filled) answers.
- **Keep the brief's "AI structures your words, it never invents" disclaimer** — a demo is explicitly a showcase; the answers land in the same editable fields, and the user chooses to Demo.

## Self-Review (author)

- **Spec coverage:** Full-screen intake → Task 3. Demo button LLM path → Task 2 (worker) + Task 4 (panel). Full-config enrichment incl. three group names → Task 1 (panel `buildDemoConfigContext`, asserted for category/industry/design-style groups). Exploring/unset designStyle → Task 1 test + skill prose. Read-only-until-Generate, no-worker/error/overwrite states, LLM-free panel/bridge → Tasks 2/4 + Global Constraints. All spec sections map to a task.
- **Placeholder scan:** none — every code step has real code; the two spots that reference existing-but-unnamed values (worker-presence boolean; the screen test's render harness) are called out explicitly in "Notes" with how to resolve, not left as TODO.
- **Type consistency:** `buildDemoConfigContext(classification, profile)` signature identical in Task 1 and its Task 4 call site; `readDemoAnswers` returns `Record<string,string>|null` consistently; the four answer ids (`problem`, `outcomes`, `out-of-scope`, `constraints`) are identical across the SKILL, `readDemoAnswers`, and the dialog merge; the `{ kind: "demo-brief", payload: { configContext } }` shape matches between Task 4 enqueue and Task 2 `planGenerative`.

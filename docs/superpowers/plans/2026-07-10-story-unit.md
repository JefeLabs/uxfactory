# `story` Design Unit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `story` design unit whose runs revise ONE story's coverage in place, with a deterministic `story-regression` gate protecting co-located stories via a baseline from the last full-denominator report.

**Architecture:** The gate stays pure — `runHtmlBatch` gains an optional `baseline: BatchReport | null` input that the batch-html command loads from the previous `report.json` before each run. For `unit === "story"` the legacy `scopeStories` denominator swap is suppressed; `render-coverage` enforces the refs as must, and the new `story-regression` check flags any non-ref story that was covered at baseline but isn't now. Worker gains `UNIT_GUIDANCE["story"]` (revise-in-place instructions); the panel adds the droplist entry and upgrades the Requirements handoff to a combined intent (refs + unit + prompt prefill).

**Tech Stack:** Pure-TS gate checks (vitest), Fastify-free; worker prompt map; React/Zustand panel.

**Spec:** `docs/superpowers/specs/2026-07-10-story-unit-design.md` — read it first; the baseline-qualification rule is the contract.

## Global Constraints

- Node ≥ 20.10, pnpm workspace, repo-root commands unless stated. Commit directly to `main`.
- Changeset: `@uxfactory/cli` minor (Task 1). Worker/panel private — no other changesets. Bridge and spec packages untouched.
- Baseline qualification (verbatim): a persisted report qualifies iff its `storyRefs` is absent AND its `unit` is absent or NOT in `COMPONENT_UNITS` AND its `unit !== "story"`. Baseline covered-set = registered story ids minus story ids extracted from the baseline's `render-coverage` findings. Non-qualifying/absent/unparseable baseline → strict mode: every non-ref story treated as baseline-covered, check reason names the mode (`"no qualifying baseline — strict mode"`).
- Story-unit semantics (verbatim): denominator swap suppressed ONLY when `unit === "story"` (legacy units byte-preserved); `unit === "story"` with missing/empty `storyRefs` → must finding on `render-coverage` (`story unit requires storyRefs`); multiple refs allowed.
- "Story covered now" predicate (shared with flow-story-coverage's convention): some snapshot has a coverCheck with `story === id && found && visible`.
- Worker guidance text: the spec §2 blockquote, verbatim.
- Panel: droplist label `Story (revise coverage)`, value `story`; `storyScopeVisible` gains an explicit `|| composerUnitType === "story"` (do NOT touch the spec package's COMPONENT_TYPE_MAPPING); handoff store field `pendingGenerate: { storyRefs: string[]; unitType?: string; prompt?: string } | null` REPLACES `pendingStoryRefs` (migrate actions, Requirements icon, Prompt consumption, and all their tests); prompt applies ONLY when the textarea is empty; consumption is once-on-mount.
- Prompt prefill template (verbatim): `Revise coverage for "<storyId>" — <actor>: <want>` (omit `<actor>: ` when actor is empty).
- Pre-existing failures unchanged: spec typecheck story-schema.test.ts:184; plugin 16 typecheck errors; CLI 3 fixture errors. Panel `.tsx` tests run from `packages/uxfactory-plugin`.

---

### Task 1: Engine — `story` unit + `story-regression` check (pure gate)

**Files:**
- Modify: `packages/uxfactory-cli/src/batch/registry.ts` (UNIT_TYPES gains `"story"`; doc comment notes story units keep the full denominator)
- Modify: `packages/uxfactory-cli/src/batch/html-checks.ts` (RunHtmlBatchInput gains `baseline?: BatchReport | null`; runner suppression + refs-required finding; new check + gate entry; export `qualifiesAsBaseline`)
- Test: `packages/uxfactory-cli/test/story-regression.test.ts` (new)

**Interfaces:**
- Consumes: existing `RunHtmlBatchInput`, `BatchReport`, `CheckResult`, `scopeStories`, `COMPONENT_UNITS`, snapshot `coverChecks` shape (see `flowStoryCoverage` ~line 309 for the covered-now idiom), and the render-coverage findings' story-id-prefixed `ref` convention (see the featureCoverage derivation ~line 734 — reuse its story-id extraction; if it's inline, extract a tiny shared helper `storyIdOfRef(ref: string): string`).
- Produces (used by Task 2): `RunHtmlBatchInput.baseline?: BatchReport | null`; `export function qualifiesAsBaseline(report: BatchReport): boolean`; check id `"story-regression"` in the rubric when `unit === "story"`.

- [ ] **Step 1: Write the failing tests.** Build fixtures with the file's existing test helpers (find the current render-coverage/flow tests — `grep -rln "runHtmlBatch" packages/uxfactory-cli/test/` — and reuse their snapshot/story fixture builders). Cases:

```ts
describe("story unit — denominator + story-regression", () => {
  it("story unit keeps the full denominator (no scopeStories swap)", () => {
    // stories S1,S2; storyRefs [S1]; unit "story"; S2 covered in snapshots.
    // render-coverage findings may include S2 gaps? NO — assert rubric ran with
    // BOTH stories: craft S2 as UNCOVERED and expect a render-coverage finding
    // for S2 (full denominator) — under legacy units the same input would not.
  });
  it("legacy unit with storyRefs still swaps (byte-preserved behavior)", () => {
    // unit "page", storyRefs [S1], S2 uncovered → NO S2 finding.
  });
  it("story unit without storyRefs → must finding on render-coverage", () => {});
  it("story-regression binds only for the story unit", () => {
    // unit "page" → check status "not-owed" with the notOwedReason.
  });
  it("lost coverage → must finding; kept coverage → pass", () => {
    // baseline report (qualifying): S2 covered (no S2 findings in its render-coverage).
    // current snapshots: S2 uncovered → finding "story S2 lost coverage".
    // sibling case: S2 covered now → status pass.
  });
  it("pre-existing gap carried without findings", () => {
    // baseline has an S3 render-coverage finding (uncovered then), S3 still uncovered → no finding.
  });
  it("no qualifying baseline → strict mode with named reason", () => {
    // baseline null AND baseline-with-storyRefs both → strict: uncovered non-ref story = finding;
    // reason contains "strict".
  });
  it("qualifiesAsBaseline: refs-scoped, component-unit, and story-unit reports do not qualify", () => {});
});
```

Write each case fully against the real fixture helpers (the sketch above names the semantics; the code must construct real snapshots/stories/baseline objects).

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run packages/uxfactory-cli/test/story-regression.test.ts` → FAIL (unknown unit / missing check).

- [ ] **Step 3: Implement.**

3a. `registry.ts`: add `"story"` to `UNIT_TYPES` (before the channel units) and extend the doc comment: `story units keep FULL story coverage for everyone and owe story-regression; storyRefs names the story under revision, not the accountability universe.`

3b. `html-checks.ts` — input + qualification + check:

```ts
/** True when a persisted report can vouch for every story's coverage. */
export function qualifiesAsBaseline(report: BatchReport): boolean {
  if (report.storyRefs !== undefined) return false;
  if (report.unit === undefined) return true;
  return report.unit !== "story" && !COMPONENT_UNITS.has(report.unit);
}

/** Non-ref stories covered at baseline must still be covered (spec 2026-07-10-story-unit §1). */
export function storyRegression(
  snapshots: RenderSnapshot[],
  stories: StorySet | null,
  storyRefs: string[] | undefined,
  baseline: BatchReport | null | undefined,
): CheckResult {
  const id = "story-regression";
  if (stories === null) {
    return { id, status: "skip", severity: "must", findings: [], reason: "no stories registered" };
  }
  const refs = new Set(storyRefs ?? []);
  const usable = baseline != null && qualifiesAsBaseline(baseline);
  const baselineUncovered = new Set<string>();
  if (usable) {
    const cov = baseline!.checks.find((c) => c.id === "render-coverage");
    for (const f of cov?.findings ?? []) {
      if (f.ref !== undefined) baselineUncovered.add(storyIdOfRef(f.ref));
    }
  }
  const coveredNow = (idStr: string): boolean =>
    snapshots.some((s) => s.coverChecks.some((c) => c.story === idStr && c.found && c.visible));
  const findings: BatchFinding[] = [];
  for (const s of stories.stories) {
    if (refs.has(s.id)) continue; // the refs are render-coverage's job
    const coveredAtBaseline = usable ? !baselineUncovered.has(s.id) : true; // strict mode
    if (coveredAtBaseline && !coveredNow(s.id)) {
      findings.push({ detail: `story ${s.id} lost coverage (covered at baseline, uncovered now)`, ref: s.id });
    }
  }
  return {
    id,
    status: findings.length > 0 ? "fail" : "pass",
    severity: "must",
    findings,
    reason: usable ? "baseline: last full-denominator report" : "no qualifying baseline — strict mode",
  };
}
```

(`storyIdOfRef` — reuse/extract the story-id-prefix parsing featureCoverage already applies to render-coverage finding refs; if inline there, extract the helper and use it in both places.)

3c. Runner changes in `runHtmlBatch`:

```ts
  // Story units keep the FULL denominator: storyRefs names the story under
  // revision; scoping the universe to it would un-enforce its neighbors.
  if (input.unit !== "story" && input.storyRefs !== undefined && input.stories !== null) {
    /* existing scopeStories block, unchanged */
  }
```

Missing-refs validation (after the scoping block):

```ts
  const storyUnitRefsMissing =
    input.unit === "story" && (input.storyRefs === undefined || input.storyRefs.length === 0);
```

— and in the render-coverage post-processing (where `unknownRefFindings` is merged), also push `{ detail: "story unit requires storyRefs — nothing to revise", ref: "storyRefs" }` and force `status: "fail"` when `storyUnitRefsMissing`.

Gate entry (after `render-coverage`):

```ts
  {
    id: "story-regression",
    severity: "must",
    run: (i) => storyRegression(i.snapshots, i.stories, i.storyRefs, i.baseline),
    bindsWhen: (i) => i.unit === "story",
    notOwedReason: "binds only for the story unit",
  },
```

Add `baseline?: BatchReport | null;` to `RunHtmlBatchInput` with a doc comment naming the loader (Task 2). Add `"story-regression"` to `HTML_GATE_THRESHOLDS` with the same scope threshold as `render-coverage` (find the thresholds map; mirror the render-coverage entry).

- [ ] **Step 4: Run tests** — new file + the existing batch/html suites: `pnpm vitest run packages/uxfactory-cli/test/story-regression.test.ts packages/uxfactory-cli/test/batch-html.test.ts packages/uxfactory-cli/test/checks-coverage-flow.test.ts` → PASS; `pnpm --filter @uxfactory/cli typecheck` → only the 3 known fixture errors.

- [ ] **Step 5: Changeset** `.changeset/cli-story-unit.md`:

```md
---
"@uxfactory/cli": minor
---

New `story` design unit: revise one story's coverage in place. The gate keeps
the full story denominator, enforces the named story to full coverage, and the
new `story-regression` check blocks any co-located story from losing coverage
relative to the last full-denominator report (strict when no baseline exists).
```

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-cli/src/batch/registry.ts packages/uxfactory-cli/src/batch/html-checks.ts packages/uxfactory-cli/test/story-regression.test.ts .changeset/cli-story-unit.md
git commit -m "feat(cli): story design unit — full-denominator gate + story-regression baseline check"
```

---

### Task 2: Engine — batch-html loads the baseline

**Files:**
- Modify: `packages/uxfactory-cli/src/commands/batch-html.ts` (read the previous `report.json` BEFORE the run; pass as `baseline`)
- Test: extend the batch-html integration test file (locate via `grep -rln "batch-html" packages/uxfactory-cli/test/`)

**Interfaces:**
- Consumes: Task 1's `RunHtmlBatchInput.baseline`.
- Produces: baseline plumbed for real runs; report writing unchanged (path `<dataDir>/batch/report.json`, batch-html.ts:192).

- [ ] **Step 1: Failing test** — in the batch-html integration suite: seed `<dataDir>/batch/report.json` with a minimal qualifying baseline (unit absent, no storyRefs, a render-coverage check whose findings mark one story uncovered), run a story-unit batch where a DIFFERENT previously-covered story is now uncovered → exit code reflects a must failure and the written report's `story-regression` check carries the lost-coverage finding; sibling assertion: with no pre-existing report file, the check reason contains "strict".

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement** — before the run (near where inputs are resolved):

```ts
  // Baseline for story-unit regression: the PREVIOUS report, read before this
  // run overwrites it. Unparseable/absent → null (the gate strict-modes).
  let baseline: BatchReport | null = null;
  try {
    baseline = JSON.parse(
      await readFile(path.join(flags.dataDir, "batch", "report.json"), "utf8"),
    ) as BatchReport;
  } catch {
    baseline = null;
  }
```

and pass `baseline` into the `runHtmlBatch` input object.

- [ ] **Step 4: Run** the batch-html suite + typecheck parity. **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/commands/batch-html.ts packages/uxfactory-cli/test/
git commit -m "feat(cli): batch-html feeds the previous report as the story-regression baseline"
```

---

### Task 3: Worker — `UNIT_GUIDANCE["story"]`

**Files:**
- Modify: `clients/uxfactory-worker/src/generative.ts` (UNIT_GUIDANCE map)
- Test: extend `clients/uxfactory-worker/test/worker.test.ts` (the suite covering UNIT_GUIDANCE / planGenerative unit scope lines — grep `UNIT_GUIDANCE`)

- [ ] **Step 1: Failing test** — planGenerative for a `generate-design` payload with `unitType: "story"` produces a user instruction containing `REVISE the named story's coverage IN PLACE` (mirror how existing unit-guidance tests assert scope lines; if none exist, assert directly on `UNIT_GUIDANCE["story"]`).
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** — add to `UNIT_GUIDANCE` (after `"user-flow"`):

```ts
  story:
    'Scope: REVISE the named story\'s coverage IN PLACE. Read design/trace.json first to ' +
    'locate the views currently covering (or meant to cover) the story; edit and extend ' +
    'THOSE screens rather than creating parallel pages. Add new views only where the ' +
    "story's acceptance criteria genuinely demand them, and connect any new view navigably " +
    "to the existing structure. Preserve every other story's covers — the gate enforces " +
    'no-regression against the previous report. Iterate the batch gate to green.',
```

- [ ] **Step 4: Run** `pnpm --filter uxfactory-worker test` + typecheck. **Step 5: Commit**

```bash
git add clients/uxfactory-worker/src/generative.ts clients/uxfactory-worker/test/worker.test.ts
git commit -m "feat(worker): story-unit guidance — revise coverage in place"
```

---

### Task 4: Panel — droplist entry + combined `pendingGenerate` handoff

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/Prompt.tsx` (UNIT_OPTIONS ~line 79; `storyScopeVisible` ~line 808 gains `|| composerUnitType === "story"`; the mount consumption effect ~line 819 migrates to `pendingGenerate` and applies unitType via `useRunsStore`'s composer setter + prompt-if-empty into the prompt state)
- Modify: `packages/uxfactory-plugin/ui/stores/app.ts` (`pendingStoryRefs` + actions → `pendingGenerate: { storyRefs: string[]; unitType?: string; prompt?: string } | null` with `setPendingGenerate` / `consumePendingGenerate`)
- Modify: `packages/uxfactory-plugin/ui/screens/Requirements.tsx` (Generate icon sets the combined intent, incl. the verbatim prompt template built from the story's `storyId`/`actor`/`want`)
- Test: update `test/stores.test.ts`, `test/screen-requirements.test.tsx`, `test/screen-prompt.test.tsx` (migrate the pendingStoryRefs tests; add unit droplist + prompt-if-empty + scope-visible cases)

**Interfaces:**
- Consumes: Task 1's unit value `"story"` (string only — panel doesn't import the engine).
- Produces: store `pendingGenerate` contract as in Global Constraints.

- [ ] **Step 1: Failing tests** (migrate + extend; from `packages/uxfactory-plugin`):

```ts
// stores.test.ts — replace the pendingStoryRefs cases
it("pendingGenerate: set/consume returns once and clears", () => {
  useAppStore.getState().setPendingGenerate({ storyRefs: ["S-01"], unitType: "story", prompt: "p" });
  expect(useAppStore.getState().consumePendingGenerate()).toEqual({ storyRefs: ["S-01"], unitType: "story", prompt: "p" });
  expect(useAppStore.getState().consumePendingGenerate()).toBeNull();
});

// screen-requirements.test.tsx — Generate assertion becomes:
expect(useAppStore.getState().pendingGenerate).toEqual({
  storyRefs: ["S-01"],
  unitType: "story",
  prompt: 'Revise coverage for "S-01" — visitor: compare pricing tiers at a glance',
}); // match the fixture's actor/want

// screen-prompt.test.tsx — extend the consumption test:
//  - unitType lands in the composer droplist state (assert the select's value or useRunsStore state)
//  - prompt prefills ONLY when the textarea was empty (two cases: empty → filled; dirty → untouched)
//  - scope UI visible when unit is "story" (the "Enforce coverage for" row renders)
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** per Files (droplist entry `{ label: "Story (revise coverage)", value: "story" }` beside the page tiers; the consumption effect applies refs → `setScopedStories`, unit → the same setter the droplist's onChange uses (~Prompt.tsx:968), prompt → the prompt state setter only when current value is `""`; Requirements' `handleGenerate` builds the template with the actor-empty rule).
- [ ] **Step 4: Run** the four panel suites + full plugin suite + typecheck parity (16 known). **Step 5: Commit**

```bash
git add packages/uxfactory-plugin/ui packages/uxfactory-plugin/test
git commit -m "feat(panel): story unit in the composer + combined Requirements generate handoff"
```

---

### Task 5: Verification + live smoke (controller)

- [ ] `pnpm -r build && pnpm test` green (~1870); `pnpm --filter @uxfactory/cli typecheck` (3 known) / bridge clean / plugin 16 known.
- [ ] Restart the stack on the new build (`uxfactory up`), reconnect uxfio-demo.
- [ ] Live smoke: enqueue a `generate-design` with `unitType: "story"`, `storyRefs: ["compare-pricing"]` for uxfio-demo (via curl, mirroring the composer payload). Watch the worker run the design loop; when the report lands, verify: `rubric` includes `story-regression`; the check's reason names baseline-or-strict; the other eight stories hold (no lost-coverage findings); exit clean.
- [ ] Reload the plugin in Figma: droplist shows "Story (revise coverage)"; Requirements Generate icon pre-sets unit+scope+prompt.
- [ ] Ledger + memory updates.

---

## Self-review notes (kept for the implementer)

- **Spec coverage:** §1 engine (T1+T2), §2 worker (T3), §3 panel (T4), §4 testing (each) + smoke (T5). Report already echoes `unit`/`storyRefs` (html-checks.ts:753/757) — the spec's "add if missing" clause is satisfied; no report-shape change needed.
- **Anchors (main @ c978dfb):** UNIT_TYPES registry.ts:30; COMPONENT_UNITS html-checks.ts:164; gate entries :632; runner :691 (scoping block :698); thresholds map — grep `HTML_GATE_THRESHOLDS`; report write batch-html.ts:192; Prompt UNIT_OPTIONS :79, storyScopeVisible :808, consumption effect :819, unit onChange :968; UNIT_GUIDANCE generative.ts:162.
- **T1 watch:** the `bindsWhen` for story-regression receives the ORIGINAL input (`entry.bindsWhen?.(input)`) while `run` receives `effective` — for story units they're identical (no swap), but pass `i.baseline` through untouched either way.
- **T4 watch:** `composerUnitType` lives in `useRunsStore` (NOT the app store); the prompt textarea state name — grep `composerPlaceholder` usage (~:1011) for the bound value/setter.

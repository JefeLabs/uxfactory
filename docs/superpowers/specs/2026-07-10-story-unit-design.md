# `story` design unit — revise a story's coverage in place

**Date:** 2026-07-10
**Status:** approved (design), pending implementation plan
**Scope:** a new design-unit type whose runs revise ONE story's coverage within the existing design, with deterministic regression protection for co-located stories. First rung of the roadmap's "design-unit + variations" phase; N-variations, per-AC generation, and a formal baseline artifact are deferred.

## Problem

Stories are realized across shared pages (uxfio-demo: one home page serves nine stories), but there is no way to say "make story S fully covered" without either regenerating whole pages (page/tier units) or hand-authoring a flow. Worse, the existing story-scoping mechanism is unsafe for this: `storyRefs` swaps the gate's entire story denominator (`scopeStories` in `html-checks.ts` ~695), so a scoped run *un-enforces* every other story on the pages it edits — the agent could satisfy S by trampling its eight neighbors and the gate would smile.

## Decisions (with user)

1. **Semantics: revise coverage in place.** A story run edits/extends the views that (should) cover S inside the existing design; it does not mint a parallel greenfield page set. New views only where S's ACs genuinely demand them, connected navigably.
2. **Regression policy: baseline no-regression.** S must reach full green (every AC covered + visible, must-severity). Every OTHER story may keep pre-existing gaps but must not LOSE coverage relative to the baseline. Absent/unusable baseline → strict mode (all stories must be green), explicitly reported.
3. **Exposure: droplist + handoff.** `story` appears in the Generate composer's unit droplist (labeled "Story (revise coverage)", pages group so the coverage-scope UI shows); the Requirements tab's per-story Generate icon pre-sets it.
4. **Mechanism: unit-aware scoping + a new `story-regression` check** (over a first-class baseline artifact, or skill self-policing): the denominator swap is suppressed only for `unit === "story"`; regression is enforced deterministically in the gate.

## Design

### 1. Engine — gate (`packages/uxfactory-cli/src/batch/`)

- `UNIT_TYPES` gains `"story"`. Doc comment: story units keep the FULL denominator; `storyRefs` names the story under revision, not the accountability universe.
- **Scoping**: in the HTML gate runner, the existing `scopeStories` denominator swap applies **only when `unit !== "story"`** — legacy behavior byte-preserved for every existing unit. For story units the full story set stays loaded.
- **`render-coverage` for the refs**: full AC coverage for each ref is must-severity (the run's purpose). An unknown ref remains a must finding (existing rule).
- **New check `story-regression`** (binds when `unit === "story"`):
  - **Baseline source**: the last persisted `.uxfactory/batch/report.json`, but only if that report's run enforced the full denominator — defined as: report's `unit` is absent or a page-tier/user-flow unit AND its run had no `storyRefs` scoping. The report must therefore echo `unit` and `storyRefs`; if `BatchReport` doesn't already record them, add them (additive fields).
  - **Baseline covered-set** = registered stories minus stories named in coverage findings of that baseline report.
  - **Verdict**: any non-ref story in the baseline covered-set that now lacks visible coverage → must finding ("story X lost coverage"). Non-ref stories outside the covered-set (pre-existing gaps) are carried without findings.
  - **Strict fallback**: no report, or no qualifying report → every non-ref story is treated as baseline-covered (i.e., all stories must be green), with the mode named in the check's reason.
  - Only full-denominator runs refresh the baseline (story-unit reports never qualify as baselines) — conservative, avoids drift across consecutive story runs.
- **Validation**: `unit === "story"` with missing/empty `storyRefs` → setup-severity finding on the registry check (a story run without its story is meaningless). Multiple refs are allowed (revise several stories at once); the panel sends one.
- All other checks (tokens, copy-conformance, a11y, flow-story-coverage, style) bind exactly as today.
- Changeset: `@uxfactory/cli` minor.

### 2. Worker (`clients/uxfactory-worker/src/generative.ts`)

`UNIT_GUIDANCE["story"]` (new entry, joins the existing map):

> Scope: REVISE the named story's coverage IN PLACE. Read design/trace.json first to locate the views currently covering (or meant to cover) the story; edit and extend THOSE screens rather than creating parallel pages. Add new views only where the story's acceptance criteria genuinely demand them, and connect any new view navigably to the existing structure. Preserve every other story's covers — the gate enforces no-regression against the previous report. Iterate the batch gate to green.

Viewports: platform-derived like page tiers (no `CHANNEL_CANVAS` entry). The registry stamping already carries `unit` + `storyRefs`; no wire changes.

### 3. Panel (`packages/uxfactory-plugin/ui/`)

- `UNIT_OPTIONS` (Prompt.tsx) gains `{ label: "Story (revise coverage)", value: "story" }`, placed with the page-tier entries so `storyScopeVisible` (the coverage-scope UI gate) includes it — verify that visibility predicate includes the new value.
- **Requirements handoff grows into a combined intent**: the store's pending handoff becomes `pendingGenerate: { storyRefs: string[]; unitType?: string; prompt?: string } | null` (superseding the bare `pendingStoryRefs` — migrate the existing set/consume actions and their consumers/tests). The Requirements Generate icon sets `{ storyRefs: [id], unitType: "story", prompt: 'Revise coverage for "<storyId>" — <actor>: <want>' }`.
- **Prompt consumption on mount** (extends the existing consume-once effect): apply `storyRefs` → `scopedStories` (as today); `unitType` → the composer's unit droplist state; `prompt` → the prompt textarea ONLY when the textarea is currently empty (never clobber a draft).

### 4. Testing

- **Engine**: denominator-suppression (story unit keeps full set; legacy units still swap); `story-regression` truth table (lost coverage → must; kept coverage → pass; pre-existing gap → carried, no finding; no qualifying baseline → strict with named reason; story-unit reports don't qualify as baselines); refs-required validation; report echoes `unit`/`storyRefs`.
- **Worker**: `UNIT_GUIDANCE["story"]` present with the revise-in-place instructions; registry stamping unchanged.
- **Panel**: droplist entry renders; combined handoff (refs + unit + prompt) set by the Requirements icon; consume-once semantics; prompt only-if-empty rule; scope UI visible for the story unit.
- **Live smoke** (controller): story-generate `compare-pricing` on uxfio-demo; verify the gate report shows story-regression binding and the other eight stories held.

## Out of scope

- N variations per unit; per-AC generation; a formal baseline artifact; JIRA/Linear; Checks-tab surfacing of story-regression results (it appears in the report like any check).

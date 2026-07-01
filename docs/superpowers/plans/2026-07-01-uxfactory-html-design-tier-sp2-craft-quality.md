# HTML Design Tier — SP2 (Craft-Quality System) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the correctness-vs-craft gap — drive the HTML tier from "passes gates but plain" to "production-quality" via authoring uplift + an independent craft judge that iterates the design to a craft bar.

**Architecture:** Two levers, entirely in the worker/skill/agent layer (the engine stays deterministic + LLM-free): (A) `skill/design` gains a real design-system starter + craft direction + "open your renders"; (B) after `uxfactory batch` is deterministically green, an independent craft judge scores the screenshots against an 8-dimension rubric and emits a structured `craft-report.json`; the loop revises until green AND craft ≥ bar, or `maxIterations` (a soft gate, honest best-effort at budget).

**Tech Stack:** TypeScript (ESM/NodeNext) in `clients/uxfactory-worker`; markdown skills under `skill/`; vitest. Spec: `docs/superpowers/specs/2026-06-30-uxfactory-html-design-tier-sp2-craft-quality-design.md`.

## Global Constraints

- **Engine untouched & LLM-free:** NO changes to `packages/uxfactory-{cli,gate,spec,bridge,plugin}` *gates*. The `craft-report` validator lives in the **worker** (`clients/uxfactory-worker`). Craft adds no engine gate. (Plugin display in Task 6 is a render-only tweak, no engine logic.)
- **Deterministic floor preserved:** SP1's gates (render-coverage · a11y · contrast · token-conformance) remain the hard pass/fail; craft never relaxes them and runs only *after* deterministic-green.
- **Craft is a SOFT gate:** it drives iteration while craft < bar and budget remains, but at `maxIterations` it STOPS and surfaces "green; craft best-effort `overall:N/5` + open findings" — never a false pass, never an infinite loop.
- **Craft bar (pinned):** `CRAFT_BAR = 4` — pass = every dimension score ≥ 4 AND overall ≥ 4 (scores are 1–5 integers). The *consumer* computes pass from scores + the pinned bar; it does not trust the judge's self-reported `pass`.
- **Honest labeling:** every craft verdict carries `reliability: "best-effort"` (subjective).
- **cc-invariant** on new/edited skills; `sk-…` masking; secret-free rubric. **Never `git add -A`** — stage only the files a task names. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Work on `main`.
- **TS rules:** `.js` import specifiers, `import type` for type-only imports, `verbatimModuleSyntax`.
- **Test commands (from repo root):** single file → `pnpm exec vitest run <path>`; worker typecheck → `pnpm --filter uxfactory-worker typecheck`.

## File Structure

- `clients/uxfactory-worker/src/craft-report.ts` — **new.** `CraftReport` types + `CRAFT_BAR` + `craftPasses()` + never-throws `validateCraftReport`/`readCraftReport` (mirrors SP1's `packages/uxfactory-cli/src/batch/trace.ts`).
- `skill/craft-review/SKILL.md` — **new.** The independent judge's adversarial brief + the 8-dimension rubric + the exact `craft-report.json` output contract.
- `skill/design/SKILL.md` — **modify.** Add the design-system starter, craft direction, "open your renders", and (Task 5) the craft-judge dispatch + soft-gate loop step.
- `clients/uxfactory-worker/src/generative.ts` — **modify (Task 5b only, if the spike selects the fallback).** A `craft-review` generative kind.
- `clients/uxfactory-worker/src/skills.ts` — **modify (Task 5b only).** Add `'craft-review'` to `SkillName`.
- `packages/uxfactory-plugin/src/pipeline-view.ts` — **modify (Task 6).** Render the `craft` phase + score in the design feed.
- Tests: `clients/uxfactory-worker/test/{craft-report,craft-review-skill}.test.ts`; extend `test/design-skill.test.ts` + `packages/uxfactory-cli/test/skill-design.test.ts`; `packages/uxfactory-plugin/test/pipeline-view.test.ts`.

---

### Task 1: `craft-report.ts` — structured craft verdict + validator (worker)

**Files:**
- Create: `clients/uxfactory-worker/src/craft-report.ts`
- Test: `clients/uxfactory-worker/test/craft-report.test.ts`

**Interfaces:**
- Produces: types `CraftFinding`, `CraftDimension`, `CraftDimensionName`, `CraftReport`; const `CRAFT_BAR = 4`; `CRAFT_DIMENSIONS` (the 8 names); `craftPasses(report: CraftReport): boolean`; `validateCraftReport(raw: unknown): { ok: true; report: CraftReport } | { ok: false; message: string }`; `readCraftReport(absPath: string): Promise<...>`.

- [ ] **Step 1: Write the failing test**

```ts
// clients/uxfactory-worker/test/craft-report.test.ts
import { describe, it, expect } from 'vitest';
import { validateCraftReport, craftPasses, CRAFT_DIMENSIONS } from '../src/craft-report.js';

function fullDims(score: number) {
  return CRAFT_DIMENSIONS.map((name) => ({ name, score, findings: [] as unknown[] }));
}
const VALID = {
  version: 1, overall: 4, pass: true, reliability: 'best-effort',
  dimensions: CRAFT_DIMENSIONS.map((name) => ({
    name, score: 4,
    findings: name === 'hierarchy'
      ? [{ screen: 'checkout-success', issue: 'flat', fix: 'raise the heading, add a filled primary button' }]
      : [],
  })),
};

describe('validateCraftReport', () => {
  it('accepts a well-formed report covering all 8 dimensions', () => {
    const r = validateCraftReport(VALID);
    expect(r.ok).toBe(true);
  });
  it('rejects a non-1 version', () => {
    expect(validateCraftReport({ ...VALID, version: 2 }).ok).toBe(false);
  });
  it('rejects an out-of-range score', () => {
    const bad = structuredClone(VALID); bad.dimensions[0]!.score = 6;
    expect(validateCraftReport(bad).ok).toBe(false);
  });
  it('rejects a missing dimension', () => {
    const bad = structuredClone(VALID); bad.dimensions = bad.dimensions.slice(1);
    expect(validateCraftReport(bad).ok).toBe(false);
  });
  it('rejects a bad reliability label', () => {
    expect(validateCraftReport({ ...VALID, reliability: 'exact' }).ok).toBe(false);
  });
  it('rejects a finding missing its fix', () => {
    const bad = structuredClone(VALID); (bad.dimensions[0]!.findings[0] as Record<string, unknown>) = { screen: 'x', issue: 'y' };
    expect(validateCraftReport(bad).ok).toBe(false);
  });
});

describe('craftPasses (consumer computes pass from scores + the pinned bar, ignoring self-reported pass)', () => {
  it('passes only when every dimension >= 4 and overall >= 4', () => {
    const r = validateCraftReport({ ...VALID, dimensions: fullDims(4), overall: 4, pass: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(craftPasses(r.report)).toBe(true); // self-reported pass:false is IGNORED
  });
  it('fails when any dimension is below the bar even if overall is high', () => {
    const dims = fullDims(5); dims[2]!.score = 3;
    const r = validateCraftReport({ ...VALID, dimensions: dims, overall: 5, pass: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(craftPasses(r.report)).toBe(false); // self-reported pass:true is IGNORED
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run clients/uxfactory-worker/test/craft-report.test.ts`
Expected: FAIL — `Cannot find module '../src/craft-report.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// clients/uxfactory-worker/src/craft-report.ts
import { readFile } from 'node:fs/promises';

/** The 8 craft dimensions the judge scores (spec §6). */
export const CRAFT_DIMENSIONS = [
  'hierarchy', 'typography', 'spacing', 'color',
  'components', 'depth', 'brand-fit', 'production-readiness',
] as const;
export type CraftDimensionName = (typeof CRAFT_DIMENSIONS)[number];

/** The pinned craft bar: a dimension/overall at or above this is "good enough". */
export const CRAFT_BAR = 4;

/** One actionable craft issue, pinned to a screen, with a concrete fix. */
export interface CraftFinding {
  screen: string;
  issue: string;
  fix: string;
}

/** One dimension's score (1–5) + its findings. */
export interface CraftDimension {
  name: CraftDimensionName;
  score: number;
  findings: CraftFinding[];
}

/** The judge's structured verdict (craft-report.json). Scores are subjective; the SHAPE is validated. */
export interface CraftReport {
  version: 1;
  overall: number;
  pass: boolean; // the judge's self-report — NOT trusted by consumers; use craftPasses().
  reliability: 'best-effort';
  dimensions: CraftDimension[];
}

/**
 * Whether the design clears the pinned bar — computed from the SCORES, not the
 * judge's self-reported `pass` (rigor: the bar is the consumer's, not the judge's).
 */
export function craftPasses(report: CraftReport): boolean {
  return report.overall >= CRAFT_BAR && report.dimensions.every((d) => d.score >= CRAFT_BAR);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isScore(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
}
const DIMENSION_SET = new Set<string>(CRAFT_DIMENSIONS);

/** Pure structural validation of a parsed craft report. Never throws. */
export function validateCraftReport(
  raw: unknown,
): { ok: true; report: CraftReport } | { ok: false; message: string } {
  if (!isObject(raw)) return { ok: false, message: 'craft-report must be a JSON object' };
  if (raw['version'] !== 1) return { ok: false, message: 'craft-report version must be 1' };
  if (!isScore(raw['overall'])) return { ok: false, message: 'craft-report.overall must be an integer 1–5' };
  if (typeof raw['pass'] !== 'boolean') return { ok: false, message: 'craft-report.pass must be a boolean' };
  if (raw['reliability'] !== 'best-effort')
    return { ok: false, message: 'craft-report.reliability must be "best-effort"' };
  if (!Array.isArray(raw['dimensions']))
    return { ok: false, message: 'craft-report.dimensions must be an array' };

  const seen = new Set<string>();
  for (const [i, dim] of raw['dimensions'].entries()) {
    const at = `craft-report.dimensions[${i}]`;
    if (!isObject(dim)) return { ok: false, message: `${at} must be an object` };
    if (typeof dim['name'] !== 'string' || !DIMENSION_SET.has(dim['name']))
      return { ok: false, message: `${at}.name must be one of ${CRAFT_DIMENSIONS.join(', ')}` };
    if (seen.has(dim['name'])) return { ok: false, message: `${at}.name "${dim['name']}" is duplicated` };
    seen.add(dim['name']);
    if (!isScore(dim['score'])) return { ok: false, message: `${at}.score must be an integer 1–5` };
    if (!Array.isArray(dim['findings'])) return { ok: false, message: `${at}.findings must be an array` };
    for (const [j, f] of dim['findings'].entries()) {
      const fat = `${at}.findings[${j}]`;
      if (!isObject(f)) return { ok: false, message: `${fat} must be an object` };
      for (const key of ['screen', 'issue', 'fix'] as const) {
        if (typeof f[key] !== 'string' || f[key] === '')
          return { ok: false, message: `${fat}.${key} must be a non-empty string` };
      }
    }
  }
  if (seen.size !== CRAFT_DIMENSIONS.length)
    return { ok: false, message: `craft-report must score all ${CRAFT_DIMENSIONS.length} dimensions (missing: ${CRAFT_DIMENSIONS.filter((d) => !seen.has(d)).join(', ')})` };

  return { ok: true, report: raw as unknown as CraftReport };
}

/** Read + JSON-parse + validate a craft-report file. Never throws on bad input. */
export async function readCraftReport(
  absPath: string,
): Promise<{ ok: true; report: CraftReport } | { ok: false; message: string }> {
  let text: string;
  try {
    text = await readFile(absPath, 'utf8');
  } catch {
    return { ok: false, message: `cannot read craft-report ${absPath}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return { ok: false, message: `invalid JSON in ${absPath}: ${(err as Error).message}` };
  }
  return validateCraftReport(parsed);
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `pnpm exec vitest run clients/uxfactory-worker/test/craft-report.test.ts && pnpm --filter uxfactory-worker typecheck`
Expected: PASS (8 tests); 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add clients/uxfactory-worker/src/craft-report.ts clients/uxfactory-worker/test/craft-report.test.ts
git commit -m "feat(worker): structured craft-report verdict + validator (SP2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `skill/craft-review/SKILL.md` — the independent craft judge

**Files:**
- Create: `skill/craft-review/SKILL.md`
- Test: `clients/uxfactory-worker/test/craft-review-skill.test.ts` (binds the skill's example to the real `validateCraftReport`, so the doc can't drift from the schema)

**Interfaces:**
- Consumes: `validateCraftReport`, `CRAFT_DIMENSIONS` (Task 1) in the test.
- Produces: the judge brief the authoring loop hands a fresh judge context; its output contract is `craft-report.json` validated by Task 1.

- [ ] **Step 1: Write the failing test**

```ts
// clients/uxfactory-worker/test/craft-review-skill.test.ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCraftReport, CRAFT_DIMENSIONS } from '../src/craft-report.js';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../skill/craft-review/SKILL.md');

describe('skill/craft-review SKILL.md stays in sync with the craft-report schema', () => {
  it('its embedded craft-report example validates', async () => {
    const md = await readFile(SKILL, 'utf8');
    const m = /<!-- craft-report-example-start -->\s*```json\s*([\s\S]*?)```\s*<!-- craft-report-example-end -->/.exec(md);
    expect(m, 'SKILL.md must contain a marked craft-report example').not.toBeNull();
    expect(validateCraftReport(JSON.parse(m![1]!)).ok).toBe(true);
  });
  it('documents every rubric dimension + the best-effort + adversarial framing', async () => {
    const md = await readFile(SKILL, 'utf8');
    for (const d of CRAFT_DIMENSIONS) expect(md, `must mention dimension ${d}`).toContain(d);
    for (const s of ['best-effort', 'craft-report.json', 'production-quality']) expect(md).toContain(s);
  });
  it('is cc-invariant: no cloud-deploy mentions', async () => {
    const md = await readFile(SKILL, 'utf8');
    for (const re of [/agentcore/i, /runpod/i, /\bcloud\b/i]) expect(md).not.toMatch(re);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run clients/uxfactory-worker/test/craft-review-skill.test.ts`
Expected: FAIL — SKILL.md missing.

- [ ] **Step 3: Write `skill/craft-review/SKILL.md`**

````markdown
---
name: uxfactory-craft-review
description: "Independent craft judge for UXFactory HTML-tier renders. You are given ONLY the rendered screenshots of a set of screens + the project's brand/style + this rubric — NOT the authoring context. Score the design's CRAFT (is it production-quality, or merely correct?) across 8 dimensions and emit a structured craft-report.json. Be adversarial: the deterministic gates already proved it's accessible and on-token; your job is to find what still looks unfinished. Use ONLY as the judge step of the design loop; do NOT author or edit the HTML."
compatibility: "Vision judgment is yours (the agent, multimodal). The engine stays LLM-free; you produce a best-effort, honest verdict — craft is subjective."
---

# UXFactory — Craft Judge (independent, best-effort)

You are an **independent** design-craft judge. You did NOT author these screens. You are given the **rendered screenshots** (`.uxfactory/batch/previews/*.png`), the project's **brand/style** (from `uxfactory.classification.json`: category · industry · age · style), and the rubric below. The deterministic gates already passed — so DO NOT re-check accessibility, contrast, or tokens. Your only question: **does this look production-quality, or just correct?** Be adversarial — name what still reads as a wireframe.

## Step 1 — Look

Open every screenshot in `.uxfactory/batch/previews/` (use the Read tool — you are multimodal). Read `uxfactory.classification.json` for the intended brand/style.

## Step 2 — Score each dimension 1–5

| Dimension | 5 = production-quality | 1 = wireframe |
| --- | --- | --- |
| **hierarchy** | clear primary/secondary/tertiary; the eye is led | flat; everything the same weight |
| **typography** | a real type scale, sane measure/leading | default system flatness |
| **spacing** | consistent rhythm, intentional grouping | arbitrary gaps |
| **color** | harmonious, purposeful (beyond "passes contrast") | a few flat swatches |
| **components** | affordances read (primary = filled button) | a link pretending to be a button |
| **depth** | elevation/layering where it aids structure | everything on one plane |
| **brand-fit** | matches the category/industry/age/style | generic, off-brand |
| **production-readiness** | would ship in a real product | a demo |

A `5` is rare; a plain-but-correct screen is a `2`. Hold the bar high.

## Step 3 — Emit `craft-report.json` (write it to the project root)

For every dimension below the bar, give a SPECIFIC finding: the `screen`, the `issue` (what's wrong), and a concrete `fix` (what to change). `overall` is your holistic 1–5. `reliability` is always `"best-effort"` (craft is subjective — be honest). Set `pass` to your judgment, but know the loop recomputes the real pass from the scores against a pinned bar.

<!-- craft-report-example-start -->
```json
{
  "version": 1,
  "overall": 3,
  "pass": false,
  "reliability": "best-effort",
  "dimensions": [
    { "name": "hierarchy", "score": 2, "findings": [ { "screen": "checkout-success", "issue": "the confirmation card competes with nothing — no primary emphasis, no detail tiering", "fix": "raise the heading to a display size, demote the receipt line to a muted caption, add one clear filled primary action" } ] },
    { "name": "typography", "score": 3, "findings": [ { "screen": "checkout-success", "issue": "single system font size throughout; no scale", "fix": "introduce a 3-step type scale (display/body/caption) with weight contrast" } ] },
    { "name": "spacing", "score": 3, "findings": [] },
    { "name": "color", "score": 3, "findings": [] },
    { "name": "components", "score": 2, "findings": [ { "screen": "checkout-success", "issue": "the primary action is an underlined text link, not a button", "fix": "make it a filled button with padding, radius, and hover affordance" } ] },
    { "name": "depth", "score": 2, "findings": [ { "screen": "cart-populated", "issue": "flat outlines only; no elevation to separate the summary from the list", "fix": "add a subtle shadow token to the order-summary card" } ] },
    { "name": "brand-fit", "score": 3, "findings": [] },
    { "name": "production-readiness", "score": 2, "findings": [ { "screen": "checkout-success", "issue": "reads as a wireframe, not a shippable checkout", "fix": "apply the hierarchy/typography/component fixes above together" } ] }
  ]
}
```
<!-- craft-report-example-end -->

## Report

Reply with the `overall` score, `pass`, and the count of below-bar dimensions. Keep it short and secret-free (never echo keys/tokens). The `craft-report.json` file is the machine-readable verdict the loop acts on.
````

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run clients/uxfactory-worker/test/craft-review-skill.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add skill/craft-review/SKILL.md clients/uxfactory-worker/test/craft-review-skill.test.ts
git commit -m "feat(skill): craft-review independent judge rubric (SP2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `skill/design/SKILL.md` — authoring uplift (raise the ceiling)

**Files:**
- Modify: `skill/design/SKILL.md` (extend Step 1/2 with the design-system starter + craft direction; add a "look at your renders" step)
- Test: extend `test/design-skill.test.ts` (repo root) and `packages/uxfactory-cli/test/skill-design.test.ts`

**Interfaces:**
- Produces: richer authoring guidance the agent follows so screens have hierarchy/type/spacing/depth; keeps the SP1 loop/trace/gate content intact. (The judge dispatch is added in Task 5, not here.)

- [ ] **Step 1: Write the failing test (append to `test/design-skill.test.ts`)**

```ts
it('carries the craft-quality authoring uplift (design system + craft direction)', async () => {
  const content = await readFile(skillPath, 'utf8');
  // a real design system, not just colors
  for (const s of ['type scale', 'spacing', 'elevation', 'radi']) expect(content).toContain(s);
  // craft direction + brand-fit + look-at-renders
  expect(content).toContain('production-quality');
  expect(content).toContain('uxfactory.classification.json'); // brand/style source
  expect(content).toMatch(/open|view|look at/i);              // review your own renders
  expect(content).toContain('.uxfactory/batch/previews');     // where the renders are
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run test/design-skill.test.ts`
Expected: FAIL — the new assertions.

- [ ] **Step 3: Edit `skill/design/SKILL.md`**

Extend the tokens step (Step 2) so the agent authors a **real design system**, and add a craft section. Insert this block into Step 2 (after the existing color-token guidance) and add a new "Step 2b — Craft" subsection:

```markdown
Author `design/tokens.ds.json` colors, but design with a **full system**, not just swatches — the deterministic gate only checks colors, but a flat, correct screen is not the goal:

- **Type scale** — a display / heading / body / caption ladder with real size + weight + line-height contrast (not one system-font size everywhere).
- **Spacing rhythm** — a consistent spacing scale (e.g. 4/8/12/16/24/32) used for all gaps and padding; intentional grouping, not arbitrary values.
- **Elevation** — shadow tokens to layer surfaces where it aids structure (cards, sheets, summaries).
- **Radii** — a small radius scale for surfaces and controls.
- **Real components** — a primary action is a **filled button** (padding, radius, affordance), NOT an underlined text link; inputs look editable; cards read as surfaces.

## Step 2b — Craft direction (author for production quality, not just green)

The four deterministic gates prove your screens are *correct* (covered, accessible, on-contrast, on-token). They do **not** prove they are *good*. Author for **production-quality craft**: clear visual hierarchy, the type + spacing scales above, genuine component affordance, depth via elevation/whitespace, and **brand/style fit** — read `uxfactory.classification.json` (category · industry · age · style) and make the design *feel* like that product, not a generic demo.

Before you consider the loop done, **open your own rendered screenshots** in `.uxfactory/batch/previews/*.png` (you are multimodal — use the Read tool) and honestly assess them against the craft direction above. Authoring blind is how screens end up plain.
```

- [ ] **Step 4: Mirror the assertion in the CLI-side skill test**

Add the same craft-content assertions to `packages/uxfactory-cli/test/skill-design.test.ts` (it reads the same SKILL.md via `../../../skill/design/SKILL.md`), so both skill tests stay in sync.

- [ ] **Step 5: Run both skill tests**

Run: `pnpm exec vitest run test/design-skill.test.ts packages/uxfactory-cli/test/skill-design.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skill/design/SKILL.md test/design-skill.test.ts packages/uxfactory-cli/test/skill-design.test.ts
git commit -m "feat(skill): design authoring uplift — real design system + craft direction (SP2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Mechanism feasibility spike (live probe + decision) — NOT TDD

**Deliverable:** a decision recorded in the plan/ledger: does the worker-spawned autonomous agent expose a usable **subagent/Task facility** (with the Read tool for the PNGs and permission to run it)? This selects Task 5a (in-session judge subagent) vs Task 5b (worker-orchestrated `craft-review` kind). Both satisfy the same contract (spec §5).

- [ ] **Step 1: Probe.** With the bridge + worker running (reuse the SP1 live setup: `uxfactory bridge`; worker `tsx src/main.ts` from a git project with the SP1 env — the worker now self-provisions PATH + `PLAYWRIGHT_BROWSERS_PATH`), enqueue a `generate-design` request whose skill (temporarily, in the spike branch) instructs the agent, after green, to **dispatch a subagent** that reads a screenshot and writes a trivial `craft-report.json`. Observe the worker/agent transcript: did the subagent dispatch succeed (Task tool present + permitted + could Read the PNG), or was it blocked (as `Bash`/settings were in the SP1 run)?
- [ ] **Step 2: Decide.** If the subagent dispatch works → **Task 5a**. If blocked → **Task 5b**. Record: `SP2 mechanism = <5a|5b>` with the evidence (the transcript line proving Task available/blocked).
- [ ] **Step 3: No commit** (spike only). Discard the temporary probe skill edit.

> Controller note: this costs tokens (a live agent run). Run it before dispatching Task 5. If you cannot run a live probe, default to **5b (worker-orchestrated)** — it depends only on the worker, not on an uncertain sandbox capability, and is the lower-risk mechanism.

---

### Task 5: The craft judge mechanism + soft-gate loop (build the variant Task 4 selected)

**Files (5a):** Modify `skill/design/SKILL.md` (add the judge-dispatch + loop step).
**Files (5b):** Modify `clients/uxfactory-worker/src/generative.ts` (+`craft-review` kind), `clients/uxfactory-worker/src/skills.ts` (+`'craft-review'` to `SkillName`), `skill/design/SKILL.md` (invoke the worker judge step); Test: `clients/uxfactory-worker/test/worker.test.ts` (dispatch routing).

**Interfaces:**
- Consumes: `skill/craft-review` (Task 2), `craft-report.json` contract + `craftPasses` semantics (Task 1), the SP1 loop.
- Produces: a loop that, after deterministic-green, obtains an independent `craft-report.json`, computes pass against `CRAFT_BAR`, and revises until green AND craft-pass or `maxIterations` — emitting `UXF::PROGRESS {"phase":"craft",...}`.

**Variant 5a — in-session judge subagent (if the spike passed):**

- [ ] **Step 1:** Add to `skill/design/SKILL.md` a new step after the gate reaches exit 0:

```markdown
## Step 4b — Craft judge (independent, after the gate is green)

Once `uxfactory batch` is green (exit 0), get an **independent** craft verdict — do NOT grade your own work:

1. **Dispatch a fresh judge subagent** whose brief is `skill/craft-review` (an independent craft judge), giving it ONLY the screenshot paths (`.uxfactory/batch/previews/*.png`) + `uxfactory.classification.json`. It writes `craft-report.json` to the project root.
2. **Read `craft-report.json`.** Compute the real pass: every dimension `score >= 4` AND `overall >= 4`. (Do not trust the report's own `pass`.)
3. **If below the bar:** act on the findings — revise the HTML/tokens to fix the specific `issue`s (hierarchy, typography, components, depth, …). Re-run `uxfactory batch` (must stay green) and re-dispatch the judge. This counts against `maxIterations`.
4. **Stop** when green AND craft-pass, OR when `maxIterations` is spent — then surface honestly: "green; craft best-effort `overall:N/5`, M open findings." NEVER claim craft-pass you didn't reach.

Emit `UXF::PROGRESS {"iter":<n>,"phase":"craft","gate":null,"status":"pass"|"fail"|null,"findings":<count>,"note":"craft overall N/5"}` at each craft step.
```

- [ ] **Step 2:** No new automated test (skill prose); the doc↔schema bind (Task 2) + the live run (Task 7) cover it. Extend `test/design-skill.test.ts` to assert the craft-judge step is present: `expect(content).toContain('craft-report.json')` and `expect(content).toMatch(/independent|fresh judge|subagent/i)`.

- [ ] **Step 3: Commit** (`skill/design/SKILL.md` + the test).

**Variant 5b — worker-orchestrated `craft-review` kind (if the spike blocked subagents):**

- [ ] **Step 1 (test-first):** In `clients/uxfactory-worker/test/worker.test.ts`, add a case asserting a `craft-review` request routes to the craft-review skill (mirror the existing `canvas-review` routing test): the generative branch for `kind:'craft-review'` returns `{ systemPrompt: loadSkill('craft-review'), user: <the review instruction> }`.

- [ ] **Step 2:** Add `'craft-review'` to `SkillName` in `clients/uxfactory-worker/src/skills.ts`.

- [ ] **Step 3:** In `clients/uxfactory-worker/src/generative.ts`, add the kind (mirrors `canvas-review` at ~505):

```ts
  if (req.kind === 'craft-review') {
    return {
      systemPrompt: loadSkill('craft-review'),
      user:
        'Independently judge the CRAFT of the rendered screens in .uxfactory/batch/previews/*.png ' +
        'against the rubric, using uxfactory.classification.json for brand/style. Write craft-report.json ' +
        'to the project root. The deterministic gates already passed — judge production-quality only.',
      progress: true,
    };
  }
```

- [ ] **Step 4: The outer craft loop (worker-orchestrated, STATELESS).** No persistent agent state — the verdict persists on disk in `craft-report.json`, so every iteration is a fresh session. Implement a small orchestrator (in `main.ts`/`generative.ts`) around the two kinds:
  1. Dispatch `generate-design` → agent authors + gates to deterministic green (SP1 loop). If a `craft-report.json` already exists in the project root, the `generate-design` user prompt appends: "a prior craft review is in craft-report.json — fix its findings before you finish."
  2. Dispatch `craft-review` → judge writes `craft-report.json`.
  3. Worker reads it (`readCraftReport`) + computes `craftPasses(report)`. If it passes OR the shared `maxIterations` (from `uxfactory.batch.json`) is spent → STOP (surface green + craft `overall:N/5` honestly). Else → loop to (1).
  This is heavier than 5a (it re-runs a full author session per craft iteration), so 5a is strongly preferred; 5b is the fallback only if the spike proves subagents unavailable. Add a focused test that the outer loop stops on `craftPasses` and on the budget (fake dispatch + a fixture `craft-report.json`).

- [ ] **Step 5:** Run `pnpm exec vitest run clients/uxfactory-worker/test/worker.test.ts && pnpm --filter uxfactory-worker typecheck`; commit the worker + skill changes.

---

### Task 6: Plugin — surface craft phase + score in the design feed (minimal)

**Files:**
- Modify: `packages/uxfactory-plugin/src/pipeline-view.ts` (the design feed already renders `UXF::PROGRESS` phase/status; make a `phase:"craft"` event show its `overall N/5` note prominently)
- Test: `packages/uxfactory-plugin/test/pipeline-view.test.ts`

**Interfaces:**
- Consumes: the generic progress events (`phase`, `note`) already routed to the design feed (SP1). No cross-package type import — the craft score arrives in the event `note`/fields as forwarded strings.

- [ ] **Step 1: Write the failing test** — a `renderDesignFeed`/`routeDesignEvent` case: a progress event `{phase:"craft", status:"fail", findings:3, note:"craft overall 3/5"}` renders a feed line containing `craft` and `3/5` (assert the craft note surfaces, distinct from the deterministic-gate phases).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — in `renderDesignFeed` (or the phase-label map), give `phase:"craft"` a visible label + surface its `note` (the `overall N/5`). Keep it a render-only change; the routing already delivers the event.

- [ ] **Step 4: Run the plugin tests** — `pnpm exec vitest run packages/uxfactory-plugin/test/pipeline-view.test.ts` (must stay green, incl. the SP1 design-feed cases) + `pnpm --filter @uxfactory/plugin typecheck`.

- [ ] **Step 5: Commit.**

---

### Task 7: Final live paid run — confirm the quality lift (NOT TDD)

**Deliverable:** evidence that SP2 visibly improves output vs the SP1 baseline.

- [ ] **Step 1:** Rebuild (`pnpm -r build`), start the bridge + worker (worker self-provisions PATH + `PLAYWRIGHT_BROWSERS_PATH` now), reuse the `live-project` (clear `design/` to just `acceptance-criteria.json`).
- [ ] **Step 2:** Enqueue `generate-design`. Watch `UXF::PROGRESS` for a `phase:"craft"` line and iterations that act on craft findings.
- [ ] **Step 3:** Confirm: `craft-report.json` written + structurally valid; the loop revised on craft; final screenshots (`.uxfactory/batch/previews/*.png`) are **visibly better** than the SP1 `checkout-success` baseline (real hierarchy/typography/filled buttons/depth). Copy the new renders next to the SP1 ones for side-by-side.
- [ ] **Step 4:** Record the outcome (green + craft `overall`, iteration count, before/after) in the ledger. Stop the live processes.

---

## Final Verification (after all tasks)

- [ ] `pnpm test` — all green (new craft-report + skill tests + unchanged SP1/worker/plugin suites).
- [ ] `pnpm -r typecheck` — 0 errors.
- [ ] Boundary: `git diff --stat <sp2-base>..HEAD -- packages/uxfactory-cli packages/uxfactory-gate packages/uxfactory-spec` shows **no gate changes** (engine untouched; craft is worker/skill only).
- [ ] Broad whole-branch review (superpowers:requesting-code-review) over the SP2 range.

## Self-review notes (plan vs. spec)

- **Spec coverage:** §4 authoring uplift → Task 3; §5 judge + mechanism → Tasks 4+5; §6 rubric + structured verdict → Tasks 1+2; §7 soft-gate loop → Task 5; §8 components (craft-report in worker, skills, plugin) → Tasks 1/2/3/5/6; §10 testing → each task's tests + Task 7 live run; §9 invariants → Global Constraints.
- **Type consistency:** `CraftReport`/`CraftDimension`/`CraftFinding`/`CRAFT_DIMENSIONS`/`CRAFT_BAR`/`craftPasses`/`validateCraftReport` defined in Task 1, consumed by Tasks 2 (test) + 5; the `craft-report.json` shape is identical in Task 1's types, Task 2's skill example, and Task 5's loop.
- **Conditional task:** Task 5 has two fully-specified variants; Task 4 selects one. Both honor the spec §5 contract (independent, unbiased craft verdict fed back into the loop).
- **Out of scope (deferred):** engine craft gates; variations/design-unit; SP3 Figma; human craft-approval UI.

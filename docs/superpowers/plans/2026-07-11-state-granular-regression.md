# State-Granular Story-Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `story-regression` protects neighbors per story×state — a lost `error` state is caught by story runs even when a `success` cover survives.

**Architecture:** `storyRegression` reuses the real `renderCoverage` over the non-ref story set to compute `missingNow`, normalizes both current and baseline findings to `story/state` keys (viewport suffix stripped, page-path refs and unregistered prefixes filtered), and flags keys missing now that weren't missing at baseline. The story-granular `coveredNow` predicate is deleted; strict mode becomes state-granular full neighbor coverage.

**Tech Stack:** Pure-TS gate check (vitest). Engine-only.

**Spec:** `docs/superpowers/specs/2026-07-11-state-granular-regression-design.md` — read it first.

## Global Constraints

- Node ≥ 20.10, pnpm workspace, repo-root commands. Commit directly to `main`. Changeset: `@uxfactory/cli` minor.
- Normalization (verbatim): `storyStateKeyOfRef(ref, storyIds)` → null for page-path refs (`isPagePathRef`) or unregistered story prefixes (`storyIdOfRef` + membership); else the ref with any `@<viewport>` suffix stripped from the LAST `@`.
- Finding text (verbatim): `story <id> lost coverage for state "<state>" (covered at baseline, missing now)`; `ref` = the normalized `story/state` key.
- Unchanged: signature, binding (`unit === "story"`), must severity, both reason strings, `qualifiesAsBaseline`, the guarded `(baseline.checks ?? [])` access, refs-scoped `render-coverage`, legacy units.
- The internal `renderCoverage` call runs with `{ storyCoverage: true }` on the NEIGHBOR set only; its page-path findings (render failures, dead/invisible selectors) drop out via the null path — they remain the real gate entry's job.
- Pre-existing failures unchanged (spec typecheck story-schema.test.ts:184; CLI 3 fixture files; plugin 16).

---

### Task 1: Engine — state-granular rewrite + tests + changeset + spec note

**Files:**
- Modify: `packages/uxfactory-cli/src/batch/html-checks.ts` (`storyRegression` body; new private `storyStateKeyOfRef` beside `isPagePathRef`; delete the story-granular `coveredNow`)
- Modify: `packages/uxfactory-cli/test/story-regression.test.ts` (update story-granular fixtures; add the new cases)
- Create: `.changeset/cli-state-granular-regression.md`
- Modify: `docs/superpowers/specs/2026-07-10-story-unit-design.md` (one sentence appended to the Delivered-semantics paragraph: `Upgraded 2026-07-11 to story×state granularity — see spec 2026-07-11-state-granular-regression-design.md.`)

**Interfaces:**
- Consumes: existing `renderCoverage`, `isPagePathRef`, `storyIdOfRef`, `qualifiesAsBaseline`, `StorySet`, `BatchFinding`, `CheckResult`.
- Produces: same public surface (`storyRegression` signature unchanged); findings now per `story/state`.

- [ ] **Step 1: Write the failing tests.** Update/extend `story-regression.test.ts` (reuse its fixture builders; fixtures asserting "kept coverage" must now cover EVERY required state of the neighbor at every current viewport — extend the snapshot builders accordingly):

```ts
  it("HEADLINE: neighbor loses one state but keeps another → exactly that state flags", () => {
    // Baseline (qualifying): S2 fully covered (no S2 findings).
    // Stories: S2 has ACs implying success AND error.
    // Current snapshots: S2 success covered+visible; S2 error NOT covered.
    // Refs [S1] fully covered.
    // Expect: story-regression fail, findings === [{ ref: "S2/error", detail: 'story S2 lost coverage for state "error" (covered at baseline, missing now)' }]
  });

  it("state-level pre-existing gap carried: missing at baseline AND now → no finding", () => {
    // Baseline has finding ref "S3/edge" (or "S3/edge@1440×900" — see normalization case below).
    // Current: S3 edge still uncovered → story-regression pass (only S3/edge differs and it's carried).
  });

  it("kept coverage passes at state granularity", () => {
    // Neighbor covers ALL its required states at all current viewports → pass.
  });

  it("strict mode is state-granular full neighbor coverage", () => {
    // No qualifying baseline; S2 covers success but not error → finding S2/error; reason contains "strict".
  });

  it("normalization: suffixed baseline refs match unsuffixed current keys (and vice versa)", () => {
    // Baseline finding ref "S3/edge@1440×900" (multi-viewport baseline run);
    // current single-viewport run missing S3/edge → carried (keys equal after stripping).
  });

  it("page-path and unregistered refs never enter the comparison", () => {
    // Baseline findings include a render-failure ref "S2/index.html › main" and an
    // unknown "GHOST/error" → neither poisons missingAtBaseline: S2 losing a genuinely
    // covered state still flags; GHOST never appears.
  });
```

Write each fully against the real builders. Existing tests that asserted the OLD story-granular semantics (one visible cover = covered) must be updated to state-complete fixtures — list every such edit in your report.

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run packages/uxfactory-cli/test/story-regression.test.ts` → new cases FAIL (headline: zero findings under story-granular logic since S2 keeps a success cover).

- [ ] **Step 3: Implement.** Add beside `isPagePathRef`:

```ts
/** Normalize a render-coverage finding ref to a `story/state` key, or null
 * for page-path refs and unregistered story prefixes. Strips any `@viewport`
 * suffix (from the LAST `@`; viewports are `${w}×${h}`, never containing `@`),
 * so suffixed (multi-viewport) and unsuffixed (single-viewport) formats
 * compare equal across baseline and current runs. */
function storyStateKeyOfRef(ref: string, storyIds: ReadonlySet<string>): string | null {
  if (isPagePathRef(ref)) return null;
  const at = ref.lastIndexOf("@");
  const key = at === -1 ? ref : ref.slice(0, at);
  return storyIds.has(storyIdOfRef(key)) ? key : null;
}
```

Replace `storyRegression`'s body (signature, skip-branch, reasons unchanged):

```ts
  const refs = new Set(storyRefs ?? []);
  const storyIds = new Set(stories.stories.map((s) => s.id));
  const neighbors: StorySet = { stories: stories.stories.filter((s) => !refs.has(s.id)) };

  // Missing NOW: the real render-coverage evaluated over the neighbors —
  // shared semantics by construction, nothing re-implemented to drift.
  const now = renderCoverage(snapshots, neighbors, { storyCoverage: true });
  const missingNow: string[] = [];
  for (const f of now.findings) {
    const key = f.ref !== undefined ? storyStateKeyOfRef(f.ref, storyIds) : null;
    if (key !== null) missingNow.push(key);
  }

  const usable = baseline != null && qualifiesAsBaseline(baseline);
  const missingAtBaseline = new Set<string>();
  if (usable) {
    const cov = (baseline!.checks ?? []).find((c) => c.id === "render-coverage");
    for (const f of cov?.findings ?? []) {
      if (f.ref === undefined) continue;
      const key = storyStateKeyOfRef(f.ref, storyIds);
      if (key !== null) missingAtBaseline.add(key);
    }
  }

  const findings: BatchFinding[] = [];
  // Dedupe: a state missing at three viewports is ONE lost state, not three findings.
  for (const key of new Set(missingNow)) {
    if (missingAtBaseline.has(key)) continue; // pre-existing gap, carried
    const storyId = storyIdOfRef(key);
    const state = key.slice(key.indexOf("/") + 1);
    findings.push({
      detail: `story ${storyId} lost coverage for state "${state}" (covered at baseline, missing now)`,
      ref: key,
    });
  }
```

(Return object unchanged apart from findings. Delete the old `coveredNow` closure and the per-story loop. If the neighbor set is empty — single-story projects — `renderCoverage` over `{stories: []}` yields no story-coverage findings; the check passes; no special case needed, but confirm with a quick look.)

- [ ] **Step 4: Run** — `pnpm vitest run packages/uxfactory-cli/test/story-regression.test.ts packages/uxfactory-cli/test/batch-html.test.ts packages/uxfactory-cli/test/html-checks.test.ts` then FULL `pnpm vitest run packages/uxfactory-cli/test/`; `pnpm --filter @uxfactory/cli typecheck` (3 known fixture files only).

- [ ] **Step 5: Changeset** `.changeset/cli-state-granular-regression.md`:

```md
---
"@uxfactory/cli": minor
---

story-regression is now state-granular: a neighbor story that loses one
covered state (e.g. its error view) fails the story-unit gate even when
another state's cover survives. Pre-existing per-state gaps are still
carried; strict mode now demands full state coverage for neighbors.
```

- [ ] **Step 6: Spec note + commit**

```bash
git add packages/uxfactory-cli/src/batch/html-checks.ts packages/uxfactory-cli/test/story-regression.test.ts .changeset/cli-state-granular-regression.md docs/superpowers/specs/2026-07-10-story-unit-design.md
git commit -m "feat(cli): state-granular story-regression — per story×state neighbor protection"
```

---

### Task 2: Verification + live re-verify (controller)

- [ ] `pnpm -r build && pnpm test` green; rebuild dists.
- [ ] uxfio-demo replay (deterministic CLI, no LLM): strip unit/refs from `uxfactory.batch.json` → full-denominator baseline run → restore `unit: "story"`, `storyRefs: ["compare-pricing"]` → story gate run → expect `clean: true` (the 7 pre-existing gaps carry at state granularity), `story-regression: pass`, reason `baseline: last full-denominator report`.
- [ ] Synthetic loss check: doctor the baseline report (remove one previously-missing S/state finding for a neighbor so it reads as covered-at-baseline) → rerun story gate → expect exactly that `story/state` finding.
- [ ] Restart the user's stack; ledger + memory.

---

## Self-review notes (kept for the implementer)

- **Spec coverage:** normalization helper (T1 S3), rewrite (T1 S3), behavior deltas encoded in tests (headline/strict/kept/pre-existing/normalization/poison), changeset + spec-note (T1 S5-6), live re-verify (T2).
- **Anchors (main @ 50ab255):** `renderCoverage` html-checks.ts:184-260 (ref formats at :244); `isPagePathRef`/`storyIdOfRef`/`qualifiesAsBaseline` and the current `storyRegression` all in html-checks.ts post-dce2829 — read the current body before replacing.
- **Watch:** `missingNow` uses an array (duplicate keys across viewports collapse only in `missingAtBaseline`'s Set) — dedupe `missingNow` too (e.g. iterate a `new Set(missingNow)`) so a state missing at three viewports yields ONE finding, not three. Add an assertion for that in the headline or a dedicated case.

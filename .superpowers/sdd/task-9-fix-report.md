# Task 9 Fix Report — Checks Review Findings

**Date:** 2026-07-02  
**Files touched:** `packages/uxfactory-plugin/ui/lib/tiers.ts`, `ui/screens/Checks.tsx`, `test/tiers.test.ts`, `test/screen-checks.test.tsx`

---

## Fixes Applied

### I-2 (annotation semantics)
- `TierFinding` extended with `nodeName?: string` and `requirement?: string`.
- `buildT1`: parses `requirement = "story · state"` from `f.ref` (format `story-id/impliedState`; refs with `›` are selector/render failures, left as `requirement: undefined`).
- `buildT2` a11y + contrast: sets `nodeName = f.ref` (CSS selector string).
- `buildT3`: sets `nodeName = GateFailure.name` (preferred over nodeId for drawReview ElementFlag matching).
- `Checks.tsx handleAnnotate`: T1 findings with `requirement` route as `{requirement, property: nodeId ?? "", status:"unmet", detail}` (CoverageGap); others route as `{property: nodeName ?? nodeId ?? "", status:"unmet", detail}` (ElementFlag).
- Tests: `tiers.test.ts` + `screen-checks.test.tsx` assert field-for-field routing for T1 (requirement), T3 (nodeName as property), and the mixed case.

### M-3 (annotate honesty)
- Button label still counts ALL open findings.
- After posting, `useAppStore.getState().toast("M placeable · K without canvas targets")` is emitted when K > 0 (findings with no `requirement`, `nodeName`, or `nodeId`).
- Tests: K>0 toast with 2-failure GateResult (one with name, one without); no-toast case when all are placeable.

### I-1 (hint prefix)
- `TierFinding` gains `hintPrefix?: string`.
- `buildT2` token findings: parse `" — nearest: xxx"` from detail string; `hint = "xxx"`, `hintPrefix = "nearest: "`, message stripped of suffix.
- `buildVLM` craft findings: `hint = f.fix`, `hintPrefix` not set (undefined). Previously the JSX hardcoded `nearest: ` prefix for ALL hints which was wrong for craft fix text.
- `FindingCard`: renders `{finding.hintPrefix ?? ""}{finding.hint}`.
- Tests: VLM craft has `hintPrefix === undefined`; token finding with "nearest: xxx" in detail has `hintPrefix === "nearest: "` and stripped message; UI test asserts "nearest: semantic/danger-500" renders, and craft fix renders WITHOUT "nearest: " prefix.

### I-3 (isAnnotating removed)
- `isAnnotating` state and `setIsAnnotating` removed from `Checks` container.
- `isAnnotating` prop removed from `ChecksViewProps`.
- Annotate button is fire-and-forget; no 500ms disable gate. The existing "second press also posts" test (expecting 2 calls) confirms this is intentional.
- Test: asserts button is not disabled before or after first click.

### M-1 (T0 honest stats)
- `buildT0` no longer sets `stats = "2/2 · implicit"`. Now sets `skipReason: "implicit"` on pass rows so TierRow rightLabel shows "implicit" as an honest note.
- Tests: `T0 pass has no stats field` + `T0 pass has skipReason "implicit"`.

### M-2 (isBatchReport tightened)
- Added early return: `if (rec.status === "PASS" || rec.status === "FAIL") return false;` before the `Array.isArray(rec.checks)` check.
- GateResult shapes always carry `status: "PASS" | "FAIL"` at root; BatchReport never does.
- Tests: GateResult passed as batchReport leaves T1/T2 pending; dual-dispatch (same raw for both) routes T3 correctly.

### M-5 (persisted run counter)
- New `ChecksStorage` interface: `{ entries: HistoryEntry[]; runCounter: number }`.
- `init()` reads from storage; detects new format via `"entries" in stored && !Array.isArray(stored)`. Legacy `HistoryEntry[]` array format still supported (backward compat: computes counter from array length).
- On live data: uses `runCounter` as `runNumber`, then persists `{ entries: [newEntry, ...prev], runCounter: runCounter + 1 }` via `bus.storageSet`.
- Tests: counter=43 in storage → banner shows run #43 (not 3 from history.length+1); legacy array format still loads; storageSet called with `runCounter: 11` after run with counter=10.

### M-4 (AC-5 live streaming — deferred)
- Added comment in `Checks.tsx init()`:
  ```
  // AC-5 live tier streaming: deferred to T14/PP2 (run-event plumbing).
  // When T14 adds bridge.events(), a streaming subscription would be established
  // here to receive tier updates in real-time as each tier completes.
  ```

---

## Test Results

- `test/tiers.test.ts`: 60 tests, all pass
- `test/screen-checks.test.tsx`: 44 tests, all pass (some new tests added for each fix)
- Full plugin suite: 31 test files, 603 pass + 1 skip; scaffold.test.ts flake excluded (pre-existing build timeout)
- TypeScript typecheck: 0 errors

---

## Non-Obvious Notes

- The `firstLocalFailed(rows)` helper in tiers.ts replaces the inline `firstLocalFail !== null` check for VLM gating — semantically equivalent since VLM hasn't been added to `rows` at call time.
- The "nearest: " suffix parsing in buildT2 uses `/ — nearest: (.+)$/` which handles the SP2-era detail format. Token findings WITHOUT a nearest suffix (e.g., from checks.ts `tokenConformance`) are unaffected (no hint set).
- The `ChecksStorage` detection uses `"entries" in stored` which correctly distinguishes from legacy `HistoryEntry[]` since arrays don't have an `entries` property in their prototype chain.

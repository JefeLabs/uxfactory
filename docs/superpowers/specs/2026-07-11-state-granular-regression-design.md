# State-granular story-regression — N1 follow-up

**Date:** 2026-07-11
**Status:** approved (design), pending implementation plan
**Scope:** upgrade the `story-regression` check (spec `2026-07-10-story-unit-design.md`, delivered semantics of 2026-07-11) from story-granular to story×state-granular neighbor protection. Engine-only (`packages/uxfactory-cli/src/batch/html-checks.ts`). Closes final-review finding N1.

## Problem

`story-regression` currently deems a neighbor "covered now" if ANY snapshot carries one visible cover for it, while the baseline's missing-set derives from `render-coverage` findings that are per story×state×viewport. Consequence (probe-verified in the story-unit final review): a neighbor covered for `success`+`error` at baseline that loses its `error` state but keeps one `success` cover passes story runs — the loss goes undetected until the next full-denominator run. The severity split traded away state-level protection the interim strict behavior had.

## Decision (with user)

**Mechanism: reuse `renderCoverage` on the neighbor set and diff its findings against the baseline's** (over hand-rolling a per-state predicate — duplicated logic, drift risk — or persisting a richer baseline artifact — deferred twice already). One accepted bias: "missing now" is any-current-viewport granularity after normalization, so adding a new viewport can surface neighbor states uncovered there as regressions — newly-visible debt flagged strictly, consistent with the feature's over-block bias; documented, not special-cased.

## Design

### Key normalization

`storyStateKeyOfRef(ref: string, storyIds: ReadonlySet<string>): string | null` (module-private, beside `isPagePathRef`):
- `null` when the ref is a page-path ref (`isPagePathRef`, the " › " discriminator) or its story prefix (`storyIdOfRef`) is not a registered story id.
- Otherwise the ref with any `@<viewport>` suffix stripped (strip from the LAST `@`; viewport strings are `${width}×${height}` and never contain `@`), yielding a `story/state` key. Handles both multi-viewport (suffixed) and single-viewport (unsuffixed) finding formats identically — the comparison is therefore immune to viewport-format differences between baseline and current runs.

### `storyRegression` rewrite

Signature unchanged (`snapshots, stories, storyRefs, baseline`). Internally:

1. `missingNow`: call the REAL `renderCoverage(snapshots, { stories: nonRefStories }, { storyCoverage: true })` where `nonRefStories` = registered stories minus the refs; normalize its findings through `storyStateKeyOfRef` (page-path findings — render failures, dead/invisible selectors — drop out via the `null` path; they remain `render-coverage`'s own job on the real gate entry). Collect the non-null keys.
2. `missingAtBaseline`: same normalization over the qualifying baseline's `render-coverage` findings (existing `qualifiesAsBaseline` + guarded `checks ?? []` access unchanged). Non-qualifying/absent baseline → empty set (strict: every current neighbor gap flags — the pre-split full-coverage behavior, now correctly owned by this check).
3. Findings: for each key in `missingNow` not in `missingAtBaseline` → must finding `story <id> lost coverage for state "<state>" (covered at baseline, missing now)`, `ref` = the normalized key. Keys present in both are carried silently (pre-existing gaps).
4. `status`/`severity`/`reason` semantics unchanged (`baseline: last full-denominator report` vs `no qualifying baseline — strict mode`); binding (`unit === "story"`), thresholds, and every other check untouched.

The story-granular `coveredNow` predicate is deleted.

### Behavior deltas (intentional)

- Strict mode becomes state-granular full neighbor coverage (previously any-one-visible-cover per story) — stricter, matches what `render-coverage` itself would demand.
- Lenient mode now catches partial losses (the N1 case) and reports them per state.
- Viewport-expansion runs may flag neighbor states uncovered at the new viewport (accepted bias, above).

## Testing

- Headline: neighbor with `success`+`error` covered at baseline; current run keeps `success`, loses `error` → exactly one finding (`S2/error`), `clean` reflects must-fail.
- State-level pre-existing gap: `S3/edge` missing at baseline AND now → carried, no finding.
- Kept-coverage pass: neighbor fully covering all its required states at all current viewports → pass (existing fixtures updated deliberately — one visible cover no longer suffices).
- Strict mode: no qualifying baseline → every uncovered neighbor state flags.
- Normalization: baseline with unsuffixed refs (single-viewport run) vs current multi-viewport run — same story/state matches; suffixed baseline refs normalize equally.
- Refs/legacy untouched: refs still owned by the refs-scoped `render-coverage`; legacy units' behavior byte-preserved (existing suites green).
- Live re-verify (controller): uxfio-demo replay — full-denominator baseline → story gate run still `clean: true` (the 7 pre-existing gaps carry at state granularity too); synthetic state-loss exercise via a doctored baseline confirming the finding fires.

## Ship shape

`@uxfactory/cli` minor changeset (behavior change in a shipped check). Amend the story-unit spec's delivered-semantics note with one line pointing here. Out of scope: N2 (metric optimism), the persistent registry stamp, viewport-intersection comparison logic.

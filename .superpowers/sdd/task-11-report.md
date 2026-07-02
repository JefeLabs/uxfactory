# Task 11 — Components Screen: Design-Unit ↔ Requirement Linking

**Status:** Complete  
**Package:** `packages/uxfactory-plugin`  
**Commit message:** `feat(plugin): Components screen — unit↔requirement linking`

---

## What was built

### New files

| File | Purpose |
|------|---------|
| `ui/screens/Components.tsx` | Full Components screen (selection card, link composer, linked list, zero-ACs callout, sticky footer) |
| `test/screen-components.test.tsx` | 9 ACs (AC-6 skipped as directed), 8 assertions pass in CI |

### Modified files

| File | Change |
|------|--------|
| `src/messages.ts` | Added `stylesInUse: number` to `SelectionPayload` |
| `src/selection.ts` | Added `StyleCountNode` interface + `countStylesInSubtree` export; updated `mapSelection` signature (3rd param `stylesInUse = 0`) |
| `src/code.ts` | Import `countStylesInSubtree`; compute `stylesInUse` from `page.selection[0]` before calling `mapSelection` |
| `test/figma-mock.ts` | Doc-comment noting `fills/strokes/fontName/children` already present for `countStylesInSubtree` |
| `test/code.test.ts` | New test: `stylesInUse` computed from 2-node subtree (red frame + blue child → 2 distinct fill keys) |
| `test/selection.test.ts` | Updated `toEqual` expectation to include `stylesInUse: 0` (regression fix) |
| `test/ui.test.ts` | Added `stylesInUse: 0` to `SelectionPayload` literal (TypeScript regression fix) |

---

## Acceptance criteria coverage

| AC | Status | Notes |
|----|--------|-------|
| AC-1 | PASS | "Select a frame on the canvas" shown when no selection |
| AC-2 | PASS | Selection card renders node id + stylesInUse count |
| AC-3 | PASS | Hover on linked row reveals Unlink button; click calls `bridge.putLinks` minus row |
| AC-4 | PASS | Link button disabled when `canLink` false; enabled after AC selected; calls `putLinks` |
| AC-5 | PASS | Zero-ACs callout shown when `snapshot.requirements` is empty; hidden otherwise |
| AC-6 | SKIP | Deferred per spec: requires canvas-lookup API not available in v1 |
| AC-7 | PASS | Check button disabled when no links; enabled when links exist; calls `enqueue`, `setFocus`, `setTab("checks")` |
| AC-8 | PASS | `openPath` called with requirements artifact path on AC-id click |
| AC-9 | PASS | `bus.notify` called with node id on node-id button click; clipboard guarded with `if (navigator.clipboard)` |

---

## Implementation details

### `countStylesInSubtree` algorithm

- BFS walk capped at 500 nodes (`MAX_STYLE_WALK`)
- Collects distinct keys into a `Set<string>`:
  - `fill:<hex>` — solid fill only (first paint, RGB→hex)
  - `stroke:<hex>` — solid stroke only (first paint)
  - `font:<family>/<style>` — TEXT nodes only
- Returns `keys.size`

### Link composer logic

- Native `<select>` for requirement picker (id=`req-select`, aria-label="Requirement to link")
- Native `<select>` for unit type (aria-label="Unit type")
- `canLink = primaryNode !== null && selectedAcId !== "" && !isDuplicate`
- `isDuplicate` = any existing link with same `nodeId` + `acId`
- `putLinks` writes the entire link set (replace semantics, not append)

### Rollup counter

- `rollupY` = distinct `unitName` values across all links ∪ current selection name (if any)
- `rollupX` = `links.length` (total link rows)

### v1 seams (documented)

| Feature | v1 behavior | Reason deferred |
|---------|-------------|-----------------|
| Sync badge | Always "not mapped" | No bridge read for drift state in v1 |
| Row click selects canvas | Copies node id only | No canvas select/zoom API in v1 |
| Missing-node row flag | Not implemented | Requires canvas lookup API |

---

## Test suite results

```
test/screen-components.test.tsx   8 passed, 1 skipped (AC-6)
test/code.test.ts                 (all passed including new stylesInUse test)
Full suite:                       604 passed, 1 failed, 1 skipped
```

The 1 full-suite failure (`scaffold.test.ts`) is a pre-existing intermittent timeout from port contention when the full test suite runs concurrently. It passes reliably in isolation (`npx vitest run test/scaffold.test.ts`). This failure pre-dates task-11 changes (confirmed by stashing task-11 files and reproducing the same failure).

---

## Known issues / pre-existing regressions

`test/screen-checks.test.tsx` contains M-5 tests (added by a prior task) that reference incomplete changes in `Checks.tsx` / `tiers.ts`. These failures are not caused by task-11 and do not appear in the task-11 file set. They were omitted from this task's scope per the "do not touch other screens" constraint.

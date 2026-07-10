# Requirements tab — promote the trace graph to a first-class panel surface

**Date:** 2026-07-10
**Status:** approved (design), pending implementation plan
**Scope:** v1 of the Requirements tab: read/navigate + per-story generation launcher. In-panel story editing (set-member addressing) and JIRA/Linear sync are explicitly deferred (see the backlog note: external-tracker prep is an `external: {provider, key, syncedAt}` block per story, later).

## Problem

The features→stories→ACs graph is the panel's most product-shaped content — gates verify against stories, generation grounds in them — but it has no first-class surface. The read-only `TraceView` tree is parked inside the Components tab (a screen about canvas links), coverage questions ("which stories have no screen?", "which ACs are unverified?") have no home, canvas realization links aren't actionable, and story-scoped generation requires manually re-finding stories in the composer.

## Decisions (with user)

1. **v1 scope: read/navigate + generate** — richer tree with search + coverage filters, coverage rollups, canvas jump on linked nodes, open-story-in-external-editor, and a per-story Generate button pre-filling the composer. NO in-panel story editing (needs set-member addressing — deferred).
2. **Tab position: second** — `Generate | Requirements | Artifacts | Components | Assets | Checks`. Left-to-right reads as pipeline causality (intent → documents → realization → verification), and Requirements/Generate become adjacent collaborators for story-scoped generation. Cheap to reorder later.
3. **Label: "Requirements"** — names the content, survives the tracker integration.
4. **Components loses the tree** — the TraceView Card and its trace query are removed from Components, replaced by a one-line hint linking to the Requirements tab. One home, no drift.
5. **Approach: promote and enrich** (over wrapping read-only TraceView or a server-side requirements endpoint): the tree is rebuilt as action-bearing components in the new screen; data stays on the existing `traceQuery`; rollups/filters compute client-side (payloads are dozens of stories).

## Constraints

- Bridge change is ONE additive wire field → `@uxfactory/bridge` minor changeset. Panel is private — no other changesets.
- Panel conventions: `.tsx` tests run from `packages/uxfactory-plugin`; new RTL files need the jsdom pragma + jest-dom + `afterEach(cleanup)` harness; plugin has 16 pre-existing typecheck errors (no new); design tokens over raw Tailwind palette (`warn-*`, `success-*`, `primary-*` per `ui/panel.css`); selector-discipline Zustand reads.
- The Generate composer already accepts story selection (`storyRefs`) — the handoff must reuse its existing state shape, not invent a parallel one.
- `TraceView.tsx` is deleted in this change once nothing imports it (no orphaned dead code).

## Design

### 1. Bridge — story file paths on the trace wire

`TraceStory` (in `packages/uxfactory-bridge/src/project.ts`) gains `filePath: string` — the repo-relative path of the story's source file: the member file (`.uxfactory/artifacts/stories/<member>.json`) for set-mode projects, or the legacy stories file for single-file projects. Set in `readTraceStories`, which already iterates the member files. Mirrored in the panel's `TraceStory` type (`ui/lib/bridge.ts`). Changeset: `@uxfactory/bridge` minor.

### 2. Tab + routing

- `Tab` union (`ui/stores/app.ts`) gains `"requirements"`.
- New route `/tabs/requirements` in `ui/router.tsx`, following the existing tab-route pattern; TabNav entry (label-only — TAB_DEFS carries no icons), ordered second.
- Existing tab tests updated for the new order (Generate, Requirements, Artifacts, Components, Assets, Checks).

### 3. `screens/Requirements.tsx`

Composed from small, action-bearing pieces (new `ui/components/requirements/` or colocated — implementation's choice, one responsibility per component):

- **Rollup header**: `N features · M stories · K ACs` plus two attention chips — `X uncovered stories` (story.coveredBy empty) and `Y unverified ACs` (AC has neither `coveredBy` nor `linkedNodes`). Chips double as filter toggles.
- **Search + filters**: text search over feature name, story id/actor/want, AC id/statement; filter chips All / Uncovered / Unverified (client-side over the `traceQuery` payload). Filters and search compose (AND).
- **Tree**: feature row (conformance dot semantics identical to today's TraceView: green true / amber false / gray null; planned-pages chip) → story rows → AC rows.
  - Story row actions: **Generate** (sets the pending-refs handoff, navigates to the Generate tab), **Open** (`bridge.openPath(story.filePath)`, same error surfacing pattern as the Artifacts tab's ↗).
  - AC `linkedNodes` chips become buttons: `bus.selectNodes([nodeId])` — jump the canvas selection to the realizing node. `coveredBy` page/view chips stay informational (HTML pages are not canvas nodes).
- **Empty state**: no features AND no stories → message + link to the Artifacts tab ("seed Features and Stories first").
- Loading/error states follow the existing screens' `useQuery` patterns.

### 4. Generate handoff

App store gains `pendingStoryRefs: string[] | null` (initial null) + actions `setPendingStoryRefs(refs)` / `consumePendingStoryRefs(): string[] | null` (returns and clears). The story row's Generate button calls `setPendingStoryRefs([storyId])` then navigates to the Generate tab. The Prompt/Generate screen, on mount, consumes a non-null value into its EXISTING story-selection state (pre-selecting those stories). No job-wire changes.

### 5. Components tab slimming

Remove the TraceView Card and the `traceQuery` usage from `screens/Components.tsx` (verify at plan time whether anything else on that screen consumes the trace payload — the zero-ACs callout uses a different source; if anything does, keep the query and remove only the Card). Add a one-line hint linking to the Requirements tab. Delete `ui/components/TraceView.tsx` once unreferenced.

### 6. Testing

- **Bridge**: trace response carries `filePath` for set members (and the legacy single-file layout).
- **Screen** (`test/screen-requirements.test.tsx`): rollup math from a fixture trace; filter chips and search narrow the tree (AND semantics); linked-node button calls `bus.selectNodes` with the right id; Generate sets pending refs + navigates; Open calls `openPath` with the story's filePath; empty state renders the Artifacts link.
- **Handoff**: store test for set/consume-clears semantics; Prompt-side test that a pending value pre-selects stories on mount and is consumed exactly once.
- **Routing**: six tabs, agreed order, requirements route renders the screen.
- **Components**: tree gone, hint present, no dead imports; `TraceView.tsx` deleted.
- Full suite + plugin bundle rebuild (`pnpm -r build`) so Figma picks it up.

## Out of scope

- In-panel story/AC editing and set-member addressing on the artifact API.
- Status curation (approve/reject per node).
- JIRA/Linear sync (this tab is its future landing zone; no sync code now).
- Checks-tab consolidation (per-story conformance stays in Checks).
- Canvas jump for `coveredBy` HTML pages (not canvas nodes).

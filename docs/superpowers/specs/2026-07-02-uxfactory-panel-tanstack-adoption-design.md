# Panel TanStack Adoption — Query + Router (Design)

**Date:** 2026-07-02
**Status:** Approved direction (user: "let's adopt tanstack query and tanstack router") — spec for the plan. Sequenced BEFORE the multi-root bridge (user, 2026-07-02) — root-scoped query keys arrive in that later feature.
**Baseline:** panel redesign v1 (all 9 screens, acceptance-walk fixes through the Artifact Editor and cwd hint). Refactor starts only on a green, walk-validated baseline.

---

## 1. Goal & why

Replace the panel's hand-rolled server-state management and enum routing with **TanStack Query** (data layer) and **TanStack Router** (route tree), positioned so the **planned web app** reuses both unchanged. The acceptance walk empirically motivated this: the stuck-spinner, advance-on-failed-write, and stale-Checks bugs were all hand-rolled-async-state defects that Query eliminates structurally.

## 2. Architecture

- **Router in the plugin via `createMemoryHistory`** — the iframe has no URL bar; the route tree is defined once (shared-ready) and mounted on memory history today, browser history in the future web shell.
- **Route tree:** `/connect`, `/setup/classification`, `/setup/defaults`, `/tabs` (layout route: ContextBar + TabNav) with children `/tabs/prompt`, `/tabs/artifacts`, `/tabs/components`, `/tabs/assets`, `/tabs/checks`, `/tabs/settings`.
- **Typed search params replace focus intents:** `/tabs/checks?run=<id>`, `/tabs/artifacts?focus=<key>` (validated via the route's `validateSearch`); the app-store `focus` field and `setFocus/clearFocus` are deleted; consumers read/clear via router navigation.
- **Query owns server state:** queries — `snapshot`, `health` (refetchInterval 3s, connect screen scope), `stats` (10s), `logs`, `skills`, `links`, `latestRender`; mutations — `connectProject`, `putClassification`, `putProfile`, `putLinks`, `enqueue` — with **navigation only in `onSuccess`** (the advance-on-failure class becomes impossible) and `invalidateQueries` replacing `refreshSnapshot()` + the Artifacts pending poll (pending rows become a query with `refetchInterval` while any pending + mutation-driven invalidation).
- **Zustand keeps client state only:** wizard drafts, runs index (+composer state), toasts, connection meta. `route` moves out of the store entirely.
- **Boot:** unchanged sequence (bus fileInfo → stored connection → health+snapshot), ending in `router.navigate` instead of store `goto`; reconnect/cancel semantics preserved (cancel navigates to `/connect`; the boot-race guard becomes "abort navigation if location changed").
- **QueryClient config:** `retry: 1` for queries, `retry: 0` for mutations; `staleTime` per query (snapshot 5s, stats 0, skills 60s); one `QueryClientProvider` + `RouterProvider` in `main.tsx`.

## 3. Explicit non-goals (this refactor)

No visual changes; no new features; no ui-core package extraction yet (next step after this lands); no web shell; no bridge changes (the SSE result-broadcast improvement is separate PP2 work); the plugin bus is untouched.

## 4. Migration invariants (the safety rails)

1. **Behavior-frozen refactor:** every existing RTL screen test keeps passing with minimal mechanical edits (render-with-providers helper replaces bare render; navigation asserts change from store-route to router location). Tests that assert *behavior* must not weaken.
2. **Bundle budget:** +~15KB gz combined is acceptable; ui.html stays < 1.5MB, still fully inlined (both libs are pure JS — no singlefile hazard).
3. **The contract tests (`bridge-contract.test.ts`) and e2e route walks keep passing unchanged in intent** (e2e asserts flows through the UI; route representation changes underneath).
4. Per-screen migration order (each its own commit, suite green): providers+router shell w/ routes delegating to existing screens → Settings (most polling) → Artifacts (pending/invalidations) → Connect+Setup (mutation-gated navigation) → Checks (search-param run + refetch) → Prompt/Components (links query, enqueue mutations) → delete dead store fields (`route`, `focus`, hand-rolled polls) + final sweep.

## 5. Testing

Per-screen: existing suites adapted via a shared `renderWithProviders(ui, {router, queryClient, bridge, bus})` test util (new `test/test-utils.tsx`); new tests only where Query adds behavior (mutation-failure keeps location; invalidation refetch; search-param navigation). The e2e walks re-anchor on router locations. Gates per commit: full plugin suite + typecheck + `-r build`.

## 6. Success criteria

1. Zero hand-rolled `setInterval` polling or manual pending/error flags remain in `ui/screens/**` (grep-clean, except the bus-level pieces that aren't server state).
2. `route`/`focus` gone from the app store; navigation is router-only with typed search params.
3. All suites green; bundle < 1.5MB; behavior identical in a live Figma smoke (boot, setup redo path, tab walk, Create dialog, Checks run param).
4. The route tree + query layer sit in clearly extractable modules (`ui/router.tsx`, `ui/queries.ts`) — the ui-core extraction that follows is file moves, not rewrites.

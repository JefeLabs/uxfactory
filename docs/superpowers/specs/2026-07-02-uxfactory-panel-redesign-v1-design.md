# UXFactory Panel Redesign v1 — All Screens (Design)

**Date:** 2026-07-02
**Status:** Approved direction (user: "implement all screens and interactions") — spec written for the plan.
**Authoritative screen requirements:** `.plans/panel/*.md` (9 PRDs + README shell/decisions). This spec defines the implementation architecture, the real-vs-fixture seams, and scope boundaries; it does NOT restate per-screen anatomy.

---

## 1. Goal

Replace the plugin panel with the redesigned 9-screen experience — Connect, Setup×2, Prompt, Artifacts, Components, Assets, Checks, Settings — on the chosen stack, with every interaction implemented and wired to real backends where they exist today, and explicit fixture seams where they don't (each seam a one-swap interface for PP2+ backends).

## 2. Stack & build (locked)

- **UI:** Vite + React 18 + TypeScript, Tailwind v4 (`@tailwindcss/vite`), Radix UI primitives, Zustand stores, **lucide-react** icons (tree-shaken; no CDN anything — manifest stays localhost-only).
- **Single-file constraint:** `vite-plugin-singlefile` emits one fully-inlined `ui.html` (`figma.showUI(__html__)`). Build-smoke asserts no external `src=`/`href=` refs.
- **Plugin main thread (`code.ts`) stays esbuild.** `scripts/build-plugin.mjs` orchestrates: esbuild `code.js` + `vite build` ui + existing smoke contract. Dev loop: `vite build --watch`.
- **Testing:** Vitest + @testing-library/react + jsdom for UI; fastify-inject for bridge routes; existing vanilla suites (pipeline-view, panel-state, code.ts render) stay green until their surfaces are deleted.

## 3. Architecture

```
packages/uxfactory-plugin/
  src/                      (main thread — esbuild; unchanged conventions)
    code.ts                 + storage/file-info/insert-icon/selection message handlers
    messages.ts             + new UiToMain/MainToUi variants (below)
  ui/                       (NEW — Vite root)
    main.tsx                boot: plugin-bus handshake → restore connection → <App/>
    app.tsx                 Shell: TitleBar, ContextBar, TabNav (Radix Tabs), screen switch
    stores/app.ts           Zustand: connection, project snapshot, route, toasts
    stores/wizard.ts        Zustand: classification + defaults drafts (Back-safe)
    stores/runs.ts          Zustand: run index (recent generations/checks), live progress
    screens/{Connect,SetupClassification,SetupDefaults,Prompt,Artifacts,Components,Assets,Checks,Settings}.tsx
    components/             Chip, ChipGroup, Segmented, Card, StatusPill, RadioCard, Field,
                            TierRow, FindingCard, ArtifactRow, AssetTile, … (Radix+Tailwind, vendored)
    lib/plugin-bus.ts       typed promise-based postMessage bridge to code.ts
    lib/bridge.ts           fetch client: health/pipeline/rendered/verify + NEW project & panel routes
    lib/tiers.ts            maps TODAY's engine findings → the tier model (see §5 Checks)
    fixtures/               PRD Demo-Shop fixture data behind the SAME interfaces as lib/ (marked seams)
  vite.config.ts, tailwind config (tokens from .plans/panel/README), ui/panel.css
```

**ui↔main additions (`messages.ts`, additive):** `UiToMain += storage-get/{key} · storage-set/{key,value} · file-info-request · insert-icon/{name,svg,size} · notify/{message}`; `MainToUi += storage-value · file-info/{name,fileKey} · icon-inserted`. Selection events already exist (`selection`).

## 4. Bridge additions (additive routes; deterministic file I/O; no worker required)

- `POST /project/connect {repoPath}` → validates path resolves to the served root (`ok:false, reason:"bridge-serves-different-root", served` on mismatch; `not-found`/`not-a-root` otherwise) → returns snapshot.
- `GET /project/snapshot` → `{ name, root, hasClassification, hasProfile, classification?, profile?, artifacts: ArtifactStatus[], requirements: {id,title}[] }` — artifacts computed by the **freshness v1 rule** (below); requirements parsed from the stories/AC artifact when present.
- `PUT /project/classification` / `PUT /project/profile` → pretty-JSON writes (profile merges scope dials; panel labels map to engine vocab exactly per PRD 02 table; `coherence` written but marked experimental).
- `GET /project/links` / `PUT /project/links` → `.uxfactory/links.json` (Components tab store: `{nodeId, unitType, acId}[]`).
- `POST /project/open {path}` → opens the file locally (`open`/`xdg-open`), path must be inside the root.
- `GET /stats` → `{ version, uptimeMs, runsRelayed, tokenIndex? }`; `GET /logs?tail=200` → recent log lines (bridge keeps a ring buffer).
- **Freshness v1:** `up-to-date` = file exists + parses; `draft` = exists + marked draft or fails soft validation; `missing` = registered concern absent. (Hash-based staleness = PP3 follow-up; the UI consumes the enum, so upgrading is invisible.)

## 5. Real vs fixture — per surface (the honesty table)

| Surface | Real in v1 | Fixture/stub in v1 (seam) |
|---|---|---|
| Connect | health poll, connect handshake, path validation, storage persistence, routing | Cloud tab = selectable stub card |
| Setup 1/2 | scan-driven variants from snapshot; classification/profile writes; prefill | — |
| Prompt | enqueue `generate-design`, live `UXF::PROGRESS` via SSE, recent-run index (plugin storage), grounding chips from snapshot freshness | — |
| Artifacts | inventory from snapshot (freshness v1), Open via `/project/open`, Create/Regenerate → `generate-artifact` enqueue, quick Visual dial → profile write, expanded header chips | design-tier rows beyond the registry (brand colors swatches etc.) render from artifact files when parseable, else metadata-only rows |
| Components | live selection sync (main→ui), unit-type set, AC dropdown from snapshot requirements, Link/Unlink via `/project/links`, rollup, `Check my design` → check run | "In sync with code" badge = real read of `uxfactory.map.json` when present else `not mapped`; drift deep-link deferred |
| Assets | ICONS section fully real: grid = the project icon-set artifact's names rendered via lucide-react; click/drag insert via `insert-icon` (24px vector, tagged plugin-data) | Photography/Illustrations sections = PRD fixture tiles + real `Create` enqueue for illustration style |
| Checks | render REAL reports: batch `report.json` + verify verdicts fetched bridge-side; **tier shim** (`lib/tiers.ts`): render-coverage→T1, contrast/token/a11y→T2, conform (counts/presence/geometry)→T3, craft-report→VLM; findings with node refs; **Annotate on canvas** via the existing annotation path; Copy report; run banner + history (last 20, plugin storage index) | T0 Schema renders from validate() outcomes when present else ✓-implicit; `escalation` line static `escalation skipped`; fine-grained rule ids displayed as mapped names until the PP2 engine taxonomy migration |
| Settings | bridge card via `/stats` (View logs→`/logs` drawer), storage meter (clientStorage estimate), skills list served by the bridge from the repo `skill/` dir (names + revision = git-derived or file mtime tag) | Restart = copyable restart command + "restart from terminal" tooltip (no control endpoint in v1); Subscription card = `Local only — no subscription` real state |

Every fixture seam is one interface in `lib/` with the fixture implementation in `fixtures/` — swapping to a real backend later touches one import.

## 6. Transition

The React panel **replaces** the old panel outright: `code.ts` shows the new `ui.html`; the legacy `pipeline-view` DOM panel is not mounted (its modules remain in-tree, tests green, deletion deferred to PP2 cleanup when the Prompt surface is proven live). The Prompt screen is built NEW in React against the same `pipeline-client` SSE contract (reused as-is).

## 7. Error handling & interaction conventions

Per the PRD state tables, uniformly: async buttons disable+spinner; field-level errors (never modals) for validation; connection pill drives a global reconnect banner; toasts for persisted-settings confirmations ("Applies to new runs"); all long operations cancel-safe; keyboard + ARIA per PRD accessibility criteria (Radix gives roving focus/radio semantics).

## 8. Testing strategy

- Per-screen RTL tests keyed to each PRD's **acceptance criteria** (the numbered lists are the test names).
- Store unit tests (Zustand actions/selectors); `lib/tiers.ts` mapping fixtures (a real Meridian report → expected tier model).
- Bridge route tests: validation matrix, snapshot shape, links round-trip, open-path containment (no escape from root), stats/logs.
- `plugin-bus` contract tests both sides (fake postMessage).
- Build-smoke: singlefile inlining + manifest unchanged + code.js intact.
- E2E-lite: boot-to-tabs routing paths (no connection → connect; connected+classified → tabs) with fake bus+bridge.

## 9. Out of scope (v1 of this build)

Cloud auth; PP2 engine rule-taxonomy migration (the tier shim covers v1); hash-based freshness; drift deep-link; photo/illustration real registries; skill revision pinning UI; deleting legacy panel modules; N-variations.

## 10. Success criteria

1. All nine screens render and interact per their PRDs on the new stack, in Figma, against a live bridge on `:3779`.
2. Connect→Setup→Prompt→generate→Checks→Annotate works end-to-end on a real project (the Meridian scratch project is the acceptance fixture).
3. Every PRD acceptance criterion is either covered by a test or explicitly listed in the plan as deferred-with-reason.
4. `pnpm --filter @uxfactory/plugin test` + typecheck + build-smoke green; engine/worker suites untouched and green.

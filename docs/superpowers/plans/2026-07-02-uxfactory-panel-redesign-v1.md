# UXFactory Panel Redesign v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete 9-screen plugin panel (Connect, Setup×2, Prompt, Artifacts, Components, Assets, Checks, Settings) on Vite+React+Tailwind+Radix+Zustand+lucide-react, wired to real backends per the spec's honesty table.

**Architecture:** `packages/uxfactory-plugin/ui/` is a new Vite root building a single inlined `ui.html`; `src/code.ts` (main thread) stays esbuild and gains storage/file-info/insert-icon handlers; the bridge gains additive `/project/*`, `/stats`, `/logs` routes. Screens are React components over Zustand stores and typed lib clients; fixture seams live behind the same interfaces.

**Tech Stack:** Vite 6, React 18, TypeScript, Tailwind v4 (`@tailwindcss/vite`), Radix UI, Zustand 5, lucide-react, `vite-plugin-singlefile`, Vitest + @testing-library/react + jsdom; esbuild (main thread); Fastify (bridge).

## Global Constraints

- **Authoritative requirements:** each screen's PRD in `.plans/panel/` (committed). Implementers MUST read their screen's PRD file — layout anatomy, behaviors, state tables, and the numbered acceptance criteria are requirements, not suggestions. The README's Decisions section binds (port `:3779`; Style→classification; Coherence experimental hint; design-unit granularity retained).
- **Manifest is untouchable:** `networkAccess` stays exactly as-is (localhost:3779 only). The built `ui.html` must be fully self-contained — no external `src=`/`href=`/`url(` refs (build-smoke enforces).
- **Real-vs-fixture:** follow the spec §5 table exactly (`docs/superpowers/specs/2026-07-02-uxfactory-panel-redesign-v1-design.md`). Fixture seams are interfaces in `ui/lib/` with implementations in `ui/fixtures/` — never inline mock data in components.
- **Engine untouched** (`packages/uxfactory-{spec,gate,cli}` and `clients/*` and `skill/*`): only `packages/uxfactory-plugin` and `packages/uxfactory-bridge` change.
- **Legacy panel modules stay in-tree and their tests stay green** (pipeline-view/panel-state/chips/ui.ts are no longer mounted but not deleted).
- **Gates for every task:** `pnpm --filter @uxfactory/plugin test` green; `pnpm --filter @uxfactory/plugin typecheck` 0 errors (extend tsconfig.typecheck to include `ui/`); `pnpm --filter @uxfactory/bridge test` green on bridge tasks; `pnpm -r build` green (build-smoke included).
- Commits on `main`; explicit paths only (never `git add -A`); every message ends `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Panel design tokens** (Tailwind theme; from `.plans/panel/README.md`): primary indigo `#5B5BD6` family (50–900 scale), success green, warn amber, fail red; radius 8–12px cards; 8pt spacing; pill chips (selected = indigo-50 bg + indigo-600 border/text + semibold).

## File map (created across tasks)

- T1 scaffold: `ui/{main.tsx,app.tsx,panel.css}`, `vite.config.ts`, deps, `scripts/build-plugin.mjs` orchestration, tsconfig updates, build-smoke.
- T2 bus: `src/messages.ts` (+variants), `src/code.ts` (+handlers), `ui/lib/plugin-bus.ts`.
- T3 bridge: `packages/uxfactory-bridge/src/{server.ts,project.ts}` + tests.
- T4 kit: `ui/components/*` + tests.
- T5 stores/clients/routing: `ui/stores/{app,wizard,runs}.ts`, `ui/lib/bridge.ts`, boot routing + tests.
- T6–T13: one screen per task (`ui/screens/*.tsx` + tests) per the order below.
- T14: integration polish + E2E-lite + final gates.

---

### Task 1: Scaffold — Vite root, Tailwind tokens, singlefile build, orchestration

**Files:**
- Create: `packages/uxfactory-plugin/ui/main.tsx`, `ui/app.tsx`, `ui/panel.css`, `packages/uxfactory-plugin/vite.config.ts`
- Modify: `packages/uxfactory-plugin/package.json` (deps + scripts), `scripts/build-plugin.mjs`, `tsconfig.typecheck.json` (include `ui/`), `test/build-smoke.test.ts`, `packages/uxfactory-plugin/test/scaffold.test.ts` (only if its build assertions need the new ui path — manifest assertions unchanged)

**Interfaces:**
- Produces: a booting React shell (`<App/>` rendering the TitleBar with "UXFactory (Developer VM)" + placeholder body), built by `vite build` into a single inlined `dist/ui.html`; `buildPlugin(outDir)` still the one entry (esbuild code.js + vite ui.html) so build-smoke and `pnpm --filter @uxfactory/plugin build` behave as today.

- [ ] **Step 1: Add deps** to `packages/uxfactory-plugin/package.json` (devDependencies unless noted): `react`+`react-dom` (deps), `zustand` (dep), `lucide-react` (dep), Radix primitives used across screens (deps: `@radix-ui/react-tabs`, `@radix-ui/react-radio-group`, `@radix-ui/react-select`, `@radix-ui/react-tooltip`, `@radix-ui/react-dialog`, `@radix-ui/react-toggle-group`, `@radix-ui/react-progress`), and dev: `vite`, `@vitejs/plugin-react`, `tailwindcss@^4`, `@tailwindcss/vite`, `vite-plugin-singlefile`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`. Run `pnpm install`.

- [ ] **Step 2: `vite.config.ts`:**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";

export default defineConfig({
  root: path.join(__dirname, "ui"),
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: path.join(__dirname, "dist"),
    emptyOutDir: false,              // esbuild owns code.js in the same dir
    rollupOptions: { input: path.join(__dirname, "ui", "index.html") },
  },
});
```

Create `ui/index.html` (vite entry): minimal html with `<div id="root">` + `<script type="module" src="/main.tsx">`; vite emits it AS `dist/index.html` — the build orchestrator renames/writes it to `dist/ui.html` (keep the existing ui.html name contract with `code.ts`'s `__html__`).

- [ ] **Step 3: `ui/panel.css`** — Tailwind v4 entry with the token theme:

```css
@import "tailwindcss";
@theme {
  --color-primary-50: #eef2ff; --color-primary-100: #e0e7ff; --color-primary-500: #6366f1;
  --color-primary-600: #5b5bd6; --color-primary-700: #4f46e5;
  --color-success-600: #16a34a; --color-warn-600: #d97706; --color-fail-600: #dc2626;
  --radius-card: 10px;
}
```

- [ ] **Step 4: `ui/main.tsx` + `ui/app.tsx`** — minimal boot (`createRoot(document.getElementById("root")!).render(<App/>)`); `App` renders the TitleBar (logo tile, `UXFactory (Developer VM)`, close button posting `{type:"resize"...}`-adjacent close later — v1 close = `parent.postMessage({pluginMessage:{type:"close"}}...)` deferred to T2; placeholder body "Loading…").

- [ ] **Step 5: Orchestrate in `scripts/build-plugin.mjs`:** after the existing esbuild steps, run vite programmatically (`const { build } = await import("vite"); await build({ configFile: path.join(root, "vite.config.ts") })`), then move `dist/index.html` → `outDir/ui.html`. Preserve the outDir parameter contract (temp-dir builds for the smoke test — pass the outDir through env or inline config override).

- [ ] **Step 6: Update `test/build-smoke.test.ts`:** keep existing assertions (non-empty code.js, ui.html exists) and ADD: `ui.html` contains `id="root"`, contains NO `src="http`, `href="http`, or `url(http` substrings (self-containment canary), and includes an inlined `<script>` (module inlined by singlefile).

- [ ] **Step 7: tsconfig.typecheck.json** includes `ui/**/*` with `"jsx": "react-jsx"`, DOM lib for ui files (a `ui/tsconfig.json` project reference or a second typecheck config — match how the package's typecheck currently handles DOM-needing files, e.g. mirror `validate.dom` patterns; simplest: add `ui` include + `"jsx":"react-jsx"`,`"lib":["ES2020","DOM"]` to `tsconfig.typecheck.json` since the plugin's src already typechecks against DOM-ish usage in ui.ts).

- [ ] **Step 8: Gates + commit** — `pnpm --filter @uxfactory/plugin test` (build-smoke now exercises vite), `typecheck` 0 errors, `pnpm -r build`.

```bash
git add packages/uxfactory-plugin/package.json packages/uxfactory-plugin/vite.config.ts packages/uxfactory-plugin/ui packages/uxfactory-plugin/scripts/build-plugin.mjs packages/uxfactory-plugin/tsconfig.typecheck.json packages/uxfactory-plugin/test/build-smoke.test.ts pnpm-lock.yaml
git commit -m "feat(plugin): Vite+React+Tailwind panel scaffold with singlefile ui build

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Plugin bus — ui↔main protocol additions

**Files:**
- Modify: `packages/uxfactory-plugin/src/messages.ts`, `packages/uxfactory-plugin/src/code.ts`
- Create: `packages/uxfactory-plugin/ui/lib/plugin-bus.ts`
- Test: `packages/uxfactory-plugin/test/plugin-bus.test.ts` (ui side, jsdom), extend `test/code.test.ts` (main side)

**Interfaces:**
- `UiToMain +=`
  `{ type: "storage-get"; key: string } | { type: "storage-set"; key: string; value: unknown } | { type: "file-info-request" } | { type: "insert-icon"; name: string; svg: string; size: number } | { type: "notify"; message: string } | { type: "close" }`
- `MainToUi +=`
  `{ type: "storage-value"; key: string; value: unknown } | { type: "file-info"; name: string; fileKey: string } | { type: "icon-inserted"; nodeId: string }`
- `plugin-bus.ts` exports `createBus(post?, listen?)` → `{ storageGet<T>(key): Promise<T|undefined>, storageSet(key, value): Promise<void>, fileInfo(): Promise<{name, fileKey}>, insertIcon(name, svg, size): Promise<string>, notify(msg): void, close(): void, onSelection(cb): () => void }` — promise-based request/response with per-request correlation via key/type matching and 5s timeouts (reject → callers fail soft).

**Main-side handlers in `code.ts` `handleMessage`:** `storage-get`→`figma.clientStorage.getAsync`; `storage-set`→`setAsync`; `file-info-request`→`{name: fig.root.name, fileKey: fig.fileKey ?? ""}`; `insert-icon`→`figma.createNodeFromSvg(svg)` sized to `size`, placed at viewport center, plugin-data `{assetSet:"lucide", assetId:name}`, reply `icon-inserted`; `notify`→`figma.notify(message)`; `close`→`figma.closePlugin()`. Extend the `FigmaApi` seam + `figma-mock.ts` (`clientStorage` map impl, `createNodeFromSvg`, `notify`, `closePlugin`, `viewport.center`).

TDD: bus tests with a fake postMessage pair (round-trips, timeout rejection); code.test.ts cases per handler through `__send`. Gates + commit (`feat(plugin): typed ui↔main bus — storage, file info, icon insert`).

---

### Task 3: Bridge — project/panel routes

**Files:**
- Create: `packages/uxfactory-bridge/src/project.ts` (route plugin: all `/project/*` + `/stats` + `/logs`)
- Modify: `packages/uxfactory-bridge/src/server.ts` (register; start-time = server boot for uptime; ring-buffer logger hook; runsRelayed counter increments where pipeline results post)
- Test: `packages/uxfactory-bridge/test/project.test.ts` (fastify inject; temp-dir project fixtures)

**Interfaces (exact contracts — the ui `lib/bridge.ts` in T5 consumes verbatim):**

```ts
POST /project/connect  {repoPath: string}
  → 200 {ok:true, snapshot: ProjectSnapshot}
  | 200 {ok:false, reason:"not-found"|"not-a-root"|"bridge-serves-different-root", served?: string}
GET  /project/snapshot → ProjectSnapshot
PUT  /project/classification  ClassificationBody → {ok:true}     // pretty-JSON uxfactory.classification.json
PUT  /project/profile  {visual,editorial,coverage,flow: "low"|"medium"|"high", style?: string, coherence?: string}
  → {ok:true}   // merges into uxfactory.profile.json scope; style ALSO into classification; coherence under profile.experimental
GET  /project/links → {links: Link[]}        // Link = {nodeId, unitName, unitType, acId}
PUT  /project/links {links: Link[]} → {ok:true}   // whole-set write to .uxfactory/links.json
POST /project/open {path} → {ok:true} | 400   // exec platform opener; REJECT paths outside root (resolve+prefix check)
GET  /stats → {version, uptimeMs, runsRelayed, tokenCount: number|null}
GET  /logs?tail=200 → {lines: string[]}       // ring buffer (append on each request via fastify onResponse hook, cap 500)

ProjectSnapshot = {
  name: string;               // basename(root)
  root: string;
  hasClassification: boolean; hasProfile: boolean;
  classification: Record<string,unknown> | null;
  profile: Record<string,unknown> | null;
  artifacts: { key: string; group: "product"|"ia-ux"|"design"|"assets"; label: string;
               status: "up-to-date"|"draft"|"missing"; meta: string; path: string|null }[];
  requirements: { id: string; title: string }[];   // parsed from the stories/AC file when present
}
```

**Artifact concern registry (fixed v1 taxonomy → snapshot rows):** product: `brief` (`brief.md`|`design/brief.md`), `requirements` (registry stories path); ia-ux: `sitemap` (`design/sitemap.*`), `flows` (`design/flows.*`); design: `brand-colors`,`palettes`,`fonts`,`grid` (single `design/design-system.json` sections when present else missing), `tokens` (registry tokens path — meta `N colors`); assets: `icons` (`design/assets/icons.json`), `photography` (`design/assets/photography.json`), `illustrations` (`design/assets/illustrations.json`). Status: exists+parses→`up-to-date`; exists+unparseable or `"draft":true`→`draft`; absent→`missing`. Requirements parse: stories file → `stories[].acceptanceCriteria[]` flattened to `{id: story.id + "-" + index (or ac.id if present), title: statement}`.

TDD with temp fixture projects (empty, classified, full Meridian-shaped). Verify open-path containment (attempt `../../etc` → 400). Gates: bridge tests + `-r build`. Commit (`feat(bridge): project snapshot/connect/writes, links store, stats and logs`).

---

### Task 4: UI kit — shared components

**Files:**
- Create: `packages/uxfactory-plugin/ui/components/{Chip.tsx,ChipGroup.tsx,Segmented.tsx,Card.tsx,StatusPill.tsx,RadioCard.tsx,Field.tsx,SectionHeader.tsx,Row.tsx,Toast.tsx,index.ts}`
- Test: `packages/uxfactory-plugin/test/ui-kit.test.tsx`

**Contracts (all Tailwind-styled, PRD README anatomy):**
- `Chip {label, value?, selected?, onSelect?, tone?: "default"|"dial"}` — pill; selected = indigo-50 bg/indigo-600 border+text/semibold.
- `ChipGroup {options, value | values, onChange, multi?}` — Radix ToggleGroup (single/multi), roving focus.
- `Segmented {options: {label, value}[], value, onChange, ariaLabel}` — Radix RadioGroup styled as the mocks' full-width 3-cell control.
- `StatusPill {status: "connected"|"disconnected"|"reconnecting"|"running"|"checking"|"down", label?}` — dot+label pill, ARIA live.
- `RadioCard {selected, onSelect, title, badge?, children}` — the setup start-mode cards.
- `Card`, `SectionHeader` (uppercase muted), `Row` (dot+name+meta+trailing action), `Field {label, error?, children}`, `Toast` host (Zustand-driven, T5).
- RTL tests: selection semantics, multi vs single, keyboard arrows in Segmented/ChipGroup, pill ARIA.

Gates + commit (`feat(plugin): panel UI kit — chips, segmented, cards, pills`).

---

### Task 5: Stores, bridge client, boot routing

**Files:**
- Create: `ui/stores/app.ts`, `ui/stores/wizard.ts`, `ui/stores/runs.ts`, `ui/lib/bridge.ts`, `ui/lib/dials.ts`
- Modify: `ui/main.tsx`, `ui/app.tsx` (Shell: TitleBar + ContextBar + TabNav + screen switch)
- Test: `test/stores.test.ts`, `test/bridge-client.test.ts`, `test/routing.test.tsx`

**Contracts:**
- `app.ts`: `{ connection: {status:"none"|"connecting"|"connected"|"reconnecting"|"error", endpoint, repoPath, mode:"local"|"cloud"}, fileInfo, snapshot: ProjectSnapshot|null, route: {screen:"connect"|"setup-1"|"setup-2"|"tabs", tab:"prompt"|"artifacts"|"components"|"assets"|"checks"|"settings"}, toasts }` + actions (`connectSucceeded(snapshot)` routes per PRD: `hasClassification ? tabs : setup-1`), `refreshSnapshot()`.
- `wizard.ts`: classification draft (defaults per PRD 01 screenshot state) + defaults draft (per PRD 02 suggestions given classification) + `suggestFor(classification)`; drafts survive Back.
- `runs.ts`: recent runs `{id, prompt, unitType, status:"generating"|"checked"|"warnings"|"failed", warnings?, progress?: {phase, note}}[]`, persisted via bus storage (`runs:v1:<fileKey>`), max 20; actions for enqueue/progress/complete.
- `lib/bridge.ts`: typed fetch client for ALL routes (T3 contracts + existing `pipeline/*`, `rendered`, `verify`, `health`) with `BASE = "http://localhost:3779"`; every method throws typed `BridgeError` on non-ok.
- `lib/dials.ts`: the PRD 02 label↔engine-vocab maps (`Shallow↔low` etc.) — pure, tested.
- Boot in `main.tsx`: bus.fileInfo → storageGet connection → none→connect; else health+`/project/snapshot` → route (stale conn → connect with prefill + auto-reconnect w/ visible cancel per PRD 00 §5).
- Shell: ContextBar renders snapshot chips (collapsed: category+layout+`+N`) + StatusPill + expand (v1: expands inline to full chip rows — the Artifacts expanded-header treatment lives in T10); TabNav = Radix Tabs; non-built tabs render placeholder cards until their tasks land.
- Routing tests: each boot decision path with fake bus+fetch.

Gates + commit (`feat(plugin): panel stores, bridge client, boot routing and shell`).

---

### Task 6: Connect screen

**Files:** Create `ui/screens/Connect.tsx`; test `test/screen-connect.test.tsx`. Modify `ui/app.tsx` (route mount).

**Requirements source:** `.plans/panel/00-connect-PRD.md` — implement §3 layout (hero band, mode segmented, explainer, bridge pill w/ 3s poll, repo field, CTA, caption), §4 behaviors (connect flow incl. the three error kinds + `bridge-serves-different-root` hint copy), §5 state table, Cloud stub card. Headline uses live `fileInfo.name`. Persist connection via bus storage on success; route per snapshot.
**Tests:** PRD §7 acceptance criteria 1–7 (bridge-down command copy, invalid-path field errors by kind, prefill, cloud stub selectable, keyboard/ARIA) with fake bridge client + bus.

Gates + commit (`feat(plugin): Connect screen`).

---

### Task 7: Setup screens (classification + generation defaults)

**Files:** Create `ui/screens/SetupClassification.tsx`, `ui/screens/SetupDefaults.tsx`; tests `test/screen-setup1.test.tsx`, `test/screen-setup2.test.tsx`.

**Requirements source:** `.plans/panel/01-…` and `02-…` PRDs — scan-variant headings (§4 table of 01), the six classification controls with screenshot defaults, start-mode radio cards (badge from scan), wizard footer; the six dial segmented controls with suggestion engine + "Suggested for {Category · Industry}" line, coverage caption verbatim, binding-consequence tooltips (Radix Tooltip), Save & continue → `PUT /project/classification` + `PUT /project/profile` (via `lib/dials.ts` mapping; style→classification; coherence→experimental) → tabs.
**Tests:** 01 §6 criteria 1–5 and 02 §6 criteria 1–6 (suggestion updates on classification change unless user-edited; persisted values win on re-entry; engine-vocab payload asserted on the fake client).

Gates + commit (`feat(plugin): setup wizard — classification and generation defaults`).

---

### Task 8: Prompt screen

**Files:** Create `ui/screens/Prompt.tsx`; test `test/screen-prompt.test.tsx`.

**Requirements source:** `.plans/panel/03-prompt-PRD.md`. Composer (textarea, unit-type dropdown chip via Radix Select: Page/Template/Organism/Molecule, platform chip from classification, circular submit); GROUNDED-IN chips computed from `snapshot.artifacts` freshness (✓/!/hollow + deep-link to Artifacts tab anchor); RECENT list bound to `runs` store with live progress line (SSE via existing `pipeline-client` contract — reuse `createPipelineClient` from `src/` in the ui build (it's DOM/fetch-only; import path `../../src/pipeline-client.js` or re-export) OR implement a thin `lib/events.ts` SSE reader matching `/pipeline/events`; pick whichever keeps typecheck clean and note it); submit → `POST /pipeline/request {kind:"generate-design", …spec §5 payload}`; empty-artifacts callout; `View` → select/zoom via bus (nodeIds from landing report when present — else zoom-to-page fallback) + switch to Checks tab scoped to the run.
**Tests:** PRD §6 criteria 1–7 (enqueue payload shape, generating row, status flips on completion event, chips freshness, empty-state callout, composer persistence).

Gates + commit (`feat(plugin): Prompt screen — generate, grounding, recent runs`).

---

### Task 9: Tier shim + Checks screen

**Files:** Create `ui/lib/tiers.ts`, `ui/screens/Checks.tsx`; tests `test/tiers.test.ts`, `test/screen-checks.test.tsx`.

**Requirements source:** `.plans/panel/07-checks-PRD.md` + spec §5 Checks row.
**`lib/tiers.ts`:** `toTierModel(input: {batchReport?|verifyResult?|craftReport?}): TierModel` — map today's findings: batch `render-coverage`→T1 rows; `a11y`/`contrast`/`token-conformance`→T2 (`a11y.*`,`contrast.*`,`token.*` display ids with expected/actual + node targets from axe/finding payloads); verify gate checks (editorType/counts/presence/geometry)→T3 `conform.*`; craft-report→VLM row (`craft N/5 · pass|fail`, dims as sub-findings); T0 = schema-valid implicit ✓ unless a validation error payload exists. Skip semantics: first failing tier expands; later tiers `skipped — short-circuit`; VLM `requires local pass` when any local tier failed. Pure + fixture-tested against a real Meridian `report.json` shape.
**Screen:** run banner (unit/profile/duration/`escalation skipped`/run #N), tier rows, finding cards (rule id, message, expected/actual, node ref → bus select/zoom; deleted-node note), footer `Copy report` (markdown to clipboard) + `Annotate N failures on canvas` → existing annotation path (`UiToMain review` message with a findings-shaped report — reuse `drawReview` contract; verify its input shape in `src/annotation-plan.ts` and adapt), `Clear annotations` follow-up, run-history dropdown (plugin-storage index, last 20, read-only render), states per PRD §5 incl. live tier fill from run progress events.
**Tests:** PRD §7 criteria 1–8 (shim mapping fixtures; annotate idempotence via fake bus; copy report determinism; history reload; clean-run banner + VLM craft summary).

Gates + commit (`feat(plugin): Checks screen with tier model over live gate reports`).

---

### Task 10: Artifacts screen

**Files:** Create `ui/screens/Artifacts.tsx`; test `test/screen-artifacts.test.tsx`. Modify `ui/app.tsx` ContextBar (expanded-header treatment lives here per PRD).

**Requirements source:** `.plans/panel/04-artifacts-PRD.md`. Expanded header (full chip set incl. dial chips; active dial chip opens the quick-dial row — Visual per screenshot; writes profile via dials map + toast "Applies to new runs"); heading + freshness rollup (`N of M up to date` from snapshot); grouped inventory (Row component: dot/name/meta/`Open`|`Create`); `Open`→`POST /project/open`; `Create`/`Regenerate`→`POST /pipeline/request {kind:"generate-artifact", artifact:key}` with inline `generating…` and snapshot refresh on completion; draft rows hover `Regenerate`; classification chip click → setup-1 edit mode (route with prefill).
**Tests:** PRD §6 criteria 1–7 (rollup math, open call args, create job inline progress → row flip via refreshed snapshot fake, quick dial persists+chip updates, keyboard landmarks).

Gates + commit (`feat(plugin): Artifacts screen — inventory, freshness, quick dial`).

---

### Task 11: Components screen

**Files:** Create `ui/screens/Components.tsx`; test `test/screen-components.test.tsx`. Modify `src/code.ts` selection payload only if missing fields (unit name/id/size exist in `SelectionPayload` — extend `styles in use` count main-side: count distinct fills/strokes/text styles in the selected subtree, additive field).

**Requirements source:** `.plans/panel/05-components-PRD.md`. Selection card bound to bus `onSelection` (name, unit-type Select persisted into links store row, node id → bus select/zoom, `47 styles in use` from the extended payload, sync badge from snapshot `uxfactory.map.json` presence: `✓ In sync` if node mapped, `not mapped` else — drift deferred); Requirement Select from `snapshot.requirements` + `Link` (PUT links whole-set); LINKED COMPONENTS list (rollup `x of y linked` where y = units present in links ∪ selection-known units; rows per PRD anatomy; unlink on hover; `missing on canvas` when bus lookup fails + `Relink`); sticky `Check my design` → enqueue check run scoped to linked node ids → Checks tab.
**Tests:** PRD §6 criteria 1–7 (selection sync <500ms with fake bus, link persistence round-trip, rollup, missing-node flag, AC click opens requirement (open call), zero-AC callout).

Gates + commit (`feat(plugin): Components screen — unit↔requirement linking`).

---

### Task 12: Assets screen

**Files:** Create `ui/screens/Assets.tsx`, `ui/fixtures/assets.ts`; test `test/screen-assets.test.tsx`.

**Requirements source:** `.plans/panel/06-assets-PRD.md` + spec honesty table. ICONS real: names from the icons artifact when present (else the PRD default Lucide set list in fixtures), tiles render lucide-react components dynamically (`import * as icons` map — ensure tree-shaking stays acceptable: import the curated subset list, not the whole set; build-smoke watches bundle growth), click → `bus.insertIcon(name, renderToStaticSvg(icon), 24)` (serialize the SVG via `renderToStaticMarkup`), `All 312` expanded grid w/ virtualized scroll (simple windowing, no dep); search across sections; PHOTOGRAPHY + ILLUSTRATIONS per fixtures with real `Create` enqueue for illustration style; footer hint line.
**Tests:** PRD §6 criteria 1,2(insert call shape incl. plugin-data tagging via bus),4,5,6,7 — criterion 3 (checks-fixture) deferred-with-reason (asset-usage check is engine follow-up).

Gates + commit (`feat(plugin): Assets screen — lucide grid, insert, registries`).

---

### Task 13: Settings screen

**Files:** Create `ui/screens/Settings.tsx`; test `test/screen-settings.test.tsx`.

**Requirements source:** `.plans/panel/08-settings-PRD.md` + spec corrections. Bridge card: `/stats` polled 10s (endpoint copyable; version; uptime `2h 14m` formatting; runs relayed; token index count or `—`), `Restart` → copyable command + tooltip (v1 decision), `View logs` → Radix Dialog drawer tailing `/logs` (200 lines, refresh button; live-follow = 2s repoll toggle); Subscription: `Local only — no subscription` real state; Agent skills: bridge-served list (extend `/stats` or a `GET /skills` addition in this task — bridge lists `skill/*/SKILL.md` names; rev = short hash of file content; add route + test in `packages/uxfactory-bridge`); File storage: estimate via bus (sum of stored keys' JSON length) vs 100kb budget bar + amber `Compact` (drops runs index beyond last 5).
**Tests:** PRD §6 criteria 1,3,4(no key string ever rendered — assert absence),5,6,7 (2 deferred-with-reason: restart is v1-stub).

Gates + commit (`feat(plugin,bridge): Settings screen — stats, logs, skills, storage meter`).

---

### Task 14: Integration polish + E2E-lite + final gates

**Files:** Modify `ui/app.tsx` (remove placeholders), `test/e2e-panel.test.tsx` (new), any stragglers.

- [ ] Full route walk tests: connect→setup-1→setup-2→tabs; reconnect path; each tab mounts its screen (no placeholders left).
- [ ] Toast host + reconnect banner global behaviors verified.
- [ ] Legacy panel NOT mounted anywhere (grep `wirePanel(` usages — only legacy tests); legacy suites still green.
- [ ] Bundle sanity: `dist/ui.html` < 1.5MB inlined; build-smoke self-containment passes.
- [ ] Full gates: plugin tests + typecheck, bridge tests, `pnpm -r build`, engine/worker suites untouched-and-green.
- [ ] Commit (`feat(plugin): panel redesign v1 complete — all screens wired`).

---

## Notes for the implementer

- **Read your screen's PRD file first — it is the requirement source.** The spec's §5 honesty table decides real-vs-fixture; fixtures only behind `ui/fixtures/` interfaces.
- **jsdom + Radix:** some Radix primitives need `ResizeObserver`/`PointerEvent` shims in test setup — add a shared `test/setup-ui.ts` (vitest `setupFiles`) the first time it bites.
- **`renderToStaticMarkup`** for icon SVG serialization comes from `react-dom/server` — verify singlefile/bundle impact once (T12).
- **Do not touch** `src/pipeline-view.ts`/`panel-state.ts`/`chips.ts`/`ui.ts` beyond imports/re-exports explicitly named; their tests are the legacy canary.
- The **Meridian scratch project** (`live-project` in the session scratchpad) is the acceptance fixture for shapes (reports, classification, requirements) — copy shapes into test fixtures, don't reference the scratchpad path in tests.

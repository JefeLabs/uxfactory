# UXFactory — HTML Design Tier, SP1: Verifiable HTML Loop design

**Date:** 2026-06-30
**Status:** draft — awaiting user review
**Part of:** the **HTML high-fidelity design-generation tier** — the PRD's deferred "generation subsystem — forthcoming" (`UXFactory-Implementation-PRD.md` §1, G10). Decomposed into three sequential sub-projects: **SP1 (this doc) — verifiable HTML loop spine** → SP2 vision rubric judge → SP3 Figma landing (HTML→DesignSpec→plugin). SP2 and SP3 both consume SP1's outputs (screenshots, rendered DOM), so the spine is built first.
**Builds on:** the existing deterministic batch gate (`packages/uxfactory-cli/src/batch/*`: `run.ts` pure `runBatch`, `checks.ts`, `registry.ts`, `scope.ts`), the headless-Chromium raster path (`cli/src/render/raster-playwright.ts` + `raster-select.ts` — already a `playwright` dep), the `generate-design` generative worker kind (`clients/uxfactory-worker/src/{dispatch,generative,batch-registry}.ts`), and the `skill/design` agentic loop.
**Amends:** the working assumption that the generation tier authors `*.uxfactory.json` node-specs. In this tier the AI authors **real HTML+CSS+JS** and the gate evaluates the **rendered result** — the evaluation path the Design-Artifacts PRD already models as gate evidence `screenshot | diff | failing_ac_id | token_violation | axe_finding`.

## 1 · Goal

Let the AI author **real, self-contained HTML+CSS+JS** screens that cover a project's stories + acceptance criteria, render them **headless**, and drive a **deterministic gate over the rendering** (coverage, a11y, contrast, design-token conformance) to a green bar — the same author→gate→read-report→revise→green loop as today, but the artifact is HTML and the gate judges a screenshot + rendered DOM, not node names. SP1 ships a working, independently-usable tier: *AI writes HTML, gated green against actual renderings.*

## 2 · The load-bearing decision: async render → deterministic snapshot → pure gate

`runBatch` is **fully synchronous and pure** by invariant ("no async, no clock, no randomness, no judge/LLM" — `run.ts:74`). HTML rendering (Chromium) is inherently async. SP1 does **not** make the gate async. It mirrors the render-report / verify split the PRD already draws (§7.4 / §10):

```
[async — command layer]                              [pure — deterministic gate]
load HTML pages + trace.json
  → for each (page, view):
       launch Chromium (existing dep)
       activate view → settle → screenshot PNG
       capture RenderSnapshot (resolved cover
       selectors · painted colors · axe run) ───────▶ pure checks over RenderSnapshot[]
                                                          • render-coverage
                                                          • a11y
                                                          • contrast
                                                          • token-conformance
```

The async browser I/O is quarantined in a **render stage** that emits a compact, deterministic `RenderSnapshot`. The gate checks remain **pure functions over that snapshot**, exactly as today's checks are pure over `LoadedSpec[]`. Consequences: the engine purity/determinism invariant is untouched; the checks are unit-testable with hand-built snapshots and **no browser**; gate stability comes from judging structured DOM + axe results, never flaky pixels. The existing `raster-playwright` (async render outside pure `runBatch`) already establishes this pattern — SP1 widens it from SVG→PNG to HTML→snapshot.

## 3 · The unit of work: `(page, view)`

- **Page** — a navigable HTML document / route (`design/screens/checkout.html`). One story's flow may span **many pages** (multi-page).
- **View** — a render-*state* of one page (empty / loading / error / success / edge — the impliedStates), reached by driving the page's own JS. One page hosts **many views** (multi-view).
- The **view is the unit** that gets its own activation → screenshot → snapshot → coverage record. A 3-view page renders 3 times from one file.

**Viewports are out of SP1.** A view is a single render at one default viewport (390×844, the existing spec default). Responsive breakpoints are an explicitly-requested opt-in: `trace.json` reserves an optional `viewports` field that SP1 **validates but does not act on** — a later phase iterates view × viewport and adds responsive checks.

## 4 · `trace.json` — the AI-emitted coverage manifest

Two-level `pages[] → views[]`. Selector-agnostic (`data-*` is a recommended convention, not required). The gate keeps it honest by verifying each claimed selector against the **live, activated DOM**.

```json
{
  "version": 1,
  "pages": [
    {
      "file": "screens/checkout.html",
      "views": [
        { "id": "success",
          "activate": { "hash": "view=success" },
          "covers": [ { "story": "checkout", "impliedState": "success", "selector": "[data-ac='checkout-success']" } ] },
        { "id": "error",
          "activate": { "click": ["#pay"] },
          "covers": [ { "story": "checkout", "impliedState": "error", "selector": "[data-ac='checkout-error']" } ] }
      ]
    },
    {
      "file": "screens/cart.html",
      "views": [
        { "id": "empty",
          "covers": [ { "story": "cart", "impliedState": "empty", "selector": "main .empty-cart" } ] }
      ]
    }
  ]
}
```

**Schema (validated, never-throws loader — mirrors `registry.ts` style):**

- `version` — must be `1`.
- `pages[]` — each: `file` (string, relative to the screens dir, must exist and be `.html`); `views[]` (≥1); optional `viewports` (reserved, SP1 validates `string[]` then ignores).
- `views[]` — each: `id` (string, unique within the page); optional `activate` (one of the activation forms in §6); `covers[]` (≥1).
- `covers[]` — each: `story` (string), `impliedState` (one of `empty|loading|error|success|edge`), `selector` (string CSS selector).

Invalid trace → `uxfactory batch` exit **2** (setup error), with a precise message (not a quality FAIL).

## 5 · `RenderSnapshot` — the contract between render stage and checks

Purpose-built (not a full DOM dump): the render stage resolves exactly what the pure checks need.

```ts
type ImpliedState = "empty" | "loading" | "error" | "success" | "edge";

interface RenderSnapshot {
  page: string;            // trace pages[].file
  view: string;            // views[].id
  viewport: { width: number; height: number };
  screenshot: string;      // relative path under .uxfactory/batch/previews/
  ok: boolean;             // false → render/activation/settle failed
  error?: string;          // present iff ok === false
  coverChecks: {           // one per covers[] entry for this (page, view)
    story: string; impliedState: ImpliedState; selector: string;
    found: boolean;        // selector resolved ≥1 element
    visible: boolean;      // rendered + non-zero box + not display:none/visibility:hidden/opacity:0
                           // (independent of scroll position — below-the-fold still counts as covered)
  }[];
  paintedColors: {         // distinct computed colors actually painted on visible elements
    hex: string;           // #RRGGBB, normalized
    exampleSelector: string;
  }[];
  axe: {                   // axe-core violations for this view (one run)
    id: string;            // rule id, e.g. "color-contrast", "image-alt"
    impact?: "minor" | "moderate" | "serious" | "critical";
    targets: string[];     // selectors of offending nodes
    help?: string;
  }[];
}
```

Determinism: `coverChecks` ordered by `covers[]`; `paintedColors` deduped by hex + stable-sorted; `axe` stable-ordered by `(id, target)`. Pixels are never read by a check.

## 6 · Activation + settle contract

The render stage drives a page into a view with a **declarative, eval-free** vocabulary (keeps rendering deterministic, no arbitrary `eval`):

- *(none)* → the page as-loaded is the view.
- `{ "hash": "view=error" }` → set `location.hash`, dispatch `hashchange`.
- `{ "query": "state=error" }` → navigate to `file://<page>?state=error`.
- `{ "click": ["#pay", ".retry"] }` → click selectors in order (tab/stepper/flow-driven views).

**Settle** (before capture): Playwright `networkidle` → `document.fonts.ready` → if `window.uxfReady` is thenable, await it (bounded by a 5 s timeout) — this is how `loading` views and async data declare "painted." Before capture the stage injects a reduced-motion + animation-freeze stylesheet and fixes the browser-context locale/timezone for stability.

**Capture** (one in-page evaluate): screenshot (full page); resolve each `covers[].selector` → `found`/`visible`; walk visible elements collecting computed `color`/`background-color`/`border-color` (alpha > 0, area > 0) → `paintedColors`; inject axe-core and run `axe.run()` → `axe`.

**Render failure is loud, never silent.** Page load error / missing activation selector / settle timeout → `ok: false` + `error`; that view's `coverChecks` are all `visible: false` and its axe/color data are empty. render-coverage then fails with `"<page> › <view> failed to render: <error>"`.

## 7 · The gate — four pure checks over `RenderSnapshot[]`

A parallel `HTML_GATE_ENTRIES` table (same shape/mechanism as `GATE_ENTRIES` in `run.ts`), selected when the batch is in HTML mode (§8). Same `CheckResult { id, status, severity, findings }`, same scope-binding via `GATE_THRESHOLDS`/`binds`, same `mustPassFailed`/`clean`/exit `0/1/2` semantics.

| id | severity | binds at | semantics & findings |
|---|---|---|---|
| **render-coverage** | must | always | For every story in `acceptance-criteria.json`, every **required impliedState** (the distinct `impliedState`s across its ACs) must be claimed by ≥1 `coverChecks` entry with `found && visible`. Findings: uncovered `(story, state)`; claimed-but-dead selector (`found:false`); claimed-but-invisible (`visible:false`); render failure. `ref` = `page › view › selector`. |
| **a11y** | must | visual ≥ medium | All **non-`color-contrast`** axe violations across views → findings (`detail` = rule help, `ref` = first target). |
| **contrast** | must | visual ≥ medium | The `color-contrast` axe violations (partition of the same run) → findings. |
| **token-conformance** | must | visual ≥ medium | Every `paintedColors[].hex` across all views must be a registered `tokens.ds.json` color (normalized, case-insensitive, 3/6-digit). Findings: each unregistered hex + `exampleSelector`. |

**Dial binding rationale:** the gate's `binds` is `AND`-across-declared-thresholds (a check runs only when scope meets *every* threshold it declares), so each check keys off a **single** dial. render-coverage always binds (every render owes its claimed states). a11y / contrast / token-conformance all bind at `visual ≥ medium` — at `visual: low` (greybox/wireframe) they are `not-owed` (real content/color isn't owed yet), so the common `visual: medium` design preset turns all four on together. (Promoting a11y to bind earlier than contrast is a possible later refinement; SP1 keeps the three visual checks aligned.) A `coverage-orphans` analog (a page/view covering no story) is **out of SP1** — advisory, deferred.

## 8 · HTML mode selection + registry inputs

`uxfactory.batch.json` `inputs` gains two optional paths (`registry.ts` `BatchInputs`):

```ts
interface BatchInputs {
  tokens?: string; stories?: string; flow?: string; reuse?: string[];  // existing
  screens?: string;   // NEW — dir of HTML pages, e.g. "design/screens"
  trace?: string;     // NEW — trace.json, e.g. "design/trace.json"
}
```

**Mode is registry-driven, no new CLI flag:** when both `screens` and `trace` resolve, `uxfactory batch` runs the **HTML** path (render stage → `HTML_GATE_ENTRIES`); otherwise the existing **spec** path (`GATE_ENTRIES` over `*.uxfactory.json`) is unchanged. The call site stays `uxfactory batch --json -- design`. Report + screenshots write to `.uxfactory/batch/report.json` and `.uxfactory/batch/previews/<page-basename>-<view>.png`.

## 9 · The authoring side — `skill/design/SKILL.md` (rewritten)

The LLM authoring half of the loop (engine stays content-free). Steps:

0. Read `design/acceptance-criteria.json`, `uxfactory.profile.json`, `uxfactory.batch.json` (unchanged inputs).
1. Author one self-contained `design/screens/<page>.html` per page (inline CSS+JS), using **semantic HTML** (real landmarks/labels/alt — a11y is gated), real copy honoring profile constraints, and exposing each view-state via the **activation contract** (respond to `#view=<id>`; expose `window.uxfReady` when fetching/animating; ensure each state's anchor selector is present + visible once activated).
2. At `visual ≥ medium`, author `design/tokens.ds.json` and use only those hexes for painted colors (the rendered colors are what `token-conformance` extracts).
3. Author `design/trace.json` (§4) mapping every required `(story, impliedState)` to a `(page, view, selector)`.
4. `uxfactory batch --json -- design` → read `.uxfactory/batch/report.json` → revise `must` fails → re-run. Stop at exit 0 or `maxIterations`.
5. Emit `UXF::PROGRESS {...}` at every step (unchanged marker contract).

The SKILL.md documents the exact `trace.json` schema, the activation/settle contract, and the four checks, with one worked example. cc-invariant preserved; `sk-…` masking preserved.

## 10 · Worker dispatch wiring

`generate-design` already routes generatively to `skill/design`. SP1 change is minimal: `clients/uxfactory-worker/src/batch-registry.ts` (`ensureBatchRegistry`) registers `inputs.screens = "design/screens"` and `inputs.trace = "design/trace.json"` (alongside stories/tokens) so HTML mode is selected, and `generative.ts` `TARGET_MAP`/path hints reference the screens dir. No new worker kind.

## 11 · Plugin (minimal in SP1)

The existing "Generate design (HD)" panel + loop feed already render iteration/phase/gate + `UXF::PROGRESS`. SP1 only ensures the new gate ids (`render-coverage`/`a11y`/`contrast`/`token-conformance`) display in the gate strip and the feed notes "N views rendered." **Screenshot thumbnails are deferred to SP3** (which adds the bridge→iframe image plumbing Figma landing also needs).

## 12 · Components & file layout

**Engine — `packages/uxfactory-cli`** (deterministic, offline, LLM-free):
- `src/batch/trace.ts` — `TraceManifest` types + never-throws loader/validator.
- `src/render/html-render.ts` — async render stage: `(pages, viewport, deps) → Promise<RenderSnapshot[]>`; browser dep **injected** (like `raster-select.ts`) so checks/CI run browserless; the only module importing `playwright` + `axe-core`, lazily.
- `src/batch/html-checks.ts` — the four pure checks + `HTML_GATE_ENTRIES`.
- `src/batch/registry.ts` — `+screens`, `+trace` inputs + validation.
- batch command (`cli.ts` / `batch/run.ts` caller) — mode branch: HTML → render → `HTML_GATE_ENTRIES`; spec → existing.

**Worker — `clients/uxfactory-worker`:** `batch-registry.ts` (+screens/trace), `generative.ts` (path hints).

**Skill — `skill/design/SKILL.md`:** rewritten authoring guide.

**Engine deps added:** `axe-core` (offline, MIT, runs in-page). `playwright` already present.

## 13 · Invariants / Global Constraints

- **Engine self-contained:** no LLM / helmsmith / agentcore / cloud in `packages/*`. Render stage (Playwright + axe-core) is offline + deterministic → permitted in the engine.
- **Gate purity:** `runBatch`-style checks stay pure + synchronous; all async (browser) lives in the render stage, never inside a check.
- **Exit contract unchanged:** `0` clean · `1` a binding `must` failed · `2` setup/missing-input.
- **TS ESM/NodeNext**, `.js` import specifiers, `verbatimModuleSyntax`, esbuild, vitest, prettier.
- **cc-invariant** on skills; `sk-…` masking; **never `git add -A`**; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; work on main, commit sequentially.

## 14 · Testing strategy

- **`html-checks.ts` (the bulk, no browser):** each of the four checks unit-tested over hand-built `RenderSnapshot[]` + `StorySet`/`TokenSet` — pass/fail/findings, scope-binding (`not-owed` below threshold), and edges: no stories, a render failure (`ok:false`), dead vs invisible selector, unregistered color, contrast-only vs other axe violations partitioning correctly.
- **`trace.ts`:** schema validation — valid manifest; bad `version`; missing `file`/`covers`; bad `impliedState`; reserved `viewports` accepted-then-ignored.
- **`html-render.ts`:** one integration test with a fixture HTML, browser dep **injected** (fake page) for deterministic field assertions; plus a real-Chromium-gated test (skipped if browser absent, per `raster-select`'s fallback) asserting a deliberately low-contrast + missing-alt fixture yields the expected `contrast`/`a11y` violations and a visible cover selector.
- **Mode selection:** registering `screens`+`trace` runs `HTML_GATE_ENTRIES`; absence keeps the spec path.
- **Worker:** `batch-registry` registers the new inputs.
- **Skill:** cc-invariant test; schema documented (no runtime test — it is a guide).

## 15 · Out of scope (SP1)

- **Vision rubric** (craft/brand scoring of screenshots) → **SP2**.
- **Figma landing** (DOM→DesignSpec extraction + plugin import) → **SP3**.
- **Responsive multi-viewport** rendering + checks → explicitly-requested future phase (schema reserves `viewports`).
- **Panel screenshot thumbnails** → SP3.
- **Multiple design directions** → future phase.

## 16 · Risks & mitigations

- **Render determinism** — mitigated: animation-freeze + reduced-motion injection, `fonts.ready` + `networkidle` + `window.uxfReady` settle, fixed viewport/locale/timezone; checks read structured DOM/axe, never pixels.
- **Color extraction completeness** — computed `color`/`background`/`border` only; gradients, box-shadow, image fills, and SVG `fill` are **not** token-checked in v1 (documented limitation; revisit if it lets ad-hoc color through).
- **axe-core injection/version** — pin a version; inject from the installed package, not a CDN (offline).
- **Full-page screenshots of tall pages** — acceptable; coverage reads the DOM, screenshots are evidence.
- **Selector stability in findings** — findings reference the AI's own trace selectors + axe targets, which the AI can act on directly.

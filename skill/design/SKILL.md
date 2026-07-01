---
name: uxfactory-design
description: "Author REAL high-fidelity UI screens as self-contained HTML+CSS+JS that cover a project's user stories and acceptance criteria, then drive the deterministic `uxfactory batch` gate — which renders each screen headless and gates the RENDERING (render-coverage · a11y · contrast · token-conformance) — to a green bar. Use WHENEVER the user wants production-shaped UI screens generated from stories/acceptance-criteria and gated PASS/FAIL against an actual rendering. You are the agentic loop: you author HTML, run the gate, read its report, revise, and stop when the gate is clean (exit 0) or the iteration budget is spent. Do NOT use it for the single-spec online render→verify loop (the main uxfactory skill) or for drafting one upstream artifact (the generate skill)."
compatibility: "Requires the uxfactory-cli (Node 20+) with a headless Chromium (Playwright) + axe-core available. Gating runs fully offline — no bridge or Figma needed. Self-contained: the engine renders + gates; you author the HTML."
---

# UXFactory — author real HTML screens, drive the rendering gate green

You are an autonomous designer-in-the-loop. Your job: turn a project's **stories + acceptance criteria** into **real `*.html` screens** (self-contained — inline CSS + JS) that pass the deterministic `uxfactory batch` gate at the project's render scope. You author the HTML; the engine **renders each screen headless and gates the rendering**. One `batch` call = one deterministic render+gate pass; its **exit code** stops you.

The loop is: **author HTML → gate (render + check) → read the report → revise → green.** Never spin: every draft/revise counts against `maxIterations`.

## Step 0 — Read the pinned context

- **`design/acceptance-criteria.json`** — the stories: `{ "stories": [ { "id", "role", "goal", "benefit", "acceptanceCriteria": [ { "statement", "impliedState" } ] } ] }`. `impliedState` ∈ `empty · loading · error · success · edge`. These are the requirements you must cover.
- **`uxfactory.profile.json`** — the pinned scope dials (`visual`/`editorial`/`coverage`/`flow`, each `low|medium|high`) + constraints. At `visual ≥ medium` the `a11y`, `contrast`, and `token-conformance` gates bind; honor every constraint.
- **`uxfactory.batch.json`** — `maxIterations` (your budget) and `inputs` (registry paths: `inputs.stories`, `inputs.tokens`, `inputs.screens`, `inputs.trace`). Write artifacts to the registered paths.

## Step 1 — Author REAL HTML screens (one file per page)

For each **page** write `design/screens/<page>.html` as a self-contained document (inline `<style>` + `<script>`; no external assets). Rules the rendering gate enforces:

- **Semantic, accessible HTML.** Real landmarks (`<main>`, `<nav>`, `<h1>`…), labels for inputs, `alt` on images, button text. The gate runs **axe-core** on the rendered DOM — `a11y` violations FAIL at `visual ≥ medium`.
- **Real copy + layout**, honoring profile constraints. A page hosts multiple **view-states** (empty/loading/error/success/edge).
- **Expose each view-state via the activation contract** so the gate can render it:
  - respond to `location.hash` like `#view=error` (re-render on `hashchange`), and/or
  - reach a state by a click sequence (e.g. a `#pay` button → the error view).
  - When a state does async work (a `loading` state, a fetch), expose `window.uxfReady` as a Promise that resolves once the view is painted — the gate awaits it (bounded 5 s) before screenshotting.
- **Colors come from tokens.** Every painted color (text/background/border) must be a registered token at `visual ≥ medium` (see Step 2).

## Step 2 — Author tokens (when `visual ≥ medium`)

Write `design/tokens.ds.json` = `{ "colors": { "<name>": "#RRGGBB", … } }` registering EVERY color your screens paint, and use those exact hexes (the gate extracts colors from the **rendered** page). Ensure `uxfactory.batch.json` `inputs.tokens` points at it. At `visual: low` tokens are not owed.

## Step 3 — Author `design/trace.json` (the coverage manifest)

Map every required `(story, impliedState)` to a `(page, view, selector)`. One story may span many pages; one page hosts many views. The gate verifies each `selector` is **present and visible** in that view's rendered DOM.

<!-- trace-example-start -->
```json
{
  "version": 1,
  "pages": [
    {
      "file": "screens/checkout.html",
      "views": [
        { "id": "success", "activate": { "hash": "view=success" },
          "covers": [ { "story": "checkout", "impliedState": "success", "selector": "[data-ac='checkout-success']" } ] },
        { "id": "error", "activate": { "click": ["#pay"] },
          "covers": [ { "story": "checkout", "impliedState": "error", "selector": "[data-ac='checkout-error']" } ] }
      ]
    }
  ]
}
```
<!-- trace-example-end -->

Activation forms (exactly one per view, all eval-free): omit it (page as-loaded), `{ "hash": "view=error" }`, `{ "query": "state=error" }`, or `{ "click": ["#pay", ".retry"] }`.

## Step 4 — The loop: gate → read report → revise

```bash
uxfactory batch --json -- design
```

This renders each `(page, view)` headless, screenshots it to `.uxfactory/batch/previews/<page>-<view>.png`, runs the gate, writes `.uxfactory/batch/report.json`, and returns:

| Code | Meaning | What to do |
| ---- | ------- | ---------- |
| `0` | every binding `must` gate is green | **Stop.** Clean. |
| `1` | a binding `must` gate failed | read findings; revise; re-run |
| `2` | setup / missing input / renderer unavailable | fix setup (register inputs; ensure Playwright + axe-core) — NOT a quality signal |

On **exit 1**, act on each `must` check with `status:"fail"`:
- **render-coverage** — a `(story, state)` has no visible covering rendering, or a claimed selector didn't resolve / wasn't visible. Add/fix the view; make the selector present and visible when that view is activated.
- **a11y** — fix the axe violation (add `alt`, label the control, fix the role) in the HTML.
- **contrast** — raise the contrast of the offending text/background (and keep the colors registered tokens).
- **token-conformance** — the page painted a color that isn't a registered token: add it to `design/tokens.ds.json` or change the style to a registered hex.

## Step 5 — Stop

Stop at **exit 0** (clean) or when `maxIterations` is spent (surface best-effort screens + open findings). **Never spin** — never re-run the gate without changing anything.

## Progress feedback (emit at EVERY step)

Print one compact JSON line per step:

```
UXF::PROGRESS {"iter":<n>,"phase":"draft"|"gate"|"revise"|"done","gate":<gate-id-or-null>,"status":"pass"|"fail"|null,"findings":<count>,"note":"<short note>"}
```

- before drafting · after each `uxfactory batch` (the first failing gate id + status + findings count, or `status:"pass"`) · before each revise · once at the end (`phase:"done"`). Keep `note` SHORT and secret-free (never echo keys/tokens).

## Report

When you stop, report: the `design/screens/<page>.html` files written, whether `design/tokens.ds.json` was authored (and why — the `visual` dial), whether the gate reached **green** (exit 0) or hit the budget with open findings, and the **iteration count** spent.

# UXFactory HTML Design Tier — SP3b: DOM→DesignSpec Extractor (Design)

**Date:** 2026-07-01
**Status:** Design — awaiting user review before plan
**Parent:** SP3 (Figma landing), second of three sub-projects. Builds on SP3a (`2026-07-01-uxfactory-html-design-tier-sp3a-semantic-designspec-design.md`), which shipped the semantic `DesignSpec` target (auto-layout, nested frames, effects, per-corner radius) and its plugin render. SP3c (component detection + loop integration + landing) follows.

---

## 1. Context & goal

SP1/SP2 produce gated, craft-judged HTML screens. SP3a made `DesignSpec` able to *represent* a semantically structured design and the plugin able to *render* it as editable Figma nodes. **SP3b builds the deterministic extractor between them:** walk the rendered HTML DOM and emit a semantic `DesignSpec` — inferred auto-layout, nested frames, mapped styles — entirely in the engine: deterministic, LLM-free, offline.

**Decision (user):** layout inference is **aggressive** — flex, grid, *and* block flow all attempt auto-layout — made safe by a **geometric self-check** (§6): every inference is verified against the observed bboxes and reverts to absolute positioning (always faithful) on mismatch. No wrong layout can land.

**Non-goals (deferred):** component detection, loop integration, publish/landing (all SP3c); gradient/image fills (placeholder shapes in v1); 2-D grid auto-layout (SP3a's model is 1-D — absolute instead, never guessed); responsive variants; typography fidelity on `TextNode` (`fontSize`/`fontWeight`/`fontFamily` are not in SP3a's model — v1 lands text geometry + characters + fill; a small additive model+plugin extension is a candidate for SP3c). No worker or skill changes.

## 2. Architecture — two units, one browser pass

```
settled+frozen DOM (existing render pass)
  → EXTRACT_FN (in-page, string-form)      [NEW: render/dom-capture.ts]
      serializable CapturedNode tree
  → extractDesignSpec (pure, Node-side)    [NEW: extract/dom-to-designspec.ts]
      structure · pruning · layout inference · self-check · style mapping
  → DesignSpec  → validate() (@uxfactory/spec)  → *.designspec.json
```

- **`EXTRACT_FN`** follows the `CAPTURE_FN` convention exactly: a string-form function evaluated in-page (engine tsconfig stays DOM-free), running against the same settled+frozen DOM as the screenshot/axe pass — one settle, consistent data. Opt-in: `HtmlRenderRequest` gains `captureDom?: boolean`; `RenderSnapshot` gains `domTree?: CapturedNode` (both optional — `batch` is unaffected).
- **`extractDesignSpec`** is pure (no I/O, no clock, no randomness): `(views: ExtractedView[]) → DesignSpec`, where `ExtractedView = { page: string; view: string; viewport: {width,height}; tree: CapturedNode }`. All intelligence lives here, fixture-testable without a browser.

## 3. The capture tree (`CapturedNode`)

Per **visible** element (reusing `CAPTURE_FN`'s `visible()` logic — display/visibility/opacity/zero-size filtered):

```ts
interface CapturedNode {
  tag: string;                                  // lowercase tagName
  bbox: { x: number; y: number; width: number; height: number };  // absolute viewport coords
  text: string | null;                          // trimmed+collapsed textContent iff text-bearing leaf (§4)
  styles: {
    display: string;
    flexDirection: string; justifyContent: string; alignItems: string;
    rowGap: string; columnGap: string;
    gridTemplateColumns: string; gridTemplateRows: string;
    paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
    backgroundColor: string;                    // computed rgb/rgba
    borderTopWidth: string; borderRightWidth: string; borderBottomWidth: string; borderLeftWidth: string;
    borderTopColor: string;
    borderTopLeftRadius: string; borderTopRightRadius: string;
    borderBottomRightRadius: string; borderBottomLeftRadius: string;
    boxShadow: string;                          // computed list, parsed Node-side
    opacity: string;
    color: string;                              // text color
  };
  children: CapturedNode[];
}
```

Raw computed strings cross the wire; **all parsing happens Node-side** in the pure assembler (keeps `EXTRACT_FN` dumb and the logic testable). `id`/first-class are appended to `tag` for naming (`div#cart`, `button.pay`) via the existing `shortSel` convention.

## 4. Structure mapping

- **Container** (has element children) → nested `Frame`. **Leaf** → `ShapeNode` or `TextNode`.
- **Text:** an element whose children are only non-empty text nodes → `TextNode` (`characters` = whitespace-collapsed text, `fill` = `color` hex). Mixed content (element children + non-whitespace text runs): `EXTRACT_FN` measures each contiguous text run in-page with a DOM `Range` (`range.getBoundingClientRect()`) and emits it as a child `CapturedNode` with `tag: "#text"`, a real bbox, and the run's collapsed text — the assembler turns each into a `TextNode` positioned like any other child. (`#text` nodes carry `text` + `bbox` + the parent's `color`; their `styles` are otherwise ignored.)
- **Replaced/media elements** (`img`, `svg`, `canvas`, `video`, `picture`) → `ShapeNode` placeholder (bbox + `fill` from a fixed neutral `#E5E7EB`, name from tag) — v1.
- **Wrapper pruning** (div-soup collapse): a container with exactly one element child, **no visual signal** (fully transparent background, zero border widths, no box-shadow, all radii 0, opacity 1), and whose child bbox lies within 2px of the container's content box on every edge → the container is dropped and the child promoted (geometry preserved in the parent's coordinate space). Applied bottom-up, repeatedly (a 3-deep wrapper chain collapses fully).
- **The `<body>` element is the view root**: it becomes the top-level `Frame` for that view, sized to the viewport (fullPage height if taller).

## 5. Layout inference (aggressive)

Evaluated per container, in this order; the first matching source produces a **candidate** `AutoLayout`, which must then pass the self-check (§6) or the container falls back to absolute:

1. **Flex** (`display: flex | inline-flex`): `flex-direction` `row`→`horizontal`, `column`→`vertical` (`*-reverse` → absolute; SP3a cannot express reversal). `gap` from `columnGap`/`rowGap` per axis. `padding` from the four computed values. `justify-content`: `flex-start|start|normal`→`start`, `center`→`center`, `flex-end|end`→`end`, `space-between`→`space-between`, anything else (`space-around`/`space-evenly`) → absolute (not expressible). `align-items`: `flex-start|start`→`start`, `center`→`center`, `flex-end|end`→`end`, `stretch|normal`→`start` (children that visibly stretch will still reconstruct correctly since their captured sizes span the counter axis).
2. **Grid** (`display: grid | inline-grid`): parse `gridTemplateColumns`/`Rows` computed track lists. Exactly one column track → `vertical` auto-layout; exactly one row track (and >1 columns) → `horizontal`; **anything 2-D → absolute, no candidate** (never guessed). Gap/padding as flex.
3. **Block flow** (anything else with ≥2 children): if children are pairwise non-overlapping and each child's top ≥ previous child's bottom (a vertical stack), candidate `vertical` with `gap` = the spacing between consecutive bboxes **iff consistent** (max−min ≤ 1px; else no candidate) and `padding` from the first/last child offsets within the content box. Symmetric horizontal-row detection (single text-baseline row, non-overlapping x-progression). Otherwise absolute.

**Sizing:** `fixed` by default. A child in a `vertical` auto-layout container whose width spans the parent's content box (±1px) gets `sizing: { horizontal: "fill" }`; symmetric for horizontal. **Top-level (view root) frames never emit `fill`/`hug`** and are absolutely positioned on the canvas — the SP3a carry-forward (`FILL` on a top-level frame throws in real Figma).

## 6. The geometric self-check (the guardrail)

For every candidate auto-layout, the assembler **reconstructs** each child's expected parent-relative position under SP3a semantics: cursor starts at the primary-axis padding; children advance by size + gap; `primaryAlign` offsets the run (center/end/space-between distribute leftover space); the counter-axis position follows `counterAlign` within the content box. Reconstruction is compared with the **observed** parent-relative bboxes; if any delta exceeds **1px**, the candidate is discarded and that container renders its children **absolutely** (observed bboxes, always faithful). Deterministic, per-container, no cascading: a failed parent does not prevent a child container from keeping its own verified auto-layout.

## 7. Style mapping

- **Fill:** `backgroundColor` → hex. Alpha < 1 is **composited over the resolved parent fill** (walking up to the nearest opaque ancestor, defaulting `#FFFFFF`) — deterministic and closer to what's on screen. Fully transparent → no `fill`.
- **Stroke:** uniform border only (all four widths equal and > 0) → `stroke` = `borderTopColor` hex, `strokeWidth` = width. Non-uniform borders → skipped (v1).
- **Corner radius:** four computed px values → `number` when all equal, else `{tl,tr,br,bl}` (SP3a `CornerRadius`).
- **Effects:** parse the computed `boxShadow` list (split on top-level commas): each `[inset] x y blur spread color` → `Effect` (`inner-shadow` iff `inset`; color alpha → `opacity`). An unparseable entry is skipped (fail-soft), the rest survive.
- **Opacity:** element `opacity` < 1 → node `opacity`.
- **Coordinates:** children are parent-relative (`child.bbox − parent.bbox`, content-box-adjusted under auto-layout); everything rounded to 2 decimals (matching the svg renderer's determinism convention).

## 8. CLI command + outputs

**`uxfactory extract --json -- <profile>`** (new `commands/extract.ts`, registered alongside `batch` in the CLI dispatcher):

1. Load the batch registry exactly as `batch-html` does (requires `inputs.screens` + `inputs.trace`; exit **2** on missing setup, mirroring batch semantics).
2. Render every (page, view) via `renderHtml(req, deps)` with `captureDom: true` — same injectable `HtmlRenderDeps` seam, so tests run without a browser.
3. Assemble **one `DesignSpec`**: one top-level `Frame` per view, named `<page>/<view>`, laid side-by-side (x-offset = running width + 100px gutter, y = 0).
4. **Self-gate:** run `validate()` from `@uxfactory/spec` on the result. Invalid → exit **1** with the pointer errors (the extractor's own output is held to the interchange contract).
5. Write `<dataDir>/batch/designspec/design.designspec.json` (the combined spec) plus per-view `<page>-<view>.designspec.json` (each a single-frame spec, convenient for selective landing). `--json` prints a machine summary (views, node counts, per-container layout source: flex/grid/flow/absolute, self-check fallbacks).
6. A view whose snapshot has `ok: false` is excluded and reported; any exclusion → exit **1**.

The pure `extractDesignSpec` is exported for SP3c's loop integration.

## 9. Error handling

- Renderer unavailable / missing registry inputs → exit 2 (setup, mirrors batch).
- Per-view render failure → view excluded, reported, exit 1 (partial outputs still written for good views).
- Unparseable individual styles (shadow entry, color) → that property skipped, node still emitted (fail-soft, never abort).
- Self-check failure → absolute fallback (by design, not an error; counted in the `--json` summary).

## 10. Testing

- **Pure assembler fixtures** (no browser): capture-tree JSON → expected `DesignSpec`; every fixture output must pass `validate()`. Cases: flex row/column (gap/padding/aligns), 1-D grid, block stack, 2-D grid→absolute, `*-reverse`→absolute, wrapper-chain pruning, mixed text, replaced elements, alpha compositing, non-uniform border skip, shadow parsing (multi-shadow, inset, unparseable entry), per-corner radius, fill-sizing detection, top-level never-fill.
- **Self-check units:** fabricated candidate vs. observed-bbox mismatches (>1px) → absolute fallback; exact reconstructions → kept; center/space-between distributions verified.
- **Determinism:** same tree → deep-equal spec across calls.
- **`EXTRACT_FN` browser test:** one real-Chromium test rendering a small fixture page and asserting the captured tree shape (noting the known local browser-close slowness; skippable where the suite already skips browser tests).
- **CLI test:** deps-injected fake renderer returning canned `domTree`s → files written, validate-gated, exit codes (0 / 1-on-invalid-or-failed-view / 2-on-setup).

## 11. File structure

- **Create** `packages/uxfactory-cli/src/render/dom-capture.ts` — `EXTRACT_FN` string + `CapturedNode` type.
- **Modify** `packages/uxfactory-cli/src/render/html-render.ts` — `captureDom?` on the request; `domTree?` on the snapshot type (re-exported where `RenderSnapshot` lives: `batch/html-checks.ts`).
- **Modify** `packages/uxfactory-cli/src/render/html-render-playwright.ts` — evaluate `EXTRACT_FN` when `captureDom` (same page pass, after `CAPTURE_FN`).
- **Create** `packages/uxfactory-cli/src/extract/dom-to-designspec.ts` — the pure assembler (the plan may split `layout-infer.ts` / `style-map.ts` if it grows).
- **Create** `packages/uxfactory-cli/src/commands/extract.ts` — the command; register in the CLI dispatcher next to `batch`.
- **Tests** under `packages/uxfactory-cli/test/` following existing naming (`extract-*.test.ts`, fixtures in `test/fixtures/extract/`).

Engine-only; `@uxfactory/spec` is already a CLI dependency (svg.ts, publish). No plugin, worker, or skill changes.

## 12. Locked decisions

- **Aggressive inference + geometric self-check** (user decision): flex/grid/flow all attempt auto-layout; 1px tolerance; per-container absolute fallback; 2-D grids and `*-reverse` never attempt.
- **One browser pass**: capture rides the existing render (no second settle — consistency with the screenshot the craft judge saw).
- **Raw computed strings over the wire, parse Node-side** (testability; dumb in-page code).
- **Self-gating output**: `validate()` must pass before files are written.
- **Top-level frames: absolute canvas placement, never `fill` sizing** (SP3a carry-forward).
- **Typography fidelity deferred** (model lacks font fields — flagged for SP3c alongside its plugin font-loading work).

## 13. What SP3c builds on this

SP3c consumes `extractDesignSpec` (pure API) + the `extract` command: detects repeated subtrees → `ComponentDef`/`component-instance` (rewriting the extracted spec), wires extraction into the worker loop after gate+craft green, publishes via the existing queue/bridge, and lands in Figma via the SP3a plugin render — plus landing verification and the master-placement + typography follow-ups.

# SP3b — DOM→DesignSpec Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, LLM-free engine extractor from the rendered HTML DOM to the SP3a semantic `DesignSpec` — in-page capture riding the existing render pass, a pure assembler with aggressive-but-self-checked auto-layout inference, and a self-gating `uxfactory extract` CLI command.

**Architecture:** Two units, one browser pass. `render/dom-capture.ts` exports a string-form in-page walker (`EXTRACT_FN`, the `CAPTURE_FN` convention — engine tsconfig stays DOM-free) producing a serializable `CapturedNode` tree, wired opt-in (`captureDom`) through `html-render.ts`/`html-render-playwright.ts`. `extract/` holds the pure Node-side pipeline: structure+pruning (`dom-to-designspec.ts`), style mapping (`style-map.ts`), layout inference (`layout-infer.ts`), and the 1px geometric self-check. `commands/extract.ts` drives it and self-gates with `validate()` from `@uxfactory/spec`.

**Tech Stack:** TypeScript ESM/NodeNext (`.js` specifiers, `verbatimModuleSyntax`), Playwright (lazy, deps-injected), Vitest, `@uxfactory/spec` (already a CLI dependency).

## Global Constraints

- **Engine-only:** all changes in `packages/uxfactory-cli`. Do NOT touch `packages/uxfactory-spec`, `packages/uxfactory-plugin`, `clients/*`, or `skill/*`.
- **Deterministic / LLM-free / offline:** the assembler is pure (no clock, randomness, or I/O); same input tree → deep-equal spec. All coordinates rounded to 2 decimals.
- **In-page code is string-form** (like `CAPTURE_FN` in `render/html-render-playwright.ts`) so the engine tsconfig stays DOM-free. Raw computed strings cross the wire; ALL parsing happens Node-side.
- **Aggressive inference + geometric self-check:** flex / 1-D grid / block-flow produce auto-layout candidates; every candidate must reconstruct the observed child bboxes within **1px** or that container falls back to absolute. 2-D grids and `flex-direction: *-reverse` NEVER produce candidates.
- **Top-level (view root) frames never emit `fill`/`hug` sizing** (SP3a carry-forward — FILL on a top-level frame throws in real Figma). They may carry verified auto-layout.
- **Self-gating output:** `validate()` (from `@uxfactory/spec`) must pass on the assembled spec before any file is written; invalid → exit 1.
- **Exit codes:** `EXIT.OK`(0) success · `EXIT.GATE_FAIL`(1) failed view or invalid output · `EXIT.TRANSPORT`(2) setup (missing registry inputs / renderer unavailable) — mirrors `batch`.
- Verification: `pnpm --filter @uxfactory/cli test` and `pnpm -r build`. Note: some pre-existing CLI browser tests are slow/timeout locally (known browser-symlink `close()` issue) — do not chase those; your new non-browser tests must be green.
- Commits: work on `main`; stage explicit paths only (never `git add -A`); every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File map

- **Create** `packages/uxfactory-cli/src/render/dom-capture.ts` — `CapturedNode` type + `EXTRACT_FN` string (Task 1).
- **Modify** `packages/uxfactory-cli/src/render/html-render.ts` — `captureDom?` on `HtmlRenderRequest` (Task 1).
- **Modify** `packages/uxfactory-cli/src/batch/html-checks.ts` — `domTree?` on `RenderSnapshot` (Task 1).
- **Modify** `packages/uxfactory-cli/src/render/html-render-playwright.ts` — evaluate `EXTRACT_FN` when `captureDom` (Task 1).
- **Create** `packages/uxfactory-cli/src/extract/style-map.ts` — color/border/radius/shadow/opacity mapping (Task 3).
- **Create** `packages/uxfactory-cli/src/extract/layout-infer.ts` — auto-layout candidates (Task 4) + self-check (Task 5).
- **Create** `packages/uxfactory-cli/src/extract/dom-to-designspec.ts` — the pure assembler (Tasks 2, 3-wire, 5-wire).
- **Create** `packages/uxfactory-cli/src/commands/extract.ts` + register in `src/cli.ts` — the CLI (Task 6).
- **Tests:** `packages/uxfactory-cli/test/{dom-capture.test.ts, dom-capture-real.test.ts, extract-structure.test.ts, extract-style.test.ts, extract-layout.test.ts, extract-selfcheck.test.ts, extract-cli.test.ts}`.

---

## Task 1: DOM capture — `EXTRACT_FN` + render-pipeline wiring

**Files:**
- Create: `packages/uxfactory-cli/src/render/dom-capture.ts`
- Modify: `packages/uxfactory-cli/src/render/html-render.ts` (add `captureDom?` to `HtmlRenderRequest`)
- Modify: `packages/uxfactory-cli/src/batch/html-checks.ts` (add `domTree?` to `RenderSnapshot`)
- Modify: `packages/uxfactory-cli/src/render/html-render-playwright.ts` (evaluate `EXTRACT_FN` when requested)
- Test: `packages/uxfactory-cli/test/dom-capture.test.ts`, `packages/uxfactory-cli/test/dom-capture-real.test.ts`

**Interfaces:**
- Consumes: existing `HtmlRenderRequest`/`HtmlRenderDeps`/`RenderSnapshot`, the `CAPTURE_FN` conventions in `html-render-playwright.ts`.
- Produces: `interface CapturedNode { tag: string; sel: string; bbox: {x,y,width,height}; text: string | null; styles: CapturedStyles; children: CapturedNode[] }` (exact fields below), `const EXTRACT_FN: string`, `HtmlRenderRequest.captureDom?: boolean`, `RenderSnapshot.domTree?: CapturedNode`. Tasks 2–6 consume `CapturedNode`; Task 6 consumes `captureDom`/`domTree`.

- [ ] **Step 1: Write the failing tests**

Create `packages/uxfactory-cli/test/dom-capture.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EXTRACT_FN } from "../src/render/dom-capture.js";
import { renderHtml } from "../src/render/html-render.js";
import type { HtmlRenderRequest } from "../src/render/html-render.js";

describe("EXTRACT_FN", () => {
  it("is a parseable single-argument function expression", () => {
    // Parsed (not executed — it needs a DOM); throws on syntax error.
    const fn = new Function(`return (${EXTRACT_FN});`)();
    expect(typeof fn).toBe("function");
    expect(fn.length).toBe(0);
  });
});

describe("renderHtml captureDom passthrough", () => {
  it("hands captureDom to the injected renderer", async () => {
    let seen: HtmlRenderRequest | null = null;
    await renderHtml(
      {
        baseDir: "/tmp", trace: { version: 1, pages: [] }, previewDir: "/tmp",
        viewport: { width: 390, height: 844 }, captureDom: true,
      },
      { renderViews: async (r) => { seen = r; return []; } },
    );
    expect(seen?.captureDom).toBe(true);
  });
});
```

Create `packages/uxfactory-cli/test/dom-capture-real.test.ts` (real browser — mirror the skip/guard style of the existing real-browser test in `test/html-render.test.ts` if it has one; otherwise this stands alone and may be slow locally due to the known browser-close issue):

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderViewsPlaywright } from "../src/render/html-render-playwright.js";
import type { CapturedNode } from "../src/render/dom-capture.js";

const PAGE = `<!doctype html><html><body style="margin:0">
  <div id="card" style="display:flex;flex-direction:column;gap:8px;padding:16px;background:#ffffff;width:200px">
    <h1 style="margin:0">Title</h1>
    <p style="margin:0">Body <b>bold</b> tail</p>
  </div>
</body></html>`;

describe("EXTRACT_FN in a real browser", () => {
  it("captures a serializable tree with bboxes, styles, and #text runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-domcap-"));
    await mkdir(path.join(root, "previews"), { recursive: true });
    await writeFile(path.join(root, "page.html"), PAGE);
    const snaps = await renderViewsPlaywright({
      baseDir: root,
      trace: { version: 1, pages: [{ file: "page.html", views: [{ id: "default", covers: [] }] }] },
      previewDir: path.join(root, "previews"),
      viewport: { width: 390, height: 844 },
      captureDom: true,
    });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.ok).toBe(true);
    const tree = snaps[0]!.domTree as CapturedNode;
    expect(tree.tag).toBe("body");
    const card = tree.children.find((c) => c.sel === "div#card")!;
    expect(card.styles.display).toBe("flex");
    expect(card.styles.flexDirection).toBe("column");
    expect(card.bbox.width).toBeGreaterThan(0);
    const h1 = card.children.find((c) => c.tag === "h1")!;
    expect(h1.text).toBe("Title");
    // The <p> has a <b> element child + text runs → #text children with real bboxes.
    const p = card.children.find((c) => c.tag === "p")!;
    const runs = p.children.filter((c) => c.tag === "#text");
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0]!.text).toBe("Body");
    expect(runs[0]!.bbox.width).toBeGreaterThan(0);
  }, 60_000);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/dom-capture.test.ts`
Expected: FAIL — `EXTRACT_FN` module doesn't exist; `captureDom` not a known property.

- [ ] **Step 3: Create `src/render/dom-capture.ts`**

```ts
/**
 * In-page DOM capture for the DOM→DesignSpec extractor (SP3b).
 * EXTRACT_FN is a string-form function (the CAPTURE_FN convention) evaluated in
 * the browser against the settled+frozen DOM — the engine tsconfig stays DOM-free.
 * Raw computed strings cross the wire; ALL parsing happens Node-side.
 */

/** The computed-style subset the assembler maps. Raw computed strings. */
export interface CapturedStyles {
  display: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  rowGap: string;
  columnGap: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  backgroundColor: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderTopColor: string;
  borderTopLeftRadius: string;
  borderTopRightRadius: string;
  borderBottomRightRadius: string;
  borderBottomLeftRadius: string;
  boxShadow: string;
  opacity: string;
  color: string;
}

/** One visible element (or `#text` run) in the captured tree. Fully serializable. */
export interface CapturedNode {
  /** Lowercase tag name, or "#text" for a measured text run inside mixed content. */
  tag: string;
  /** Short selector for naming: tag + #id or .firstClass (e.g. "div#cart", "button.pay"). */
  sel: string;
  /** Absolute viewport coordinates (page unscrolled — equals document coords). */
  bbox: { x: number; y: number; width: number; height: number };
  /** Collapsed text: set for text-only leaf elements and #text runs; null otherwise. */
  text: string | null;
  styles: CapturedStyles;
  children: CapturedNode[];
}

/** Tags treated as replaced/media leaves — never recursed into. */
export const REPLACED_TAGS = ["img", "svg", "canvas", "video", "picture"] as const;

/**
 * In-page walker: body → CapturedNode tree. Visibility-filtered (same rules as
 * CAPTURE_FN). Mixed-content text runs are measured with a DOM Range.
 */
export const EXTRACT_FN = `() => {
  const REPLACED = ["img", "svg", "canvas", "video", "picture"];
  const STYLE_KEYS = ["display","flexDirection","justifyContent","alignItems","rowGap","columnGap",
    "gridTemplateColumns","gridTemplateRows","paddingTop","paddingRight","paddingBottom","paddingLeft",
    "backgroundColor","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth",
    "borderTopColor","borderTopLeftRadius","borderTopRightRadius","borderBottomRightRadius",
    "borderBottomLeftRadius","boxShadow","opacity","color"];
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const shortSel = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + el.id;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/)[0] : "";
    return cls ? tag + "." + cls : tag;
  };
  const collapse = (s) => s.replace(/\\s+/g, " ").trim();
  const box = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const styleSubset = (el) => {
    const s = getComputedStyle(el);
    const out = {};
    for (const k of STYLE_KEYS) out[k] = s[k];
    return out;
  };
  const walk = (el) => {
    const tag = el.tagName.toLowerCase();
    const node = {
      tag, sel: shortSel(el), bbox: box(el.getBoundingClientRect()),
      text: null, styles: styleSubset(el), children: [],
    };
    if (REPLACED.includes(tag)) return node;
    const elementChildren = [];
    const textRuns = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 1) {
        if (visible(child)) elementChildren.push(child);
      } else if (child.nodeType === 3) {
        const t = collapse(child.textContent || "");
        if (t !== "") textRuns.push(child);
      }
    }
    if (elementChildren.length === 0) {
      // Text-only (or empty) leaf: carry collapsed text directly.
      const t = collapse(el.textContent || "");
      if (t !== "") node.text = t;
      return node;
    }
    // Mixed content: measure each text run with a Range so it lands as a child.
    for (const child of el.childNodes) {
      if (child.nodeType === 1) {
        if (visible(child)) node.children.push(walk(child));
      } else if (child.nodeType === 3) {
        const t = collapse(child.textContent || "");
        if (t === "") continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          node.children.push({
            tag: "#text", sel: "#text", bbox: box(r), text: t,
            styles: styleSubset(el), children: [],
          });
        }
      }
    }
    return node;
  };
  return walk(document.body);
}`;
```

- [ ] **Step 4: Wire `captureDom` through the request and snapshot types**

In `src/render/html-render.ts`, add one field to `HtmlRenderRequest` (after `viewport`):

```ts
  /** When true, capture the DOM as a CapturedNode tree on each snapshot (SP3b extract). */
  captureDom?: boolean;
```

In `src/batch/html-checks.ts`, add to `RenderSnapshot` (after `axe`), with the type-only import at the top of the file (`import type { CapturedNode } from "../render/dom-capture.js";`):

```ts
  /** Present iff the render was requested with captureDom (SP3b extract). */
  domTree?: CapturedNode;
```

In `src/render/html-render-playwright.ts`, import `{ EXTRACT_FN }` and `type { CapturedNode }` from `./dom-capture.js`, and inside the per-view `try` block — immediately after the `CAPTURE_FN` evaluate (so it shares the settled+frozen state), before the axe script tag — add:

```ts
          let domTree: CapturedNode | undefined;
          if (req.captureDom === true) {
            domTree = (await page.evaluate(`(${EXTRACT_FN})()`)) as CapturedNode;
          }
```

…and extend the success push: `out.push({ ...base, ok: true, coverChecks: captured.coverChecks, paintedColors: captured.paintedColors, axe, ...(domTree !== undefined ? { domTree } : {}) });`

- [ ] **Step 5: Run the fast tests**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/dom-capture.test.ts`
Expected: PASS (both).

- [ ] **Step 6: Run the real-browser test once**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/dom-capture-real.test.ts`
Expected: PASS (may be slow to close the browser locally — the assertion phase itself is fast). If the browser is unavailable in your environment, note it in your report; do not delete the test.

- [ ] **Step 7: Typecheck + engine suite**

Run: `pnpm -r build` then `pnpm --filter @uxfactory/cli exec vitest run test/batch-html.test.ts test/html-render.test.ts`
Expected: build green; existing render/batch tests unaffected (captureDom is opt-in).

- [ ] **Step 8: Commit**

```bash
git add packages/uxfactory-cli/src/render/dom-capture.ts packages/uxfactory-cli/src/render/html-render.ts packages/uxfactory-cli/src/batch/html-checks.ts packages/uxfactory-cli/src/render/html-render-playwright.ts packages/uxfactory-cli/test/dom-capture.test.ts packages/uxfactory-cli/test/dom-capture-real.test.ts
git commit -m "feat(cli): in-page DOM capture (EXTRACT_FN) behind captureDom (SP3b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Assembler skeleton — structure, pruning, text, coordinates

**Files:**
- Create: `packages/uxfactory-cli/src/extract/dom-to-designspec.ts`
- Create: `packages/uxfactory-cli/test/extract-fixtures.ts` (shared fixture helper — a plain module, NOT a test file, so importing it never re-registers tests)
- Test: `packages/uxfactory-cli/test/extract-structure.test.ts`

**Interfaces:**
- Consumes: `CapturedNode`, `REPLACED_TAGS` (Task 1); `DesignSpec`, `Frame`, `FrameChild`, `validate` from `@uxfactory/spec`.
- Produces (Tasks 3/5/6 rely on these exact names):

```ts
export interface ExtractedView { page: string; view: string; viewport: { width: number; height: number }; tree: CapturedNode; }
export interface ExtractStats { views: number; nodes: number; containers: { flex: number; grid: number; flow: number; absolute: number }; selfCheckFallbacks: number; }
export interface ExtractResult { spec: DesignSpec; stats: ExtractStats; }
export function extractDesignSpec(views: ExtractedView[]): ExtractResult;
export function r2(n: number): number;                       // round to 2 decimals
export function px(s: string): number;                       // "12px" → 12, non-numeric → 0
```

In this task every container renders its children **absolutely** (layout inference arrives in Tasks 4–5) and nodes carry geometry + names + text only (style mapping arrives in Task 3). `stats.containers` counts everything under `absolute` for now.

- [ ] **Step 1: Create the shared fixture helper + write the failing tests**

Create `packages/uxfactory-cli/test/extract-fixtures.ts` (imported by every extractor test — a plain module so importing it never re-registers another file's tests):

```ts
import type { CapturedNode } from "../src/render/dom-capture.js";
import type { ExtractedView } from "../src/extract/dom-to-designspec.js";

/** Fixture helper: a CapturedNode with all-neutral styles, overridable. */
export function node(partial: Partial<CapturedNode> & { tag: string }): CapturedNode {
  return {
    sel: partial.tag, bbox: { x: 0, y: 0, width: 100, height: 50 }, text: null, children: [],
    styles: {
      display: "block", flexDirection: "row", justifyContent: "normal", alignItems: "normal",
      rowGap: "normal", columnGap: "normal", gridTemplateColumns: "none", gridTemplateRows: "none",
      paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderTopWidth: "0px", borderRightWidth: "0px", borderBottomWidth: "0px", borderLeftWidth: "0px",
      borderTopColor: "rgb(0, 0, 0)",
      borderTopLeftRadius: "0px", borderTopRightRadius: "0px",
      borderBottomRightRadius: "0px", borderBottomLeftRadius: "0px",
      boxShadow: "none", opacity: "1", color: "rgb(17, 24, 39)",
    },
    ...partial,
  };
}

export const VIEWPORT = { width: 390, height: 844 };

export const view = (tree: CapturedNode, pageName = "screens/checkout.html", viewId = "success"): ExtractedView =>
  ({ page: pageName, view: viewId, viewport: VIEWPORT, tree });
```

Create `packages/uxfactory-cli/test/extract-structure.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validate } from "@uxfactory/spec";
import type { Frame, TextNode, ShapeNode } from "@uxfactory/spec";
import { extractDesignSpec } from "../src/extract/dom-to-designspec.js";
import { node, view } from "./extract-fixtures.js";
import type { CapturedNode } from "../src/render/dom-capture.js";

describe("extractDesignSpec — structure", () => {
  it("emits one validated top-level frame per view, side-by-side, never fill-sized", () => {
    const body = node({ tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 } });
    const { spec, stats } = extractDesignSpec([
      view(body, "screens/a.html", "v1"), view(body, "screens/b.html", "v2"),
    ]);
    expect(validate(spec).valid).toBe(true);
    expect(spec.frames).toHaveLength(2);
    expect(spec.frames[0]!.name).toBe("screens/a.html/v1");
    expect(spec.frames[1]!.name).toBe("screens/b.html/v2");
    expect(spec.frames[0]!.x).toBe(0);
    expect(spec.frames[1]!.x).toBe(490);            // width 390 + 100 gutter
    expect(spec.frames[0]!.sizing).toBeUndefined(); // top-level never fill/hug
    expect(stats.views).toBe(2);
  });

  it("maps containers to nested frames and leaves to shapes/text, parent-relative", () => {
    const tree = node({
      tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 },
      children: [
        node({
          tag: "div", sel: "div#card", bbox: { x: 20, y: 30, width: 350, height: 200 },
          children: [
            node({ tag: "h1", bbox: { x: 36, y: 46, width: 200, height: 32 }, text: "Order confirmed" }),
            node({ tag: "img", bbox: { x: 36, y: 90, width: 64, height: 64 } }),
          ],
        }),
      ],
    });
    const { spec } = extractDesignSpec([view(tree)]);
    expect(validate(spec).valid).toBe(true);
    const root = spec.frames[0]!;
    const card = root.children![0] as Frame;
    expect(card.name).toBe("div#card");
    expect(card.x).toBe(20); expect(card.y).toBe(30);           // body-relative
    const h1 = card.children![0] as TextNode;
    expect(h1.type).toBe("text");
    expect(h1.characters).toBe("Order confirmed");
    expect(h1.x).toBe(16); expect(h1.y).toBe(16);               // card-relative
    const img = card.children![1] as ShapeNode;
    expect(img.type).toBe("shape");                              // replaced → placeholder shape
    expect(img.fill).toBe("#E5E7EB");
  });

  it("collapses no-signal single-child wrapper chains (geometry preserved)", () => {
    const inner = node({ tag: "section", sel: "section#real", bbox: { x: 10, y: 10, width: 100, height: 100 },
      children: [node({ tag: "p", bbox: { x: 10, y: 10, width: 80, height: 20 }, text: "hi" })] });
    const wrap2 = node({ tag: "div", bbox: { x: 10, y: 10, width: 100, height: 100 }, children: [inner] });
    const wrap1 = node({ tag: "div", bbox: { x: 10, y: 10, width: 100, height: 100 }, children: [wrap2] });
    const body = node({ tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 }, children: [wrap1] });
    const { spec } = extractDesignSpec([view(body)]);
    const root = spec.frames[0]!;
    expect(root.children).toHaveLength(1);
    const section = root.children![0] as Frame;
    expect(section.name).toBe("section#real");                   // both wrappers collapsed
    expect(section.x).toBe(10); expect(section.y).toBe(10);
  });

  it("turns #text runs into text nodes and is deterministic", () => {
    const p = node({ tag: "p", bbox: { x: 0, y: 0, width: 200, height: 40 },
      children: [
        node({ tag: "#text", sel: "#text", bbox: { x: 0, y: 0, width: 40, height: 20 }, text: "Body" }),
        node({ tag: "b", bbox: { x: 44, y: 0, width: 30, height: 20 }, text: "bold" }),
      ] });
    const body = node({ tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 }, children: [p] });
    const one = extractDesignSpec([view(body)]);
    const two = extractDesignSpec([view(body)]);
    expect(one).toEqual(two);                                    // pure + deterministic
    const pf = one.spec.frames[0]!.children![0] as Frame;
    const run = pf.children![0] as TextNode;
    expect(run.type).toBe("text");
    expect(run.characters).toBe("Body");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-structure.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/extract/dom-to-designspec.ts`**

```ts
/**
 * Pure DOM→DesignSpec assembler (SP3b). No I/O, no clock, no randomness:
 * extractDesignSpec(views) deep-equals itself across calls. Layout inference
 * and style mapping are layered in by sibling modules (layout-infer, style-map).
 */
import type { DesignSpec, Frame, FrameChild, TextNode, ShapeNode } from "@uxfactory/spec";
import type { CapturedNode } from "../render/dom-capture.js";
import { REPLACED_TAGS } from "../render/dom-capture.js";

export interface ExtractedView {
  page: string;
  view: string;
  viewport: { width: number; height: number };
  tree: CapturedNode;
}

export interface ExtractStats {
  views: number;
  nodes: number;
  containers: { flex: number; grid: number; flow: number; absolute: number };
  selfCheckFallbacks: number;
}

export interface ExtractResult {
  spec: DesignSpec;
  stats: ExtractStats;
}

const CANVAS_GUTTER = 100;
const PLACEHOLDER_FILL = "#E5E7EB";
const PRUNE_TOLERANCE = 2;

/** Round to 2 decimals (determinism convention, matches the svg renderer). */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse a computed px length ("12px" → 12); anything non-numeric → 0. */
export function px(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const REPLACED = new Set<string>(REPLACED_TAGS);

/** True when the container paints nothing of its own (prunable wrapper candidate). */
function hasNoVisualSignal(n: CapturedNode): boolean {
  const s = n.styles;
  const bgTransparent = s.backgroundColor === "rgba(0, 0, 0, 0)" || s.backgroundColor === "transparent";
  const noBorder =
    px(s.borderTopWidth) === 0 && px(s.borderRightWidth) === 0 &&
    px(s.borderBottomWidth) === 0 && px(s.borderLeftWidth) === 0;
  const noRadius =
    px(s.borderTopLeftRadius) === 0 && px(s.borderTopRightRadius) === 0 &&
    px(s.borderBottomRightRadius) === 0 && px(s.borderBottomLeftRadius) === 0;
  return bgTransparent && noBorder && s.boxShadow === "none" && noRadius && px(s.opacity) === 1;
}

/** Content box: bbox inset by padding. */
function contentBox(n: CapturedNode): { x: number; y: number; width: number; height: number } {
  const s = n.styles;
  return {
    x: n.bbox.x + px(s.paddingLeft),
    y: n.bbox.y + px(s.paddingTop),
    width: n.bbox.width - px(s.paddingLeft) - px(s.paddingRight),
    height: n.bbox.height - px(s.paddingTop) - px(s.paddingBottom),
  };
}

/**
 * Bottom-up wrapper pruning: a container with exactly one element child, no
 * visual signal, whose child bbox lies within PRUNE_TOLERANCE of the container's
 * content box on every edge, is dropped and its child promoted. Repeated, so
 * wrapper chains collapse fully.
 */
function prune(n: CapturedNode): CapturedNode {
  const pruned: CapturedNode = { ...n, children: n.children.map(prune) };
  if (pruned.children.length === 1 && pruned.tag !== "body" && hasNoVisualSignal(pruned)) {
    const child = pruned.children[0]!;
    if (child.tag !== "#text" && child.children !== undefined) {
      const cb = contentBox(pruned);
      const b = child.bbox;
      const fits =
        Math.abs(b.x - cb.x) <= PRUNE_TOLERANCE &&
        Math.abs(b.y - cb.y) <= PRUNE_TOLERANCE &&
        Math.abs(b.x + b.width - (cb.x + cb.width)) <= PRUNE_TOLERANCE &&
        Math.abs(b.y + b.height - (cb.y + cb.height)) <= PRUNE_TOLERANCE;
      if (fits) return child;
    }
  }
  return pruned;
}

/** Shared mutable pass state (stats accumulation). */
interface PassCtx {
  stats: ExtractStats;
}

/** Map one captured child into a FrameChild, positioned relative to (ox, oy). */
function toChild(n: CapturedNode, ox: number, oy: number, ctx: PassCtx): FrameChild {
  ctx.stats.nodes += 1;
  const x = r2(n.bbox.x - ox);
  const y = r2(n.bbox.y - oy);
  const width = r2(n.bbox.width);
  const height = r2(n.bbox.height);

  if (n.tag === "#text" || (n.children.length === 0 && n.text !== null && !REPLACED.has(n.tag))) {
    const text: TextNode = { type: "text", name: n.sel, characters: n.text ?? "", x, y, width, height };
    return text;
  }
  if (n.children.length === 0) {
    const shape: ShapeNode = { type: "shape", name: n.sel, x, y, width, height };
    if (REPLACED.has(n.tag)) shape.fill = PLACEHOLDER_FILL;
    return shape;
  }
  return toFrame(n, ox, oy, ctx);
}

/** Map a captured container into a nested Frame (children parent-relative). */
function toFrame(n: CapturedNode, ox: number, oy: number, ctx: PassCtx): Frame {
  ctx.stats.containers.absolute += 1;
  const frame: Frame = {
    name: n.sel,
    x: r2(n.bbox.x - ox),
    y: r2(n.bbox.y - oy),
    width: r2(n.bbox.width),
    height: r2(n.bbox.height),
    children: n.children.map((c) => toChild(c, n.bbox.x, n.bbox.y, ctx)),
  };
  return frame;
}

/** Assemble one DesignSpec from the captured views: one top-level frame per view. */
export function extractDesignSpec(views: ExtractedView[]): ExtractResult {
  const stats: ExtractStats = {
    views: views.length, nodes: 0,
    containers: { flex: 0, grid: 0, flow: 0, absolute: 0 },
    selfCheckFallbacks: 0,
  };
  const ctx: PassCtx = { stats };
  const frames: Frame[] = [];
  let cursorX = 0;
  for (const v of views) {
    const tree = prune(v.tree);
    stats.nodes += 1; // the view root itself
    const width = Math.max(tree.bbox.width, v.viewport.width);
    const root: Frame = {
      name: `${v.page}/${v.view}`,
      x: r2(cursorX),
      y: 0,
      width: r2(width),
      height: r2(Math.max(tree.bbox.height, v.viewport.height)),
      children: tree.children.map((c) => toChild(c, tree.bbox.x, tree.bbox.y, ctx)),
    };
    // Top-level frames NEVER emit sizing (SP3a carry-forward) and sit absolutely on the canvas.
    frames.push(root);
    cursorX += width + CANVAS_GUTTER;
  }
  return { spec: { frames }, stats };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-structure.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm -r build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-cli/src/extract/dom-to-designspec.ts packages/uxfactory-cli/test/extract-fixtures.ts packages/uxfactory-cli/test/extract-structure.test.ts
git commit -m "feat(cli): pure DOM→DesignSpec assembler — structure, pruning, text, coords (SP3b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Style mapping — fills, strokes, radius, shadows, opacity

**Files:**
- Create: `packages/uxfactory-cli/src/extract/style-map.ts`
- Modify: `packages/uxfactory-cli/src/extract/dom-to-designspec.ts` (wire style props into `toChild`/`toFrame`/root)
- Test: `packages/uxfactory-cli/test/extract-style.test.ts`

**Interfaces:**
- Consumes: `CapturedStyles` (Task 1), `px`/`r2` (Task 2), `Effect`, `CornerRadius`, `HexColor` from `@uxfactory/spec`.
- Produces (Task 5/6 and the assembler rely on these exact names):

```ts
export function parseColor(s: string): { r: number; g: number; b: number; a: number } | null; // rgb()/rgba(); null when unparseable/transparent-keyword
export function compositeOver(fg: {r,g,b,a}, bgHex: string): string;   // alpha-composite → "#RRGGBB"
export function resolveFill(s: CapturedStyles, parentFill: string): string | null; // null = fully transparent
export function mapStroke(s: CapturedStyles): { stroke: string; strokeWidth: number } | null; // uniform borders only
export function mapCornerRadius(s: CapturedStyles): CornerRadius | undefined; // number when uniform, object otherwise, undefined when all 0
export function mapEffects(s: CapturedStyles): Effect[];                // box-shadow list, fail-soft per entry
export function mapOpacity(s: CapturedStyles): number | undefined;      // <1 only
```

`resolveFill` takes the **resolved parent fill hex** (the assembler threads it down; root default `#FFFFFF`) and composites alpha over it.

- [ ] **Step 1: Write the failing tests**

Create `packages/uxfactory-cli/test/extract-style.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseColor, compositeOver, resolveFill, mapStroke, mapCornerRadius, mapEffects, mapOpacity } from "../src/extract/style-map.js";
import { extractDesignSpec } from "../src/extract/dom-to-designspec.js";
import { validate } from "@uxfactory/spec";
import type { Frame, ShapeNode } from "@uxfactory/spec";
import { node } from "./extract-fixtures.js";

const styles = (over: Record<string, string>) => ({ ...node({ tag: "div" }).styles, ...over });

describe("style-map units", () => {
  it("parses rgb/rgba and rejects junk", () => {
    expect(parseColor("rgb(30, 136, 229)")).toEqual({ r: 30, g: 136, b: 229, a: 1 });
    expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("oklch(0.5 0.1 200)")).toBeNull();
  });

  it("composites alpha over the parent fill", () => {
    expect(compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, "#FFFFFF")).toBe("#808080");
    expect(compositeOver({ r: 255, g: 0, b: 0, a: 1 }, "#000000")).toBe("#FF0000");
  });

  it("resolveFill: opaque → hex, alpha → composite, transparent → null", () => {
    expect(resolveFill(styles({ backgroundColor: "rgb(255, 255, 255)" }), "#000000")).toBe("#FFFFFF");
    expect(resolveFill(styles({ backgroundColor: "rgba(0, 0, 0, 0.5)" }), "#FFFFFF")).toBe("#808080");
    expect(resolveFill(styles({ backgroundColor: "rgba(0, 0, 0, 0)" }), "#FFFFFF")).toBeNull();
  });

  it("maps uniform borders only", () => {
    expect(mapStroke(styles({ borderTopWidth: "2px", borderRightWidth: "2px", borderBottomWidth: "2px", borderLeftWidth: "2px", borderTopColor: "rgb(17, 24, 39)" })))
      .toEqual({ stroke: "#111827", strokeWidth: 2 });
    expect(mapStroke(styles({ borderTopWidth: "2px", borderRightWidth: "0px", borderBottomWidth: "2px", borderLeftWidth: "2px" }))).toBeNull();
    expect(mapStroke(styles({}))).toBeNull(); // zero widths
  });

  it("maps radius to number when uniform, object otherwise, undefined when zero", () => {
    expect(mapCornerRadius(styles({ borderTopLeftRadius: "8px", borderTopRightRadius: "8px", borderBottomRightRadius: "8px", borderBottomLeftRadius: "8px" }))).toBe(8);
    expect(mapCornerRadius(styles({ borderTopLeftRadius: "8px", borderTopRightRadius: "8px", borderBottomRightRadius: "0px", borderBottomLeftRadius: "0px" })))
      .toEqual({ tl: 8, tr: 8, br: 0, bl: 0 });
    expect(mapCornerRadius(styles({}))).toBeUndefined();
  });

  it("parses multi-shadow box-shadow fail-soft, inset → inner-shadow", () => {
    const fx = mapEffects(styles({
      boxShadow: "rgba(16, 24, 40, 0.1) 0px 4px 12px 0px, rgb(16, 24, 40) 0px 1px 2px 0px inset, garbage-entry",
    }));
    expect(fx).toEqual([
      { type: "drop-shadow", color: "#101828", opacity: 0.1, x: 0, y: 4, blur: 12, spread: 0 },
      { type: "inner-shadow", color: "#101828", x: 0, y: 1, blur: 2, spread: 0 },
    ]); // the garbage entry is skipped, the rest survive
    expect(mapEffects(styles({ boxShadow: "none" }))).toEqual([]);
  });

  it("maps opacity only when < 1", () => {
    expect(mapOpacity(styles({ opacity: "0.8" }))).toBe(0.8);
    expect(mapOpacity(styles({ opacity: "1" }))).toBeUndefined();
  });
});

describe("assembler style wiring", () => {
  it("emits fill/stroke/radius/effects on frames and shapes, text fill from color", () => {
    const tree = node({
      tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 },
      styles: styles({ backgroundColor: "rgb(249, 250, 251)" }),
      children: [
        node({
          tag: "div", sel: "div#card", bbox: { x: 20, y: 30, width: 350, height: 200 },
          styles: styles({
            backgroundColor: "rgb(255, 255, 255)",
            borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px", borderLeftWidth: "1px",
            borderTopColor: "rgb(229, 231, 235)",
            borderTopLeftRadius: "12px", borderTopRightRadius: "12px",
            borderBottomRightRadius: "12px", borderBottomLeftRadius: "12px",
            boxShadow: "rgba(16, 24, 40, 0.08) 0px 4px 12px 0px",
          }),
          children: [
            node({ tag: "h1", bbox: { x: 36, y: 46, width: 200, height: 32 }, text: "Done",
              styles: styles({ color: "rgb(17, 24, 39)" }) }),
            node({ tag: "div", sel: "div.badge", bbox: { x: 36, y: 120, width: 60, height: 24 },
              styles: styles({
                borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px", borderLeftWidth: "1px",
                borderTopColor: "rgb(229, 231, 235)",
              }) }),
          ],
        }),
      ],
    });
    const { spec } = extractDesignSpec([{ page: "p.html", view: "v", viewport: { width: 390, height: 844 }, tree }]);
    expect(validate(spec).valid).toBe(true);
    const root = spec.frames[0]!;
    expect(root.fill).toBe("#F9FAFB");
    const card = root.children![0] as Frame;
    expect(card.fill).toBe("#FFFFFF");
    // frames: fill/radius/effects only — Frame has NO stroke/strokeWidth in the SP3a model
    expect((card as { stroke?: string }).stroke).toBeUndefined();
    expect(card.cornerRadius).toBe(12);
    expect(card.effects).toEqual([{ type: "drop-shadow", color: "#101828", opacity: 0.08, x: 0, y: 4, blur: 12, spread: 0 }]);
    const h1 = card.children![0]!;
    expect((h1 as { fill?: string }).fill).toBe("#111827");
    // a bordered LEAF is a ShapeNode, which DOES carry stroke/strokeWidth
    const badge = card.children!.find((c) => c.name === "div.badge") as ShapeNode;
    expect(badge.stroke).toBe("#E5E7EB");
    expect(badge.strokeWidth).toBe(1);
  });
});
```

(`Frame` carries `fill`/`effects`/`cornerRadius`/`layout`/`sizing` but NOT `stroke`/`strokeWidth`/`opacity` — see `packages/uxfactory-spec/src/types.ts`. Container borders are therefore dropped in v1; bordered leaves keep theirs via `ShapeNode`.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-style.test.ts`
Expected: FAIL — `style-map.ts` doesn't exist.

- [ ] **Step 3: Implement `src/extract/style-map.ts`**

```ts
/**
 * Pure computed-style → DesignSpec property mapping (SP3b). Fail-soft: an
 * unparseable value yields "absent", never an exception.
 */
import type { Effect, CornerRadius } from "@uxfactory/spec";
import type { CapturedStyles } from "../render/dom-capture.js";
import { px } from "./dom-to-designspec.js";

const RGB_RE = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/;

export function parseColor(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = RGB_RE.exec(s);
  if (!m) return null;
  return { r: parseInt(m[1]!, 10), g: parseInt(m[2]!, 10), b: parseInt(m[3]!, 10), a: m[4] === undefined ? 1 : parseFloat(m[4]!) };
}

function channelHex(v: number): string {
  return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0").toUpperCase();
}

function hexOf(r: number, g: number, b: number): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`;
}

function hexToRgbLocal(hex: string): { r: number; g: number; b: number } {
  const body = hex.replace("#", "");
  const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/** Alpha-composite fg over an opaque background hex → opaque hex. */
export function compositeOver(fg: { r: number; g: number; b: number; a: number }, bgHex: string): string {
  const bg = hexToRgbLocal(bgHex);
  const a = fg.a;
  return hexOf(a * fg.r + (1 - a) * bg.r, a * fg.g + (1 - a) * bg.g, a * fg.b + (1 - a) * bg.b);
}

/** Background → fill hex composited over the resolved parent fill; null = paints nothing. */
export function resolveFill(s: CapturedStyles, parentFill: string): string | null {
  const c = parseColor(s.backgroundColor);
  if (c === null || c.a === 0) return null;
  if (c.a === 1) return hexOf(c.r, c.g, c.b);
  return compositeOver(c, parentFill);
}

/** Uniform borders only (all four widths equal and > 0). */
export function mapStroke(s: CapturedStyles): { stroke: string; strokeWidth: number } | null {
  const w = px(s.borderTopWidth);
  if (w <= 0) return null;
  if (px(s.borderRightWidth) !== w || px(s.borderBottomWidth) !== w || px(s.borderLeftWidth) !== w) return null;
  const c = parseColor(s.borderTopColor);
  if (c === null || c.a === 0) return null;
  return { stroke: hexOf(c.r, c.g, c.b), strokeWidth: w };
}

/** Four computed corner radii → CornerRadius (undefined when all zero). */
export function mapCornerRadius(s: CapturedStyles): CornerRadius | undefined {
  const tl = px(s.borderTopLeftRadius); const tr = px(s.borderTopRightRadius);
  const br = px(s.borderBottomRightRadius); const bl = px(s.borderBottomLeftRadius);
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) return undefined;
  if (tl === tr && tr === br && br === bl) return tl;
  return { tl, tr, br, bl };
}

/**
 * Computed box-shadow list → Effect[]. Computed form: "<color> <x> <y> <blur> <spread>[ inset], …".
 * Entries split on top-level commas (never inside parens); unparseable entries skipped.
 */
export function mapEffects(s: CapturedStyles): Effect[] {
  if (s.boxShadow === "none" || s.boxShadow === "") return [];
  const entries: string[] = [];
  let depth = 0; let cur = "";
  for (const ch of s.boxShadow) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { entries.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim() !== "") entries.push(cur.trim());

  const out: Effect[] = [];
  for (const entry of entries) {
    const inset = /\binset\b/.test(entry);
    const colorMatch = /rgba?\([^)]*\)/.exec(entry);
    if (!colorMatch) continue;
    const color = parseColor(colorMatch[0]);
    if (color === null) continue;
    const rest = entry.replace(colorMatch[0], "").replace(/\binset\b/, "").trim();
    const lengths = rest.split(/\s+/).map(px);
    if (lengths.length < 3) continue;
    const effect: Effect = {
      type: inset ? "inner-shadow" : "drop-shadow",
      color: hexOf(color.r, color.g, color.b),
      x: lengths[0]!, y: lengths[1]!, blur: lengths[2]!, spread: lengths[3] ?? 0,
    };
    if (color.a < 1) effect.opacity = color.a;
    out.push(effect);
  }
  return out;
}

/** Element opacity, only when it actually dims (< 1). */
export function mapOpacity(s: CapturedStyles): number | undefined {
  const o = px(s.opacity); // parseFloat semantics: "0.8" → 0.8
  return o < 1 ? o : undefined;
}

/** Text color → hex (null when unparseable). */
export function mapTextFill(s: CapturedStyles): string | null {
  const c = parseColor(s.color);
  return c === null ? null : hexOf(c.r, c.g, c.b);
}
```

- [ ] **Step 4: Wire styles into the assembler**

In `dom-to-designspec.ts`: import the mappers; thread the **resolved parent fill** down the walk (root default `"#FFFFFF"`).

- `toChild(n, ox, oy, ctx, parentFill: string)` — add the parameter; pass through recursion.
- Text path: `const fillHex = mapTextFill(n.styles); if (fillHex !== null) text.fill = fillHex;`
- Shape path (leaf): `const fill = resolveFill(n.styles, parentFill); if (fill !== null) shape.fill = fill;` (replaced-element placeholder keeps `PLACEHOLDER_FILL` when `fill` is null); `const st = mapStroke(n.styles); if (st) { shape.stroke = st.stroke; shape.strokeWidth = st.strokeWidth; }`; `const cr = mapCornerRadius(n.styles); if (cr !== undefined) shape.cornerRadius = cr;`; `const fx = mapEffects(n.styles); if (fx.length > 0) shape.effects = fx;`; `const op = mapOpacity(n.styles); if (op !== undefined) shape.opacity = op;`
- Frame path (`toFrame`): fill/cornerRadius/effects the same way (`Frame` has no stroke/opacity in the model — skip both); compute `const resolved = fill ?? parentFill;` and recurse children with `resolved`.
- Root frames in `extractDesignSpec`: same fill/cornerRadius/effects wiring from the body node's styles, `parentFill` starts `"#FFFFFF"`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-style.test.ts test/extract-structure.test.ts`
Expected: PASS (style units + wiring; structure tests still green — neutral fixture styles emit no props).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm -r build` — green. Then:

```bash
git add packages/uxfactory-cli/src/extract/style-map.ts packages/uxfactory-cli/src/extract/dom-to-designspec.ts packages/uxfactory-cli/test/extract-style.test.ts
git commit -m "feat(cli): extractor style mapping — fills, strokes, radius, shadows (SP3b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Layout inference — flex / 1-D grid / block-flow candidates

**Files:**
- Create: `packages/uxfactory-cli/src/extract/layout-infer.ts`
- Test: `packages/uxfactory-cli/test/extract-layout.test.ts`

**Interfaces:**
- Consumes: `CapturedNode`/`CapturedStyles` (Task 1), `px` (Task 2), `AutoLayout`, `Padding` from `@uxfactory/spec`.
- Produces (Task 5 relies on these exact names):

```ts
export type LayoutSource = "flex" | "grid" | "flow";
export interface LayoutCandidate { layout: AutoLayout; source: LayoutSource; }
export function inferCandidate(n: CapturedNode): LayoutCandidate | null;
```

Pure; no self-check here (Task 5). Returns `null` for: `*-reverse`, unmappable `justify-content` (`space-around`/`space-evenly`), 2-D grids, containers with <2 children for flow (single-child flex/grid still allowed), overlapping/irregular flow children.

- [ ] **Step 1: Write the failing tests**

Create `packages/uxfactory-cli/test/extract-layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inferCandidate } from "../src/extract/layout-infer.js";
import { node } from "./extract-fixtures.js";
import type { CapturedNode } from "../src/render/dom-capture.js";

const kid = (x: number, y: number, w = 100, h = 40) =>
  node({ tag: "div", bbox: { x, y, width: w, height: h } });

const flexCol = (over: Record<string, string> = {}, children: CapturedNode[] = [kid(16, 16), kid(16, 64)]) =>
  node({
    tag: "div", bbox: { x: 0, y: 0, width: 200, height: 300 },
    styles: { ...node({ tag: "div" }).styles, display: "flex", flexDirection: "column", rowGap: "8px",
      paddingTop: "16px", paddingRight: "16px", paddingBottom: "16px", paddingLeft: "16px",
      justifyContent: "flex-start", alignItems: "flex-start", ...over },
    children,
  });

describe("inferCandidate — flex", () => {
  it("maps a flex column with gap, padding, and aligns", () => {
    const c = inferCandidate(flexCol({ justifyContent: "center", alignItems: "center" }));
    expect(c).toEqual({
      source: "flex",
      layout: { mode: "vertical", gap: 8,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        primaryAlign: "center", counterAlign: "center" },
    });
  });
  it("maps row direction + space-between, stretch→start", () => {
    const c = inferCandidate(flexCol({ flexDirection: "row", columnGap: "12px", justifyContent: "space-between", alignItems: "stretch" }));
    expect(c!.layout.mode).toBe("horizontal");
    expect(c!.layout.gap).toBe(12);
    expect(c!.layout.primaryAlign).toBe("space-between");
    expect(c!.layout.counterAlign).toBe("start");
  });
  it("rejects *-reverse and space-around", () => {
    expect(inferCandidate(flexCol({ flexDirection: "column-reverse" }))).toBeNull();
    expect(inferCandidate(flexCol({ justifyContent: "space-around" }))).toBeNull();
  });
});

describe("inferCandidate — grid", () => {
  it("maps a single-column grid to vertical", () => {
    const c = inferCandidate(flexCol({ display: "grid", gridTemplateColumns: "168px", gridTemplateRows: "40px 40px", rowGap: "8px" }));
    expect(c!.source).toBe("grid");
    expect(c!.layout.mode).toBe("vertical");
  });
  it("maps a single-row grid to horizontal and rejects 2-D grids", () => {
    const h = inferCandidate(flexCol({ display: "grid", gridTemplateColumns: "80px 80px", gridTemplateRows: "40px", columnGap: "8px" }));
    expect(h!.layout.mode).toBe("horizontal");
    expect(inferCandidate(flexCol({ display: "grid", gridTemplateColumns: "80px 80px", gridTemplateRows: "40px 40px" }))).toBeNull();
  });
});

describe("inferCandidate — block flow", () => {
  it("detects a consistent vertical stack (gap from bbox spacing)", () => {
    const stack = node({
      tag: "div", bbox: { x: 0, y: 0, width: 200, height: 300 },
      children: [kid(0, 0), kid(0, 48), kid(0, 96)],   // 40 tall + 8 gap
    });
    const c = inferCandidate(stack);
    expect(c).toEqual({ source: "flow", layout: { mode: "vertical", gap: 8, padding: { top: 0, right: 0, bottom: 0, left: 0 } } });
  });
  it("rejects inconsistent gaps and overlapping children", () => {
    expect(inferCandidate(node({ tag: "div", bbox: { x: 0, y: 0, width: 200, height: 300 },
      children: [kid(0, 0), kid(0, 48), kid(0, 120)] }))).toBeNull();   // gaps 8 vs 32
    expect(inferCandidate(node({ tag: "div", bbox: { x: 0, y: 0, width: 200, height: 300 },
      children: [kid(0, 0), kid(0, 20)] }))).toBeNull();                // overlap
  });
  it("requires ≥2 children for flow", () => {
    expect(inferCandidate(node({ tag: "div", bbox: { x: 0, y: 0, width: 200, height: 300 }, children: [kid(0, 0)] }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-layout.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/extract/layout-infer.ts`**

```ts
/**
 * Aggressive auto-layout inference (SP3b §5): flex / 1-D grid / block flow →
 * AutoLayout CANDIDATES. Pure; a candidate is only kept after the geometric
 * self-check (see verifyCandidate) — never trusted directly.
 */
import type { AutoLayout, Padding } from "@uxfactory/spec";
import type { CapturedNode } from "../render/dom-capture.js";
import { px } from "./dom-to-designspec.js";

export type LayoutSource = "flex" | "grid" | "flow";
export interface LayoutCandidate { layout: AutoLayout; source: LayoutSource; }

const PRIMARY_ALIGN: Record<string, AutoLayout["primaryAlign"]> = {
  "flex-start": "start", start: "start", normal: "start", left: "start",
  center: "center", "flex-end": "end", end: "end", right: "end",
  "space-between": "space-between",
};
const COUNTER_ALIGN: Record<string, AutoLayout["counterAlign"]> = {
  "flex-start": "start", start: "start", normal: "start", stretch: "start",
  center: "center", "flex-end": "end", end: "end", baseline: "start",
};
const GAP_TOLERANCE = 1;

function paddingOf(n: CapturedNode): Padding {
  const s = n.styles;
  return { top: px(s.paddingTop), right: px(s.paddingRight), bottom: px(s.paddingBottom), left: px(s.paddingLeft) };
}

function withOptional(base: AutoLayout, gap: number, padding: Padding,
  primary?: AutoLayout["primaryAlign"], counter?: AutoLayout["counterAlign"]): AutoLayout {
  const out: AutoLayout = { mode: base.mode };
  if (gap !== 0) out.gap = gap;
  out.padding = padding;
  if (primary !== undefined && primary !== "start") out.primaryAlign = primary;
  else if (primary === "start") out.primaryAlign = "start";
  if (counter !== undefined) out.counterAlign = counter;
  return out;
}

function flexCandidate(n: CapturedNode): LayoutCandidate | null {
  const s = n.styles;
  let mode: AutoLayout["mode"];
  if (s.flexDirection === "row") mode = "horizontal";
  else if (s.flexDirection === "column") mode = "vertical";
  else return null;                                     // *-reverse not expressible
  const primary = PRIMARY_ALIGN[s.justifyContent];
  if (primary === undefined) return null;               // space-around/evenly etc.
  const counter = COUNTER_ALIGN[s.alignItems];
  if (counter === undefined) return null;
  const gap = mode === "vertical" ? px(s.rowGap) : px(s.columnGap);
  return { source: "flex", layout: withOptional({ mode }, gap, paddingOf(n), primary, counter) };
}

/** Count resolved track tokens at top level (computed lists are px values; parens guarded anyway). */
function trackCount(list: string): number {
  if (list === "none" || list === "") return 0;
  let depth = 0; let count = 0; let inToken = false;
  for (const ch of list) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === " " && depth === 0) { inToken = false; continue; }
    if (!inToken) { count += 1; inToken = true; }
  }
  return count;
}

function gridCandidate(n: CapturedNode): LayoutCandidate | null {
  const s = n.styles;
  const cols = trackCount(s.gridTemplateColumns);
  const rows = trackCount(s.gridTemplateRows);
  let mode: AutoLayout["mode"];
  if (cols === 1) mode = "vertical";
  else if (rows === 1 && cols > 1) mode = "horizontal";
  else return null;                                     // 2-D — never guessed
  const gap = mode === "vertical" ? px(s.rowGap) : px(s.columnGap);
  return { source: "grid", layout: withOptional({ mode }, gap, paddingOf(n)) };
}

function flowCandidate(n: CapturedNode): LayoutCandidate | null {
  if (n.children.length < 2) return null;
  const kids = n.children;
  // Vertical stack: strictly descending, non-overlapping, consistent gaps.
  let vOk = true;
  const vGaps: number[] = [];
  for (let i = 1; i < kids.length; i += 1) {
    const gap = kids[i]!.bbox.y - (kids[i - 1]!.bbox.y + kids[i - 1]!.bbox.height);
    if (gap < 0) { vOk = false; break; }
    vGaps.push(gap);
  }
  if (vOk && (vGaps.length === 0 || Math.max(...vGaps) - Math.min(...vGaps) <= GAP_TOLERANCE)) {
    const gap = vGaps.length === 0 ? 0 : Math.round(vGaps.reduce((a, b) => a + b, 0) / vGaps.length);
    return { source: "flow", layout: withOptional({ mode: "vertical" }, gap, paddingOf(n)) };
  }
  // Horizontal row: strictly advancing x, non-overlapping, consistent gaps.
  let hOk = true;
  const hGaps: number[] = [];
  for (let i = 1; i < kids.length; i += 1) {
    const gap = kids[i]!.bbox.x - (kids[i - 1]!.bbox.x + kids[i - 1]!.bbox.width);
    if (gap < 0) { hOk = false; break; }
    hGaps.push(gap);
  }
  if (hOk && (hGaps.length === 0 || Math.max(...hGaps) - Math.min(...hGaps) <= GAP_TOLERANCE)) {
    const gap = hGaps.length === 0 ? 0 : Math.round(hGaps.reduce((a, b) => a + b, 0) / hGaps.length);
    return { source: "flow", layout: withOptional({ mode: "horizontal" }, gap, paddingOf(n)) };
  }
  return null;
}

/** First matching source wins: flex → grid → flow. Null = stay absolute. */
export function inferCandidate(n: CapturedNode): LayoutCandidate | null {
  const d = n.styles.display;
  if (d === "flex" || d === "inline-flex") return flexCandidate(n);
  if (d === "grid" || d === "inline-grid") return gridCandidate(n);
  return flowCandidate(n);
}
```

Note on the flex test expectation: `withOptional` always sets `padding` and sets `primaryAlign` explicitly even for `"start"` when it came from flex (the test for center/space-between asserts presence; the exact-equality test in Step 1 expects `primaryAlign: "center"` and `counterAlign: "center"` — run the tests and align `withOptional`'s omit-vs-emit behavior with them: the first flex test requires `primaryAlign`+`counterAlign` PRESENT, the flow test requires them ABSENT. The implementation above does exactly that: flex passes both, flow passes neither.)

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-layout.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm -r build` — green. Then:

```bash
git add packages/uxfactory-cli/src/extract/layout-infer.ts packages/uxfactory-cli/test/extract-layout.test.ts
git commit -m "feat(cli): auto-layout candidates from flex, 1-D grid, block flow (SP3b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Geometric self-check + assembler wiring + fill sizing

**Files:**
- Modify: `packages/uxfactory-cli/src/extract/layout-infer.ts` (add `verifyCandidate`)
- Modify: `packages/uxfactory-cli/src/extract/dom-to-designspec.ts` (wire candidates→verify→attach; fill sizing; stats)
- Test: `packages/uxfactory-cli/test/extract-selfcheck.test.ts`

**Interfaces:**
- Consumes: `LayoutCandidate`, `inferCandidate` (Task 4); `contentBox` logic (Task 2 — export it from `dom-to-designspec.ts` or duplicate the inset math locally in `layout-infer.ts`; EXPORT it: add `export` to `contentBox` in Task 2's file).
- Produces:

```ts
export const SELF_CHECK_TOLERANCE = 1;   // px, per coordinate
export function verifyCandidate(candidate: LayoutCandidate, parent: CapturedNode): boolean;
```

Assembler behavior after wiring: every container calls `inferCandidate` → if candidate and `verifyCandidate` passes, the frame gets `layout` (+ children keep their observed parent-relative coords) and `stats.containers[source]` increments; if a candidate FAILS verification, `stats.selfCheckFallbacks` increments and the container stays absolute (`stats.containers.absolute`). Children in a **verified vertical** container whose width spans the parent content box (±1px) get `sizing: { horizontal: "fill" }` (symmetric for horizontal/vertical) — nested frames only (`Frame.sizing`), never the top-level view frames, never leaves (ShapeNode/TextNode have no sizing in the model).

- [ ] **Step 1: Write the failing tests**

Create `packages/uxfactory-cli/test/extract-selfcheck.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inferCandidate, verifyCandidate } from "../src/extract/layout-infer.js";
import { extractDesignSpec } from "../src/extract/dom-to-designspec.js";
import { validate } from "@uxfactory/spec";
import type { Frame } from "@uxfactory/spec";
import { node } from "./extract-fixtures.js";
import type { CapturedNode } from "../src/render/dom-capture.js";

const flexStyles = (over: Record<string, string> = {}) => ({
  ...node({ tag: "div" }).styles, display: "flex", flexDirection: "column", rowGap: "8px",
  paddingTop: "16px", paddingRight: "16px", paddingBottom: "16px", paddingLeft: "16px",
  justifyContent: "flex-start", alignItems: "flex-start", ...over,
});

/** A flex column whose children sit EXACTLY where the layout says. */
const consistent = (): CapturedNode => node({
  tag: "div", sel: "div#col", bbox: { x: 0, y: 0, width: 200, height: 300 }, styles: flexStyles(),
  children: [
    node({ tag: "div", bbox: { x: 16, y: 16, width: 100, height: 40 } }),
    node({ tag: "div", bbox: { x: 16, y: 64, width: 100, height: 40 } }),   // 16+40+8
  ],
});

/** Same styles, but a child is 10px off — CSS said flex, reality disagrees. */
const inconsistent = (): CapturedNode => {
  const n = consistent();
  n.children[1]!.bbox = { ...n.children[1]!.bbox, y: 74 };
  return n;
};

describe("verifyCandidate", () => {
  it("accepts exact reconstruction and rejects >1px drift", () => {
    expect(verifyCandidate(inferCandidate(consistent())!, consistent())).toBe(true);
    expect(verifyCandidate(inferCandidate(inconsistent())!, inconsistent())).toBe(false);
  });

  it("reconstructs center and space-between distributions", () => {
    const centered = node({
      tag: "div", bbox: { x: 0, y: 0, width: 200, height: 300 },
      styles: flexStyles({ justifyContent: "center", paddingTop: "0px", paddingBottom: "0px", paddingLeft: "0px", paddingRight: "0px", rowGap: "0px" }),
      children: [
        node({ tag: "div", bbox: { x: 0, y: 110, width: 100, height: 40 } }),
        node({ tag: "div", bbox: { x: 0, y: 150, width: 100, height: 40 } }),  // (300-80)/2 = 110
      ],
    });
    expect(verifyCandidate(inferCandidate(centered)!, centered)).toBe(true);
    const between = node({
      tag: "div", bbox: { x: 0, y: 0, width: 200, height: 300 },
      styles: flexStyles({ justifyContent: "space-between", paddingTop: "0px", paddingBottom: "0px", paddingLeft: "0px", paddingRight: "0px", rowGap: "0px" }),
      children: [
        node({ tag: "div", bbox: { x: 0, y: 0, width: 100, height: 40 } }),
        node({ tag: "div", bbox: { x: 0, y: 260, width: 100, height: 40 } }), // pinned to end
      ],
    });
    expect(verifyCandidate(inferCandidate(between)!, between)).toBe(true);
  });
});

describe("assembler layout wiring", () => {
  const wrap = (tree: CapturedNode) => {
    const body = node({ tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 }, children: [tree] });
    return extractDesignSpec([{ page: "p.html", view: "v", viewport: { width: 390, height: 844 }, tree: body }]);
  };

  it("attaches verified auto-layout and counts the source", () => {
    const { spec, stats } = wrap(consistent());
    expect(validate(spec).valid).toBe(true);
    const col = spec.frames[0]!.children![0] as Frame;
    expect(col.layout).toEqual({
      mode: "vertical", gap: 8,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      primaryAlign: "start", counterAlign: "start",
    });
    expect(stats.containers.flex).toBe(1);
    expect(stats.selfCheckFallbacks).toBe(0);
  });

  it("falls back to absolute (per container) when the self-check fails", () => {
    const { spec, stats } = wrap(inconsistent());
    const col = spec.frames[0]!.children![0] as Frame;
    expect(col.layout).toBeUndefined();
    expect(stats.selfCheckFallbacks).toBe(1);
    expect(stats.containers.absolute).toBeGreaterThanOrEqual(1);
  });

  it("gives fill sizing to spanning children of verified vertical containers, never to top-level frames", () => {
    const spanning = node({
      tag: "div", sel: "div#col", bbox: { x: 0, y: 0, width: 200, height: 300 },
      styles: flexStyles({ alignItems: "stretch" }),
      children: [
        node({ tag: "div", sel: "div#row", bbox: { x: 16, y: 16, width: 168, height: 40 },   // spans 200-16-16
          children: [node({ tag: "span", bbox: { x: 16, y: 16, width: 50, height: 20 }, text: "x" })] }),
        node({ tag: "div", bbox: { x: 16, y: 64, width: 100, height: 40 } }),
      ],
    });
    const { spec } = wrap(spanning);
    const col = spec.frames[0]!.children![0] as Frame;
    const row = col.children![0] as Frame;
    expect(row.sizing).toEqual({ horizontal: "fill" });
    const narrow = col.children![1]!;
    expect((narrow as { sizing?: unknown }).sizing).toBeUndefined();
    expect(spec.frames[0]!.sizing).toBeUndefined();     // top-level: never
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-selfcheck.test.ts`
Expected: FAIL — `verifyCandidate` not exported; assembler attaches no layout.

- [ ] **Step 3: Implement `verifyCandidate` in `layout-infer.ts`**

Export `contentBox` from `dom-to-designspec.ts` (add `export` — it exists from Task 2) and import it here. Append:

```ts
export const SELF_CHECK_TOLERANCE = 1;

/**
 * Reconstruct each child's expected position under SP3a auto-layout semantics
 * and compare with the observed bboxes. Any per-coordinate delta above
 * SELF_CHECK_TOLERANCE rejects the candidate (§6 of the SP3b spec).
 */
export function verifyCandidate(candidate: LayoutCandidate, parent: CapturedNode): boolean {
  const { layout } = candidate;
  const kids = parent.children;
  if (kids.length === 0) return true;
  const content = contentBox(parent);
  const vertical = layout.mode === "vertical";
  const gap = layout.gap ?? 0;

  const primarySizes = kids.map((k) => (vertical ? k.bbox.height : k.bbox.width));
  const run = primarySizes.reduce((a, b) => a + b, 0) + gap * (kids.length - 1);
  const contentPrimary = vertical ? content.height : content.width;
  const leftover = contentPrimary - run;

  let cursor = vertical ? content.y : content.x;
  let step = gap;
  const align = layout.primaryAlign ?? "start";
  if (align === "center") cursor += leftover / 2;
  else if (align === "end") cursor += leftover;
  else if (align === "space-between" && kids.length > 1) step = gap + leftover / (kids.length - 1);

  for (const [i, kid] of kids.entries()) {
    const expectedPrimary = cursor;
    cursor += primarySizes[i]! + step;

    const counterSize = vertical ? kid.bbox.width : kid.bbox.height;
    const contentCounter = vertical ? content.width : content.height;
    const counterStart = vertical ? content.x : content.y;
    const cAlign = layout.counterAlign ?? "start";
    let expectedCounter = counterStart;
    if (cAlign === "center") expectedCounter += (contentCounter - counterSize) / 2;
    else if (cAlign === "end") expectedCounter += contentCounter - counterSize;

    const obsPrimary = vertical ? kid.bbox.y : kid.bbox.x;
    const obsCounter = vertical ? kid.bbox.x : kid.bbox.y;
    if (Math.abs(obsPrimary - expectedPrimary) > SELF_CHECK_TOLERANCE) return false;
    if (Math.abs(obsCounter - expectedCounter) > SELF_CHECK_TOLERANCE) return false;
  }
  return true;
}
```

- [ ] **Step 4: Wire into the assembler**

In `dom-to-designspec.ts`'s `toFrame` (and the root-frame construction in `extractDesignSpec`):

```ts
import { inferCandidate, verifyCandidate } from "./layout-infer.js";
```

```ts
  const candidate = n.children.length > 0 ? inferCandidate(n) : null;
  let attached = false;
  if (candidate !== null) {
    if (verifyCandidate(candidate, n)) {
      frame.layout = candidate.layout;
      ctx.stats.containers[candidate.source] += 1;
      attached = true;
    } else {
      ctx.stats.selfCheckFallbacks += 1;
    }
  }
  if (!attached) ctx.stats.containers.absolute += 1;
```

(Replace Task 2's unconditional `ctx.stats.containers.absolute += 1` with this block.) Then fill sizing, applied only to **nested frame children** of a verified container (in `toFrame`, after children are built — for each child that is a Frame, compare against the parent's content box):

```ts
  if (attached) {
    const content = contentBox(n);
    for (const [i, childNode] of n.children.entries()) {
      const child = frame.children![i]!;
      if (!("type" in child)) {          // nested Frame (no discriminant) — leaves have no sizing
        const b = childNode.bbox;
        if (frame.layout!.mode === "vertical" && Math.abs(b.width - content.width) <= 1) {
          (child as Frame).sizing = { horizontal: "fill" };
        } else if (frame.layout!.mode === "horizontal" && Math.abs(b.height - content.height) <= 1) {
          (child as Frame).sizing = { vertical: "fill" };
        }
      }
    }
  }
```

Root frames in `extractDesignSpec` get the same candidate→verify→attach treatment (the body is often a flex/flow column) but NEVER the sizing pass output on themselves (they are not children of anything) — the sizing pass runs on their children as in `toFrame`. Refactor so both paths share one helper if that keeps it DRY (e.g. `attachLayout(frame, n, ctx)` used by `toFrame` and the root loop).

- [ ] **Step 5: Run the extractor suite**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-selfcheck.test.ts test/extract-structure.test.ts test/extract-style.test.ts test/extract-layout.test.ts`
Expected: PASS. (Structure tests still pass — their neutral fixtures produce no candidates or verified trivial ones; if the two-child body fixtures in structure tests now gain verified flow layouts, assert nothing breaks — the tests only check names/geometry/validity, which are unaffected.)

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm -r build` — green. Then:

```bash
git add packages/uxfactory-cli/src/extract/layout-infer.ts packages/uxfactory-cli/src/extract/dom-to-designspec.ts packages/uxfactory-cli/test/extract-selfcheck.test.ts
git commit -m "feat(cli): geometric self-check gates auto-layout; fill sizing (SP3b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: The `uxfactory extract` command — self-gating CLI

**Files:**
- Create: `packages/uxfactory-cli/src/commands/extract.ts`
- Modify: `packages/uxfactory-cli/src/cli.ts` (register `extract <dir>` — copy the `batch <dir>` block's wiring style at `src/cli.ts:207`, keeping `--json` and `--data-dir` semantics identical)
- Test: `packages/uxfactory-cli/test/extract-cli.test.ts`

**Interfaces:**
- Consumes: `readRegistry` (`../batch/registry.js`), `readTrace` (`../batch/trace.js`), `renderHtml`/`HtmlRenderDeps` (Task 1 wiring), `extractDesignSpec`/`ExtractedView`/`ExtractResult` (Tasks 2–5), `validate` (`@uxfactory/spec`), `EXIT` (`../exit.js`), `IO` (`../io.js`).
- Produces:

```ts
export interface ExtractFlags { json?: boolean; dataDir: string; cwd: string; }
export async function extractCmd(dir: string, flags: ExtractFlags, io: IO, deps?: HtmlRenderDeps): Promise<number>;
```

Behavior: registry must have `inputs.screens` + `inputs.trace` (else exit 2) → render all views with `captureDom: true` (viewport `{ width: 390, height: 844 }`, previews to `<dataDir>/batch/previews`) → views with `ok:false` or missing `domTree` are excluded + reported → assemble → `validate()` (invalid → exit 1, nothing written) → write `<dataDir>/batch/designspec/design.designspec.json` (combined) + `<page basename>-<view>.designspec.json` per view (single-frame specs, each re-positioned to x:0) → `--json` prints `{ ok, views, excluded, nodes, containers, selfCheckFallbacks, files }` → exit 0, or 1 if any view was excluded.

- [ ] **Step 1: Write the failing test**

Create `packages/uxfactory-cli/test/extract-cli.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractCmd } from "../src/commands/extract.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";
import { validate } from "@uxfactory/spec";
import type { RenderSnapshot } from "../src/batch/html-checks.js";
import { node } from "./extract-fixtures.js";

let root: string;
const trace = {
  version: 1,
  pages: [{ file: "screens/checkout.html", views: [
    { id: "success", covers: [] }, { id: "error", covers: [] },
  ] }],
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-extract-"));
  await mkdir(path.join(root, "design/screens"), { recursive: true });
  await writeFile(path.join(root, "design/trace.json"), JSON.stringify(trace));
  await writeFile(path.join(root, "design/screens/checkout.html"), "<!doctype html><html><body></body></html>");
  await writeFile(path.join(root, "uxfactory.batch.json"), JSON.stringify({
    version: 1, inputs: { screens: "design/screens", trace: "design/trace.json" },
  }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const snap = (view: string, ok = true): RenderSnapshot => ({
  page: "screens/checkout.html", view, viewport: { width: 390, height: 844 },
  screenshot: `checkout-${view}.png`, ok, ...(ok ? {} : { error: "boom" }),
  coverChecks: [], paintedColors: [], axe: [],
  ...(ok ? { domTree: node({ tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 },
    children: [node({ tag: "h1", bbox: { x: 20, y: 20, width: 200, height: 32 }, text: "Done" })] }) } : {}),
});

describe("extractCmd", () => {
  it("renders with captureDom, assembles, validates, writes combined + per-view files", async () => {
    const io = makeIO();
    let sawCapture = false;
    const code = await extractCmd(
      "design",
      { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root },
      io,
      { renderViews: async (r) => { sawCapture = r.captureDom === true; return [snap("success"), snap("error")]; } },
    );
    expect(code).toBe(EXIT.OK);
    expect(sawCapture).toBe(true);
    const combined = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/designspec/design.designspec.json"), "utf8"));
    expect(validate(combined).valid).toBe(true);
    expect(combined.frames).toHaveLength(2);
    const perView = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/designspec/checkout-success.designspec.json"), "utf8"));
    expect(validate(perView).valid).toBe(true);
    expect(perView.frames).toHaveLength(1);
    expect(perView.frames[0].x).toBe(0);
    const summary = JSON.parse(io.stdout().trim().split("\n").at(-1)!);
    expect(summary.ok).toBe(true);
    expect(summary.views).toBe(2);
  });

  it("excludes failed views, still writes the good ones, and exits 1", async () => {
    const io = makeIO();
    const code = await extractCmd(
      "design",
      { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root },
      io,
      { renderViews: async () => [snap("success"), snap("error", false)] },
    );
    expect(code).toBe(EXIT.GATE_FAIL);
    const combined = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/designspec/design.designspec.json"), "utf8"));
    expect(combined.frames).toHaveLength(1);
    const summary = JSON.parse(io.stdout().trim().split("\n").at(-1)!);
    expect(summary.excluded).toEqual([{ page: "screens/checkout.html", view: "error", error: "boom" }]);
  });

  it("exits 2 when screens/trace are not registered", async () => {
    await writeFile(path.join(root, "uxfactory.batch.json"), JSON.stringify({ version: 1, inputs: {} }));
    const io = makeIO();
    const code = await extractCmd("design", { dataDir: path.join(root, ".uxfactory"), cwd: root }, io,
      { renderViews: async () => [] });
    expect(code).toBe(EXIT.TRANSPORT);
  });
});
```

(Check `test/helpers.ts` for `makeIO`'s exact capture API — the batch-html tests use it; if its accessor differs from `io.stdout()`, match the existing helper.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-cli.test.ts`
Expected: FAIL — `commands/extract.ts` doesn't exist.

- [ ] **Step 3: Implement `src/commands/extract.ts`**

```ts
/**
 * `uxfactory extract` — render the trace's (page,view) set with DOM capture and
 * emit the extracted semantic DesignSpec, self-gated by @uxfactory/spec validate().
 * Deterministic, LLM-free; the renderer is injectable for tests (SP3b §8).
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { validate } from "@uxfactory/spec";
import type { DesignSpec } from "@uxfactory/spec";
import { EXIT } from "../exit.js";
import { readRegistry } from "../batch/registry.js";
import { readTrace } from "../batch/trace.js";
import { renderHtml, type HtmlRenderDeps } from "../render/html-render.js";
import { extractDesignSpec, type ExtractedView } from "../extract/dom-to-designspec.js";
import type { IO } from "../io.js";

const DEFAULT_VIEWPORT = { width: 390, height: 844 };

export interface ExtractFlags {
  json?: boolean;
  dataDir: string;
  cwd: string;
}

export async function extractCmd(
  dir: string,
  flags: ExtractFlags,
  io: IO,
  deps?: HtmlRenderDeps,
): Promise<number> {
  void dir; // like batch HTML mode, inputs come from the registry, not the positional arg

  const reg = await readRegistry(path.join(flags.cwd, "uxfactory.batch.json"));
  if (!reg.ok) { io.err(reg.message); return EXIT.TRANSPORT; }
  if (reg.inputs.screens === null || reg.inputs.trace === null) {
    io.err("extract requires registered inputs.screens and inputs.trace (like the HTML batch tier).");
    return EXIT.TRANSPORT;
  }
  const traceResult = await readTrace(reg.inputs.trace);
  if (!traceResult.ok) { io.err(traceResult.message); return EXIT.TRANSPORT; }

  const previewDir = path.join(flags.dataDir, "batch", "previews");
  await mkdir(previewDir, { recursive: true });
  let snapshots;
  try {
    snapshots = await renderHtml(
      {
        baseDir: path.dirname(reg.inputs.trace), trace: traceResult.trace,
        previewDir, viewport: DEFAULT_VIEWPORT, captureDom: true,
      },
      deps,
    );
  } catch (err) {
    io.err(`extract: renderer unavailable — ${(err as Error).message}`);
    return EXIT.TRANSPORT;
  }

  const views: ExtractedView[] = [];
  const excluded: { page: string; view: string; error: string }[] = [];
  for (const s of snapshots) {
    if (s.ok && s.domTree !== undefined) {
      views.push({ page: s.page, view: s.view, viewport: s.viewport, tree: s.domTree });
    } else {
      excluded.push({ page: s.page, view: s.view, error: s.error ?? "no DOM tree captured" });
    }
  }

  const { spec, stats } = extractDesignSpec(views);
  const result = validate(spec);
  if (!result.valid) {
    const msg = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    if (flags.json === true) io.out(JSON.stringify({ ok: false, reason: "invalid-spec", errors: msg }));
    else io.err(`extract: assembled spec failed validation — ${msg}`);
    return EXIT.GATE_FAIL;
  }

  const outDir = path.join(flags.dataDir, "batch", "designspec");
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  const combinedPath = path.join(outDir, "design.designspec.json");
  await writeFile(combinedPath, JSON.stringify(spec, null, 2), "utf8");
  files.push(combinedPath);
  for (const frame of spec.frames) {
    const [page, view] = [frame.name.slice(0, frame.name.lastIndexOf("/")), frame.name.slice(frame.name.lastIndexOf("/") + 1)];
    const single: DesignSpec = { frames: [{ ...frame, x: 0 }] };
    const file = path.join(outDir, `${path.basename(page, ".html")}-${view}.designspec.json`);
    await writeFile(file, JSON.stringify(single, null, 2), "utf8");
    files.push(file);
  }

  if (flags.json === true) {
    io.out(JSON.stringify({
      ok: excluded.length === 0, views: stats.views, excluded, nodes: stats.nodes,
      containers: stats.containers, selfCheckFallbacks: stats.selfCheckFallbacks,
      files: files.map((f) => path.relative(flags.cwd, f)),
    }));
  } else {
    io.out(`extract: ${stats.views} view(s) → ${path.relative(flags.cwd, combinedPath)} (${stats.nodes} nodes; layout: ${stats.containers.flex} flex / ${stats.containers.grid} grid / ${stats.containers.flow} flow / ${stats.containers.absolute} absolute; ${stats.selfCheckFallbacks} self-check fallback(s))`);
    for (const e of excluded) io.err(`extract: EXCLUDED ${e.page}#${e.view} — ${e.error}`);
  }
  return excluded.length === 0 ? EXIT.OK : EXIT.GATE_FAIL;
}
```

Check `readRegistry`'s exact return shape in `src/batch/registry.ts` before coding (`reg.ok`/`reg.message`/`reg.inputs` — align with how `batch.ts:172-183` consumes it; if it returns `{ registry, inputs }` without `ok`, mirror `batch.ts`'s error handling exactly).

- [ ] **Step 4: Register the command in `src/cli.ts`**

Add next to the `batch <dir>` block (mirroring its `--json` / `--data-dir` option wiring and default values exactly — read the block at `src/cli.ts:207` first):

```ts
  program
    .command("extract <dir>")
    .description("Extract the rendered HTML views into a semantic DesignSpec (SP3b)")
    .option("--json", "machine-readable summary")
    .option("--data-dir <path>", "data directory", ".uxfactory")
    .action(async (dir: string, opts: { json?: boolean; dataDir: string }) => {
      const { extractCmd } = await import("./commands/extract.js");
      const code = await extractCmd(
        dir,
        { json: opts.json, dataDir: path.resolve(opts.dataDir), cwd: process.cwd() },
        consoleIO,
      );
      process.exitCode = code;
    });
```

(Align the exact `.option` defaults, `path` resolution, and exit style with how the `batch` block does it — copy its conventions verbatim.)

- [ ] **Step 5: Run the CLI tests + the full extractor suite**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-cli.test.ts test/extract-structure.test.ts test/extract-style.test.ts test/extract-layout.test.ts test/extract-selfcheck.test.ts test/dom-capture.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Full gates**

Run: `pnpm --filter @uxfactory/cli test` (pre-existing browser-test slowness aside — no NEW failures) and `pnpm -r build`.
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-cli/src/commands/extract.ts packages/uxfactory-cli/src/cli.ts packages/uxfactory-cli/test/extract-cli.test.ts
git commit -m "feat(cli): uxfactory extract — self-gating DOM→DesignSpec command (SP3b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Read before coding:** `src/render/html-render-playwright.ts` (the `CAPTURE_FN` conventions Task 1 mirrors), `src/batch/registry.ts` (`readRegistry` return shape, Task 6), `test/helpers.ts` (`makeIO` capture API, Task 6), and `src/cli.ts:207` (the `batch <dir>` registration conventions, Task 6).
- **`Frame` has no `stroke`/`opacity`** in the SP3a model — frames get fill/cornerRadius/effects/layout/sizing only; leaves (ShapeNode) carry stroke/opacity. Do not add model fields.
- **Test-fixture helper sharing:** `node()`/`view()`/`VIEWPORT` live in `test/extract-fixtures.ts` (a plain module, NOT a `*.test.ts` file) — never import one test file from another (it re-registers the imported file's tests).
- **Determinism:** no `Date.now()`, no `Math.random()`, no map-iteration nondeterminism (insertion order only); everything `r2`-rounded.
- **The real-browser test** (Task 1) may be slow locally (known browser-close issue). It must exist and pass where a browser is available; do not silently delete or skip it wholesale.

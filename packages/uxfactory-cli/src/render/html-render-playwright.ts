/**
 * The ONLY module importing `playwright` + `axe-core` — both lazily, inside the
 * function body, so importing this module never fails when they are absent.
 * Renders each (page, view): goto → activate → settle → freeze → screenshot →
 * capture (cover selectors · painted colors) → axe run.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { HtmlRenderRequest } from "./html-render.js";
import type { RenderSnapshot, CoverCheck, PaintedColor, AxeFinding } from "../batch/html-checks.js";
import { EXTRACT_FN } from "./dom-capture.js";
import type { CapturedNode } from "./dom-capture.js";

const SETTLE_TIMEOUT_MS = 5000;
const FREEZE_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

/** In-page capture: resolves cover selectors + collects painted colors. Runs in the browser. */
const CAPTURE_FN = `(covers) => {
  const toHex = (c) => {
    const m = /^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)$/.exec(c);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a === 0) return null;
    const h = (n) => parseInt(n, 10).toString(16).padStart(2, "0");
    return "#" + h(m[1]) + h(m[2]) + h(m[3]);
  };
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
  const coverChecks = covers.map((c) => {
    const el = document.querySelector(c.selector);
    return { story: c.story, impliedState: c.impliedState, selector: c.selector, found: !!el, visible: !!el && visible(el) };
  });
  const colorMap = new Map();
  for (const el of document.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    for (const prop of ["color", "backgroundColor", "borderColor"]) {
      const hex = toHex(s[prop]);
      if (hex && !colorMap.has(hex)) colorMap.set(hex, shortSel(el));
    }
  }
  const paintedColors = [...colorMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([hex, exampleSelector]) => ({ hex, exampleSelector }));
  return { coverChecks, paintedColors };
}`;

export async function renderViewsPlaywright(req: HtmlRenderRequest): Promise<RenderSnapshot[]> {
  const { chromium } = await import("playwright");
  const axeMod = (await import("axe-core")) as unknown as { source?: string; default?: { source?: string } };
  const axeSource = axeMod.source ?? axeMod.default?.source;
  if (typeof axeSource !== "string") throw new Error("axe-core source unavailable");

  const browser = await chromium.launch({ headless: true });
  const out: RenderSnapshot[] = [];
  try {
    const context = await browser.newContext({
      viewport: req.viewport, locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce",
    });
    for (const tp of req.trace.pages) {
      const fileAbs = path.resolve(req.baseDir, tp.file);
      const fileUrl = pathToFileURL(fileAbs).href;
      for (const view of tp.views) {
        const screenshot = `${path.basename(tp.file, ".html")}-${view.id}.png`;
        const base: Omit<RenderSnapshot, "ok" | "error" | "coverChecks" | "paintedColors" | "axe"> = {
          page: tp.file, view: view.id, viewport: req.viewport, screenshot,
        };
        const page = await context.newPage();
        try {
          const gotoUrl =
            view.activate !== undefined && "query" in view.activate
              ? `${fileUrl}?${view.activate.query}`
              : fileUrl;
          await page.goto(gotoUrl, { waitUntil: "networkidle", timeout: SETTLE_TIMEOUT_MS * 3 });

          if (view.activate !== undefined && "hash" in view.activate) {
            // String-form evaluate (like CAPTURE_FN) so the engine tsconfig stays DOM-free.
            await page.evaluate(
              `((hash) => { location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); })(${JSON.stringify(view.activate.hash)})`,
            );
          } else if (view.activate !== undefined && "click" in view.activate) {
            for (const sel of view.activate.click) await page.click(sel, { timeout: SETTLE_TIMEOUT_MS });
          }

          await page.waitForLoadState("networkidle");
          await page.evaluate("document.fonts.ready");
          await page.evaluate(
            `((t) => {
              const r = window.uxfReady;
              return r && typeof r.then === "function"
                ? Promise.race([r, new Promise((res) => setTimeout(res, t))])
                : null;
            })(${JSON.stringify(SETTLE_TIMEOUT_MS)})`,
          );

          await page.addStyleTag({ content: FREEZE_CSS });
          await page.screenshot({ path: path.join(req.previewDir, screenshot), fullPage: true });

          const captured = (await page.evaluate(
            `(${CAPTURE_FN})(${JSON.stringify(view.covers)})`,
          )) as { coverChecks: CoverCheck[]; paintedColors: PaintedColor[] };

          let domTree: CapturedNode | undefined;
          if (req.captureDom === true) {
            domTree = (await page.evaluate(`(${EXTRACT_FN})()`)) as CapturedNode;
          }

          await page.addScriptTag({ content: axeSource });
          const axeRaw = (await page.evaluate(
            "axe.run(document, { resultTypes: ['violations'] })",
          )) as { violations: { id: string; impact?: string; help?: string; nodes: { target: string[] }[] }[] };
          const axe: AxeFinding[] = axeRaw.violations.map((v) => ({
            id: v.id,
            impact: v.impact as AxeFinding["impact"],
            help: v.help,
            targets: v.nodes.flatMap((n) => n.target.map(String)),
          }));

          out.push({ ...base, ok: true, coverChecks: captured.coverChecks, paintedColors: captured.paintedColors, axe, ...(domTree !== undefined ? { domTree } : {}) });
        } catch (err) {
          out.push({
            ...base, ok: false, error: (err as Error).message,
            coverChecks: view.covers.map((c) => ({ story: c.story, impliedState: c.impliedState, selector: c.selector, found: false, visible: false })),
            paintedColors: [], axe: [],
          });
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}

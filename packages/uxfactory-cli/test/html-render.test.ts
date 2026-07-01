import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderHtml, type HtmlRenderRequest } from "../src/render/html-render.js";
import type { RenderSnapshot } from "../src/batch/html-checks.js";
import type { TraceManifest } from "../src/batch/trace.js";

const trace: TraceManifest = {
  version: 1,
  pages: [{
    file: "screens/checkout.html",
    views: [{ id: "success", covers: [{ story: "checkout", impliedState: "success", selector: "#ok" }] }],
  }],
};

// --- orchestrator delegates to the injected dep (no browser) ---------------
describe("renderHtml (deps injection)", () => {
  it("delegates to the injected renderer", async () => {
    const fake: RenderSnapshot[] = [{
      page: "screens/checkout.html", view: "success", viewport: { width: 390, height: 844 },
      screenshot: "checkout-success.png", ok: true,
      coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true }],
      paintedColors: [], axe: [],
    }];
    const got = await renderHtml(
      { baseDir: "/x", trace, previewDir: "/x/.uxfactory/batch/previews", viewport: { width: 390, height: 844 } },
      { renderViews: async (_req: HtmlRenderRequest) => fake },
    );
    expect(got).toBe(fake);
  });
});

// --- real browser path (skipped when Chromium is unavailable) --------------
async function browserAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch {
    return false;
  }
}
const HAS_BROWSER = await browserAvailable();

describe.skipIf(!HAS_BROWSER)("renderViewsPlaywright (real Chromium)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "uxf-html-"));
    await mkdir(path.join(dir, "screens"), { recursive: true });
    await mkdir(path.join(dir, "previews"), { recursive: true });
    // Deliberately: low-contrast text (#777 on #888) → contrast violation; <img> w/o alt → a11y violation.
    await writeFile(path.join(dir, "screens/checkout.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Checkout</title></head>
<body style="background:#888888;margin:0"><main><h1 id="ok" style="color:#111111">Order confirmed</h1>
<p style="color:#777777">thank you</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main></body></html>`, "utf8");
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("captures cover visibility, painted colors, and axe violations", async () => {
    const { renderViewsPlaywright } = await import("../src/render/html-render-playwright.js");
    const snaps = await renderViewsPlaywright({
      baseDir: dir, trace, previewDir: path.join(dir, "previews"), viewport: { width: 390, height: 844 },
    });
    expect(snaps).toHaveLength(1);
    const s = snaps[0]!;
    expect(s.ok).toBe(true);
    expect(s.coverChecks[0]).toMatchObject({ found: true, visible: true });
    expect(s.paintedColors.some((c) => c.hex === "#111111")).toBe(true);
    expect(s.axe.some((v) => v.id === "color-contrast")).toBe(true);
    expect(s.axe.some((v) => v.id === "image-alt")).toBe(true);
  }, 30_000);
});

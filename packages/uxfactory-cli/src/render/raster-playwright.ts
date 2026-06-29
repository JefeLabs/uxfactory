/**
 * High-fidelity SVG-to-PNG renderer using a headless Chromium browser (Playwright).
 *
 * This is the ONLY module that imports `playwright` — and only lazily (inside the
 * function body). The module can be loaded safely even when `playwright` is not
 * installed; errors surface only when `svgToPngPlaywright` is called.
 *
 * Used by `raster-select.ts` at visual >= medium (tokens applied).
 */
export async function svgToPngPlaywright(svg: string): Promise<Buffer> {
  // Lazy import — throws if playwright is not installed or no browser binary.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;overflow:hidden;background:white">${svg}</body></html>`;
    await page.setContent(html, { waitUntil: "load" });
    // Size the viewport to match the SVG's intrinsic bounding box (no extra whitespace).
    const box = await page.locator("svg").first().boundingBox();
    if (box !== null) {
      await page.setViewportSize({
        width: Math.max(1, Math.ceil(box.width)),
        height: Math.max(1, Math.ceil(box.height)),
      });
    }
    const data = await page.screenshot({ type: "png" });
    return Buffer.from(data);
  } finally {
    await browser.close();
  }
}

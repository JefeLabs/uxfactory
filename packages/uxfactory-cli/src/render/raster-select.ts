/**
 * Renderer-by-`visual`-dial selector.
 *
 * Chooses between the fast resvg rasterizer (visual < medium, greybox) and the
 * high-fidelity Playwright renderer (visual >= medium, tokens applied).  Playwright
 * is optional: if unavailable (not installed / no browser binary), `rasterize` falls
 * back to resvg + a declared note — never a hard error.
 *
 * Design doc §6, Implementation plan Task 4.
 */

import { svgToPng } from "./raster.js";
import { LEVEL_ORD, type DialLevel } from "../batch/scope.js";

/** Injectable playwright-rasterizer for deterministic testing without a real browser. */
export interface PlaywrightRasterizerDeps {
  svgToPngPlaywright: (svg: string) => Promise<Buffer>;
}

/**
 * Returns which rasterizer applies for the given visual dial level.
 * - "resvg"      when visual < medium (low)
 * - "playwright" when visual >= medium (medium, high)
 */
export function selectRasterizer(visual: DialLevel): "resvg" | "playwright" {
  return LEVEL_ORD[visual] < LEVEL_ORD["medium"] ? "resvg" : "playwright";
}

/**
 * Rasterize an SVG according to the `visual` dial.
 *
 * - `visual < medium` → resvg (synchronous, deterministic).
 * - `visual >= medium` → Playwright; on ANY failure (not installed, browser missing,
 *   launch error) falls back to resvg and attaches a declared note.
 *
 * `deps.svgToPngPlaywright` overrides the real implementation — pass a stub in tests
 * to simulate playwright failure without requiring a real browser.
 */
export async function rasterize(
  svg: string,
  visual: DialLevel,
  deps?: PlaywrightRasterizerDeps,
): Promise<{ png: Buffer; rasterizer: "resvg" | "playwright"; note?: string }> {
  if (selectRasterizer(visual) !== "playwright") {
    return { png: svgToPng(svg), rasterizer: "resvg" };
  }

  // playwright path — use injected dep or default to the real lazy importer
  const playwrightFn =
    deps?.svgToPngPlaywright ??
    (async (s: string): Promise<Buffer> => {
      const { svgToPngPlaywright } = await import("./raster-playwright.js");
      return svgToPngPlaywright(s);
    });

  try {
    const png = await playwrightFn(svg);
    return { png, rasterizer: "playwright" };
  } catch {
    return {
      png: svgToPng(svg),
      rasterizer: "resvg",
      note: "high-fidelity renderer unavailable, used resvg",
    };
  }
}

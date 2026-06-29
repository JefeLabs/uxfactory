import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/** The 8-byte PNG signature. */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MINIMAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>`;

// Detect Chromium availability synchronously (before test registration)
// so that it.skipIf can use a plain boolean — no await needed at module scope.
const _require = createRequire(import.meta.url);
let browserAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pw = _require("playwright") as any;
  const exePath: string = pw.chromium.executablePath();
  browserAvailable = existsSync(exePath);
} catch {
  // playwright not installed or no browser binary — skip live tests
}

describe("svgToPngPlaywright", () => {
  // Live render test — only runs when a Chromium browser is detectably installed.
  // In the hermetic CI suite (no browser), this test is SKIPPED, never FAILED.
  it.skipIf(!browserAvailable)(
    "live: renders an SVG to a valid PNG (browser required — skipped if unavailable)",
    async () => {
      const { svgToPngPlaywright } = await import("../src/render/raster-playwright.js");
      const png = await svgToPngPlaywright(MINIMAL_SVG);
      expect(Buffer.isBuffer(png)).toBe(true);
      expect(png.length).toBeGreaterThan(8);
      expect(png.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    },
    30_000, // 30 s — allow time for browser startup
  );
});

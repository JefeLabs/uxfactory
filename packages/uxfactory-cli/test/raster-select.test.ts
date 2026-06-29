import { describe, it, expect } from "vitest";
import { selectRasterizer, rasterize } from "../src/render/raster-select.js";

/** The 8-byte PNG signature. */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MINIMAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>`;

// ---------------------------------------------------------------------------
// selectRasterizer
// ---------------------------------------------------------------------------

describe("selectRasterizer", () => {
  it('returns "resvg" for visual:low', () => {
    expect(selectRasterizer("low")).toBe("resvg");
  });

  it('returns "playwright" for visual:medium', () => {
    expect(selectRasterizer("medium")).toBe("playwright");
  });

  it('returns "playwright" for visual:high', () => {
    expect(selectRasterizer("high")).toBe("playwright");
  });
});

// ---------------------------------------------------------------------------
// rasterize
// ---------------------------------------------------------------------------

describe("rasterize", () => {
  it("visual:low → resvg PNG with valid 8-byte PNG signature, no note", async () => {
    const result = await rasterize(MINIMAL_SVG, "low");
    expect(result.rasterizer).toBe("resvg");
    expect(result.png.length).toBeGreaterThan(8);
    expect(result.png.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(result.note).toBeUndefined();
  });

  it("visual:medium with playwright unavailable → resvg fallback + note (deterministic via deps injection)", async () => {
    const failingDeps = {
      svgToPngPlaywright: async (_svg: string): Promise<Buffer> => {
        throw new Error("playwright not installed");
      },
    };
    const result = await rasterize(MINIMAL_SVG, "medium", failingDeps);
    expect(result.rasterizer).toBe("resvg");
    expect(result.png.length).toBeGreaterThan(8);
    expect(result.png.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(result.note).toBe("high-fidelity renderer unavailable, used resvg");
  });

  it("visual:high with playwright unavailable → resvg fallback + note (deterministic via deps injection)", async () => {
    const failingDeps = {
      svgToPngPlaywright: async (_svg: string): Promise<Buffer> => {
        throw new Error("browser not found");
      },
    };
    const result = await rasterize(MINIMAL_SVG, "high", failingDeps);
    expect(result.rasterizer).toBe("resvg");
    expect(result.png.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(result.note).toBe("high-fidelity renderer unavailable, used resvg");
  });

  it("visual:medium with working playwright deps → playwright result, no note", async () => {
    // Stub a successful playwright: return a fake 9-byte buffer starting with the PNG sig
    const fakePng = Buffer.concat([PNG_SIG, Buffer.from([0x00])]);
    const successDeps = {
      svgToPngPlaywright: async (_svg: string): Promise<Buffer> => fakePng,
    };
    const result = await rasterize(MINIMAL_SVG, "medium", successDeps);
    expect(result.rasterizer).toBe("playwright");
    expect(result.png).toBe(fakePng);
    expect(result.note).toBeUndefined();
  });
});

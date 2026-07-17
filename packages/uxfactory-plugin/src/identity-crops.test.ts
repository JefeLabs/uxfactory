import { describe, it, expect } from "vitest";
import { cropScaleFor } from "./identity-crops.js";

describe("cropScaleFor", () => {
  it("returns 1 (native size) when both edges are already under maxEdge", () => {
    expect(cropScaleFor(200, 100)).toBe(1);
  });

  it("returns 1 when the longest edge exactly equals maxEdge", () => {
    expect(cropScaleFor(1024, 512)).toBe(1);
  });

  it("scales a wide node down so width (the longest edge) lands at maxEdge", () => {
    const scale = cropScaleFor(4096, 512);
    expect(scale).toBeCloseTo(0.25, 10);
    expect(4096 * scale).toBeCloseTo(1024, 10);
  });

  it("scales a tall node down so height (the longest edge) lands at maxEdge", () => {
    const scale = cropScaleFor(512, 4096);
    expect(scale).toBeCloseTo(0.25, 10);
    expect(4096 * scale).toBeCloseTo(1024, 10);
  });

  it("never upscales — clamps to 1 even with a generous custom maxEdge on a tiny node", () => {
    expect(cropScaleFor(10, 10, 2000)).toBe(1);
  });

  it("falls back to scale 1 for undefined dimensions", () => {
    expect(cropScaleFor(undefined, undefined)).toBe(1);
  });

  it("falls back to scale 1 for zero dimensions", () => {
    expect(cropScaleFor(0, 0)).toBe(1);
  });

  it("falls back to scale 1 for a negative or non-finite dimension", () => {
    expect(cropScaleFor(-100, 50)).toBe(1);
    expect(cropScaleFor(Number.NaN, 50)).toBe(1);
  });

  it("respects a custom maxEdge", () => {
    expect(cropScaleFor(2000, 1000, 500)).toBeCloseTo(0.25, 10);
  });

  it("uses the larger of two mixed-defined dimensions (one undefined)", () => {
    // Only width provided; height undefined → treated as 0, width still governs.
    expect(cropScaleFor(2048, undefined)).toBeCloseTo(0.5, 10);
  });
});

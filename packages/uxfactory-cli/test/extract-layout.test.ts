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

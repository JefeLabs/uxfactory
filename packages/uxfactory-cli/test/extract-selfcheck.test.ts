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

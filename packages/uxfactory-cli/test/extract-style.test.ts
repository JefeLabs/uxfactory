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

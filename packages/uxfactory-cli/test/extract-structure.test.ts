import { describe, it, expect } from "vitest";
import { validate } from "@uxfactory/spec";
import type { Frame, TextNode, ShapeNode } from "@uxfactory/spec";
import { extractDesignSpec } from "../src/extract/dom-to-designspec.js";
import { node, view } from "./extract-fixtures.js";
import type { CapturedNode } from "../src/render/dom-capture.js";

describe("extractDesignSpec — structure", () => {
  it("emits one validated top-level frame per view, side-by-side, never fill-sized", () => {
    const body = node({ tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 } });
    const { spec, stats } = extractDesignSpec([
      view(body, "screens/a.html", "v1"), view(body, "screens/b.html", "v2"),
    ]);
    expect(validate(spec).valid).toBe(true);
    expect(spec.frames).toHaveLength(2);
    expect(spec.frames[0]!.name).toBe("screens/a.html/v1");
    expect(spec.frames[1]!.name).toBe("screens/b.html/v2");
    expect(spec.frames[0]!.x).toBe(0);
    expect(spec.frames[1]!.x).toBe(490);            // width 390 + 100 gutter
    expect(spec.frames[0]!.sizing).toBeUndefined(); // top-level never fill/hug
    expect(stats.views).toBe(2);
  });

  it("maps containers to nested frames and leaves to shapes/text, parent-relative", () => {
    const tree = node({
      tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 },
      children: [
        node({
          tag: "div", sel: "div#card", bbox: { x: 20, y: 30, width: 350, height: 200 },
          children: [
            node({ tag: "h1", bbox: { x: 36, y: 46, width: 200, height: 32 }, text: "Order confirmed" }),
            node({ tag: "img", bbox: { x: 36, y: 90, width: 64, height: 64 } }),
          ],
        }),
      ],
    });
    const { spec } = extractDesignSpec([view(tree)]);
    expect(validate(spec).valid).toBe(true);
    const root = spec.frames[0]!;
    const card = root.children![0] as Frame;
    expect(card.name).toBe("div#card");
    expect(card.x).toBe(20); expect(card.y).toBe(30);           // body-relative
    const h1 = card.children![0] as TextNode;
    expect(h1.type).toBe("text");
    expect(h1.characters).toBe("Order confirmed");
    expect(h1.x).toBe(16); expect(h1.y).toBe(16);               // card-relative
    const img = card.children![1] as ShapeNode;
    expect(img.type).toBe("shape");                              // replaced → placeholder shape
    expect(img.fill).toBe("#E5E7EB");
  });

  it("collapses no-signal single-child wrapper chains (geometry preserved)", () => {
    const inner = node({ tag: "section", sel: "section#real", bbox: { x: 10, y: 10, width: 100, height: 100 },
      children: [node({ tag: "p", bbox: { x: 10, y: 10, width: 80, height: 20 }, text: "hi" })] });
    const wrap2 = node({ tag: "div", bbox: { x: 10, y: 10, width: 100, height: 100 }, children: [inner] });
    const wrap1 = node({ tag: "div", bbox: { x: 10, y: 10, width: 100, height: 100 }, children: [wrap2] });
    const body = node({ tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 }, children: [wrap1] });
    const { spec } = extractDesignSpec([view(body)]);
    const root = spec.frames[0]!;
    expect(root.children).toHaveLength(1);
    const section = root.children![0] as Frame;
    expect(section.name).toBe("section#real");                   // both wrappers collapsed
    expect(section.x).toBe(10); expect(section.y).toBe(10);
  });

  it("turns #text runs into text nodes and is deterministic", () => {
    const p = node({ tag: "p", bbox: { x: 0, y: 0, width: 200, height: 40 },
      children: [
        node({ tag: "#text", sel: "#text", bbox: { x: 0, y: 0, width: 40, height: 20 }, text: "Body" }),
        node({ tag: "b", bbox: { x: 44, y: 0, width: 30, height: 20 }, text: "bold" }),
      ] });
    const body = node({ tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 }, children: [p] });
    const one = extractDesignSpec([view(body)]);
    const two = extractDesignSpec([view(body)]);
    expect(one).toEqual(two);                                    // pure + deterministic
    const pf = one.spec.frames[0]!.children![0] as Frame;
    const run = pf.children![0] as TextNode;
    expect(run.type).toBe("text");
    expect(run.characters).toBe("Body");
  });
});

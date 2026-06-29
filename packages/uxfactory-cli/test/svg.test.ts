import { describe, it, expect } from "vitest";
import { specToSvg } from "../src/render/svg.js";
import type { DesignSpec, FigjamSpec, EditOnlySpec } from "@uxfactory/spec";

const design: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "Frame A",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        {
          type: "shape",
          name: "box",
          x: 10,
          y: 20,
          width: 30,
          height: 40,
          fill: "#1E88E5",
          stroke: "#000000",
          strokeWidth: 2,
          cornerRadius: 4,
          characters: "Hi & <ok>",
        },
        {
          type: "text",
          name: "label",
          x: 10,
          y: 100,
          width: 80,
          height: 20,
          characters: "Caption",
        },
        { type: "instance", name: "fn", asset: "aws:lambda", x: 120, y: 20, width: 48, height: 48 },
      ],
    },
  ],
};

const figjam: FigjamSpec = {
  editor: "figjam",
  sections: [
    {
      name: "Sec",
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      children: [
        { type: "sticky", name: "note", x: 20, y: 20, characters: "Idea", fill: "#FFD966" },
      ],
    },
  ],
};

const connSpec: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "F",
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      children: [
        { type: "shape", name: "a", x: 0, y: 0, width: 100, height: 100 },
        { type: "shape", name: "b", x: 200, y: 0, width: 100, height: 100 },
      ],
    },
  ],
  connectors: [
    { from: "a", to: "b", label: "calls" },
    { from: "a", to: "ghost" }, // unresolved endpoint → skipped
  ],
};

const editOnly: EditOnlySpec = {
  editor: "figma",
  edits: [{ name: "x", set: { fill: "#ffffff" } }],
};

describe("specToSvg", () => {
  it("is deterministic — same spec renders to a byte-identical string", () => {
    expect(specToSvg(design)).toBe(specToSvg(design));
    expect(specToSvg(connSpec)).toBe(specToSvg(connSpec));
  });

  it("renders a well-formed SVG root with a sized viewBox", () => {
    const svg = specToSvg(design);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("viewBox=");
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("renders a design frame, shape (fill/stroke/radius), text node, and dashed instance", () => {
    const svg = specToSvg(design);
    // frame rect + label
    expect(svg).toContain('width="200"');
    expect(svg).toContain(">Frame A<");
    // shape rect carries geometry, fill, corner radius, and stroke
    expect(svg).toContain('width="30"');
    expect(svg).toContain('height="40"');
    expect(svg).toContain('fill="#1E88E5"');
    expect(svg).toContain('rx="4"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke-width="2"');
    // text node
    expect(svg).toContain(">Caption<");
    // instance is a dashed placeholder labelled by its asset
    expect(svg).toContain('stroke-dasharray="4 4"');
    expect(svg).toContain(">aws:lambda<");
  });

  it("XML-escapes special characters in text", () => {
    const svg = specToSvg(design);
    expect(svg).toContain("Hi &amp; &lt;ok&gt;");
    expect(svg).not.toContain("Hi & <ok>");
  });

  it("renders a figjam section and a sticky", () => {
    const svg = specToSvg(figjam);
    expect(svg).toContain(">Sec<");
    expect(svg).toContain('fill="#FFD966"');
    expect(svg).toContain(">Idea<");
  });

  it("resolves connector endpoints to node centers, draws an arrow, and skips unresolved ones", () => {
    const svg = specToSvg(connSpec);
    const lines = svg.match(/<line/g) ?? [];
    expect(lines.length).toBe(1); // the a→ghost connector is dropped
    // a center = (50,50); b center = (250,50)
    expect(svg).toContain('x1="50"');
    expect(svg).toContain('y1="50"');
    expect(svg).toContain('x2="250"');
    expect(svg).toContain('y2="50"');
    expect(svg).toContain('marker-end="url(#arrow)"');
    expect(svg).toContain("<defs>");
    expect(svg).toContain(">calls<");
  });

  it("renders an edit-only spec as a minimal empty SVG without crashing", () => {
    const svg = specToSvg(editOnly);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).not.toContain("<rect");
    expect(svg).not.toContain("<line");
  });

  // Regression: Fix 1 — children must be drawn at frame-relative-resolved (absolute) coords.
  // A child at x:20 inside a frame at x:400 must render at x=420, NOT x=20.
  it("[Fix-1] child in a non-origin frame is drawn at frame.x+child.x (absolute)", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "f2",
          x: 400,
          y: 0,
          width: 200,
          height: 100,
          children: [{ type: "shape", name: "box", x: 20, y: 20, width: 50, height: 30 }],
        },
      ],
    };
    const svg = specToSvg(spec);
    // The child rect must be at absolute x=420 (400+20) and y=20 (0+20).
    expect(svg).toContain('x="420"');
    expect(svg).toContain('y="20"');
    // It must NOT be at x=20 (raw child.x without the frame offset).
    // Guard: ensure the 'x="20"' that appears is only from the child rect position,
    // not as a standalone raw child coordinate — the child rect should be at x=420.
    const rects = [...svg.matchAll(/<rect [^/]*/g)];
    // Find the child shape rect (width=50, height=30) and assert its x is 420.
    const childRect = rects.find((m) => m[0].includes('width="50"'));
    expect(childRect).toBeDefined();
    expect(childRect![0]).toContain('x="420"');
    expect(childRect![0]).not.toContain('x="20"');
  });

  // Regression: Fix 1 — connector endpoints resolve to offset-corrected centers.
  // Two shapes in non-origin frames: centers must include the frame offset.
  it("[Fix-1] connector endpoints in non-origin frames use offset-resolved centers", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "FA",
          x: 100,
          y: 0,
          width: 200,
          height: 100,
          children: [
            // child.x=0, child.y=0, width=100, height=100
            // absolute center = (100+0+50, 0+0+50) = (150, 50)
            { type: "shape", name: "nodeA", x: 0, y: 0, width: 100, height: 100 },
          ],
        },
        {
          name: "FB",
          x: 400,
          y: 0,
          width: 200,
          height: 100,
          children: [
            // child.x=0, child.y=0, width=100, height=100
            // absolute center = (400+0+50, 0+0+50) = (450, 50)
            { type: "shape", name: "nodeB", x: 0, y: 0, width: 100, height: 100 },
          ],
        },
      ],
      connectors: [{ from: "nodeA", to: "nodeB" }],
    };
    const svg = specToSvg(spec);
    // Connector line must run from (150,50) to (450,50).
    expect(svg).toContain('x1="150"');
    expect(svg).toContain('y1="50"');
    expect(svg).toContain('x2="450"');
    expect(svg).toContain('y2="50"');
  });
});

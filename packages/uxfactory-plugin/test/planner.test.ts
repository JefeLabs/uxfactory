import { describe, it, expect } from "vitest";
import type { DesignSpec, FigjamSpec, EditOnlySpec } from "@uxfactory/spec";
import { planRender } from "../src/planner.js";

const design: DesignSpec = {
  editor: "figma",
  page: "Architecture",
  frames: [
    {
      name: "vpc",
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      children: [
        {
          type: "shape",
          name: "api",
          x: 80,
          y: 80,
          width: 160,
          height: 64,
          fill: "#1E88E5",
          characters: "API",
        },
        { type: "instance", name: "lambda", asset: "aws:lambda", x: 320, y: 80 },
      ],
    },
  ],
  connectors: [{ from: "api", to: "lambda", label: "invokes" }],
};

describe("planRender", () => {
  it("is pure and deterministic (deep-equal across calls)", () => {
    expect(planRender(design)).toEqual(planRender(design));
  });

  it("plans a design spec, preserving child order and resolving editor", () => {
    const plan = planRender(design);
    expect(plan.editor).toBe("figma");
    expect(plan.page).toBe("Architecture");
    expect(plan.frames).toHaveLength(1);
    expect(plan.frames[0]!.children.map((c) => c.name)).toEqual(["api", "lambda"]);
    expect(plan.frames[0]!.children[0]).toMatchObject({
      kind: "shape",
      fill: "#1E88E5",
      characters: "API",
    });
    expect(plan.frames[0]!.children[1]).toMatchObject({ kind: "instance", asset: "aws:lambda" });
    expect(plan.sections).toEqual([]);
    expect(plan.connectors).toEqual([{ from: "api", to: "lambda", label: "invokes" }]);
  });

  it("defaults a missing editor to figma and a missing page to Page 1", () => {
    const plan = planRender({ frames: [] } as DesignSpec);
    expect(plan.editor).toBe("figma");
    expect(plan.page).toBe("Page 1");
  });

  it("plans a figjam spec into sections", () => {
    const figjam: FigjamSpec = {
      editor: "figjam",
      sections: [
        {
          name: "retro",
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          children: [{ type: "sticky", name: "note", x: 10, y: 10, characters: "ship it" }],
        },
      ],
    };
    const plan = planRender(figjam);
    expect(plan.editor).toBe("figjam");
    expect(plan.frames).toEqual([]);
    expect(plan.sections[0]!.children[0]).toMatchObject({ kind: "sticky", characters: "ship it" });
  });

  it("plans an edit-only spec (no frames/sections, edits present)", () => {
    const editOnly: EditOnlySpec = { edits: [{ id: "1:2", set: { x: 5 } }] };
    const plan = planRender(editOnly);
    expect(plan.frames).toEqual([]);
    expect(plan.sections).toEqual([]);
    expect(plan.edits).toEqual([{ id: "1:2", set: { x: 5 } }]);
  });

  it("carries auto-layout, fill, and nested frames into the plan", () => {
    const spec: DesignSpec = {
      frames: [
        {
          name: "col", x: 0, y: 0, width: 320, height: 480, fill: "#FFFFFF",
          layout: { mode: "vertical", gap: 16, padding: 24, primaryAlign: "start" },
          sizing: { horizontal: "fill" },
          children: [
            { name: "inner", x: 0, y: 0, width: 100, height: 100, layout: { mode: "horizontal" }, children: [] },
          ],
        },
      ],
    };
    const frame = planRender(spec).frames[0]!;
    expect(frame.fill).toBe("#FFFFFF");
    expect(frame.layout).toEqual({ mode: "vertical", gap: 16, padding: 24, primaryAlign: "start" });
    expect(frame.sizing).toEqual({ horizontal: "fill" });
    expect(frame.children[0]).toMatchObject({ kind: "frame", name: "inner", layout: { mode: "horizontal" }, children: [] });
  });

  it("plans components and component-instances with overrides", () => {
    const spec: DesignSpec = {
      components: {
        button: { name: "Button", width: 120, height: 40,
          children: [{ type: "text", name: "label", x: 0, y: 0, width: 96, height: 16, characters: "OK" }] },
      },
      frames: [
        { name: "screen", x: 0, y: 0, width: 400, height: 300, children: [
          { type: "component-instance", name: "primary", component: "button", x: 20, y: 20,
            overrides: { label: { characters: "Pay", fill: "#FFFFFF" } } },
        ] },
      ],
    };
    const plan = planRender(spec);
    expect(plan.components?.button).toMatchObject({ name: "Button", width: 120, height: 40 });
    expect(plan.components!.button!.children[0]).toMatchObject({ kind: "text", name: "label" });
    const inst = plan.frames[0]!.children[0];
    expect(inst).toMatchObject({ kind: "component-instance", component: "button", overrides: { label: { characters: "Pay", fill: "#FFFFFF" } } });
  });

  it("carries typography fields (fontSize/fontWeight/fontFamily/lineHeight) on a text child", () => {
    const spec: DesignSpec = {
      frames: [{ name: "f", x: 0, y: 0, width: 300, height: 100, children: [
        { type: "text", name: "h1", x: 0, y: 0, width: 200, height: 40, characters: "Title",
          fontSize: 28, fontWeight: 700, fontFamily: "Fraunces", lineHeight: 36 },
      ] }],
    };
    const child = planRender(spec).frames[0]!.children[0]!;
    expect(child.kind).toBe("text");
    expect(child.characters).toBe("Title");
    expect(child.fontSize).toBe(28);
    expect(child.fontWeight).toBe(700);
    expect(child.fontFamily).toBe("Fraunces");
    expect(child.lineHeight).toBe(36);
  });

  it("carries effects and object corner radius", () => {
    const spec: DesignSpec = {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10, children: [
        { type: "shape", name: "card", x: 0, y: 0, width: 10, height: 10,
          cornerRadius: { tl: 8, tr: 8, br: 0, bl: 0 },
          effects: [{ type: "drop-shadow", color: "#000000", x: 0, y: 4, blur: 12 }] },
      ] }],
    };
    const card = planRender(spec).frames[0]!.children[0]!;
    expect(card.cornerRadius).toEqual({ tl: 8, tr: 8, br: 0, bl: 0 });
    expect(card.effects).toEqual([{ type: "drop-shadow", color: "#000000", x: 0, y: 4, blur: 12 }]);
  });
});

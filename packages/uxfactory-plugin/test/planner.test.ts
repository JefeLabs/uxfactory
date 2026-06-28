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
});

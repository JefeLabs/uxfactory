import { describe, it, expect } from "vitest";
import {
  hasFrames,
  hasSections,
  expectedEditor,
  expectedCounts,
  collectChildren,
  findNode,
  withinTolerance,
  normalizeColor,
  numbersEqual,
} from "../src/internal.js";
import type { RenderReport } from "../src/report.js";
import type { Spec } from "@uxfactory/spec";

const designSpec = {
  editor: "figma" as const,
  frames: [
    {
      name: "f",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [
        { type: "shape" as const, name: "box", x: 10, y: 20, width: 30, height: 40 },
        { type: "instance" as const, name: "lambda", asset: "aws:lambda", x: 50, y: 60 },
      ],
    },
  ],
  connectors: [{ from: "box", to: "lambda" }],
};

const figjamSpec = {
  editor: "figjam" as const,
  sections: [
    {
      name: "s",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      children: [{ type: "sticky" as const, name: "note", x: 1, y: 2, characters: "hi" }],
    },
  ],
};

const editOnlySpec = {
  edits: [
    { id: "1:2", set: { x: 5 } },
    { name: "redis", set: { characters: "Redis" } },
  ],
};

const report: RenderReport = {
  renderId: "r",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "f",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 2, connectors: 1 },
  nodes: [
    { id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40 },
    { id: "3:4", name: "lambda", type: "instance", x: 50, y: 60, w: 48, h: 48 },
  ],
};

describe("spec-shape guards", () => {
  it("detects frames and sections", () => {
    expect(hasFrames(designSpec)).toBe(true);
    expect(hasSections(designSpec)).toBe(false);
    expect(hasSections(figjamSpec)).toBe(true);
    expect(hasFrames(editOnlySpec)).toBe(false);
  });
});

describe("expectedEditor", () => {
  it("is figma for design specs", () => expect(expectedEditor(designSpec)).toBe("figma"));
  it("is figjam for figjam specs", () => expect(expectedEditor(figjamSpec)).toBe("figjam"));
  it("is undefined for an editor-less edit-only spec", () =>
    expect(expectedEditor(editOnlySpec)).toBeUndefined());
  it("reads the explicit editor on an edit-only spec", () =>
    expect(expectedEditor({ editor: "figjam", edits: [{ id: "1", set: { x: 1 } }] })).toBe(
      "figjam",
    ));
});

describe("expectedCounts", () => {
  it("counts frames, objects, connectors for a design spec", () => {
    expect(expectedCounts(designSpec)).toEqual({
      frames: 1,
      sections: 0,
      objects: 2,
      connectors: 1,
    });
  });
  it("counts sections and objects for a figjam spec", () => {
    expect(expectedCounts(figjamSpec)).toEqual({
      frames: 0,
      sections: 1,
      objects: 1,
      connectors: 0,
    });
  });
});

describe("collectChildren", () => {
  it("flattens frame children with geometry", () => {
    const kids = collectChildren(designSpec);
    expect(kids.map((c) => c.name)).toEqual(["box", "lambda"]);
    expect(kids[0]).toEqual({ name: "box", x: 10, y: 20, width: 30, height: 40 });
    expect(kids[1]).toEqual({ name: "lambda", x: 50, y: 60, width: undefined, height: undefined });
  });
  it("returns [] for an edit-only spec", () => {
    expect(collectChildren(editOnlySpec)).toEqual([]);
  });
});

describe("findNode", () => {
  it("finds by id first", () => expect(findNode(report, { id: "3:4" })?.name).toBe("lambda"));
  it("falls back to first-match name", () =>
    expect(findNode(report, { name: "box" })?.id).toBe("1:2"));
  it("returns undefined when absent", () =>
    expect(findNode(report, { name: "ghost" })).toBeUndefined());
  it("prefers id over name when both given", () =>
    expect(findNode(report, { id: "1:2", name: "lambda" })?.name).toBe("box"));
});

describe("withinTolerance", () => {
  it("accepts a difference at the boundary", () =>
    expect(withinTolerance(120, 120.5, 0.5)).toBe(true));
  it("rejects a difference just past the boundary", () =>
    expect(withinTolerance(120, 120.6, 0.5)).toBe(false));
  it("accepts an exact match", () => expect(withinTolerance(10, 10, 0.5)).toBe(true));
});

describe("normalizeColor", () => {
  it("lowercases hex", () => expect(normalizeColor("#43A047")).toBe("#43a047"));
  it("expands 3-digit hex to 6-digit", () => {
    expect(normalizeColor("#FFF")).toBe("#ffffff");
    expect(normalizeColor("#abc")).toBe(normalizeColor("#aabbcc"));
  });
});

describe("numbersEqual", () => {
  it("treats tiny float drift as equal", () => expect(numbersEqual(0.1 + 0.2, 0.3)).toBe(true));
  it("treats real differences as unequal", () => expect(numbersEqual(0.5, 0.6)).toBe(false));
});

describe("recursive walk (task 7)", () => {
  it("counts and gates nested frames and component instances recursively", () => {
    const spec = {
      components: { "comp-1": { name: "card", width: 200, height: 80,
        children: [{ type: "text", name: "label", x: 16, y: 16, width: 100, height: 20, characters: "Hi" }] } },
      frames: [{ name: "view", x: 0, y: 0, width: 390, height: 844, children: [
        { name: "col", x: 10, y: 10, width: 300, height: 400, children: [
          { type: "shape", name: "s1", x: 5, y: 5, width: 50, height: 50 },
        ] },
        { type: "component-instance", name: "card-a", component: "comp-1", x: 20, y: 430 },
      ] }],
    } as unknown as Spec;
    const expected = expectedCounts(spec);
    // objects: col(1) + s1(1) + card-a(1) = 3; the def's internals contribute nothing
    expect(expected).toEqual({ frames: 1, sections: 0, objects: 3, connectors: 0 });
    const children = collectChildren(spec);
    expect(children.map((c) => c.name).sort()).toEqual(["card-a", "col", "s1"]);
    const s1 = children.find((c) => c.name === "s1")!;
    expect(s1.x).toBe(5);                                        // parent-relative, NOT accumulated
  });
});

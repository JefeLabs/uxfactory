import { describe, it, expect } from "vitest";
import {
  checkEditorType,
  checkCounts,
  checkPresence,
  checkGeometry,
  checkEdits,
} from "../src/checks.js";
import type { RenderReport } from "../src/report.js";

const baseReport = (over: Partial<RenderReport> = {}): RenderReport => ({
  renderId: "r",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "f",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40, fill: "#1e88e5" }],
  ...over,
});

const oneBoxDesign = {
  editor: "figma" as const,
  frames: [
    {
      name: "f",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [
        {
          type: "shape" as const,
          name: "box",
          x: 10,
          y: 20,
          width: 30,
          height: 40,
          fill: "#1E88E5",
        },
      ],
    },
  ],
};

describe("checkEditorType", () => {
  it("passes when editors match", () => {
    expect(checkEditorType(oneBoxDesign, baseReport()).check.status).toBe("PASS");
  });
  it("fails when editors differ", () => {
    const out = checkEditorType(oneBoxDesign, baseReport({ editor: "figjam" }));
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "editorType",
      property: "editor",
      expected: "figma",
      actual: "figjam",
    });
  });
  it("skips for an editor-less edit-only spec", () => {
    expect(
      checkEditorType({ edits: [{ id: "1", set: { x: 1 } }] }, baseReport()).check.status,
    ).toBe("SKIP");
  });
});

describe("checkCounts", () => {
  it("passes when all counts match", () => {
    expect(checkCounts(oneBoxDesign, baseReport()).check.status).toBe("PASS");
  });
  it("fails and lists the mismatched count", () => {
    const out = checkCounts(
      oneBoxDesign,
      baseReport({ counts: { frames: 2, sections: 0, objects: 1, connectors: 0 } }),
    );
    expect(out.check.status).toBe("FAIL");
    expect(out.failures).toContainEqual({
      check: "counts",
      property: "frames",
      expected: 1,
      actual: 2,
    });
  });
  it("skips for an edit-only spec", () => {
    expect(checkCounts({ edits: [{ id: "1", set: { x: 1 } }] }, baseReport()).check.status).toBe(
      "SKIP",
    );
  });
});

describe("checkPresence", () => {
  it("passes when every child is present", () => {
    expect(checkPresence(oneBoxDesign, baseReport()).check.status).toBe("PASS");
  });
  it("fails for a missing child", () => {
    const out = checkPresence(oneBoxDesign, baseReport({ nodes: [] }));
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "presence",
      name: "box",
      expected: "present",
      actual: "missing",
    });
  });
  it("checks edit targets for an edit-only spec", () => {
    const out = checkPresence({ edits: [{ id: "9:9", set: { x: 1 } }] }, baseReport());
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ check: "presence", nodeId: "9:9", actual: "missing" });
  });
});

describe("checkGeometry", () => {
  it("passes within tolerance", () => {
    const report = baseReport({
      nodes: [{ id: "1:2", name: "box", type: "shape", x: 10.4, y: 20, w: 30, h: 40 }],
    });
    expect(checkGeometry(oneBoxDesign, report, 0.5).check.status).toBe("PASS");
  });
  it("fails just past tolerance and names the property", () => {
    const report = baseReport({
      nodes: [{ id: "1:2", name: "box", type: "shape", x: 10.6, y: 20, w: 30, h: 40 }],
    });
    const out = checkGeometry(oneBoxDesign, report, 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "geometry",
      name: "box",
      property: "x",
      expected: 10,
      actual: 10.6,
      tolerancePx: 0.5,
    });
  });
  it("fails for a width mismatch and names the property", () => {
    const report = baseReport({
      nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 999, h: 40 }],
    });
    const out = checkGeometry(oneBoxDesign, report, 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "geometry",
      name: "box",
      property: "width",
      expected: 30,
      actual: 999,
      tolerancePx: 0.5,
    });
  });
  it("passes (does not fail) for nodes missing from the report — presence handles those", () => {
    expect(checkGeometry(oneBoxDesign, baseReport({ nodes: [] }), 0.5).check.status).toBe("PASS");
  });
  it("skips for an edit-only spec", () => {
    expect(
      checkGeometry({ edits: [{ id: "1", set: { x: 1 } }] }, baseReport(), 0.5).check.status,
    ).toBe("SKIP");
  });

  // ── Auto-layout awareness — Figma re-flows these; the spec's pixels are stale ──

  it("skips x/y for children of auto-layout containers (Figma positions them)", () => {
    const spec = {
      editor: "figma",
      frames: [{
        name: "col", x: 0, y: 0, width: 200, height: 400,
        layout: { mode: "vertical", gap: 16 },
        children: [
          { type: "shape", name: "card", x: 10, y: 20, width: 30, height: 40, fill: "#1E88E5" },
        ],
      }],
    };
    // Rendered position drifted far beyond tolerance — but the parent is
    // auto-layout, so the drift is Figma's re-flow, not a defect.
    const report = baseReport({
      nodes: [{ id: "1:2", name: "card", type: "shape", x: 84, y: 300, w: 30, h: 40 }],
    });
    expect(checkGeometry(spec, report, 0.5).check.status).toBe("PASS");
  });

  it("skips width/height on axes the child declares as fill/hug", () => {
    const spec = {
      editor: "figma",
      frames: [{
        name: "col", x: 0, y: 0, width: 200, height: 400,
        layout: { mode: "vertical" },
        children: [
          { name: "row", x: 0, y: 0, width: 100, height: 40,
            layout: { mode: "horizontal" }, sizing: { horizontal: "fill", vertical: "hug" }, children: [] },
        ],
      }],
    };
    // FILL stretched the width, HUG recomputed the height — both are expected.
    const report = baseReport({
      nodes: [{ id: "1:3", name: "row", type: "FRAME", x: 0, y: 0, w: 200, h: 220 }],
    });
    expect(checkGeometry(spec, report, 0.5).check.status).toBe("PASS");
  });

  it("still fails geometry inside plain (non-auto-layout) containers", () => {
    const spec = {
      editor: "figma",
      frames: [{
        name: "plain", x: 0, y: 0, width: 200, height: 400,
        children: [
          { type: "shape", name: "box", x: 10, y: 20, width: 30, height: 40, fill: "#1E88E5" },
        ],
      }],
    };
    const report = baseReport({
      nodes: [{ id: "1:2", name: "box", type: "shape", x: 99, y: 20, w: 30, h: 40 }],
    });
    const out = checkGeometry(spec, report, 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ property: "x", expected: 10, actual: 99 });
  });
});

describe("checkEdits", () => {
  const editSpec = {
    edits: [{ id: "1:2", set: { x: 120, fill: "#43A047", characters: "Redis" } }],
  };
  it("passes when set properties are reflected", () => {
    const report = baseReport({
      nodes: [
        {
          id: "1:2",
          name: "box",
          type: "shape",
          x: 120,
          y: 20,
          w: 30,
          h: 40,
          fill: "#43a047",
          characters: "Redis",
        },
      ],
    });
    expect(checkEdits(editSpec, report, 0.5).check.status).toBe("PASS");
  });
  it("fails when a property is not reflected", () => {
    const report = baseReport({
      nodes: [
        {
          id: "1:2",
          name: "box",
          type: "shape",
          x: 999,
          y: 20,
          w: 30,
          h: 40,
          fill: "#43a047",
          characters: "Redis",
        },
      ],
    });
    const out = checkEdits(editSpec, report, 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "edits",
      nodeId: "1:2",
      property: "x",
      expected: 120,
      actual: 999,
    });
  });
  it("fails when the edit target is missing", () => {
    const out = checkEdits({ edits: [{ id: "9:9", set: { x: 1 } }] }, baseReport(), 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ check: "edits", nodeId: "9:9", actual: "missing" });
  });
  it("compares colors case-insensitively", () => {
    const report = baseReport({
      nodes: [
        {
          id: "1:2",
          name: "box",
          type: "shape",
          x: 120,
          y: 20,
          w: 30,
          h: 40,
          fill: "#43A047",
          characters: "Redis",
        },
      ],
    });
    expect(checkEdits(editSpec, report, 0.5).check.status).toBe("PASS");
  });
  it("fails when an edited width is not reflected", () => {
    const spec = { edits: [{ id: "1:2", set: { width: 30 } }] };
    const report = baseReport({
      nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 999, h: 40 }],
    });
    const out = checkEdits(spec, report, 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "edits",
      nodeId: "1:2",
      property: "width",
      expected: 30,
      actual: 999,
      tolerancePx: 0.5,
    });
  });
  it("skips a spec with no edits", () => {
    expect(checkEdits(oneBoxDesign, baseReport(), 0.5).check.status).toBe("SKIP");
  });
  it("fails when an edited opacity is not reflected (numeric routing)", () => {
    const spec = { edits: [{ id: "1:2", set: { opacity: 0.5 } }] };
    const report = baseReport({
      nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40, opacity: 1 }],
    });
    const out = checkEdits(spec, report, 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "edits",
      nodeId: "1:2",
      property: "opacity",
      expected: 0.5,
      actual: 1,
    });
  });
  it("passes when an edited visible flag is reflected (boolean routing)", () => {
    const spec = { edits: [{ id: "1:2", set: { visible: false } }] };
    const report = baseReport({
      nodes: [
        { id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40, visible: false },
      ],
    });
    expect(checkEdits(spec, report, 0.5).check.status).toBe("PASS");
  });
  it("fails when an edited visible flag is not reflected (boolean routing)", () => {
    const spec = { edits: [{ id: "1:2", set: { visible: false } }] };
    const report = baseReport({
      nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40, visible: true }],
    });
    expect(checkEdits(spec, report, 0.5).check.status).toBe("FAIL");
  });
});

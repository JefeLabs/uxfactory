import { describe, it, expect } from "vitest";
import { checkEditorType, checkCounts, checkPresence, checkGeometry, checkEdits } from "../src/checks.js";
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
  frames: [{ name: "f", x: 0, y: 0, width: 100, height: 100, children: [{ type: "shape" as const, name: "box", x: 10, y: 20, width: 30, height: 40, fill: "#1E88E5" }] }],
};

describe("checkEditorType", () => {
  it("passes when editors match", () => {
    expect(checkEditorType(oneBoxDesign, baseReport()).check.status).toBe("PASS");
  });
  it("fails when editors differ", () => {
    const out = checkEditorType(oneBoxDesign, baseReport({ editor: "figjam" }));
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ check: "editorType", property: "editor", expected: "figma", actual: "figjam" });
  });
  it("skips for an editor-less edit-only spec", () => {
    expect(checkEditorType({ edits: [{ id: "1", set: { x: 1 } }] }, baseReport()).check.status).toBe("SKIP");
  });
});

describe("checkCounts", () => {
  it("passes when all counts match", () => {
    expect(checkCounts(oneBoxDesign, baseReport()).check.status).toBe("PASS");
  });
  it("fails and lists the mismatched count", () => {
    const out = checkCounts(oneBoxDesign, baseReport({ counts: { frames: 2, sections: 0, objects: 1, connectors: 0 } }));
    expect(out.check.status).toBe("FAIL");
    expect(out.failures).toContainEqual({ check: "counts", property: "frames", expected: 1, actual: 2 });
  });
  it("skips for an edit-only spec", () => {
    expect(checkCounts({ edits: [{ id: "1", set: { x: 1 } }] }, baseReport()).check.status).toBe("SKIP");
  });
});

describe("checkPresence", () => {
  it("passes when every child is present", () => {
    expect(checkPresence(oneBoxDesign, baseReport()).check.status).toBe("PASS");
  });
  it("fails for a missing child", () => {
    const out = checkPresence(oneBoxDesign, baseReport({ nodes: [] }));
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ check: "presence", name: "box", expected: "present", actual: "missing" });
  });
  it("checks edit targets for an edit-only spec", () => {
    const out = checkPresence({ edits: [{ id: "9:9", set: { x: 1 } }] }, baseReport());
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ check: "presence", nodeId: "9:9", actual: "missing" });
  });
});

describe("checkGeometry", () => {
  it("passes within tolerance", () => {
    const report = baseReport({ nodes: [{ id: "1:2", name: "box", type: "shape", x: 10.4, y: 20, w: 30, h: 40 }] });
    expect(checkGeometry(oneBoxDesign, report, 0.5).check.status).toBe("PASS");
  });
  it("fails just past tolerance and names the property", () => {
    const report = baseReport({ nodes: [{ id: "1:2", name: "box", type: "shape", x: 10.6, y: 20, w: 30, h: 40 }] });
    const out = checkGeometry(oneBoxDesign, report, 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ check: "geometry", name: "box", property: "x", expected: 10, actual: 10.6, tolerancePx: 0.5 });
  });
  it("skips missing nodes (presence handles those)", () => {
    expect(checkGeometry(oneBoxDesign, baseReport({ nodes: [] }), 0.5).check.status).toBe("PASS");
  });
  it("skips for an edit-only spec", () => {
    expect(checkGeometry({ edits: [{ id: "1", set: { x: 1 } }] }, baseReport(), 0.5).check.status).toBe("SKIP");
  });
});

describe("checkEdits", () => {
  const editSpec = { edits: [{ id: "1:2", set: { x: 120, fill: "#43A047", characters: "Redis" } }] };
  it("passes when set properties are reflected", () => {
    const report = baseReport({ nodes: [{ id: "1:2", name: "box", type: "shape", x: 120, y: 20, w: 30, h: 40, fill: "#43a047", characters: "Redis" }] });
    expect(checkEdits(editSpec, report, 0.5).check.status).toBe("PASS");
  });
  it("fails when a property is not reflected", () => {
    const report = baseReport({ nodes: [{ id: "1:2", name: "box", type: "shape", x: 999, y: 20, w: 30, h: 40, fill: "#43a047", characters: "Redis" }] });
    const out = checkEdits(editSpec, report, 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ check: "edits", nodeId: "1:2", property: "x", expected: 120, actual: 999 });
  });
  it("fails when the edit target is missing", () => {
    const out = checkEdits({ edits: [{ id: "9:9", set: { x: 1 } }] }, baseReport(), 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ check: "edits", nodeId: "9:9", actual: "missing" });
  });
  it("compares colors case-insensitively", () => {
    const report = baseReport({ nodes: [{ id: "1:2", name: "box", type: "shape", x: 120, y: 20, w: 30, h: 40, fill: "#43A047", characters: "Redis" }] });
    expect(checkEdits(editSpec, report, 0.5).check.status).toBe("PASS");
  });
  it("skips a spec with no edits", () => {
    expect(checkEdits(oneBoxDesign, baseReport(), 0.5).check.status).toBe("SKIP");
  });
});

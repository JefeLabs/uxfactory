import { describe, it, expect } from "vitest";
import { gate } from "../src/gate.js";
import type { RenderReport } from "../src/report.js";

const report: RenderReport = {
  renderId: "r_1",
  editor: "figma",
  page: "Architecture",
  pageKey: "0:1",
  fileName: "Infra",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 1 },
  nodes: [
    { id: "1:2", name: "api-gateway", type: "shape", x: 80, y: 80, w: 160, h: 64, fill: "#1e88e5" },
  ],
};

const matchingSpec = {
  editor: "figma" as const,
  frames: [
    {
      name: "vpc",
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      children: [
        {
          type: "shape" as const,
          name: "api-gateway",
          x: 80,
          y: 80,
          width: 160,
          height: 64,
          fill: "#1E88E5",
        },
      ],
    },
  ],
  connectors: [{ from: "api-gateway", to: "api-gateway" }],
};

describe("gate", () => {
  it("returns PASS with all five checks for a matching design spec", () => {
    const result = gate(matchingSpec, report);
    expect(result.status).toBe("PASS");
    expect(result.summary).toEqual({ checks: 5, passed: 4, failed: 0, skipped: 1 }); // edits skipped (no edits)
    expect(result.checks.map((c) => c.id)).toEqual([
      "editorType",
      "counts",
      "presence",
      "geometry",
      "edits",
    ]);
    expect(result.failures).toEqual([]);
    expect(result.renderId).toBe("r_1");
    expect(result.editor).toBe("figma");
    expect(result.pageKey).toBe("0:1");
    expect(result.fileName).toBe("Infra");
  });

  it("returns FAIL with the offending failures when geometry is off", () => {
    const moved: RenderReport = { ...report, nodes: [{ ...report.nodes[0]!, x: 180 }] };
    const result = gate(matchingSpec, moved);
    expect(result.status).toBe("FAIL");
    expect(result.failures).toContainEqual({
      check: "geometry",
      nodeId: "1:2",
      name: "api-gateway",
      property: "x",
      expected: 80,
      actual: 180,
      tolerancePx: 0.5,
    });
  });

  it("honors a checks subset", () => {
    const result = gate(matchingSpec, report, { checks: ["editorType"] });
    expect(result.summary.checks).toBe(1);
    expect(result.checks.map((c) => c.id)).toEqual(["editorType"]);
  });

  it("honors a custom tolerance", () => {
    const moved: RenderReport = { ...report, nodes: [{ ...report.nodes[0]!, x: 82 }] };
    expect(gate(matchingSpec, moved, { tolerancePx: 0.5 }).status).toBe("FAIL");
    expect(gate(matchingSpec, moved, { tolerancePx: 3 }).status).toBe("PASS");
  });

  it("echoes a caller-supplied verifyId and never invents one", () => {
    expect(gate(matchingSpec, report, { verifyId: "v_42" }).verifyId).toBe("v_42");
    expect(gate(matchingSpec, report).verifyId).toBeUndefined();
  });

  it("is deterministic: identical inputs yield deeply-equal results", () => {
    const a = gate(matchingSpec, report, { verifyId: "v_1" });
    const b = gate(matchingSpec, report, { verifyId: "v_1" });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("treats an empty checks array as all checks (no vacuous PASS)", () => {
    const result = gate(matchingSpec, report, { checks: [] });
    expect(result.summary.checks).toBe(5);
  });

  it("skips editorType/counts/geometry for an editor-less edit-only spec", () => {
    const editOnly = { edits: [{ id: "1:2", set: { x: 80 } }] };
    const result = gate(editOnly, report); // report node 1:2 ("api-gateway") is at x:80, so the edit is reflected
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({
      editorType: "SKIP",
      counts: "SKIP",
      presence: "PASS",
      geometry: "SKIP",
      edits: "PASS",
    });
    expect(result.summary.skipped).toBe(3);
    expect(result.status).toBe("PASS");
  });
});

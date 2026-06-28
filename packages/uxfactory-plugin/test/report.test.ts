import { describe, it, expect } from "vitest";
import { assembleReport, newRenderId } from "../src/report.js";
import { gate } from "@uxfactory/gate";
import type { DesignSpec } from "@uxfactory/spec";

describe("newRenderId", () => {
  it("is filename-safe", () => {
    expect(newRenderId(7)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("assembleReport", () => {
  it("populates every §7.4 field, normalizes colors, echoes jobId", () => {
    const report = assembleReport({
      editor: "figma",
      page: "Architecture",
      pageKey: "0:1",
      fileName: "Infra",
      fileKey: "k",
      renderId: "r_1",
      jobId: "job_42",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 1 },
      nodes: [
        {
          id: "1:2",
          name: "api",
          type: "shape",
          x: 80,
          y: 80,
          w: 160,
          h: 64,
          fill: "#1E88E5",
          stroke: "#ABC",
        },
      ],
    });
    expect(report).toMatchObject({
      editor: "figma",
      page: "Architecture",
      pageKey: "0:1",
      fileName: "Infra",
      fileKey: "k",
      renderId: "r_1",
      jobId: "job_42",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 1 },
    });
    expect(report.nodes[0]!.fill).toBe("#1e88e5"); // lowercased
    expect(report.nodes[0]!.stroke).toBe("#aabbcc"); // 3-digit expanded
  });

  it("produces a report the gate accepts (shape-compatible) and can PASS", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "f",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          children: [
            { type: "shape", name: "box", x: 10, y: 10, width: 20, height: 20, fill: "#1E88E5" },
          ],
        },
      ],
    };
    const report = assembleReport({
      editor: "figma",
      page: "Page 1",
      pageKey: "0:1",
      fileName: "F",
      fileKey: "k",
      renderId: "r_2",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
      nodes: [
        { id: "1:2", name: "box", type: "shape", x: 10, y: 10, w: 20, h: 20, fill: "#1E88E5" },
      ],
    });
    const result = gate(spec, report);
    expect(result.status).toBe("PASS");
    expect(result.summary.checks).toBe(5);
  });
});

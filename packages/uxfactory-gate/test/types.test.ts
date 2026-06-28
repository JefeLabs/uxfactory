import { describe, it, expect } from "vitest";
import type { RenderReport, ReportNode } from "../src/report.js";
import type { GateResult, GateOptions, CheckId } from "../src/result.js";

describe("gate types", () => {
  it("models a render report", () => {
    const node: ReportNode = { id: "1:2", name: "api-gateway", type: "shape", x: 80, y: 80, w: 160, h: 64, fill: "#1e88e5" };
    const report: RenderReport = {
      renderId: "r_1",
      editor: "figma",
      page: "Architecture",
      pageKey: "0:1",
      fileName: "Infra",
      fileKey: "abc",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
      nodes: [node],
    };
    expect(report.nodes[0]?.name).toBe("api-gateway");
  });

  it("models a gate result and options", () => {
    const opts: GateOptions = { tolerancePx: 0.5, checks: ["geometry"], verifyId: "v_1" };
    const result: GateResult = {
      status: "PASS",
      renderId: "r_1",
      editor: "figma",
      pageKey: "0:1",
      fileName: "Infra",
      summary: { checks: 1, passed: 1, failed: 0, skipped: 0 },
      checks: [{ id: "geometry", status: "PASS", tolerancePx: 0.5 }],
      failures: [],
    };
    const ids: CheckId[] = opts.checks ?? [];
    expect(result.status).toBe("PASS");
    expect(ids[0]).toBe("geometry");
  });
});

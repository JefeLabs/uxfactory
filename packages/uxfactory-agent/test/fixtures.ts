import type { Spec } from "@uxfactory/spec";
import type { RenderReport } from "@uxfactory/gate";
import type { JobInput } from "../src/types.js";

/** A spec + report pair the deterministic gate PASSes (mirrors @uxfactory/gate's own fixture). */
export const matchingSpec: Spec = {
  editor: "figma",
  frames: [
    {
      name: "vpc",
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      children: [
        { type: "shape", name: "api-gateway", x: 80, y: 80, width: 160, height: 64, fill: "#1E88E5" },
      ],
    },
  ],
  connectors: [{ from: "api-gateway", to: "api-gateway" }],
};

export const matchingReport: RenderReport = {
  renderId: "r_1",
  editor: "figma",
  page: "Architecture",
  pageKey: "0:1",
  fileName: "Infra",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 1 },
  nodes: [{ id: "1:2", name: "api-gateway", type: "shape", x: 80, y: 80, w: 160, h: 64, fill: "#1e88e5" }],
};

export function makeJob(partial: Partial<JobInput> = {}): JobInput {
  return {
    jobId: "j1",
    tenantId: "t1",
    type: "REVIEW",
    fidelity: "WIREFRAME",
    spec: matchingSpec,
    ...partial,
  };
}

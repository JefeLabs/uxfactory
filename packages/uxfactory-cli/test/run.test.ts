import { describe, it, expect } from "vitest";
import { runBatch } from "../src/batch/run.js";
import type { LoadedSpec, TokenSet, Flow } from "../src/batch/checks.js";
import type { DesignSpec } from "@uxfactory/spec";

const tokens: TokenSet = { colors: { brand: "#1E88E5" } };

const adhoc: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "home",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      children: [{ type: "shape", name: "card", x: 0, y: 0, width: 1, height: 1, fill: "#abcdef" }],
    },
  ],
};

describe("runBatch", () => {
  it("skips every gate (all inputs absent) and is clean", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({ specs, tokens: null, stories: null, reuseSpecs: null, flow: null });
    expect(report.checks.length).toBe(4);
    expect(report.checks.every((c) => c.status === "skip")).toBe(true);
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });

  it("mustPassFailed when a must gate fails (ad-hoc color with a token register)", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({ specs, tokens, stories: null, reuseSpecs: null, flow: null });
    expect(report.mustPassFailed).toBe(true);
    expect(report.clean).toBe(false);
  });

  it("an advisory (flow) failure NEVER trips the must-pass set", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "a", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "b", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
      connectors: [],
    };
    const flow: Flow = { steps: ["a", "b"] };
    const report = runBatch({
      specs: [{ file: "a.uxfactory.json", spec }],
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow,
    });
    const flowCheck = report.checks.find((c) => c.id === "flow-reachability")!;
    expect(flowCheck.status).toBe("fail");
    expect(flowCheck.severity).toBe("advisory");
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });
});

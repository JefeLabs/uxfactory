import { describe, it, expect } from "vitest";
import { computeDrift, syncMapFromReport, findSpecNode } from "../src/drift/drift-core.js";
import type { DriftInput } from "../src/drift/drift-core.js";
import type { ComponentMap } from "../src/drift/map-schema.js";
import type { Spec } from "@uxfactory/spec";
import type { RenderReport } from "@uxfactory/bridge";

const spec: Spec = {
  editor: "figma",
  frames: [
    {
      name: "deployment",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      children: [
        {
          type: "shape",
          name: "api-gateway",
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          characters: "8080",
        },
      ],
    },
  ],
} as Spec;

const map: ComponentMap = {
  version: 1,
  components: [
    {
      component: "api-gateway",
      spec: "deployment.uxfactory.json",
      node: "api-gateway",
      source: {
        kind: "terraform",
        ref: "main.tf#aws_apigatewayv2_api.main",
        compare: { name: "name", characters: "target_port" },
      },
    },
  ],
};

const baseInput = (over: Partial<DriftInput> = {}): DriftInput => ({
  map,
  specs: { "deployment.uxfactory.json": spec },
  report: null,
  sources: {
    "main.tf#aws_apigatewayv2_api.main": {
      resolved: true,
      values: { name: "api-gateway", target_port: "8080" },
    },
  },
  discoveredComponents: ["api-gateway"],
  staleness: {},
  ...over,
});

describe("computeDrift", () => {
  it("is clean when source matches spec", () => {
    const r = computeDrift(baseInput());
    expect(r.clean).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("emits a field finding when a compare attribute differs", () => {
    const r = computeDrift(
      baseInput({
        sources: {
          "main.tf#aws_apigatewayv2_api.main": {
            resolved: true,
            values: { name: "api-gateway", target_port: "9090" },
          },
        },
      }),
    );
    expect(r.clean).toBe(false);
    const field = r.findings.find((f) => f.kind === "field");
    expect(field).toMatchObject({
      component: "api-gateway",
      property: "characters",
      expected: "9090",
      actual: "8080",
    });
  });

  it("emits a deleted-orphan when the source ref does not resolve", () => {
    const r = computeDrift(
      baseInput({
        sources: { "main.tf#aws_apigatewayv2_api.main": { resolved: false, values: {} } },
      }),
    );
    expect(r.findings.map((f) => f.kind)).toContain("deleted-orphan");
  });

  it("emits an undiagrammed-orphan for a discovered component with no map entry", () => {
    const r = computeDrift(baseInput({ discoveredComponents: ["api-gateway", "worker"] }));
    const orphan = r.findings.find((f) => f.kind === "undiagrammed-orphan");
    expect(orphan).toMatchObject({ component: "worker" });
  });

  it("emits a stale finding for a compare-less entry flagged by git-staleness", () => {
    const compareLess: ComponentMap = {
      version: 1,
      components: [
        {
          component: "db",
          spec: "deployment.uxfactory.json",
          node: "db",
          source: { kind: "compose", ref: "compose.yaml#db" },
        },
      ],
    };
    const r = computeDrift({
      map: compareLess,
      specs: { "deployment.uxfactory.json": spec },
      report: null,
      sources: { "compose.yaml#db": { resolved: true, values: {} } },
      discoveredComponents: ["db"],
      staleness: { db: true },
    });
    expect(r.findings.map((f) => f.kind)).toContain("stale");
  });

  it("does not flag a field when a numeric source value matches a string spec value", () => {
    // source value is a NUMBER (as a YAML resolver would return), spec node has the string form
    const numericMap: ComponentMap = {
      version: 1,
      components: [
        {
          component: "svc",
          spec: "s.json",
          node: "svc",
          source: { kind: "k8s", ref: "k8s.yaml#svc", compare: { characters: "port" } },
        },
      ],
    };
    const numericSpecs = {
      "s.json": {
        frames: [
          {
            name: "f",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            children: [
              { type: "shape", name: "svc", x: 0, y: 0, width: 1, height: 1, characters: "8080" },
            ],
          },
        ],
      } as Spec,
    };
    const numericSources = {
      "k8s.yaml#svc": {
        resolved: true,
        values: { port: 8080 } as unknown as Record<string, string>, // NUMBER, not "8080"
      },
    };
    const result = computeDrift({
      map: numericMap,
      specs: numericSpecs,
      report: null,
      sources: numericSources,
      discoveredComponents: ["svc"],
      staleness: {},
    });
    expect(result.clean).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("flags a field when a numeric source value does NOT match the string spec value", () => {
    // source value is a NUMBER 9090, spec node has string "8080" — should still produce a finding
    const numericMap: ComponentMap = {
      version: 1,
      components: [
        {
          component: "svc",
          spec: "s.json",
          node: "svc",
          source: { kind: "k8s", ref: "k8s.yaml#svc", compare: { characters: "port" } },
        },
      ],
    };
    const numericSpecs = {
      "s.json": {
        frames: [
          {
            name: "f",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            children: [
              { type: "shape", name: "svc", x: 0, y: 0, width: 1, height: 1, characters: "8080" },
            ],
          },
        ],
      } as Spec,
    };
    const numericSources = {
      "k8s.yaml#svc": {
        resolved: true,
        values: { port: 9090 } as unknown as Record<string, string>, // NUMBER 9090 ≠ "8080"
      },
    };
    const result = computeDrift({
      map: numericMap,
      specs: numericSpecs,
      report: null,
      sources: numericSources,
      discoveredComponents: ["svc"],
      staleness: {},
    });
    expect(result.clean).toBe(false);
    const field = result.findings.find((f) => f.kind === "field");
    expect(field).toMatchObject({
      component: "svc",
      property: "characters",
      expected: "9090",
      actual: "8080",
    });
  });

  it("falls back to the render node when the spec node lacks the property", () => {
    const specNoChars: Spec = {
      editor: "figma",
      frames: [
        {
          name: "deployment",
          x: 0,
          y: 0,
          width: 400,
          height: 400,
          children: [{ type: "shape", name: "api-gateway", x: 0, y: 0, width: 100, height: 40 }],
        },
      ],
    } as Spec;
    const report: RenderReport = {
      renderId: "r_1",
      editor: "figma",
      page: "p",
      pageKey: "0:1",
      fileName: "F",
      fileKey: "k",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
      nodes: [
        {
          id: "1:2",
          name: "api-gateway",
          type: "shape",
          x: 0,
          y: 0,
          w: 100,
          h: 40,
          characters: "8080",
        },
      ],
    };
    const r = computeDrift(
      baseInput({ specs: { "deployment.uxfactory.json": specNoChars }, report }),
    );
    expect(r.clean).toBe(true); // render node's characters "8080" matches source "8080"
  });
});

describe("findSpecNode", () => {
  it("finds a named child inside a frame", () => {
    expect(findSpecNode(spec, "api-gateway")?.name).toBe("api-gateway");
  });
  it("returns null for an unknown node", () => {
    expect(findSpecNode(spec, "nope")).toBeNull();
  });
});

describe("syncMapFromReport", () => {
  const report: RenderReport = {
    renderId: "r_42",
    editor: "figma",
    page: "p",
    pageKey: "0:1",
    fileName: "F",
    fileKey: "k",
    counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
    nodes: [{ id: "12:34", name: "api-gateway", type: "shape", x: 0, y: 0, w: 100, h: 40 }],
  };

  it("fills figmaId/lastSynced by node-name match and never touches maintained fields", () => {
    const before = JSON.stringify(map.components[0]);
    const next = syncMapFromReport(map, report, "abc123");
    expect(next.components[0]?.figmaId).toBe("12:34");
    expect(next.components[0]?.lastSynced).toEqual({ render: "r_42", commit: "abc123" });
    // input untouched; maintained fields preserved by reference
    expect(JSON.stringify(map.components[0])).toBe(before);
    expect(next.components[0]?.source).toBe(map.components[0]?.source);
  });

  it("leaves entries with no matching report node unchanged (same reference)", () => {
    const two: ComponentMap = {
      version: 1,
      components: [
        map.components[0]!,
        {
          component: "db",
          spec: "deployment.uxfactory.json",
          node: "db",
          source: { kind: "compose", ref: "compose.yaml#db" },
        },
      ],
    };
    const next = syncMapFromReport(two, report, "abc123");
    expect(next.components[1]).toBe(two.components[1]);
  });
});

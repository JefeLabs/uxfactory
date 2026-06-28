import { describe, it, expect } from "vitest";
import type { DesignSpec, FigjamSpec, EditOnlySpec } from "../src/types.js";

describe("spec types", () => {
  it("models a design spec", () => {
    const spec: DesignSpec = {
      editor: "figma",
      page: "Architecture",
      frames: [
        {
          name: "prod-vpc",
          x: 0,
          y: 0,
          width: 1200,
          height: 800,
          children: [
            {
              type: "shape",
              name: "api-gateway",
              x: 80,
              y: 80,
              width: 160,
              height: 64,
              fill: "#1E88E5",
              characters: "API Gateway",
            },
            { type: "instance", name: "lambda-ingest", asset: "aws:lambda", x: 320, y: 80 },
          ],
        },
      ],
      connectors: [{ from: "api-gateway", to: "lambda-ingest" }],
    };
    expect(spec.frames[0]?.children?.length).toBe(2);
  });

  it("models a figjam spec", () => {
    const spec: FigjamSpec = {
      editor: "figjam",
      sections: [
        {
          name: "retro",
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          children: [{ type: "sticky", name: "went-well", x: 10, y: 10, characters: "shipping" }],
        },
      ],
    };
    expect(spec.sections.length).toBe(1);
  });

  it("models an edit-only spec", () => {
    const spec: EditOnlySpec = {
      edits: [
        { id: "12:34", set: { x: 120, fill: "#43A047" } },
        { name: "redis-cache", set: { characters: "Redis 7.2" } },
      ],
    };
    expect(spec.edits.length).toBe(2);
  });
});

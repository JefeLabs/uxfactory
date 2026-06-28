import { describe, it, expect } from "vitest";
import { Ajv, type ErrorObject } from "ajv";
import schema from "../schema/uxfactory.schema.json" with { type: "json" };

const ajv = new Ajv({ allErrors: true, strict: false });
const check = ajv.compile(schema);

const designSpec = {
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

const figjamSpec = {
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

const editOnlySpec = {
  edits: [
    { id: "12:34", set: { x: 120, fill: "#43A047" } },
    { name: "redis-cache", set: { characters: "Redis 7.2" } },
  ],
};

describe("uxfactory.schema.json", () => {
  it("accepts a design spec", () => {
    expect(check(designSpec)).toBe(true);
  });

  it("accepts a figjam spec", () => {
    expect(check(figjamSpec)).toBe(true);
  });

  it("accepts an edit-only spec", () => {
    expect(check(editOnlySpec)).toBe(true);
  });

  it("rejects an unknown edit property", () => {
    const bad = { edits: [{ id: "1", set: { color: "#fff" } }] };
    expect(check(bad)).toBe(false);
    const msg = (check.errors ?? []).some((e: ErrorObject) => e.keyword === "additionalProperties");
    expect(msg).toBe(true);
  });

  it("rejects an edit with neither id nor name", () => {
    expect(check({ edits: [{ set: { x: 1 } }] })).toBe(false);
  });

  it("rejects a shape missing a required dimension", () => {
    const bad = {
      frames: [
        {
          name: "f",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10 }],
        },
      ],
    };
    expect(check(bad)).toBe(false);
  });

  it("rejects a contradictory figjam-with-frames spec", () => {
    expect(
      check({ editor: "figjam", frames: [{ name: "f", x: 0, y: 0, width: 1, height: 1 }] }),
    ).toBe(false);
  });

  it("rejects an unknown top-level property", () => {
    expect(check({ frames: [], somethingElse: 1 })).toBe(false);
  });

  it("rejects opacity above 1", () => {
    expect(check({ edits: [{ id: "1", set: { opacity: 1.5 } }] })).toBe(false);
  });

  it("rejects an empty object", () => {
    expect(check({})).toBe(false);
  });
});

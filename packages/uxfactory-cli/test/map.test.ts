import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mapScaffoldCmd, mapCheckCmd } from "../src/commands/map.js";
import { readMap } from "../src/drift/map-io.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

let cwd: string;

const spec = {
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
};

const tf = `
resource "aws_apigatewayv2_api" "main" {
  name        = "api-gateway"
  target_port = "8080"
}
`;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "uxf-mapcmd-"));
  await writeFile(path.join(cwd, "deployment.uxfactory.json"), JSON.stringify(spec), "utf8");
  await writeFile(path.join(cwd, "main.tf"), tf, "utf8");
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const validMap = {
  version: 1,
  components: [
    {
      component: "api-gateway",
      spec: "deployment.uxfactory.json",
      node: "api-gateway",
      source: {
        kind: "terraform",
        ref: "main.tf#aws_apigatewayv2_api.main",
        compare: { name: "name" },
      },
    },
  ],
};

describe("map scaffold", () => {
  it("proposes component↔node links by name match and writes the map", async () => {
    const io = makeIO();
    expect(await mapScaffoldCmd({ cwd }, io)).toBe(EXIT.OK);
    const written = await readMap(path.join(cwd, "uxfactory.map.json"));
    expect(written?.components).toHaveLength(1);
    expect(written?.components[0]).toMatchObject({
      component: "api-gateway",
      spec: "deployment.uxfactory.json",
      node: "api-gateway",
      source: { kind: "terraform", ref: "main.tf#aws_apigatewayv2_api.main" },
    });
    expect(io.outText()).toMatch(/api-gateway/);
  });

  it("merges without overwriting an existing maintained entry", async () => {
    const existing = {
      version: 1,
      components: [
        {
          component: "api-gateway",
          spec: "deployment.uxfactory.json",
          node: "api-gateway",
          source: {
            kind: "terraform",
            ref: "main.tf#aws_apigatewayv2_api.main",
            compare: { name: "name" },
          },
        },
      ],
    };
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(existing), "utf8");
    const io = makeIO();
    expect(await mapScaffoldCmd({ cwd }, io)).toBe(EXIT.OK);
    const written = await readMap(path.join(cwd, "uxfactory.map.json"));
    expect(written?.components).toHaveLength(1); // not duplicated
    expect(written?.components[0]?.source.compare).toEqual({ name: "name" }); // preserved
  });

  it("--json reports the proposed component ids", async () => {
    const io = makeIO();
    expect(await mapScaffoldCmd({ cwd, json: true }, io)).toBe(EXIT.OK);
    expect(JSON.parse(io.outText())).toMatchObject({ proposed: ["api-gateway"] });
  });
});

describe("map check", () => {
  it("returns 0 when every entry resolves on both sides", async () => {
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(validMap), "utf8");
    const io = makeIO();
    expect(await mapCheckCmd({ cwd }, io)).toBe(EXIT.OK);
  });

  it("returns 1 on a dangling source ref", async () => {
    const bad = {
      version: 1,
      components: [
        {
          ...validMap.components[0],
          source: {
            kind: "terraform",
            ref: "main.tf#aws_apigatewayv2_api.gone",
            compare: { name: "name" },
          },
        },
      ],
    };
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(bad), "utf8");
    const io = makeIO();
    expect(await mapCheckCmd({ cwd }, io)).toBe(EXIT.GATE_FAIL);
    expect(io.errText()).toMatch(/source/);
  });

  it("returns 1 on a dangling spec node", async () => {
    const bad = { version: 1, components: [{ ...validMap.components[0], node: "missing-node" }] };
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(bad), "utf8");
    const io = makeIO();
    expect(await mapCheckCmd({ cwd }, io)).toBe(EXIT.GATE_FAIL);
    expect(io.errText()).toMatch(/spec node/);
  });

  it("--json reports the dangling list", async () => {
    const bad = { version: 1, components: [{ ...validMap.components[0], node: "missing-node" }] };
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(bad), "utf8");
    const io = makeIO();
    expect(await mapCheckCmd({ cwd, json: true }, io)).toBe(EXIT.GATE_FAIL);
    const parsed = JSON.parse(io.outText()) as { ok: boolean; dangling: unknown[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.dangling).toHaveLength(1);
  });

  it("returns 2 when the map is absent", async () => {
    const io = makeIO();
    expect(await mapCheckCmd({ cwd }, io)).toBe(EXIT.TRANSPORT);
  });

  it("returns 2 when the map is invalid", async () => {
    await writeFile(
      path.join(cwd, "uxfactory.map.json"),
      JSON.stringify({ version: 9, components: [] }),
      "utf8",
    );
    const io = makeIO();
    expect(await mapCheckCmd({ cwd }, io)).toBe(EXIT.TRANSPORT);
  });
});

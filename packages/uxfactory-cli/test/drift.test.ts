import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { driftCmd } from "../src/commands/drift.js";
import { BridgeClient } from "../src/client.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

let cwd: string;
// A bridge that is never up — driftCmd must tolerate this (report=null) and still run.
const deadClient = new BridgeClient("http://127.0.0.1:1");

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

const cleanTf = `
resource "aws_apigatewayv2_api" "main" {
  name        = "api-gateway"
  target_port = "8080"
}
`;

const map = {
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

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "uxf-drift-"));
  await writeFile(path.join(cwd, "deployment.uxfactory.json"), JSON.stringify(spec), "utf8");
  await writeFile(path.join(cwd, "main.tf"), cleanTf, "utf8");
  await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(map), "utf8");
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("drift", () => {
  it("returns 0 when the diagram matches reality", async () => {
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.OK);
    expect(io.outText()).toMatch(/clean/);
  });

  it("returns 1 on a field change", async () => {
    await writeFile(
      path.join(cwd, "main.tf"),
      cleanTf.replace('target_port = "8080"', 'target_port = "9090"'),
      "utf8",
    );
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.GATE_FAIL);
    expect(io.outText()).toMatch(/field/);
  });

  it("returns 1 on a deleted-but-diagrammed orphan", async () => {
    await writeFile(path.join(cwd, "main.tf"), "# resource removed\n", "utf8");
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.GATE_FAIL);
    expect(io.outText()).toMatch(/deleted-orphan/);
  });

  it("returns 1 on an implemented-but-undiagrammed orphan", async () => {
    await writeFile(
      path.join(cwd, "main.tf"),
      `${cleanTf}\nresource "aws_lambda_function" "worker" {\n  name = "worker"\n}\n`,
      "utf8",
    );
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.GATE_FAIL);
    expect(io.outText()).toMatch(/undiagrammed-orphan/);
  });

  it("flags git-staleness for a compare-less entry via the injected lookup", async () => {
    const compareLess = {
      version: 1,
      components: [
        {
          component: "api-gateway",
          spec: "deployment.uxfactory.json",
          node: "api-gateway",
          source: { kind: "terraform", ref: "main.tf#aws_apigatewayv2_api.main" },
          lastSynced: { render: "r_old", commit: "old111" },
        },
      ],
    };
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(compareLess), "utf8");
    const io = makeIO();
    const code = await driftCmd({ cwd, gitLastCommit: () => "new999" }, io, deadClient);
    expect(code).toBe(EXIT.GATE_FAIL);
    expect(io.outText()).toMatch(/stale/);
  });

  it("--json emits the structured report", async () => {
    await writeFile(
      path.join(cwd, "main.tf"),
      cleanTf.replace('target_port = "8080"', 'target_port = "9090"'),
      "utf8",
    );
    const io = makeIO();
    expect(await driftCmd({ cwd, json: true }, io, deadClient)).toBe(EXIT.GATE_FAIL);
    const parsed = JSON.parse(io.outText()) as { clean: boolean; findings: unknown[] };
    expect(parsed.clean).toBe(false);
    expect(parsed.findings.length).toBeGreaterThan(0);
  });

  it("returns 2 when the map is absent", async () => {
    await rm(path.join(cwd, "uxfactory.map.json"));
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.TRANSPORT);
  });

  it("returns 2 when the map is unreadable/invalid", async () => {
    await writeFile(path.join(cwd, "uxfactory.map.json"), "{ not json", "utf8");
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.TRANSPORT);
  });
});

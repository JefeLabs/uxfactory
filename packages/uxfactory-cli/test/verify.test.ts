import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import { BridgeClient } from "../src/client.js";
import { verifyCmd } from "../src/commands/verify.js";
import { EXIT } from "../src/exit.js";
import { makeIO, matchingSpec, makeReport, postReport } from "./helpers.js";

let root: string;
let specFile: string;
let handle: { url: string; close: () => Promise<void> };
let client: BridgeClient;

const offNode = {
  id: "1:2",
  name: "box",
  type: "shape",
  x: 99,
  y: 20,
  w: 30,
  h: 40,
  fill: "#1e88e5",
};
const nudgedNode = {
  id: "1:2",
  name: "box",
  type: "shape",
  x: 13,
  y: 20,
  w: 30,
  h: 40,
  fill: "#1e88e5",
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-cli-"));
  specFile = path.join(root, "spec.json");
  await writeFile(specFile, JSON.stringify(matchingSpec), "utf8");
  handle = await startBridge({ dataDir: path.join(root, ".uxfactory"), port: 0 });
  client = new BridgeClient(handle.url);
});

afterEach(async () => {
  await handle.close();
  await rm(root, { recursive: true, force: true });
});

describe("verify", () => {
  it("returns 2 (transport) when the plugin has never connected (503)", async () => {
    const io = makeIO();
    expect(await verifyCmd(specFile, {}, io, client)).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/plugin/);
  });

  it("returns 0 and reports PASS for a matching report", async () => {
    await postReport(handle.url, makeReport());
    const io = makeIO();
    expect(await verifyCmd(specFile, {}, io, client)).toBe(EXIT.OK);
    expect(io.outText()).toContain("PASS");
  });

  it("returns 1 and reports FAIL when geometry is off", async () => {
    await postReport(handle.url, makeReport({ nodes: [offNode] }));
    const io = makeIO();
    expect(await verifyCmd(specFile, {}, io, client)).toBe(EXIT.GATE_FAIL);
    expect(io.outText()).toContain("FAIL");
  });

  it("--render targets a specific (older) report", async () => {
    const r1 = await postReport(handle.url, makeReport()); // matching
    await postReport(handle.url, makeReport({ nodes: [offNode] })); // off, now latest
    const io = makeIO();
    expect(await verifyCmd(specFile, { render: r1 }, io, client)).toBe(EXIT.OK);
  });

  it("--tolerance maps to geometryPx (strict FAIL, loose PASS)", async () => {
    await postReport(handle.url, makeReport({ nodes: [nudgedNode] }));
    const strict = makeIO();
    expect(await verifyCmd(specFile, {}, strict, client)).toBe(EXIT.GATE_FAIL);
    const loose = makeIO();
    expect(await verifyCmd(specFile, { tolerance: "5" }, loose, client)).toBe(EXIT.OK);
  });

  it("--json emits the structured PASS result", async () => {
    await postReport(handle.url, makeReport());
    const io = makeIO();
    expect(await verifyCmd(specFile, { json: true }, io, client)).toBe(EXIT.OK);
    expect((JSON.parse(io.outText()) as { status: string }).status).toBe("PASS");
  });

  it("--tolerance abc → 2 (non-numeric tolerance rejected)", async () => {
    const io = makeIO();
    expect(await verifyCmd(specFile, { tolerance: "abc" }, io, client)).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/invalid --tolerance/);
  });

  it("returns 2 when the spec file is invalid", async () => {
    const bad = path.join(root, "bad.json");
    await writeFile(bad, JSON.stringify({ frames: [{ name: "f" }] }), "utf8");
    const io = makeIO();
    expect(await verifyCmd(bad, {}, io, client)).toBe(EXIT.TRANSPORT);
  });

  it("returns 2 on a transport error (unreachable bridge)", async () => {
    const dead = new BridgeClient("http://127.0.0.1:1");
    const io = makeIO();
    expect(await verifyCmd(specFile, {}, io, dead)).toBe(EXIT.TRANSPORT);
    expect(io.errText().length).toBeGreaterThan(0);
  });
});

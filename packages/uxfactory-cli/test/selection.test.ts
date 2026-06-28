import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import { BridgeClient } from "../src/client.js";
import { selectionCmd } from "../src/commands/selection.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

let root: string;
let handle: { url: string; close: () => Promise<void> };
let client: BridgeClient;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-cli-"));
  handle = await startBridge({ dataDir: path.join(root, ".uxfactory"), port: 0 });
  client = new BridgeClient(handle.url);
});

afterEach(async () => {
  await handle.close();
  await rm(root, { recursive: true, force: true });
});

describe("selection", () => {
  it("returns 0 and prints 'no selection' when there is none", async () => {
    const io = makeIO();
    expect(await selectionCmd({}, io, client)).toBe(EXIT.OK);
    expect(io.outText()).toContain("no selection");
  });

  it("--json prints null when there is no selection", async () => {
    const io = makeIO();
    expect(await selectionCmd({ json: true }, io, client)).toBe(EXIT.OK);
    expect(io.outText().trim()).toBe("null");
  });

  it("returns 0 and lists the selected nodes", async () => {
    await fetch(`${handle.url}/selection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodes: [{ id: "12:34", name: "api-gateway", type: "shape" }] }),
    });
    const io = makeIO();
    expect(await selectionCmd({}, io, client)).toBe(EXIT.OK);
    expect(io.outText()).toContain("12:34");
    expect(io.outText()).toContain("api-gateway");
  });

  it("returns 2 on a transport error (unreachable bridge)", async () => {
    const dead = new BridgeClient("http://127.0.0.1:1");
    const io = makeIO();
    expect(await selectionCmd({}, io, dead)).toBe(EXIT.TRANSPORT);
    expect(io.errText().length).toBeGreaterThan(0);
  });
});

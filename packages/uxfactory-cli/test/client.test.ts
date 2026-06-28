import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import { BridgeClient } from "../src/client.js";
import { TransportError } from "../src/exit.js";
import { matchingSpec, makeReport, postReport } from "./helpers.js";

let handle: { url: string; close: () => Promise<void> };
let root: string;
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

describe("BridgeClient", () => {
  it("health() returns ok and the pending count", async () => {
    expect(await client.health()).toEqual({ ok: true, pending: 0 });
  });

  it("getSelection() returns null before any selection (404 → null)", async () => {
    expect(await client.getSelection()).toBeNull();
  });

  it("getRendered() returns null before any render (404 → null)", async () => {
    expect(await client.getRendered()).toBeNull();
  });

  it("verify() surfaces the 503 transport code when the plugin never connected", async () => {
    const res = await client.verify({ spec: matchingSpec });
    expect(res.status).toBe(503);
    expect((res.body as { error: string }).error).toBe("plugin has never connected");
  });

  it("verify() returns the parsed 200 body when a matching report exists", async () => {
    await postReport(handle.url, makeReport());
    const res = await client.verify({ spec: matchingSpec });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("PASS");
  });

  it("throws TransportError when the bridge is unreachable", async () => {
    const dead = new BridgeClient("http://127.0.0.1:1");
    await expect(dead.health()).rejects.toBeInstanceOf(TransportError);
  });
});

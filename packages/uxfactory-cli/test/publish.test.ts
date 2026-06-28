import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import { BridgeClient } from "../src/client.js";
import { publishCmd } from "../src/commands/publish.js";
import { EXIT } from "../src/exit.js";
import { makeIO, matchingSpec, makeReport, postReport } from "./helpers.js";

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

let root: string;
let dataDir: string;
let specFile: string;
let handle: { url: string; close: () => Promise<void> };
let client: BridgeClient;

/** queue/*.json files only (the bridge's init also creates queue/processed/). */
async function queuedSpecs(): Promise<string[]> {
  const files = await readdir(path.join(dataDir, "queue"));
  return files.filter((f) => f.endsWith(".json"));
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-cli-"));
  dataDir = path.join(root, ".uxfactory");
  specFile = path.join(root, "spec.json");
  await writeFile(specFile, JSON.stringify(matchingSpec), "utf8");
  handle = await startBridge({ dataDir, port: 0 });
  client = new BridgeClient(handle.url);
});

afterEach(async () => {
  await handle.close();
  await rm(root, { recursive: true, force: true });
});

describe("publish", () => {
  it("returns 2 for an invalid spec and writes nothing", async () => {
    const bad = path.join(root, "bad.json");
    await writeFile(bad, JSON.stringify({ frames: [{ name: "f" }] }), "utf8");
    const io = makeIO();
    expect(await publishCmd(bad, { dataDir }, io, client)).toBe(EXIT.TRANSPORT);
    expect(await queuedSpecs()).toEqual([]);
  });

  it("--dry-run prints the plan and writes nothing", async () => {
    const io = makeIO();
    expect(await publishCmd(specFile, { dryRun: true, dataDir }, io, client)).toBe(EXIT.OK);
    expect(io.outText().toLowerCase()).toContain("dry-run");
    expect(await queuedSpecs()).toEqual([]);
  });

  it("queues the spec and returns 0 on the fast path (no wait/verify)", async () => {
    const io = makeIO();
    expect(await publishCmd(specFile, { dataDir }, io, client)).toBe(EXIT.OK);
    expect(io.outText()).toMatch(/queued pub_/);
    expect(await queuedSpecs()).toHaveLength(1);
  });

  it("--wait times out and returns 2 when no render arrives", async () => {
    const io = makeIO();
    expect(
      await publishCmd(specFile, { wait: true, dataDir, timeoutMs: 150, pollMs: 30 }, io, client),
    ).toBe(EXIT.TRANSPORT);
    expect(io.errText().toLowerCase()).toContain("timed out");
  });

  it("--wait resolves to 0 when a render report is posted", async () => {
    const io = makeIO();
    const p = publishCmd(
      specFile,
      { wait: true, dataDir, timeoutMs: 3000, pollMs: 30 },
      io,
      client,
    );
    await delay(150);
    await postReport(handle.url, makeReport());
    expect(await p).toBe(EXIT.OK);
    expect(io.outText()).toMatch(/rendered/);
  });

  it("--verify chains to PASS (exit 0)", async () => {
    const io = makeIO();
    const p = publishCmd(
      specFile,
      { verify: true, dataDir, timeoutMs: 3000, pollMs: 30 },
      io,
      client,
    );
    await delay(150);
    await postReport(handle.url, makeReport());
    expect(await p).toBe(EXIT.OK);
    expect(io.outText()).toContain("PASS");
  });

  it("--verify chains to FAIL (exit 1)", async () => {
    const io = makeIO();
    const p = publishCmd(
      specFile,
      { verify: true, dataDir, timeoutMs: 3000, pollMs: 30 },
      io,
      client,
    );
    await delay(150);
    await postReport(handle.url, makeReport({ nodes: [offNode] }));
    expect(await p).toBe(EXIT.GATE_FAIL);
    expect(io.outText()).toContain("FAIL");
  });

  it("omits commit from lastSynced when gitHead returns null (Fix 4)", async () => {
    const map = {
      version: 1,
      components: [
        {
          component: "box",
          spec: "spec.json",
          node: "box",
          source: { kind: "terraform", ref: "main.tf#aws_x.box", compare: { name: "name" } },
        },
      ],
    };
    const mapPath = path.join(root, "uxfactory.map.json");
    await writeFile(mapPath, JSON.stringify(map), "utf8");

    const io = makeIO();
    const p = publishCmd(
      specFile,
      { wait: true, dataDir, cwd: root, gitHead: () => null, timeoutMs: 3000, pollMs: 30 },
      io,
      client,
    );
    await delay(150);
    await postReport(handle.url, makeReport());
    expect(await p).toBe(EXIT.OK);

    const updated = JSON.parse(await readFile(mapPath, "utf8")) as {
      components: Array<{ lastSynced?: { render: string; commit?: string } }>;
    };
    // commit must be absent — never an empty string
    expect(updated.components[0]?.lastSynced?.render).toBeDefined();
    expect(updated.components[0]?.lastSynced?.commit).toBeUndefined();
  });

  it("auto-fills figmaId/lastSynced after a successful render without touching maintained fields", async () => {
    // a node-name-matching map committed at the publish cwd (the temp root)
    const map = {
      version: 1,
      components: [
        {
          component: "box",
          spec: "spec.json",
          node: "box",
          source: { kind: "terraform", ref: "main.tf#aws_x.box", compare: { name: "name" } },
        },
      ],
    };
    const mapPath = path.join(root, "uxfactory.map.json");
    await writeFile(mapPath, JSON.stringify(map), "utf8");
    const maintainedBefore = JSON.stringify(map.components[0]);

    const io = makeIO();
    const p = publishCmd(
      specFile,
      { wait: true, dataDir, cwd: root, gitHead: () => "deadbeef", timeoutMs: 3000, pollMs: 30 },
      io,
      client,
    );
    await delay(150);
    await postReport(handle.url, makeReport()); // makeReport()'s node is named "box"
    expect(await p).toBe(EXIT.OK);

    const updated = JSON.parse(await readFile(mapPath, "utf8")) as {
      components: Array<{
        component: string;
        spec: string;
        node: string;
        source: unknown;
        figmaId?: string;
        lastSynced?: { render: string; commit: string };
      }>;
    };
    const entry = updated.components[0]!;
    expect(entry.figmaId).toBe("1:2"); // makeReport()'s node id
    expect(entry.lastSynced).toEqual({ render: expect.any(String), commit: "deadbeef" });
    // maintained fields unchanged
    expect(
      JSON.stringify({
        component: entry.component,
        spec: entry.spec,
        node: entry.node,
        source: entry.source,
      }),
    ).toBe(maintainedBefore);
    // Fix 5: count message reflects matched entries, not total (1 matched of 1 total)
    expect(io.outText()).toContain("1 component(s)");
  });
});

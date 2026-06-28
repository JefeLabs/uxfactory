import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanCmd } from "../src/commands/scan.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

let root: string;
let dataDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-cli-"));
  dataDir = path.join(root, ".uxfactory");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scan", () => {
  it("materializes catalog.json from uxfactory.assets.json with the right count", async () => {
    await writeFile(
      path.join(root, "uxfactory.assets.json"),
      JSON.stringify({ "aws:lambda": "key1", "k8s:pod": "key2" }),
      "utf8",
    );
    const io = makeIO();
    expect(await scanCmd({ dataDir, cwd: root }, io)).toBe(EXIT.OK);
    const catalog = JSON.parse(await readFile(path.join(dataDir, "catalog.json"), "utf8"));
    expect(catalog).toEqual({ "aws:lambda": "key1", "k8s:pod": "key2" });
    expect(io.outText()).toContain("2");
  });

  it("--json reports the entry count", async () => {
    await writeFile(
      path.join(root, "uxfactory.assets.json"),
      JSON.stringify({ "aws:lambda": "key1" }),
      "utf8",
    );
    const io = makeIO();
    expect(await scanCmd({ dataDir, cwd: root, json: true }, io)).toBe(EXIT.OK);
    expect(JSON.parse(io.outText())).toEqual({ entries: 1 });
  });

  it("writes an empty catalog when no manifest exists", async () => {
    const io = makeIO();
    expect(await scanCmd({ dataDir, cwd: root, json: true }, io)).toBe(EXIT.OK);
    const catalog = JSON.parse(await readFile(path.join(dataDir, "catalog.json"), "utf8"));
    expect(catalog).toEqual({});
    expect(JSON.parse(io.outText())).toEqual({ entries: 0 });
  });

  it("returns 2 when the manifest is not a string→string map", async () => {
    await writeFile(
      path.join(root, "uxfactory.assets.json"),
      JSON.stringify({ "aws:lambda": 5 }),
      "utf8",
    );
    const io = makeIO();
    expect(await scanCmd({ dataDir, cwd: root }, io)).toBe(EXIT.TRANSPORT);
  });

  it("returns 2 on a syntactically invalid manifest", async () => {
    await writeFile(path.join(root, "uxfactory.assets.json"), "{ not valid json");
    const io = makeIO();
    expect(await scanCmd({ dataDir, cwd: root }, io)).toBe(EXIT.TRANSPORT);
  });

  it("returns 2 when the manifest exists but cannot be read (not ENOENT)", async () => {
    await mkdir(path.join(root, "uxfactory.assets.json")); // a dir, not a file -> EISDIR on read
    const io = makeIO();
    expect(await scanCmd({ dataDir, cwd: root }, io)).toBe(EXIT.TRANSPORT);
  });
});

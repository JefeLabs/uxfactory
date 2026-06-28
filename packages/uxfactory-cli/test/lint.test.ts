import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lintCmd } from "../src/commands/lint.js";
import { EXIT } from "../src/exit.js";
import { makeIO, matchingSpec } from "./helpers.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uxf-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("lint", () => {
  it("returns 0 and prints OK for a valid spec", async () => {
    const file = path.join(dir, "ok.json");
    await writeFile(file, JSON.stringify(matchingSpec), "utf8");
    const io = makeIO();
    expect(await lintCmd(file, {}, io)).toBe(EXIT.OK);
    expect(io.outText()).toContain("OK");
  });

  it("--json emits { valid: true } for a valid spec", async () => {
    const file = path.join(dir, "ok.json");
    await writeFile(file, JSON.stringify(matchingSpec), "utf8");
    const io = makeIO();
    expect(await lintCmd(file, { json: true }, io)).toBe(EXIT.OK);
    expect(JSON.parse(io.outText())).toEqual({ valid: true });
  });

  it("returns 2 and prints `path: message` errors for an invalid spec", async () => {
    const file = path.join(dir, "bad.json");
    await writeFile(file, JSON.stringify({ frames: [{ name: "f" }] }), "utf8");
    const io = makeIO();
    expect(await lintCmd(file, {}, io)).toBe(EXIT.TRANSPORT);
    expect(io.errText().length).toBeGreaterThan(0);
    expect(io.errText()).toMatch(/:/);
  });

  it("--json on an invalid spec emits { valid: false, errors }", async () => {
    const file = path.join(dir, "bad.json");
    await writeFile(file, JSON.stringify({ frames: [{ name: "f" }] }), "utf8");
    const io = makeIO();
    expect(await lintCmd(file, { json: true }, io)).toBe(EXIT.TRANSPORT);
    const parsed = JSON.parse(io.outText()) as { valid: boolean; errors: unknown[] };
    expect(parsed.valid).toBe(false);
    expect(Array.isArray(parsed.errors)).toBe(true);
  });

  it("returns 2 on a parse error (malformed JSON)", async () => {
    const file = path.join(dir, "broken.json");
    await writeFile(file, "{ not json", "utf8");
    const io = makeIO();
    expect(await lintCmd(file, {}, io)).toBe(EXIT.TRANSPORT);
    expect(io.errText().length).toBeGreaterThan(0);
  });

  it("returns 2 when the file does not exist", async () => {
    const io = makeIO();
    expect(await lintCmd(path.join(dir, "nope.json"), {}, io)).toBe(EXIT.TRANSPORT);
  });
});

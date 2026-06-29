import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderCmd } from "../src/commands/render.js";
import { EXIT } from "../src/exit.js";
import { makeIO, matchingSpec } from "./helpers.js";

/** The 8-byte PNG signature. */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let dir: string;
let specPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uxf-render-"));
  specPath = path.join(dir, "spec.json");
  await writeFile(specPath, JSON.stringify(matchingSpec), "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("renderCmd", () => {
  it("writes a valid PNG and prints the path", async () => {
    const out = path.join(dir, "out.png");
    const io = makeIO();
    expect(await renderCmd(specPath, { out }, io)).toBe(EXIT.OK);
    const buf = await readFile(out);
    expect(buf.length).toBeGreaterThan(8);
    expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(io.outText()).toContain(out);
  });

  it("writes raw SVG when --out ends in .svg", async () => {
    const out = path.join(dir, "out.svg");
    const io = makeIO();
    expect(await renderCmd(specPath, { out }, io)).toBe(EXIT.OK);
    const svg = await readFile(out, "utf8");
    expect(svg).toContain("<svg");
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("defaults the output to <spec-basename>.png next to the spec", async () => {
    const io = makeIO();
    expect(await renderCmd(specPath, {}, io)).toBe(EXIT.OK);
    const buf = await readFile(path.join(dir, "spec.png"));
    expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true);
  });

  it("returns 2 on an invalid spec and writes nothing", async () => {
    await writeFile(specPath, JSON.stringify({ frames: [{ name: "f" }] }), "utf8");
    const out = path.join(dir, "out.png");
    const io = makeIO();
    expect(await renderCmd(specPath, { out }, io)).toBe(EXIT.TRANSPORT);
    await expect(readFile(out)).rejects.toThrow();
  });

  it("renders the same spec to identical PNG bytes within a process", async () => {
    const a = path.join(dir, "a.png");
    const b = path.join(dir, "b.png");
    const io = makeIO();
    expect(await renderCmd(specPath, { out: a }, io)).toBe(EXIT.OK);
    expect(await renderCmd(specPath, { out: b }, io)).toBe(EXIT.OK);
    expect((await readFile(a)).equals(await readFile(b))).toBe(true);
  });
});

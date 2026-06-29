import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateRegistry, resolveInputs, readRegistry } from "../src/batch/registry.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uxf-registry-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("validateRegistry", () => {
  it("accepts a minimal valid registry", () => {
    const res = validateRegistry({ version: 1, inputs: {} });
    expect(res.ok).toBe(true);
  });

  it("accepts the full input set with maxIterations", () => {
    const res = validateRegistry({
      version: 1,
      inputs: {
        tokens: "design/tokens.ds.json",
        stories: "design/stories.json",
        flow: "design/flow.json",
        reuse: ["specs/a.uxfactory.json"],
      },
      maxIterations: 6,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a wrong version", () => {
    const res = validateRegistry({ version: 2, inputs: {} });
    expect(res.ok).toBe(false);
  });

  it("rejects a missing inputs object", () => {
    expect(validateRegistry({ version: 1 }).ok).toBe(false);
  });

  it("rejects a non-string tokens path and a non-array reuse", () => {
    expect(validateRegistry({ version: 1, inputs: { tokens: 5 } }).ok).toBe(false);
    expect(validateRegistry({ version: 1, inputs: { reuse: "x" } }).ok).toBe(false);
  });

  it("rejects a non-positive / non-integer maxIterations", () => {
    expect(validateRegistry({ version: 1, inputs: {}, maxIterations: 0 }).ok).toBe(false);
    expect(validateRegistry({ version: 1, inputs: {}, maxIterations: 1.5 }).ok).toBe(false);
  });
});

describe("resolveInputs", () => {
  it("resolves registered paths relative to the registry dir; null/empty when absent", () => {
    const out = resolveInputs(
      { version: 1, inputs: { tokens: "design/tokens.ds.json", reuse: ["a.json", "b.json"] } },
      "/repo",
    );
    expect(out.tokens).toBe(path.resolve("/repo", "design/tokens.ds.json"));
    expect(out.stories).toBeNull();
    expect(out.flow).toBeNull();
    expect(out.reuse).toEqual([path.resolve("/repo", "a.json"), path.resolve("/repo", "b.json")]);
  });
});

describe("readRegistry", () => {
  it("reads + validates + resolves a real file", async () => {
    await mkdir(path.join(dir, "design"), { recursive: true });
    const file = path.join(dir, "uxfactory.batch.json");
    await writeFile(
      file,
      JSON.stringify({ version: 1, inputs: { tokens: "design/tokens.ds.json" } }),
      "utf8",
    );
    const res = await readRegistry(file);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.registry.version).toBe(1);
      expect(res.inputs.tokens).toBe(path.join(dir, "design", "tokens.ds.json"));
    }
  });

  it("returns ok:false for a missing file", async () => {
    const res = await readRegistry(path.join(dir, "nope.json"));
    expect(res.ok).toBe(false);
  });

  it("returns ok:false for invalid JSON", async () => {
    const file = path.join(dir, "uxfactory.batch.json");
    await writeFile(file, "{ not json", "utf8");
    const res = await readRegistry(file);
    expect(res.ok).toBe(false);
  });

  it("returns ok:false for a schema-invalid registry", async () => {
    const file = path.join(dir, "uxfactory.batch.json");
    await writeFile(file, JSON.stringify({ version: 9, inputs: {} }), "utf8");
    const res = await readRegistry(file);
    expect(res.ok).toBe(false);
  });
});

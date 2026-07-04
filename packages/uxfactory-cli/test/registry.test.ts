import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateRegistry, resolveInputs, readRegistry } from "../src/batch/registry.js";
// (scope validation tested in the new "registry scope field" describe below)

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

  it("accepts every known unit value", () => {
    for (const unit of [
      "user-flow", "home-page", "secondary-page", "tertiary-page",
      "page", "template", "organism", "molecule", "atom",
      "email", "instagram-post", "instagram-story",
      "youtube-thumbnail", "facebook-post", "x-post",
    ]) {
      expect(validateRegistry({ version: 1, inputs: {}, unit }).ok, unit).toBe(true);
    }
  });

  it("rejects an unknown or non-string unit", () => {
    const bad = validateRegistry({ version: 1, inputs: {}, unit: "widget" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("unit");
    expect(validateRegistry({ version: 1, inputs: {}, unit: 3 }).ok).toBe(false);
  });

  it("accepts a slug designStyle and rejects unsafe values", () => {
    expect(validateRegistry({ version: 1, inputs: {}, designStyle: "flat" }).ok).toBe(true);
    expect(validateRegistry({ version: 1, inputs: {}, designStyle: "dark-academia" }).ok).toBe(true);
    expect(validateRegistry({ version: 1, inputs: {}, designStyle: "Bad Style!" }).ok).toBe(false);
    expect(validateRegistry({ version: 1, inputs: {}, designStyle: 7 }).ok).toBe(false);
  });

  it("accepts a valid viewports array", () => {
    const res = validateRegistry({
      version: 1,
      inputs: {},
      viewports: [
        { name: "desktop", width: 1920, height: 1080 },
        { name: "mobile-portrait", width: 390, height: 844 },
      ],
    });
    expect(res.ok).toBe(true);
  });

  it("rejects malformed viewports", () => {
    expect(validateRegistry({ version: 1, inputs: {}, viewports: "wide" }).ok).toBe(false);
    expect(
      validateRegistry({ version: 1, inputs: {}, viewports: [{ name: "d", width: -5, height: 900 }] }).ok,
    ).toBe(false);
    expect(
      validateRegistry({ version: 1, inputs: {}, viewports: [{ width: 100, height: 100 }] }).ok,
    ).toBe(false);
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

// ---------------------------------------------------------------------------
// registry.scope field (Task 3 — appended)
// ---------------------------------------------------------------------------

describe("validateRegistry — scope field", () => {
  it("accepts a registry with scope as a valid preset name string", () => {
    const res = validateRegistry({ version: 1, inputs: {}, scope: "wireframe" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.registry.scope).toBe("wireframe");
  });

  it("accepts a registry with scope as a partial vector object", () => {
    const res = validateRegistry({ version: 1, inputs: {}, scope: { visual: "high" } });
    expect(res.ok).toBe(true);
  });

  it("accepts all preset names as scope values", () => {
    for (const preset of ["wireframe", "content", "visual", "interactive", "production"]) {
      const res = validateRegistry({ version: 1, inputs: {}, scope: preset });
      expect(res.ok).toBe(true);
    }
  });

  it("rejects an unknown preset name string as scope", () => {
    const res = validateRegistry({ version: 1, inputs: {}, scope: "bogus-preset" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/scope/);
  });

  it("rejects a scope vector with an invalid dial level (none is threshold-only)", () => {
    const res = validateRegistry({ version: 1, inputs: {}, scope: { visual: "none" } });
    expect(res.ok).toBe(false);
  });

  it("rejects a scope vector with an unknown dial key", () => {
    const res = validateRegistry({ version: 1, inputs: {}, scope: { bogus_dial: "low" } });
    expect(res.ok).toBe(false);
  });

  it("rejects a scope value that is neither string nor object (e.g. number)", () => {
    const res = validateRegistry({ version: 1, inputs: {}, scope: 42 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/scope/);
  });

  it("accepts a registry with no scope field (scope is optional)", () => {
    const res = validateRegistry({ version: 1, inputs: {} });
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registry screens/trace inputs (HTML tier — Task 5, appended)
// ---------------------------------------------------------------------------

describe("registry screens/trace inputs (HTML tier)", () => {
  it("accepts string screens + trace paths", () => {
    const r = validateRegistry({ version: 1, inputs: { screens: "design/screens", trace: "design/trace.json" } });
    expect(r.ok).toBe(true);
  });
  it("rejects non-string screens", () => {
    const r = validateRegistry({ version: 1, inputs: { screens: 5 } });
    expect(r.ok).toBe(false);
  });
  it("resolveInputs resolves screens + trace to absolute paths, null when absent", () => {
    const reg = validateRegistry({ version: 1, inputs: { screens: "design/screens", trace: "design/trace.json" } });
    if (!reg.ok) throw new Error("expected ok");
    const resolved = resolveInputs(reg.registry, "/repo");
    expect(resolved.screens).toBe("/repo/design/screens");
    expect(resolved.trace).toBe("/repo/design/trace.json");
  });

  it("resolveInputs yields null screens/trace when absent", () => {
    const reg = validateRegistry({ version: 1, inputs: {} });
    if (!reg.ok) throw new Error("expected ok");
    const resolved = resolveInputs(reg.registry, "/repo");
    expect(resolved.screens).toBeNull();
    expect(resolved.trace).toBeNull();
  });
});

/**
 * artifact-writer.test.ts — the bridge's single-writer for artifact drafts.
 *
 * Producers (generation workers) return write-intents; the bridge applies them.
 * The correctness crux: a section-merge is read→modify→write with awaits, so
 * concurrent merges into the SAME file must serialize behind a per-path async
 * lock or they interleave and lose sections. Different files run concurrently.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyArtifactWrite } from "../src/artifact-writer.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-writer-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const readJson = async (rel: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path.join(root, rel), "utf8")) as Record<string, unknown>;

describe("applyArtifactWrite", () => {
  it("writes a whole JSON file (no section, no instance)", async () => {
    await applyArtifactWrite(root, {
      path: ".uxfactory/artifacts/sitemap.json",
      body: { nodes: [{ nodeId: "N-home" }] },
    });
    expect(await readJson(".uxfactory/artifacts/sitemap.json")).toEqual({
      nodes: [{ nodeId: "N-home" }],
    });
  });

  it("merges a section into a shared file, creating it when absent", async () => {
    await applyArtifactWrite(root, {
      path: ".uxfactory/artifacts/design-system.json",
      sectionKey: "brand-colors",
      body: { primary: "#2952E3" },
    });
    const ds = await readJson(".uxfactory/artifacts/design-system.json");
    expect(ds["brand-colors"]).toEqual({ primary: "#2952E3" });
    expect(ds["version"]).toBe(1);
  });

  it("merges preserve OTHER sections (the migration-safety guarantee)", async () => {
    await mkdir(path.join(root, ".uxfactory/artifacts"), { recursive: true });
    await writeFile(
      path.join(root, ".uxfactory/artifacts/design-system.json"),
      JSON.stringify({ version: 1, fonts: { body: "Inter" } }),
    );
    await applyArtifactWrite(root, {
      path: ".uxfactory/artifacts/design-system.json",
      sectionKey: "grid",
      body: { columns: 12 },
    });
    const ds = await readJson(".uxfactory/artifacts/design-system.json");
    expect(ds["fonts"]).toEqual({ body: "Inter" }); // untouched
    expect(ds["grid"]).toEqual({ columns: 12 });
  });

  it("CONCURRENT merges into the same file never lose a section (the race the lock solves)", async () => {
    const sections = ["brand-colors", "palettes", "fonts", "grid", "typography"];
    // Fire all five merges at once — without a per-file lock, read-modify-write
    // interleaves and only the last-writer's section survives.
    await Promise.all(
      sections.map((key, i) =>
        applyArtifactWrite(root, {
          path: ".uxfactory/artifacts/design-system.json",
          sectionKey: key,
          body: { seq: i },
        }),
      ),
    );
    const ds = await readJson(".uxfactory/artifacts/design-system.json");
    for (const key of sections) {
      expect(ds[key], `${key} was lost to an interleaved write`).toBeDefined();
    }
  });

  it("writes a set-artifact instance file under a directory", async () => {
    await applyArtifactWrite(root, {
      path: ".uxfactory/artifacts/personas",
      instanceFile: "design-lead.json",
      body: { personaId: "design-lead", name: "Dana" },
    });
    expect(await readJson(".uxfactory/artifacts/personas/design-lead.json")).toMatchObject({
      personaId: "design-lead",
    });
  });

  it("writes a markdown string verbatim (non-JSON artifacts)", async () => {
    await applyArtifactWrite(root, {
      path: ".uxfactory/artifacts/brief.md",
      body: "# Brief\n\nThe product.",
    });
    expect(await readFile(path.join(root, ".uxfactory/artifacts/brief.md"), "utf8")).toBe(
      "# Brief\n\nThe product.",
    );
  });

  it("refuses to write outside the project root (path traversal guard)", async () => {
    await expect(
      applyArtifactWrite(root, { path: "../escape.json", body: { x: 1 } }),
    ).rejects.toThrow(/outside/i);
  });
});

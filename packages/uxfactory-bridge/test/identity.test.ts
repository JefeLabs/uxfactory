/**
 * identity.test.ts — TDD tests for the node-identity bridge routes (Task 2).
 *
 * Test matrix:
 *  - GET /project/identity/registries: default (no file) → defaultIdentityRegistries()
 *  - PUT /project/identity/registries: valid round-trip; invalid → 400 { errors }
 *    including the viewport∪mode disjointness violation
 *  - GET /project/identity/components: default (no file) → { version: 1, components: [] }
 *  - PUT /project/identity/components: whole-set round-trip (replace, not merge)
 *  - GET /project/identity/manifest: default (no file) → { version: 1, records: {} }
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { defaultIdentityRegistries } from "@uxfactory/spec";
import type { IdentityRegistries, ComponentRegistry, NodeManifest } from "@uxfactory/spec";
import { createBridge } from "../src/server.js";

/** Create a temp directory used as the project root. */
async function mkRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "uxf-identity-"));
}

/** Make the directory a valid project root by placing a .git marker. */
async function addGitMarker(root: string): Promise<void> {
  await mkdir(path.join(root, ".git"), { recursive: true });
}

let app: FastifyInstance;
let root: string;
let dataDir: string;

beforeEach(async () => {
  root = await mkRoot();
  dataDir = path.join(root, ".uxfactory");
  await mkdir(dataDir, { recursive: true });
  await addGitMarker(root);
  app = await createBridge({ dataDir });
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

// ─── GET + PUT /project/identity/registries ──────────────────────────────────

describe("GET + PUT /project/identity/registries", () => {
  it("GET returns defaultIdentityRegistries() when no file stored", async () => {
    const res = await app.inject({ method: "GET", url: "/project/identity/registries" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ registries: defaultIdentityRegistries() });
  });

  it("PUT writes valid registries; GET reads them back", async () => {
    const registries: IdentityRegistries = {
      version: 1,
      breakpoints: {
        bands: [
          { name: "mobile", min: 0, max: 767 },
          { name: "desktop", min: 768, max: null },
        ],
      },
      palette: {
        collections: [
          {
            collectionId: "VariableCollectionId:1:1",
            name: "Mode",
            axis: "mode",
            values: [{ modeId: "1:0", token: "light" }],
          },
        ],
      },
      states: { states: ["default", "hover"], defaultState: "default" },
    };

    const put = await app.inject({
      method: "PUT",
      url: "/project/identity/registries",
      payload: { registries },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true });

    const get = await app.inject({ method: "GET", url: "/project/identity/registries" });
    expect(get.json()).toEqual({ registries });

    // Persisted at the exact file name under the data dir.
    const raw = await readFile(path.join(dataDir, "identity-registries.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(registries);
  });

  it("PUT replaces the whole registries object (not merging)", async () => {
    const first: IdentityRegistries = defaultIdentityRegistries();
    const second: IdentityRegistries = {
      ...defaultIdentityRegistries(),
      states: { states: ["default", "focus"], defaultState: "focus" },
    };
    await app.inject({
      method: "PUT",
      url: "/project/identity/registries",
      payload: { registries: first },
    });
    await app.inject({
      method: "PUT",
      url: "/project/identity/registries",
      payload: { registries: second },
    });
    const res = (
      await app.inject({ method: "GET", url: "/project/identity/registries" })
    ).json() as { registries: IdentityRegistries };
    expect(res.registries).toEqual(second);
  });

  it("PUT with invalid registries replies 400 with errors, and does not persist", async () => {
    const invalid = { version: 1, breakpoints: { bands: "nope" }, palette: {}, states: {} };
    const put = await app.inject({
      method: "PUT",
      url: "/project/identity/registries",
      payload: { registries: invalid },
    });
    expect(put.statusCode).toBe(400);
    const body = put.json() as { errors: string[] };
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);

    // Nothing written — GET still returns the default.
    const get = await app.inject({ method: "GET", url: "/project/identity/registries" });
    expect(get.json()).toEqual({ registries: defaultIdentityRegistries() });
  });

  it("PUT surfaces the viewport∪mode disjointness violation", async () => {
    const colliding: IdentityRegistries = {
      version: 1,
      breakpoints: {
        bands: [{ name: "desktop", min: 0, max: null }],
      },
      palette: {
        collections: [
          {
            collectionId: "VariableCollectionId:1:1",
            name: "Mode",
            axis: "mode",
            values: [{ modeId: "1:0", token: "desktop" }],
          },
        ],
      },
      states: { states: ["default"], defaultState: "default" },
    };

    const put = await app.inject({
      method: "PUT",
      url: "/project/identity/registries",
      payload: { registries: colliding },
    });
    expect(put.statusCode).toBe(400);
    const body = put.json() as { errors: string[] };
    expect(body.errors.some((e) => e.includes("desktop") && e.includes("disjoint"))).toBe(true);
  });
});

// ─── GET + PUT /project/identity/components ──────────────────────────────────

describe("GET + PUT /project/identity/components", () => {
  it("GET returns { version: 1, components: [] } when no file stored", async () => {
    const res = await app.inject({ method: "GET", url: "/project/identity/components" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 1, components: [] });
  });

  it("PUT writes whole set; GET reads it back", async () => {
    const registry: ComponentRegistry = {
      version: 1,
      components: [
        {
          key: "abc123",
          roleName: "button",
          source: "figma-document",
          matchability: "matchable",
        },
      ],
    };

    const put = await app.inject({
      method: "PUT",
      url: "/project/identity/components",
      payload: registry,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true });

    const get = await app.inject({ method: "GET", url: "/project/identity/components" });
    expect(get.json()).toEqual(registry);

    const raw = await readFile(path.join(dataDir, "component-registry.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(registry);
  });

  it("PUT replaces the whole set (not merging)", async () => {
    const first: ComponentRegistry = {
      version: 1,
      components: [{ key: "a", roleName: "button", source: "manual", matchability: "matchable" }],
    };
    const second: ComponentRegistry = {
      version: 1,
      components: [{ key: "b", roleName: "card", source: "manual", matchability: "composed" }],
    };
    await app.inject({ method: "PUT", url: "/project/identity/components", payload: first });
    await app.inject({ method: "PUT", url: "/project/identity/components", payload: second });
    const res = (
      await app.inject({ method: "GET", url: "/project/identity/components" })
    ).json() as ComponentRegistry;
    expect(res).toEqual(second);
  });
});

// ─── GET /project/identity/manifest ───────────────────────────────────────────

describe("GET /project/identity/manifest", () => {
  it("returns { version: 1, records: {} } when no file stored", async () => {
    const res = await app.inject({ method: "GET", url: "/project/identity/manifest" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 1, records: {} } satisfies NodeManifest);
  });
});

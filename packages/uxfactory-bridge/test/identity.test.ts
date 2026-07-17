/**
 * identity.test.ts — TDD tests for the node-identity bridge routes (Task 2,
 * Task 8).
 *
 * Test matrix:
 *  - GET /project/identity/registries: default (no file) → { registries: defaultIdentityRegistries() }
 *  - PUT /project/identity/registries: body { registries }; valid round-trip;
 *    invalid → 400 { errors } including the viewport∪mode disjointness violation
 *  - GET /project/identity/components: default (no file) → { components: [] }
 *  - PUT /project/identity/components: body { components }; whole-set round-trip
 *    (replace, not merge); malformed body → 400 { errors }, nothing persisted;
 *    file on disk stays the canonical { version: 1, components } shape
 *  - GET /project/identity/manifest: default (no file) → { manifest: { version: 1, records: {} } }
 *  - POST /project/identity/extraction (Task 8, MVP — structure only, no
 *    vision): assembles from persisted registries/components + prior
 *    manifest, upserts node-manifest.json by durableId, replies
 *    { ok, count, addresses } (addresses capped at 50); a second POST
 *    against a hand-confirmed prior record preserves the confirmed label and
 *    applied stamps; a partial extraction leaves other durableIds untouched;
 *    malformed body → 400 { errors }, nothing persisted.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { defaultIdentityRegistries } from "@uxfactory/spec";
import type {
  IdentityRegistries,
  ComponentRegistry,
  ComponentTypeEntry,
  ExtractedNode,
  IdentityExtraction,
  IdentityProposal,
  NodeIdentityRecord,
  NodeManifest,
} from "@uxfactory/spec";
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
  it("GET returns { components: [] } when no file stored", async () => {
    const res = await app.inject({ method: "GET", url: "/project/identity/components" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ components: [] });
  });

  it("PUT writes whole set (wire shape { components }); GET reads it back", async () => {
    const components: ComponentTypeEntry[] = [
      {
        key: "abc123",
        roleName: "button",
        source: "figma-document",
        matchability: "matchable",
      },
    ];

    const put = await app.inject({
      method: "PUT",
      url: "/project/identity/components",
      payload: { components },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true });

    const get = await app.inject({ method: "GET", url: "/project/identity/components" });
    expect(get.json()).toEqual({ components });

    // File on disk stays the canonical ComponentRegistry shape.
    const raw = await readFile(path.join(dataDir, "component-registry.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ version: 1, components } satisfies ComponentRegistry);
  });

  it("PUT replaces the whole set (not merging)", async () => {
    const first: ComponentTypeEntry[] = [
      { key: "a", roleName: "button", source: "manual", matchability: "matchable" },
    ];
    const second: ComponentTypeEntry[] = [
      { key: "b", roleName: "card", source: "manual", matchability: "composed" },
    ];
    await app.inject({
      method: "PUT",
      url: "/project/identity/components",
      payload: { components: first },
    });
    await app.inject({
      method: "PUT",
      url: "/project/identity/components",
      payload: { components: second },
    });
    const res = (
      await app.inject({ method: "GET", url: "/project/identity/components" })
    ).json() as { components: ComponentTypeEntry[] };
    expect(res.components).toEqual(second);
  });

  it.each([
    ["missing body", {}],
    ["null body", null],
    ["components not an array", { components: "nope" }],
    ["entry missing required string fields", { components: [{ key: "a" }] }],
    [
      "entry with non-string field",
      { components: [{ key: "a", roleName: "b", source: "manual", matchability: 1 }] },
    ],
    [
      // Fix #3 (post-review): roleName becomes a path label downstream
      // (identity-assemble.ts, and the proposals-merge route) — serializeAddress
      // throws on anything that isn't kebab. Reject a non-kebab roleName at
      // the write boundary instead of letting it crash a later request.
      "entry with non-kebab roleName",
      { components: [{ key: "a", roleName: "Nav Item", source: "manual", matchability: "matchable" }] },
    ],
  ])("PUT with malformed body (%s) replies 400 and persists nothing", async (_label, payload) => {
    const put = await app.inject({
      method: "PUT",
      url: "/project/identity/components",
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
    expect(put.statusCode).toBe(400);
    const body = put.json() as { errors: string[] };
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);

    // Nothing written — GET still returns the default, and no file was created.
    const get = await app.inject({ method: "GET", url: "/project/identity/components" });
    expect(get.json()).toEqual({ components: [] });
    await expect(readFile(path.join(dataDir, "component-registry.json"), "utf8")).rejects.toThrow();
  });
});

// ─── GET /project/identity/manifest ───────────────────────────────────────────

describe("GET /project/identity/manifest", () => {
  it("returns { manifest: { version: 1, records: {} } } when no file stored", async () => {
    const res = await app.inject({ method: "GET", url: "/project/identity/manifest" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      manifest: { version: 1, records: {} } satisfies NodeManifest,
    });
  });
});

// ─── POST /project/identity/extraction ───────────────────────────────────────

/** Custom (non-default) breakpoints — proves the route reads the persisted
 *  registries file rather than silently falling back to defaultIdentityRegistries(). */
function customRegistries(): IdentityRegistries {
  return {
    version: 1,
    breakpoints: {
      bands: [
        { name: "small", min: 0, max: 767 },
        { name: "big", min: 768, max: null },
      ],
    },
    palette: { collections: [] },
    states: { states: ["default", "hover"], defaultState: "default" },
  };
}

const buttonComponent: ComponentTypeEntry = {
  key: "button-key",
  roleName: "button",
  source: "figma-document",
  matchability: "matchable",
};

function heroNode(): ExtractedNode {
  return {
    durableId: "n-hero",
    figmaNodeId: "f-hero",
    parentDurableId: null,
    ordinal: 0,
    kind: "FRAME",
    width: 1440,
    currentName: "Hero",
    resolvedModes: {},
    mainComponent: null,
    variantProperties: null,
    isPageChild: true,
  };
}

function heroButtonNode(): ExtractedNode {
  return {
    durableId: "n-hero-button",
    figmaNodeId: "f-hero-button",
    parentDurableId: "n-hero",
    ordinal: 0,
    kind: "INSTANCE",
    width: null,
    currentName: "Button",
    resolvedModes: {},
    mainComponent: { key: "button-key", name: "Button", remote: false },
    variantProperties: null,
    isPageChild: false,
  };
}

function footerNode(): ExtractedNode {
  return {
    durableId: "n-footer",
    figmaNodeId: "f-footer",
    parentDurableId: null,
    ordinal: 1,
    kind: "FRAME",
    width: 1440,
    currentName: "Footer",
    resolvedModes: {},
    mainComponent: null,
    variantProperties: null,
    isPageChild: true,
  };
}

function baseExtraction(nodes: ExtractedNode[]): IdentityExtraction {
  return {
    version: 1,
    page: { figmaNodeId: "0:1", name: "Home" },
    pageCount: 1,
    nodes,
  };
}

async function readManifest(dataDir: string): Promise<NodeManifest> {
  const raw = await readFile(path.join(dataDir, "node-manifest.json"), "utf8");
  return JSON.parse(raw) as NodeManifest;
}

describe("POST /project/identity/extraction", () => {
  beforeEach(async () => {
    await app.inject({
      method: "PUT",
      url: "/project/identity/registries",
      payload: { registries: customRegistries() },
    });
    await app.inject({
      method: "PUT",
      url: "/project/identity/components",
      payload: { components: [buttonComponent] },
    });
  });

  it("assembles from the persisted registries/components, upserts node-manifest.json, and replies { ok, count, addresses }", async () => {
    const extraction = baseExtraction([heroNode(), heroButtonNode(), footerNode()]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/extraction",
      payload: { extraction },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; count: number; addresses: string[] };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(3);
    expect([...body.addresses].sort()).toEqual(["footer@big", "hero/button@big", "hero@big"]);

    const manifest = await readManifest(dataDir);
    expect(Object.keys(manifest.records).sort()).toEqual(["n-footer", "n-hero", "n-hero-button"]);

    const hero = manifest.records["n-hero"]!;
    expect(hero.address).toBe("hero@big");
    expect(hero.scope).toEqual(["home"]);
    expect(hero.path).toEqual([{ label: "hero", provenance: "inferred", source: "prior-name" }]);

    const button = manifest.records["n-hero-button"]!;
    expect(button.address).toBe("hero/button@big");
    // definitionRef only populates when the bound instance's mainComponent
    // key matched an entry in the PERSISTED component-registry.json file —
    // proves the route loaded it from disk, not the [] default.
    expect(button.definitionRef).toBe("button-key");
    expect(button.matchability).toBe("matchable");
    expect(button.resolutionStatus).toBe("bound");

    const footer = manifest.records["n-footer"]!;
    expect(footer.address).toBe("footer@big");
  });

  it("caps addresses in the reply at 50 but reports the true assembled count; the manifest holds every record", async () => {
    const nodes: ExtractedNode[] = Array.from({ length: 60 }, (_, i) => ({
      durableId: `n-section-${i}`,
      figmaNodeId: `f-section-${i}`,
      parentDurableId: null,
      ordinal: i,
      kind: "FRAME",
      width: 1440,
      currentName: `Section ${i}`,
      resolvedModes: {},
      mainComponent: null,
      variantProperties: null,
      isPageChild: true,
    }));

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/extraction",
      payload: { extraction: baseExtraction(nodes) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; count: number; addresses: string[] };
    expect(body.count).toBe(60);
    expect(body.addresses).toHaveLength(50);

    const manifest = await readManifest(dataDir);
    expect(Object.keys(manifest.records)).toHaveLength(60);
  });

  it("a second POST honors a hand-confirmed prior record: keeps the confirmed label and preserves applied stamps", async () => {
    const nodes = [heroNode(), heroButtonNode(), footerNode()];
    const extraction = baseExtraction(nodes);

    // Baseline POST.
    await app.inject({ method: "POST", url: "/project/identity/extraction", payload: { extraction } });

    // Hand-seed a manifest where "n-hero" carries a user-confirmed label and
    // an already-applied canvas address — state this task's route doesn't
    // itself produce (no confirm/apply routes exist yet), but which
    // assembleIdentities (Task 7) must honor and carry forward on re-derive.
    const seeded: NodeManifest = {
      version: 1,
      records: {
        "n-hero": {
          durableId: "n-hero",
          figmaNodeId: "f-hero",
          address: "custom-hero@big",
          scope: ["home"],
          path: [{ label: "custom-hero", provenance: "inferred", source: "prior-name", confirmed: true }],
          coordinates: { viewport: { value: "big", provenance: "derived", source: "structure" } },
          kind: "FRAME",
          pathRoleDefault: "section",
          isDefinition: false,
          matchability: "composed",
          composition: ["n-hero-button"],
          currentName: "Hero",
          updatedAt: "2020-01-01T00:00:00.000Z",
          appliedAddress: "custom-hero@big",
          appliedAt: "2020-01-01T00:00:01.000Z",
        },
      },
    };
    await writeFile(path.join(dataDir, "node-manifest.json"), `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

    // Second POST — same extraction, re-deriving over the seeded prior.
    const res = await app.inject({ method: "POST", url: "/project/identity/extraction", payload: { extraction } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; count: number; addresses: string[] };
    expect(body.count).toBe(3);

    const manifest = await readManifest(dataDir);

    const hero = manifest.records["n-hero"]!;
    expect(hero.path[hero.path.length - 1]).toMatchObject({ label: "custom-hero", confirmed: true });
    expect(hero.address).toBe("custom-hero@big");
    expect(hero.appliedAddress).toBe("custom-hero@big");
    expect(hero.appliedAt).toBe("2020-01-01T00:00:01.000Z");

    // Bound-instance labels ALWAYS recompute (rule 2: "derived labels never
    // take the prior-manifest override") — but they DO inherit the parent's
    // (now-confirmed) path segment.
    const button = manifest.records["n-hero-button"]!;
    expect(button.address).toBe("custom-hero/button@big");
    expect(button.appliedAddress).toBeUndefined();

    // A composed node with no prior override re-derives fresh, unaffected
    // by the hero's seeded confirmation.
    const footer = manifest.records["n-footer"]!;
    expect(footer.address).toBe("footer@big");
  });

  it("a partial-page extraction leaves other durableIds' records byte-identical (no wipe)", async () => {
    const allNodes = [heroNode(), heroButtonNode(), footerNode()];
    await app.inject({
      method: "POST",
      url: "/project/identity/extraction",
      payload: { extraction: baseExtraction(allNodes) },
    });
    const before = await readManifest(dataDir);

    // Simulate a partial re-scan: only the footer this time.
    const res = await app.inject({
      method: "POST",
      url: "/project/identity/extraction",
      payload: { extraction: baseExtraction([footerNode()]) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; count: number; addresses: string[] };
    expect(body.count).toBe(1);
    expect(body.addresses).toEqual(["footer@big"]);

    const after = await readManifest(dataDir);
    expect(Object.keys(after.records).sort()).toEqual(["n-footer", "n-hero", "n-hero-button"]);
    expect(after.records["n-hero"]).toEqual(before.records["n-hero"]);
    expect(after.records["n-hero-button"]).toEqual(before.records["n-hero-button"]);
  });

  it.each([
    ["missing extraction key", {}],
    ["null body", null],
    ["extraction not an object", { extraction: "nope" }],
    [
      "extraction missing nodes array",
      { extraction: { version: 1, page: { figmaNodeId: "0:1", name: "Home" }, pageCount: 1 } },
    ],
    [
      "extraction.nodes not an array",
      { extraction: { version: 1, page: { figmaNodeId: "0:1", name: "Home" }, pageCount: 1, nodes: "nope" } },
    ],
    [
      "extraction.page missing",
      { extraction: { version: 1, pageCount: 1, nodes: [] } },
    ],
    [
      "extraction.pageCount not a number",
      { extraction: { version: 1, page: { figmaNodeId: "0:1", name: "Home" }, pageCount: "1", nodes: [] } },
    ],
    [
      "a node missing required string fields",
      {
        extraction: {
          version: 1,
          page: { figmaNodeId: "0:1", name: "Home" },
          pageCount: 1,
          nodes: [{ durableId: "a" }],
        },
      },
    ],
  ])("POST with malformed body (%s) replies 400 and persists nothing", async (_label, payload) => {
    const before = await app.inject({ method: "GET", url: "/project/identity/manifest" });

    const post = await app.inject({
      method: "POST",
      url: "/project/identity/extraction",
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
    expect(post.statusCode).toBe(400);
    const body = post.json() as { errors: string[] };
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);

    // Nothing written — the manifest is exactly what it was before.
    const after = await app.inject({ method: "GET", url: "/project/identity/manifest" });
    expect(after.json()).toEqual(before.json());
  });
});

// ─── POST /project/identity/crops ─────────────────────────────────────────────
// Task 9: root-tier crops pipeline. The plugin exports one PNG per page
// child, base64-encodes it in the UI, and POSTs it here to be decoded and
// written under identity/crops/<durableId>.png.

function b64(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64");
}

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];

describe("POST /project/identity/crops", () => {
  it("writes one PNG per crop under identity/crops/<durableId>.png and replies { ok: true, written }", async () => {
    const crops = [
      { durableId: "n-hero123456", base64: b64(PNG_MAGIC) },
      { durableId: "n-footer12345", base64: b64([1, 2, 3, 4]) },
    ];

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/crops",
      payload: { crops },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, written: 2 });

    const heroPath = path.join(dataDir, "identity", "crops", "n-hero123456.png");
    const footerPath = path.join(dataDir, "identity", "crops", "n-footer12345.png");
    expect(await readFile(heroPath)).toEqual(Buffer.from(PNG_MAGIC));
    expect(await readFile(footerPath)).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("creates the identity/crops directory when it does not yet exist", async () => {
    await expect(access(path.join(dataDir, "identity", "crops"))).rejects.toThrow();

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/crops",
      payload: { crops: [{ durableId: "n-abc123", base64: b64(PNG_MAGIC) }] },
    });
    expect(res.statusCode).toBe(200);

    const entries = await readdir(path.join(dataDir, "identity", "crops"));
    expect(entries).toEqual(["n-abc123.png"]);
  });

  it("overwrites an existing crop for the same durableId (re-scan reflects current canvas)", async () => {
    const cropPath = path.join(dataDir, "identity", "crops", "n-hero123456.png");

    await app.inject({
      method: "POST",
      url: "/project/identity/crops",
      payload: { crops: [{ durableId: "n-hero123456", base64: b64([1, 1, 1]) }] },
    });
    expect(await readFile(cropPath)).toEqual(Buffer.from([1, 1, 1]));

    await app.inject({
      method: "POST",
      url: "/project/identity/crops",
      payload: { crops: [{ durableId: "n-hero123456", base64: b64([2, 2, 2, 2]) }] },
    });
    expect(await readFile(cropPath)).toEqual(Buffer.from([2, 2, 2, 2]));

    // Still exactly one file — overwrite, not an accumulating duplicate.
    const entries = await readdir(path.join(dataDir, "identity", "crops"));
    expect(entries).toEqual(["n-hero123456.png"]);
  });

  it("path-safety: skips a durableId that fails the /^n-[a-z0-9]+$/ shape (e.g. a path-traversal attempt) but still writes the valid crops in the same batch", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/project/identity/crops",
      payload: {
        crops: [
          { durableId: "n-good123", base64: b64(PNG_MAGIC) },
          { durableId: "../../../../etc/passwd", base64: b64([9, 9, 9]) },
          { durableId: "not-a-durable-id", base64: b64([9, 9, 9]) },
          { durableId: "n-BADCASE", base64: b64([9, 9, 9]) }, // uppercase not allowed
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, written: 1 });

    // Only the one valid crop landed inside the crops dir.
    const entries = await readdir(path.join(dataDir, "identity", "crops"));
    expect(entries).toEqual(["n-good123.png"]);

    // No file escaped upward — the dataDir's own parent tree gained nothing else.
    await expect(readFile(path.join(root, "..", "etc", "passwd"))).rejects.toThrow();
    await expect(readFile(path.join(root, "etc", "passwd"))).rejects.toThrow();
  });

  it.each([
    ["missing crops key", {}],
    ["null body", null],
    ["crops not an array", { crops: "nope" }],
    ["entry missing durableId", { crops: [{ base64: "aGk=" }] }],
    ["entry missing base64", { crops: [{ durableId: "n-abc123" }] }],
    ["entry with non-string base64", { crops: [{ durableId: "n-abc123", base64: 123 }] }],
  ])("POST with malformed body (%s) replies 400 and persists nothing", async (_label, payload) => {
    const res = await app.inject({
      method: "POST",
      url: "/project/identity/crops",
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { errors: string[] };
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);

    // Nothing written — the crops dir was never even created.
    await expect(access(path.join(dataDir, "identity", "crops"))).rejects.toThrow();
  });
});

// ─── POST /project/identity/proposals ─────────────────────────────────────────
// Task 10, Phase 3: merges the node-identity worker skill's vision proposals
// into node-manifest.json as INFERRED (never settled — skill §D).

/** A minimal composed record: inferred, un-confirmed last segment. */
function composedRecord(durableId: string, label: string): NodeIdentityRecord {
  return {
    durableId,
    figmaNodeId: `f-${durableId}`,
    address: `${label}@desktop`,
    scope: ["home"],
    path: [{ label, provenance: "inferred", source: "prior-name" }],
    coordinates: { viewport: { value: "desktop", provenance: "derived", source: "structure" } },
    kind: "FRAME",
    pathRoleDefault: "section",
    isDefinition: false,
    matchability: "composed",
    composition: [],
    currentName: label,
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

/** A record whose last path segment is user-confirmed — the protected case. */
function confirmedRecord(durableId: string, label: string): NodeIdentityRecord {
  const rec = composedRecord(durableId, label);
  rec.path = [{ label, provenance: "inferred", source: "prior-name", confirmed: true }];
  return rec;
}

/** A record eligible for a closed-set component match (currently unmatched/composed). */
function matchableRecord(durableId: string, label: string): NodeIdentityRecord {
  const rec = composedRecord(durableId, label);
  rec.path = [{ label, provenance: "inferred", source: "prior-name" }];
  return rec;
}

async function writeManifest(dataDir: string, records: NodeIdentityRecord[]): Promise<void> {
  const manifest: NodeManifest = {
    version: 1,
    records: Object.fromEntries(records.map((r) => [r.durableId, r])),
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "node-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

const buttonEntry: ComponentTypeEntry = {
  key: "button-key",
  roleName: "button",
  source: "figma-document",
  matchability: "matchable",
};

/**
 * Registries for the proposals-merge tests: the same breakpoint bands as
 * `defaultIdentityRegistries()` (so existing "@desktop"-shaped fixtures are
 * unaffected), PLUS a declared mode collection ("light"/"dark") and theme
 * collection ("default"/"students") — needed so `normalizeCoordinateToken`
 * (fix #2) has real registry members to resolve a proposed mode/theme value
 * against, rather than rejecting everything because the palette is empty.
 */
function proposalsRegistries(): IdentityRegistries {
  return {
    version: 1,
    breakpoints: {
      bands: [
        { name: "mobile", min: 0, max: 767 },
        { name: "tablet", min: 768, max: 1279 },
        { name: "desktop", min: 1280, max: null },
      ],
    },
    palette: {
      collections: [
        {
          collectionId: "VariableCollectionId:mode",
          name: "Mode",
          axis: "mode",
          values: [
            { modeId: "1:0", token: "light" },
            { modeId: "1:1", token: "dark" },
          ],
          defaultToken: "light",
        },
        {
          collectionId: "VariableCollectionId:theme",
          name: "Brand",
          axis: "theme",
          values: [
            { modeId: "2:0", token: "default" },
            { modeId: "2:1", token: "students" },
          ],
          defaultToken: "default",
        },
      ],
    },
    states: { states: ["default", "hover", "focus", "disabled"], defaultState: "default" },
  };
}

describe("POST /project/identity/proposals", () => {
  beforeEach(async () => {
    await app.inject({
      method: "PUT",
      url: "/project/identity/registries",
      payload: { registries: proposalsRegistries() },
    });
    await app.inject({
      method: "PUT",
      url: "/project/identity/components",
      payload: { components: [buttonEntry] },
    });
  });

  it("applies a label proposal to an un-confirmed composed record: last segment + reasoning + re-serialized address", async () => {
    await writeManifest(dataDir, [composedRecord("n-hero", "hero-old")]);

    const proposals: IdentityProposal[] = [
      {
        durableId: "n-hero",
        label: "hero-banner",
        confidence: "high",
        reasoning: "Large lead section with a headline and a single CTA.",
      },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ applied: 1, skipped: 0 });

    const manifest = await readManifest(dataDir);
    const hero = manifest.records["n-hero"]!;
    expect(hero.path).toEqual([
      { label: "hero-banner", provenance: "inferred", source: "vision", confirmed: false },
    ]);
    expect(hero.reasoning).toContain("Large lead section with a headline and a single CTA.");
    expect(hero.reasoning).toContain("high");
    // Address re-serialized from the NEW label + existing coordinates.
    expect(hero.address).toBe("hero-banner@desktop");
  });

  it("fix #1: kebab-normalizes a free-text label before writing it (\"Hero Banner\" → \"hero-banner\") — the CORRECT behavior, not just crash-avoidance", async () => {
    await writeManifest(dataDir, [composedRecord("n-hero", "hero-old")]);

    const proposals: IdentityProposal[] = [
      { durableId: "n-hero", label: "Hero Banner!!", confidence: "high", reasoning: "Vision returned free text." },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ applied: 1, skipped: 0 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-hero"]!.path[0]!.label).toBe("hero-banner");
    expect(manifest.records["n-hero"]!.address).toBe("hero-banner@desktop");
  });

  it("fix #1: a label that kebabs to nothing usable (punctuation-only) is skipped — never writes an empty segment", async () => {
    await writeManifest(dataDir, [composedRecord("n-hero", "hero-old")]);

    const proposals: IdentityProposal[] = [
      { durableId: "n-hero", label: "!!!", confidence: "low", reasoning: "Nothing survives kebabbing." },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.json()).toEqual({ applied: 0, skipped: 1 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-hero"]!.path[0]!.label).toBe("hero-old");
  });

  it("SKIPS a label proposal when the current last segment is confirmed:true — no overwrite", async () => {
    await writeManifest(dataDir, [confirmedRecord("n-hero", "custom-hero")]);

    const proposals: IdentityProposal[] = [
      {
        durableId: "n-hero",
        label: "hero-banner",
        confidence: "high",
        reasoning: "Should never apply — the user already confirmed a label.",
      },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ applied: 0, skipped: 1 });

    const manifest = await readManifest(dataDir);
    const hero = manifest.records["n-hero"]!;
    expect(hero.path).toEqual([
      { label: "custom-hero", provenance: "inferred", source: "prior-name", confirmed: true },
    ]);
    expect(hero.address).toBe("custom-hero@desktop");
    expect(hero.reasoning).toBeUndefined();
  });

  it("SKIPS a label proposal when the current last segment provenance is elicited — no overwrite", async () => {
    const rec = composedRecord("n-hero", "elicited-hero");
    rec.path = [{ label: "elicited-hero", provenance: "elicited", source: "user" }];
    await writeManifest(dataDir, [rec]);

    const proposals: IdentityProposal[] = [
      { durableId: "n-hero", label: "hero-banner", confidence: "low", reasoning: "Should not apply." },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.json()).toEqual({ applied: 0, skipped: 1 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-hero"]!.path[0]!.label).toBe("elicited-hero");
  });

  it("matchedComponentKey sets definitionRef + label from the registry roleName + resolutionStatus (default 'bound')", async () => {
    await writeManifest(dataDir, [matchableRecord("n-button", "button-old")]);

    const proposals: IdentityProposal[] = [
      {
        durableId: "n-button",
        matchedComponentKey: "button-key",
        confidence: "high",
        reasoning: "Pixel-identical to the registered button primary variant.",
      },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.json()).toEqual({ applied: 1, skipped: 0 });

    const manifest = await readManifest(dataDir);
    const button = manifest.records["n-button"]!;
    expect(button.path[0]).toMatchObject({ label: "button", provenance: "inferred", source: "vision", confirmed: false });
    expect(button.definitionRef).toBe("button-key");
    expect(button.resolutionStatus).toBe("bound");
    expect(button.address).toBe("button@desktop");
  });

  it("matchedComponentKey honors an explicit resolutionStatus (e.g. 'drifted')", async () => {
    await writeManifest(dataDir, [matchableRecord("n-button", "button-old")]);

    const proposals: IdentityProposal[] = [
      {
        durableId: "n-button",
        matchedComponentKey: "button-key",
        resolutionStatus: "drifted",
        confidence: "high",
        reasoning: "Looks like a detached, hand-rebuilt copy of the registered button.",
      },
    ];
    await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-button"]!.resolutionStatus).toBe("drifted");
  });

  it("a matchedComponentKey with no matching registry entry is a no-op (skipped)", async () => {
    await writeManifest(dataDir, [matchableRecord("n-button", "button-old")]);

    const proposals: IdentityProposal[] = [
      {
        durableId: "n-button",
        matchedComponentKey: "no-such-key",
        confidence: "high",
        reasoning: "Unresolvable key.",
      },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.json()).toEqual({ applied: 0, skipped: 1 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-button"]!.definitionRef).toBeUndefined();
    expect(manifest.records["n-button"]!.path[0]!.label).toBe("button-old");
  });

  it("a matchedComponentKey proposal against a CONFIRMED record is skipped — definitionRef/resolutionStatus untouched", async () => {
    await writeManifest(dataDir, [confirmedRecord("n-button", "custom-button")]);

    const proposals: IdentityProposal[] = [
      {
        durableId: "n-button",
        matchedComponentKey: "button-key",
        confidence: "high",
        reasoning: "Should never apply — the user already confirmed a label.",
      },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.json()).toEqual({ applied: 0, skipped: 1 });

    const manifest = await readManifest(dataDir);
    const button = manifest.records["n-button"]!;
    expect(button.path[0]).toEqual({ label: "custom-button", provenance: "inferred", source: "prior-name", confirmed: true });
    expect(button.definitionRef).toBeUndefined();
    expect(button.resolutionStatus).toBeUndefined();
  });

  it("a matchedComponentKey proposal against an ELICITED record is skipped — definitionRef/resolutionStatus untouched", async () => {
    const rec = composedRecord("n-button", "elicited-button");
    rec.path = [{ label: "elicited-button", provenance: "elicited", source: "user" }];
    await writeManifest(dataDir, [rec]);

    const proposals: IdentityProposal[] = [
      {
        durableId: "n-button",
        matchedComponentKey: "button-key",
        confidence: "high",
        reasoning: "Should never apply — elicited is user-ratified.",
      },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.json()).toEqual({ applied: 0, skipped: 1 });

    const manifest = await readManifest(dataDir);
    const button = manifest.records["n-button"]!;
    expect(button.path[0]!.label).toBe("elicited-button");
    expect(button.definitionRef).toBeUndefined();
    expect(button.resolutionStatus).toBeUndefined();
  });

  it("fills mode ONLY when the axis is currently absent; leaves an existing axis untouched", async () => {
    const withoutMode = composedRecord("n-nomode", "section-a");
    const withMode = composedRecord("n-withmode", "section-b");
    withMode.coordinates.mode = { value: "light", provenance: "derived", source: "structure" };
    await writeManifest(dataDir, [withoutMode, withMode]);

    const proposals: IdentityProposal[] = [
      { durableId: "n-nomode", mode: "dark", confidence: "low", reasoning: "Dark background, light text." },
      { durableId: "n-withmode", mode: "dark", confidence: "low", reasoning: "Should not overwrite." },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.json()).toEqual({ applied: 1, skipped: 1 });

    const manifest = await readManifest(dataDir);
    const filled = manifest.records["n-nomode"]!;
    expect(filled.coordinates.mode).toEqual({
      value: "dark",
      provenance: "inferred",
      source: "vision",
      confidence: "low",
      confirmed: false,
    });
    expect(filled.address).toBe("section-a@desktop@dark");

    const untouched = manifest.records["n-withmode"]!;
    expect(untouched.coordinates.mode).toEqual({ value: "light", provenance: "derived", source: "structure" });
    expect(untouched.address).toBe("section-b@desktop"); // unchanged — the whole proposal was a no-op
  });

  it("fills theme ONLY when the axis is currently absent", async () => {
    await writeManifest(dataDir, [composedRecord("n-theme", "section-c")]);

    const proposals: IdentityProposal[] = [
      { durableId: "n-theme", theme: "students", confidence: "high", reasoning: "Orange accent throughout." },
    ];
    await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-theme"]!.coordinates.theme).toEqual({
      value: "students",
      provenance: "inferred",
      source: "vision",
      confidence: "high",
      confirmed: false,
    });
  });

  it("fix #2: a mode value that is NOT a registry member is not filled (normalized against the palette, not written raw)", async () => {
    await writeManifest(dataDir, [composedRecord("n-nomode2", "section-d")]);

    const proposals: IdentityProposal[] = [
      { durableId: "n-nomode2", mode: "purple", confidence: "low", reasoning: "Not an actual registered mode." },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.json()).toEqual({ applied: 0, skipped: 1 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-nomode2"]!.coordinates.mode).toBeUndefined();
    expect(manifest.records["n-nomode2"]!.address).toBe("section-d@desktop");
  });

  it("fix #2: a theme value that is NOT a registry member is not filled", async () => {
    await writeManifest(dataDir, [composedRecord("n-notheme", "section-e")]);

    const proposals: IdentityProposal[] = [
      { durableId: "n-notheme", theme: "acme-corp", confidence: "low", reasoning: "Not a registered theme token." },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.json()).toEqual({ applied: 0, skipped: 1 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-notheme"]!.coordinates.theme).toBeUndefined();
  });

  it("a durableId absent from the manifest is skipped (no error)", async () => {
    await writeManifest(dataDir, []);
    const proposals: IdentityProposal[] = [
      { durableId: "n-ghost", label: "ghost", confidence: "high", reasoning: "No such record." },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ applied: 0, skipped: 1 });
  });

  it("a mixed batch reports combined applied/skipped counts", async () => {
    await writeManifest(dataDir, [
      composedRecord("n-a", "section-a"),
      confirmedRecord("n-b", "section-b"),
      matchableRecord("n-c", "section-c"),
    ]);
    const proposals: IdentityProposal[] = [
      { durableId: "n-a", label: "hero", confidence: "high", reasoning: "r1" },
      { durableId: "n-b", label: "hero", confidence: "high", reasoning: "r2 (should skip)" },
      { durableId: "n-c", matchedComponentKey: "button-key", confidence: "high", reasoning: "r3" },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.json()).toEqual({ applied: 2, skipped: 1 });
  });

  // ─── post-review fix: atomicity + legacy roleName ──────────────────────────

  it("ATOMICITY: a proposal that doesn't touch a record's pre-existing invalid segment still leaves the WHOLE record byte-identical when serialize throws", async () => {
    // A record whose EXISTING last segment is legacy-invalid — never written
    // by this route (both the label and matchedComponentKey paths now
    // normalize), only reachable via hand-edited/pre-guard manifest data.
    // serializeAddress throws on this segment's label regardless of what the
    // proposal below actually changes (mode, a DIFFERENT field).
    const legacy = composedRecord("n-legacy", "placeholder");
    legacy.path = [{ label: "Not Valid!!!", provenance: "inferred", source: "prior-name" }];
    await writeManifest(dataDir, [legacy]);
    const before = await readManifest(dataDir);

    const proposals: IdentityProposal[] = [
      { durableId: "n-legacy", mode: "dark", confidence: "low", reasoning: "Should never persist." },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { applied: number; skipped: number; errors?: string[] };
    expect(body).toEqual({ applied: 0, skipped: 1, errors: [expect.stringContaining("n-legacy")] });

    // The WHOLE record — including coordinates.mode, which the throwing
    // candidate DID set before serialize failed — is untouched: proof the
    // route never commits a partially-mutated record.
    const after = await readManifest(dataDir);
    expect(after.records["n-legacy"]).toEqual(before.records["n-legacy"]);
    expect(after.records["n-legacy"]!.coordinates.mode).toBeUndefined();
  });

  it("a matchedComponentKey against a LEGACY non-kebab roleName (bypassing the PUT guard, written directly to disk) applies with the NORMALIZED label — never corrupt, never partial", async () => {
    // Bypass validateComponentsBody entirely — simulate a component-registry.json
    // written before the PUT guard existed, or hand-edited.
    const legacyRegistry: ComponentRegistry = {
      version: 1,
      components: [{ key: "nav-key", roleName: "Nav Item", source: "manual", matchability: "matchable" }],
    };
    await writeFile(
      path.join(dataDir, "component-registry.json"),
      `${JSON.stringify(legacyRegistry, null, 2)}\n`,
      "utf8",
    );
    await writeManifest(dataDir, [matchableRecord("n-nav", "nav-old")]);

    const proposals: IdentityProposal[] = [
      { durableId: "n-nav", matchedComponentKey: "nav-key", confidence: "high", reasoning: "Matches the nav item." },
    ];
    const res = await app.inject({ method: "POST", url: "/project/identity/proposals", payload: { proposals } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ applied: 1, skipped: 0 });

    const manifest = await readManifest(dataDir);
    const nav = manifest.records["n-nav"]!;
    expect(nav.path[0]!.label).toBe("nav-item"); // normalized, not the raw "Nav Item"
    expect(nav.definitionRef).toBe("nav-key");
    expect(nav.address).toBe("nav-item@desktop"); // serializes cleanly
  });

  it.each([
    ["missing proposals key", {}],
    ["null body", null],
    ["proposals not an array", { proposals: "nope" }],
    ["entry missing durableId", { proposals: [{ confidence: "high", reasoning: "x" }] }],
    ["entry missing confidence", { proposals: [{ durableId: "n-a", reasoning: "x" }] }],
    ["entry with invalid confidence", { proposals: [{ durableId: "n-a", confidence: "medium", reasoning: "x" }] }],
    ["entry missing reasoning", { proposals: [{ durableId: "n-a", confidence: "high" }] }],
    [
      "entry with invalid resolutionStatus",
      {
        proposals: [
          { durableId: "n-a", confidence: "high", reasoning: "x", resolutionStatus: "nope" },
        ],
      },
    ],
  ])("POST with malformed body (%s) replies 400 and persists nothing", async (_label, payload) => {
    await writeManifest(dataDir, [composedRecord("n-a", "section-a")]);
    const before = await readManifest(dataDir);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/proposals",
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { errors: string[] };
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);

    const after = await readManifest(dataDir);
    expect(after).toEqual(before);
  });
});

// ─── POST /project/identity/confirm ────────────────────────────────────────
// Task 12, Phase 4: ratifies (`confirm`) or replaces (`override`) ONE
// segment — the path's last label, or one of the four coordinate axes — of
// ONE manifest record.

/**
 * A record covering every provenance/presence case a confirm/override test
 * needs: `label` and `viewport` are both "inferred" (confirm-eligible);
 * `mode` is "derived" (the confirm-REJECTED case — nothing to ratify);
 * `theme` and `state` are intentionally OMITTED (the absent-axis case —
 * confirm rejects it, override may create it).
 */
function confirmFixtureRecord(durableId: string, label: string): NodeIdentityRecord {
  return {
    durableId,
    figmaNodeId: `f-${durableId}`,
    address: `${label}@desktop`,
    scope: ["home"],
    path: [{ label, provenance: "inferred", source: "prior-name" }],
    coordinates: {
      viewport: { value: "desktop", provenance: "inferred", source: "vision", confidence: "high", confirmed: false },
      mode: { value: "light", provenance: "derived", source: "structure" },
    },
    kind: "FRAME",
    pathRoleDefault: "section",
    isDefinition: false,
    matchability: "composed",
    composition: [],
    currentName: label,
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

describe("POST /project/identity/confirm", () => {
  beforeEach(async () => {
    await app.inject({
      method: "PUT",
      url: "/project/identity/registries",
      payload: { registries: proposalsRegistries() },
    });
  });

  it("confirm flips confirmed:true on an inferred LABEL segment — provenance and value unchanged", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: { confirmations: [{ durableId: "n-hero", segment: "label", action: "confirm" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, updated: 1 });

    const manifest = await readManifest(dataDir);
    const hero = manifest.records["n-hero"]!;
    expect(hero.path).toEqual([{ label: "hero", provenance: "inferred", source: "prior-name", confirmed: true }]);
    expect(hero.address).toBe("hero@desktop");
  });

  it("confirm flips confirmed:true on an inferred COORDINATE segment (viewport) — provenance unchanged", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: { confirmations: [{ durableId: "n-hero", segment: "viewport", action: "confirm" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, updated: 1 });

    const manifest = await readManifest(dataDir);
    const viewport = manifest.records["n-hero"]!.coordinates.viewport!;
    expect(viewport).toEqual({
      value: "desktop",
      provenance: "inferred",
      source: "vision",
      confidence: "high",
      confirmed: true,
    });
  });

  it("override replaces the LABEL value, sets provenance elicited/source user, drops confirmed, and re-serializes address", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: {
        confirmations: [{ durableId: "n-hero", segment: "label", action: "override", value: "Custom Hero!!" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, updated: 1 });

    const manifest = await readManifest(dataDir);
    const hero = manifest.records["n-hero"]!;
    expect(hero.path).toEqual([{ label: "custom-hero", provenance: "elicited", source: "user" }]);
    expect(hero.address).toBe("custom-hero@desktop");
  });

  it("override replaces a COORDINATE value, sets provenance elicited/source user, and re-serializes address", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: {
        confirmations: [{ durableId: "n-hero", segment: "viewport", action: "override", value: "tablet" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, updated: 1 });

    const manifest = await readManifest(dataDir);
    const viewport = manifest.records["n-hero"]!.coordinates.viewport!;
    expect(viewport).toEqual({ value: "tablet", provenance: "elicited", source: "user" });
    expect(manifest.records["n-hero"]!.address).toBe("hero@tablet");
  });

  it("override normalizes a viewport synonym via normalizeCoordinateToken (\"web\" → \"desktop\")", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: { confirmations: [{ durableId: "n-hero", segment: "viewport", action: "override", value: "web" }] },
    });
    expect(res.json()).toEqual({ ok: true, updated: 1 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-hero"]!.coordinates.viewport!.value).toBe("desktop");
  });

  it("override CAN create a previously-absent coordinate (state), appearing in the re-serialized address", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);
    const before = await readManifest(dataDir);
    expect(before.records["n-hero"]!.coordinates.state).toBeUndefined();

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: { confirmations: [{ durableId: "n-hero", segment: "state", action: "override", value: "hover" }] },
    });
    expect(res.json()).toEqual({ ok: true, updated: 1 });

    const manifest = await readManifest(dataDir);
    const record = manifest.records["n-hero"]!;
    expect(record.coordinates.state).toEqual({ value: "hover", provenance: "elicited", source: "user" });
    expect(record.address).toBe("hero@desktop@state=hover");
  });

  it("override replaces the MODE coordinate (derived → elicited), a distinct registry lookup from viewport/state", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: { confirmations: [{ durableId: "n-hero", segment: "mode", action: "override", value: "dark" }] },
    });
    expect(res.json()).toEqual({ ok: true, updated: 1 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-hero"]!.coordinates.mode).toEqual({
      value: "dark",
      provenance: "elicited",
      source: "user",
    });
    // "dark" != mode's registry default ("light") so it's rendered — as keyless (mode serializes bare, like viewport).
    expect(manifest.records["n-hero"]!.address).toBe("hero@desktop@dark");
  });

  it("override CREATES the THEME coordinate (previously absent), a distinct registry lookup from mode", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);
    const before = await readManifest(dataDir);
    expect(before.records["n-hero"]!.coordinates.theme).toBeUndefined();

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: {
        confirmations: [{ durableId: "n-hero", segment: "theme", action: "override", value: "students" }],
      },
    });
    expect(res.json()).toEqual({ ok: true, updated: 1 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-hero"]!.coordinates.theme).toEqual({
      value: "students",
      provenance: "elicited",
      source: "user",
    });
    expect(manifest.records["n-hero"]!.address).toBe("hero@desktop@theme=students");
  });

  it("override coordinate with a non-registry token is a per-item error — updated:0, nothing changed", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);
    const before = await readManifest(dataDir);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: {
        confirmations: [{ durableId: "n-hero", segment: "viewport", action: "override", value: "giant-screen" }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; updated: number; errors: string[] };
    expect(body).toEqual({ ok: true, updated: 0, errors: [expect.stringContaining("n-hero.viewport")] });

    const after = await readManifest(dataDir);
    expect(after).toEqual(before);
  });

  it("override label with punctuation-only value (nothing survives kebabbing) is a per-item error", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);
    const before = await readManifest(dataDir);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: { confirmations: [{ durableId: "n-hero", segment: "label", action: "override", value: "!!!" }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; updated: number; errors: string[] };
    expect(body.updated).toBe(0);
    expect(body.errors[0]).toContain("n-hero.label");

    const after = await readManifest(dataDir);
    expect(after).toEqual(before);
  });

  it("confirm on a DERIVED segment (mode) is rejected — nothing to confirm", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);
    const before = await readManifest(dataDir);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: { confirmations: [{ durableId: "n-hero", segment: "mode", action: "confirm" }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; updated: number; errors: string[] };
    expect(body.updated).toBe(0);
    expect(body.errors[0]).toContain("n-hero.mode");
    expect(body.errors[0]).toContain("derived");

    const after = await readManifest(dataDir);
    expect(after).toEqual(before);
  });

  it("confirm on an ABSENT coordinate (theme, never set) is rejected — nothing to confirm", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);
    const before = await readManifest(dataDir);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: { confirmations: [{ durableId: "n-hero", segment: "theme", action: "confirm" }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; updated: number; errors: string[] };
    expect(body.updated).toBe(0);
    expect(body.errors[0]).toContain("n-hero.theme");

    const after = await readManifest(dataDir);
    expect(after).toEqual(before);
  });

  it("unknown durableId is a per-item error, not a hard failure of the batch", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: {
        confirmations: [
          { durableId: "n-ghost", segment: "label", action: "confirm" },
          { durableId: "n-hero", segment: "label", action: "confirm" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; updated: number; errors: string[] };
    expect(body.updated).toBe(1);
    expect(body.errors).toEqual([expect.stringContaining("n-ghost")]);

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-hero"]!.path[0]!.confirmed).toBe(true);
  });

  it("multiple items for the SAME durableId accumulate onto one candidate — updated counts RECORDS, not items", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: {
        confirmations: [
          { durableId: "n-hero", segment: "label", action: "override", value: "new-name" },
          { durableId: "n-hero", segment: "viewport", action: "confirm" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, updated: 1 });

    const manifest = await readManifest(dataDir);
    const hero = manifest.records["n-hero"]!;
    expect(hero.path).toEqual([{ label: "new-name", provenance: "elicited", source: "user" }]);
    expect(hero.coordinates.viewport!.confirmed).toBe(true);
    expect(hero.address).toBe("new-name@desktop");
  });

  it("within one batch, an override that elicits a segment makes a LATER confirm of that same segment fail", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: {
        confirmations: [
          { durableId: "n-hero", segment: "viewport", action: "override", value: "tablet" },
          { durableId: "n-hero", segment: "viewport", action: "confirm" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true; updated: number; errors: string[] };
    expect(body.updated).toBe(1); // the override still landed
    expect(body.errors).toEqual([expect.stringContaining("elicited")]);

    const manifest = await readManifest(dataDir);
    const viewport = manifest.records["n-hero"]!.coordinates.viewport!;
    expect(viewport).toEqual({ value: "tablet", provenance: "elicited", source: "user" });
    expect(viewport.confirmed).toBeUndefined();
  });

  it("response omits `errors` entirely when nothing failed", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: { confirmations: [{ durableId: "n-hero", segment: "label", action: "confirm" }] },
    });
    const body = res.json() as Record<string, unknown>;
    expect("errors" in body).toBe(false);
  });

  it.each([
    ["missing confirmations key", {}],
    ["null body", null],
    ["confirmations not an array", { confirmations: "nope" }],
    ["entry missing durableId", { confirmations: [{ segment: "label", action: "confirm" }] }],
    ["entry missing segment", { confirmations: [{ durableId: "n-hero", action: "confirm" }] }],
    [
      "entry with invalid segment",
      { confirmations: [{ durableId: "n-hero", segment: "color", action: "confirm" }] },
    ],
    ["entry missing action", { confirmations: [{ durableId: "n-hero", segment: "label" }] }],
    [
      "entry with invalid action",
      { confirmations: [{ durableId: "n-hero", segment: "label", action: "delete" }] },
    ],
    [
      "override missing value",
      { confirmations: [{ durableId: "n-hero", segment: "label", action: "override" }] },
    ],
    [
      "override with empty-string value",
      { confirmations: [{ durableId: "n-hero", segment: "label", action: "override", value: "" }] },
    ],
    [
      "value wrong type",
      { confirmations: [{ durableId: "n-hero", segment: "label", action: "override", value: 42 }] },
    ],
  ])("POST with malformed body (%s) replies 400 and persists nothing", async (_label, payload) => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);
    const before = await readManifest(dataDir);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/confirm",
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { errors: string[] };
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);

    const after = await readManifest(dataDir);
    expect(after).toEqual(before);
  });
});

// ─── POST /project/identity/applied ────────────────────────────────────────
// Task 14, Phase 4: stamps `appliedAddress`/`appliedAt` on a manifest record
// after the plugin main thread has confirmed writing the corresponding
// canvas rename — the panel calls this AFTER the bus round-trip acks
// (identity-apply → identity-applied), never before.

describe("POST /project/identity/applied", () => {
  it("stamps appliedAddress and a fresh ISO appliedAt on the targeted record", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);
    const before = new Date();

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/applied",
      payload: { applied: [{ durableId: "n-hero", appliedAddress: "hero@desktop" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, stamped: 1 });

    const manifest = await readManifest(dataDir);
    const hero = manifest.records["n-hero"]!;
    expect(hero.appliedAddress).toBe("hero@desktop");
    expect(hero.appliedAt).toBeDefined();
    expect(new Date(hero.appliedAt!).getTime()).toBeGreaterThanOrEqual(before.getTime());

    // Nothing else about the record changed.
    expect(hero.address).toBe("hero@desktop");
    expect(hero.path).toEqual([{ label: "hero", provenance: "inferred", source: "prior-name" }]);
  });

  it("stamps multiple records from one batch", async () => {
    await writeManifest(dataDir, [
      confirmFixtureRecord("n-hero", "hero"),
      confirmFixtureRecord("n-footer", "footer"),
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/applied",
      payload: {
        applied: [
          { durableId: "n-hero", appliedAddress: "hero@desktop" },
          { durableId: "n-footer", appliedAddress: "footer@desktop" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, stamped: 2 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-hero"]!.appliedAddress).toBe("hero@desktop");
    expect(manifest.records["n-footer"]!.appliedAddress).toBe("footer@desktop");
  });

  it("re-stamping an already-applied record overwrites the prior appliedAddress/appliedAt", async () => {
    const rec = confirmFixtureRecord("n-hero", "hero");
    rec.appliedAddress = "old-hero@desktop";
    rec.appliedAt = "2020-01-01T00:00:00.000Z";
    await writeManifest(dataDir, [rec]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/applied",
      payload: { applied: [{ durableId: "n-hero", appliedAddress: "hero@desktop" }] },
    });
    expect(res.json()).toEqual({ ok: true, stamped: 1 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-hero"]!.appliedAddress).toBe("hero@desktop");
    expect(manifest.records["n-hero"]!.appliedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("a durableId absent from the manifest is skipped (not counted, no error) — atomic-ish per record", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/applied",
      payload: {
        applied: [
          { durableId: "n-ghost", appliedAddress: "ghost@desktop" },
          { durableId: "n-hero", appliedAddress: "hero@desktop" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, stamped: 1 });

    const manifest = await readManifest(dataDir);
    expect(manifest.records["n-hero"]!.appliedAddress).toBe("hero@desktop");
    expect(Object.keys(manifest.records)).toEqual(["n-hero"]); // no ghost record created
  });

  it("an empty applied[] batch is a no-op — replies { ok: true, stamped: 0 }", async () => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);
    const before = await readManifest(dataDir);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/applied",
      payload: { applied: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, stamped: 0 });

    const after = await readManifest(dataDir);
    expect(after).toEqual(before);
  });

  it.each([
    ["missing applied key", {}],
    ["null body", null],
    ["applied not an array", { applied: "nope" }],
    ["entry missing durableId", { applied: [{ appliedAddress: "hero@desktop" }] }],
    ["entry missing appliedAddress", { applied: [{ durableId: "n-hero" }] }],
    ["entry with non-string durableId", { applied: [{ durableId: 1, appliedAddress: "hero@desktop" }] }],
    ["entry with non-string appliedAddress", { applied: [{ durableId: "n-hero", appliedAddress: 1 }] }],
    ["entry with empty-string durableId", { applied: [{ durableId: "", appliedAddress: "hero@desktop" }] }],
    ["entry with empty-string appliedAddress", { applied: [{ durableId: "n-hero", appliedAddress: "" }] }],
  ])("POST with malformed body (%s) replies 400 and persists nothing", async (_label, payload) => {
    await writeManifest(dataDir, [confirmFixtureRecord("n-hero", "hero")]);
    const before = await readManifest(dataDir);

    const res = await app.inject({
      method: "POST",
      url: "/project/identity/applied",
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { errors: string[] };
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);

    const after = await readManifest(dataDir);
    expect(after).toEqual(before);
  });
});

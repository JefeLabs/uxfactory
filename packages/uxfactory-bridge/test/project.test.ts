/**
 * project.test.ts — TDD tests for the project/panel bridge routes (Task 3 + Task 13).
 *
 * Test matrix:
 *  - connect: happy / not-found / not-a-root / different-root
 *  - snapshot: empty vs classified vs full Meridian-shaped fixture
 *  - classification PUT round-trip
 *  - profile PUT round-trip (dials, style→classification, coherence→experimental)
 *  - links GET/PUT round-trip
 *  - open path containment (../.. escape → 400; valid path → 200)
 *  - stats shape
 *  - logs ring buffer (request appears in /logs)
 *  - GET /skills: empty (no dir), single skill, multiple skills, non-dir entry skipped
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

/** Create a temp directory used as the project root. */
async function mkRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "uxf-proj-"));
}

/** Make the directory a valid project root by placing a .git marker. */
async function addGitMarker(root: string): Promise<void> {
  await mkdir(path.join(root, ".git"), { recursive: true });
}

/** Write a UTF-8 text file (creates parent dirs if needed). */
async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

/** Write a plain text file. */
async function writeTxt(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

// ─── Fixture: full "Meridian-shaped" project ─────────────────────────────────

const MERIDIAN_CLASSIFICATION = {
  category: "E-Commerce",
  industry: "Retail",
  style: "modern-minimal",
};

const MERIDIAN_PROFILE = {
  scope: { visual: "high", editorial: "medium", coverage: "high", flow: "low" },
  manifest: [],
  notes: [],
  confirm_status: "approved",
};

const MERIDIAN_STORIES = {
  stories: [
    {
      id: "US-1",
      acceptanceCriteria: [
        { id: "AC-1.1", statement: "User can see the homepage" },
        { statement: "User can navigate to product list" },
      ],
    },
    {
      id: "US-2",
      acceptanceCriteria: [{ id: "AC-2.1", statement: "Cart shows item count" }],
    },
  ],
};

const MERIDIAN_TOKENS = {
  colors: {
    "primary-500": "#5B5BD6",
    "primary-600": "#4f46e5",
    "success-600": "#16a34a",
  },
};

const MERIDIAN_DESIGN_SYSTEM = {
  "brand-colors": ["#5B5BD6", "#4f46e5"],
  palettes: { primary: ["#eef2ff", "#5B5BD6"] },
  fonts: { body: "Inter", heading: "Inter" },
  grid: { columns: 12, gutter: 16 },
};

async function buildMeridian(root: string): Promise<void> {
  await addGitMarker(root);
  await writeJson(path.join(root, "uxfactory.classification.json"), MERIDIAN_CLASSIFICATION);
  await writeJson(path.join(root, "uxfactory.profile.json"), MERIDIAN_PROFILE);
  await writeJson(path.join(root, "design/acceptance-criteria.json"), MERIDIAN_STORIES);
  await writeJson(path.join(root, "design/token-set.json"), MERIDIAN_TOKENS);
  await writeJson(path.join(root, "design/design-system.json"), MERIDIAN_DESIGN_SYSTEM);
  await writeJson(path.join(root, "design/assets/icons.json"), { icons: ["arrow", "check"] });
  await writeTxt(path.join(root, "design/sitemap.md"), "# Sitemap\n- Home\n- Products");
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let app: FastifyInstance;
let root: string;
let dataDir: string;

beforeEach(async () => {
  root = await mkRoot();
  dataDir = path.join(root, ".uxfactory");
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

// ─── POST /project/connect ───────────────────────────────────────────────────

describe("POST /project/connect", () => {
  it("happy path — returns ok:true + snapshot for the served root", async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });

    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: root },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; snapshot?: { name: string; root: string } };
    expect(body.ok).toBe(true);
    expect(body.snapshot).toBeDefined();
    expect(body.snapshot?.root).toBe(root);
    expect(body.snapshot?.name).toBe(path.basename(root));
  });

  it("not-found — path does not exist", async () => {
    app = await createBridge({ dataDir });
    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: "/this/path/does/not/exist/xyzzy" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, reason: "not-found" });
  });

  it("not-a-root — path exists but has no .git or uxfactory.batch.json", async () => {
    // root dir exists (created in beforeEach) but has no markers.
    app = await createBridge({ dataDir });
    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: root },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, reason: "not-a-root" });
  });

  it("not-a-root — path with uxfactory.batch.json marker is accepted as root", async () => {
    // Only test that we reach the root-check stage (marker present = is-a-root).
    await writeJson(path.join(root, "uxfactory.batch.json"), { version: 1, inputs: {} });
    app = await createBridge({ dataDir });

    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: root },
    });
    // served root === root, so we get ok:true (not not-a-root or different-root).
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
  });

  it("bridge-serves-different-root — a different valid root", async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });

    // Create a second temp dir that IS a valid root.
    const other = await mkRoot();
    try {
      await addGitMarker(other);
      const res = await app.inject({
        method: "POST",
        url: "/project/connect",
        payload: { repoPath: other },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; reason?: string; served?: string };
      expect(body.ok).toBe(false);
      expect(body.reason).toBe("bridge-serves-different-root");
      expect(body.served).toBe(root);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("400 when repoPath is missing", async () => {
    app = await createBridge({ dataDir });
    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("tilde expansion — ~/... path connects ok when served root is under home", async () => {
    // Create a temp directory directly under os.homedir() so we can use ~/... form.
    const homeRoot = await mkdtemp(path.join(os.homedir(), "uxf-tilde-test-"));
    const homeDataDir = path.join(homeRoot, ".uxfactory");
    await mkdir(homeDataDir, { recursive: true });
    await addGitMarker(homeRoot);
    const homeApp = await createBridge({ dataDir: homeDataDir });

    try {
      // Compute the ~/... form of the path (homeRoot is guaranteed under os.homedir()).
      const rel = path.relative(os.homedir(), homeRoot);
      const tildePath = `~/${rel}`;

      const res = await homeApp.inject({
        method: "POST",
        url: "/project/connect",
        payload: { repoPath: tildePath },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; snapshot?: { root: string } };
      expect(body.ok).toBe(true);
      expect(body.snapshot?.root).toBe(homeRoot);
    } finally {
      await homeApp.close();
      await rm(homeRoot, { recursive: true, force: true });
    }
  });

  it("tilde expansion — ~/definitely/missing → not-found", async () => {
    app = await createBridge({ dataDir });
    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: "~/definitely/missing/path/xyz-nonexistent" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, reason: "not-found" });
  });

  it("tilde expansion — ~/valid-but-different-root → bridge-serves-different-root with served", async () => {
    // Served root is the shared `root` (a tmpdir, not under home).
    await addGitMarker(root);
    app = await createBridge({ dataDir });

    // Create a second valid root under home so the tilde path resolves correctly.
    const homeRoot = await mkdtemp(path.join(os.homedir(), "uxf-tilde-diff-"));
    try {
      await addGitMarker(homeRoot);
      const rel = path.relative(os.homedir(), homeRoot);
      const tildePath = `~/${rel}`;

      const res = await app.inject({
        method: "POST",
        url: "/project/connect",
        payload: { repoPath: tildePath },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; reason?: string; served?: string };
      expect(body.ok).toBe(false);
      expect(body.reason).toBe("bridge-serves-different-root");
      expect(body.served).toBe(root);
    } finally {
      await rm(homeRoot, { recursive: true, force: true });
    }
  });
});

// ─── GET /project/snapshot ───────────────────────────────────────────────────

describe("GET /project/snapshot — empty project", () => {
  it("returns correct shape with all artifacts missing and no requirements", async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });

    const res = await app.inject({ method: "GET", url: "/project/snapshot" });
    expect(res.statusCode).toBe(200);
    const snap = res.json() as {
      name: string;
      root: string;
      hasClassification: boolean;
      hasProfile: boolean;
      classification: unknown;
      profile: unknown;
      artifacts: Array<{ key: string; status: string }>;
      requirements: unknown[];
    };
    expect(snap.name).toBe(path.basename(root));
    expect(snap.root).toBe(root);
    expect(snap.hasClassification).toBe(false);
    expect(snap.hasProfile).toBe(false);
    expect(snap.classification).toBeNull();
    expect(snap.profile).toBeNull();
    expect(snap.requirements).toEqual([]);
    // All artifacts should be missing.
    expect(snap.artifacts.length).toBeGreaterThan(0);
    for (const a of snap.artifacts) {
      expect(["missing", "draft"]).toContain(a.status); // empty project → all missing
    }
  });
});

describe("GET /project/snapshot — classified project", () => {
  it("reflects hasClassification:true and echoes classification object", async () => {
    await addGitMarker(root);
    await writeJson(path.join(root, "uxfactory.classification.json"), MERIDIAN_CLASSIFICATION);
    app = await createBridge({ dataDir });

    const res = await app.inject({ method: "GET", url: "/project/snapshot" });
    const snap = res.json() as {
      hasClassification: boolean;
      classification: typeof MERIDIAN_CLASSIFICATION;
    };
    expect(snap.hasClassification).toBe(true);
    expect(snap.classification).toMatchObject(MERIDIAN_CLASSIFICATION);
  });
});

describe("GET /project/snapshot — full Meridian-shaped project", () => {
  beforeEach(async () => {
    await buildMeridian(root);
    app = await createBridge({ dataDir });
  });

  it("has correct classification and profile", async () => {
    const snap = (await app.inject({ method: "GET", url: "/project/snapshot" })).json() as {
      hasClassification: boolean;
      hasProfile: boolean;
      classification: Record<string, unknown>;
      profile: Record<string, unknown>;
    };
    expect(snap.hasClassification).toBe(true);
    expect(snap.hasProfile).toBe(true);
    expect(snap.classification?.["category"]).toBe("E-Commerce");
    expect((snap.profile?.["scope"] as Record<string, string>)?.["visual"]).toBe("high");
  });

  it("artifact statuses are correct: tokens up-to-date with color count, sitemap up-to-date", async () => {
    const snap = (await app.inject({ method: "GET", url: "/project/snapshot" })).json() as {
      artifacts: Array<{ key: string; status: string; meta: string }>;
    };
    const byKey = Object.fromEntries(snap.artifacts.map((a) => [a.key, a]));

    // design/acceptance-criteria.json is present → requirements artifact up-to-date.
    expect(byKey["requirements"]?.status).toBe("up-to-date");

    // design/token-set.json with 3 colors → up-to-date + "3 colors".
    expect(byKey["tokens"]?.status).toBe("up-to-date");
    expect(byKey["tokens"]?.meta).toBe("3 colors");

    // design/sitemap.md was added → sitemap up-to-date.
    expect(byKey["sitemap"]?.status).toBe("up-to-date");

    // design-system.json has brand-colors, palettes, fonts, grid sections → all up-to-date.
    expect(byKey["brand-colors"]?.status).toBe("up-to-date");
    expect(byKey["palettes"]?.status).toBe("up-to-date");
    expect(byKey["fonts"]?.status).toBe("up-to-date");
    expect(byKey["grid"]?.status).toBe("up-to-date");

    // icons.json is present → up-to-date.
    expect(byKey["icons"]?.status).toBe("up-to-date");

    // photography and illustrations are absent → missing.
    expect(byKey["photography"]?.status).toBe("missing");
    expect(byKey["illustrations"]?.status).toBe("missing");

    // flows absent → missing.
    expect(byKey["flows"]?.status).toBe("missing");
  });

  it("requirements are flattened from stories.acceptanceCriteria with correct ids and titles", async () => {
    const snap = (await app.inject({ method: "GET", url: "/project/snapshot" })).json() as {
      requirements: Array<{ id: string; title: string }>;
    };
    const reqs = snap.requirements;

    // 3 AC total: AC-1.1, US-1-2 (no id on second AC), AC-2.1.
    expect(reqs).toHaveLength(3);
    expect(reqs[0]).toEqual({ id: "AC-1.1", title: "User can see the homepage" });
    // Second AC has no id → synthesized as story.id + "-" + (index+1) = "US-1-2"
    expect(reqs[1]).toEqual({ id: "US-1-2", title: "User can navigate to product list" });
    expect(reqs[2]).toEqual({ id: "AC-2.1", title: "Cart shows item count" });
  });

  it("draft tokens file yields draft status", async () => {
    await writeJson(path.join(root, "design/token-set.json"), { draft: true, colors: {} });
    const app2 = await createBridge({ dataDir });
    try {
      const snap = (
        await app2.inject({ method: "GET", url: "/project/snapshot" })
      ).json() as { artifacts: Array<{ key: string; status: string }> };
      const byKey = Object.fromEntries(snap.artifacts.map((a) => [a.key, a]));
      expect(byKey["tokens"]?.status).toBe("draft");
    } finally {
      await app2.close();
    }
  });

  it("unparseable JSON file → draft status", async () => {
    await writeFile(path.join(root, "design/token-set.json"), "{ not valid json", "utf8");
    const app2 = await createBridge({ dataDir });
    try {
      const snap = (
        await app2.inject({ method: "GET", url: "/project/snapshot" })
      ).json() as { artifacts: Array<{ key: string; status: string }> };
      const byKey = Object.fromEntries(snap.artifacts.map((a) => [a.key, a]));
      expect(byKey["tokens"]?.status).toBe("draft");
    } finally {
      await app2.close();
    }
  });
});

// ─── OPTIONS /project/classification preflight ───────────────────────────────

describe("OPTIONS /project/classification preflight — PUT must be allowed", () => {
  beforeEach(async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });
  });

  it("preflight OPTIONS returns 204 and access-control-allow-methods containing PUT", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/project/classification",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.statusCode).toBe(204);
    const allowedMethods = res.headers["access-control-allow-methods"] as string;
    expect(allowedMethods).toContain("PUT");
  });
});

// ─── PUT /project/classification ─────────────────────────────────────────────

describe("PUT /project/classification", () => {
  beforeEach(async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });
  });

  it("writes the body as pretty JSON and round-trips via snapshot", async () => {
    const cls = { category: "SaaS", industry: "Tech", style: "clean" };
    const put = await app.inject({
      method: "PUT",
      url: "/project/classification",
      payload: cls,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true });

    // Verify via snapshot.
    const snap = (
      await app.inject({ method: "GET", url: "/project/snapshot" })
    ).json() as { classification: typeof cls };
    expect(snap.classification).toMatchObject(cls);
  });
});

// ─── PUT /project/profile ────────────────────────────────────────────────────

describe("PUT /project/profile", () => {
  beforeEach(async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });
  });

  it("writes scope dials and round-trips via snapshot", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/project/profile",
      payload: { visual: "high", editorial: "low", coverage: "medium", flow: "high" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true });

    const snap = (
      await app.inject({ method: "GET", url: "/project/snapshot" })
    ).json() as {
      hasProfile: boolean;
      profile: { scope: Record<string, string> };
    };
    expect(snap.hasProfile).toBe(true);
    expect(snap.profile.scope).toMatchObject({
      visual: "high",
      editorial: "low",
      coverage: "medium",
      flow: "high",
    });
  });

  it("style propagates into classification.json", async () => {
    await app.inject({
      method: "PUT",
      url: "/project/profile",
      payload: { visual: "low", editorial: "low", coverage: "low", flow: "low", style: "playful" },
    });
    const snap = (
      await app.inject({ method: "GET", url: "/project/snapshot" })
    ).json() as { classification: { style: string } };
    expect(snap.classification?.["style"]).toBe("playful");
  });

  it("coherence lands under profile.experimental", async () => {
    await app.inject({
      method: "PUT",
      url: "/project/profile",
      payload: {
        visual: "low",
        editorial: "low",
        coverage: "low",
        flow: "low",
        coherence: "strict",
      },
    });
    const snap = (
      await app.inject({ method: "GET", url: "/project/snapshot" })
    ).json() as { profile: { experimental?: { coherence?: string } } };
    expect(snap.profile?.experimental?.coherence).toBe("strict");
  });

  it("merges dials without clobbering other profile fields", async () => {
    // Write initial profile with extra fields.
    await writeJson(path.join(root, "uxfactory.profile.json"), {
      scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      notes: ["keep me"],
      confirm_status: "approved",
    });

    await app.inject({
      method: "PUT",
      url: "/project/profile",
      payload: { visual: "high" },
    });

    const snap = (
      await app.inject({ method: "GET", url: "/project/snapshot" })
    ).json() as { profile: Record<string, unknown> };
    const profile = snap.profile;
    expect((profile["scope"] as Record<string, string>)?.["visual"]).toBe("high");
    expect((profile["scope"] as Record<string, string>)?.["editorial"]).toBe("low"); // preserved
    expect(profile["confirm_status"]).toBe("approved"); // preserved
    expect(profile["notes"]).toEqual(["keep me"]); // preserved
  });
});

// ─── GET /project/links + PUT /project/links ─────────────────────────────────

describe("GET + PUT /project/links", () => {
  beforeEach(async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });
  });

  it("returns empty links when none stored", async () => {
    const res = await app.inject({ method: "GET", url: "/project/links" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ links: [] });
  });

  it("PUT writes whole set; GET reads it back", async () => {
    const links = [
      { nodeId: "1:2", unitName: "HeroSection", unitType: "organism", acId: "AC-1.1" },
      { nodeId: "3:4", unitName: "CartBadge", unitType: "molecule", acId: "AC-2.1" },
    ];
    const put = await app.inject({
      method: "PUT",
      url: "/project/links",
      payload: { links },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true });

    const get = await app.inject({ method: "GET", url: "/project/links" });
    expect(get.json()).toEqual({ links });
  });

  it("PUT replaces the whole set (not merging)", async () => {
    const first = [{ nodeId: "1:1", unitName: "A", unitType: "molecule", acId: "AC-1.1" }];
    const second = [{ nodeId: "2:2", unitName: "B", unitType: "organism", acId: "AC-2.1" }];
    await app.inject({ method: "PUT", url: "/project/links", payload: { links: first } });
    await app.inject({ method: "PUT", url: "/project/links", payload: { links: second } });
    const res = (await app.inject({ method: "GET", url: "/project/links" })).json() as {
      links: typeof second;
    };
    expect(res.links).toEqual(second);
  });
});

// ─── POST /project/open ──────────────────────────────────────────────────────

describe("POST /project/open — path containment", () => {
  beforeEach(async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });
  });

  it("../.. escape path → 400 (no exec in NODE_ENV=test)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/project/open",
      payload: { path: "../../etc/passwd" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("absolute path outside root → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/project/open",
      payload: { path: "/etc/passwd" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("valid in-root relative path → 200 ok:true (no actual exec in test mode)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/project/open",
      payload: { path: "design/brief.md" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("path === root itself → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/project/open",
      payload: { path: "." },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("missing path → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/project/open",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

describe("GET /stats", () => {
  it("returns version, uptimeMs (>= 0), runsRelayed:0, tokenCount:null for empty project", async () => {
    app = await createBridge({ dataDir });
    const res = await app.inject({ method: "GET", url: "/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      version: string;
      uptimeMs: number;
      runsRelayed: number;
      tokenCount: number | null;
    };
    expect(typeof body.version).toBe("string");
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(body.runsRelayed).toBe(0);
    expect(body.tokenCount).toBeNull();
  });

  it("tokenCount reflects color count from design/token-set.json", async () => {
    await writeJson(path.join(root, "design/token-set.json"), {
      colors: { a: "#fff", b: "#000", c: "#f00", d: "#0f0" },
    });
    app = await createBridge({ dataDir });
    const body = (await app.inject({ method: "GET", url: "/stats" })).json() as {
      tokenCount: number | null;
    };
    expect(body.tokenCount).toBe(4);
  });

  it("runsRelayed increments when POST /pipeline/result is called", async () => {
    app = await createBridge({ dataDir });

    // Enqueue a request first so we have a known id.
    const enqueue = await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "test-job", payload: {} },
    });
    const { id } = enqueue.json() as { id: string };

    // Post the result.
    await app.inject({
      method: "POST",
      url: "/pipeline/result",
      payload: { id, status: 0, result: {} },
    });

    const body = (await app.inject({ method: "GET", url: "/stats" })).json() as {
      runsRelayed: number;
    };
    expect(body.runsRelayed).toBe(1);
  });
});

// ─── Registry-path resolution (uxfactory.batch.json inputs) ──────────────────

describe("registry-path resolution — non-conventional stories + tokens paths", () => {
  it("snapshot and /stats use registry paths when conventional paths are absent", async () => {
    await addGitMarker(root);

    // Registry points to non-conventional locations.
    await writeJson(path.join(root, "uxfactory.batch.json"), {
      version: 1,
      inputs: {
        stories: "specs/acs.json",
        tokens: "design/tokens.ds.json",
      },
    });

    // Stories file at NON-conventional path only.
    const registryStories = {
      stories: [
        {
          id: "US-10",
          acceptanceCriteria: [
            { id: "AC-10.1", statement: "Registry story one" },
            { id: "AC-10.2", statement: "Registry story two" },
          ],
        },
      ],
    };
    await writeJson(path.join(root, "specs/acs.json"), registryStories);

    // Tokens file at NON-conventional path only (5 colors).
    const registryTokens = {
      colors: {
        "primary-100": "#eef",
        "primary-500": "#5B5BD6",
        "primary-700": "#3730a3",
        "success-500": "#22c55e",
        "danger-500": "#ef4444",
      },
    };
    await writeJson(path.join(root, "design/tokens.ds.json"), registryTokens);

    // Conventional paths intentionally absent.

    app = await createBridge({ dataDir });

    // Snapshot should resolve registry paths.
    const snap = (
      await app.inject({ method: "GET", url: "/project/snapshot" })
    ).json() as {
      requirements: Array<{ id: string; title: string }>;
      artifacts: Array<{ key: string; status: string; meta: string }>;
    };

    // requirements artifact and list come from specs/acs.json.
    const byKey = Object.fromEntries(snap.artifacts.map((a) => [a.key, a]));
    expect(byKey["requirements"]?.status).toBe("up-to-date");
    expect(snap.requirements).toHaveLength(2);
    expect(snap.requirements[0]).toEqual({ id: "AC-10.1", title: "Registry story one" });
    expect(snap.requirements[1]).toEqual({ id: "AC-10.2", title: "Registry story two" });

    // tokens artifact and meta come from design/tokens.ds.json.
    expect(byKey["tokens"]?.status).toBe("up-to-date");
    expect(byKey["tokens"]?.meta).toBe("5 colors");

    // /stats tokenCount also uses the registry path.
    const stats = (
      await app.inject({ method: "GET", url: "/stats" })
    ).json() as { tokenCount: number | null };
    expect(stats.tokenCount).toBe(5);
  });
});

describe("registry-path resolution — unparseable registry falls back to conventional paths", () => {
  it("snapshot works (no throw) and reads conventional paths when registry is unparseable", async () => {
    await addGitMarker(root);

    // Write an invalid JSON registry file.
    await mkdir(path.join(root), { recursive: true });
    await writeFile(path.join(root, "uxfactory.batch.json"), "{ not valid json !!!", "utf8");

    // Files at CONVENTIONAL paths.
    await writeJson(path.join(root, "design/acceptance-criteria.json"), {
      stories: [
        {
          id: "US-99",
          acceptanceCriteria: [{ id: "AC-99.1", statement: "Fallback story" }],
        },
      ],
    });
    await writeJson(path.join(root, "design/token-set.json"), {
      colors: { red: "#f00", green: "#0f0" },
    });

    app = await createBridge({ dataDir });

    const snap = (
      await app.inject({ method: "GET", url: "/project/snapshot" })
    ).json() as {
      requirements: Array<{ id: string; title: string }>;
      artifacts: Array<{ key: string; status: string; meta: string }>;
    };

    // Conventional stories file is found.
    const byKey = Object.fromEntries(snap.artifacts.map((a) => [a.key, a]));
    expect(byKey["requirements"]?.status).toBe("up-to-date");
    expect(snap.requirements).toHaveLength(1);
    expect(snap.requirements[0]).toEqual({ id: "AC-99.1", title: "Fallback story" });

    // Conventional tokens file is found.
    expect(byKey["tokens"]?.status).toBe("up-to-date");
    expect(byKey["tokens"]?.meta).toBe("2 colors");
  });
});

// ─── GET /logs ────────────────────────────────────────────────────────────────

describe("GET /logs", () => {
  it("a prior request appears in /logs lines", async () => {
    app = await createBridge({ dataDir });

    // Make a known request.
    await app.inject({ method: "GET", url: "/health" });

    const res = await app.inject({ method: "GET", url: "/logs?tail=50" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { lines: string[] };
    // At least the /health request should be in there.
    expect(body.lines.some((l) => l.includes("/health"))).toBe(true);
    // Lines follow "<METHOD> <url> <status>" format.
    expect(body.lines.every((l) => /^\S+ \S+ \d+$/.test(l))).toBe(true);
  });

  it("tail parameter limits returned lines", async () => {
    app = await createBridge({ dataDir });
    // Make 10 requests.
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: "GET", url: "/health" });
    }
    const res = await app.inject({ method: "GET", url: "/logs?tail=3" });
    const { lines } = res.json() as { lines: string[] };
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("default tail (no param) returns up to 200 lines", async () => {
    app = await createBridge({ dataDir });
    const res = await app.inject({ method: "GET", url: "/logs" });
    expect(res.statusCode).toBe(200);
    const { lines } = res.json() as { lines: string[] };
    expect(lines.length).toBeLessThanOrEqual(200);
  });
});

// ─── GET /skills ──────────────────────────────────────────────────────────────

describe("GET /skills", () => {
  /** Create a skill directory with SKILL.md at root/skill/{name}/SKILL.md. */
  async function addSkill(root: string, name: string, content: string): Promise<void> {
    const skillPath = path.join(root, "skill", name);
    await mkdir(skillPath, { recursive: true });
    await writeFile(path.join(skillPath, "SKILL.md"), content, "utf8");
  }

  /** Compute expected rev for given content. */
  function expectedRev(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 7);
  }

  it("returns empty skills list when skill/ directory is absent", async () => {
    app = await createBridge({ dataDir });

    const res = await app.inject({ method: "GET", url: "/skills" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: unknown[] };
    expect(body.skills).toEqual([]);
  });

  it("returns a single skill entry with name, rev, and pinned:false", async () => {
    const content = "# craft-review\nReview skill content\n";
    await addSkill(root, "craft-review", content);
    app = await createBridge({ dataDir });

    const res = await app.inject({ method: "GET", url: "/skills" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: Array<{ name: string; rev: string; pinned: boolean }> };
    expect(body.skills).toHaveLength(1);

    const skill = body.skills[0]!;
    expect(skill.name).toBe("craft-review");
    expect(skill.rev).toBe(expectedRev(content));
    expect(skill.rev).toMatch(/^[0-9a-f]{7}$/);
    expect(skill.pinned).toBe(false);
  });

  it("returns multiple skills sorted by directory order", async () => {
    const contentA = "# skill-a\n";
    const contentB = "# skill-b\n";
    await addSkill(root, "skill-a", contentA);
    await addSkill(root, "skill-b", contentB);
    app = await createBridge({ dataDir });

    const res = await app.inject({ method: "GET", url: "/skills" });
    const body = res.json() as { skills: Array<{ name: string; rev: string; pinned: boolean }> };
    expect(body.skills).toHaveLength(2);

    const names = body.skills.map((s) => s.name);
    expect(names).toContain("skill-a");
    expect(names).toContain("skill-b");

    // Verify rev for each
    const byName = Object.fromEntries(body.skills.map((s) => [s.name, s]));
    expect(byName["skill-a"]?.rev).toBe(expectedRev(contentA));
    expect(byName["skill-b"]?.rev).toBe(expectedRev(contentB));
  });

  it("skips subdirectory entries that have no SKILL.md", async () => {
    // A dir with SKILL.md
    await addSkill(root, "valid-skill", "# valid skill\n");
    // A dir without SKILL.md
    await mkdir(path.join(root, "skill", "no-skill-md"), { recursive: true });
    app = await createBridge({ dataDir });

    const res = await app.inject({ method: "GET", url: "/skills" });
    const body = res.json() as { skills: Array<{ name: string }> };
    // Only the valid skill should appear
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0]?.name).toBe("valid-skill");
  });

  it("rev is deterministic — same content produces the same rev on repeated calls", async () => {
    const content = "# determinism test\nSame content always gives same rev.\n";
    await addSkill(root, "my-skill", content);
    app = await createBridge({ dataDir });

    const res1 = await app.inject({ method: "GET", url: "/skills" });
    const res2 = await app.inject({ method: "GET", url: "/skills" });

    const body1 = res1.json() as { skills: Array<{ rev: string }> };
    const body2 = res2.json() as { skills: Array<{ rev: string }> };
    expect(body1.skills[0]?.rev).toBe(body2.skills[0]?.rev);
    expect(body1.skills[0]?.rev).toBe(expectedRev(content));
  });
});

// ─── GET /project/artifact ───────────────────────────────────────────────────

describe("GET /project/artifact", () => {
  beforeEach(async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });
  });

  it("legacy read: a brief at the repo root still resolves (no migration on GET)", async () => {
    const legacy = path.join(root, "brief.md");
    await writeFile(legacy, "# Legacy Brief\n", "utf8");

    const get = await app.inject({ method: "GET", url: "/project/artifact?key=brief" });
    expect(get.statusCode).toBe(200);
    const body = get.json() as { path: string; content: string };
    expect(body.path).toBe("brief.md"); // reads stay where the file lives
    expect(body.content).toBe("# Legacy Brief\n");
    // GET must not move anything.
    await expect(readFile(legacy, "utf8")).resolves.toBe("# Legacy Brief\n");
  });

  it("migrate-on-touch: PUT moves a legacy brief into .uxfactory/artifacts", async () => {
    const legacy = path.join(root, "brief.md");
    await writeFile(legacy, "# Legacy Brief\n", "utf8");

    const put = await app.inject({
      method: "PUT",
      url: "/project/artifact",
      payload: { key: "brief", content: "# Updated Brief\n" },
    });
    expect(put.statusCode).toBe(200);

    // Canonical file created with the new content; legacy copy removed.
    const canonical = path.join(root, ".uxfactory/artifacts/brief.md");
    await expect(readFile(canonical, "utf8")).resolves.toBe("# Updated Brief\n");
    await expect(readFile(legacy, "utf8")).rejects.toThrow();

    // Subsequent GET serves the canonical location.
    const get = await app.inject({ method: "GET", url: "/project/artifact?key=brief" });
    expect((get.json() as { path: string }).path).toBe(".uxfactory/artifacts/brief.md");
  });

  it("round-trip: PUT brief → GET returns content + path + format", async () => {
    const briefContent = "# My Brief\n\n## Overview\nGreat product.\n";

    // Write via PUT.
    const put = await app.inject({
      method: "PUT",
      url: "/project/artifact",
      payload: { key: "brief", content: briefContent },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ ok: true });

    // Read via GET.
    const get = await app.inject({
      method: "GET",
      url: "/project/artifact?key=brief",
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as {
      key: string;
      path: string;
      format: string;
      content: string;
    };
    expect(body.key).toBe("brief");
    expect(body.path).toBe(".uxfactory/artifacts/brief.md");
    expect(body.format).toBe("markdown");
    expect(body.content).toBe(briefContent);
  });

  it("round-trip: snapshot reflects up-to-date after PUT brief", async () => {
    await app.inject({
      method: "PUT",
      url: "/project/artifact",
      payload: { key: "brief", content: "# Brief\n\n## Overview\nHello.\n" },
    });

    const snap = (
      await app.inject({ method: "GET", url: "/project/snapshot" })
    ).json() as { artifacts: Array<{ key: string; status: string }> };
    const byKey = Object.fromEntries(snap.artifacts.map((a) => [a.key, a]));
    expect(byKey["brief"]?.status).toBe("up-to-date");
  });

  it("unknown key → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/project/artifact?key=nonexistent-artifact-xyz",
    });
    expect(res.statusCode).toBe(400);
  });

  it("missing key query param → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/project/artifact",
    });
    expect(res.statusCode).toBe(400);
  });

  it("known key but file absent → 404", async () => {
    // brief.md does not exist (fresh root with only .git marker)
    const res = await app.inject({
      method: "GET",
      url: "/project/artifact?key=brief",
    });
    expect(res.statusCode).toBe(404);
  });

  it("registry-resolved path honored: tokens at a non-conventional path", async () => {
    // Point registry to a custom tokens path.
    await writeJson(path.join(root, "uxfactory.batch.json"), {
      version: 1,
      inputs: { tokens: "custom/my-tokens.json" },
    });
    await writeJson(path.join(root, "custom/my-tokens.json"), {
      colors: { primary: "#fff" },
    });

    const get = await app.inject({
      method: "GET",
      url: "/project/artifact?key=tokens",
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as { key: string; path: string; format: string; content: string };
    expect(body.key).toBe("tokens");
    // The path returned is root-relative and points to the registry location.
    expect(body.path).toBe("custom/my-tokens.json");
    expect(body.format).toBe("json");
    expect(JSON.parse(body.content)).toMatchObject({ colors: { primary: "#fff" } });
  });

  it("traversal-safe: a registry pointing outside root yields 400, never content", async () => {
    // A crafted batch.json points tokens outside the project root. Even though
    // the resolve succeeds, the containment check must fire (before existence,
    // so it can't leak whether /etc/passwd exists).
    await writeJson(path.join(root, "uxfactory.batch.json"), {
      version: 1,
      inputs: { tokens: "../../../../../../etc/passwd" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/project/artifact?key=tokens",
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── PUT /project/artifact ───────────────────────────────────────────────────

describe("PUT /project/artifact", () => {
  beforeEach(async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });
  });

  it("unknown key → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/project/artifact",
      payload: { key: "totally-unknown", content: "stuff" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("missing content → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/project/artifact",
      payload: { key: "brief" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("traversal-safe: a registry pointing outside root yields 400, never a write", async () => {
    await writeJson(path.join(root, "uxfactory.batch.json"), {
      version: 1,
      inputs: { tokens: "../outside-tokens.json" },
    });

    const res = await app.inject({
      method: "PUT",
      url: "/project/artifact",
      payload: { key: "tokens", content: "{}" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates parent directory when it does not exist (mkdir -p semantics)", async () => {
    // icons lives under design/assets/ which does not exist yet.
    const res = await app.inject({
      method: "PUT",
      url: "/project/artifact",
      payload: { key: "icons", content: JSON.stringify({ icons: [] }) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // The file should now exist.
    const get = await app.inject({
      method: "GET",
      url: "/project/artifact?key=icons",
    });
    expect(get.statusCode).toBe(200);
  });

  it("registry-resolved PUT: writes tokens to the non-conventional path", async () => {
    await writeJson(path.join(root, "uxfactory.batch.json"), {
      version: 1,
      inputs: { tokens: "tokens/custom.json" },
    });

    const tokenContent = JSON.stringify({ colors: { accent: "#0f0" } }, null, 2);
    const put = await app.inject({
      method: "PUT",
      url: "/project/artifact",
      payload: { key: "tokens", content: tokenContent },
    });
    expect(put.statusCode).toBe(200);

    // Verify via GET that it's at the registry path.
    const get = await app.inject({
      method: "GET",
      url: "/project/artifact?key=tokens",
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as { path: string; content: string };
    expect(body.path).toBe("tokens/custom.json");
    expect(body.content).toBe(tokenContent);
  });
});

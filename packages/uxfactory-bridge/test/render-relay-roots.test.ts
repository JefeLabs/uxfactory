/**
 * render-relay-roots.test.ts — root-scoping for the canvas render relay.
 *
 * The plugin's render poll (GET /next) and report exchange (POST/GET /rendered)
 * accept an optional ?root= that scopes them to that root's own .uxfactory
 * queue/reports (where the worker's landing step already drops jobs). Requests
 * WITHOUT ?root= keep the legacy launch-store behavior byte-identically — no
 * re-validation, no wire change.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";
import { BridgeStore } from "../src/store.js";

let app: FastifyInstance;
let dataDir: string;
let rootB: string;

const SPEC = { editor: "figma", edits: [{ id: "1:2", set: { x: 1 } }] };

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-relay-launch-"));
  rootB = await mkdtemp(path.join(os.tmpdir(), "uxf-relay-rootb-"));
  await mkdir(path.join(rootB, ".git"), { recursive: true });
  app = await createBridge({ dataDir });
  const res = await app.inject({
    method: "POST",
    url: "/project/connect",
    payload: { repoPath: rootB },
  });
  expect(res.json().ok).toBe(true);
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
  await rm(rootB, { recursive: true, force: true });
});

describe("GET /next?root=", () => {
  it("serves the root's own queue; the launch queue stays untouched", async () => {
    // The worker's landing step drops jobs into <root>/.uxfactory/queue.
    const seed = new BridgeStore(path.join(rootB, ".uxfactory"));
    await seed.init();
    await seed.enqueue(SPEC, "job_b");

    // Launch-store poll does NOT see root B's job.
    const legacy = await app.inject({ method: "GET", url: "/next" });
    expect(legacy.statusCode).toBe(204);

    // Root-scoped poll dequeues it.
    const scoped = await app.inject({
      method: "GET",
      url: `/next?root=${encodeURIComponent(rootB)}`,
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json()).toMatchObject({ jobId: "job_b", spec: SPEC });

    // Consumed — next scoped poll is 204.
    const drained = await app.inject({
      method: "GET",
      url: `/next?root=${encodeURIComponent(rootB)}`,
    });
    expect(drained.statusCode).toBe(204);
  });

  it("unserved root → 403; vanished root → 410", async () => {
    const stranger = await mkdtemp(path.join(os.tmpdir(), "uxf-relay-stranger-"));
    try {
      const forbidden = await app.inject({
        method: "GET",
        url: `/next?root=${encodeURIComponent(stranger)}`,
      });
      expect(forbidden.statusCode).toBe(403);
    } finally {
      await rm(stranger, { recursive: true, force: true });
    }

    await rm(path.join(rootB, ".git"), { recursive: true, force: true });
    const gone = await app.inject({
      method: "GET",
      url: `/next?root=${encodeURIComponent(rootB)}`,
    });
    expect(gone.statusCode).toBe(410);
  });

  it("legacy no-root poll serves the launch queue unchanged", async () => {
    // The launch dataDir is a bare tmp dir (no .git) — legacy polls must NOT
    // re-validate it; the wire stays exactly as before multi-root.
    const seed = new BridgeStore(dataDir);
    await seed.init();
    await seed.enqueue(SPEC, "job_launch");

    const res = await app.inject({ method: "GET", url: "/next" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ jobId: "job_launch", spec: SPEC });
  });
});

describe("approval queue: /queue list + approve/discard + preview", () => {
  it("GET /queue lists pending jobs non-destructively with frame summaries", async () => {
    const seed = new BridgeStore(path.join(rootB, ".uxfactory"));
    await seed.init();
    await seed.enqueue(
      { editor: "figma", frames: [{ name: "screens/home.html/success@desktop", x: 0, y: 0, width: 1440, height: 900, children: [] }] },
      "job_a",
    );
    await seed.enqueue(SPEC, "job_b");

    const res = await app.inject({ method: "GET", url: `/queue?root=${encodeURIComponent(rootB)}` });
    expect(res.statusCode).toBe(200);
    const jobs = res.json().jobs as Array<{ jobId: string; queuedAt: number; frames: unknown[] }>;
    expect(jobs.map((j) => j.jobId).sort()).toEqual(["job_a", "job_b"]);
    const jobA = jobs.find((j) => j.jobId === "job_a")!;
    expect(jobA.frames).toEqual([
      { name: "screens/home.html/success@desktop", width: 1440, height: 900 },
    ]);
    expect(typeof jobA.queuedAt).toBe("number");

    // Listing is non-destructive: both jobs still pending.
    const again = await app.inject({ method: "GET", url: `/queue?root=${encodeURIComponent(rootB)}` });
    expect(again.json().jobs).toHaveLength(2);
  });

  it("GET /queue surfaces per-job provenance from the meta sidecar", async () => {
    const seed = new BridgeStore(path.join(rootB, ".uxfactory"));
    await seed.init();
    await seed.enqueue(SPEC, "job_gov");
    await seed.enqueue(SPEC, "job_ungov");
    await mkdir(path.join(rootB, ".uxfactory", "queue", "meta"), { recursive: true });
    await writeFile(
      path.join(rootB, ".uxfactory", "queue", "meta", "job_ungov.json"),
      JSON.stringify({ ungoverned: true, storyRefs: ["browse-faq"] }),
    );

    const res = await app.inject({ method: "GET", url: `/queue?root=${encodeURIComponent(rootB)}` });
    const jobs = res.json().jobs as Array<{ jobId: string; ungoverned?: boolean }>;
    expect(jobs.find((j) => j.jobId === "job_ungov")?.ungoverned).toBe(true);
    expect(jobs.find((j) => j.jobId === "job_gov")).not.toHaveProperty("ungoverned");
  });

  it("POST /queue/:id/approve dequeues exactly that job and returns its spec", async () => {
    const seed = new BridgeStore(path.join(rootB, ".uxfactory"));
    await seed.init();
    await seed.enqueue(SPEC, "job_first");
    await seed.enqueue(SPEC, "job_second");

    const res = await app.inject({
      method: "POST",
      url: `/queue/job_second/approve?root=${encodeURIComponent(rootB)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ jobId: "job_second", spec: SPEC });

    // Only job_first remains; approving job_second again → 404.
    const list = await app.inject({ method: "GET", url: `/queue?root=${encodeURIComponent(rootB)}` });
    expect(list.json().jobs.map((j: { jobId: string }) => j.jobId)).toEqual(["job_first"]);
    const gone = await app.inject({
      method: "POST",
      url: `/queue/job_second/approve?root=${encodeURIComponent(rootB)}`,
    });
    expect(gone.statusCode).toBe(404);
  });

  it("POST /queue/:id/discard removes the job without rendering", async () => {
    const seed = new BridgeStore(path.join(rootB, ".uxfactory"));
    await seed.init();
    await seed.enqueue(SPEC, "job_reject");

    const res = await app.inject({
      method: "POST",
      url: `/queue/job_reject/discard?root=${encodeURIComponent(rootB)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const list = await app.inject({ method: "GET", url: `/queue?root=${encodeURIComponent(rootB)}` });
    expect(list.json().jobs).toEqual([]);
    // Discarded jobs never reach the render poll.
    const next = await app.inject({ method: "GET", url: `/next?root=${encodeURIComponent(rootB)}` });
    expect(next.statusCode).toBe(204);
  });

  it("GET /queue/:id/preview serves the matching batch screenshot", async () => {
    const seed = new BridgeStore(path.join(rootB, ".uxfactory"));
    await seed.init();
    await seed.enqueue(
      { editor: "figma", frames: [{ name: "screens/home.html/success@desktop", x: 0, y: 0, width: 1440, height: 900, children: [] }] },
      "job_prev",
    );
    // The extract/gate pipeline writes previews/<viewport>/<base>-<view>.png.
    const previewDir = path.join(rootB, ".uxfactory", "batch", "previews", "desktop");
    await mkdir(previewDir, { recursive: true });
    const PNG = Buffer.from("89504e470d0a1a0a", "hex"); // magic bytes suffice
    await writeFile(path.join(previewDir, "home-success.png"), PNG);

    const res = await app.inject({
      method: "GET",
      url: `/queue/job_prev/preview?root=${encodeURIComponent(rootB)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.rawPayload.subarray(0, 8)).toEqual(PNG);

    // Unknown job → 404.
    const missing = await app.inject({
      method: "GET",
      url: `/queue/nope/preview?root=${encodeURIComponent(rootB)}`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("serves the per-job preview snapshot when present — no cross-run aliasing", async () => {
    const seed = new BridgeStore(path.join(rootB, ".uxfactory"));
    await seed.init();
    await seed.enqueue(
      { editor: "figma", frames: [{ name: "screens/home.html/success@desktop", x: 0, y: 0, width: 10, height: 10, children: [] }] },
      "job_snap",
    );
    // The name-resolved preview belongs to a NEWER run (aliasing hazard)…
    const previewDir = path.join(rootB, ".uxfactory", "batch", "previews", "desktop");
    await mkdir(previewDir, { recursive: true });
    await writeFile(path.join(previewDir, "home-success.png"), "NEWER-RUN");
    // …but the job carries its own snapshot taken at publish time.
    const snapDir = path.join(rootB, ".uxfactory", "queue", "previews");
    await mkdir(snapDir, { recursive: true });
    await writeFile(path.join(snapDir, "job_snap.png"), "PUBLISH-TIME");

    const res = await app.inject({
      method: "GET",
      url: `/queue/job_snap/preview?root=${encodeURIComponent(rootB)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toBe("PUBLISH-TIME");
  });

  it("traversal-safe: a crafted frame name cannot read outside the previews dir", async () => {
    const seed = new BridgeStore(path.join(rootB, ".uxfactory"));
    await seed.init();
    // Bait file one level ABOVE previews/ — a ".." viewport segment would
    // resolve previews/../secret-file.png straight to it.
    await writeFile(path.join(rootB, ".uxfactory", "batch", "secret-file.png"), "TOP SECRET");
    await seed.enqueue(
      { editor: "figma", frames: [{ name: "secret.html/file@..", x: 0, y: 0, width: 10, height: 10, children: [] }] },
      "job_evil",
    );

    const res = await app.inject({
      method: "GET",
      url: `/queue/job_evil/preview?root=${encodeURIComponent(rootB)}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.rawPayload.toString()).not.toContain("TOP SECRET");
  });
});

describe("POST /verify?root=", () => {
  it("gates against the root's own render report", async () => {
    const spec = {
      editor: "figma",
      frames: [
        {
          name: "f", x: 0, y: 0, width: 200, height: 200,
          children: [
            { type: "shape", name: "box", x: 10, y: 20, width: 30, height: 40, fill: "#1E88E5" },
          ],
        },
      ],
    };
    const report = {
      renderId: "",
      editor: "figma",
      page: "p",
      pageKey: "0:1",
      fileName: "F",
      fileKey: "k",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
      nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40, fill: "#1e88e5" }],
    };

    // Report lives in root B's store only.
    await app.inject({
      method: "POST",
      url: `/rendered?root=${encodeURIComponent(rootB)}`,
      payload: report,
    });

    // Rooted verify gates against it.
    const scoped = await app.inject({
      method: "POST",
      url: `/verify?root=${encodeURIComponent(rootB)}`,
      payload: { spec },
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().status).toBe("PASS");

    // Unrooted verify sees no launch-store report → 409.
    const legacy = await app.inject({ method: "POST", url: "/verify", payload: { spec } });
    expect(legacy.statusCode).toBe(409);
  });
});

describe("POST/GET /rendered?root=", () => {
  it("reports are stored and read per root; the launch report store is isolated", async () => {
    const report = {
      ok: true,
      pageId: "0:1",
      created: [], updated: [], removed: [],
      warnings: [],
      jobId: "job_b",
    };

    const post = await app.inject({
      method: "POST",
      url: `/rendered?root=${encodeURIComponent(rootB)}`,
      payload: report,
    });
    expect(post.statusCode).toBe(200);
    expect(typeof post.json().renderId).toBe("string");

    const scoped = await app.inject({
      method: "GET",
      url: `/rendered?root=${encodeURIComponent(rootB)}`,
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json()).toMatchObject({ pageId: "0:1" });

    // Launch store never saw it.
    const legacy = await app.inject({ method: "GET", url: "/rendered" });
    expect(legacy.statusCode).toBe(404);
  });
});

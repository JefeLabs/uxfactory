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
import { mkdtemp, mkdir, rm } from "node:fs/promises";
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

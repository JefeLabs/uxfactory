import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";
import { BridgeStore } from "../src/store.js";

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
  app = await createBridge({ dataDir });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("GET /health", () => {
  it("reports ok and the pending count", async () => {
    const empty = await app.inject({ method: "GET", url: "/health" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ ok: true, pending: 0 });

    const seed = new BridgeStore(dataDir);
    await seed.init();
    await seed.enqueue({ edits: [{ id: "1:2", set: { x: 1 } }] }, "job_x");
    const one = await app.inject({ method: "GET", url: "/health" });
    expect(one.json()).toEqual({ ok: true, pending: 1 });
  });
});

describe("GET /next", () => {
  it("dequeues the oldest job, then 204 when empty", async () => {
    const seed = new BridgeStore(dataDir);
    await seed.init();
    await seed.enqueue({ editor: "figma", edits: [{ id: "1:2", set: { x: 1 } }] }, "job_1");

    const res = await app.inject({ method: "GET", url: "/next" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      jobId: "job_1",
      spec: { editor: "figma", edits: [{ id: "1:2", set: { x: 1 } }] },
    });

    expect((await app.inject({ method: "GET", url: "/health" })).json().pending).toBe(0);

    const empty = await app.inject({ method: "GET", url: "/next" });
    expect(empty.statusCode).toBe(204);
    expect(empty.body).toBe("");
  });
});

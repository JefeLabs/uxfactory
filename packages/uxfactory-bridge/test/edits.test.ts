import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { RenderReport } from "@uxfactory/gate";
import { createBridge } from "../src/server.js";

const makeReport = (over: Partial<RenderReport> = {}): RenderReport => ({
  renderId: "",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "F",
  fileKey: "k",
  counts: { frames: 0, sections: 0, objects: 0, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 120, y: 20, w: 30, h: 40 }],
  ...over,
});

/** Poll GET /next until a job appears (robust against enqueue/dequeue interleaving). */
async function nextJob(app: FastifyInstance): Promise<{ jobId: string; spec: unknown }> {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: "GET", url: "/next" });
    if (res.statusCode === 200) return res.json() as { jobId: string; spec: unknown };
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("no job appeared on /next");
}

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
  app = await createBridge({ dataDir, editTimeoutMs: 2000 });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /edits", () => {
  it("correlates a render back to the waiting caller", async () => {
    const editSpec = { edits: [{ id: "1:2", set: { x: 120 } }] };
    const editsP = app.inject({ method: "POST", url: "/edits", payload: editSpec });

    const job = await nextJob(app);
    expect(job.spec).toEqual(editSpec);

    await app.inject({
      method: "POST",
      url: "/rendered",
      payload: { ...makeReport(), jobId: job.jobId },
    });

    const res = await editsP;
    expect(res.statusCode).toBe(200);
    expect(res.json().renderId).toMatch(/^r_/);
  });

  it("rejects an invalid edit spec with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/edits", payload: { bogus: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid spec");
  });

  it("returns 504 when no render arrives within editTimeoutMs (job stays queued)", async () => {
    const shortDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
    const shortApp = await createBridge({ dataDir: shortDir, editTimeoutMs: 30 });
    try {
      const res = await shortApp.inject({
        method: "POST",
        url: "/edits",
        payload: { edits: [{ id: "1:2", set: { x: 1 } }] },
      });
      expect(res.statusCode).toBe(504);
      expect(res.json()).toEqual({ error: "render timed out" });
      expect((await shortApp.inject({ method: "GET", url: "/health" })).json().pending).toBe(1);
    } finally {
      await shortApp.close();
      await rm(shortDir, { recursive: true, force: true });
    }
  });
});

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
  counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40 }],
  ...over,
});

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

describe("rendered", () => {
  it("saves a report (assigning a renderId) and returns the latest", async () => {
    const res = await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
    expect(res.statusCode).toBe(200);
    const renderId = res.json().renderId as string;
    expect(renderId).toMatch(/^r_/);

    const got = await app.inject({ method: "GET", url: "/rendered" });
    expect(got.statusCode).toBe(200);
    expect(got.json().renderId).toBe(renderId);
  });

  it("GET /rendered is 404 before any render", async () => {
    const res = await app.inject({ method: "GET", url: "/rendered" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "no render report yet" });
  });
});

describe("selection", () => {
  it("round-trips the latest selection", async () => {
    const ok = await app.inject({ method: "POST", url: "/selection", payload: { ids: ["1:2"] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });

    const got = await app.inject({ method: "GET", url: "/selection" });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({ ids: ["1:2"] });
  });

  it("GET /selection is 404 before any selection", async () => {
    const res = await app.inject({ method: "GET", url: "/selection" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "no selection yet" });
  });
});

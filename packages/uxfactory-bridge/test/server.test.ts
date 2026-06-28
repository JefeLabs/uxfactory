import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { RenderReport } from "@uxfactory/gate";
import { createBridge, startBridge } from "../src/server.js";
import * as pkg from "../src/index.js";

const matchingSpec = {
  editor: "figma",
  frames: [
    {
      name: "f",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { type: "shape", name: "box", x: 10, y: 20, width: 30, height: 40, fill: "#1E88E5" },
      ],
    },
  ],
};

const makeReport = (over: Partial<RenderReport> = {}): RenderReport => ({
  renderId: "",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "F",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40, fill: "#1e88e5" }],
  ...over,
});

describe("CORS", () => {
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

  it("reflects the request origin (open for the plugin iframe)", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "https://www.figma.com",
        "access-control-request-method": "GET",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("https://www.figma.com");
  });
});

describe("public exports", () => {
  it("exposes the documented surface", () => {
    expect(typeof pkg.createBridge).toBe("function");
    expect(typeof pkg.startBridge).toBe("function");
    expect(typeof pkg.BridgeStore).toBe("function");
  });
});

describe("startBridge", () => {
  it("listens on 127.0.0.1 and serves /health", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
    const handle = await startBridge({ dataDir: path.join(root, ".uxfactory"), port: 0 });
    try {
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const res = await fetch(`${handle.url}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; pending: number };
      expect(body.ok).toBe(true);
    } finally {
      await handle.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("REST surface round-trip", () => {
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

  it("round-trips render, selection, verify and batch", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({
      ok: true,
      pending: 0,
    });

    const rendered = await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
    expect(rendered.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/rendered" })).statusCode).toBe(200);

    await app.inject({ method: "POST", url: "/selection", payload: { ids: ["1:2"] } });
    expect((await app.inject({ method: "GET", url: "/selection" })).json()).toEqual({
      ids: ["1:2"],
    });

    const verify = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().status).toBe("PASS");
    const verifyId = verify.json().verifyId as string;
    expect((await app.inject({ method: "GET", url: `/verify/${verifyId}` })).statusCode).toBe(200);

    const created = (
      await app.inject({
        method: "POST",
        url: "/batch",
        payload: { items: [{ spec: { edits: [{ id: "1:2", set: { x: 1 } }] } }] },
      })
    ).json();
    expect((await app.inject({ method: "GET", url: "/batch" })).json().batchId).toBe(
      created.batchId,
    );
    const approved = await app.inject({
      method: "POST",
      url: `/batch/${created.batchId}/approve`,
      payload: { approvedItemIds: [created.items[0].itemId] },
    });
    expect(approved.json().status).toBe("approved");
    expect((await app.inject({ method: "GET", url: "/health" })).json().pending).toBe(1);
  });
});

describe("isolation", () => {
  it("never writes outside dataDir", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
    const dataDir = path.join(root, ".uxfactory");
    const app = await createBridge({ dataDir });
    try {
      await app.inject({ method: "POST", url: "/selection", payload: { ids: ["1:2"] } });
      await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
      await app.inject({ method: "POST", url: "/verify", payload: { spec: matchingSpec } });
      await app.inject({
        method: "POST",
        url: "/batch",
        payload: { items: [{ spec: { edits: [{ id: "1:2", set: { x: 1 } }] } }] },
      });
      expect((await readdir(root)).sort()).toEqual([".uxfactory"]);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

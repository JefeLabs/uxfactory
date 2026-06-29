import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { BridgeStore } from "../src/store.js";
import { createBridge } from "../src/server.js";

const validRequest = {
  snapshot: {
    source: "canvas-inferred",
    frames: [
      {
        name: "HomeScreen",
        x: 0,
        y: 0,
        width: 375,
        height: 812,
        children: [{ type: "text", name: "Title", x: 16, y: 48, width: 200, height: 24 }],
      },
    ],
    page: "Page 1",
  },
  screenshot: "data:image/png;base64,abc123",
  extra: "opaque",
};

const minimalRequest = {
  snapshot: { source: "canvas-inferred", frames: [] },
};

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-canvas-"));
  app = await createBridge({ dataDir });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /canvas + GET /canvas (relay)", () => {
  it("stores a valid request and GET returns it", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/canvas",
      payload: validRequest,
    });
    expect(post.statusCode).toBe(200);
    const body = post.json() as Record<string, unknown>;
    expect((body["snapshot"] as Record<string, unknown>)["source"]).toBe("canvas-inferred");
    expect(Array.isArray((body["snapshot"] as Record<string, unknown>)["frames"])).toBe(true);
    expect(body["extra"]).toBe("opaque"); // opaque fields pass through

    const get = await app.inject({ method: "GET", url: "/canvas" });
    expect(get.statusCode).toBe(200);
    const got = get.json() as Record<string, unknown>;
    expect((got["snapshot"] as Record<string, unknown>)["source"]).toBe("canvas-inferred");
    expect(got["extra"]).toBe("opaque");
    expect(got["screenshot"]).toBe("data:image/png;base64,abc123");
  });

  it("stores a minimal request (no screenshot, empty frames)", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/canvas",
      payload: minimalRequest,
    });
    expect(post.statusCode).toBe(200);
    expect(
      (post.json() as Record<string, unknown>)["snapshot"] as Record<string, unknown>,
    ).toMatchObject({ source: "canvas-inferred", frames: [] });

    const get = await app.inject({ method: "GET", url: "/canvas" });
    expect(get.statusCode).toBe(200);
    expect(
      ((get.json() as Record<string, unknown>)["snapshot"] as Record<string, unknown>)["source"],
    ).toBe("canvas-inferred");
  });

  it("replaces the stored request on a second POST (latest wins)", async () => {
    await app.inject({ method: "POST", url: "/canvas", payload: minimalRequest });
    await app.inject({ method: "POST", url: "/canvas", payload: validRequest });

    const get = await app.inject({ method: "GET", url: "/canvas" });
    expect(get.statusCode).toBe(200);
    expect((get.json() as Record<string, unknown>)["extra"]).toBe("opaque");
  });
});

describe("POST /canvas validation (400 on malformed body)", () => {
  it("rejects a body missing snapshot", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/canvas",
      payload: { screenshot: "abc" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()["error"]).toMatch(/snapshot/);
  });

  it("rejects a body where snapshot is not an object (string)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/canvas",
      payload: { snapshot: "not-an-object" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()["error"]).toMatch(/snapshot/);
  });

  it("rejects a body where snapshot is an array (not object)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/canvas",
      payload: { snapshot: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()["error"]).toMatch(/snapshot/);
  });

  it("rejects a body where snapshot.source is not canvas-inferred", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/canvas",
      payload: { snapshot: { source: "something-else", frames: [] } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()["error"]).toMatch(/source/);
  });

  it("rejects a body where snapshot.frames is not an array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/canvas",
      payload: { snapshot: { source: "canvas-inferred", frames: "not-array" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()["error"]).toMatch(/frames/);
  });

  it("rejects a non-object body (e.g. array)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/canvas",
      payload: [{ snapshot: { source: "canvas-inferred", frames: [] } }],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /canvas when none stored → 404", () => {
  it("returns 404 before any canvas request is posted", async () => {
    const res = await app.inject({ method: "GET", url: "/canvas" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "no canvas request yet" });
  });
});

describe("BridgeStore canvas request (unit)", () => {
  let store: BridgeStore;
  let storeDir: string;

  beforeEach(async () => {
    storeDir = await mkdtemp(path.join(os.tmpdir(), "uxf-store-canvas-"));
    store = new BridgeStore(storeDir);
    await store.init();
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  it("getCanvasRequest returns null when none stored", async () => {
    expect(await store.getCanvasRequest()).toBeNull();
  });

  it("saveCanvasRequest persists and getCanvasRequest reads it back", async () => {
    const req = {
      snapshot: { source: "canvas-inferred", frames: [], page: "P1" },
      tag: "x",
    };
    const stored = await store.saveCanvasRequest(req);
    expect((stored["snapshot"] as Record<string, unknown>)["source"]).toBe("canvas-inferred");
    expect(stored["tag"]).toBe("x");

    const back = await store.getCanvasRequest();
    expect(back).not.toBeNull();
    expect((back!["snapshot"] as Record<string, unknown>)["source"]).toBe("canvas-inferred");
    expect(back!["tag"]).toBe("x");
  });

  it("latest request is returned after two saves", async () => {
    await store.saveCanvasRequest({
      snapshot: { source: "canvas-inferred", frames: [] },
      tag: "first",
    });
    await store.saveCanvasRequest({
      snapshot: { source: "canvas-inferred", frames: [{ name: "F" }] },
      tag: "second",
    });

    const back = await store.getCanvasRequest();
    expect(back!["tag"]).toBe("second");
  });

  it("survives a restart (file-backed)", async () => {
    await store.saveCanvasRequest({
      snapshot: { source: "canvas-inferred", frames: [] },
      label: "cold",
    });
    const reopened = new BridgeStore(storeDir);
    await reopened.init();
    const back = await reopened.getCanvasRequest();
    expect(back!["label"]).toBe("cold");
  });
});

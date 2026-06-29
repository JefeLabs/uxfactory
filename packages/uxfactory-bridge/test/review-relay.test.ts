import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { BridgeStore } from "../src/store.js";
import { createBridge } from "../src/server.js";

const validPayload = {
  conformant: true,
  findings: [{ requirement: "r1", status: "unmet", detail: "missing label" }],
  skipped: [],
  extra: "opaque",
};

const minimalPayload = { conformant: false, findings: [] };

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-review-"));
  app = await createBridge({ dataDir });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /review + GET /review (relay)", () => {
  it("stores a valid report and GET returns it", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/review",
      payload: validPayload,
    });
    expect(post.statusCode).toBe(200);
    const body = post.json() as Record<string, unknown>;
    expect(body["conformant"]).toBe(true);
    expect(Array.isArray(body["findings"])).toBe(true);
    expect(body["extra"]).toBe("opaque"); // opaque fields pass through

    const get = await app.inject({ method: "GET", url: "/review" });
    expect(get.statusCode).toBe(200);
    const got = get.json() as Record<string, unknown>;
    expect(got["conformant"]).toBe(true);
    expect(got["extra"]).toBe("opaque");
  });

  it("stores a minimal payload (conformant false, empty findings)", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/review",
      payload: minimalPayload,
    });
    expect(post.statusCode).toBe(200);
    expect(post.json()["conformant"]).toBe(false);

    const get = await app.inject({ method: "GET", url: "/review" });
    expect(get.statusCode).toBe(200);
    expect(get.json()["conformant"]).toBe(false);
  });

  it("replaces the stored report on a second POST (latest wins)", async () => {
    await app.inject({ method: "POST", url: "/review", payload: minimalPayload });
    await app.inject({ method: "POST", url: "/review", payload: validPayload });

    const get = await app.inject({ method: "GET", url: "/review" });
    expect(get.statusCode).toBe(200);
    expect(get.json()["conformant"]).toBe(true);
  });
});

describe("POST /review validation (400 on malformed body)", () => {
  it("rejects a body missing conformant", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/review",
      payload: { findings: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()["error"]).toMatch(/conformant/);
  });

  it("rejects a body where conformant is not a boolean", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/review",
      payload: { conformant: "yes", findings: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()["error"]).toMatch(/conformant/);
  });

  it("rejects a body missing findings", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/review",
      payload: { conformant: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()["error"]).toMatch(/findings/);
  });

  it("rejects a body where findings is not an array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/review",
      payload: { conformant: true, findings: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()["error"]).toMatch(/findings/);
  });

  it("rejects a non-object body (e.g. array)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/review",
      payload: [{ conformant: true, findings: [] }],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /review when none stored → 404", () => {
  it("returns 404 before any review is posted", async () => {
    const res = await app.inject({ method: "GET", url: "/review" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "no review report yet" });
  });
});

describe("BridgeStore review report (unit)", () => {
  let store: BridgeStore;
  let storeDir: string;

  beforeEach(async () => {
    storeDir = await mkdtemp(path.join(os.tmpdir(), "uxf-store-review-"));
    store = new BridgeStore(storeDir);
    await store.init();
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  it("getReviewReport returns null when none stored", async () => {
    expect(await store.getReviewReport()).toBeNull();
  });

  it("saveReviewReport persists and getReviewReport reads it back", async () => {
    const stored = await store.saveReviewReport({ conformant: true, findings: [], tag: "x" });
    expect(stored["conformant"]).toBe(true);
    expect(stored["tag"]).toBe("x");

    const back = await store.getReviewReport();
    expect(back).not.toBeNull();
    expect(back!["conformant"]).toBe(true);
    expect(back!["tag"]).toBe("x");
  });

  it("latest report is returned after two saves", async () => {
    await store.saveReviewReport({ conformant: true, findings: [] });
    await store.saveReviewReport({ conformant: false, findings: [{ x: 1 }] });

    const back = await store.getReviewReport();
    expect(back!["conformant"]).toBe(false);
  });

  it("survives a restart (file-backed)", async () => {
    await store.saveReviewReport({ conformant: true, findings: [], label: "cold" });
    const reopened = new BridgeStore(storeDir);
    await reopened.init();
    const back = await reopened.getReviewReport();
    expect(back!["label"]).toBe("cold");
  });
});

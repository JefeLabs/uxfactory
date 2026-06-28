import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

const specA = { edits: [{ id: "1:2", set: { x: 10 } }] };
const specB = { edits: [{ id: "3:4", set: { y: 20 } }] };

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

describe("POST /batch", () => {
  it("creates a batch with generated itemIds (status pending)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/batch",
      payload: { items: [{ spec: specA }, { spec: specB, preview: "data:img" }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.batchId).toMatch(/^b_/);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].status).toBe("pending");
    expect(body.items[0].itemId).toMatch(/_item_1$/);
    expect(body.items[1].preview).toBe("data:img");
  });

  it("rejects a batch with any invalid item spec (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/batch",
      payload: { items: [{ spec: specA }, { spec: { bogus: true } }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid spec");
  });
});

describe("GET /batch", () => {
  it("returns the latest pending batch, 404 when none", async () => {
    expect((await app.inject({ method: "GET", url: "/batch" })).statusCode).toBe(404);
    await app.inject({ method: "POST", url: "/batch", payload: { items: [{ spec: specA }] } });
    const res = await app.inject({ method: "GET", url: "/batch" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
  });
});

describe("POST /batch/:id/approve", () => {
  it("enqueues approved specs and marks item statuses", async () => {
    const created = (
      await app.inject({
        method: "POST",
        url: "/batch",
        payload: { items: [{ spec: specA }, { spec: specB }] },
      })
    ).json();
    const before = (await app.inject({ method: "GET", url: "/health" })).json().pending;

    const res = await app.inject({
      method: "POST",
      url: `/batch/${created.batchId}/approve`,
      payload: { approvedItemIds: [created.items[0].itemId] },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe("approved");
    expect(updated.items[0].status).toBe("approved");
    expect(updated.items[1].status).toBe("rejected");

    const after = (await app.inject({ method: "GET", url: "/health" })).json().pending;
    expect(after).toBe(before + 1);
  });

  it("404 on approving an unknown batch", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/batch/nope/approve",
      payload: { approvedItemIds: [] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown batch" });
  });
});

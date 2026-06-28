import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { RenderReport } from "@uxfactory/gate";
import { createBridge } from "../src/server.js";

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

describe("POST /verify transport codes", () => {
  it("400 on an invalid spec", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: { bogus: 1 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid spec");
    expect(Array.isArray(res.json().details)).toBe(true);
  });

  it("404 when an explicit renderId is unknown", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec, renderId: "nope" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown renderId" });
  });

  it("503 when no report exists and the plugin has never connected", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "plugin has never connected" });
  });

  it("409 when the plugin has connected but no report exists yet", async () => {
    await app.inject({ method: "GET", url: "/next" }); // marks pluginSeen (204)
    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no render report yet" });
  });
});

describe("POST /verify gate outcomes (always HTTP 200)", () => {
  it("PASS for a matching spec, including verifyId and summary.skipped", async () => {
    await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("PASS");
    expect(body.verifyId).toMatch(/^v_/);
    expect(body.renderId).toMatch(/^r_/);
    expect(body.summary).toHaveProperty("skipped");
  });

  it("FAIL (HTTP 200) when geometry is off, then PASS when tolerance is widened", async () => {
    await app.inject({
      method: "POST",
      url: "/rendered",
      payload: makeReport({
        nodes: [
          { id: "1:2", name: "box", type: "shape", x: 13, y: 20, w: 30, h: 40, fill: "#1e88e5" },
        ],
      }),
    });
    const strict = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec },
    });
    expect(strict.statusCode).toBe(200);
    expect(strict.json().status).toBe("FAIL");

    const loose = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec, tolerance: { geometryPx: 5 } },
    });
    expect(loose.statusCode).toBe(200);
    expect(loose.json().status).toBe("PASS");
  });

  it("honors a checks subset", async () => {
    await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec, checks: ["editorType"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.checks).toBe(1);
  });
});

describe("GET /verify/:id", () => {
  it("returns a stored result by id, 404 otherwise", async () => {
    await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
    const verifyId = (
      await app.inject({ method: "POST", url: "/verify", payload: { spec: matchingSpec } })
    ).json().verifyId as string;

    const got = await app.inject({ method: "GET", url: `/verify/${verifyId}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().verifyId).toBe(verifyId);

    expect((await app.inject({ method: "GET", url: "/verify/nope" })).statusCode).toBe(404);
  });
});

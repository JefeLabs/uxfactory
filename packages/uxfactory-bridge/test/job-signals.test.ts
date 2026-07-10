import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

describe("BridgeOptions job-signal callbacks", () => {
  let app: FastifyInstance;
  let launchRoot: string;
  const enqueued: Array<{ root: string; kind: string }> = [];
  const settled: string[] = [];

  beforeEach(async () => {
    enqueued.length = 0;
    settled.length = 0;
    launchRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-job-signals-"));
    await mkdir(path.join(launchRoot, ".git"), { recursive: true });
    app = await createBridge({
      dataDir: path.join(launchRoot, ".uxfactory"),
      reposRegistryPath: path.join(launchRoot, "repos-registry.json"),
      onRequestEnqueued: (root, kind) => enqueued.push({ root, kind }),
      onRequestSettled: (root) => settled.push(root),
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(launchRoot, { recursive: true, force: true });
  });

  it("fires onRequestEnqueued with the resolved root and kind on every enqueue", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "generate-artifact", payload: { artifact: "brief" } },
    });
    expect(res.statusCode).toBe(200);
    expect(enqueued).toEqual([{ root: launchRoot, kind: "generate-artifact" }]);
  });

  it("does not fire onRequestEnqueued on a rejected enqueue (bad kind)", async () => {
    await app.inject({ method: "POST", url: "/pipeline/request", payload: { kind: "" } });
    expect(enqueued).toHaveLength(0);
  });

  it("fires onRequestSettled with the request's root after the result saves", async () => {
    const enq = await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "generate-artifact", payload: {} },
    });
    const { id } = enq.json() as { id: string };
    await app.inject({
      method: "POST",
      url: "/pipeline/result",
      payload: { id, status: 0, result: { ok: true } },
    });
    expect(settled).toEqual([launchRoot]);
  });

  it("does not fire onRequestSettled for an unknown request id", async () => {
    await app.inject({
      method: "POST",
      url: "/pipeline/result",
      payload: { id: "pr_never_enqueued", status: 0, result: null },
    });
    expect(settled).toHaveLength(0);
  });
});

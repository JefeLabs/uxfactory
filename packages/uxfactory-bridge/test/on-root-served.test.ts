import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

describe("BridgeOptions.onRootServed", () => {
  let app: FastifyInstance;
  let launchRoot: string;
  const served: string[] = [];

  beforeEach(async () => {
    served.length = 0;
    launchRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-onrootserved-"));
    await mkdir(path.join(launchRoot, ".git"), { recursive: true });
    app = await createBridge({
      dataDir: path.join(launchRoot, ".uxfactory"),
      reposRegistryPath: path.join(launchRoot, "repos-registry.json"),
      onRootServed: (root) => served.push(root),
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(launchRoot, { recursive: true, force: true });
  });

  it("fires with the resolved root on every successful connect", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "uxf-conn-root-"));
    await mkdir(path.join(other, ".git"), { recursive: true });
    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: other },
    });
    expect(res.json()).toMatchObject({ ok: true });
    expect(served).toEqual([path.resolve(other)]);

    await app.inject({ method: "POST", url: "/project/connect", payload: { repoPath: other } });
    expect(served).toHaveLength(2); // fires per connect, not per new root
    await rm(other, { recursive: true, force: true });
  });

  it("does not fire on a failed connect", async () => {
    await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: "/definitely/missing" },
    });
    expect(served).toHaveLength(0);
  });
});

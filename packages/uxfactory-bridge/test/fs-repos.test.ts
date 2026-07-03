import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

let app: FastifyInstance;
let root: string;
let dataDir: string;
let registryPath: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-fsrepos-"));
  await mkdir(path.join(root, ".git"), { recursive: true });
  dataDir = path.join(root, ".uxfactory");
  await mkdir(dataDir, { recursive: true });
  registryPath = path.join(root, "registry.json");
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

describe("GET /fs/repos", () => {
  it("returns the launch root pinned first with the ReposResponse shape", async () => {
    app = await createBridge({ dataDir, reposRegistryPath: registryPath });
    const res = await app.inject({ method: "GET", url: "/fs/repos" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      cwd: string;
      repos: { root: string; name: string; lastConnectedAt: number; live: boolean }[];
    };
    expect(body.cwd).toBe(path.resolve(root));
    expect(body.repos[0]!.root).toBe(path.resolve(root));
    expect(body.repos[0]!.name).toBe(path.basename(root));
    expect(body.repos[0]!.live).toBe(true);
  });

  it("includes a pre-existing registry entry and flags a dead one live:false", async () => {
    const dead = path.join(os.tmpdir(), `uxf-dead-${Date.now()}`);
    await writeFile(
      registryPath,
      JSON.stringify({
        repos: [{ root: dead, firstConnectedAt: 1, lastConnectedAt: 2 }],
      }),
      "utf8",
    );
    app = await createBridge({ dataDir, reposRegistryPath: registryPath });
    const res = await app.inject({ method: "GET", url: "/fs/repos" });
    const body = res.json() as { repos: { root: string; live: boolean }[] };
    const deadRow = body.repos.find((r) => r.root === path.resolve(dead));
    expect(deadRow).toBeDefined();
    expect(deadRow!.live).toBe(false);
  });
});

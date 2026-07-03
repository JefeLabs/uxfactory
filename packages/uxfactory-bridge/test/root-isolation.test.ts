import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

let app: FastifyInstance;
let launch: string;
let dataDir: string;
let registryPath: string;
let rootA: string;
let rootB: string;

async function mkProjectRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(dir, ".git"), { recursive: true });
  return dir;
}
const enc = (p: string): string => encodeURIComponent(p);

beforeEach(async () => {
  launch = await mkProjectRoot("uxf-iso-launch-");
  dataDir = path.join(launch, ".uxfactory");
  await mkdir(dataDir, { recursive: true });
  registryPath = path.join(launch, "registry.json");
  app = await createBridge({ dataDir, reposRegistryPath: registryPath });

  rootA = await mkProjectRoot("uxf-iso-A-");
  rootB = await mkProjectRoot("uxf-iso-B-");
  for (const r of [rootA, rootB]) {
    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: r },
    });
    expect(res.statusCode).toBe(200);
  }
});

afterEach(async () => {
  await app.close();
  for (const d of [launch, rootA, rootB]) await rm(d, { recursive: true, force: true });
});

describe("write isolation (NORMATIVE INVARIANT)", () => {
  it("classification write to A never touches B", async () => {
    await app.inject({
      method: "PUT",
      url: `/project/classification?root=${enc(rootA)}`,
      payload: { category: "ecommerce" },
    });
    const onDiskA = JSON.parse(
      await readFile(path.join(rootA, "uxfactory.classification.json"), "utf8"),
    );
    expect(onDiskA).toEqual({ category: "ecommerce" });
    await expect(
      access(path.join(rootB, "uxfactory.classification.json")),
    ).rejects.toBeTruthy();
  });

  it("profile write to A never touches B", async () => {
    await app.inject({
      method: "PUT",
      url: `/project/profile?root=${enc(rootA)}`,
      payload: { visual: "high" },
    });
    const profileA = JSON.parse(
      await readFile(path.join(rootA, "uxfactory.profile.json"), "utf8"),
    ) as { scope?: { visual?: string } };
    expect(profileA.scope?.visual).toBe("high");
    await expect(access(path.join(rootB, "uxfactory.profile.json"))).rejects.toBeTruthy();
  });

  it("artifact write to A never touches B", async () => {
    await app.inject({
      method: "PUT",
      url: `/project/artifact?root=${enc(rootA)}`,
      payload: { key: "brief", content: "# Brief A\n" },
    });
    // Canonical path for "brief" is .uxfactory/artifacts/brief.md (not legacy brief.md).
    expect(
      await readFile(path.join(rootA, ".uxfactory", "artifacts", "brief.md"), "utf8"),
    ).toBe("# Brief A\n");
    await expect(
      access(path.join(rootB, ".uxfactory", "artifacts", "brief.md")),
    ).rejects.toBeTruthy();
  });

  it("snapshot?root= returns the requested root's project name", async () => {
    const snapA = (
      await app.inject({ method: "GET", url: `/project/snapshot?root=${enc(rootA)}` })
    ).json() as { root: string; name: string };
    expect(snapA.root).toBe(path.resolve(rootA));
    expect(snapA.name).toBe(path.basename(rootA));

    const snapB = (
      await app.inject({ method: "GET", url: `/project/snapshot?root=${enc(rootB)}` })
    ).json() as { root: string };
    expect(snapB.root).toBe(path.resolve(rootB));
  });
});

describe("root resolution errors + fallback", () => {
  it("unregistered ?root= → 403 root-not-served", async () => {
    const stranger = await mkProjectRoot("uxf-iso-stranger-");
    try {
      const res = await app.inject({
        method: "GET",
        url: `/project/snapshot?root=${enc(stranger)}`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: "root-not-served" });
    } finally {
      await rm(stranger, { recursive: true, force: true });
    }
  });

  it("served-but-vanished ?root= → 410 root-gone", async () => {
    await rm(path.join(rootB, ".git"), { recursive: true, force: true });
    const res = await app.inject({
      method: "GET",
      url: `/project/snapshot?root=${enc(rootB)}`,
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: "root-gone" });
  });

  it("missing ?root= falls back to the launch root", async () => {
    await writeFile(
      path.join(launch, "uxfactory.classification.json"),
      JSON.stringify({ category: "launch" }),
      "utf8",
    );
    const snap = (
      await app.inject({ method: "GET", url: "/project/snapshot" })
    ).json() as { root: string; classification: { category?: string } | null };
    expect(snap.root).toBe(path.resolve(launch));
    expect(snap.classification?.category).toBe("launch");
  });

  it("artifact containment is enforced against the resolved root (400 for unknown key)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/project/artifact?key=../../etc/passwd&root=${enc(rootA)}`,
    });
    // Unknown concern key → 400 (resolveConcernPath returns null before any read).
    expect(res.statusCode).toBe(400);
  });

  it("links write to A lands under A/.uxfactory and not B", async () => {
    const links = [{ nodeId: "1:2", unitName: "Hero", unitType: "organism", acId: "AC-1" }];
    await app.inject({
      method: "PUT",
      url: `/project/links?root=${enc(rootA)}`,
      payload: { links },
    });
    const onDiskA = JSON.parse(
      await readFile(path.join(rootA, ".uxfactory", "links.json"), "utf8"),
    );
    expect(onDiskA).toEqual(links);
    await expect(access(path.join(rootB, ".uxfactory", "links.json"))).rejects.toBeTruthy();
    // And GET?root=A reads them back; GET?root=B is empty.
    const gotA = (
      await app.inject({ method: "GET", url: `/project/links?root=${enc(rootA)}` })
    ).json();
    expect(gotA).toEqual({ links });
    const gotB = (
      await app.inject({ method: "GET", url: `/project/links?root=${enc(rootB)}` })
    ).json();
    expect(gotB).toEqual({ links: [] });
  });
});

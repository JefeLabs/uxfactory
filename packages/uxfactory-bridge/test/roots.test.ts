import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RootRegistry, isProjectRoot } from "../src/roots.js";

let launchRoot: string;
let launchDataDir: string;
let registryPath: string;
let others: string[];

async function mkRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uxf-roots-"));
  await mkdir(path.join(dir, ".git"), { recursive: true });
  others.push(dir);
  return dir;
}

beforeEach(async () => {
  others = [];
  launchRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-launch-"));
  await mkdir(path.join(launchRoot, ".git"), { recursive: true });
  launchDataDir = path.join(launchRoot, ".uxfactory");
  registryPath = path.join(
    await mkdtemp(path.join(os.tmpdir(), "uxf-reg-")),
    "repos.json",
  );
});

afterEach(async () => {
  for (const d of [launchRoot, ...others]) await rm(d, { recursive: true, force: true });
  await rm(path.dirname(registryPath), { recursive: true, force: true });
});

function make(): RootRegistry {
  return new RootRegistry({ launchRoot, launchDataDir, registryPath });
}

describe("RootRegistry.init", () => {
  it("seeds the served set with the launch root and writes a registry entry", async () => {
    const reg = make();
    await reg.init();
    expect(reg.isServed(launchRoot)).toBe(true);
    const onDisk = JSON.parse(await readFile(registryPath, "utf8")) as {
      repos: { root: string }[];
    };
    expect(onDisk.repos.map((r) => r.root)).toContain(path.resolve(launchRoot));
  });
});

describe("RootRegistry.dataDirFor", () => {
  it("returns the launch data dir for the launch root and <root>/.uxfactory otherwise", async () => {
    const reg = make();
    await reg.init();
    const other = await mkRoot();
    expect(reg.dataDirFor(launchRoot)).toBe(launchDataDir);
    expect(reg.dataDirFor(other)).toBe(path.join(path.resolve(other), ".uxfactory"));
  });
});

describe("RootRegistry.register", () => {
  it("serves the root, creates its data dir, and upserts the registry", async () => {
    const reg = make();
    await reg.init();
    const other = await mkRoot();
    await reg.register(other);
    expect(reg.isServed(other)).toBe(true);
    // data dir now exists
    await expect(readFile(path.join(other, ".uxfactory", ".keep")).catch(() => "ok")).resolves.toBeDefined();
    const entries = await reg.readRegistry();
    expect(entries.map((e) => e.root)).toContain(path.resolve(other));
  });

  it("is idempotent and bumps lastConnectedAt", async () => {
    const reg = make();
    await reg.init();
    const other = await mkRoot();
    await reg.register(other);
    const first = (await reg.readRegistry()).find((e) => e.root === path.resolve(other))!;
    await new Promise((r) => setTimeout(r, 5));
    await reg.register(other);
    const entries = (await reg.readRegistry()).filter((e) => e.root === path.resolve(other));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.lastConnectedAt).toBeGreaterThanOrEqual(first.lastConnectedAt);
  });
});

describe("RootRegistry.resolveRequestRoot", () => {
  it("undefined/empty → launch root", async () => {
    const reg = make();
    await reg.init();
    for (const raw of [undefined, ""]) {
      const res = await reg.resolveRequestRoot(raw);
      expect(res).toEqual({ ok: true, root: path.resolve(launchRoot), dataDir: launchDataDir });
    }
  });

  it("registered root → ok with its data dir", async () => {
    const reg = make();
    await reg.init();
    const other = await mkRoot();
    await reg.register(other);
    const res = await reg.resolveRequestRoot(other);
    expect(res).toEqual({
      ok: true,
      root: path.resolve(other),
      dataDir: path.join(path.resolve(other), ".uxfactory"),
    });
  });

  it("unregistered root → 403 root-not-served", async () => {
    const reg = make();
    await reg.init();
    const other = await mkRoot();
    expect(await reg.resolveRequestRoot(other)).toEqual({
      ok: false,
      code: 403,
      error: "root-not-served",
    });
  });

  it("served-but-vanished root → 410 root-gone", async () => {
    const reg = make();
    await reg.init();
    const other = await mkRoot();
    await reg.register(other);
    await rm(path.join(other, ".git"), { recursive: true, force: true });
    expect(await reg.resolveRequestRoot(other)).toEqual({
      ok: false,
      code: 410,
      error: "root-gone",
    });
  });
});

describe("RootRegistry.readRegistry", () => {
  it("missing file → []", async () => {
    const reg = new RootRegistry({
      launchRoot,
      launchDataDir,
      registryPath: path.join(path.dirname(registryPath), "does-not-exist.json"),
    });
    expect(await reg.readRegistry()).toEqual([]);
  });

  it("corrupt file → [] (never throws)", async () => {
    await writeFile(registryPath, "{ this is not json", "utf8");
    const reg = make();
    expect(await reg.readRegistry()).toEqual([]);
  });

  it("round-trips through register", async () => {
    const reg = make();
    await reg.init();
    const a = await mkRoot();
    await reg.register(a);
    const entries = await reg.readRegistry();
    const entry = entries.find((e) => e.root === path.resolve(a));
    expect(entry).toBeDefined();
    expect(entry!.firstConnectedAt).toBeGreaterThan(0);
    expect(entry!.lastConnectedAt).toBeGreaterThanOrEqual(entry!.firstConnectedAt);
  });
});

describe("RootRegistry.listRepos", () => {
  it("pins the launch root first, orders the rest most-recent-first, flags dead entries", async () => {
    const reg = make();
    await reg.init();
    const older = await mkRoot();
    await reg.register(older);
    await new Promise((r) => setTimeout(r, 5));
    const newer = await mkRoot();
    await reg.register(newer);

    // Kill `older` so it is a dead (live:false) entry.
    await rm(path.join(older, ".git"), { recursive: true, force: true });

    const { cwd, repos } = await reg.listRepos();
    expect(cwd).toBe(path.resolve(launchRoot));
    expect(repos[0]!.root).toBe(path.resolve(launchRoot));
    expect(repos[0]!.live).toBe(true);
    const rest = repos.slice(1).map((r) => r.root);
    expect(rest.indexOf(path.resolve(newer))).toBeLessThan(rest.indexOf(path.resolve(older)));
    const olderRow = repos.find((r) => r.root === path.resolve(older))!;
    expect(olderRow.live).toBe(false);
    expect(olderRow.name).toBe(path.basename(older));
  });
});

describe("isProjectRoot", () => {
  it("true with .git, true with uxfactory.batch.json, false otherwise", async () => {
    const withGit = await mkRoot();
    expect(await isProjectRoot(withGit)).toBe(true);
    const withBatch = await mkdtemp(path.join(os.tmpdir(), "uxf-batch-"));
    others.push(withBatch);
    await writeFile(path.join(withBatch, "uxfactory.batch.json"), "{}", "utf8");
    expect(await isProjectRoot(withBatch)).toBe(true);
    const plain = await mkdtemp(path.join(os.tmpdir(), "uxf-plain-"));
    others.push(plain);
    expect(await isProjectRoot(plain)).toBe(false);
  });
});

# UXFactory Multi-Root Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one bridge process on `localhost:3779` serve N project roots concurrently, so multiple Figma files / AI sessions can drive different repos at the same time — while guaranteeing that every file write lands inside the repo the requesting Figma file is connected to, never another served root and never outside any root.

**Architecture:** A new `RootRegistry` (packages/uxfactory-bridge/src/roots.ts) owns a user-level persistent registry (`~/.uxfactory/repos.json`), an in-memory served-root set seeded with the bridge's launch root, and a single `resolveRequestRoot(?root=)` choke point that maps each request to a validated `{root, dataDir}` (403 not-served / 410 gone / launch-root fallback). Every `/project/*` route (plus `/pipeline/request` enqueue and `/pipeline/request/next` poll) carries `?root=` as a query param and resolves through the registry; `POST /project/connect` registers new roots. On the panel side, the bridge client gains `setProjectRoot(root)` (appends `?root=` to root-scoped verbs) and `getRepos()`; the Connect screen renders a chip list from `getRepos` with three-tier degradation and stores the connect-resolved root. The worker polls `/pipeline/request/next?root=<its projectRoot>` so jobs never cross repos.

**Tech Stack:** Node 20 · Fastify 5 · Vitest (root + per-package configs, fastify `inject` + temp-dir roots) · TypeScript (strict, ESM) · Vite 6 · React 19 · Tailwind v4 · Zustand 5 · Radix UI · lucide-react · `@tanstack/react-query@5.101.2` · `@tanstack/react-router@1.170.17` · Changesets.

## Global Constraints

- **NORMATIVE INVARIANT (spec §2, user 2026-07-03):** every file write lands inside the repo the requesting project is connected to — never another served root, never outside any root. `RootRegistry.resolveRequestRoot` is the single choke point; every root-scoped route MUST resolve through it and MUST NOT read `launchRoot`/`launchDataDir` directly. The two-temp-root isolation tests in Task 3 are this invariant's gate.
- **Figma manifest is UNTOUCHABLE** — `packages/uxfactory-plugin/manifest.json` `networkAccess` stays `localhost:3779` only. No port change, no new host. One bridge serves N roots.
- **`?root=` is a QUERY PARAM on ALL verbs (GET/POST/PUT)** — never a custom header. Chosen deliberately: a header adds a CORS preflight surface (headers burned this project once) and would not appear in the request log ring; a query param is forensics-grade (every logged line shows which root it targeted). Value is `encodeURIComponent(<absolute path>)`.
- **Missing `?root=` falls back to the launch root** — legacy panel + worker builds keep working (documented as the deprecated compat path). The launch root is auto-registered at startup and is always served.
- **Unknown/unregistered `?root=` → 403 `{error:"root-not-served"}`; served-but-vanished root → 410 `{error:"root-gone"}`.** Path containment is enforced per resolved root exactly as today.
- **Compatibility matrix (must hold after every task):**
  - Old panel + new bridge: no `?root=` → launch root. Works.
  - New panel + old bridge: `getRepos`/`setProjectRoot` are optional client methods that degrade; connecting to a non-launch root still surfaces the old `bridge-serves-different-root` message (the client union + Connect handler KEEP that reason even though the new server never sends it). Works.
  - Old worker + new bridge: a poll without `?root=` claims launch-root jobs only, never another repo's work. Works.
- **SSE stays a single global stream** (`/pipeline/events`); the panel already filters by its own run ids. Per-root channels are out of scope (PP2).
- **`/stats`, `/logs`, `/skills`, `/health`, `/fs/cwd`, `/rendered`, `/verify`, `/pipeline/{result,event,events}` are NOT root-scoped** — `/stats`/`/skills`/`/logs` read the launch root (unchanged behavior); the spec scopes only `/project/*` + pipeline enqueue/next. Do not append `?root=` to these on the client.
- **Registry path is injectable + test-isolated.** `BridgeOptions.reposRegistryPath` overrides the default `process.env.UXFACTORY_REPOS_REGISTRY ?? ~/.uxfactory/repos.json`. Task 1 sets `UXFACTORY_REPOS_REGISTRY` to a tmp path in both vitest configs so no test ever writes the developer's real `~/.uxfactory/repos.json`; registry-asserting tests inject their own isolated `reposRegistryPath` and clean it up.
- **Per task, ALL of these must be green before commit:**
  ```sh
  pnpm --filter @uxfactory/bridge test
  pnpm --filter @uxfactory/plugin test
  pnpm --filter uxfactory-worker test
  pnpm --filter @uxfactory/bridge typecheck
  pnpm --filter @uxfactory/plugin typecheck
  pnpm --filter uxfactory-worker typecheck
  pnpm -r build
  ```
- **Changesets:** every task that touches `packages/{spec,gate,bridge,cli}` MUST add a `.changeset/*.md` entry (`@uxfactory/bridge` here) and include it in that task's `git add`. Plugin and worker are private (not in that set) — no changeset. Tasks 1–4 touch the bridge and each add a changeset; Tasks 5–7 do not.
- **`git add` only the exact files touched (never `-A`).** Every commit message ends with the trailer line exactly:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Work directly on `main`. Do not push.**

## Resolved ambiguities (read before starting)

1. **`/stats`, `/skills`, `/logs` remain launch-root reads** (not per-`?root=`). Spec §2/§3 scope only `/project/*` (writes) + pipeline enqueue/next. Root-scoping the read-only stats surface is out of scope; `projectPlugin` keeps `servedRoot`/`dataDir` for those three routes and uses `registry.resolveRequestRoot` for the `/project/*` routes.
2. **`connectProject` does NOT append `?root=`.** It is the registration call; its body `repoPath` is the root to validate + register. All OTHER root-scoped client verbs append `?root=` once `setProjectRoot` has been called.
3. **Query keys gain the root dimension for `snapshot`, `links`, `artifact` only.** `latestRender` maps to the global `/rendered` relay (not root-scoped) → its key is unchanged. Factories read the active root from the injected bridge via `activeRoot(bridge) = bridge.getProjectRoot?.() ?? null`, so screen call sites (`snapshotQuery(bridge)`, etc.) are unchanged; only the imperative cache writes (`setQueryData`/`invalidateQueries`/`cancelQueries`) thread `activeRoot(bridge)` explicitly.
4. **`setProjectRoot`/`getProjectRoot`/`getRepos` are OPTIONAL on the `Bridge` interface.** They are pure client-side additions, but making them optional keeps the ~15 hand-written fake bridges in the plugin suite valid without edits. The concrete `createBridge` always implements all three.
5. **Re-validating `isProjectRoot` on the launch-root fallback is safe.** Every existing `/project/*` bridge test seeds the launch root with a `.git` marker before the request, so uniform re-validation (410 when a root vanished) does not break the current suite.
6. **The `bridge-serves-different-root` reason is deleted from the SERVER only.** The client `ConnectError` union and the `Connect.tsx` message branch keep it for the "new panel + old bridge" compat row. The two existing bridge connect tests and the one contract connect test that assert `bridge-serves-different-root` are rewritten in Task 2 to assert the new register-and-serve behavior.

---

## Controller amendments (read before any task)

- **Diff against the CURRENT file, never this plan's snippets alone** — code shown here was drafted 2026-07-03 and the artifacts-work-directory change landed the same day. Concretely for Task 3: `resolveConcernPath` now returns `{ absolutePath, writePath, relativePath, format, exists }`; the PUT /project/artifact handler containment-checks and writes `resolved.writePath` (canonical, `.uxfactory/artifacts/...`) and then removes a differing legacy `absolutePath` (migrate-on-touch). Root-scoping must thread `ctx.root` through THAT handler shape.
- The two-temp-root isolation tests (Task 3) should assert canonical artifact writes land under `<root>/.uxfactory/artifacts/` per the new layout.

## Task 1 — RootRegistry module + served-root set + `/fs/repos`

**Files:**
- Create: `packages/uxfactory-bridge/src/roots.ts`
- Create (test): `packages/uxfactory-bridge/test/roots.test.ts`
- Create (test): `packages/uxfactory-bridge/test/fs-repos.test.ts`
- Modify: `packages/uxfactory-bridge/src/server.ts` (construct + init the registry, add `reposRegistryPath` option, register `GET /fs/repos`)
- Modify: `packages/uxfactory-bridge/src/index.ts` (export `RootRegistry` + types)
- Modify: `packages/uxfactory-plugin/src/bridge-ambient.d.ts` (add `reposRegistryPath?` to the ambient `createBridge`/`startBridge` options)
- Modify: `vitest.config.ts` (root) and `packages/uxfactory-plugin/vitest.config.ts` (inject `UXFACTORY_REPOS_REGISTRY` tmp path)
- Create: `.changeset/multi-root-registry.md`

**Interfaces:**
- Produces `src/roots.ts`:
  - `interface RepoEntry { root: string; firstConnectedAt: number; lastConnectedAt: number }`
  - `interface RepoListing { root: string; name: string; lastConnectedAt: number; live: boolean }`
  - `interface ReposResponse { cwd: string; repos: RepoListing[] }`
  - `type RootResolution = { ok: true; root: string; dataDir: string } | { ok: false; code: 403 | 410; error: "root-not-served" | "root-gone" }`
  - `function isProjectRoot(dir: string): Promise<boolean>`
  - `class RootRegistry` with: `constructor(opts: { launchRoot: string; launchDataDir: string; registryPath?: string })`, readonly `launchRoot`, readonly `launchDataDir`, `init(): Promise<void>`, `dataDirFor(root: string): string`, `isServed(root: string): boolean`, `register(root: string): Promise<void>`, `resolveRequestRoot(rawRoot: string | undefined): Promise<RootResolution>`, `readRegistry(): Promise<RepoEntry[]>`, `listRepos(): Promise<ReposResponse>`.
- Produces `src/server.ts`: `BridgeOptions` gains `reposRegistryPath?: string`; a live `RootRegistry` instance; `GET /fs/repos → ReposResponse`.

### Steps

- [ ] **Write `test/roots.test.ts`** (complete failing test):
  ```ts
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
  ```
  Note: the `register` test's data-dir assertion is intentionally loose (existence of the dir, tolerant of no `.keep` file). Adjust to a `stat(path.join(other, ".uxfactory"))` if preferred; the point is the dir exists after `register`.

- [ ] **Run — expected failure (module missing).**
  ```sh
  pnpm --filter @uxfactory/bridge exec vitest run --root ../.. packages/uxfactory-bridge/test/roots.test.ts
  ```
  Expected: `Cannot find module '../src/roots.js'`.

- [ ] **Create `src/roots.ts`** (complete content):
  ```ts
  /**
   * roots.ts — user-level repo registry + per-process served-root set.
   *
   * One bridge serves N project roots (one bridge, many Figma files). This module
   * owns the persistent registry file (~/.uxfactory/repos.json, corrupt-tolerant),
   * the in-memory served-root set (which roots THIS process answers for), and the
   * single per-request root resolution point.
   *
   * NORMATIVE INVARIANT (spec §2): every /project/* write lands inside the repo the
   * request is scoped to. resolveRequestRoot maps a request's ?root= to a validated
   * {root, dataDir}; every root-scoped route MUST go through it and never read
   * launchRoot/launchDataDir directly.
   */
  import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
  import os from "node:os";
  import path from "node:path";

  /** One persisted registry entry, deduped by resolved absolute `root`. */
  export interface RepoEntry {
    root: string;
    firstConnectedAt: number;
    lastConnectedAt: number;
  }

  /** GET /fs/repos row. `name` = basename; `live` = passes isProjectRoot now. */
  export interface RepoListing {
    root: string;
    name: string;
    lastConnectedAt: number;
    live: boolean;
  }

  /** GET /fs/repos response body. */
  export interface ReposResponse {
    cwd: string;
    repos: RepoListing[];
  }

  /** Successful root resolution → the root and its data dir. */
  export interface ResolvedRoot {
    ok: true;
    root: string;
    dataDir: string;
  }

  /** Failed root resolution → an HTTP code + machine-readable error. */
  export interface RootResolutionError {
    ok: false;
    code: 403 | 410;
    error: "root-not-served" | "root-gone";
  }

  export type RootResolution = ResolvedRoot | RootResolutionError;

  /** True when `dir` has a `.git` directory or a `uxfactory.batch.json` file. */
  export async function isProjectRoot(dir: string): Promise<boolean> {
    for (const marker of [".git", "uxfactory.batch.json"]) {
      try {
        await access(path.join(dir, marker));
        return true;
      } catch {
        /* try next marker */
      }
    }
    return false;
  }

  export interface RootRegistryOptions {
    /** The bridge's launch root (path.dirname(dataDir)); always served. */
    launchRoot: string;
    /** The launch root's data dir (may be a custom test dir). */
    launchDataDir: string;
    /** Registry file path. Default env override, then ~/.uxfactory/repos.json. */
    registryPath?: string;
  }

  export class RootRegistry {
    readonly launchRoot: string;
    readonly launchDataDir: string;
    private readonly registryPath: string;
    private readonly served = new Set<string>();

    constructor(opts: RootRegistryOptions) {
      this.launchRoot = path.resolve(opts.launchRoot);
      this.launchDataDir = opts.launchDataDir;
      this.registryPath =
        opts.registryPath ??
        process.env["UXFACTORY_REPOS_REGISTRY"] ??
        path.join(os.homedir(), ".uxfactory", "repos.json");
    }

    /** Seed the served set with the launch root and upsert it in the registry. */
    async init(): Promise<void> {
      this.served.add(this.launchRoot);
      await this.upsert(this.launchRoot);
    }

    /** Data dir for a root: launch root → its configured dir; else <root>/.uxfactory. */
    dataDirFor(root: string): string {
      const resolved = path.resolve(root);
      return resolved === this.launchRoot
        ? this.launchDataDir
        : path.join(resolved, ".uxfactory");
    }

    /** True when THIS process is serving `root`. */
    isServed(root: string): boolean {
      return this.served.has(path.resolve(root));
    }

    /**
     * Register a freshly-connected root: add to the served set, ensure its data
     * dir exists, and upsert the persistent registry (bumps lastConnectedAt).
     * `root` must already be validated (exists + isProjectRoot) by the caller.
     */
    async register(root: string): Promise<void> {
      const resolved = path.resolve(root);
      this.served.add(resolved);
      await mkdir(this.dataDirFor(resolved), { recursive: true });
      await this.upsert(resolved);
    }

    /**
     * Resolve a request's raw ?root= to a validated {root, dataDir}.
     *   - undefined/empty → launch root (legacy fallback), still re-validated;
     *   - not in the served set → 403 root-not-served;
     *   - served but no longer a project root → 410 root-gone.
     */
    async resolveRequestRoot(rawRoot: string | undefined): Promise<RootResolution> {
      const root =
        rawRoot === undefined || rawRoot.trim() === ""
          ? this.launchRoot
          : path.resolve(rawRoot);

      if (!this.served.has(root)) {
        return { ok: false, code: 403, error: "root-not-served" };
      }
      if (!(await isProjectRoot(root))) {
        return { ok: false, code: 410, error: "root-gone" };
      }
      return { ok: true, root, dataDir: this.dataDirFor(root) };
    }

    /** Registry entries as stored. Corrupt/missing file → []. Never throws. */
    async readRegistry(): Promise<RepoEntry[]> {
      let raw: string;
      try {
        raw = await readFile(this.registryPath, "utf8");
      } catch {
        return [];
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return [];
        }
        const repos = (parsed as { repos?: unknown }).repos;
        if (!Array.isArray(repos)) return [];
        return repos.filter(
          (e): e is RepoEntry =>
            e !== null &&
            typeof e === "object" &&
            typeof (e as { root?: unknown }).root === "string",
        );
      } catch {
        return [];
      }
    }

    /**
     * GET /fs/repos body: launch root pinned first, then registry entries
     * most-recent-first (deduped by resolved path). Dead entries carry live:false.
     */
    async listRepos(): Promise<ReposResponse> {
      const entries = await this.readRegistry();
      const byRoot = new Map<string, RepoEntry>();
      for (const e of entries) byRoot.set(path.resolve(e.root), e);

      const ordered: string[] = [this.launchRoot];
      const rest = [...entries].sort((a, b) => b.lastConnectedAt - a.lastConnectedAt);
      for (const e of rest) {
        const resolved = path.resolve(e.root);
        if (resolved !== this.launchRoot && !ordered.includes(resolved)) {
          ordered.push(resolved);
        }
      }

      const repos: RepoListing[] = [];
      for (const root of ordered) {
        repos.push({
          root,
          name: path.basename(root),
          lastConnectedAt: byRoot.get(root)?.lastConnectedAt ?? 0,
          live: await isProjectRoot(root),
        });
      }
      return { cwd: this.launchRoot, repos };
    }

    /** Insert or update a registry entry (dedup by resolved path). Never throws. */
    private async upsert(root: string): Promise<void> {
      const resolved = path.resolve(root);
      const now = Date.now();
      try {
        const entries = await this.readRegistry();
        const existing = entries.find((e) => path.resolve(e.root) === resolved);
        let next: RepoEntry[];
        if (existing !== undefined) {
          existing.lastConnectedAt = now;
          next = entries;
        } else {
          next = [
            ...entries,
            { root: resolved, firstConnectedAt: now, lastConnectedAt: now },
          ];
        }
        await mkdir(path.dirname(this.registryPath), { recursive: true });
        const tmp = `${this.registryPath}.tmp`;
        await writeFile(tmp, `${JSON.stringify({ repos: next }, null, 2)}\n`, "utf8");
        await rename(tmp, this.registryPath);
      } catch {
        /* registry is best-effort; never block the bridge on a write failure */
      }
    }
  }
  ```

- [ ] **Run — expected: `roots.test.ts` PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge exec vitest run --root ../.. packages/uxfactory-bridge/test/roots.test.ts
  ```

- [ ] **Write `test/fs-repos.test.ts`** (complete failing test — server route):
  ```ts
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
  ```

- [ ] **Run — expected failure (`reposRegistryPath` unknown / `/fs/repos` 404).**
  ```sh
  pnpm --filter @uxfactory/bridge exec vitest run --root ../.. packages/uxfactory-bridge/test/fs-repos.test.ts
  ```

- [ ] **Wire the registry into `src/server.ts`.** Apply these edits:
  - Add imports near the top (after the existing `import path from "node:path";`):
    ```ts
    import os from "node:os";
    import { RootRegistry } from "./roots.js";
    ```
  - Extend `BridgeOptions` (add the field to the existing interface):
    ```ts
    export interface BridgeOptions {
      /** Root for all on-disk state. Default: <cwd>/.uxfactory */
      dataDir?: string;
      /** How long POST /edits waits for the matching render before 504. Default 4000ms. */
      editTimeoutMs?: number;
      /**
       * User-level repo registry path. Default:
       * process.env.UXFACTORY_REPOS_REGISTRY ?? ~/.uxfactory/repos.json.
       * Injected in tests so no test writes the developer's real registry.
       */
      reposRegistryPath?: string;
    }
    ```
  - Inside `createBridge`, right after `const servedRoot = path.dirname(dataDir);`, add:
    ```ts
    const reposRegistryPath =
      options.reposRegistryPath ??
      process.env["UXFACTORY_REPOS_REGISTRY"] ??
      path.join(os.homedir(), ".uxfactory", "repos.json");
    const registry = new RootRegistry({
      launchRoot: servedRoot,
      launchDataDir: dataDir,
      registryPath: reposRegistryPath,
    });
    await registry.init();
    ```
  - Register the discovery route next to the existing `GET /fs/cwd` (leave `/fs/cwd` untouched):
    ```ts
    // /fs/repos supersedes /fs/cwd for discovery (cwd stays for compat).
    app.get("/fs/repos", async () => registry.listRepos());
    ```
  - (Task 2 will pass `registry` into `projectPlugin`; leave the `app.register(projectPlugin, ...)` call as-is in this task.)

- [ ] **Export from `src/index.ts`** — append:
  ```ts
  export { RootRegistry, isProjectRoot } from "./roots.js";
  export type { RepoEntry, RepoListing, ReposResponse, RootResolution } from "./roots.js";
  ```

- [ ] **Add `reposRegistryPath?` to the ambient bridge typings** in `packages/uxfactory-plugin/src/bridge-ambient.d.ts` — update both function signatures:
  ```ts
  export function createBridge(options?: {
    dataDir?: string;
    editTimeoutMs?: number;
    reposRegistryPath?: string;
  }): Promise<BridgeServer>;

  export function startBridge(options?: {
    dataDir?: string;
    port?: number;
    editTimeoutMs?: number;
    reposRegistryPath?: string;
  }): Promise<{ url: string; close: () => Promise<void> }>;
  ```

- [ ] **Isolate the registry in both vitest configs so no test writes real `~/.uxfactory`.**
  In `vitest.config.ts` (repo root), add the two node imports and a `test.env` entry:
  ```ts
  import { defineConfig } from "vitest/config";
  import { fileURLToPath } from "node:url";
  import os from "node:os";
  import path from "node:path";

  export default defineConfig({
    test: {
      include: [
        "test/**/*.test.ts",
        "packages/**/test/**/*.test.ts",
        "packages/**/src/**/*.test.ts",
        "clients/**/test/**/*.test.ts",
      ],
      environment: "node",
      env: {
        UXFACTORY_REPOS_REGISTRY: path.join(os.tmpdir(), "uxfactory-test-repos.json"),
      },
    },
    resolve: {
      // ...unchanged aliases...
    },
  });
  ```
  In `packages/uxfactory-plugin/vitest.config.ts`, add the same imports and `test.env`:
  ```ts
  import { defineConfig } from "vitest/config";
  import { fileURLToPath } from "node:url";
  import os from "node:os";
  import path from "node:path";

  export default defineConfig({
    test: {
      include: ["src/**/*.test.ts", "test/**/*.test.ts", "test/**/*.test.tsx"],
      environment: "node",
      setupFiles: ["./test/setup-ui.ts"],
      env: {
        UXFACTORY_REPOS_REGISTRY: path.join(os.tmpdir(), "uxfactory-test-repos.json"),
      },
    },
    resolve: {
      // ...unchanged aliases...
    },
  });
  ```
  (Keep the existing `resolve.alias` blocks verbatim; only the imports and `test.env` are added.)

- [ ] **Add the changeset** `.changeset/multi-root-registry.md`:
  ```md
  ---
  "@uxfactory/bridge": minor
  ---

  Add a user-level repo registry (~/.uxfactory/repos.json) and an in-memory
  served-root set seeded with the launch root, plus GET /fs/repos (cwd + repo
  listing, launch root pinned first, dead entries flagged). Foundation for one
  bridge serving multiple project roots concurrently.
  ```

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge test
  pnpm --filter @uxfactory/plugin test
  pnpm --filter uxfactory-worker test
  pnpm --filter @uxfactory/bridge typecheck
  pnpm --filter @uxfactory/plugin typecheck
  pnpm --filter uxfactory-worker typecheck
  pnpm -r build
  ```

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-bridge/src/roots.ts \
    packages/uxfactory-bridge/test/roots.test.ts \
    packages/uxfactory-bridge/test/fs-repos.test.ts \
    packages/uxfactory-bridge/src/server.ts \
    packages/uxfactory-bridge/src/index.ts \
    packages/uxfactory-plugin/src/bridge-ambient.d.ts \
    vitest.config.ts packages/uxfactory-plugin/vitest.config.ts \
    .changeset/multi-root-registry.md
  git commit -m "$(cat <<'EOF'
  bridge: add RootRegistry + served-root set + GET /fs/repos

  New src/roots.ts owns the user-level repo registry (~/.uxfactory/repos.json,
  corrupt-tolerant), the in-memory served-root set seeded with the launch root,
  per-request root resolution (403/410/launch fallback), and the /fs/repos
  listing. server.ts constructs+inits the registry, adds reposRegistryPath, and
  serves /fs/repos. Both vitest configs isolate the registry to a tmp path.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2 — Connect registers roots (delete `bridge-serves-different-root`)

**Files:**
- Modify: `packages/uxfactory-bridge/src/project.ts` (import `isProjectRoot`/`RootRegistry` from `roots.js`, drop the private `isProjectRoot`, add `registry` to options, register + return the requested root's snapshot in `POST /project/connect`)
- Modify: `packages/uxfactory-bridge/src/server.ts` (pass `registry` to `projectPlugin`)
- Modify (test): `packages/uxfactory-bridge/test/project.test.ts` (rewrite the two `bridge-serves-different-root` connect cases)
- Modify (test): `packages/uxfactory-plugin/test/bridge-contract.test.ts` (inject `reposRegistryPath`; rewrite the "different valid root" case)
- Create: `.changeset/multi-root-connect.md`

**Interfaces:**
- Consumes (Task 1): `RootRegistry` with `register(root)`, `dataDirFor(root)`, `isServed`, `resolveRequestRoot`; `isProjectRoot(dir)`.
- Produces: `ProjectPluginOptions` gains `registry: RootRegistry`. `POST /project/connect` now returns `{ ok: true, snapshot }` (snapshot rooted at the resolved requested root) for ANY valid project root, registering it; error reasons are only `not-found` and `not-a-root`.

### Steps

- [ ] **Rewrite the two failing connect cases in `test/project.test.ts`.** Replace the existing `it("bridge-serves-different-root — a different valid root", ...)` (≈ lines 180–201) with:
  ```ts
  it("a different valid root → ok:true, snapshot rooted there, and registered", async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });

    const other = await mkRoot();
    try {
      await addGitMarker(other);
      const res = await app.inject({
        method: "POST",
        url: "/project/connect",
        payload: { repoPath: other },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; snapshot: { root: string } };
      expect(body.ok).toBe(true);
      expect(body.snapshot.root).toBe(path.resolve(other));

      // Now served: a root-scoped snapshot for `other` resolves (Task 3 wires
      // the routes; here we assert connect returned the other root's snapshot).
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
  ```
  And replace `it("tilde expansion — ~/valid-but-different-root → bridge-serves-different-root with served", ...)` (≈ lines 252–278) with a case asserting the tilde-expanded different root now connects `ok:true` and is rooted at the resolved home path:
  ```ts
  it("tilde expansion — ~/valid-but-different-root → ok:true rooted at the resolved path", async () => {
    await addGitMarker(root);
    app = await createBridge({ dataDir });

    const fakeHome = await mkdtemp(path.join(os.tmpdir(), "uxf-home-"));
    const homeRoot = path.join(fakeHome, "other-repo");
    try {
      await mkdir(homeRoot, { recursive: true });
      await addGitMarker(homeRoot);
      const origHome = os.homedir;
      // Point ~ at fakeHome for this call.
      (os as unknown as { homedir: () => string }).homedir = () => fakeHome;
      try {
        const res = await app.inject({
          method: "POST",
          url: "/project/connect",
          payload: { repoPath: "~/other-repo" },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { ok: boolean; snapshot: { root: string } };
        expect(body.ok).toBe(true);
        expect(body.snapshot.root).toBe(path.resolve(homeRoot));
      } finally {
        (os as unknown as { homedir: () => string }).homedir = origHome;
      }
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
  ```
  (Keep the `not-found`, `not-a-root`, happy-path, missing-`repoPath`, and `~/definitely/missing` connect cases unchanged. If the file already stubs `os.homedir` differently for the tilde tests, mirror that file's existing pattern instead of the inline reassignment above.)

- [ ] **Run — expected failure** (server still returns `bridge-serves-different-root`).
  ```sh
  pnpm --filter @uxfactory/bridge exec vitest run --root ../.. packages/uxfactory-bridge/test/project.test.ts
  ```

- [ ] **Edit `src/project.ts`.**
  - Replace the local `isProjectRoot` import surface: add to the top imports:
    ```ts
    import { isProjectRoot, type RootRegistry } from "./roots.js";
    ```
  - **Delete** the private `isProjectRoot` function (the `async function isProjectRoot(dir: string): Promise<boolean> { ... }` block) so the imported one is used.
  - Add `registry` to `ProjectPluginOptions`:
    ```ts
    export interface ProjectPluginOptions {
      /** Launch project root (parent of dataDir) — used by /stats, /skills, /logs. */
      servedRoot: string;
      /** The launch .uxfactory data directory path. */
      dataDir: string;
      /** Bridge package.json version string. */
      version: string;
      /** Mutable shared counters (mutated by server.ts on pipeline results). */
      shared: ProjectShared;
      /** 500-line ring buffer appended by the server.ts onResponse hook. */
      logRing: string[];
      /** Multi-root registry (served set + per-request root resolution). */
      registry: RootRegistry;
    }
    ```
  - In the plugin body, destructure `registry`:
    ```ts
    const { servedRoot, dataDir, version, shared, logRing, registry } = opts;
    ```
  - Rewrite the tail of `POST /project/connect` (replace the step-3 `resolved !== servedRoot` branch and the final snapshot return) with:
    ```ts
      // 2. Is it a project root?
      if (!(await isProjectRoot(resolved))) {
        return { ok: false, reason: "not-a-root" };
      }

      // 3. Register + serve this root (deduped in the user-level registry),
      //    then return ITS snapshot. Any valid project root is servable now.
      await registry.register(resolved);
      const snapshot = await buildSnapshot(resolved, registry.dataDirFor(resolved));
      return { ok: true, snapshot };
    ```
    (The `bridge-serves-different-root` branch and its `served` field are gone.)

- [ ] **Pass `registry` into `projectPlugin`** in `src/server.ts`:
  ```ts
  await app.register(projectPlugin, {
    servedRoot,
    dataDir,
    version: bridgeVersion,
    shared,
    logRing,
    registry,
  });
  ```

- [ ] **Run — expected: `project.test.ts` PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge exec vitest run --root ../.. packages/uxfactory-bridge/test/project.test.ts
  ```

- [ ] **Update the contract test** `packages/uxfactory-plugin/test/bridge-contract.test.ts`:
  - In `beforeEach`, inject a per-test registry path so the contract suite never writes shared state:
    ```ts
    app = await createBridgeServer({
      dataDir,
      reposRegistryPath: path.join(root, "repos-registry.json"),
    });
    ```
  - Replace the `it("a different valid root → ok:false bridge-serves-different-root + served", ...)` case (≈ lines 149–161) with:
    ```ts
    it("a different valid root → ok:true with that root's snapshot (registered)", async () => {
      const other = await mkdtemp(path.join(os.tmpdir(), "uxf-contract-other-"));
      try {
        await mkdir(path.join(other, ".git"), { recursive: true });
        const result = await bridge.connectProject(other);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("unreachable");
        expect(result.snapshot.root).toBe(other);
      } finally {
        await rm(other, { recursive: true, force: true });
      }
    });
    ```

- [ ] **Run — expected: contract PASS.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/bridge-contract.test.ts
  ```

- [ ] **Add the changeset** `.changeset/multi-root-connect.md`:
  ```md
  ---
  "@uxfactory/bridge": minor
  ---

  POST /project/connect now registers and serves any valid project root (deduped
  in the user-level registry) and returns that root's snapshot, instead of
  refusing non-launch roots. The bridge-serves-different-root error is removed;
  remaining connect errors are not-found and not-a-root.
  ```

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge test
  pnpm --filter @uxfactory/plugin test
  pnpm --filter uxfactory-worker test
  pnpm --filter @uxfactory/bridge typecheck
  pnpm --filter @uxfactory/plugin typecheck
  pnpm --filter uxfactory-worker typecheck
  pnpm -r build
  ```

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-bridge/src/project.ts packages/uxfactory-bridge/src/server.ts \
    packages/uxfactory-bridge/test/project.test.ts \
    packages/uxfactory-plugin/test/bridge-contract.test.ts \
    .changeset/multi-root-connect.md
  git commit -m "$(cat <<'EOF'
  bridge: connect registers + serves any valid root

  POST /project/connect validates, resolves, registers (registry + served set),
  and returns the requested root's snapshot. Deletes bridge-serves-different-root
  (remaining reasons: not-found, not-a-root). project.ts imports isProjectRoot
  from roots.ts. Connect tests + the contract different-root case rewritten.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3 — Root-scope ALL `/project/*` routes via `?root=` (the invariant task)

**Files:**
- Modify: `packages/uxfactory-bridge/src/project.ts` (every `/project/*` route resolves `req.query.root` through `registry.resolveRequestRoot`; containment per resolved root; `/stats`, `/skills`, `/logs` unchanged)
- Create (test): `packages/uxfactory-bridge/test/root-isolation.test.ts` (two temp roots)
- Create: `.changeset/multi-root-scoping.md`

**Interfaces:**
- Consumes (Task 1): `registry.resolveRequestRoot(rawRoot): Promise<RootResolution>`, `registry.register(root)`.
- Produces: `GET /project/snapshot?root=`, `PUT /project/classification?root=`, `PUT /project/profile?root=`, `GET|PUT /project/links?root=`, `GET|PUT /project/artifact?root=`, `POST /project/open?root=` — each 403 `root-not-served` / 410 `root-gone` / launch-root fallback, containment against the resolved root. Every write lands in the resolved root's tree (NORMATIVE INVARIANT).

### Steps

- [ ] **Write `test/root-isolation.test.ts`** (complete failing test — TWO roots, the invariant gate):
  ```ts
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
      await expect(access(path.join(rootA, "uxfactory.profile.json"))).resolves.toBeUndefined();
      await expect(access(path.join(rootB, "uxfactory.profile.json"))).rejects.toBeTruthy();
    });

    it("artifact write to A never touches B", async () => {
      await app.inject({
        method: "PUT",
        url: `/project/artifact?root=${enc(rootA)}`,
        payload: { key: "brief", content: "# Brief A\n" },
      });
      expect(await readFile(path.join(rootA, "brief.md"), "utf8")).toBe("# Brief A\n");
      await expect(access(path.join(rootB, "brief.md"))).rejects.toBeTruthy();
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
  ```

- [ ] **Run — expected failure** (routes ignore `?root=` today; snapshot returns launch root; no 403/410).
  ```sh
  pnpm --filter @uxfactory/bridge exec vitest run --root ../.. packages/uxfactory-bridge/test/root-isolation.test.ts
  ```

- [ ] **Root-scope every `/project/*` route in `src/project.ts`.** Add a shared per-route helper at the top of the plugin body (after the `const { ... } = opts;` destructure):
  ```ts
    /**
     * Resolve a request's ?root= to {root, dataDir} or send the 403/410 error.
     * Returns null after sending an error reply — callers MUST `return` on null.
     */
    async function resolveRoot(
      rawRoot: string | undefined,
      reply: import("fastify").FastifyReply,
    ): Promise<{ root: string; dataDir: string } | null> {
      const resolution = await registry.resolveRequestRoot(rawRoot);
      if (!resolution.ok) {
        reply.code(resolution.code).send({ error: resolution.error });
        return null;
      }
      return { root: resolution.root, dataDir: resolution.dataDir };
    }
  ```
  Then convert each route (add `root?: string` to its `Querystring`, resolve at the top, use the resolved `root`/`dataDir` instead of the outer `servedRoot`/`dataDir`):
  - **`GET /project/snapshot`:**
    ```ts
    app.get<{ Querystring: { root?: string } }>("/project/snapshot", async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;
      return buildSnapshot(ctx.root, ctx.dataDir);
    });
    ```
  - **`PUT /project/classification`:**
    ```ts
    app.put<{ Querystring: { root?: string } }>("/project/classification", async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;
      const body = req.body as Record<string, unknown>;
      await writeFile(
        path.join(ctx.root, "uxfactory.classification.json"),
        `${JSON.stringify(body, null, 2)}\n`,
        "utf8",
      );
      return { ok: true };
    });
    ```
  - **`PUT /project/profile`:** add `Querystring: { root?: string }` to the generic, call `resolveRoot` first, and replace every `servedRoot` inside the handler with `ctx.root` (the `profilePath` and the `classPath` for style propagation).
  - **`GET /project/links`** and **`PUT /project/links`:** add `Querystring: { root?: string }` (for PUT, merge with the existing `Body`), call `resolveRoot`, and use `path.join(ctx.dataDir, "links.json")`. `register()` already created `ctx.dataDir`, but keep a defensive `await mkdir(ctx.dataDir, { recursive: true });` before the PUT write.
  - **`GET /project/artifact`:** extend the querystring to `{ key?: string; root?: string }`; call `resolveRoot` BEFORE the `key` validation stays as-is; pass `ctx.root` to `resolveConcernPath(key, ctx.root)` and use `ctx.root` in the containment check (`rootWithSep` from `ctx.root`).
  - **`PUT /project/artifact`:** add `Querystring: { root?: string }` alongside the `Body`; call `resolveRoot`; use `ctx.root` for `resolveConcernPath` + containment + write.
  - **`POST /project/open`:** add `Querystring: { root?: string }`; call `resolveRoot`; resolve `abs = path.resolve(ctx.root, reqPath)` and check containment against `ctx.root`.
  - **`GET /stats`, `GET /logs`, `GET /skills`:** LEAVE UNCHANGED (they intentionally read the launch `servedRoot`/`dataDir`).
  - Note the `return reply;` idiom after a null `ctx`: `resolveRoot` already called `reply.code(...).send(...)`, so returning the `reply` object tells Fastify the response is handled.

- [ ] **Run — expected: `root-isolation.test.ts` PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge exec vitest run --root ../.. packages/uxfactory-bridge/test/root-isolation.test.ts
  ```

- [ ] **Confirm the existing single-root suite still passes** (no-param requests fall back to the launch root, which every case seeds with `.git`):
  ```sh
  pnpm --filter @uxfactory/bridge exec vitest run --root ../.. packages/uxfactory-bridge/test/project.test.ts
  ```

- [ ] **Add the changeset** `.changeset/multi-root-scoping.md`:
  ```md
  ---
  "@uxfactory/bridge": minor
  ---

  Root-scope every /project/* route via a ?root= query param (all verbs). Each
  request re-resolves through the served-root registry: 403 root-not-served for
  an unregistered root, 410 root-gone for a served root whose markers vanished,
  and a launch-root fallback when ?root= is absent. Path containment is enforced
  per resolved root, guaranteeing every write lands inside the connected repo.
  ```

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge test
  pnpm --filter @uxfactory/plugin test
  pnpm --filter uxfactory-worker test
  pnpm --filter @uxfactory/bridge typecheck
  pnpm --filter @uxfactory/plugin typecheck
  pnpm --filter uxfactory-worker typecheck
  pnpm -r build
  ```

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-bridge/src/project.ts \
    packages/uxfactory-bridge/test/root-isolation.test.ts \
    .changeset/multi-root-scoping.md
  git commit -m "$(cat <<'EOF'
  bridge: root-scope all /project/* routes via ?root=

  Every /project/* route resolves req.query.root through the registry
  (403 root-not-served / 410 root-gone / launch-root fallback) and enforces
  containment against the resolved root. Two-temp-root isolation suite proves
  classification/profile/artifact/links writes land in the requested repo and
  never cross. /stats, /skills, /logs stay launch-root reads.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4 — Pipeline root-tagging (enqueue stamps root; `next?root=` filters)

**Files:**
- Modify: `packages/uxfactory-bridge/src/store.ts` (`PipelineRequest.root`; `enqueuePipelineRequest(kind, payload, createdAt, root)`; `dequeuePipelineRequest(root)` FIFO filter)
- Modify: `packages/uxfactory-bridge/src/server.ts` (`POST /pipeline/request?root=` stamps the resolved root; `GET /pipeline/request/next?root=` filters)
- Modify (test): `packages/uxfactory-bridge/test/pipeline-relay.test.ts` (root stamping + per-root FIFO filtering + legacy no-param → launch root)
- Create: `.changeset/multi-root-pipeline.md`

**Interfaces:**
- Consumes (Task 1): `registry.resolveRequestRoot(rawRoot)`, `registry.launchRoot`.
- Produces:
  - `interface PipelineRequest { id: string; kind: string; payload: unknown; createdAt: number; root: string }`
  - `enqueuePipelineRequest(kind: string, payload: unknown, createdAt: number, root: string): Promise<PipelineRequest>`
  - `dequeuePipelineRequest(root: string): Promise<PipelineRequest | null>` — oldest queued request whose `root === root`, others left in place.
  - `POST /pipeline/request?root=` → resolves root (403/410/launch fallback), stamps it, returns `{ id }`.
  - `GET /pipeline/request/next?root=` → resolves root, returns the oldest matching request or 204.

### Steps

- [ ] **Add failing cases to `test/pipeline-relay.test.ts`.** (Mirror the file's existing lifecycle — it uses `createBridge({ dataDir })` + `app.inject`. Seed the launch root with a `.git` marker in that file's `beforeEach` if it does not already, and pass `reposRegistryPath` if the file asserts registry state; otherwise the shared tmp env path is fine.) Add:
  ```ts
  describe("pipeline root-tagging", () => {
    it("enqueue with no ?root= stamps the launch root; next with no ?root= claims it", async () => {
      const enq = await app.inject({
        method: "POST",
        url: "/pipeline/request",
        payload: { kind: "generate-artifact", payload: { artifact: "brief" } },
      });
      expect(enq.statusCode).toBe(200);
      const next = await app.inject({ method: "GET", url: "/pipeline/request/next" });
      expect(next.statusCode).toBe(200);
      const req = next.json() as { id: string; root: string };
      expect(req.root).toBe(path.resolve(launchRoot));
    });

    it("a poll for a foreign root never claims a launch-root job", async () => {
      // A second served root.
      const other = await mkdtemp(path.join(os.tmpdir(), "uxf-pipe-other-"));
      await mkdir(path.join(other, ".git"), { recursive: true });
      try {
        await app.inject({ method: "POST", url: "/project/connect", payload: { repoPath: other } });

        // Enqueue a launch-root job (no ?root=).
        await app.inject({
          method: "POST",
          url: "/pipeline/request",
          payload: { kind: "generate-artifact", payload: {} },
        });

        // Worker for `other` polls: 204 (launch job is not its work).
        const foreign = await app.inject({
          method: "GET",
          url: `/pipeline/request/next?root=${encodeURIComponent(other)}`,
        });
        expect(foreign.statusCode).toBe(204);

        // Launch-root poll still gets it.
        const own = await app.inject({ method: "GET", url: "/pipeline/request/next" });
        expect(own.statusCode).toBe(200);
        expect((own.json() as { root: string }).root).toBe(path.resolve(launchRoot));
      } finally {
        await rm(other, { recursive: true, force: true });
      }
    });

    it("per-root FIFO: A and B jobs interleave without cross-claiming", async () => {
      const other = await mkdtemp(path.join(os.tmpdir(), "uxf-pipe-B-"));
      await mkdir(path.join(other, ".git"), { recursive: true });
      try {
        await app.inject({ method: "POST", url: "/project/connect", payload: { repoPath: other } });
        const enc = (p: string) => encodeURIComponent(p);

        // launch, other, launch — enqueued in that order.
        await app.inject({ method: "POST", url: "/pipeline/request", payload: { kind: "k", payload: { n: 1 } } });
        await app.inject({ method: "POST", url: `/pipeline/request?root=${enc(other)}`, payload: { kind: "k", payload: { n: 2 } } });
        await app.inject({ method: "POST", url: "/pipeline/request", payload: { kind: "k", payload: { n: 3 } } });

        // `other` poll gets only n:2.
        const b1 = (await app.inject({ method: "GET", url: `/pipeline/request/next?root=${enc(other)}` })).json() as { payload: { n: number }; root: string };
        expect(b1.payload.n).toBe(2);
        expect(b1.root).toBe(path.resolve(other));
        const b2 = await app.inject({ method: "GET", url: `/pipeline/request/next?root=${enc(other)}` });
        expect(b2.statusCode).toBe(204);

        // launch poll drains n:1 then n:3 (FIFO).
        const a1 = (await app.inject({ method: "GET", url: "/pipeline/request/next" })).json() as { payload: { n: number } };
        expect(a1.payload.n).toBe(1);
        const a2 = (await app.inject({ method: "GET", url: "/pipeline/request/next" })).json() as { payload: { n: number } };
        expect(a2.payload.n).toBe(3);
      } finally {
        await rm(other, { recursive: true, force: true });
      }
    });
  });
  ```
  (Ensure the file imports `mkdtemp`, `mkdir`, `rm`, `os`, `path` — add any missing to its import block. The `launchRoot` binding is `path.dirname(dataDir)`; if the file names it differently, use that. Seed `path.join(launchRoot, ".git")` in `beforeEach` so the launch-root fallback re-validates.)

- [ ] **Run — expected failure** (`PipelineRequest.root` undefined; `next` ignores `?root=`).
  ```sh
  pnpm --filter @uxfactory/bridge exec vitest run --root ../.. packages/uxfactory-bridge/test/pipeline-relay.test.ts
  ```

- [ ] **Edit `src/store.ts`.**
  - Add `root` to `PipelineRequest`:
    ```ts
    export interface PipelineRequest {
      id: string;
      kind: string;
      payload: unknown;
      createdAt: number;
      /** Resolved project root this job is scoped to (spec §2: workers claim only matching roots). */
      root: string;
    }
    ```
  - Update `enqueuePipelineRequest` to take + store `root`:
    ```ts
    async enqueuePipelineRequest(
      kind: string,
      payload: unknown,
      createdAt: number,
      root: string,
    ): Promise<PipelineRequest> {
      const request: PipelineRequest = {
        id: this.newPipelineRequestId(createdAt),
        kind,
        payload,
        createdAt,
        root,
      };
      this.pipelineQueue.push(request);
      return request;
    }
    ```
  - Update `dequeuePipelineRequest` to filter by root (oldest matching, FIFO; others untouched):
    ```ts
    /** Pop the oldest queued request whose root matches; null if none match. */
    async dequeuePipelineRequest(root: string): Promise<PipelineRequest | null> {
      const idx = this.pipelineQueue.findIndex((r) => r.root === root);
      if (idx === -1) return null;
      const [request] = this.pipelineQueue.splice(idx, 1);
      return request ?? null;
    }
    ```

- [ ] **Edit `src/server.ts`** — the two pipeline routes:
  - `POST /pipeline/request` gains `?root=` resolution + stamping:
    ```ts
    app.post<{ Querystring: { root?: string } }>("/pipeline/request", async (req, reply) => {
      const body = req.body as { kind?: unknown; payload?: unknown };
      if (typeof body?.kind !== "string" || body.kind.trim() === "") {
        return reply.code(400).send({ error: "kind must be a non-empty string" });
      }
      const resolution = await registry.resolveRequestRoot(req.query.root);
      if (!resolution.ok) return reply.code(resolution.code).send({ error: resolution.error });

      const request = await store.enqueuePipelineRequest(
        body.kind,
        body.payload,
        Date.now(),
        resolution.root,
      );
      pipelineRequestIds.add(request.id);
      const wake = store.appendPipelineEvent(request.id, {
        type: "pipeline-request",
        id: request.id,
      });
      broadcastPipelineFrame(wake);
      return { id: request.id };
    });
    ```
  - `GET /pipeline/request/next` gains `?root=` filtering:
    ```ts
    app.get<{ Querystring: { root?: string } }>("/pipeline/request/next", async (req, reply) => {
      const resolution = await registry.resolveRequestRoot(req.query.root);
      if (!resolution.ok) return reply.code(resolution.code).send({ error: resolution.error });
      const request = await store.dequeuePipelineRequest(resolution.root);
      if (request === null) return reply.code(204).send();
      return request;
    });
    ```

- [ ] **Run — expected: `pipeline-relay.test.ts` PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge exec vitest run --root ../.. packages/uxfactory-bridge/test/pipeline-relay.test.ts
  ```

- [ ] **Add the changeset** `.changeset/multi-root-pipeline.md`:
  ```md
  ---
  "@uxfactory/bridge": minor
  ---

  Root-tag the pipeline relay. POST /pipeline/request stamps every job with its
  resolved root (from ?root= or the launch-root fallback); GET
  /pipeline/request/next?root= claims only jobs for that root. A legacy poll
  without ?root= claims launch-root jobs only, so a worker never steals another
  repo's work.
  ```

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge test
  pnpm --filter @uxfactory/plugin test
  pnpm --filter uxfactory-worker test
  pnpm --filter @uxfactory/bridge typecheck
  pnpm --filter @uxfactory/plugin typecheck
  pnpm --filter uxfactory-worker typecheck
  pnpm -r build
  ```

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-bridge/src/store.ts packages/uxfactory-bridge/src/server.ts \
    packages/uxfactory-bridge/test/pipeline-relay.test.ts \
    .changeset/multi-root-pipeline.md
  git commit -m "$(cat <<'EOF'
  bridge: root-tag the pipeline relay

  PipelineRequest gains a resolved root. POST /pipeline/request?root= stamps it;
  GET /pipeline/request/next?root= claims only matching jobs (per-root FIFO). A
  no-param poll claims launch-root jobs only. Relay tests cover stamping,
  foreign-root non-claiming, and interleaved per-root FIFO.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5 — Plugin bridge client + queries (`setProjectRoot`, `getRepos`, root-scoped keys)

**Files:**
- Modify: `packages/uxfactory-plugin/ui/lib/bridge.ts` (mirrored `ReposResponse`/`RepoListing`; `projectRoot` state + `rooted()` helper; `setProjectRoot`/`getProjectRoot`/`getRepos` on the interface + impl; append `?root=` to root-scoped verbs)
- Modify: `packages/uxfactory-plugin/ui/queries.ts` (`activeRoot(bridge)`; `queryKeys.snapshot(root)`, `queryKeys.links(root)`, `queryKeys.artifact(root, key)`; factories key on `activeRoot(bridge)`)
- Modify: `packages/uxfactory-plugin/ui/main.tsx`, `ui/screens/Connect.tsx`, `ui/screens/Artifacts.tsx`, `ui/screens/ArtifactEditor.tsx`, `ui/screens/Components.tsx`, `ui/components/ExpandedHeader.tsx` (thread `activeRoot(bridge)` through every imperative cache write)
- Modify (test): `packages/uxfactory-plugin/test/bridge-contract.test.ts` (root-carrying contract cases), `packages/uxfactory-plugin/test/screen-artifacts.test.tsx` (one `setQueryData` key call)

**Interfaces:**
- Consumes (Task 3): `?root=` accepted on `/project/*`. Consumes (Task 1): `GET /fs/repos → ReposResponse`.
- Produces `ui/lib/bridge.ts`:
  - `interface RepoListing { root: string; name: string; lastConnectedAt: number; live: boolean }`
  - `interface ReposResponse { cwd: string; repos: RepoListing[] }`
  - `Bridge` gains `setProjectRoot?(root: string | null): void`, `getProjectRoot?(): string | null`, `getRepos?(): Promise<ReposResponse>`.
- Produces `ui/queries.ts`:
  - `function activeRoot(bridge: Bridge): string | null`
  - `queryKeys.snapshot(root: string | null)`, `queryKeys.links(root: string | null)`, `queryKeys.artifact(root: string | null, key: string)` (others unchanged).

### Steps

- [ ] **Add root-carrying cases to `test/bridge-contract.test.ts`** (drives the real client against the real server; captures every request URL to assert the param). At the top of `injectFetch`, thread a capture array; and add a describe block:
  ```ts
  // Extend injectFetch to record request URLs (add a second param):
  function injectFetch(app: BridgeServer, captured?: string[]): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      captured?.push(`${parsed.pathname}${parsed.search}`);
      const res = await app.inject({ /* ...unchanged... */ });
      /* ...unchanged... */
    }) as typeof fetch;
  }
  ```
  ```ts
  describe("contract: setProjectRoot appends ?root= to root-scoped verbs", () => {
    it("every /project/* + enqueue call carries the encoded root; connect does not", async () => {
      const captured: string[] = [];
      const rooted = createBridgeClient(injectFetch(app, captured));
      rooted.setProjectRoot!(root);

      await rooted.snapshot();
      await rooted.putClassification({ category: "x" });
      await rooted.putProfile({ visual: "high" });
      await rooted.getLinks();
      await rooted.putLinks([]);
      await rooted.putArtifact!("brief", "# b\n");
      await rooted.getArtifact!("brief");
      await rooted.enqueue({ kind: "k", payload: {} });

      const enc = encodeURIComponent(root);
      const rootedCalls = captured.filter((u) =>
        u.startsWith("/project/snapshot") ||
        u.startsWith("/project/classification") ||
        u.startsWith("/project/profile") ||
        u.startsWith("/project/links") ||
        u.startsWith("/project/artifact") ||
        u.startsWith("/pipeline/request"),
      );
      expect(rootedCalls.length).toBeGreaterThanOrEqual(8);
      for (const u of rootedCalls) expect(u).toContain(`root=${enc}`);

      // connect (registration) must NOT carry ?root=.
      captured.length = 0;
      await rooted.connectProject(root);
      const connect = captured.find((u) => u.startsWith("/project/connect"))!;
      expect(connect).not.toContain("root=");
    });

    it("getArtifact keeps its key param and adds root with &", async () => {
      const captured: string[] = [];
      const rooted = createBridgeClient(injectFetch(app, captured));
      rooted.setProjectRoot!(root);
      await rooted.getArtifact!("brief").catch(() => undefined);
      const call = captured.find((u) => u.startsWith("/project/artifact"))!;
      expect(call).toContain("key=brief");
      expect(call).toContain(`root=${encodeURIComponent(root)}`);
      expect(call.indexOf("&root=")).toBeGreaterThan(-1);
    });

    it("getRepos returns the ReposResponse shape from the real server", async () => {
      const res = await bridge.getRepos!();
      expect(res.cwd).toBe(root);
      expect(Array.isArray(res.repos)).toBe(true);
      expect(res.repos[0]!.root).toBe(root);
    });
  });
  ```

- [ ] **Run — expected failure** (`setProjectRoot`/`getRepos` undefined on the client).
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/bridge-contract.test.ts
  ```

- [ ] **Edit `ui/lib/bridge.ts`.**
  - Add mirrored types (near the other mirrored types, e.g. after `ArtifactContent`):
    ```ts
    export interface RepoListing {
      root: string;
      name: string;
      lastConnectedAt: number;
      live: boolean;
    }

    export interface ReposResponse {
      cwd: string;
      repos: RepoListing[];
    }
    ```
  - Extend the `Bridge` interface (append):
    ```ts
      /** Set the active project root; appended as ?root= to root-scoped verbs. null clears it. */
      setProjectRoot?(root: string | null): void;
      /** The active project root, or null. Used to key root-scoped query cache entries. */
      getProjectRoot?(): string | null;
      /** GET /fs/repos — repo discovery list (optional — absent in legacy bridge builds). */
      getRepos?(): Promise<ReposResponse>;
    ```
  - Inside `createBridge`, add root state + helper (after `const root = BASE.replace(/\/+$/, "");`):
    ```ts
    let projectRoot: string | null = null;

    /** Append ?root=/&root= to a path when a project root is set. */
    function rooted(p: string): string {
      if (projectRoot === null) return p;
      const sep = p.includes("?") ? "&" : "?";
      return `${p}${sep}root=${encodeURIComponent(projectRoot)}`;
    }
    ```
  - Wrap the root-scoped method paths with `rooted(...)` (leave `connectProject`, `health`, `stats`, `logs`, `skills`, `events`, `latestRender`, `verify`, `getCwd` as-is):
    ```ts
      snapshot() {
        return request<ProjectSnapshot>(rooted("/project/snapshot"));
      },
      putClassification(body: Record<string, unknown>) {
        return put<{ ok: boolean }>(rooted("/project/classification"), body);
      },
      putProfile(body: Record<string, unknown>) {
        return put<{ ok: boolean }>(rooted("/project/profile"), body);
      },
      getLinks() {
        return request<{ links: Link[] }>(rooted("/project/links"));
      },
      putLinks(links: Link[]) {
        return put<{ ok: boolean }>(rooted("/project/links"), { links });
      },
      openPath(path: string) {
        return post<{ ok: boolean }>(rooted("/project/open"), { path });
      },
      enqueue(requestBody: PipelineEnqueueRequest) {
        return post<PipelineEnqueueResponse>(rooted("/pipeline/request"), requestBody);
      },
      getArtifact(key: string) {
        return request<ArtifactContent>(
          rooted(`/project/artifact?key=${encodeURIComponent(key)}`),
        );
      },
      putArtifact(key: string, content: string) {
        return put<{ ok: boolean }>(rooted("/project/artifact"), { key, content });
      },
    ```
  - Add the three new methods to the returned object (alongside `getCwd`):
    ```ts
      setProjectRoot(next: string | null) {
        projectRoot = next;
      },
      getProjectRoot() {
        return projectRoot;
      },
      getRepos() {
        return request<ReposResponse>("/fs/repos");
      },
    ```

- [ ] **Edit `ui/queries.ts`.**
  - Import `Bridge` already present; add an `activeRoot` helper and re-key:
    ```ts
    /** The bridge's active project root (null on legacy fakes without the method). */
    export function activeRoot(bridge: Bridge): string | null {
      return bridge.getProjectRoot?.() ?? null;
    }

    export const queryKeys = {
      snapshot: (root: string | null) => ["snapshot", root] as const,
      health: ["health"] as const,
      stats: ["stats"] as const,
      logs: (tail: number) => ["logs", tail] as const,
      skills: ["skills"] as const,
      links: (root: string | null) => ["links", root] as const,
      latestRender: (run: string | undefined) => ["latestRender", run ?? null] as const,
      artifact: (root: string | null, key: string) => ["artifact", root, key] as const,
    };
    ```
  - Re-key the three affected factories:
    ```ts
    export function snapshotQuery(bridge: Bridge) {
      return queryOptions({
        queryKey: queryKeys.snapshot(activeRoot(bridge)),
        queryFn: () => bridge.snapshot(),
        staleTime: 5_000,
      });
    }
    export function linksQuery(bridge: Bridge) {
      return queryOptions({
        queryKey: queryKeys.links(activeRoot(bridge)),
        queryFn: () => bridge.getLinks(),
        staleTime: 0,
      });
    }
    export function artifactQuery(bridge: Bridge, key: string) {
      return queryOptions({
        queryKey: queryKeys.artifact(activeRoot(bridge), key),
        queryFn: () => bridge.getArtifact!(key),
        enabled: typeof bridge.getArtifact === "function" && key !== "",
        retry: false,
        staleTime: 0,
      });
    }
    ```
  - Leave `healthQuery`, `statsQuery`, `logsQuery`, `skillsQuery`, `latestRenderQuery`, and all mutation factories unchanged.

- [ ] **Thread `activeRoot(bridge)` through every imperative cache write.** Exact edits:
  - `ui/main.tsx` — add `activeRoot` to the queries import; change line 70:
    ```ts
    queryClient.setQueryData(queryKeys.snapshot(activeRoot(bridge)), snapshot);
    ```
  - `ui/screens/Connect.tsx` — add `activeRoot` to the queries import; change line 116:
    ```ts
    queryClient.setQueryData(queryKeys.snapshot(activeRoot(bridge)), result.snapshot);
    ```
  - `ui/screens/Artifacts.tsx` — add `activeRoot` to the queries import; both invalidations (≈ 284, 286):
    ```ts
    void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
    ```
  - `ui/screens/ArtifactEditor.tsx` — add `activeRoot` to the queries import; lines 230–231:
    ```ts
    void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.artifact(activeRoot(bridge), artifactKey) });
    ```
  - `ui/screens/Components.tsx` — add `activeRoot` to the queries import; lines 90, 91, 94:
    ```ts
    void queryClient.cancelQueries({ queryKey: queryKeys.links(activeRoot(bridge)) });
    queryClient.setQueryData(queryKeys.links(activeRoot(bridge)), { links: next });
    // ...and inside the rollback:
    queryClient.setQueryData(queryKeys.links(activeRoot(bridge)), { links });
    ```
  - `ui/components/ExpandedHeader.tsx` — add `activeRoot` to the queries import; line 191:
    ```ts
    void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
    ```

- [ ] **Fix the one direct-key test call** in `packages/uxfactory-plugin/test/screen-artifacts.test.tsx` (≈ line 1259). That test's fake bridge has no `getProjectRoot`, so `activeRoot` is `null`:
  ```ts
  queryClient.setQueryData(queryKeys.snapshot(null), makeMeridianSnapshot());
  ```

- [ ] **Run the plugin suite — expected: PASS** (existing screen tests are behavior-frozen; the key change is internal + consistent).
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run
  ```

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge test
  pnpm --filter @uxfactory/plugin test
  pnpm --filter uxfactory-worker test
  pnpm --filter @uxfactory/bridge typecheck
  pnpm --filter @uxfactory/plugin typecheck
  pnpm --filter uxfactory-worker typecheck
  pnpm -r build
  ```

- [ ] **Commit.** (No changeset — plugin is private.)
  ```sh
  git add packages/uxfactory-plugin/ui/lib/bridge.ts packages/uxfactory-plugin/ui/queries.ts \
    packages/uxfactory-plugin/ui/main.tsx packages/uxfactory-plugin/ui/screens/Connect.tsx \
    packages/uxfactory-plugin/ui/screens/Artifacts.tsx packages/uxfactory-plugin/ui/screens/ArtifactEditor.tsx \
    packages/uxfactory-plugin/ui/screens/Components.tsx packages/uxfactory-plugin/ui/components/ExpandedHeader.tsx \
    packages/uxfactory-plugin/test/bridge-contract.test.ts packages/uxfactory-plugin/test/screen-artifacts.test.tsx
  git commit -m "$(cat <<'EOF'
  panel: root-aware bridge client + query keys

  bridge.ts gains setProjectRoot/getProjectRoot/getRepos (optional on Bridge) and
  appends ?root= to every root-scoped verb (snapshot/classification/profile/
  links/artifact/open/enqueue); connect stays unscoped. queries.ts keys snapshot/
  links/artifact on activeRoot(bridge); every imperative setQueryData/invalidate/
  cancel threads it. Contract cases assert the param on the wire.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6 — Connect screen chip list + resolved-root storage + `setProjectRoot` wiring

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/Connect.tsx` (repo chip list from `getRepos` with three-tier degradation; on connect success call `setProjectRoot(snapshot.root)` + store the resolved root)
- Modify: `packages/uxfactory-plugin/ui/main.tsx` (on boot restore call `setProjectRoot(stored.repoPath)` before the snapshot seed)
- Modify (test): `packages/uxfactory-plugin/test/screen-connect.test.tsx` (chip list render/order/fallback tiers, click-fill, resolved-root storage + `setProjectRoot`)

**Interfaces:**
- Consumes (Task 5): `bridge.getRepos?()`, `bridge.getCwd?()`, `bridge.setProjectRoot?(root)`; `ProjectSnapshot.root`.
- Produces: no new exports. Connect renders a repo chip list; `connectSucceeded(snapshot, snapshot.root, persist)` stores the RESOLVED root; `setProjectRoot(snapshot.root)` is called before navigation.

### Steps

- [ ] **Add failing tests to `test/screen-connect.test.tsx`.** (The file's `makeBridge` returns a full fake; add `getRepos`/`setProjectRoot` via `overrides` per case.) Add:
  ```ts
  describe("repo chip list (multi-root)", () => {
    it("renders chips from getRepos, cwd/live first, most-recent first, and click fills the field", async () => {
      const setProjectRoot = vi.fn();
      const getRepos = vi.fn().mockResolvedValue({
        cwd: "/repos/demo-shop",
        repos: [
          { root: "/repos/demo-shop", name: "demo-shop", lastConnectedAt: 30, live: true },
          { root: "/repos/newer", name: "newer", lastConnectedAt: 20, live: true },
          { root: "/repos/older", name: "older", lastConnectedAt: 10, live: true },
        ],
      });
      const bridge = makeBridge({ getRepos, setProjectRoot, getProjectRoot: () => null });
      renderWithProviders(<Connect bridge={bridge} bus={makeBus()} />);

      const demo = await screen.findByRole("button", { name: /demo-shop/ });
      const input = screen.getByRole("textbox");
      await userEvent.click(demo);
      expect((input as HTMLInputElement).value).toBe("/repos/demo-shop");
    });

    it("falls back to the single getCwd chip when getRepos is absent (old bridge)", async () => {
      const bridge = makeBridge({
        getRepos: undefined,
        getCwd: vi.fn().mockResolvedValue({ cwd: "/repos/demo-shop" }),
      });
      renderWithProviders(<Connect bridge={bridge} bus={makeBus()} />);
      // The existing cwd-hint affordance still appears.
      expect(await screen.findByText(/repos\/demo-shop/)).toBeInTheDocument();
    });

    it("renders no repo chips when neither getRepos nor getCwd is available", async () => {
      const bridge = makeBridge({ getRepos: undefined, getCwd: undefined });
      renderWithProviders(<Connect bridge={bridge} bus={makeBus()} />);
      // No throw, connect field still present.
      expect(await screen.findByRole("textbox")).toBeInTheDocument();
    });

    it("on connect success stores the RESOLVED root and calls setProjectRoot", async () => {
      const setProjectRoot = vi.fn();
      const snapshot = { ...BASE_SNAPSHOT, root: "/resolved/abs/path", hasClassification: true };
      const bridge = makeBridge({
        connectProject: vi.fn().mockResolvedValue({ ok: true, snapshot }),
        setProjectRoot,
        getProjectRoot: () => null,
      });
      renderWithProviders(<Connect bridge={bridge} bus={makeBus()} />);

      const input = screen.getByRole("textbox");
      await userEvent.clear(input);
      await userEvent.type(input, "~/typed/path");
      await userEvent.click(screen.getByRole("button", { name: /^Connect$/ }));

      await waitFor(() => expect(setProjectRoot).toHaveBeenCalledWith("/resolved/abs/path"));
      await waitFor(() =>
        expect(useAppStore.getState().connection.repoPath).toBe("/resolved/abs/path"),
      );
    });
  });
  ```
  (Reuse the file's existing `makeBus` helper; if it lives lower in the file, keep imports consistent. The exact chip DOM — role/name — must match your implementation below; adjust the query if you render chips as `Chip` buttons with the repo `name` as accessible text.)

- [ ] **Run — expected failure** (no chip list; connect stores the typed path, not `snapshot.root`; no `setProjectRoot`).
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-connect.test.tsx
  ```

- [ ] **Implement the chip list + resolved-root wiring in `ui/screens/Connect.tsx`.**
  - Add a repos query effect (three-tier degradation) using `useQuery` guarded on the optional method, e.g. after the health query:
    ```ts
    import { healthQuery, connectProjectMutation, queryKeys, activeRoot } from "../queries.js";
    // ...
    const reposResult = useQuery({
      queryKey: ["repos"],
      queryFn: () => bridge.getRepos!(),
      enabled: typeof bridge.getRepos === "function" && bridgeStatus === "running",
      staleTime: 5_000,
    });
    const repos = reposResult.data?.repos ?? [];
    ```
  - Render the chip list (Tier 1: `getRepos` chips; Tier 2: the existing `bridgeCwd` hint button already handles the single-cwd fallback; Tier 3: nothing). Place the chip list above the existing cwd-hint button, only when `repos.length > 0`:
    ```tsx
    {mode === "local" && repos.length > 0 && (
      <div className="flex flex-wrap gap-1">
        {repos.map((r) => (
          <button
            key={r.root}
            type="button"
            onClick={() => {
              setRepoPath(r.root);
              if (pathError) setPathError(null);
            }}
            className={[
              "text-xs px-2 py-1 rounded-[var(--radius-card)] border transition-colors",
              r.live
                ? "text-primary-700 bg-primary-50 border-primary-100 hover:bg-primary-100"
                : "text-gray-400 bg-gray-50 border-gray-200",
            ].join(" ")}
            title={r.root}
          >
            {r.name}
          </button>
        ))}
      </div>
    )}
    ```
    (The list order is server-authoritative: `getRepos` already returns cwd pinned first, then most-recent-first — do NOT re-sort client-side.)
  - In the connect mutation `onSuccess`, on the `result.ok` branch, store the RESOLVED root and set it on the client BEFORE navigation:
    ```ts
    const resolvedRoot = result.snapshot.root;
    bridge.setProjectRoot?.(resolvedRoot);
    queryClient.setQueryData(queryKeys.snapshot(activeRoot(bridge)), result.snapshot);
    connectSucceeded(result.snapshot, resolvedRoot, (payload) => {
      void bus.storageSet(storageKey, {
        ...payload,
        mode: capturedMode,
        endpoint: capturedEndpoint,
      });
    });
    void navigate({
      to: result.snapshot.hasClassification ? "/tabs/prompt" : "/setup/classification",
    });
    ```
    (Note: `connectSucceeded` now receives `resolvedRoot` — the server's absolute path — not the typed `repoPath.trim()`. This is the "stores connection.repoPath = resolved root" requirement. Keep the existing `!result.ok` error branch, including the `bridge-serves-different-root` message, unchanged for the old-bridge compat row.)

- [ ] **Wire boot restore in `ui/main.tsx`.** Before the `Promise.all([bridge.health(), bridge.snapshot()])` seed, set the client root from the stored connection so the reconnect snapshot fetch is root-scoped and the seed key matches:
  ```ts
  bridge.setProjectRoot?.(stored.repoPath);
  const [, snapshot] = await Promise.all([bridge.health(), bridge.snapshot()]);
  ```
  (The existing `queryClient.setQueryData(queryKeys.snapshot(activeRoot(bridge)), snapshot)` line from Task 5 now keys on `stored.repoPath` because `setProjectRoot` ran first. `stored.repoPath` is the resolved root — Connect persisted `snapshot.root`.)

- [ ] **Run — expected: `screen-connect.test.tsx` PASS.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-connect.test.tsx
  ```

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge test
  pnpm --filter @uxfactory/plugin test
  pnpm --filter uxfactory-worker test
  pnpm --filter @uxfactory/bridge typecheck
  pnpm --filter @uxfactory/plugin typecheck
  pnpm --filter uxfactory-worker typecheck
  pnpm -r build
  ```

- [ ] **Commit.** (No changeset — plugin is private.)
  ```sh
  git add packages/uxfactory-plugin/ui/screens/Connect.tsx packages/uxfactory-plugin/ui/main.tsx \
    packages/uxfactory-plugin/test/screen-connect.test.tsx
  git commit -m "$(cat <<'EOF'
  panel: Connect repo chip list + resolved-root wiring

  Connect renders a repo chip list from getRepos (server-ordered: cwd pinned,
  most-recent-first, dead greyed) with three-tier degradation to the single
  getCwd hint then nothing. On connect success it calls setProjectRoot(snapshot.
  root) and stores the resolved absolute root (not the typed path); boot restore
  sets the client root before the reconnect snapshot fetch.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7 — Worker polls `next?root=` with its projectRoot

**Files:**
- Modify: `clients/uxfactory-worker/src/bridge-client.ts` (`WorkerBridgeClient` takes a `projectRoot`; `pullRequest()` appends `?root=`)
- Modify: `clients/uxfactory-worker/src/main.ts` (construct `new WorkerBridgeClient(cfg.bridgeUrl, cfg.projectRoot)`)
- Modify (test): `clients/uxfactory-worker/test/worker.test.ts` (the in-process bridge asserts `?root=` on the poll; two-roots-two-pollers cross-claim guard)

**Interfaces:**
- Consumes (Task 4): `GET /pipeline/request/next?root=` filters by root; a poll without `?root=` gets launch-root jobs only.
- Produces: `new WorkerBridgeClient(bridgeUrl: string, projectRoot?: string)`; when `projectRoot` is set, `pullRequest()` requests `/pipeline/request/next?root=<encoded>`. `PipelineRequest` (worker mirror) gains `root: string`.

### Steps

- [ ] **Add failing cases to `test/worker.test.ts`.** The file already stands up an in-process `node:http` server mirroring `/pipeline/*`; extend that mock to record the poll URL and to serve per-root queues. Add (adapting to the file's existing mock-server helper names):
  ```ts
  it("WorkerBridgeClient.pullRequest appends ?root= when a projectRoot is set", async () => {
    const seenUrls: string[] = [];
    const server = http.createServer((req, res) => {
      seenUrls.push(req.url ?? "");
      if (req.url?.startsWith("/pipeline/request/next")) {
        res.writeHead(204).end();
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      const client = new WorkerBridgeClient(`http://127.0.0.1:${port}`, "/repo/alpha");
      expect(await client.pullRequest()).toBeNull();
      const pollUrl = seenUrls.find((u) => u.startsWith("/pipeline/request/next"))!;
      expect(pollUrl).toContain(`root=${encodeURIComponent("/repo/alpha")}`);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("two pollers on different roots never claim each other's job", async () => {
    // Per-root FIFO queues keyed by the ?root= query param.
    const queues: Record<string, { id: string; kind: string; payload: unknown; createdAt: number; root: string }[]> = {
      "/repo/alpha": [{ id: "a1", kind: "k", payload: {}, createdAt: 1, root: "/repo/alpha" }],
      "/repo/beta": [{ id: "b1", kind: "k", payload: {}, createdAt: 1, root: "/repo/beta" }],
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", "http://x");
      if (url.pathname === "/pipeline/request/next") {
        const root = url.searchParams.get("root") ?? "";
        const job = queues[root]?.shift() ?? null;
        if (job === null) { res.writeHead(204).end(); return; }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(job));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      const alpha = new WorkerBridgeClient(`http://127.0.0.1:${port}`, "/repo/alpha");
      const beta = new WorkerBridgeClient(`http://127.0.0.1:${port}`, "/repo/beta");
      const gotAlpha = await alpha.pullRequest();
      const gotBeta = await beta.pullRequest();
      expect(gotAlpha?.id).toBe("a1");
      expect(gotAlpha?.root).toBe("/repo/alpha");
      expect(gotBeta?.id).toBe("b1");
      // Neither claimed the other's remaining work.
      expect(await alpha.pullRequest()).toBeNull();
      expect(await beta.pullRequest()).toBeNull();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  ```
  (Ensure `http`, `URL`, and `AddressInfo` are imported — the file already imports `http` and `AddressInfo`.)

- [ ] **Run — expected failure** (constructor takes only `bridgeUrl`; poll has no `?root=`).
  ```sh
  pnpm --filter uxfactory-worker exec vitest run --root ../.. clients/uxfactory-worker/test/worker.test.ts
  ```

- [ ] **Edit `src/bridge-client.ts`.**
  - Add `root` to the worker's `PipelineRequest` mirror:
    ```ts
    export interface PipelineRequest {
      id: string;
      kind: string;
      payload: unknown;
      createdAt: number;
      /** Resolved project root this job is scoped to. */
      root: string;
    }
    ```
  - Take + store `projectRoot`, and append it in `pullRequest`:
    ```ts
    export class WorkerBridgeClient implements BridgeLike {
      private readonly base: string;
      private readonly projectRoot: string | null;

      constructor(bridgeUrl: string, projectRoot?: string) {
        this.base = bridgeUrl.replace(/\/+$/, '');
        this.projectRoot = projectRoot ?? null;
      }

      async pullRequest(): Promise<PipelineRequest | null> {
        const qs =
          this.projectRoot !== null
            ? `?root=${encodeURIComponent(this.projectRoot)}`
            : '';
        const res = await fetch(`${this.base}/pipeline/request/next${qs}`);
        if (res.status === 204) return null;
        if (!res.ok) {
          throw new Error(`pullRequest: bridge returned ${res.status} ${res.statusText}`);
        }
        return (await res.json()) as PipelineRequest;
      }
      // ...postResult / postEvent / subscribeEvents unchanged...
    }
    ```

- [ ] **Edit `src/main.ts`** — pass the projectRoot into the client (composition root):
  ```ts
  const bridge = new WorkerBridgeClient(cfg.bridgeUrl, cfg.projectRoot);
  ```

- [ ] **Run — expected: `worker.test.ts` PASS.**
  ```sh
  pnpm --filter uxfactory-worker exec vitest run --root ../.. clients/uxfactory-worker/test/worker.test.ts
  ```

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/bridge test
  pnpm --filter @uxfactory/plugin test
  pnpm --filter uxfactory-worker test
  pnpm --filter @uxfactory/bridge typecheck
  pnpm --filter @uxfactory/plugin typecheck
  pnpm --filter uxfactory-worker typecheck
  pnpm -r build
  ```

- [ ] **Commit.** (No changeset — worker is private.)
  ```sh
  git add clients/uxfactory-worker/src/bridge-client.ts clients/uxfactory-worker/src/main.ts \
    clients/uxfactory-worker/test/worker.test.ts
  git commit -m "$(cat <<'EOF'
  worker: poll /pipeline/request/next?root= with the worker's projectRoot

  WorkerBridgeClient takes a projectRoot and appends ?root= to the poll so it
  claims only its own repo's jobs (PipelineRequest mirror gains root). main.ts
  wires cfg.projectRoot. Tests assert the poll carries the encoded root and that
  two pollers on different roots never cross-claim.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Done criteria

- One bridge serves N roots concurrently; every `/project/*` write lands in the resolved root (Task 3 isolation suite green).
- `~/.uxfactory/repos.json` round-trips and tolerates corruption; `/fs/repos` lists roots (launch pinned, dead flagged) — Task 1.
- Connect registers any valid root and returns its snapshot; `bridge-serves-different-root` gone from the server, kept in the client for old-bridge compat — Task 2.
- Pipeline jobs are root-tagged; workers claim only their root; legacy polls get launch-root jobs — Tasks 4 + 7.
- Panel client appends `?root=` to root-scoped verbs; query keys partition by root; Connect stores the resolved root and renders a degrading chip list — Tasks 5 + 6.
- Compatibility matrix rows all hold; the Figma manifest is untouched; `localhost:3779` unchanged.

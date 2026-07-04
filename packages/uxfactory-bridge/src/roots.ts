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
  code: 400 | 403 | 410;
  error: "root-invalid" | "root-not-served" | "root-gone";
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
  /** Serializes registry read-modify-writes; concurrent connects must not clobber each other. */
  private writeChain: Promise<void> = Promise.resolve();

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
   *   - duplicate params (?root=a&root=b parse to an array) → 400 root-invalid;
   *   - undefined/empty → launch root (legacy fallback), still re-validated;
   *   - not in the served set → 403 root-not-served;
   *   - served but no longer a project root → 410 root-gone.
   */
  async resolveRequestRoot(
    rawRoot: string | string[] | undefined,
  ): Promise<RootResolution> {
    if (Array.isArray(rawRoot)) {
      return { ok: false, code: 400, error: "root-invalid" };
    }
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
  private upsert(root: string): Promise<void> {
    // Queue behind any in-flight write: doUpsert never rejects (its whole body
    // is try/caught), so the chain cannot break.
    const queued = this.writeChain.then(() => this.doUpsert(root));
    this.writeChain = queued;
    return queued;
  }

  private async doUpsert(root: string): Promise<void> {
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

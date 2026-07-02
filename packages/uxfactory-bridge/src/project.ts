/**
 * project.ts — Fastify plugin providing project/panel routes for the panel redesign.
 *
 * Routes registered (all additive to the bridge):
 *   POST /project/connect
 *   GET  /project/snapshot
 *   PUT  /project/classification
 *   PUT  /project/profile
 *   GET  /project/links
 *   PUT  /project/links
 *   POST /project/open
 *   GET  /stats
 *   GET  /logs
 */

import type { FastifyPluginAsync } from "fastify";
import {
  readFile,
  writeFile,
  readdir,
  access,
  stat,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { platform } from "node:process";

const execFileAsync = promisify(execFile);

// ─── Shared mutable state injected from server.ts ───────────────────────────

export interface ProjectShared {
  startedAt: number;
  runsRelayed: number;
}

// ─── Public types ────────────────────────────────────────────────────────────

export type ArtifactGroup = "product" | "ia-ux" | "design" | "assets";
export type ArtifactStatus = "up-to-date" | "draft" | "missing";

export interface ArtifactRow {
  key: string;
  group: ArtifactGroup;
  label: string;
  status: ArtifactStatus;
  meta: string;
  path: string | null;
}

export interface Requirement {
  id: string;
  title: string;
}

export interface ProjectSnapshot {
  name: string;
  root: string;
  hasClassification: boolean;
  hasProfile: boolean;
  classification: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  artifacts: ArtifactRow[];
  requirements: Requirement[];
}

export interface Link {
  nodeId: string;
  unitName: string;
  unitType: string;
  acId: string;
}

export interface ProjectPluginOptions {
  /** Project root (parent of dataDir). */
  servedRoot: string;
  /** The .uxfactory data directory path. */
  dataDir: string;
  /** Bridge package.json version string. */
  version: string;
  /** Mutable shared counters (mutated by server.ts on pipeline results). */
  shared: ProjectShared;
  /** 500-line ring buffer appended by the server.ts onResponse hook. */
  logRing: string[];
}

// ─── Fixed v1 artifact concern registry paths (conventional fallbacks) ───────

const STORIES_PATH = "design/acceptance-criteria.json";
const TOKENS_PATH = "design/token-set.json";
const DESIGN_SYSTEM_PATH = "design/design-system.json";

// ─── Utility helpers ─────────────────────────────────────────────────────────

async function fileAccessible(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to parse a JSON file.
 * Returns `{ data, draft }` — `data` is null when the file is missing or
 * cannot be parsed; `draft` is true when the parsed object has `"draft": true`.
 */
async function tryReadJson(
  filePath: string,
): Promise<{ data: Record<string, unknown> | null; draft: boolean }> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: null, draft: false };
    }
    const data = parsed as Record<string, unknown>;
    return { data, draft: data["draft"] === true };
  } catch {
    return { data: null, draft: false };
  }
}

/**
 * Check status for a standard single JSON-file artifact.
 * exists+parses+no-draft → up-to-date; exists+unparseable|draft → draft; absent → missing.
 */
async function checkJsonArtifact(
  filePath: string,
): Promise<{ status: ArtifactStatus; path: string | null; meta: string }> {
  const exists = await fileAccessible(filePath);
  if (!exists) return { status: "missing", path: null, meta: "" };
  const { data, draft } = await tryReadJson(filePath);
  if (data === null || draft) return { status: "draft", path: filePath, meta: "" };
  return { status: "up-to-date", path: filePath, meta: "" };
}

/**
 * Look for the first file in `dir` whose basename starts with `prefix.`.
 * Returns the absolute path of the first match, or null.
 */
async function findByPrefix(dir: string, prefix: string): Promise<string | null> {
  try {
    const entries = await readdir(dir);
    const match = entries.find((e) => e.startsWith(`${prefix}.`));
    return match !== undefined ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

/**
 * Read `uxfactory.batch.json` at `root` and resolve `inputs.stories` /
 * `inputs.tokens` to absolute paths. Falls back to the conventional constants
 * when the registry is absent, unparseable, or the individual fields are
 * missing/non-string. Never throws.
 */
async function resolveInputPaths(
  root: string,
): Promise<{ storiesPath: string; tokensPath: string }> {
  const defaults = {
    storiesPath: path.join(root, STORIES_PATH),
    tokensPath: path.join(root, TOKENS_PATH),
  };
  try {
    const raw = await readFile(path.join(root, "uxfactory.batch.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return defaults;
    }
    const registry = parsed as Record<string, unknown>;
    const inputs = registry["inputs"];
    if (inputs === null || typeof inputs !== "object" || Array.isArray(inputs)) {
      return defaults;
    }
    const inp = inputs as Record<string, unknown>;
    return {
      storiesPath:
        typeof inp["stories"] === "string"
          ? path.resolve(root, inp["stories"])
          : defaults.storiesPath,
      tokensPath:
        typeof inp["tokens"] === "string"
          ? path.resolve(root, inp["tokens"])
          : defaults.tokensPath,
    };
  } catch {
    return defaults;
  }
}

/** True when `dir` has a `.git` directory or a `uxfactory.batch.json` file. */
async function isProjectRoot(dir: string): Promise<boolean> {
  return (
    (await fileAccessible(path.join(dir, ".git"))) ||
    (await fileAccessible(path.join(dir, "uxfactory.batch.json")))
  );
}

// ─── Snapshot builder ────────────────────────────────────────────────────────

async function buildArtifacts(
  root: string,
  storiesPath: string,
  tokensPath: string,
): Promise<ArtifactRow[]> {
  const rows: ArtifactRow[] = [];

  // ── product: brief ────────────────────────────────────────────────────────
  {
    let foundPath: string | null = null;
    for (const rel of ["brief.md", "design/brief.md"]) {
      const abs = path.join(root, rel);
      if (await fileAccessible(abs)) {
        foundPath = abs;
        break;
      }
    }
    rows.push({
      key: "brief",
      group: "product",
      label: "Brief",
      status: foundPath !== null ? "up-to-date" : "missing",
      meta: "",
      path: foundPath,
    });
  }

  // ── product: requirements ─────────────────────────────────────────────────
  {
    const r = await checkJsonArtifact(storiesPath);
    rows.push({ key: "requirements", group: "product", label: "Requirements", ...r });
  }

  // ── ia-ux: sitemap ────────────────────────────────────────────────────────
  {
    const designDir = path.join(root, "design");
    const match = await findByPrefix(designDir, "sitemap");
    rows.push({
      key: "sitemap",
      group: "ia-ux",
      label: "Sitemap",
      status: match !== null ? "up-to-date" : "missing",
      meta: "",
      path: match,
    });
  }

  // ── ia-ux: flows ──────────────────────────────────────────────────────────
  {
    const designDir = path.join(root, "design");
    const match = await findByPrefix(designDir, "flows");
    rows.push({
      key: "flows",
      group: "ia-ux",
      label: "Flows",
      status: match !== null ? "up-to-date" : "missing",
      meta: "",
      path: match,
    });
  }

  // ── design: brand-colors, palettes, fonts, grid (from design-system.json) ─
  {
    const abs = path.join(root, DESIGN_SYSTEM_PATH);
    const exists = await fileAccessible(abs);
    let dsData: Record<string, unknown> | null = null;
    let dsDraft = false;
    if (exists) {
      const r = await tryReadJson(abs);
      dsData = r.data;
      dsDraft = r.draft;
    }

    const sections = [
      { key: "brand-colors", label: "Brand Colors" },
      { key: "palettes", label: "Palettes" },
      { key: "fonts", label: "Fonts" },
      { key: "grid", label: "Grid" },
    ] as const;

    for (const { key, label } of sections) {
      let status: ArtifactStatus;
      if (!exists) {
        status = "missing";
      } else if (dsData === null || dsDraft) {
        status = "draft";
      } else {
        status = key in dsData ? "up-to-date" : "missing";
      }
      rows.push({
        key,
        group: "design",
        label,
        status,
        meta: "",
        path: exists ? abs : null,
      });
    }
  }

  // ── design: tokens ────────────────────────────────────────────────────────
  {
    const abs = tokensPath;
    const exists = await fileAccessible(abs);
    if (!exists) {
      rows.push({ key: "tokens", group: "design", label: "Tokens", status: "missing", meta: "", path: null });
    } else {
      const { data, draft } = await tryReadJson(abs);
      if (data === null || draft) {
        rows.push({ key: "tokens", group: "design", label: "Tokens", status: "draft", meta: "", path: abs });
      } else {
        const colors = data["colors"];
        const colorCount =
          colors !== null && typeof colors === "object" && !Array.isArray(colors)
            ? Object.keys(colors as Record<string, unknown>).length
            : 0;
        rows.push({
          key: "tokens",
          group: "design",
          label: "Tokens",
          status: "up-to-date",
          meta: `${colorCount} colors`,
          path: abs,
        });
      }
    }
  }

  // ── assets: icons, photography, illustrations ─────────────────────────────
  const assetDefs = [
    { key: "icons", label: "Icons", rel: "design/assets/icons.json" },
    { key: "photography", label: "Photography", rel: "design/assets/photography.json" },
    { key: "illustrations", label: "Illustrations", rel: "design/assets/illustrations.json" },
  ] as const;

  for (const { key, label, rel } of assetDefs) {
    const abs = path.join(root, rel);
    const r = await checkJsonArtifact(abs);
    rows.push({ key, group: "assets", label, ...r });
  }

  return rows;
}

async function buildRequirements(storiesPath: string): Promise<Requirement[]> {
  try {
    const raw = await readFile(storiesPath, "utf8");
    const data = JSON.parse(raw) as {
      stories?: Array<{
        id?: string;
        acceptanceCriteria?: Array<{ id?: string; statement?: string }>;
      }>;
    };
    const stories = data.stories ?? [];
    const reqs: Requirement[] = [];
    for (const story of stories) {
      const acs = story.acceptanceCriteria ?? [];
      acs.forEach((ac, i) => {
        reqs.push({
          id: ac.id ?? `${story.id ?? "story"}-${i + 1}`,
          title: ac.statement ?? "",
        });
      });
    }
    return reqs;
  } catch {
    return [];
  }
}

export async function buildSnapshot(
  root: string,
  _dataDir: string,
): Promise<ProjectSnapshot> {
  let classification: Record<string, unknown> | null = null;
  try {
    const raw = await readFile(path.join(root, "uxfactory.classification.json"), "utf8");
    classification = JSON.parse(raw) as Record<string, unknown>;
  } catch { /* absent or unparseable */ }

  let profile: Record<string, unknown> | null = null;
  try {
    const raw = await readFile(path.join(root, "uxfactory.profile.json"), "utf8");
    profile = JSON.parse(raw) as Record<string, unknown>;
  } catch { /* absent or unparseable */ }

  const { storiesPath, tokensPath } = await resolveInputPaths(root);
  const artifacts = await buildArtifacts(root, storiesPath, tokensPath);
  const requirements = await buildRequirements(storiesPath);

  return {
    name: path.basename(root),
    root,
    hasClassification: classification !== null,
    hasProfile: profile !== null,
    classification,
    profile,
    artifacts,
    requirements,
  };
}

// ─── Fastify plugin ──────────────────────────────────────────────────────────

export const projectPlugin: FastifyPluginAsync<ProjectPluginOptions> = async (
  app,
  opts,
) => {
  const { servedRoot, dataDir, version, shared, logRing } = opts;

  // ── POST /project/connect ────────────────────────────────────────────────
  app.post<{ Body: { repoPath?: unknown } }>("/project/connect", async (req, reply) => {
    const repoPath = req.body?.repoPath;
    if (typeof repoPath !== "string" || repoPath.trim() === "") {
      return reply.code(400).send({ error: "repoPath must be a non-empty string" });
    }

    // Resolve the given path to an absolute path.
    const resolved = path.resolve(repoPath);

    // 1. Does the path exist as a directory?
    let isDir = false;
    try {
      const s = await stat(resolved);
      isDir = s.isDirectory();
    } catch { /* access error ─ treat as not-found */ }
    if (!isDir) {
      return { ok: false, reason: "not-found" };
    }

    // 2. Is it a project root?
    if (!(await isProjectRoot(resolved))) {
      return { ok: false, reason: "not-a-root" };
    }

    // 3. Does it match the served root?
    if (resolved !== servedRoot) {
      return { ok: false, reason: "bridge-serves-different-root", served: servedRoot };
    }

    // All checks passed → return the snapshot.
    const snapshot = await buildSnapshot(servedRoot, dataDir);
    return { ok: true, snapshot };
  });

  // ── GET /project/snapshot ────────────────────────────────────────────────
  app.get("/project/snapshot", async () => {
    return buildSnapshot(servedRoot, dataDir);
  });

  // ── PUT /project/classification ──────────────────────────────────────────
  app.put("/project/classification", async (req) => {
    const body = req.body as Record<string, unknown>;
    await writeFile(
      path.join(servedRoot, "uxfactory.classification.json"),
      `${JSON.stringify(body, null, 2)}\n`,
      "utf8",
    );
    return { ok: true };
  });

  // ── PUT /project/profile ─────────────────────────────────────────────────
  app.put<{
    Body: {
      visual?: string;
      editorial?: string;
      coverage?: string;
      flow?: string;
      style?: string;
      coherence?: string;
    };
  }>("/project/profile", async (req) => {
    const body = req.body;
    const profilePath = path.join(servedRoot, "uxfactory.profile.json");

    // Read existing profile or start fresh.
    let profile: Record<string, unknown> = {};
    try {
      profile = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, unknown>;
    } catch { /* absent or unparseable — start fresh */ }

    // Merge scope dials.
    const scope =
      profile["scope"] !== null &&
      typeof profile["scope"] === "object" &&
      !Array.isArray(profile["scope"])
        ? (profile["scope"] as Record<string, unknown>)
        : {};
    if (body.visual !== undefined) scope["visual"] = body.visual;
    if (body.editorial !== undefined) scope["editorial"] = body.editorial;
    if (body.coverage !== undefined) scope["coverage"] = body.coverage;
    if (body.flow !== undefined) scope["flow"] = body.flow;
    profile["scope"] = scope;

    // Coherence → profile.experimental (marked experimental per the spec).
    if (body.coherence !== undefined) {
      const experimental =
        profile["experimental"] !== null &&
        typeof profile["experimental"] === "object" &&
        !Array.isArray(profile["experimental"])
          ? (profile["experimental"] as Record<string, unknown>)
          : {};
      experimental["coherence"] = body.coherence;
      profile["experimental"] = experimental;
    }

    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");

    // Style also propagates into classification.json.
    if (body.style !== undefined) {
      const classPath = path.join(servedRoot, "uxfactory.classification.json");
      let cls: Record<string, unknown> = {};
      try {
        cls = JSON.parse(await readFile(classPath, "utf8")) as Record<string, unknown>;
      } catch { /* start fresh */ }
      cls["style"] = body.style;
      await writeFile(classPath, `${JSON.stringify(cls, null, 2)}\n`, "utf8");
    }

    return { ok: true };
  });

  // ── GET /project/links ───────────────────────────────────────────────────
  app.get("/project/links", async () => {
    const linksPath = path.join(dataDir, "links.json");
    try {
      const raw = await readFile(linksPath, "utf8");
      const links = JSON.parse(raw) as Link[];
      return { links };
    } catch {
      return { links: [] as Link[] };
    }
  });

  // ── PUT /project/links ───────────────────────────────────────────────────
  app.put<{ Body: { links?: Link[] } }>("/project/links", async (req) => {
    const links = req.body?.links ?? [];
    const linksPath = path.join(dataDir, "links.json");
    await writeFile(linksPath, `${JSON.stringify(links, null, 2)}\n`, "utf8");
    return { ok: true };
  });

  // ── POST /project/open ───────────────────────────────────────────────────
  app.post<{ Body: { path?: unknown } }>("/project/open", async (req, reply) => {
    const reqPath = req.body?.path;
    if (typeof reqPath !== "string" || reqPath.trim() === "") {
      return reply.code(400).send({ error: "path must be a non-empty string" });
    }

    // Resolve relative to served root.
    const abs = path.resolve(servedRoot, reqPath);

    // Containment check: must be exactly servedRoot or start with servedRoot + sep.
    const rootWithSep = servedRoot.endsWith(path.sep) ? servedRoot : servedRoot + path.sep;
    if (abs !== servedRoot && !abs.startsWith(rootWithSep)) {
      return reply
        .code(400)
        .send({ error: "path is outside the project root", resolved: abs, root: servedRoot });
    }

    // Exec platform opener (skipped in test environments so tests never spawn OS processes).
    if (process.env["NODE_ENV"] !== "test") {
      const opener = platform === "darwin" ? "open" : "xdg-open";
      await execFileAsync(opener, [abs]);
    }

    return { ok: true };
  });

  // ── GET /stats ───────────────────────────────────────────────────────────
  app.get("/stats", async () => {
    // Token count from the registry-resolved (or conventional) tokens file colors map.
    let tokenCount: number | null = null;
    try {
      const { tokensPath } = await resolveInputPaths(servedRoot);
      const raw = await readFile(tokensPath, "utf8");
      const data = JSON.parse(raw) as { colors?: unknown };
      if (
        data.colors !== null &&
        typeof data.colors === "object" &&
        !Array.isArray(data.colors)
      ) {
        tokenCount = Object.keys(data.colors as Record<string, unknown>).length;
      }
    } catch { /* absent or unreadable → null */ }

    return {
      version,
      uptimeMs: Date.now() - shared.startedAt,
      runsRelayed: shared.runsRelayed,
      tokenCount,
    };
  });

  // ── GET /logs ────────────────────────────────────────────────────────────
  app.get<{ Querystring: { tail?: string } }>("/logs", async (req) => {
    const tailRaw = req.query.tail;
    const n =
      tailRaw !== undefined
        ? Math.max(0, Math.min(500, parseInt(tailRaw, 10) || 200))
        : 200;
    return { lines: logRing.slice(-n) };
  });
};

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
 *   GET  /project/artifact
 *   PUT  /project/artifact
 *   POST /project/open
 *   GET  /stats
 *   GET  /logs
 */

import type { FastifyPluginAsync } from "fastify";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  access,
  stat,
  rm,
  rename,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { platform } from "node:process";
import { parseStoryFile, storyToEngine } from "@uxfactory/spec";
import { isProjectRoot, type RootRegistry } from "./roots.js";

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

export interface SkillEntry {
  name: string;
  rev: string;
  pinned: boolean;
}

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

// ─── Fixed v1 artifact concern registry paths (conventional fallbacks) ───────

const STORIES_PATH = "design/acceptance-criteria.json";
const TOKENS_PATH = "design/token-set.json";

/**
 * Work directory where panel artifacts LIVE (user decision 2026-07-03):
 * one well-known location so bridge-called agents and SKILL.md flows can find
 * artifacts deterministically, instead of files scattered at the repo root
 * and design/. Engine gate inputs (requirements, tokens) keep their
 * engine-conventional design/ paths — the deterministic gate falls back to
 * those when no registry entry overrides.
 */
const ARTIFACTS_DIR = ".uxfactory/artifacts";
const DESIGN_SYSTEM_PATH = `${ARTIFACTS_DIR}/design-system.json`;
const LEGACY_DESIGN_SYSTEM_PATH = "design/design-system.json";

/**
 * Canonical path for each panel concern key — where new files are created and
 * where ALL writes land (writes migrate-on-touch; see PUT /project/artifact).
 */
const CONCERN_CANONICAL: Record<string, string> = {
  brief: `${ARTIFACTS_DIR}/brief.md`,
  stories: STORIES_PATH,
  sitemap: `${ARTIFACTS_DIR}/sitemap.json`,
  flows: `${ARTIFACTS_DIR}/flows.json`,
  "brand-colors": DESIGN_SYSTEM_PATH,
  palettes: DESIGN_SYSTEM_PATH,
  fonts: DESIGN_SYSTEM_PATH,
  grid: DESIGN_SYSTEM_PATH,
  typography: DESIGN_SYSTEM_PATH,
  "a11y-spec": `${ARTIFACTS_DIR}/accessibility.json`,
  tokens: TOKENS_PATH,
  icons: `${ARTIFACTS_DIR}/assets/icons.json`,
  photography: `${ARTIFACTS_DIR}/assets/photography.json`,
  illustrations: `${ARTIFACTS_DIR}/assets/illustrations.json`,
};

/**
 * Legacy locations (searched after the canonical) so existing projects keep
 * READING files where they already live. Writes always land canonical and
 * remove the legacy copy, so a project converges the first time an artifact
 * is touched.
 */
const CONCERN_LEGACY: Record<string, string[]> = {
  brief: ["brief.md", "design/brief.md"],
  "brand-colors": [LEGACY_DESIGN_SYSTEM_PATH],
  palettes: [LEGACY_DESIGN_SYSTEM_PATH],
  fonts: [LEGACY_DESIGN_SYSTEM_PATH],
  grid: [LEGACY_DESIGN_SYSTEM_PATH],
  icons: ["design/assets/icons.json"],
  photography: ["design/assets/photography.json"],
  illustrations: ["design/assets/illustrations.json"],
};

/** First accessible path among the concern's canonical + legacy locations. */
async function findConcernFile(root: string, key: string): Promise<string | null> {
  const candidates = [CONCERN_CANONICAL[key]!, ...(CONCERN_LEGACY[key] ?? [])];
  for (const rel of candidates) {
    const abs = path.join(root, rel);
    if (await fileAccessible(abs)) return abs;
  }
  return null;
}

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
 * Check status for a SET artifact (one JSON file per instance under a dir).
 * No dir / no members → missing; any unparseable/draft member → draft;
 * else up-to-date with a member count.
 */
async function checkSetArtifact(
  dirAbs: string,
  noun: string,
): Promise<{ status: ArtifactStatus; path: string | null; meta: string }> {
  let members: string[];
  try {
    members = (await readdir(dirAbs)).filter((e) => e.endsWith(".json"));
  } catch {
    return { status: "missing", path: null, meta: "" };
  }
  if (members.length === 0) return { status: "missing", path: null, meta: "" };
  for (const member of members) {
    const { data, draft } = await tryReadJson(path.join(dirAbs, member));
    if (data === null || draft) return { status: "draft", path: dirAbs, meta: "" };
  }
  return {
    status: "up-to-date",
    path: dirAbs,
    meta: `${members.length} ${noun}`,
  };
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

/** Shape returned by {@link resolveConcernPath}. */
interface ConcernPath {
  /** Absolute path the artifact READS from (canonical, else legacy match). */
  absolutePath: string;
  /** Absolute canonical path — where every WRITE lands (migrate-on-touch). */
  writePath: string;
  /** Root-relative path string (for the response body). */
  relativePath: string;
  /** Format inferred from the file extension. */
  format: "markdown" | "json";
  /** Whether the file currently exists on disk (at absolutePath). */
  exists: boolean;
}

/**
 * Resolve a panel concern key to its artifact path, mirroring the same logic as
 * `buildArtifacts` (registry-aware for tokens/requirements; canonical-then-
 * legacy-prefix search for sitemap/flows; canonical-then-legacy candidates for
 * the rest). Returns `null` for unknown keys. Never throws.
 */
async function resolveConcernPath(
  key: string,
  root: string,
): Promise<ConcernPath | null> {
  if (!Object.prototype.hasOwnProperty.call(CONCERN_CANONICAL, key)) return null;

  let absolutePath: string;
  let writePath = path.join(root, CONCERN_CANONICAL[key]!);
  let exists = false;

  if (key === "stories") {
    // Engine gate input — registry-first; reads and writes share one path.
    // Migrated projects resolve to the set DIRECTORY; the panel hides the
    // single-file editor for set artifacts, so file semantics are never hit.
    const { storiesPath } = await resolveInputPaths(root);
    absolutePath = storiesPath;
    writePath = storiesPath;
    exists = await fileAccessible(absolutePath);
  } else if (key === "tokens") {
    const { tokensPath } = await resolveInputPaths(root);
    absolutePath = tokensPath;
    writePath = tokensPath;
    exists = await fileAccessible(absolutePath);
  } else if (key === "sitemap" || key === "flows") {
    // Canonical exact path first, then the legacy design/ prefix search.
    if (await fileAccessible(writePath)) {
      absolutePath = writePath;
      exists = true;
    } else {
      const found = await findByPrefix(path.join(root, "design"), key);
      absolutePath = found ?? writePath;
      exists = found !== null;
    }
  } else {
    // brief, design-system sections, assets: canonical then legacy candidates.
    const found = await findConcernFile(root, key);
    absolutePath = found ?? writePath;
    exists = found !== null;
  }

  const relativePath = path.relative(root, absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const format: "markdown" | "json" = ext === ".md" ? "markdown" : "json";

  return { absolutePath, writePath, relativePath, format, exists };
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
    const foundPath = await findConcernFile(root, "brief");
    rows.push({
      key: "brief",
      group: "product",
      label: "Brief",
      status: foundPath !== null ? "up-to-date" : "missing",
      meta: "",
      path: foundPath,
    });
  }

  // ── product: stories — a set once migrated, the single legacy file before ──
  {
    let isDir = false;
    try {
      isDir = (await stat(storiesPath)).isDirectory();
    } catch { /* absent → file semantics report missing */ }
    const r = isDir
      ? await checkSetArtifact(storiesPath, "stories")
      : await checkJsonArtifact(storiesPath);
    rows.push({ key: "stories", group: "product", label: "Stories", ...r });
  }

  // ── product: personas — the first SET artifact (one file per instance) ────
  {
    const r = await checkSetArtifact(
      path.join(root, ARTIFACTS_DIR, "personas"),
      "personas",
    );
    rows.push({ key: "personas", group: "product", label: "Personas", ...r });
  }

  // ── ia-ux: sitemap + flows (canonical exact, then legacy design/ prefix) ──
  for (const { key, label } of [
    { key: "sitemap", label: "Sitemap" },
    { key: "flows", label: "Flows" },
  ] as const) {
    const canonical = path.join(root, CONCERN_CANONICAL[key]!);
    const match = (await fileAccessible(canonical))
      ? canonical
      : await findByPrefix(path.join(root, "design"), key);
    rows.push({
      key,
      group: "ia-ux",
      label,
      status: match !== null ? "up-to-date" : "missing",
      meta: "",
      path: match,
    });
  }

  // ── design: brand-colors, palettes, fonts, grid (from design-system.json) ─
  {
    const found = await findConcernFile(root, "brand-colors");
    const abs = found ?? path.join(root, DESIGN_SYSTEM_PATH);
    const exists = found !== null;
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
      { key: "typography", label: "Typography" },
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

  // ── design: a11y-spec (own file — the accessibility contract) ─────────────
  {
    const abs =
      (await findConcernFile(root, "a11y-spec")) ??
      path.join(root, CONCERN_CANONICAL["a11y-spec"]!);
    const r = await checkJsonArtifact(abs);
    rows.push({ key: "a11y-spec", group: "design", label: "A11y Spec", ...r });
  }

  // ── assets: icons, photography, illustrations ─────────────────────────────
  const assetDefs = [
    { key: "icons", label: "Icons" },
    { key: "photography", label: "Photography" },
    { key: "illustrations", label: "Illustrations" },
  ] as const;

  for (const { key, label } of assetDefs) {
    const abs =
      (await findConcernFile(root, key)) ?? path.join(root, CONCERN_CANONICAL[key]!);
    const r = await checkJsonArtifact(abs);
    rows.push({ key, group: "assets", label, ...r });
  }

  return rows;
}

async function buildRequirements(storiesPath: string): Promise<Requirement[]> {
  // Migrated set directory: one canonical story per file; ACs keep their acIds
  // and GWT triples render into engine statements (shared spec normalizer).
  try {
    if ((await stat(storiesPath)).isDirectory()) {
      const reqs: Requirement[] = [];
      const members = (await readdir(storiesPath)).filter((e) => e.endsWith(".json")).sort();
      for (const member of members) {
        try {
          const raw = JSON.parse(
            await readFile(path.join(storiesPath, member), "utf8"),
          ) as unknown;
          const parsed = parseStoryFile(raw);
          if (!parsed.ok) continue;
          const engine = storyToEngine(parsed.story);
          engine.acceptanceCriteria.forEach((ac, i) => {
            // acIds are per-story (AC-001 restarts in every file) — namespace
            // them so the snapshot's requirements list stays collision-free.
            const acId = parsed.story.acceptanceCriteria[i]?.acId ?? `AC-${i + 1}`;
            reqs.push({ id: `${parsed.story.storyId}/${acId}`, title: ac.statement });
          });
        } catch { /* unreadable member — skip, the artifact row reports draft */ }
      }
      return reqs;
    }
  } catch { /* absent → fall through to file semantics */ }
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
  const { servedRoot, dataDir, version, shared, logRing, registry } = opts;

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

  // ── POST /project/connect ────────────────────────────────────────────────
  app.post<{ Body: { repoPath?: unknown } }>("/project/connect", async (req, reply) => {
    const repoPath = req.body?.repoPath;
    if (typeof repoPath !== "string" || repoPath.trim() === "") {
      return reply.code(400).send({ error: "repoPath must be a non-empty string" });
    }

    // Expand a leading ~ to the user's home directory before resolving.
    // Absolute paths (starting with /) resolve unchanged. Other relative paths
    // are resolved against the process cwd — these are accepted as-is but are
    // unlikely to match the served root in practice.
    const homedir = os.homedir();
    const expanded =
      repoPath === "~"
        ? homedir
        : repoPath.startsWith("~/")
        ? path.join(homedir, repoPath.slice(2))
        : repoPath;
    const resolved = path.resolve(expanded);

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

    // 3. Register + serve this root (deduped in the user-level registry),
    //    then return ITS snapshot. Any valid project root is servable now.
    await registry.register(resolved);
    const snapshot = await buildSnapshot(resolved, registry.dataDirFor(resolved));
    return { ok: true, snapshot };
  });

  // ── GET /project/snapshot ────────────────────────────────────────────────
  app.get<{ Querystring: { root?: string } }>("/project/snapshot", async (req, reply) => {
    const ctx = await resolveRoot(req.query.root, reply);
    if (ctx === null) return reply;
    return buildSnapshot(ctx.root, ctx.dataDir);
  });

  // ── PUT /project/classification ──────────────────────────────────────────
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

  // ── PUT /project/profile ─────────────────────────────────────────────────
  app.put<{
    Querystring: { root?: string };
    Body: {
      visual?: string;
      editorial?: string;
      coverage?: string;
      flow?: string;
      style?: string;
      coherence?: string;
    };
  }>("/project/profile", async (req, reply) => {
    const ctx = await resolveRoot(req.query.root, reply);
    if (ctx === null) return reply;
    const body = req.body;
    const profilePath = path.join(ctx.root, "uxfactory.profile.json");

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
      const classPath = path.join(ctx.root, "uxfactory.classification.json");
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
  app.get<{ Querystring: { root?: string } }>("/project/links", async (req, reply) => {
    const ctx = await resolveRoot(req.query.root, reply);
    if (ctx === null) return reply;
    const linksPath = path.join(ctx.dataDir, "links.json");
    try {
      const raw = await readFile(linksPath, "utf8");
      const links = JSON.parse(raw) as Link[];
      return { links };
    } catch {
      return { links: [] as Link[] };
    }
  });

  // ── PUT /project/links ───────────────────────────────────────────────────
  app.put<{ Querystring: { root?: string }; Body: { links?: Link[] } }>(
    "/project/links",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;
      const links = req.body?.links ?? [];
      const linksPath = path.join(ctx.dataDir, "links.json");
      await mkdir(ctx.dataDir, { recursive: true });
      await writeFile(linksPath, `${JSON.stringify(links, null, 2)}\n`, "utf8");
      return { ok: true };
    },
  );

  // ── POST /project/reset ──────────────────────────────────────────────────
  // Soft reset: every Figma-file association (node links, render reports
  // incl. verify results, canvas snapshots) AND the panel-authored project
  // definition (artifacts/, classification, profile) is MOVED into a
  // timestamped .uxfactory/archive/reset-<stamp>/ folder — nothing is
  // deleted, everything is manually restorable. Pipeline state (queue,
  // batch previews) is generation work, not an association, and stays live.
  // Emptied dirs get their scaffold back: the live BridgeStore writes into
  // canvas/, renders/, and renders/verify/ without re-mkdir'ing.
  app.post<{ Querystring: { root?: string } }>("/project/reset", async (req, reply) => {
    const ctx = await resolveRoot(req.query.root, reply);
    if (ctx === null) return reply;

    /** True when the directory holds at least one FILE anywhere below —
     *  empty scaffold dirs (e.g. renders/verify at boot) are not data. */
    async function hasAnyFile(dir: string): Promise<boolean> {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return false;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) return true;
        if (await hasAnyFile(path.join(dir, entry.name))) return true;
      }
      return false;
    }

    const moves: Array<{ name: string; from: string }> = [];
    for (const dir of ["artifacts", "canvas", "renders"]) {
      const from = path.join(ctx.dataDir, dir);
      if (await hasAnyFile(from)) moves.push({ name: dir, from });
    }
    const fileTargets: Array<[string, string]> = [
      ["links.json", path.join(ctx.dataDir, "links.json")],
      ["uxfactory.classification.json", path.join(ctx.root, "uxfactory.classification.json")],
      ["uxfactory.profile.json", path.join(ctx.root, "uxfactory.profile.json")],
    ];
    for (const [name, from] of fileTargets) {
      try {
        await access(from);
        moves.push({ name, from });
      } catch {
        /* absent */
      }
    }

    if (moves.length === 0) {
      return { ok: true, archived: [], archiveDir: null };
    }

    // Unique stamp folder — a same-millisecond collision gets a numeric suffix
    // rather than merging two resets into one archive.
    const stamp = `reset-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    let archiveAbs = path.join(ctx.dataDir, "archive", stamp);
    for (let n = 2; ; n++) {
      try {
        await access(archiveAbs);
        archiveAbs = path.join(ctx.dataDir, "archive", `${stamp}-${n}`);
      } catch {
        break;
      }
    }
    await mkdir(archiveAbs, { recursive: true });

    const archived: string[] = [];
    for (const { name, from } of moves) {
      await rename(from, path.join(archiveAbs, name));
      archived.push(name);
    }
    await mkdir(path.join(ctx.dataDir, "renders", "verify"), { recursive: true });
    await mkdir(path.join(ctx.dataDir, "canvas"), { recursive: true });

    archived.sort();
    return {
      ok: true,
      archived,
      archiveDir: path.relative(ctx.root, archiveAbs),
    };
  });

  // ── GET /project/artifact ────────────────────────────────────────────────
  app.get<{ Querystring: { key?: string; root?: string } }>(
    "/project/artifact",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;

      const key = req.query.key;
      if (typeof key !== "string" || key.trim() === "") {
        return reply.code(400).send({ error: "key query param is required" });
      }

      const resolved = await resolveConcernPath(key, ctx.root);
      if (resolved === null) {
        return reply.code(400).send({ error: `unknown concern key: ${key}` });
      }

      // Containment check — the resolved path must be inside the resolved root
      // (guards a crafted registry pointing outside; checked BEFORE existence so
      // a traversal never even leaks whether the target file exists).
      const rootWithSep = ctx.root.endsWith(path.sep) ? ctx.root : ctx.root + path.sep;
      if (resolved.absolutePath !== ctx.root && !resolved.absolutePath.startsWith(rootWithSep)) {
        return reply
          .code(400)
          .send({ error: "artifact path is outside the project root", key });
      }

      if (!resolved.exists) {
        return reply.code(404).send({ error: `artifact not found: ${key}` });
      }

      const content = await readFile(resolved.absolutePath, "utf8");
      return { key, path: resolved.relativePath, format: resolved.format, content };
    },
  );

  // ── PUT /project/artifact ────────────────────────────────────────────────
  app.put<{ Querystring: { root?: string }; Body: { key?: unknown; content?: unknown } }>(
    "/project/artifact",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;

      const { key, content } = (req.body ?? {}) as { key?: unknown; content?: unknown };

      if (typeof key !== "string" || key.trim() === "") {
        return reply.code(400).send({ error: "key must be a non-empty string" });
      }
      if (typeof content !== "string") {
        return reply.code(400).send({ error: "content must be a string" });
      }

      const resolved = await resolveConcernPath(key, ctx.root);
      if (resolved === null) {
        return reply.code(400).send({ error: `unknown concern key: ${key}` });
      }

      // Containment check — guard against a registry pointing outside root.
      const rootWithSep = ctx.root.endsWith(path.sep) ? ctx.root : ctx.root + path.sep;
      if (resolved.writePath !== ctx.root && !resolved.writePath.startsWith(rootWithSep)) {
        return reply
          .code(400)
          .send({ error: "artifact path is outside the project root", key });
      }

      // Writes ALWAYS land at the canonical path (.uxfactory/artifacts/…) so
      // agents and SKILL.md flows have one deterministic location. mkdir -p the
      // parent so writing to a new location always succeeds.
      await mkdir(path.dirname(resolved.writePath), { recursive: true });
      await writeFile(resolved.writePath, content, "utf8");

      // Migrate-on-touch: the concern previously lived at a legacy path —
      // remove that copy so the project converges on the canonical location.
      if (resolved.exists && resolved.absolutePath !== resolved.writePath) {
        try {
          await rm(resolved.absolutePath);
        } catch {
          // Best-effort: a surviving legacy copy is shadowed by the canonical
          // one on every future read, so failure here is not an error.
        }
      }

      return { ok: true };
    },
  );

  // ── POST /project/open ───────────────────────────────────────────────────
  app.post<{ Querystring: { root?: string }; Body: { path?: unknown } }>(
    "/project/open",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;

      const reqPath = req.body?.path;
      if (typeof reqPath !== "string" || reqPath.trim() === "") {
        return reply.code(400).send({ error: "path must be a non-empty string" });
      }

      // Resolve relative to the resolved root.
      const abs = path.resolve(ctx.root, reqPath);

      // Containment check: must be exactly ctx.root or start with ctx.root + sep.
      const rootWithSep = ctx.root.endsWith(path.sep) ? ctx.root : ctx.root + path.sep;
      if (abs !== ctx.root && !abs.startsWith(rootWithSep)) {
        return reply
          .code(400)
          .send({ error: "path is outside the project root", resolved: abs, root: ctx.root });
      }

      // Exec platform opener (skipped in test environments so tests never spawn OS processes).
      if (process.env["NODE_ENV"] !== "test") {
        const opener = platform === "darwin" ? "open" : "xdg-open";
        await execFileAsync(opener, [abs]);
      }

      return { ok: true };
    },
  );

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

  // ── GET /skills ───────────────────────────────────────────────────────────
  app.get("/skills", async () => {
    const skillDir = path.join(servedRoot, "skill");
    let dirEntries: import("node:fs").Dirent[] = [];
    try {
      dirEntries = await readdir(skillDir, { withFileTypes: true });
    } catch {
      // skill/ directory absent → empty list
      return { skills: [] as SkillEntry[] };
    }

    const skills: SkillEntry[] = [];
    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillDir, entry.name, "SKILL.md");
      try {
        const content = await readFile(skillMdPath, "utf8");
        const rev = createHash("sha256")
          .update(content, "utf8")
          .digest("hex")
          .slice(0, 7);
        skills.push({ name: entry.name, rev, pinned: false });
      } catch {
        // directory without SKILL.md — not a skill, skip
      }
    }
    return { skills };
  });
};

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
 *   GET  /project/identity/registries
 *   PUT  /project/identity/registries
 *   GET  /project/identity/components
 *   PUT  /project/identity/components
 *   GET  /project/identity/manifest
 *   POST /project/identity/extraction
 *   POST /project/identity/crops
 *   POST /project/identity/proposals
 *   POST /project/identity/confirm
 *   POST /project/identity/applied
 *   GET  /project/artifact
 *   PUT  /project/artifact
 *   GET  /project/personas
 *   PUT  /project/personas/:id
 *   DELETE /project/personas/:id
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
import {
  parseStoryFile,
  storyToEngine,
  defaultIdentityRegistries,
  validateIdentityRegistries,
  assembleIdentities,
  serializeAddress,
  toKebabLabel,
  normalizeCoordinateToken,
  LABEL_RE,
} from "@uxfactory/spec";
import type {
  IdentityRegistries,
  ComponentRegistry,
  ComponentTypeEntry,
  NodeManifest,
  NodeIdentityRecord,
  IdentityExtraction,
  ExtractedNode,
  IdentityProposal,
  Coordinates,
  CanonicalAddress,
  AddressCoordinates,
} from "@uxfactory/spec";
import { isProjectRoot, type RootRegistry } from "./roots.js";
import type { WorkerPresenceEntry, ManagedInfo } from "./worker-presence.js";
import { applyArtifactWrite } from "./artifact-writer.js";

const execFileAsync = promisify(execFile);

// ─── Shared mutable state injected from server.ts ───────────────────────────

export interface ProjectShared {
  startedAt: number;
  runsRelayed: number;
}

// ─── Public types ────────────────────────────────────────────────────────────

export type ArtifactGroup = "product" | "ia-ux" | "design" | "assets" | "content";
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
  /** Live workers serving this root (spec 2026-07-09-worker-liveness). */
  workers?: WorkerPresenceEntry[];
  /** Present when an in-process supervisor manages this root (spec 2026-07-09-worker-cli-supervision). */
  managed?: ManagedInfo;
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
  /** Live-worker list for a root; provided by server.ts (absent in bare tests). */
  workersFor?: (root: string) => WorkerPresenceEntry[];
  /** ManagedInfo for a root per BridgeOptions.managedRoots; provided by server.ts (absent in bare tests). */
  managedFor?: (root: string) => ManagedInfo | undefined;
  /** Called after a root becomes served (connect) — promotes pending workers. */
  onRootServed?: (root: string) => void;
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
  features: `${ARTIFACTS_DIR}/features.json`,
  audience: `${ARTIFACTS_DIR}/audience.json`,
  "copy-deck": `${ARTIFACTS_DIR}/content/copy-deck.json`,
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

/**
 * Same as findConcernFile, but a candidate whose content is empty or
 * whitespace-only does not count as found — iteration continues to the next
 * candidate. Used for the BRIEF concern only: per spec
 * 2026-07-11-product-brief-root-gate-design.md, "a brief exists = the
 * resolved artifact file exists and is non-empty" (status fidelity, matching
 * the worker's briefExists — not gate policy, which stays out of the bridge).
 */
async function findNonEmptyConcernFile(root: string, key: string): Promise<string | null> {
  const candidates = [CONCERN_CANONICAL[key]!, ...(CONCERN_LEGACY[key] ?? [])];
  for (const rel of candidates) {
    const abs = path.join(root, rel);
    if (!(await fileAccessible(abs))) continue;
    try {
      const content = await readFile(abs, "utf8");
      if (content.trim() !== "") return abs;
    } catch {
      // unreadable — try the next candidate
    }
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
  // Root gate (spec 2026-07-11-product-brief-root-gate-design.md): the brief
  // is the one artifact the panel gate keys off — an existing-but-empty file
  // must report missing here, or the gate lifts while the worker's
  // briefExists (non-empty-after-trim) still refuses the job.
  {
    const foundPath = await findNonEmptyConcernFile(root, "brief");
    rows.push({
      key: "brief",
      group: "product",
      label: "Product Brief",
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

  // ── product: features — groups stories; never gates, only scopes ──────────
  {
    const r = await checkJsonArtifact(path.join(root, ARTIFACTS_DIR, "features.json"));
    rows.push({ key: "features", group: "product", label: "Features", ...r });
  }

  // ── product: audience — segmentation; modulates rendering ─────────────────
  {
    const r = await checkJsonArtifact(path.join(root, ARTIFACTS_DIR, "audience.json"));
    rows.push({ key: "audience", group: "product", label: "Audience", ...r });
  }

  // ── content: copy deck — authored slot text; the copy-conformance contract ─
  {
    const r = await checkJsonArtifact(path.join(root, ARTIFACTS_DIR, "content/copy-deck.json"));
    rows.push({ key: "copy-deck", group: "content", label: "Copy deck", ...r });
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

// ─── Trace join (features → stories → ACs/links/pages) ──────────────────────

interface TraceAC {
  acId: string;
  statement: string;
  checkable: string;
  linkedNodes: Array<{ nodeId: string; unitName: string; unitType: string }>;
  /** Page elements that realize this AC (trace covers carrying its acId). */
  coveredBy: Array<{ page: string; view: string }>;
}

interface TraceStory {
  storyId: string;
  actor: string;
  want: string;
  status: string;
  /** Repo-relative path of the story's source file (set member or legacy file). */
  filePath: string;
  coveredBy: Array<{ page: string; view: string }>;
  acceptanceCriteria: TraceAC[];
}

interface TraceFeature {
  featureId: string;
  name: string;
  /** From the latest report's featureCoverage; null when no report carries it. */
  conformed: boolean | null;
  /** Sitemap nodes that declare this feature (featureRefs) — planned IA homes. */
  plannedPages: string[];
  stories: TraceStory[];
}

/** Parse every story reachable at the resolved stories path (set dir or legacy file). */
async function readTraceStories(storiesPath: string): Promise<
  Array<{
    storyId: string;
    actor: string;
    want: string;
    status: string;
    /** Absolute path of the story's source file (set member or legacy file). */
    absPath: string;
    acs: Array<{ acId: string; statement: string; checkable: string }>;
  }>
> {
  const bodies: Array<{ body: unknown; absPath: string }> = [];
  try {
    if ((await stat(storiesPath)).isDirectory()) {
      const members = (await readdir(storiesPath)).filter((e) => e.endsWith(".json")).sort();
      for (const m of members) {
        const memberPath = path.join(storiesPath, m);
        try {
          bodies.push({ body: JSON.parse(await readFile(memberPath, "utf8")) as unknown, absPath: memberPath });
        } catch { /* unreadable member — skip */ }
      }
    } else {
      const raw = JSON.parse(await readFile(storiesPath, "utf8")) as { stories?: unknown[] };
      for (const m of raw.stories ?? []) bodies.push({ body: m, absPath: storiesPath });
    }
  } catch {
    return [];
  }
  const out = [];
  for (const { body, absPath } of bodies) {
    const parsed = parseStoryFile(body);
    if (!parsed.ok) continue;
    const engine = storyToEngine(parsed.story);
    out.push({
      storyId: parsed.story.storyId,
      actor: parsed.story.actor,
      want: parsed.story.want,
      status: parsed.story.status,
      absPath,
      acs: engine.acceptanceCriteria.map((ac, i) => ({
        acId: parsed.story.acceptanceCriteria[i]?.acId ?? `AC-${i + 1}`,
        statement: ac.statement,
        checkable: parsed.story.acceptanceCriteria[i]?.checkable ?? "auto",
      })),
    });
  }
  return out;
}

// ─── Personas: instance routes (Task 1) ──────────────────────────────────────
// `personas` is a SET artifact — one JSON file per persona under
// `.uxfactory/artifacts/personas/<id>.json`. `readPersonas` mirrors
// `readTraceStories`'s parse-every-file-in-a-set-dir pattern: malformed or
// unreadable members are skipped, never a 500. Every returned instance's
// `personaId` is the FILENAME STEM, ALWAYS — overriding any `personaId` the
// body itself carries. The file IS the instance's identity (PUT/DELETE
// address `<id>.json` by that same id): if a body's `personaId` disagreed
// with its filename, trusting the body would make the panel address the
// instance by the wrong id, and an edit would write a NEW file while
// orphaning the original. Keying on the filename keeps list/PUT/DELETE all
// addressing the same file, for hand-authored instances too.

const PERSONA_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Parse every *.json in the personas set dir into instances; skip unreadable/malformed. */
async function readPersonas(
  dir: string,
): Promise<Array<Record<string, unknown> & { personaId: string }>> {
  let entries: string[];
  try {
    if (!(await stat(dir)).isDirectory()) return [];
    entries = (await readdir(dir)).filter((e) => e.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown> & { personaId: string }> = [];
  for (const file of entries) {
    try {
      const parsed = JSON.parse(await readFile(path.join(dir, file), "utf8")) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      // Filename wins over any body `personaId` — see the block comment above.
      const personaId = file.replace(/\.json$/, "");
      out.push({ ...obj, personaId });
    } catch {
      /* skip malformed member */
    }
  }
  return out;
}

/**
 * Compose the traceability tree: features → stories → ACs (with canvas links)
 * plus each story's covering pages/views from trace.json and the feature's
 * conformance from the latest report's Coverage metric. Every source is
 * optional — absence degrades to empty lists / null conformance, never a 500.
 */
async function buildTrace(root: string, dataDir: string): Promise<{
  features: TraceFeature[];
  unassigned: TraceStory[];
}> {
  // Registry-aware input paths (stories via the shared resolver; features/trace direct).
  const { storiesPath } = await resolveInputPaths(root);
  let featuresPath = path.join(root, ARTIFACTS_DIR, "features.json");
  let tracePath = path.join(root, "design/trace.json");
  try {
    const reg = JSON.parse(await readFile(path.join(root, "uxfactory.batch.json"), "utf8")) as {
      inputs?: Record<string, unknown>;
    };
    if (typeof reg.inputs?.["features"] === "string") {
      featuresPath = path.resolve(root, reg.inputs["features"]);
    }
    if (typeof reg.inputs?.["trace"] === "string") {
      tracePath = path.resolve(root, reg.inputs["trace"]);
    }
  } catch { /* conventional fallbacks stand */ }

  const stories = await readTraceStories(storiesPath);

  // trace.json → story-level and AC-level covering page/view lists. The
  // AC-level map keys `${story}/${acId}` — a page ELEMENT realizing a specific
  // acceptance criterion (page-tier component→AC binding).
  const coveredBy = new Map<string, Array<{ page: string; view: string }>>();
  const acCoveredBy = new Map<string, Array<{ page: string; view: string }>>();
  try {
    const trace = JSON.parse(await readFile(tracePath, "utf8")) as {
      pages?: Array<{
        file?: string;
        views?: Array<{ id?: string; covers?: Array<{ story?: string; acId?: string }> }>;
      }>;
    };
    for (const page of trace.pages ?? []) {
      for (const view of page.views ?? []) {
        const where = { page: page.file ?? "", view: view.id ?? "" };
        const seen = new Set<string>();
        const acSeen = new Set<string>();
        for (const cover of view.covers ?? []) {
          if (typeof cover.story !== "string") continue;
          if (!seen.has(cover.story)) {
            seen.add(cover.story);
            coveredBy.set(cover.story, [...(coveredBy.get(cover.story) ?? []), where]);
          }
          if (typeof cover.acId === "string") {
            const key = `${cover.story}/${cover.acId}`;
            if (!acSeen.has(key)) {
              acSeen.add(key);
              acCoveredBy.set(key, [...(acCoveredBy.get(key) ?? []), where]);
            }
          }
        }
      }
    }
  } catch { /* no trace — coverage maps stay empty */ }

  // sitemap featureRefs → feature → planned page titles (IA-planned homes)
  const plannedByFeature = new Map<string, string[]>();
  try {
    const sitemap = JSON.parse(
      await readFile(path.join(root, ARTIFACTS_DIR, "sitemap.json"), "utf8"),
    ) as { nodes?: Array<{ title?: string; nodeId?: string; featureRefs?: unknown }> };
    for (const node of sitemap.nodes ?? []) {
      const title = node.title ?? node.nodeId ?? "";
      if (title === "" || !Array.isArray(node.featureRefs)) continue;
      for (const ref of node.featureRefs) {
        if (typeof ref !== "string") continue;
        const list = plannedByFeature.get(ref) ?? [];
        list.push(title);
        plannedByFeature.set(ref, list);
      }
    }
  } catch { /* no sitemap or no links — plannedPages stay empty */ }

  // links registry → story-namespaced AC id (legacy plain ids matched too)
  let links: Link[] = [];
  try {
    links = JSON.parse(await readFile(path.join(dataDir, "links.json"), "utf8")) as Link[];
  } catch { /* no links yet */ }

  // latest report → per-feature conformance
  const conformedById = new Map<string, boolean>();
  try {
    const report = JSON.parse(
      await readFile(path.join(dataDir, "batch", "report.json"), "utf8"),
    ) as { featureCoverage?: { features?: Array<{ featureId?: string; conformed?: boolean }> } };
    for (const f of report.featureCoverage?.features ?? []) {
      if (typeof f.featureId === "string" && typeof f.conformed === "boolean") {
        conformedById.set(f.featureId, f.conformed);
      }
    }
  } catch { /* no report — conformance null */ }

  const toTraceStory = (s: (typeof stories)[number]): TraceStory => ({
    storyId: s.storyId,
    actor: s.actor,
    want: s.want,
    status: s.status,
    filePath: path.relative(root, s.absPath),
    coveredBy: coveredBy.get(s.storyId) ?? [],
    acceptanceCriteria: s.acs.map((ac) => ({
      ...ac,
      coveredBy: acCoveredBy.get(`${s.storyId}/${ac.acId}`) ?? [],
      linkedNodes: links
        .filter((l) => l.acId === `${s.storyId}/${ac.acId}` || l.acId === ac.acId)
        .map((l) => ({ nodeId: l.nodeId, unitName: l.unitName, unitType: l.unitType })),
    })),
  });

  const storyById = new Map(stories.map((s) => [s.storyId, s]));
  const assigned = new Set<string>();
  const features: TraceFeature[] = [];
  try {
    const raw = JSON.parse(await readFile(featuresPath, "utf8")) as {
      features?: Array<{ featureId?: string; name?: string; storyRefs?: unknown }>;
    };
    for (const f of raw.features ?? []) {
      if (typeof f.featureId !== "string") continue;
      const refs = Array.isArray(f.storyRefs)
        ? f.storyRefs.filter((r): r is string => typeof r === "string")
        : [];
      const rows: TraceStory[] = [];
      for (const ref of refs) {
        const s = storyById.get(ref);
        if (s === undefined) continue; // broken ref — the metric flags it; the tree skips it
        assigned.add(ref);
        rows.push(toTraceStory(s));
      }
      features.push({
        featureId: f.featureId,
        name: typeof f.name === "string" ? f.name : f.featureId,
        conformed: conformedById.get(f.featureId) ?? null,
        plannedPages: plannedByFeature.get(f.featureId) ?? [],
        stories: rows,
      });
    }
  } catch { /* no features file — everything unassigned */ }

  const unassigned = stories.filter((s) => !assigned.has(s.storyId)).map(toTraceStory);
  return { features, unassigned };
}

// ─── Node identity: component registry wire-shape validation ────────────────
// The wire shape (`{ components: ComponentTypeEntry[] }`) is looser than the
// full ComponentTypeEntry type — it only checks the fields callers actually
// need to get right to avoid corrupting the store. The file on disk stays the
// canonical ComponentRegistry shape (`{ version: 1, components }`).

function validateComponentsBody(
  body: unknown,
): { ok: true; components: ComponentTypeEntry[] } | { ok: false; errors: string[] } {
  const components =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)["components"]
      : undefined;
  if (!Array.isArray(components)) {
    return { ok: false, errors: ['"components" must be an array'] };
  }

  const errors: string[] = [];
  const parsed: ComponentTypeEntry[] = [];
  components.forEach((entry, i) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof (entry as Record<string, unknown>)["key"] !== "string" ||
      typeof (entry as Record<string, unknown>)["roleName"] !== "string" ||
      typeof (entry as Record<string, unknown>)["source"] !== "string" ||
      typeof (entry as Record<string, unknown>)["matchability"] !== "string"
    ) {
      errors.push(
        `components[${i}] must be an object with string "key", "roleName", "source", and "matchability"`,
      );
      return;
    }
    // roleName becomes a path label (identity-assemble.ts's resolveLabel,
    // cases 1/3) that flows straight into serializeAddress — a non-kebab
    // roleName would throw there. Reject it here, at the write boundary,
    // rather than let a malformed registry entry crash a later extraction
    // or proposals-merge request.
    const roleName = (entry as Record<string, unknown>)["roleName"] as string;
    if (!LABEL_RE.test(roleName)) {
      errors.push(
        `components[${i}].roleName "${roleName}" must be a valid kebab path label (matches /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/) — it is used as a path segment`,
      );
      return;
    }
    parsed.push(entry as unknown as ComponentTypeEntry);
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, components: parsed };
}

// ─── Node identity: extraction wire-shape validation ────────────────────────
// Same defensive posture as validateComponentsBody above: check the fields
// assembleIdentities and the record shape actually need, collect every
// violation (not just the first), and never persist on failure.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function validateExtractionBody(
  body: unknown,
): { ok: true; extraction: IdentityExtraction } | { ok: false; errors: string[] } {
  const extractionRaw = isPlainObject(body) ? body["extraction"] : undefined;
  if (!isPlainObject(extractionRaw)) {
    return { ok: false, errors: ['"extraction" must be an object'] };
  }
  const e = extractionRaw;
  const errors: string[] = [];

  if (e["version"] !== 1) {
    errors.push('"extraction.version" must be 1');
  }

  const page = e["page"];
  if (
    !isPlainObject(page) ||
    typeof page["figmaNodeId"] !== "string" ||
    typeof page["name"] !== "string"
  ) {
    errors.push('"extraction.page" must be an object with string "figmaNodeId" and "name"');
  }

  if (typeof e["pageCount"] !== "number") {
    errors.push('"extraction.pageCount" must be a number');
  }

  const nodesRaw = e["nodes"];
  if (!Array.isArray(nodesRaw)) {
    errors.push('"extraction.nodes" must be an array');
    return { ok: false, errors };
  }

  const nodes: ExtractedNode[] = [];
  nodesRaw.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      errors.push(`extraction.nodes[${i}] must be an object`);
      return;
    }
    if (
      typeof raw["durableId"] !== "string" ||
      typeof raw["figmaNodeId"] !== "string" ||
      !(raw["parentDurableId"] === null || typeof raw["parentDurableId"] === "string") ||
      typeof raw["ordinal"] !== "number" ||
      typeof raw["kind"] !== "string" ||
      !(raw["width"] === null || typeof raw["width"] === "number") ||
      typeof raw["currentName"] !== "string" ||
      !isPlainObject(raw["resolvedModes"]) ||
      !(raw["mainComponent"] === null || isPlainObject(raw["mainComponent"])) ||
      !(raw["variantProperties"] === null || isPlainObject(raw["variantProperties"])) ||
      typeof raw["isPageChild"] !== "boolean"
    ) {
      errors.push(
        `extraction.nodes[${i}] must be a valid ExtractedNode: string "durableId"/"figmaNodeId"/"kind"/"currentName"; "parentDurableId" string|null; number "ordinal"; "width" number|null; "resolvedModes" object; "mainComponent" object|null; "variantProperties" object|null; boolean "isPageChild"`,
      );
      return;
    }
    nodes.push(raw as unknown as ExtractedNode);
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    extraction: { ...(e as unknown as IdentityExtraction), nodes },
  };
}

// ─── Node identity: crops wire-shape validation ─────────────────────────────
// Same defensive posture as the two validators above: the wire body must be
// `{ crops: [{durableId, base64}] }` — anything else (missing key, not an
// array, an entry missing either string field) fails the WHOLE request with
// 400 and nothing is written. A durableId that IS a well-formed string but
// doesn't match the durable-id shape (`/^n-[a-z0-9]+$/`) is a DIFFERENT,
// narrower concern (path-safety) handled per-entry at write time in the
// route below — that one skips just the offending crop rather than failing
// the whole batch, since one bad id must not cost the other N-1 good crops.

const DURABLE_ID_RE = /^n-[a-z0-9]+$/;

function validateCropsBody(
  body: unknown,
): { ok: true; crops: Array<{ durableId: string; base64: string }> } | { ok: false; errors: string[] } {
  const cropsRaw = isPlainObject(body) ? body["crops"] : undefined;
  if (!Array.isArray(cropsRaw)) {
    return { ok: false, errors: ['"crops" must be an array'] };
  }

  const errors: string[] = [];
  const crops: Array<{ durableId: string; base64: string }> = [];
  cropsRaw.forEach((raw, i) => {
    if (
      !isPlainObject(raw) ||
      typeof raw["durableId"] !== "string" ||
      typeof raw["base64"] !== "string"
    ) {
      errors.push(`crops[${i}] must be an object with string "durableId" and "base64"`);
      return;
    }
    crops.push({ durableId: raw["durableId"], base64: raw["base64"] });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, crops };
}

// ─── Node identity: proposals wire-shape validation ─────────────────────────
// Same defensive posture as the three validators above: collect only the
// fields the merge below actually needs to get right, fail the WHOLE request
// on any violation (never partial-apply), and require exactly durableId +
// confidence + reasoning on every entry — the skill's IO contract (skill/
// node-identity/SKILL.md) never emits a proposal without them (§D: "never
// emit an Inferred value without a confirm gate").

const CONFIDENCE_VALUES = new Set(["high", "low"]);
const RESOLUTION_STATUS_VALUES = new Set(["bound", "drifted", "custom"]);

function validateProposalsBody(
  body: unknown,
): { ok: true; proposals: IdentityProposal[] } | { ok: false; errors: string[] } {
  const proposalsRaw = isPlainObject(body) ? body["proposals"] : undefined;
  if (!Array.isArray(proposalsRaw)) {
    return { ok: false, errors: ['"proposals" must be an array'] };
  }

  const errors: string[] = [];
  const proposals: IdentityProposal[] = [];
  proposalsRaw.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      errors.push(`proposals[${i}] must be an object`);
      return;
    }
    if (typeof raw["durableId"] !== "string" || raw["durableId"].trim() === "") {
      errors.push(`proposals[${i}].durableId must be a non-empty string`);
      return;
    }
    if (!CONFIDENCE_VALUES.has(raw["confidence"] as string)) {
      errors.push(`proposals[${i}].confidence must be "high" or "low"`);
      return;
    }
    if (typeof raw["reasoning"] !== "string") {
      errors.push(`proposals[${i}].reasoning must be a string`);
      return;
    }
    if (raw["label"] !== undefined && typeof raw["label"] !== "string") {
      errors.push(`proposals[${i}].label must be a string when present`);
      return;
    }
    if (raw["matchedComponentKey"] !== undefined && typeof raw["matchedComponentKey"] !== "string") {
      errors.push(`proposals[${i}].matchedComponentKey must be a string when present`);
      return;
    }
    if (raw["mode"] !== undefined && typeof raw["mode"] !== "string") {
      errors.push(`proposals[${i}].mode must be a string when present`);
      return;
    }
    if (raw["theme"] !== undefined && typeof raw["theme"] !== "string") {
      errors.push(`proposals[${i}].theme must be a string when present`);
      return;
    }
    if (
      raw["resolutionStatus"] !== undefined &&
      !RESOLUTION_STATUS_VALUES.has(raw["resolutionStatus"] as string)
    ) {
      errors.push(
        `proposals[${i}].resolutionStatus must be "bound" | "drifted" | "custom" when present`,
      );
      return;
    }
    proposals.push(raw as unknown as IdentityProposal);
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, proposals };
}

// ─── Node identity: proposals merge (Task 10, Phase 3: vision interpretation) ─
// Merges one IdentityProposal into a manifest record as INFERRED — never
// settled (skill §D). `label` (open-vocab, composed sections) and
// `matchedComponentKey` (closed-set binding, §C) both mutate the SAME
// surface: the record's LAST path segment (its own label) — so both are
// guarded identically by the confirm gate: a last segment that is already
// `confirmed: true` or `provenance: "elicited"` is user-ratified and NEVER
// overwritten by a vision proposal, of either kind. `mode`/`theme` only fill
// an axis that is currently ABSENT on the record — an existing derived/bound
// axis is never overwritten, however it was resolved. `confidence` has no
// field on PathSegment (a frozen shape — see node-identity.ts), so for a
// label change it is folded into the record-level `reasoning` teaching
// surface instead; coordinates DO carry `confidence` natively (ProvenancedValue).
//
// NORMALIZATION (post-review fix): vision returns free text ("Hero Banner"),
// not a grammar-valid label — `serializeAddress` throws on anything that
// isn't `LABEL_RE`-clean kebab, or a coordinate value outside
// `[a-z][a-z0-9]*`. Canonicalizing a proposed label to kebab is the CORRECT
// behavior (not just crash-avoidance — "Hero Banner" SHOULD become
// "hero-banner"), so `proposal.label` is run through `toKebabLabel` before
// it ever reaches a path segment; an empty result (nothing survived, or the
// kebabbed text starts with a digit) means "no usable label" and that part
// of the proposal is skipped, never written as an empty segment.
// `proposal.mode`/`proposal.theme` are run through `normalizeCoordinateToken`
// so only an actual registry member ever lands in `coordinates` — a
// non-member value is silently not filled (never written unresolved).
// `matchedComponentKey`'s `entry.roleName` is normalized the same way (a
// component-registry entry can predate the PUT boundary's own LABEL_RE
// guard, or be hand-edited on disk — legacy data, not just fresh writes).
//
// ATOMICITY (post-review fix): `applyIdentityProposal` is called by the
// route below on a CANDIDATE — a `structuredClone` of the real record, never
// the record living in `manifest.records` — so it is free to mutate its
// argument in place. The route only commits the candidate into
// `manifest.records[durableId]` AFTER `serializeAddress` on the *candidate*
// succeeds; if either this function or that serialize call throws for any
// reason (including one this normalization doesn't cover — e.g. an already
// on-disk record whose PRE-EXISTING label was never valid, untouched by this
// proposal), the original record is never touched and the batch's
// already-applied proposals are unaffected. See the route's own comment.

function toAddressCoordinates(c: Coordinates): AddressCoordinates {
  return {
    ...(c.viewport !== undefined ? { viewport: c.viewport.value } : {}),
    ...(c.mode !== undefined ? { mode: c.mode.value } : {}),
    ...(c.theme !== undefined ? { theme: c.theme.value } : {}),
    ...(c.state !== undefined ? { state: c.state.value } : {}),
  };
}

/**
 * Apply one proposal to `candidate` in place; returns true iff anything
 * changed. `candidate` MUST be a private clone the caller is free to mutate
 * and discard (never the live object in `manifest.records`) — see the
 * ATOMICITY note above and the route's own commit-on-success logic below.
 */
function applyIdentityProposal(
  candidate: NodeIdentityRecord,
  proposal: IdentityProposal,
  components: ComponentRegistry,
  registries: IdentityRegistries,
): boolean {
  let changed = false;
  const lastSeg = candidate.path[candidate.path.length - 1];
  const guarded = lastSeg !== undefined && (lastSeg.confirmed === true || lastSeg.provenance === "elicited");
  const reasoningNote = `${proposal.reasoning} [vision confidence: ${proposal.confidence}]`;

  // Open-vocab semantic label (composed sections) — §A2/§B2. Normalized to a
  // grammar-valid kebab label; an empty normalization means nothing usable
  // survived, so this aspect of the proposal is a no-op.
  if (proposal.label !== undefined && lastSeg !== undefined && !guarded) {
    const normalizedLabel = toKebabLabel(proposal.label);
    if (normalizedLabel !== "") {
      lastSeg.label = normalizedLabel;
      lastSeg.provenance = "inferred";
      lastSeg.source = "vision";
      lastSeg.confirmed = false;
      candidate.reasoning = reasoningNote;
      changed = true;
    }
  }

  // Closed-set component match — a BINDING proposal, not a name (§C).
  // `entry.roleName` is EXPECTED to be LABEL_RE-valid — the component-registry
  // PUT boundary (`validateComponentsBody`) enforces this for every write it
  // handles — but a registry entry can predate that guard (legacy data) or be
  // hand-edited on disk, so it is normalized here too, same as `proposal.label`
  // above. A roleName that normalizes to nothing usable means this aspect of
  // the proposal is a no-op (never writes an empty/invalid label).
  if (proposal.matchedComponentKey !== undefined && !guarded) {
    const entry = components.components.find((c) => c.key === proposal.matchedComponentKey);
    const normalizedRoleName = entry !== undefined ? toKebabLabel(entry.roleName) : "";
    if (entry !== undefined && normalizedRoleName !== "") {
      if (lastSeg !== undefined) {
        lastSeg.label = normalizedRoleName;
        lastSeg.provenance = "inferred";
        lastSeg.source = "vision";
        lastSeg.confirmed = false;
      }
      candidate.definitionRef = proposal.matchedComponentKey;
      candidate.resolutionStatus = proposal.resolutionStatus ?? "bound";
      candidate.reasoning = reasoningNote;
      changed = true;
    }
  }

  // Mode/theme fallback — ONLY when that axis is currently absent (never
  // overwrite a derived/bound axis, however it was resolved), AND only when
  // the proposed value normalizes to an actual registry member — a
  // non-member value is silently ignored (not filled, not written raw).
  if (proposal.mode !== undefined && candidate.coordinates.mode === undefined) {
    const normalizedMode = normalizeCoordinateToken("mode", proposal.mode, registries);
    if (normalizedMode !== null) {
      candidate.coordinates.mode = {
        value: normalizedMode,
        provenance: "inferred",
        source: "vision",
        confidence: proposal.confidence,
        confirmed: false,
      };
      changed = true;
    }
  }
  if (proposal.theme !== undefined && candidate.coordinates.theme === undefined) {
    const normalizedTheme = normalizeCoordinateToken("theme", proposal.theme, registries);
    if (normalizedTheme !== null) {
      candidate.coordinates.theme = {
        value: normalizedTheme,
        provenance: "inferred",
        source: "vision",
        confidence: proposal.confidence,
        confirmed: false,
      };
      changed = true;
    }
  }

  return changed;
}

// ─── Task 12: confirm/override route ────────────────────────────────────────
// A confirmation ratifies (`confirm`) or replaces (`override`) ONE segment —
// the path's last label, or one of the four coordinate axes — of ONE
// manifest record. The route is deliberately per-segment; the panel composes
// per-node/whole-session gestures out of many items in one request (task-12
// brief, "Granularity note").
//
// Two-tier validation, mirroring the proposals route's body-shape/business-
// rule split (see that route's own comment above):
//  - Tier 1 (`validateConfirmationsBody`) is pure shape — array-ness, item
//    object-ness, durableId/segment/action enum membership, and `value`
//    required (non-empty string) when action is "override". ANY tier-1
//    failure 400s the WHOLE request with every offending item's error,
//    nothing persisted — exactly `validateProposalsBody`'s contract, checked
//    before the manifest/registries are even read.
//  - Tier 2 (`applyConfirmation`, driven by the route loop) is business rules
//    that need the loaded manifest/registries: does the durableId exist; for
//    confirm, is the target segment actually present AND provenance
//    "inferred" (derived/defaulted/elicited/absent all reject); for
//    override, does the value normalize (registry member for a coordinate
//    axis via `normalizeCoordinateToken`, non-empty kebab for label via
//    `toKebabLabel`). A tier-2 failure is a PER-ITEM error — collected into
//    `errors[]` — that does not fail the rest of the batch, mirroring the
//    proposals route's skip+errors precedent. Chosen over a whole-batch 400
//    because (a) the brief's own TDD notes phrase these as "400/error" and
//    "rejected", not as an unconditional whole-request 400, and (b) a batch
//    is deliberately how the panel composes many independent per-segment
//    gestures in one request — one bad item shouldn't void every other
//    confirmation submitted alongside it.
//
// CONFIRM never touches provenance — the tag records epistemic origin,
// confirmation records ratification (`confirmed: true` only).
//
// OVERRIDE always sets provenance "elicited", source "user", and — since
// `confirmed` only has meaning for "inferred" (see `ProvenancedValue`'s own
// doc) — leaves it unset (a freshly-created coordinate never had one; a
// label override drops any prior `confirmed`, since it no longer applies to
// an elicited segment). Override may CREATE a coordinate that was
// previously absent (e.g. a state axis omitted at its registry default) —
// there is nothing to "replace" yet, but overriding is still valid: the
// user is asserting an explicit value exactly as if the axis already existed.
//
// Multiple items in one request MAY target the same durableId (e.g. confirm
// "label" and override "viewport" for the same node) — the route
// accumulates all of a durableId's mutations onto ONE shared candidate
// (never re-cloning from the original per item), so a LATER item in the
// batch sees an EARLIER one's effect: an override that turns a segment
// "elicited" makes a later "confirm" of that same segment correctly fail —
// there is no longer anything inferred left to ratify.
//
// ATOMICITY: same shape as the proposals route — each candidate is a
// `structuredClone`, mutated in place, and only committed into
// `manifest.records` after `serializeAddress` succeeds on it. A backstop
// try/catch means one candidate's unexpected serialize failure never
// corrupts that record (the original is left untouched) and never discards
// other candidates already committed from the same batch.

const CONFIRM_SEGMENT_VALUES = new Set(["label", "viewport", "mode", "theme", "state"]);
const CONFIRM_ACTION_VALUES = new Set(["confirm", "override"]);

interface IdentityConfirmationItem {
  durableId: string;
  segment: "label" | "viewport" | "mode" | "theme" | "state";
  action: "confirm" | "override";
  value?: string;
}

/** Tier 1 — pure body-shape validation; needs no manifest/registries. */
function validateConfirmationsBody(
  body: unknown,
): { ok: true; confirmations: IdentityConfirmationItem[] } | { ok: false; errors: string[] } {
  const confirmationsRaw = isPlainObject(body) ? body["confirmations"] : undefined;
  if (!Array.isArray(confirmationsRaw)) {
    return { ok: false, errors: ['"confirmations" must be an array'] };
  }

  const errors: string[] = [];
  const confirmations: IdentityConfirmationItem[] = [];
  confirmationsRaw.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      errors.push(`confirmations[${i}] must be an object`);
      return;
    }
    if (typeof raw["durableId"] !== "string" || raw["durableId"].trim() === "") {
      errors.push(`confirmations[${i}].durableId must be a non-empty string`);
      return;
    }
    if (!CONFIRM_SEGMENT_VALUES.has(raw["segment"] as string)) {
      errors.push(`confirmations[${i}].segment must be one of "label" | "viewport" | "mode" | "theme" | "state"`);
      return;
    }
    if (!CONFIRM_ACTION_VALUES.has(raw["action"] as string)) {
      errors.push(`confirmations[${i}].action must be "confirm" | "override"`);
      return;
    }
    if (raw["action"] === "override" && (typeof raw["value"] !== "string" || raw["value"].trim() === "")) {
      errors.push(`confirmations[${i}].value must be a non-empty string when action is "override"`);
      return;
    }
    if (raw["value"] !== undefined && typeof raw["value"] !== "string") {
      errors.push(`confirmations[${i}].value must be a string when present`);
      return;
    }
    confirmations.push({
      durableId: raw["durableId"],
      segment: raw["segment"] as IdentityConfirmationItem["segment"],
      action: raw["action"] as IdentityConfirmationItem["action"],
      ...(typeof raw["value"] === "string" ? { value: raw["value"] } : {}),
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, confirmations };
}

/**
 * Tier 2 — apply one already-shape-valid confirmation to `candidate` in
 * place. `candidate` MUST be a private clone the caller owns (see the
 * ATOMICITY note above). Every failure path returns BEFORE mutating
 * `candidate` — a rejected item is guaranteed to leave it exactly as the
 * caller passed it in, so the route's map-of-candidates accumulation (a
 * later successful item for the same durableId) is never corrupted by an
 * earlier rejected one.
 */
function applyConfirmation(
  candidate: NodeIdentityRecord,
  item: IdentityConfirmationItem,
  registries: IdentityRegistries,
): { ok: true } | { ok: false; error: string } {
  const where = `${item.durableId}.${item.segment}`;

  if (item.segment === "label") {
    const lastSeg = candidate.path[candidate.path.length - 1];
    if (lastSeg === undefined) {
      return { ok: false, error: `${where}: record has no path segments` };
    }
    if (item.action === "confirm") {
      if (lastSeg.provenance !== "inferred") {
        return {
          ok: false,
          error: `${where}: cannot confirm — provenance is "${lastSeg.provenance}", only inferred segments can be confirmed`,
        };
      }
      lastSeg.confirmed = true;
      return { ok: true };
    }
    // override — normalize free text to a grammar-valid kebab label.
    const normalized = toKebabLabel(item.value ?? "");
    if (normalized === "") {
      return { ok: false, error: `${where}: override value "${item.value}" is not a valid label` };
    }
    lastSeg.label = normalized;
    lastSeg.provenance = "elicited";
    lastSeg.source = "user";
    delete lastSeg.confirmed;
    return { ok: true };
  }

  // coordinate segment (viewport | mode | theme | state)
  const axis = item.segment;
  const current = candidate.coordinates[axis];
  if (item.action === "confirm") {
    if (current === undefined) {
      return { ok: false, error: `${where}: cannot confirm — segment is not set` };
    }
    if (current.provenance !== "inferred") {
      return {
        ok: false,
        error: `${where}: cannot confirm — provenance is "${current.provenance}", only inferred segments can be confirmed`,
      };
    }
    current.confirmed = true;
    return { ok: true };
  }
  // override — registry-member only; may CREATE the axis if it was absent.
  const normalized = normalizeCoordinateToken(axis, item.value ?? "", registries);
  if (normalized === null) {
    return { ok: false, error: `${where}: override value "${item.value}" is not a registered ${axis} token` };
  }
  candidate.coordinates[axis] = { value: normalized, provenance: "elicited", source: "user" };
  return { ok: true };
}

// ─── Node identity: applied-stamp wire-shape validation (Task 14, Phase 4) ────
//
// POST /project/identity/applied stamps `appliedAddress`/`appliedAt` on a
// manifest record after the plugin main thread has confirmed writing a
// canvas rename (the bus's identity-apply → identity-applied round-trip).
// Unlike confirm/proposals, there is no tier-2 business rule to violate here
// — a stamp is always valid once its shape checks out — so a durableId that
// doesn't resolve in the manifest is simply skipped (not an error, not
// counted in `stamped`): the write-back planner already decided this record
// was appliable; a manifest that has since moved on (re-scanned, durableId
// gone) shouldn't fail the whole batch over it.

interface IdentityAppliedItem {
  durableId: string;
  appliedAddress: string;
}

function validateAppliedBody(
  body: unknown,
): { ok: true; applied: IdentityAppliedItem[] } | { ok: false; errors: string[] } {
  const appliedRaw = isPlainObject(body) ? body["applied"] : undefined;
  if (!Array.isArray(appliedRaw)) {
    return { ok: false, errors: ['"applied" must be an array'] };
  }

  const errors: string[] = [];
  const applied: IdentityAppliedItem[] = [];
  appliedRaw.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      errors.push(`applied[${i}] must be an object`);
      return;
    }
    if (typeof raw["durableId"] !== "string" || raw["durableId"].trim() === "") {
      errors.push(`applied[${i}].durableId must be a non-empty string`);
      return;
    }
    if (typeof raw["appliedAddress"] !== "string" || raw["appliedAddress"].trim() === "") {
      errors.push(`applied[${i}].appliedAddress must be a non-empty string`);
      return;
    }
    applied.push({ durableId: raw["durableId"], appliedAddress: raw["appliedAddress"] });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, applied };
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
    opts.onRootServed?.(resolved);
    const snapshot = await buildSnapshot(resolved, registry.dataDirFor(resolved));
    const managed = opts.managedFor?.(resolved);
    return {
      ok: true,
      snapshot: {
        ...snapshot,
        workers: opts.workersFor?.(resolved) ?? [],
        ...(managed !== undefined ? { managed } : {}),
      },
    };
  });

  // ── GET /project/snapshot ────────────────────────────────────────────────
  app.get<{ Querystring: { root?: string } }>("/project/snapshot", async (req, reply) => {
    const ctx = await resolveRoot(req.query.root, reply);
    if (ctx === null) return reply;
    const snapshot = await buildSnapshot(ctx.root, ctx.dataDir);
    const managed = opts.managedFor?.(ctx.root);
    return {
      ...snapshot,
      workers: opts.workersFor?.(ctx.root) ?? [],
      ...(managed !== undefined ? { managed } : {}),
    };
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

  // ── GET /project/trace ───────────────────────────────────────────────────
  app.get<{ Querystring: { root?: string } }>("/project/trace", async (req, reply) => {
    const ctx = await resolveRoot(req.query.root, reply);
    if (ctx === null) return reply;
    return buildTrace(ctx.root, ctx.dataDir);
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

  // ── GET /project/identity/registries ─────────────────────────────────────
  app.get<{ Querystring: { root?: string } }>(
    "/project/identity/registries",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;
      const registriesPath = path.join(ctx.dataDir, "identity-registries.json");
      try {
        const raw = await readFile(registriesPath, "utf8");
        return { registries: JSON.parse(raw) as IdentityRegistries };
      } catch {
        return { registries: defaultIdentityRegistries() };
      }
    },
  );

  // ── PUT /project/identity/registries ─────────────────────────────────────
  app.put<{ Querystring: { root?: string }; Body: { registries?: unknown } }>(
    "/project/identity/registries",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;
      const result = validateIdentityRegistries(req.body?.registries);
      if (!result.ok) {
        return reply.code(400).send({ errors: result.errors });
      }
      const registriesPath = path.join(ctx.dataDir, "identity-registries.json");
      await mkdir(ctx.dataDir, { recursive: true });
      await writeFile(registriesPath, `${JSON.stringify(result.value, null, 2)}\n`, "utf8");
      return { ok: true };
    },
  );

  // ── GET /project/identity/components ─────────────────────────────────────
  app.get<{ Querystring: { root?: string } }>(
    "/project/identity/components",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;
      const componentsPath = path.join(ctx.dataDir, "component-registry.json");
      try {
        const raw = await readFile(componentsPath, "utf8");
        const registry = JSON.parse(raw) as ComponentRegistry;
        return { components: registry.components };
      } catch {
        return { components: [] as ComponentTypeEntry[] };
      }
    },
  );

  // ── PUT /project/identity/components ──────────────────────────────────────
  app.put<{ Querystring: { root?: string }; Body: { components?: unknown } }>(
    "/project/identity/components",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;
      const result = validateComponentsBody(req.body);
      if (!result.ok) {
        return reply.code(400).send({ errors: result.errors });
      }
      const componentsPath = path.join(ctx.dataDir, "component-registry.json");
      const registry: ComponentRegistry = { version: 1, components: result.components };
      await mkdir(ctx.dataDir, { recursive: true });
      await writeFile(componentsPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
      return { ok: true };
    },
  );

  // ── GET /project/identity/manifest ───────────────────────────────────────
  app.get<{ Querystring: { root?: string } }>(
    "/project/identity/manifest",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;
      const manifestPath = path.join(ctx.dataDir, "node-manifest.json");
      try {
        const raw = await readFile(manifestPath, "utf8");
        return { manifest: JSON.parse(raw) as NodeManifest };
      } catch {
        return { manifest: { version: 1, records: {} } as NodeManifest };
      }
    },
  );

  // ── POST /project/identity/extraction ────────────────────────────────────
  // MVP cut: assembles from structural facts alone, no vision. Loads
  // registries/components/prior-manifest (file or their documented
  // defaults — same read pattern as the GETs above), runs assembleIdentities
  // (Task 7 — it already carries appliedAddress/appliedAt forward from the
  // prior record per durableId), then upserts the assembled records into the
  // manifest: only durableIds present in THIS extraction are replaced, every
  // other record is left byte-identical (a partial-page scan must not wipe
  // records outside its scope).
  app.post<{ Querystring: { root?: string }; Body: { extraction?: unknown } }>(
    "/project/identity/extraction",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;

      const validated = validateExtractionBody(req.body);
      if (!validated.ok) {
        return reply.code(400).send({ errors: validated.errors });
      }
      const { extraction } = validated;

      const registriesPath = path.join(ctx.dataDir, "identity-registries.json");
      let registries: IdentityRegistries;
      try {
        registries = JSON.parse(await readFile(registriesPath, "utf8")) as IdentityRegistries;
      } catch {
        registries = defaultIdentityRegistries();
      }

      const componentsPath = path.join(ctx.dataDir, "component-registry.json");
      let components: ComponentRegistry;
      try {
        components = JSON.parse(await readFile(componentsPath, "utf8")) as ComponentRegistry;
      } catch {
        components = { version: 1, components: [] };
      }

      const manifestPath = path.join(ctx.dataDir, "node-manifest.json");
      let priorManifest: NodeManifest;
      try {
        priorManifest = JSON.parse(await readFile(manifestPath, "utf8")) as NodeManifest;
      } catch {
        priorManifest = { version: 1, records: {} };
      }

      const { records } = assembleIdentities(extraction, registries, components, priorManifest);

      const merged: NodeManifest = { version: 1, records: { ...priorManifest.records } };
      for (const record of records) {
        merged.records[record.durableId] = record;
      }

      await mkdir(ctx.dataDir, { recursive: true });
      await writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

      const addresses = records.map((r) => r.address);
      return { ok: true, count: records.length, addresses: addresses.slice(0, 50) };
    },
  );

  // ── POST /project/identity/crops ─────────────────────────────────────────
  // Root-tier crops pipeline (Task 9, Phase 3: vision). Writes one PNG per
  // crop under identity/crops/<durableId>.png — mkdir -p the dir, overwrite
  // an existing crop for the same durableId (a re-scan always reflects the
  // current canvas state). durableId is checked against DURABLE_ID_RE BEFORE
  // it ever reaches path.join — anything else is skipped, never written,
  // never a path escape (see validateCropsBody's comment for why this is a
  // per-entry skip rather than a whole-request 400).
  app.post<{ Querystring: { root?: string }; Body: { crops?: unknown } }>(
    "/project/identity/crops",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;

      const validated = validateCropsBody(req.body);
      if (!validated.ok) {
        return reply.code(400).send({ errors: validated.errors });
      }

      const cropsDir = path.join(ctx.dataDir, "identity", "crops");
      await mkdir(cropsDir, { recursive: true });

      let written = 0;
      for (const crop of validated.crops) {
        if (!DURABLE_ID_RE.test(crop.durableId)) continue;
        const bytes = Buffer.from(crop.base64, "base64");
        await writeFile(path.join(cropsDir, `${crop.durableId}.png`), bytes);
        written++;
      }

      return { ok: true, written };
    },
  );

  // ── POST /project/identity/proposals ─────────────────────────────────────
  // Task 10, Phase 3: merges the node-identity worker skill's vision proposals
  // into node-manifest.json — the single writer for this file (see the
  // extraction route above for the same read-current/mutate/write-back
  // pattern). Every applied change re-serializes the record's `address` from
  // its (possibly just-updated) path + coordinates, so the manifest's address
  // string never drifts from what it actually encodes. See
  // applyIdentityProposal's comment for the exact per-field merge rules.
  app.post<{ Querystring: { root?: string }; Body: { proposals?: unknown } }>(
    "/project/identity/proposals",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;

      const validated = validateProposalsBody(req.body);
      if (!validated.ok) {
        return reply.code(400).send({ errors: validated.errors });
      }

      const registriesPath = path.join(ctx.dataDir, "identity-registries.json");
      let registries: IdentityRegistries;
      try {
        registries = JSON.parse(await readFile(registriesPath, "utf8")) as IdentityRegistries;
      } catch {
        registries = defaultIdentityRegistries();
      }

      const componentsPath = path.join(ctx.dataDir, "component-registry.json");
      let components: ComponentRegistry;
      try {
        components = JSON.parse(await readFile(componentsPath, "utf8")) as ComponentRegistry;
      } catch {
        components = { version: 1, components: [] };
      }

      const manifestPath = path.join(ctx.dataDir, "node-manifest.json");
      let manifest: NodeManifest;
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf8")) as NodeManifest;
      } catch {
        manifest = { version: 1, records: {} };
      }

      const now = new Date().toISOString();
      let applied = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const proposal of validated.proposals) {
        const original = manifest.records[proposal.durableId];
        if (original === undefined) {
          skipped++;
          continue;
        }
        // Backstop (post-review fix — ATOMIC): with the label/mode/theme/
        // roleName normalization above, this try/catch should be unreachable
        // on validated input — it exists so ONE unexpected throw (e.g. from
        // stale/hand-edited manifest data — a PRE-EXISTING invalid segment
        // this proposal never even touches) can never 500 the whole route,
        // discard proposals already merged earlier in this batch, OR persist
        // a partially-mutated record. `applyIdentityProposal` and
        // `serializeAddress` run against a `candidate` — a private clone —
        // and `original` (still referenced by `manifest.records`) is
        // reassigned ONLY after both succeed. On any throw, `original` is
        // simply left in place, byte-for-byte as it was before this proposal.
        try {
          const candidate = structuredClone(original);
          if (!applyIdentityProposal(candidate, proposal, components, registries)) {
            skipped++;
            continue;
          }
          candidate.updatedAt = now;
          candidate.address = serializeAddress(
            {
              path: candidate.path.map((seg) => ({
                label: seg.label,
                ...(seg.ordinal !== undefined ? { ordinal: seg.ordinal } : {}),
              })),
              coordinates: toAddressCoordinates(candidate.coordinates),
            } satisfies CanonicalAddress,
            registries,
          );
          manifest.records[proposal.durableId] = candidate;
          applied++;
        } catch (err) {
          skipped++;
          errors.push(`${proposal.durableId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      await mkdir(ctx.dataDir, { recursive: true });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      return { applied, skipped, ...(errors.length > 0 ? { errors } : {}) };
    },
  );

  // ── POST /project/identity/confirm ───────────────────────────────────────
  // Task 12, Phase 4: lets the panel ratify an inferred segment (`confirm`)
  // or replace any segment's value (`override`). See the
  // `validateConfirmationsBody`/`applyConfirmation` comment block above this
  // plugin for the two-tier validation split, the same-durableId
  // accumulation rule, and the atomicity guarantee.
  app.post<{ Querystring: { root?: string }; Body: { confirmations?: unknown } }>(
    "/project/identity/confirm",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;

      const validated = validateConfirmationsBody(req.body);
      if (!validated.ok) {
        return reply.code(400).send({ errors: validated.errors });
      }

      const registriesPath = path.join(ctx.dataDir, "identity-registries.json");
      let registries: IdentityRegistries;
      try {
        registries = JSON.parse(await readFile(registriesPath, "utf8")) as IdentityRegistries;
      } catch {
        registries = defaultIdentityRegistries();
      }

      const manifestPath = path.join(ctx.dataDir, "node-manifest.json");
      let manifest: NodeManifest;
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf8")) as NodeManifest;
      } catch {
        manifest = { version: 1, records: {} };
      }

      const now = new Date().toISOString();
      const errors: string[] = [];
      // durableId → the shared candidate accumulating every confirmation
      // this batch applied to it so far (see the comment block above).
      const candidates = new Map<string, NodeIdentityRecord>();

      for (const item of validated.confirmations) {
        const original = manifest.records[item.durableId];
        if (original === undefined) {
          errors.push(`${item.durableId}: not found in manifest`);
          continue;
        }
        const candidate = candidates.get(item.durableId) ?? structuredClone(original);
        const result = applyConfirmation(candidate, item, registries);
        if (!result.ok) {
          errors.push(result.error);
          continue;
        }
        candidates.set(item.durableId, candidate);
      }

      let updated = 0;
      for (const [durableId, candidate] of candidates) {
        try {
          candidate.updatedAt = now;
          candidate.address = serializeAddress(
            {
              path: candidate.path.map((seg) => ({
                label: seg.label,
                ...(seg.ordinal !== undefined ? { ordinal: seg.ordinal } : {}),
              })),
              coordinates: toAddressCoordinates(candidate.coordinates),
            } satisfies CanonicalAddress,
            registries,
          );
          manifest.records[durableId] = candidate;
          updated++;
        } catch (err) {
          errors.push(`${durableId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      await mkdir(ctx.dataDir, { recursive: true });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      return { ok: true, updated, ...(errors.length > 0 ? { errors } : {}) };
    },
  );

  // ── POST /project/identity/applied ───────────────────────────────────────
  // Task 14, Phase 4: after the plugin main thread acks a canvas rename
  // (identity-apply → identity-applied over the bus), the panel calls this
  // to stamp `appliedAddress`/`appliedAt` on the corresponding manifest
  // record — see validateAppliedBody's comment for why an unresolved
  // durableId is a silent skip rather than a per-item error.
  app.post<{ Querystring: { root?: string }; Body: { applied?: unknown } }>(
    "/project/identity/applied",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;

      const validated = validateAppliedBody(req.body);
      if (!validated.ok) {
        return reply.code(400).send({ errors: validated.errors });
      }

      const manifestPath = path.join(ctx.dataDir, "node-manifest.json");
      let manifest: NodeManifest;
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf8")) as NodeManifest;
      } catch {
        manifest = { version: 1, records: {} };
      }

      const now = new Date().toISOString();
      let stamped = 0;
      for (const item of validated.applied) {
        const record = manifest.records[item.durableId];
        if (record === undefined) continue;
        record.appliedAddress = item.appliedAddress;
        record.appliedAt = now;
        stamped++;
      }

      if (stamped > 0) {
        await mkdir(ctx.dataDir, { recursive: true });
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      }

      return { ok: true, stamped };
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

  // ── GET /project/personas ────────────────────────────────────────────────
  app.get<{ Querystring: { root?: string } }>("/project/personas", async (req, reply) => {
    const ctx = await resolveRoot(req.query.root, reply);
    if (ctx === null) return reply;
    const dir = path.join(ctx.root, ARTIFACTS_DIR, "personas");
    return { personas: await readPersonas(dir) };
  });

  // ── PUT /project/personas/:id ────────────────────────────────────────────
  // `:id` is validated against PERSONA_ID_RE BEFORE any path.join — a
  // path-traversal or otherwise malformed id 400s with nothing written.
  // PERSONA_ID_RE accepts both minted `P-NN` ids and hand-authored slugs
  // (e.g. `ana`): first character alphanumeric, rest alphanumeric/`-`/`_` —
  // no `.`, `/`, `\`, leading `-`/`_`, spaces, or empty. `applyArtifactWrite`
  // additionally re-resolves the path and refuses anything outside the
  // project root (defense in depth, same guard DELETE repeats below). The
  // server always STAMPS `personaId === :id` on the written body (ignoring
  // any id the client sent), so the filename and the file's own id can never
  // drift apart.
  app.put<{ Params: { id: string }; Querystring: { root?: string }; Body: { persona?: unknown } }>(
    "/project/personas/:id",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;
      const id = req.params.id;
      if (!PERSONA_ID_RE.test(id)) {
        return reply
          .code(400)
          .send({ error: `invalid persona id "${id}" — expected letters, numbers, -, _ (first char alphanumeric)` });
      }
      const body = req.body as { persona?: unknown };
      if (body?.persona === null || typeof body?.persona !== "object" || Array.isArray(body?.persona)) {
        return reply.code(400).send({ error: "persona must be an object" });
      }
      const persona = { ...(body.persona as Record<string, unknown>), personaId: id }; // server owns the id
      await applyArtifactWrite(ctx.root, {
        path: `${ARTIFACTS_DIR}/personas`,
        instanceFile: `${id}.json`,
        body: persona,
      });
      return { ok: true };
    },
  );

  // ── DELETE /project/personas/:id ─────────────────────────────────────────
  // Same id validation as the PUT route, PLUS a belt-and-suspenders resolved-
  // path check (PUT gets this for free from applyArtifactWrite's
  // resolveWithin; DELETE calls `rm` directly, so it repeats the guard here
  // rather than relying on the regex alone). Idempotent: deleting an already-
  // absent instance still returns `{ ok: true, deleted: false }` rather than
  // erroring — the panel's delete gesture shouldn't fail on a double-click or
  // a stale list.
  app.delete<{ Params: { id: string }; Querystring: { root?: string } }>(
    "/project/personas/:id",
    async (req, reply) => {
      const ctx = await resolveRoot(req.query.root, reply);
      if (ctx === null) return reply;
      const id = req.params.id;
      if (!PERSONA_ID_RE.test(id)) {
        return reply.code(400).send({ error: `invalid persona id "${id}"` });
      }
      const personasDirAbs = path.resolve(ctx.root, ARTIFACTS_DIR, "personas");
      const file = path.resolve(personasDirAbs, `${id}.json`);
      if (!file.startsWith(personasDirAbs + path.sep)) {
        return reply.code(400).send({ error: `invalid persona id "${id}"` });
      }
      let deleted = false;
      try {
        await rm(file);
        deleted = true;
      } catch {
        /* absent → idempotent */
      }
      return { ok: true, deleted };
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

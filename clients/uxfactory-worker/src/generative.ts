/**
 * Generative dispatch — run a SKILL through the autonomous `AgentAdapter`.
 *
 * The generative request kinds run a SKILL verbatim as the adapter's
 * `systemPrompt` and a short kind-specific user instruction:
 *   - `generate-artifact` → the `generate` skill: draft ONE UX artifact for a
 *     classification + project and write it to the registry's expected path.
 *   - `canvas-review`      → the `vision-review` skill: review the pending canvas.
 *   - `generate-design`    → the `design` skill: author self-contained
 *     `design/screens/<page>.html` screens + a `design/trace.json` coverage
 *     manifest covering the stories, then iterate the deterministic
 *     `uxfactory batch` HTML gate to a green bar. Its narration carries
 *     `UXF::PROGRESS <json>` lines that we forward as structured `progress`
 *     events so the panel can render live loop progress.
 *
 * The adapter is INJECTED (the worker depends on the interface, not a concrete
 * backend) and this module imports ONLY types from `@helmsmith/*`, so importing
 * the dispatch loop never pulls in the LLM stack — the real adapter is built
 * lazily in `main()`. We therefore accumulate text-deltas by hand rather than
 * importing the lib's `reduceStream` (which would make this a runtime barrel
 * dependency); both reach the same end-state for the streamed text.
 *
 * Live events: we iterate `adapter.stream(input)` and forward every `AgentChunk`
 * to the bridge (→ SSE → panel), masking any `sk-…`-shaped secret in streamed
 * text first. A `usage` chunk is flattened + forwarded (and its latest cumulative
 * total returned in the result) so the panel can show token cost climbing through
 * the multi-turn loop. Any thrown `AdapterError` (Auth/Billing/RateLimit/Network/…)
 * — or an in-band `error` chunk — is a setup/transport failure → `status 2`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentInput, AgentChunk } from '@helmsmith/agent-adapter';
import type { AgentAdapter } from './adapter.js';
import type { PipelineRequest, BridgeLike } from './bridge-client.js';
import type { DispatchCtx, DispatchOutcome } from './dispatch.js';
import { ensureBatchRegistry } from './batch-registry.js';
import { loadSkill } from './skills.js';
import { landDesign, realLandingDeps, type LandingResult } from './landing.js';

// ---------------------------------------------------------------------------
// secret masking — never let an `sk-…`-shaped key reach the panel or the result
// ---------------------------------------------------------------------------

/** Matches `sk-…` API-key-shaped runs (e.g. `sk-ant-api03-…`). */
const SK_RE = /sk-[A-Za-z0-9_-]{8,}/g;
const REDACTION = 'sk-[redacted]';

/** Redact any `sk-…`-shaped substring. */
function maskText(s: string): string {
  return s.replace(SK_RE, REDACTION);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/**
 * Project a raw `AgentChunk` into the (masked, JSON-serializable) event posted to
 * the bridge. `text-delta`/`thinking-delta` text is masked; an `error` chunk's
 * `AdapterError` is reduced to `{ name, message }` (an Error serializes to `{}`),
 * with its message masked too; a `usage` chunk is flattened to
 * `{ type:'usage', inputTokens, outputTokens }` so the panel can show tokens
 * climbing live. Everything else passes through verbatim.
 */
function toEvent(chunk: AgentChunk): unknown {
  switch (chunk.type) {
    case 'text-delta':
      return { type: 'text-delta', text: maskText(chunk.text) };
    case 'thinking-delta':
      return { type: 'thinking-delta', text: maskText(chunk.text) };
    case 'error':
      return {
        type: 'error',
        error: { name: chunk.error.name, message: maskText(chunk.error.message) },
      };
    case 'usage':
      return {
        type: 'usage',
        inputTokens: chunk.usage.inputTokens,
        outputTokens: chunk.usage.outputTokens,
      };
    default:
      return chunk;
  }
}

// ---------------------------------------------------------------------------
// progress markers — the `design` loop narrates `UXF::PROGRESS <json>` lines
// ---------------------------------------------------------------------------

/** The progress marker prefix. The agent often prefixes narration before it. */
const PROGRESS_MARKER = 'UXF::PROGRESS';

/** Extract the balanced `{…}` object starting at `s[start]` (`{`), string-aware. */
function balancedObject(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse a narration line into a structured progress event payload, or `null` when
 * it carries no `UXF::PROGRESS <json>` marker or its JSON is malformed (best-effort).
 * The marker may appear MID-LINE — the agent often emits prose then the marker on
 * the same line — so we find it ANYWHERE and extract the balanced JSON object that
 * follows (string-aware, tolerant of trailing text). A `note` field is secret-masked.
 */
export function parseProgressLine(line: string): Record<string, unknown> | null {
  const at = line.indexOf(PROGRESS_MARKER);
  if (at < 0) return null;
  const brace = line.indexOf('{', at + PROGRESS_MARKER.length);
  if (brace < 0) return null;
  const json = balancedObject(line, brace);
  if (json === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const obj = { ...(payload as Record<string, unknown>) };
  if (typeof obj['note'] === 'string') obj['note'] = maskText(obj['note']);
  return obj;
}

// ---------------------------------------------------------------------------
// payload helpers (local copies — keep this module decoupled from dispatch)
// ---------------------------------------------------------------------------

function asObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : {};
}

function str(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key];
  return typeof v === 'string' ? v : undefined;
}

/** Render the `constraints` payload field (array | string | absent) for the prompt. */
function constraintsText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join('; ');
  if (typeof v === 'string' && v.trim() !== '') return v;
  return 'the profile constraints';
}

/** Render the `classification` payload field for the prompt. */
function classificationText(v: unknown): string {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && v.trim() !== '') return v;
  return 'the pinned classification in uxfactory.classification.json';
}

/** Render the `seedRefs` payload field (upstream artifact refs) for the prompt. */
function seedRefsText(v: unknown): string {
  if (Array.isArray(v)) {
    const refs = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    if (refs.length > 0) return refs.join(', ');
  }
  return 'none (this is an upstream/seed job — there are no prior artifacts to honor)';
}

// ---------------------------------------------------------------------------
// generate-artifact targets — the 3 panel jobs (Stories → ACs → Journeys)
// ---------------------------------------------------------------------------

/**
 * The 3 requirement-artifact workstreams the pipeline panel drives. Each maps to
 * an underlying registry artifact (2 files: stories + ACs persist into
 * `AcceptanceCriterion`; journeys into `UserFlow`) plus a per-target emphasis.
 */
export type GenerateTarget = 'user-story' | 'acceptance-criteria' | 'user-journey';

interface TargetPlan {
  /** The underlying registry artifact the draft persists into. */
  artifact: 'AcceptanceCriterion' | 'UserFlow';
  /** The default registry path used when the payload omits an explicit `path`. */
  pathHint: string;
  /** The per-target skill emphasis threaded into the user instruction. */
  emphasis: string;
}

/** Maps a `target` discriminator → its artifact, default path, and skill emphasis. */
const TARGET_MAP: Record<GenerateTarget, TargetPlan> = {
  'user-story': {
    artifact: 'AcceptanceCriterion',
    pathHint: 'design/acceptance-criteria.json',
    emphasis: 'draft the user-story narratives',
  },
  'acceptance-criteria': {
    artifact: 'AcceptanceCriterion',
    pathHint: 'design/acceptance-criteria.json',
    emphasis: 'draft testable acceptance criteria for the seeded stories',
  },
  'user-journey': {
    artifact: 'UserFlow',
    pathHint: 'design/user-flow.json',
    emphasis: 'draft the user journey / UserFlow spanning the seeded stories',
  },
};

/** Narrow an opaque payload field to a known `GenerateTarget`. */
function isTarget(v: unknown): v is GenerateTarget {
  return Object.prototype.hasOwnProperty.call(TARGET_MAP, v as string) && typeof v === 'string';
}

/**
 * Thrown when a `generate-artifact` request carries an absent or unrecognized
 * `target`. `runGenerative`'s catch maps it to `status 2` (a setup error) — the
 * adapter is never streamed for a request we can't route.
 */
export class InvalidTargetError extends Error {
  constructor(public readonly target: unknown) {
    super(
      `generate-artifact: invalid or missing 'target' (got ${JSON.stringify(target)}); ` +
        `expected one of: user-story | acceptance-criteria | user-journey`,
    );
    this.name = 'InvalidTargetError';
  }
}

// ---------------------------------------------------------------------------
// per-item refs — lift `{ ref, title?, seedRef? }` from the written artifact
// ---------------------------------------------------------------------------

/**
 * A per-item artifact ref the panel seeds downstream jobs from. The panel's
 * `toArtifacts(result)` reads `result.artifacts: ArtifactRef[]` and seeds the
 * next job (ACs / Journeys) from `jobs['user-story'].artifacts[].ref` — so a
 * generate-artifact run MUST surface these or downstream jobs can't seed.
 */
export interface ArtifactRef {
  ref: string;
  title?: string;
  seedRef?: string;
}

/** Narrow to a plain (non-array) object, else `undefined`. */
function rec(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** A required ref-ish value: a non-empty string or a finite number, else `undefined`. */
function idStr(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/** First non-empty string among `vals` (a human label), else `undefined`. */
function labelStr(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === 'string' && v.trim() !== '') return v;
  return undefined;
}

/** Build a ref, omitting absent optional fields (the panel reads them verbatim). */
function makeRef(ref: string, title?: string, seedRef?: string): ArtifactRef {
  const out: ArtifactRef = { ref };
  // `title` is free text read back from the agent-written file; mask any
  // `sk-…`-shaped secret before it reaches the panel (the module's invariant).
  // `ref`/`seedRef` are ids that must round-trip exactly for downstream seeding,
  // so they are NOT masked (a story id will never contain a secret).
  if (title !== undefined) out.title = maskText(title);
  if (seedRef !== undefined) out.seedRef = seedRef;
  return out;
}

/** The story objects from `parsed.stories` (or a top-level array). */
function storyList(parsed: unknown): Record<string, unknown>[] {
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray(rec(parsed)?.['stories'])
      ? (rec(parsed)!['stories'] as unknown[])
      : [];
  return arr.map(rec).filter((x): x is Record<string, unknown> => x !== undefined);
}

/** One UserFlow step (a node-name string, or a tolerant `{ id?, name?, story? }`). */
function stepRef(s: unknown, i: number): ArtifactRef {
  if (typeof s === 'string' || typeof s === 'number') {
    return makeRef(idStr(s) ?? `step-${i + 1}`);
  }
  const so = rec(s) ?? {};
  const ref = idStr(so['id']) ?? labelStr(so['name']) ?? `step-${i + 1}`;
  return makeRef(ref, labelStr(so['name'], so['label']), labelStr(so['story'], so['storyRef']));
}

/** user-story: each story with an `id` → `{ ref, title: goal ?? title ?? name }`. */
function extractStories(parsed: unknown): ArtifactRef[] {
  const out: ArtifactRef[] = [];
  for (const st of storyList(parsed)) {
    const ref = idStr(st['id']);
    if (ref === undefined) continue;
    out.push(makeRef(ref, labelStr(st['goal'], st['title'], st['name'])));
  }
  return out;
}

/**
 * acceptance-criteria: ACs are NESTED per story (no own id), so flatMap each
 * `st.acceptanceCriteria[i]` → `{ ref: `${st.id}#ac-${i+1}`, title, seedRef: st.id }`.
 * A story with no criteria yields one self-seeded `{ ref: st.id, …, seedRef: st.id }`.
 */
function extractCriteria(parsed: unknown): ArtifactRef[] {
  const out: ArtifactRef[] = [];
  for (const st of storyList(parsed)) {
    const ref = idStr(st['id']);
    if (ref === undefined) continue;
    const criteria = Array.isArray(st['acceptanceCriteria'])
      ? (st['acceptanceCriteria'] as unknown[])
      : [];
    if (criteria.length === 0) {
      out.push(makeRef(ref, labelStr(st['goal'], st['title'], st['name']), ref));
      continue;
    }
    criteria.forEach((c, i) => {
      const cr = rec(c) ?? {};
      out.push(makeRef(`${ref}#ac-${i + 1}`, labelStr(cr['statement'], cr['text']), ref));
    });
  }
  return out;
}

/**
 * user-journey: items = `parsed.steps` (canonical `string[]`, tolerant of objects).
 * With no steps, a recognizable flow doc yields ONE artifact from its id/name;
 * a genuinely empty/malformed doc yields `[]`.
 */
function extractJourney(parsed: unknown): ArtifactRef[] {
  if (Array.isArray(parsed)) return parsed.map(stepRef);
  const p = rec(parsed);
  if (p === undefined) return [];
  const hasSteps = Array.isArray(p['steps']);
  const steps = hasSteps ? (p['steps'] as unknown[]) : [];
  if (steps.length > 0) return steps.map(stepRef);
  const ref = idStr(p['id']) ?? labelStr(p['name']);
  const title = labelStr(p['name'], p['title']);
  // Only emit a flow fallback for a flow-shaped doc (declares steps, or names itself).
  if (!hasSteps && ref === undefined && title === undefined) return [];
  return [makeRef(ref ?? 'user-flow', title)];
}

/**
 * Lift per-item refs from a PARSED artifact file for a given target. Pure and
 * tolerant: any missing/malformed/empty input yields `[]` and it NEVER throws.
 */
export function extractArtifacts(parsed: unknown, target: GenerateTarget): ArtifactRef[] {
  try {
    switch (target) {
      case 'user-story':
        return extractStories(parsed);
      case 'acceptance-criteria':
        return extractCriteria(parsed);
      case 'user-journey':
        return extractJourney(parsed);
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/**
 * Best-effort read + parse + extract of the written artifact file. Returns the
 * per-item refs on success, or `undefined` when the file is missing/unreadable/
 * unparseable — the caller then OMITS `artifacts` (a graceful fallback that never
 * fails the generation).
 */
async function readArtifactRefs(
  filePath: string,
  target: GenerateTarget,
): Promise<ArtifactRef[] | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return extractArtifacts(parsed, target);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// permission grant (approach A) — least tools a headless skill needs
// ---------------------------------------------------------------------------

/**
 * The minimal Claude Code permission grant a HEADLESS autonomous skill needs to
 * do its job: shell the `uxfactory` CLI, write/edit artifact files, and READ its
 * inputs + the gate's `.uxfactory/batch/report.json`. The `design` skill drives a
 * full author→gate→read-report→revise loop, so `Read` is required (it reads the
 * stories/profile/registry and the report each iteration); it is a safe,
 * non-prompting tool and the other skills only benefit from it.
 *
 * SECURITY: the `claude-code-cli` adapter sandboxes `HOME → workdir`, so
 * `<projectRoot>/.claude/settings.json` IS the agent's home config FOR THIS RUN.
 * The grant is therefore scoped to the sandboxed run (the project tree) and never
 * widens the host operator's own Claude Code permissions. `.claude/` should be
 * gitignored by the consuming project (the worker's own `.gitignore` already is).
 * The exact least-privilege set for a real run is a live-only check (see notes).
 */
export const SKILL_TOOL_GRANTS = ['Bash(uxfactory:*)', 'Write', 'Edit', 'Read', 'Task'] as const;

/**
 * Idempotently ensure `<projectRoot>/.claude/settings.json` grants the skill the
 * tools it needs. Never clobbers an existing user file: an existing settings
 * object is preserved key-for-key and the `permissions.allow` list is UNION-ed
 * with {@link SKILL_TOOL_GRANTS} (no duplicates). Returns the settings path.
 */
export async function ensureSkillPermissions(projectRoot: string): Promise<string> {
  const dir = path.join(projectRoot, '.claude');
  const file = path.join(dir, 'settings.json');
  await mkdir(dir, { recursive: true });

  let settings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (parsed !== null && typeof parsed === 'object') settings = parsed as Record<string, unknown>;
  } catch {
    // No file yet (ENOENT), or an unparsable one — write a fresh, valid grant.
    // A *valid* user file is never clobbered (the read above succeeds + merges).
  }

  const perms =
    settings.permissions !== null && typeof settings.permissions === 'object'
      ? (settings.permissions as Record<string, unknown>)
      : {};
  const existing = Array.isArray(perms.allow)
    ? (perms.allow as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  const allow = [...existing];
  for (const grant of SKILL_TOOL_GRANTS) {
    if (!allow.includes(grant)) allow.push(grant);
  }

  settings.permissions = { ...perms, allow };
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * SP2: write the craft-judge rubric to `<projectRoot>/.uxfactory/craft-rubric.md` so
 * the in-session craft-judge SUBAGENT (dispatched by the design agent once the gate is
 * green) can read it — the engine's `skill/` dir is NOT in the agent's workspace.
 * Idempotent; the single source is `skill/craft-review/SKILL.md` (via loadSkill).
 */
export async function provisionCraftRubric(projectRoot: string): Promise<string> {
  const dir = path.join(projectRoot, '.uxfactory');
  const file = path.join(dir, 'craft-rubric.md');
  await mkdir(dir, { recursive: true });
  await writeFile(file, loadSkill('craft-review'), 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// panel-artifact plan table — the Artifacts tab concern keys
// ---------------------------------------------------------------------------

/**
 * The artifact concern keys the panel's Artifacts tab sends as
 * `{ kind: "generate-artifact", payload: { artifact: <key>, guidance?: string } }`.
 * Distinct from the legacy `target` discriminator used by the pipeline panel's
 * seeded workstreams (user-story / acceptance-criteria / user-journey).
 */
export type PanelArtifactKey =
  | 'brief'
  | 'sitemap'
  | 'flows'
  | 'brand-colors'
  | 'palettes'
  | 'fonts'
  | 'grid'
  | 'tokens'
  | 'icons'
  | 'photography'
  | 'illustrations';

interface PanelArtifactEntry {
  /** Human label used in the generated user instruction. */
  label: string;
  /**
   * Registry-matching path (relative to projectRoot) the agent writes the
   * artifact to. Verbatim copy from `buildArtifacts` in
   * `packages/uxfactory-bridge/src/project.ts` so writing this path flips the
   * snapshot row from `missing` → `up-to-date`.
   */
  path: string;
  /**
   * When set, the four design-system.json section keys (`brand-colors`,
   * `palettes`, `fonts`, `grid`) share a single file; the agent merges/creates
   * exactly this section without touching the others.
   */
  sectionKey?: string;
}

/**
 * Maps every panel concern key to its registry-matching target path and a
 * human label. Paths are verbatim from `buildArtifacts` in
 * `packages/uxfactory-bridge/src/project.ts`.
 */
const PANEL_ARTIFACT_MAP: Record<PanelArtifactKey, PanelArtifactEntry> = {
  brief: { label: 'Product Brief', path: 'brief.md' },
  sitemap: { label: 'Sitemap', path: 'design/sitemap.json' },
  flows: { label: 'Flows', path: 'design/flows.json' },
  'brand-colors': {
    label: 'Brand Colors',
    path: 'design/design-system.json',
    sectionKey: 'brand-colors',
  },
  palettes: { label: 'Palettes', path: 'design/design-system.json', sectionKey: 'palettes' },
  fonts: { label: 'Fonts', path: 'design/design-system.json', sectionKey: 'fonts' },
  grid: { label: 'Grid', path: 'design/design-system.json', sectionKey: 'grid' },
  tokens: { label: 'Tokens', path: 'design/token-set.json' },
  icons: { label: 'Icons', path: 'design/assets/icons.json' },
  photography: { label: 'Photography', path: 'design/assets/photography.json' },
  illustrations: { label: 'Illustrations', path: 'design/assets/illustrations.json' },
};

/** Narrow an opaque value to a known `PanelArtifactKey`. */
function isPanelArtifact(v: unknown): v is PanelArtifactKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PANEL_ARTIFACT_MAP, v);
}

/**
 * Thrown when a `generate-artifact` request carries an `artifact` key that is
 * not one of the panel concern keys. `runGenerative`'s catch maps it to
 * `status 2` — the adapter is never streamed.
 */
export class InvalidArtifactError extends Error {
  constructor(public readonly artifact: unknown) {
    super(
      `generate-artifact: unrecognised 'artifact' key (got ${JSON.stringify(artifact)}); ` +
        `expected one of: ${(Object.keys(PANEL_ARTIFACT_MAP) as PanelArtifactKey[]).join(' | ')}`,
    );
    this.name = 'InvalidArtifactError';
  }
}

// ---------------------------------------------------------------------------
// per-kind plan: which skill + what user instruction + the artifact path
// ---------------------------------------------------------------------------

interface GenerativePlan {
  systemPrompt: string;
  user: string;
  /** Echoed in the result for `generate-artifact` (the registry path written). */
  artifactPath?: string;
  /** The resolved target (drives which per-item refs we lift from the written file). */
  target?: GenerateTarget;
  /**
   * When true (the `generate-design` loop), the stream is scanned for
   * `UXF::PROGRESS <json>` lines and each is forwarded as a structured
   * `{ type: "progress", … }` event so the panel can render live loop progress.
   */
  progress?: boolean;
}

function planGenerative(req: PipelineRequest, ctx: DispatchCtx): GenerativePlan {
  const p = asObject(req.payload);

  if (req.kind === 'generate-artifact') {
    // ── Panel-artifact path (Artifacts tab: artifact + optional guidance) ───
    // The panel's Artifacts tab sends `{ artifact: <key>, guidance?: string }`.
    // Route through PANEL_ARTIFACT_MAP when the payload carries an `artifact`
    // key; an explicit but unrecognised key is a setup error (caught → status 2)
    // and the adapter is never streamed.
    const artifact = str(p, 'artifact');
    if (artifact !== undefined) {
      if (!isPanelArtifact(artifact)) throw new InvalidArtifactError(artifact);
      const entry = PANEL_ARTIFACT_MAP[artifact];
      const guidance = str(p, 'guidance');
      const sectionNote =
        entry.sectionKey !== undefined
          ? ` Merge ONLY the '${entry.sectionKey}' section into ${entry.path}` +
            ` (create the file if absent, preserve all other sections).`
          : '';
      const guidanceNote =
        guidance !== undefined && guidance.trim() !== ''
          ? ` USER GUIDANCE (honor verbatim): ${guidance}`
          : '';
      const user =
        `Write the ${entry.label} artifact to ${entry.path} inside ${ctx.projectRoot}.` +
        ` Ground the content in uxfactory.classification.json and uxfactory.profile.json` +
        ` (read both first).${sectionNote}` +
        ` Keep the output strictly the artifact file:` +
        ` valid JSON for .json targets, Markdown for .md targets.` +
        ` Report the written path once done.${guidanceNote}`;
      return {
        systemPrompt: loadSkill('generate'),
        user,
        artifactPath: entry.path,
      };
    }

    // ── Legacy target path (pipeline panel: target + seedRefs + constraints) ─
    // The panel drives 3 seeded workstreams via a `target` discriminator; an
    // absent/unknown target is a setup error (caught → status 2), never streamed.
    const target = p['target'];
    if (!isTarget(target)) throw new InvalidTargetError(target);

    const plan = TARGET_MAP[target];
    // An explicit `path` overrides the per-artifact default (the skill ultimately
    // writes to the registry's `inputs.<kind>` entry, but we hint a concrete path).
    const artifactPath = str(p, 'path') ?? plan.pathHint;
    const user =
      `Target: ${target} — ${plan.emphasis}. ` +
      `The underlying artifact is ${plan.artifact}; write it as JSON to ${artifactPath} in ${ctx.projectRoot}. ` +
      `Seed refs (upstream stories/artifacts this draft must honor): ${seedRefsText(p['seedRefs'])}. ` +
      `Classification: ${classificationText(p['classification'])}. ` +
      `Honor: ${constraintsText(p['constraints'])}.`;
    return {
      systemPrompt: loadSkill('generate'),
      user,
      artifactPath,
      target,
    };
  }

  if (req.kind === 'canvas-review') {
    return {
      systemPrompt: loadSkill('vision-review'),
      user: 'Review the pending canvas request; post the best-effort report.',
    };
  }

  if (req.kind === 'generate-design') {
    // The agentic high-fidelity HTML loop (matches skill/design/SKILL.md): author
    // self-contained `design/screens/<page>.html` screens (inline CSS + JS) that
    // cover the stories, author `design/tokens.ds.json` when the visual dial is
    // medium+, author a `design/trace.json` mapping every (story, impliedState) to
    // a (page, view, selector), then iterate the deterministic `uxfactory batch`
    // HTML gate to a green bar. The registry is provisioned with `inputs.screens`
    // + `inputs.trace` in `runGenerative` (before the agent's first `batch`) so
    // HTML mode is selected. The skill owns the whole loop; we hand it the task +
    // the working tree (the CLI is on PATH).
    const user =
      'Author REAL, self-contained UI screens as `design/screens/<page>.html` files ' +
      '(inline <style> + <script>, no external assets) that cover the stories and ' +
      'acceptance criteria in design/acceptance-criteria.json — one file per page, each ' +
      'hosting its view-states (empty/loading/error/success/edge) reachable via the ' +
      'activation contract (location.hash, a query param, or a click sequence; expose ' +
      'window.uxfReady for async states). Author design/tokens.ds.json registering every ' +
      'painted color when the profile visual dial is medium or higher. Author ' +
      'design/trace.json mapping every (story, impliedState) to a (page, view, selector). ' +
      'Then iterate `uxfactory batch --json -- design` to a green gate (exit 0), reading ' +
      '.uxfactory/batch/report.json after each run and revising the HTML/tokens/trace to ' +
      'clear every must-check finding (render-coverage · a11y · contrast · token-conformance). ' +
      `Work in ${ctx.projectRoot}; the uxfactory CLI is on PATH. ` +
      'Once the deterministic gate is green, run the independent craft-judge step (skill Step 4b): ' +
      'dispatch a fresh subagent following .uxfactory/craft-rubric.md to score the rendered ' +
      'screenshots and write craft-report.json, then revise for craft to the bar before finishing. ' +
      'Emit a UXF::PROGRESS line at every loop step. ' +
      'After the craft bar is met (or the budget is spent with the gate green), run `uxfactory extract --json design` once and report its stats line (phase "extract").';
    return {
      systemPrompt: loadSkill('design'),
      user,
      progress: true,
    };
  }

  throw new Error(`runGenerative: unsupported generative kind '${req.kind}'`);
}

// ---------------------------------------------------------------------------
// runGenerative — stream a SKILL through the adapter, forward + accumulate
// ---------------------------------------------------------------------------

/**
 * Run the SKILL for a generative request. NEVER rejects: every failure (a bad
 * kind, an `AdapterError`, an in-band `error` chunk) returns `{ status: 2 }`, and
 * a clean run returns `{ status: 0, result: { content, artifactPath?, artifacts?,
 * usage? } }`. `usage` (cumulative `inputTokens`/`outputTokens`) is attached only
 * when the runtime reported it; absent runtimes omit it gracefully.
 */
export async function runGenerative(
  req: PipelineRequest,
  adapter: AgentAdapter,
  bridge: BridgeLike,
  ctx: DispatchCtx,
): Promise<DispatchOutcome> {
  try {
    const plan = planGenerative(req, ctx);

    // Grant the headless skill the least tools it needs (shell uxfactory + write
    // files) inside the sandboxed project tree before invoking the adapter.
    await ensureSkillPermissions(ctx.projectRoot);

    // For the HTML design loop, register `inputs.screens` + `inputs.trace` in
    // `uxfactory.batch.json` UP FRONT (deterministically — not via the LLM) so the
    // agent's `uxfactory batch` selects HTML mode. These files don't exist yet at
    // provisioning time, so we bypass the existence gate for exactly these two keys;
    // every other input/kind keeps the existence-gated, non-clobbering behavior.
    if (req.kind === 'generate-design') {
      await ensureBatchRegistry(ctx.projectRoot, { unconditional: ['screens', 'trace'] });
      // SP2: place the craft-judge rubric in the project for the in-session judge subagent.
      await provisionCraftRubric(ctx.projectRoot);
    }

    const input: AgentInput = {
      messages: [{ role: 'user', content: plan.user }],
      systemPrompt: plan.systemPrompt,
    };

    let content = '';
    // The latest CUMULATIVE token usage the adapter reported (a `usage` chunk is
    // cumulative — `reduceStream` keeps the last one, so we mirror that and overwrite).
    // Omitted entirely when the runtime never reports usage (graceful, never throws).
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    // Buffer raw text across chunks so a `UXF::PROGRESS` marker that spans reads is
    // only parsed once newline-terminated (the loop narrates progress for the panel).
    let progressBuf = '';
    const emitProgress = async (line: string): Promise<void> => {
      const parsed = parseProgressLine(line);
      if (parsed !== null) await bridge.postEvent(req.id, { type: 'progress', ...parsed });
    };

    for await (const chunk of adapter.stream(input)) {
      // toEvent forwards every chunk masked/normalized — incl. flattening `usage`
      // to `{ type:'usage', inputTokens, outputTokens }` for the live panel feed.
      await bridge.postEvent(req.id, toEvent(chunk));
      if (chunk.type === 'text-delta') {
        content += maskText(chunk.text);
        // Forward structured progress IN ADDITION to the raw (masked) narration.
        if (plan.progress === true) {
          progressBuf += chunk.text;
          const segments = progressBuf.split('\n');
          progressBuf = segments.pop() ?? ''; // last segment may be incomplete — keep it
          for (const line of segments) await emitProgress(line);
        }
      }
      if (chunk.type === 'usage') {
        usage = { inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens };
      }
      if (chunk.type === 'error') {
        // An in-band terminal error chunk — setup/transport failure.
        return { status: 2, result: { error: maskText(chunk.error.message), content } };
      }
    }
    // Flush a trailing complete marker that arrived without a closing newline.
    if (plan.progress === true && progressBuf !== '') await emitProgress(progressBuf);

    // The skill wrote the artifact during the stream — READ it back (best-effort)
    // and attach per-item `{ ref, title?, seedRef? }` so the panel can seed the
    // downstream jobs (Stories → ACs / Journeys). A missing/unreadable/unparseable
    // file OMITS `artifacts` (graceful) — it never fails an otherwise-clean run.
    const artifacts =
      plan.target !== undefined && plan.artifactPath !== undefined
        ? await readArtifactRefs(path.join(ctx.projectRoot, plan.artifactPath), plan.target)
        : undefined;

    // For generate-design: publish + bounded-verify each per-view designspec that
    // the skill's Step 4c `uxfactory extract` produced. A landing failure NEVER
    // changes the job status — the whole block is wrapped in try/catch.
    let landing: LandingResult | undefined;
    if (req.kind === 'generate-design') {
      try {
        const bridgeDataDir = ctx.bridgeDataDir ?? path.resolve('.uxfactory');
        const landingResult = await landDesign(ctx.projectRoot, bridgeDataDir, realLandingDeps);
        if (landingResult !== null) {
          landing = landingResult;
          const passes = landingResult.verdicts.filter((v) => v.verify === 'pass').length;
          await bridge.postEvent(req.id, {
            type: 'progress',
            phase: 'landing',
            note: `${landingResult.published.length} published, ${passes} verified`,
          });
        }
      } catch {
        // Catastrophic landing failure — discard silently; status unchanged.
      }
    }

    return {
      status: 0,
      result: {
        content,
        ...(plan.artifactPath !== undefined ? { artifactPath: plan.artifactPath } : {}),
        ...(artifacts !== undefined ? { artifacts } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(landing !== undefined ? { landing } : {}),
      },
    };
  } catch (err) {
    // A thrown AdapterError (Auth/Billing/RateLimit/Network/Provider/…) or any
    // other setup failure → status 2 (the loop also re-maps, but we own a
    // structured, secret-masked result here).
    return { status: 2, result: { error: maskText(errMessage(err)) } };
  }
}

/**
 * Generative dispatch — run a SKILL through the autonomous `AgentAdapter`.
 *
 * The two generative request kinds run a SKILL verbatim as the adapter's
 * `systemPrompt` and a short kind-specific user instruction:
 *   - `generate-artifact` → the `generate` skill: draft ONE UX artifact for a
 *     classification + project and write it to the registry's expected path.
 *   - `canvas-review`      → the `vision-review` skill: review the pending canvas.
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
 * text first. Any thrown `AdapterError` (Auth/Billing/RateLimit/Network/…) — or
 * an in-band `error` chunk — is a setup/transport failure → `status 2`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentInput, AgentChunk } from '@helmsmith/agent-adapter';
import type { AgentAdapter } from './adapter.js';
import type { PipelineRequest, BridgeLike } from './bridge-client.js';
import type { DispatchCtx, DispatchOutcome } from './dispatch.js';
import { loadSkill } from './skills.js';

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
 * with its message masked too. Everything else passes through verbatim.
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
    default:
      return chunk;
  }
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
 * do its job: shell the `uxfactory` CLI and write/edit artifact files. (Read is
 * a safe, non-prompting tool and is intentionally NOT granted.)
 *
 * SECURITY: the `claude-code-cli` adapter sandboxes `HOME → workdir`, so
 * `<projectRoot>/.claude/settings.json` IS the agent's home config FOR THIS RUN.
 * The grant is therefore scoped to the sandboxed run (the project tree) and never
 * widens the host operator's own Claude Code permissions. `.claude/` should be
 * gitignored by the consuming project (the worker's own `.gitignore` already is).
 * The exact least-privilege set for a real run is a live-only check (see notes).
 */
export const SKILL_TOOL_GRANTS = ['Bash(uxfactory:*)', 'Write', 'Edit'] as const;

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
}

function planGenerative(req: PipelineRequest, ctx: DispatchCtx): GenerativePlan {
  const p = asObject(req.payload);

  if (req.kind === 'generate-artifact') {
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

  throw new Error(`runGenerative: unsupported generative kind '${req.kind}'`);
}

// ---------------------------------------------------------------------------
// runGenerative — stream a SKILL through the adapter, forward + accumulate
// ---------------------------------------------------------------------------

/**
 * Run the SKILL for a generative request. NEVER rejects: every failure (a bad
 * kind, an `AdapterError`, an in-band `error` chunk) returns `{ status: 2 }`, and
 * a clean run returns `{ status: 0, result: { content, artifactPath? } }`.
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

    const input: AgentInput = {
      messages: [{ role: 'user', content: plan.user }],
      systemPrompt: plan.systemPrompt,
    };

    let content = '';
    for await (const chunk of adapter.stream(input)) {
      await bridge.postEvent(req.id, toEvent(chunk));
      if (chunk.type === 'text-delta') content += maskText(chunk.text);
      if (chunk.type === 'error') {
        // An in-band terminal error chunk — setup/transport failure.
        return { status: 2, result: { error: maskText(chunk.error.message), content } };
      }
    }

    // The skill wrote the artifact during the stream — READ it back (best-effort)
    // and attach per-item `{ ref, title?, seedRef? }` so the panel can seed the
    // downstream jobs (Stories → ACs / Journeys). A missing/unreadable/unparseable
    // file OMITS `artifacts` (graceful) — it never fails an otherwise-clean run.
    const artifacts =
      plan.target !== undefined && plan.artifactPath !== undefined
        ? await readArtifactRefs(path.join(ctx.projectRoot, plan.artifactPath), plan.target)
        : undefined;

    return {
      status: 0,
      result: {
        content,
        ...(plan.artifactPath !== undefined ? { artifactPath: plan.artifactPath } : {}),
        ...(artifacts !== undefined ? { artifacts } : {}),
      },
    };
  } catch (err) {
    // A thrown AdapterError (Auth/Billing/RateLimit/Network/Provider/…) or any
    // other setup failure → status 2 (the loop also re-maps, but we own a
    // structured, secret-masked result here).
    return { status: 2, result: { error: maskText(errMessage(err)) } };
  }
}

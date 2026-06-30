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
}

function planGenerative(req: PipelineRequest, ctx: DispatchCtx): GenerativePlan {
  const p = asObject(req.payload);

  if (req.kind === 'generate-artifact') {
    const kind = str(p, 'kind') ?? 'artifact';
    const artifactPath = str(p, 'path');
    const user =
      `Draft a ${kind} artifact for this classification (${classificationText(p['classification'])}); ` +
      `write it to ${artifactPath ?? 'the registered path'} in ${ctx.projectRoot}. ` +
      `Honor: ${constraintsText(p['constraints'])}.`;
    return {
      systemPrompt: loadSkill('generate'),
      user,
      ...(artifactPath !== undefined ? { artifactPath } : {}),
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

    return {
      status: 0,
      result: {
        content,
        ...(plan.artifactPath !== undefined ? { artifactPath: plan.artifactPath } : {}),
      },
    };
  } catch (err) {
    // A thrown AdapterError (Auth/Billing/RateLimit/Network/Provider/…) or any
    // other setup failure → status 2 (the loop also re-maps, but we own a
    // structured, secret-masked result here).
    return { status: 2, result: { error: maskText(errMessage(err)) } };
  }
}

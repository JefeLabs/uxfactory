/**
 * Deterministic dispatch — the worker's CLI-backed request handlers.
 *
 * Each deterministic kind shells the `uxfactory` CLI in `ctx.projectRoot` and
 * relays the CLI's exit code as the result `status` (0 ok / 1 gate-fail / 2 setup).
 * The engine stays self-contained: dispatch knows the CLI's *command surface*, not
 * its internals — it never imports `@uxfactory/cli`.
 *
 * Generative kinds (`generate-artifact` / `canvas-review`) are NOT handled here —
 * they run a SKILL through the autonomous `AgentAdapter`. `runGenerative` is a typed
 * stub until Task 4 lands, so the loop compiles and fails loudly (status 2) if a
 * generative request arrives early.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runCli } from './run-cli.js';
import type { CliResult } from './run-cli.js';
import type { PipelineRequest, BridgeLike } from './bridge-client.js';
import type { AgentAdapter } from './adapter.js';

/** Execution context shared by every handler. */
export interface DispatchCtx {
  /** The git working tree where the CLI runs + artifacts are written. */
  projectRoot: string;
  /** Resolved `uxfactory` binary to spawn (see resolveCliBin). */
  cliBin: string;
}

/** A handler's terminal outcome — relayed verbatim to `postResult`. */
export interface DispatchOutcome {
  status: number;
  result: unknown;
}

type Handler = (payload: unknown, ctx: DispatchCtx) => Promise<DispatchOutcome>;

/** Coerce an opaque payload to a record without throwing on null/non-objects. */
function asObject(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : {};
}

/** Read an optional string field from a payload record. */
function str(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key];
  return typeof v === 'string' ? v : undefined;
}

/** Build the shared scope flags (`--scope` + per-dial) any reviewing command accepts. */
function scopeArgs(p: Record<string, unknown>): string[] {
  const args: string[] = [];
  const scope = str(p, 'scope');
  if (scope !== undefined) args.push('--scope', scope);
  for (const dial of ['visual', 'editorial', 'coverage', 'flow'] as const) {
    const v = str(p, dial);
    if (v !== undefined) args.push(`--${dial}`, v);
  }
  return args;
}

/**
 * If the payload carries a `classification`, write it to
 * `<projectRoot>/uxfactory.classification.json` BEFORE the CLI reads it — the
 * panel ships the classification with the request; the CLI reads it from disk.
 */
async function writeClassification(p: Record<string, unknown>, ctx: DispatchCtx): Promise<void> {
  if (p['classification'] === undefined) return;
  await writeFile(
    path.join(ctx.projectRoot, 'uxfactory.classification.json'),
    JSON.stringify(p['classification'], null, 2) + '\n',
    'utf8',
  );
}

/** Normalize a CLI result into a posted outcome (parsed JSON, else the stderr). */
function outcomeOf(cli: CliResult): DispatchOutcome {
  return { status: cli.status, result: cli.json ?? { stderr: cli.stderr } };
}

/**
 * The deterministic command table. Each handler maps a request kind to a CLI
 * invocation; the exit code becomes the result status.
 */
export const DETERMINISTIC: Record<string, Handler> = {
  // Derive a draft GateProfile from the (payload-provided) classification.
  classify: async (payload, ctx) => {
    const p = asObject(payload);
    await writeClassification(p, ctx);
    return outcomeOf(await runCli(ctx.cliBin, ['classify', '--json'], ctx.projectRoot));
  },

  // The compute→commit boundary: pin the profile, then run the batch gate.
  gate: async (payload, ctx) => {
    const p = asObject(payload);
    await writeClassification(p, ctx);
    const confirm = await runCli(ctx.cliBin, ['classify', '--confirm'], ctx.projectRoot);
    if (confirm.status !== 0) return outcomeOf(confirm);
    const dir = str(p, 'dir') ?? 'design';
    return outcomeOf(
      await runCli(ctx.cliBin, ['batch', dir, '--json', ...scopeArgs(p)], ctx.projectRoot),
    );
  },

  // One deterministic offline batch pass over a spec directory.
  batch: async (payload, ctx) => {
    const p = asObject(payload);
    const dir = str(p, 'dir') ?? 'design';
    return outcomeOf(
      await runCli(ctx.cliBin, ['batch', dir, '--json', ...scopeArgs(p)], ctx.projectRoot),
    );
  },

  // Conformance review of a design (file or directory of specs).
  review: async (payload, ctx) => {
    const p = asObject(payload);
    const design = str(p, 'design') ?? '.';
    return outcomeOf(
      await runCli(ctx.cliBin, ['review', design, '--json', ...scopeArgs(p)], ctx.projectRoot),
    );
  },

  // Approximate offline raster of one spec to `out`.
  render: async (payload, ctx) => {
    const p = asObject(payload);
    const spec = str(p, 'spec') ?? '';
    const out = str(p, 'out');
    const args = ['render', spec, ...(out !== undefined ? ['--out', out] : [])];
    const cli = await runCli(ctx.cliBin, args, ctx.projectRoot);
    // `render` prints the output path, not JSON — surface a small structured result.
    return {
      status: cli.status,
      result: cli.json ?? { ok: cli.status === 0, out: out ?? null, stderr: cli.stderr },
    };
  },
};

/** True when `kind` has a deterministic CLI handler (vs a generative skill). */
export function isDeterministic(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(DETERMINISTIC, kind);
}

/**
 * Generative dispatch — runs a SKILL through the autonomous adapter.
 *
 * STUB until Task 4. The signature is the one Task 4 implements
 * (`generate-artifact` / `canvas-review`: stream chunks → `bridge.postEvent`,
 * accumulate → result). Throwing here is caught by the loop and posted as
 * status 2, so an early generative request degrades gracefully.
 */
export async function runGenerative(
  _req: PipelineRequest,
  _adapter: AgentAdapter,
  _bridge: BridgeLike,
  _ctx: DispatchCtx,
): Promise<DispatchOutcome> {
  throw new Error('generative dispatch not implemented (Task 4)');
}

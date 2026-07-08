/**
 * Deterministic dispatch — the worker's CLI-backed request handlers.
 *
 * Each deterministic kind shells the `uxfactory` CLI in `ctx.projectRoot` and
 * relays the CLI's exit code as the result `status` (0 ok / 1 gate-fail / 2 setup).
 * The engine stays self-contained: dispatch knows the CLI's *command surface*, not
 * its internals — it never imports `@uxfactory/cli`.
 *
 * Generative kinds (`generate-artifact` / `canvas-review` / `generate-design`) are
 * NOT handled here — they run a SKILL through the autonomous `AgentAdapter`. Routing
 * is by absence: `isDeterministic(kind)` is false for them, so the loop hands them to
 * `runGenerative`. It lives in `./generative.ts` and is re-exported from this module
 * so the loop keeps a single dispatch import surface; importing it pulls in no runtime
 * `@helmsmith/*` code.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureBatchRegistry } from './batch-registry.js';
import { runCli } from './run-cli.js';
import type { CliResult } from './run-cli.js';

/** Execution context shared by every handler. */
export interface DispatchCtx {
  /** The git working tree where the CLI runs + artifacts are written. */
  projectRoot: string;
  /** Resolved `uxfactory` binary to spawn (see resolveCliBin). */
  cliBin: string;
  /**
   * The bridge data directory that the Figma plugin polls for queued render jobs.
   * Used by the generate-design landing step to pass `--data-dir` to `publish`.
   * Defaults to `<cwd>/.uxfactory` when absent (worker and bridge are co-located
   * in current deployments — both read/write the same filesystem path).
   */
  bridgeDataDir?: string;
  /** Debug mode: retain per-job scratch files instead of cleaning them up. */
  debug?: boolean;
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
 * Thrown when an untrusted path-like positional fails validation. The loop
 * (`handleRequest`) maps any thrown handler error to a status-2 result, so a
 * smuggled flag or an escape attempt degrades to a clean setup error — the CLI
 * is never spawned with the hostile value.
 */
export class UnsafePositionalError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'UnsafePositionalError';
  }
}

/**
 * Validate an untrusted path-like positional (`dir`/`design`/`spec`/`out`)
 * BEFORE it reaches the CLI. The panel-supplied payload is untrusted input, so:
 *   1. reject `undefined`/empty — a path positional is required;
 *   2. reject a leading `-` — defeats argv flag smuggling (`dir:'--malicious'`),
 *      a real risk because these flow to `runCli` as positionals;
 *   3. resolve against `projectRoot` and assert the result stays INSIDE it —
 *      defeats path traversal (`design:'../../etc/passwd'`).
 * A `--` end-of-options sentinel (added at each call site) is belt-and-suspenders
 * for (2); this guard is the authoritative gate and also covers (1) and (3).
 */
function assertSafePositional(
  value: string | undefined,
  projectRoot: string,
  field: string,
): string {
  if (value === undefined || value.trim() === '') {
    throw new UnsafePositionalError(field, `dispatch: '${field}' is required (got empty)`);
  }
  if (/^-/.test(value)) {
    throw new UnsafePositionalError(
      field,
      `dispatch: '${field}' must not start with '-' (argv flag smuggling): ${value}`,
    );
  }
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new UnsafePositionalError(
      field,
      `dispatch: '${field}' resolves outside the project root: ${value}`,
    );
  }
  return value;
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
    // Validate the untrusted `dir` up-front — before any CLI spawn.
    const dir = assertSafePositional(str(p, 'dir') ?? 'design', ctx.projectRoot, 'dir');
    await writeClassification(p, ctx);
    // Provision uxfactory.batch.json so `batch` can read its inputs registry — a
    // panel-driven project never hand-authors it (else: transport "cannot read …").
    await ensureBatchRegistry(ctx.projectRoot);
    const confirm = await runCli(ctx.cliBin, ['classify', '--confirm'], ctx.projectRoot);
    if (confirm.status !== 0) return outcomeOf(confirm);
    // `--` ends options: `dir` can never be reinterpreted as a flag.
    return outcomeOf(
      await runCli(ctx.cliBin, ['batch', '--json', ...scopeArgs(p), '--', dir], ctx.projectRoot),
    );
  },

  // One deterministic offline batch pass over a spec directory.
  batch: async (payload, ctx) => {
    const p = asObject(payload);
    const dir = assertSafePositional(str(p, 'dir') ?? 'design', ctx.projectRoot, 'dir');
    await ensureBatchRegistry(ctx.projectRoot);
    return outcomeOf(
      await runCli(ctx.cliBin, ['batch', '--json', ...scopeArgs(p), '--', dir], ctx.projectRoot),
    );
  },

  // Deterministically scaffold *.uxfactory.json specs from the registered stories.
  // No registry provisioning needed — generate-specs reads the stories file itself.
  'generate-specs': async (payload, ctx) => {
    const p = asObject(payload);
    const dir = assertSafePositional(str(p, 'dir') ?? 'design', ctx.projectRoot, 'dir');
    return outcomeOf(
      await runCli(ctx.cliBin, ['generate-specs', '--json', '--', dir], ctx.projectRoot),
    );
  },

  // Conformance review of a design (file or directory of specs).
  review: async (payload, ctx) => {
    const p = asObject(payload);
    const design = assertSafePositional(str(p, 'design') ?? '.', ctx.projectRoot, 'design');
    return outcomeOf(
      await runCli(
        ctx.cliBin,
        ['review', '--json', ...scopeArgs(p), '--', design],
        ctx.projectRoot,
      ),
    );
  },

  // Approximate offline raster of one spec to `out`.
  render: async (payload, ctx) => {
    const p = asObject(payload);
    const spec = assertSafePositional(str(p, 'spec'), ctx.projectRoot, 'spec');
    // `out` is bound via its explicit `--out` option; still guard its value so it
    // can neither smuggle a flag nor escape the project root.
    const out = str(p, 'out');
    if (out !== undefined) assertSafePositional(out, ctx.projectRoot, 'out');
    const args = ['render', ...(out !== undefined ? ['--out', out] : []), '--', spec];
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
 * Generative dispatch — runs a SKILL through the autonomous adapter
 * (`generate-artifact` / `canvas-review` / `generate-design`). Implemented in
 * `./generative.ts` and re-exported here so `main.ts` keeps a single dispatch
 * import surface.
 *
 * Re-exporting a *type-only* dependency keeps `generative.ts` (and thus this
 * module) free of any runtime `@helmsmith/*` import — importing the loop never
 * pulls in the LLM stack; the concrete adapter is built lazily in `main()`.
 */
export { runGenerative } from './generative.js';

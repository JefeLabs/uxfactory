/**
 * batch-registry.ts — provision `uxfactory.batch.json` so the deterministic gate
 * can run.
 *
 * The CLI's `batch` (and therefore the worker's `gate` kind) reads an inputs
 * registry at `<projectRoot>/uxfactory.batch.json`; without it the gate fails at
 * the transport layer ("cannot read uxfactory.batch.json"). A panel-driven
 * project never hand-authors that file, so the worker provisions it here,
 * registering the conventional artifact paths that the generation step writes
 * (these MUST match generative.ts TARGET_MAP).
 *
 * The provisioning is best-effort, idempotent, and NON-CLOBBERING: an existing
 * (possibly user-authored) registry is preserved — only missing input
 * registrations for files that actually exist are filled in.
 *
 * EXCEPTION — the HTML design tier. The `generate-design` generative path must
 * register `inputs.screens` + `inputs.trace` BEFORE the agent authors them (the
 * files don't exist at provisioning time), or `uxfactory batch` never selects
 * HTML mode. That path passes `{ unconditional: ['screens','trace'] }` to force
 * those two keys past the existence gate; every other key/kind stays gated.
 */

import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A conventional input registry key. */
export type BatchInputKey = 'stories' | 'flow' | 'tokens' | 'screens' | 'trace';

/** Options for {@link ensureBatchRegistry}. */
export interface EnsureBatchRegistryOptions {
  /**
   * Keys to register UNCONDITIONALLY, bypassing the existence gate — for inputs
   * the agent will author AFTER provisioning (so the file can't exist yet). Still
   * non-clobbering: an already-registered key is never overwritten. Used by the
   * `generate-design` path for `['screens','trace']` so HTML mode is selected.
   */
  unconditional?: ReadonlyArray<BatchInputKey>;
}

/** Conventional generation paths — keep in sync with generative.ts TARGET_MAP. */
const CONVENTIONAL_INPUTS: ReadonlyArray<{
  key: BatchInputKey;
  rel: string;
}> = [
  { key: 'stories', rel: 'design/acceptance-criteria.json' }, // AcceptanceCriterion (user-story + acceptance-criteria targets)
  { key: 'flow', rel: 'design/user-flow.json' }, // UserFlow (user-journey target)
  { key: 'tokens', rel: 'design/token-set.json' }, // TokenSet (not worker-generated; honored if user-provided)
  { key: 'screens', rel: 'design/screens' }, // HTML tier: directory of authored pages
  { key: 'trace', rel: 'design/trace.json' }, // HTML tier: coverage manifest
];

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Ensure `<projectRoot>/uxfactory.batch.json` exists and registers every
 * conventional input artifact that is present. Returns the registry's absolute
 * path. Never throws on a malformed existing file (starts fresh); never
 * overwrites an already-registered input.
 *
 * `options.unconditional` names keys to register even when their file does not
 * yet exist (see {@link EnsureBatchRegistryOptions}); all other keys stay
 * existence-gated.
 */
export async function ensureBatchRegistry(
  projectRoot: string,
  options: EnsureBatchRegistryOptions = {},
): Promise<string> {
  const file = path.join(projectRoot, 'uxfactory.batch.json');
  const unconditional = new Set<BatchInputKey>(options.unconditional ?? []);

  // Start from an existing valid registry (preserve scope/maxIterations/reuse/…),
  // or a fresh default when absent/unparseable.
  let registry: Record<string, unknown> = { version: 1, inputs: {} };
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (isObject(parsed) && isObject(parsed['inputs'])) {
      registry = parsed;
    }
  } catch {
    // absent or unparseable → keep the fresh default
  }
  registry['version'] = 1;
  if (!isObject(registry['inputs'])) registry['inputs'] = {};
  const inputs = registry['inputs'] as Record<string, unknown>;

  // Register each conventional input that isn't already registered, when either
  // it is forced unconditionally (files the agent authors later) or its file
  // already exists on disk. Never overwrites an existing registration.
  for (const { key, rel } of CONVENTIONAL_INPUTS) {
    if (inputs[key] !== undefined) continue;
    if (unconditional.has(key) || (await fileExists(path.join(projectRoot, rel)))) {
      inputs[key] = rel;
    }
  }

  await writeFile(file, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return file;
}

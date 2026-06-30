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
 */

import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Conventional generation paths — keep in sync with generative.ts TARGET_MAP. */
const CONVENTIONAL_INPUTS: ReadonlyArray<{ key: 'stories' | 'flow' | 'tokens'; rel: string }> = [
  { key: 'stories', rel: 'design/acceptance-criteria.json' }, // AcceptanceCriterion (user-story + acceptance-criteria targets)
  { key: 'flow', rel: 'design/user-flow.json' }, // UserFlow (user-journey target)
  { key: 'tokens', rel: 'design/token-set.json' }, // TokenSet (not worker-generated; honored if user-provided)
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
 */
export async function ensureBatchRegistry(projectRoot: string): Promise<string> {
  const file = path.join(projectRoot, 'uxfactory.batch.json');

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

  // Register each conventional input that exists and isn't already registered.
  for (const { key, rel } of CONVENTIONAL_INPUTS) {
    if (inputs[key] === undefined && (await fileExists(path.join(projectRoot, rel)))) {
      inputs[key] = rel;
    }
  }

  await writeFile(file, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return file;
}

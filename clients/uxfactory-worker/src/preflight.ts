/**
 * Preflight — fail fast with actionable setup errors BEFORE constructing the
 * adapter or touching the network.
 *
 * Asserts the three load-bearing preconditions:
 *   1. `projectRoot` is a git working tree (createAgent requires it).
 *   2. `authPath` exists at mode 0600 (the entire v1 auth boundary).
 *   3. `runtime` is an autonomous skill-runner.
 *
 * `preflight` THROWS `PreflightError` on any failure; the caller maps that to
 * process exit code 2 (setup/transport). Keeping the exit at the call site keeps
 * `preflight` a pure, testable function.
 */

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { listAdapterTypes } from '@helmsmith/agent-adapter';
import type { WorkerConfig } from './config.js';

/** A setup precondition failed — the caller should print + exit 2. */
export class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightError';
  }
}

export function preflight(cfg: WorkerConfig): void {
  // 1. projectRoot must be a git working tree.
  const git = spawnSync('git', ['-C', cfg.projectRoot, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (git.error || git.status !== 0 || git.stdout.trim() !== 'true') {
    throw new PreflightError(
      `projectRoot '${cfg.projectRoot}' is not inside a git working tree. ` +
        `The adapter's tools operate on a git repo — run 'git init' there, or start ` +
        `the worker from a repo (projectRoot defaults to cwd).`,
    );
  }

  // 2. authPath must exist at mode 0600.
  let mode: number;
  try {
    mode = statSync(cfg.authPath).mode & 0o777;
  } catch {
    throw new PreflightError(
      `auth file '${cfg.authPath}' not found. Create it as ` +
        `{ "version": 1, "providers": { "anthropic": { "apiKey": "sk-..." } } } at mode 0600, ` +
        `or set UXFACTORY_WORKER_AUTH to its path.`,
    );
  }
  if (mode !== 0o600) {
    throw new PreflightError(
      `auth file '${cfg.authPath}' has mode 0${mode.toString(8)}; required 0600. ` +
        `Run: chmod 600 ${cfg.authPath}`,
    );
  }

  // 3. runtime must be an autonomous skill-runner.
  const autonomous = listAdapterTypes({ toolUseMode: 'autonomous' });
  if (!autonomous.includes(cfg.runtime)) {
    throw new PreflightError(
      `runtime '${cfg.runtime}' is not an autonomous skill-runner. ` +
        `Set UXFACTORY_WORKER_RUNTIME to one of: ${autonomous.join(', ')}.`,
    );
  }
}

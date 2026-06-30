/**
 * runCli — spawn the `uxfactory` CLI for one deterministic request and normalize
 * its result for the bridge.
 *
 * The contract mirrors the CLI's exit-code convention (PRD §5.3):
 *   0 — success / gate PASS
 *   1 — gate FAIL (a real conformance signal)
 *   2 — setup/transport (bad spec, bridge unreachable, …)
 * A SPAWN failure (the bin could not be executed at all — ENOENT, EACCES) is a
 * setup error, so it also maps to `status: 2`. `runCli` NEVER rejects: a non-zero
 * exit is a value, not an exception — the loop turns it into a posted result.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Normalized CLI outcome. `json` is the parsed stdout (when stdout is JSON), else null. */
export interface CliResult {
  status: number;
  json: unknown | null;
  stderr: string;
}

/**
 * Parse a CLI's stdout as JSON. The `--json` commands emit exactly one JSON line,
 * but be forgiving: try the whole trimmed buffer first, then fall back to the last
 * non-empty line that parses (so a stray log line before the JSON doesn't break us).
 */
function parseJson(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // fall through to a line-by-line scan
  }
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() ?? '';
    if (line === '') continue;
    try {
      return JSON.parse(line) as unknown;
    } catch {
      // try the next line up
    }
  }
  return null;
}

/**
 * Run `bin args` in `cwd`, capturing stdout/stderr. Resolves with the child's exit
 * code as `status` (or 2 if the process could not be spawned). Never rejects.
 */
export function runCli(bin: string, args: string[], cwd: string): Promise<CliResult> {
  return new Promise<CliResult>((resolve) => {
    let settled = false;
    const finish = (r: CliResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // ENOENT / EACCES — the bin could not be executed at all → setup/transport (2).
    child.on('error', (err: Error) => {
      const note = `spawn ${bin} failed: ${err.message}`;
      finish({ status: 2, json: null, stderr: stderr === '' ? note : `${stderr}\n${note}` });
    });

    child.on('close', (code) => {
      // A signal-killed child reports code === null; treat that as a setup error.
      finish({ status: code ?? 2, json: parseJson(stdout), stderr });
    });
  });
}

/**
 * Resolve the `uxfactory` CLI binary to spawn.
 *
 * Precedence:
 *   1. an explicit `cliBin` (config / UXFACTORY_CLI_BIN) — absolute or relative,
 *   2. the project's locally-installed bin (`<projectRoot>/node_modules/.bin/uxfactory`),
 *   3. the bare name `uxfactory`, resolved against PATH by the OS at spawn time.
 *
 * The local-bin default keeps the worker pinned to the SAME `@uxfactory/cli` the
 * project depends on (rather than whatever happens to be first on PATH).
 */
export function resolveCliBin(cfg: { projectRoot: string; cliBin?: string }): string {
  if (cfg.cliBin !== undefined && cfg.cliBin.trim() !== '') return cfg.cliBin;
  const local = path.join(cfg.projectRoot, 'node_modules', '.bin', 'uxfactory');
  if (existsSync(local)) return local;
  return 'uxfactory';
}

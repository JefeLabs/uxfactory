/**
 * landing.ts — publish + bounded verify each per-view designspec after a
 * successful generate-design run.
 *
 * Co-location assumption: the worker and the bridge plugin run on the SAME
 * machine (or share a mounted volume), so `--data-dir <bridgeDataDir>` resolves
 * to the same queue directory the plugin reads from. This is the deployment
 * contract for v1; a remote split would need a pre-uploaded queue directory.
 *
 * Exit-code mapping for `uxfactory publish <file> --verify --json --data-dir <dir>`:
 *   0  → "pass"    — render + verify succeeded
 *   1  → "fail"    — gate found mismatches
 *   2  → "pending" — transport/timeout (plugin not open; job still queued)
 *   thrown         → "pending" — publish's fast-path enqueue precedes the wait,
 *                                so a spawn failure or kill-timeout means queued.
 *
 * The verdict is determined SOLELY by exit code — the stdout last-line is captured
 * into `detail` best-effort but is NOT parsed for the verdict.
 */

import { readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';

export interface LandingVerdict {
  view: string;
  file: string;
  published: boolean;
  verify: 'pass' | 'fail' | 'pending' | 'skipped';
  detail?: string;
}

export interface LandingResult {
  published: string[];
  verdicts: LandingVerdict[];
}

export interface LandingDeps {
  exec: (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string }>;
}

/**
 * Real exec deps for production use. Spawns the command via `node:child_process`
 * `execFile` with a hard kill-timeout. A kill (process exceeded `timeoutMs`) rejects
 * — the caller maps that to `pending` (fast-path enqueue already happened).
 */
export const realLandingDeps: LandingDeps = {
  exec: (cmd, args, timeoutMs) =>
    new Promise((resolve, reject) => {
      execFile(
        cmd,
        args,
        { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            if (err.killed) {
              // Process was killed because it exceeded `timeout`.
              reject(new Error(`exec killed after ${timeoutMs}ms`));
              return;
            }
            // Non-zero exit: err.code is the numeric exit code.
            const code = typeof err.code === 'number' ? err.code : 1;
            resolve({ code, stdout: String(stdout) });
            return;
          }
          resolve({ code: 0, stdout: String(stdout) });
        },
      );
    }),
};

/**
 * Glob `<projectRoot>/.uxfactory/batch/designspec/*.designspec.json`, excluding
 * `design.designspec.json` (the combined all-views file). For each per-view spec,
 * run `uxfactory publish <file> --verify --json --data-dir <bridgeDataDir>` and
 * map the exit code to a verdict.
 *
 * Returns `null` when the designspec output directory is absent or contains no
 * per-view specs (extraction was not run, or produced nothing). NEVER throws —
 * any per-file error (throw or non-zero exit) becomes a `pending` verdict so the
 * job result is not affected.
 */
export async function landDesign(
  projectRoot: string,
  bridgeDataDir: string,
  deps: LandingDeps,
): Promise<LandingResult | null> {
  const dir = path.join(projectRoot, '.uxfactory', 'batch', 'designspec');

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Directory absent (extraction not run) → nothing to land.
    return null;
  }

  const files = entries
    .filter((e) => e.endsWith('.designspec.json') && e !== 'design.designspec.json')
    .map((e) => path.join(dir, e));

  if (files.length === 0) return null;

  const published: string[] = [];
  const verdicts: LandingVerdict[] = [];

  for (const file of files) {
    const view = path.basename(file, '.designspec.json');
    let verdict: LandingVerdict;

    try {
      const { code, stdout } = await deps.exec(
        'uxfactory',
        ['publish', file, '--verify', '--json', '--data-dir', bridgeDataDir, '--timeout', '60000'],
        70_000,
      );

      const lastLine = stdout.trim().split('\n').pop()?.trim() ?? '';
      const detail = lastLine.length > 0 ? lastLine : undefined;

      let verify: LandingVerdict['verify'];
      if (code === 0) verify = 'pass';
      else if (code === 1) verify = 'fail';
      else verify = 'pending'; // exit 2 = transport/timeout

      published.push(file);
      verdict = {
        view,
        file,
        published: true,
        verify,
        ...(detail !== undefined ? { detail } : {}),
      };
    } catch {
      // Thrown = timeout kill or spawn failure.
      // Publish's fast-path enqueue precedes the wait, so the job is still queued.
      published.push(file);
      verdict = { view, file, published: true, verify: 'pending' };
    }

    verdicts.push(verdict);
  }

  return { published, verdicts };
}

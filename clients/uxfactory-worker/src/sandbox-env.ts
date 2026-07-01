/**
 * sandbox-env — self-provision the env the spawned autonomous agent inherits.
 *
 * The worker spawns claude-code-cli via `createAgent(...)` with NO explicit env
 * (see `adapter.ts`), so the agent inherits the worker's `process.env`. A live
 * paid run proved the design loop only reaches a green gate when two things are
 * true for the agent:
 *
 *   1. `uxfactory` is on PATH. SKILLs run the BARE command `uxfactory batch …`
 *      (the claude allow-rule is `Bash(uxfactory:*)`), but the CLI bin isn't
 *      symlinked into `node_modules/.bin`. We write a tiny shim that points at
 *      the resolved CLI bin and prepend its dir to PATH.
 *   2. `PLAYWRIGHT_BROWSERS_PATH` points at the REAL home's browser cache. claude
 *      sandboxes HOME→workdir, so the gate's Playwright otherwise can't find the
 *      cache (it lives under the real home). We set it (only when unset).
 *
 * This module MUTATES the passed `env` in place (default `process.env`). It is
 * idempotent and pure aside from the shim file write, which is injectable so
 * tests never hit disk.
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import path from 'node:path';

import { resolveCliBin } from './run-cli.js';
import type { WorkerConfig } from './config.js';

/**
 * Playwright's default browser-cache path by platform, computed from the REAL
 * home (before claude remaps HOME→workdir). `localAppData` is accepted for
 * win32; it falls back to `$LOCALAPPDATA`, then `<home>/AppData/Local`.
 */
export function defaultPlaywrightCache(
  home: string,
  platform: NodeJS.Platform,
  localAppData?: string,
): string {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'ms-playwright');
  }
  if (platform === 'win32') {
    const base = localAppData ?? process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    return path.join(base, 'ms-playwright');
  }
  // linux and everything else.
  return path.join(home, '.cache', 'ms-playwright');
}

/** Injectable side-effect seams for testing (default to real node:fs/os). */
export interface SandboxEnvDeps {
  homedir?: () => string;
  platform?: () => NodeJS.Platform;
  /** Write the shim file + chmod +x; returns nothing. Default writes to disk. */
  writeShim?: (shimPath: string, contents: string) => void;
  fileExists?: (p: string) => boolean;
}

export interface SandboxEnvResult {
  /** Dir prepended to PATH, or null if no shim was created (bare-cli case). */
  shimDir: string | null;
  /** The effective PLAYWRIGHT_BROWSERS_PATH after provisioning. */
  browsersPath: string;
}

/** Default shim writer: create the dir, write the launcher, mark it executable. */
function defaultWriteShim(shimPath: string, contents: string): void {
  mkdirSync(path.dirname(shimPath), { recursive: true });
  writeFileSync(shimPath, contents);
  chmodSync(shimPath, 0o755);
}

/** Build the POSIX shim body for a resolved CLI bin (node-launch `.js`, else exec). */
function shimContents(bin: string): string {
  return bin.endsWith('.js')
    ? `#!/bin/sh\nexec node "${bin}" "$@"\n`
    : `#!/bin/sh\nexec "${bin}" "$@"\n`;
}

/**
 * Provision the env the spawned autonomous agent inherits so it can run the gate.
 * MUTATES `env` in place (default `process.env`). Idempotent. Pure aside from the
 * shim file write (which is injectable). Returns what it did for logging.
 */
export function provisionAgentSandboxEnv(
  cfg: WorkerConfig,
  env: NodeJS.ProcessEnv = process.env,
  deps: SandboxEnvDeps = {},
): SandboxEnvResult {
  const homedir = deps.homedir ?? osHomedir;
  const platform = deps.platform ?? ((): NodeJS.Platform => process.platform);
  const writeShim = deps.writeShim ?? defaultWriteShim;
  const fileExists = deps.fileExists ?? existsSync;

  // --- 1. uxfactory shim on PATH ------------------------------------------
  const bin = cfg.cliBin ?? resolveCliBin(cfg);
  // Only shim a REAL path. If the bin resolved to the bare name (nothing to
  // point at), a shim named `uxfactory` execing `uxfactory` would recurse, so
  // we leave PATH untouched and let the OS resolve the bare command.
  const isRealPath = bin.includes('/') || fileExists(bin);

  let shimDir: string | null = null;
  if (isRealPath) {
    shimDir = path.join(cfg.projectRoot, '.uxfactory', 'bin');
    writeShim(path.join(shimDir, 'uxfactory'), shimContents(bin));

    // Prepend the shim dir to PATH, idempotently: if it's already present we do
    // not add it again (a second provision, or an inherited PATH, is a no-op).
    const current = env.PATH ?? '';
    const entries = current === '' ? [] : current.split(path.delimiter);
    if (!entries.includes(shimDir)) {
      env.PATH = current === '' ? shimDir : `${shimDir}${path.delimiter}${current}`;
    }
  }

  // --- 2. PLAYWRIGHT_BROWSERS_PATH ----------------------------------------
  // Respect an explicit override; otherwise point at the real home's cache.
  const existing = env.PLAYWRIGHT_BROWSERS_PATH;
  let browsersPath: string;
  if (existing !== undefined && existing !== '') {
    browsersPath = existing;
  } else {
    browsersPath = defaultPlaywrightCache(homedir(), platform());
    env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  }

  return { shimDir, browsersPath };
}

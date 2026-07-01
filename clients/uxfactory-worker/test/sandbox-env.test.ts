/**
 * sandbox-env — self-provision the env the spawned autonomous agent inherits.
 *
 * The worker spawns claude-code-cli with NO explicit env, so the agent inherits
 * the worker's process.env. Two things must be true for the agent to run the gate:
 *   1. `uxfactory` is on PATH (a tiny shim pointing at the resolved CLI bin), and
 *   2. `PLAYWRIGHT_BROWSERS_PATH` points at the REAL home's browser cache (claude
 *      remaps HOME→workdir, so Playwright otherwise can't find the browsers).
 *
 * These tests verify real behavior with an INJECTED fake `env` object + injected
 * deps (homedir/platform/writeShim/fileExists) — they never touch process.env or
 * the real filesystem.
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';

import { defaultPlaywrightCache, provisionAgentSandboxEnv } from '../src/sandbox-env.js';
import type { WorkerConfig } from '../src/config.js';

function baseCfg(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    bridgeUrl: 'http://127.0.0.1:3779',
    projectRoot: '/proj',
    authPath: '/proj/auth.json',
    runtime: 'claude-code-cli' as WorkerConfig['runtime'],
    model: 'sonnet',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// defaultPlaywrightCache
// ---------------------------------------------------------------------------

describe('defaultPlaywrightCache', () => {
  it('darwin → <home>/Library/Caches/ms-playwright', () => {
    expect(defaultPlaywrightCache('/home/me', 'darwin')).toBe(
      path.join('/home/me', 'Library', 'Caches', 'ms-playwright'),
    );
  });

  it('linux → <home>/.cache/ms-playwright', () => {
    expect(defaultPlaywrightCache('/home/me', 'linux')).toBe(
      path.join('/home/me', '.cache', 'ms-playwright'),
    );
  });

  it('win32 → ms-playwright under an AppData/Local-ish path', () => {
    const p = defaultPlaywrightCache('C:/Users/me', 'win32', 'C:/Users/me/AppData/Local');
    expect(p).toBe(path.join('C:/Users/me/AppData/Local', 'ms-playwright'));
    expect(p.endsWith('ms-playwright')).toBe(true);
    expect(p.toLowerCase()).toContain('local');
  });

  it('win32 falls back to <home>/AppData/Local/ms-playwright without an explicit localAppData', () => {
    const p = defaultPlaywrightCache('C:/Users/me', 'win32');
    expect(p.endsWith('ms-playwright')).toBe(true);
    expect(p.replace(/\\/g, '/').toLowerCase()).toContain('appdata/local');
  });
});

// ---------------------------------------------------------------------------
// provisionAgentSandboxEnv
// ---------------------------------------------------------------------------

describe('provisionAgentSandboxEnv', () => {
  it('writes a node shim for a .js cli bin and prepends its dir to PATH exactly once', () => {
    const writeShim = vi.fn();
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const cfg = baseCfg({ projectRoot: '/proj', cliBin: '/abs/dist/src/cli.js' });

    const res = provisionAgentSandboxEnv(cfg, env, {
      writeShim,
      homedir: () => '/home/me',
      platform: () => 'linux',
    });

    const shimDir = path.join('/proj', '.uxfactory', 'bin');
    expect(res.shimDir).toBe(shimDir);

    // PATH prepended exactly once, using the platform delimiter.
    expect(env.PATH).toBe(`${shimDir}${path.delimiter}/usr/bin`);
    expect(env.PATH!.split(path.delimiter).filter((e) => e === shimDir)).toHaveLength(1);

    // The shim is a node launcher for the resolved .js bin.
    expect(writeShim).toHaveBeenCalledTimes(1);
    const call = writeShim.mock.calls[0]!;
    const shimPath = call[0] as string;
    const contents = call[1] as string;
    expect(shimPath).toBe(path.join(shimDir, 'uxfactory'));
    expect(contents.startsWith('#!/bin/sh')).toBe(true);
    expect(contents).toContain('exec node "/abs/dist/src/cli.js" "$@"');
  });

  it('writes a direct shim (no node) for a non-.js cli bin', () => {
    const writeShim = vi.fn();
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const cfg = baseCfg({ cliBin: '/abs/bin/uxfactory' });

    provisionAgentSandboxEnv(cfg, env, {
      writeShim,
      homedir: () => '/home/me',
      platform: () => 'linux',
    });

    const contents = writeShim.mock.calls[0]![1] as string;
    expect(contents).toContain('exec "/abs/bin/uxfactory" "$@"');
    expect(contents).not.toContain('exec node');
  });

  it('is idempotent: calling twice does not double-prepend the shim dir to PATH', () => {
    const writeShim = vi.fn();
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const cfg = baseCfg({ projectRoot: '/proj', cliBin: '/abs/dist/src/cli.js' });
    const deps = { writeShim, homedir: () => '/home/me', platform: () => 'linux' as const };

    provisionAgentSandboxEnv(cfg, env, deps);
    const afterFirst = env.PATH;
    provisionAgentSandboxEnv(cfg, env, deps);

    expect(env.PATH).toBe(afterFirst);
    const shimDir = path.join('/proj', '.uxfactory', 'bin');
    expect(env.PATH!.split(path.delimiter).filter((e) => e === shimDir)).toHaveLength(1);
  });

  it('sets PLAYWRIGHT_BROWSERS_PATH from injected homedir/platform when unset', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const cfg = baseCfg({ cliBin: '/abs/dist/src/cli.js' });

    const res = provisionAgentSandboxEnv(cfg, env, {
      writeShim: vi.fn(),
      homedir: () => '/home/me',
      platform: () => 'darwin',
    });

    const expected = path.join('/home/me', 'Library', 'Caches', 'ms-playwright');
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe(expected);
    expect(res.browsersPath).toBe(expected);
  });

  it('does not overwrite an explicit PLAYWRIGHT_BROWSERS_PATH', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      PLAYWRIGHT_BROWSERS_PATH: '/custom/browsers',
    };
    const cfg = baseCfg({ cliBin: '/abs/dist/src/cli.js' });

    const res = provisionAgentSandboxEnv(cfg, env, {
      writeShim: vi.fn(),
      homedir: () => '/home/me',
      platform: () => 'darwin',
    });

    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('/custom/browsers');
    expect(res.browsersPath).toBe('/custom/browsers');
  });

  it('skips the shim when the cli resolves to the bare name (fileExists → false)', () => {
    const writeShim = vi.fn();
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    // cliBin unset + no <projectRoot>/node_modules/.bin/uxfactory anywhere.
    const cfg = baseCfg({ projectRoot: '/definitely/not/a/repo', cliBin: undefined });

    const res = provisionAgentSandboxEnv(cfg, env, {
      writeShim,
      fileExists: () => false,
      homedir: () => '/home/me',
      platform: () => 'linux',
    });

    expect(res.shimDir).toBeNull();
    expect(env.PATH).toBe('/usr/bin'); // PATH left untouched — a bare shim would recurse.
    expect(writeShim).not.toHaveBeenCalled();
    // it still provisions the browser cache even without a shim.
    expect(res.browsersPath).toBe(path.join('/home/me', '.cache', 'ms-playwright'));
  });
});

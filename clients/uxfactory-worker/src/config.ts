/**
 * WorkerConfig — static configuration for a uxfactory worker process.
 *
 * Resolved from the environment (plus the process cwd) at startup. The worker is
 * AgentCore-agnostic: it talks to the generic `@helmsmith/agent-adapter` and a
 * local bridge relay. Only the cloud project wraps it for AgentCore — nothing
 * here references AWS.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentSpecType } from '@helmsmith/agent-adapter';

export interface WorkerConfig {
  /** Base URL of the uxfactory bridge relay (consumed by the Task 3 loop). */
  bridgeUrl: string;
  /**
   * Project root — the git working tree where SKILLs run the `uxfactory` CLI and
   * write artifacts. `createAgent` REQUIRES this to be a git repo (the adapter's
   * tools operate there). Defaults to the process cwd.
   */
  projectRoot: string;
  /** Path to the agent-auth credentials file (mode 0600). */
  authPath: string;
  /**
   * Explicit `uxfactory` CLI binary for deterministic dispatch (Task 3). When
   * unset, `resolveCliBin` discovers `<projectRoot>/node_modules/.bin/uxfactory`,
   * falling back to the bare name on PATH.
   */
  cliBin?: string;
  /**
   * Autonomous adapter type used to run SKILLs. Must be a skill-runner — one of
   * `listAdapterTypes({ toolUseMode: 'autonomous' })`. Default `claude-code-cli`.
   */
  runtime: AgentSpecType;
  /** Model identifier passed verbatim to the adapter backend. */
  model: string;
  /** Concurrent drain lanes (typed pool). Default 1 (serial). */
  pool: number;
  /** Kinds this worker claims (typed pool routing). Undefined = all kinds. */
  kinds?: string[];
  /** Debug mode (UXFACTORY_WORKER_DEBUG): retain per-job scratch files. */
  debug: boolean;
}

/** Default bridge URL — the bridge listens on 127.0.0.1:3779 (UXFACTORY_PORT). */
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:3779';
/** Default runtime — the `claude` v2 binary is installed + verified headless. */
const DEFAULT_RUNTIME: AgentSpecType = 'claude-code-cli';
/** Default model — a `claude` CLI alias passed through as `--model`. */
const DEFAULT_MODEL = 'sonnet';

/** Parse UXFACTORY_WORKER_POOL → a positive integer lane count (default 1). */
function parsePool(v: string | undefined): number {
  const n = v !== undefined ? Number.parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Parse UXFACTORY_WORKER_KINDS ("generate-artifact,validate") → kinds or undefined. */
function parseKinds(v: string | undefined): string[] | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  const kinds = v.split(',').map((k) => k.trim()).filter((k) => k !== '');
  return kinds.length > 0 ? kinds : undefined;
}

/**
 * Build a WorkerConfig from the environment + cwd.
 *
 * `env`/`cwd` are injectable so the loader is testable without mutating
 * `process.env`. `runtime` is read as a raw string and cast to `AgentSpecType`;
 * `preflight`/`createWorkerAdapter` validate it is actually an autonomous type.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): WorkerConfig {
  return {
    bridgeUrl: env.UXFACTORY_BRIDGE ?? DEFAULT_BRIDGE_URL,
    projectRoot: cwd,
    authPath: env.UXFACTORY_WORKER_AUTH ?? join(homedir(), '.agentx', 'auth.json'),
    runtime: (env.UXFACTORY_WORKER_RUNTIME ?? DEFAULT_RUNTIME) as AgentSpecType,
    model: env.UXFACTORY_WORKER_MODEL ?? DEFAULT_MODEL,
    pool: parsePool(env.UXFACTORY_WORKER_POOL),
    debug: env.UXFACTORY_WORKER_DEBUG === '1' || env.UXFACTORY_WORKER_DEBUG === 'true',
    ...(parseKinds(env.UXFACTORY_WORKER_KINDS) !== undefined
      ? { kinds: parseKinds(env.UXFACTORY_WORKER_KINDS) }
      : {}),
    ...(env.UXFACTORY_CLI_BIN !== undefined ? { cliBin: env.UXFACTORY_CLI_BIN } : {}),
  };
}

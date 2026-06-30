/**
 * Composition root — the only place the worker constructs a CONCRETE adapter.
 *
 * Everything else in the worker depends on the `AgentAdapter` INTERFACE (so the
 * dispatch logic is testable with a fake). The real adapter is built here from
 * the rebuilt `@helmsmith/agent-adapter` + `@helmsmith/agent-auth` surface:
 *
 *   createAgent({ spec, workdir, credentialBroker }) -> AgentAdapter
 *
 * The runtime MUST be an autonomous skill-runner: a SKILL has to run `uxfactory`
 * + write files, which needs `toolUseMode: 'autonomous'` (not the host-loop chat
 * SDKs). Auth flows through `bridgeBroker(new FileBroker(authPath))` — FileBroker
 * reads `~/.agentx/auth.json` (mode 0600); bridgeBroker adapts its
 * `Provider`-typed broker to the lib's structural `{ getCredential(string) }`.
 */

import { createAgent, listAdapterTypes } from '@helmsmith/agent-adapter';
import type { AgentAdapter, AgentSpec } from '@helmsmith/agent-adapter';
import { FileBroker, bridgeBroker } from '@helmsmith/agent-auth';
import type { WorkerConfig } from './config.js';

// Re-export the adapter interface so the rest of the worker imports it from the
// composition root rather than reaching into helmsmith directly.
export type { AgentAdapter } from '@helmsmith/agent-adapter';

/**
 * Construct the worker's autonomous AgentAdapter.
 *
 * Throws if `cfg.runtime` is not an autonomous skill-runner. `createAgent`
 * itself throws `WorkdirNotARepoError` if `cfg.projectRoot` is not a git tree
 * (preflight checks this first with an actionable message + exit 2).
 */
export function createWorkerAdapter(cfg: WorkerConfig): AgentAdapter {
  const autonomous = listAdapterTypes({ toolUseMode: 'autonomous' });
  if (!autonomous.includes(cfg.runtime)) {
    throw new Error(
      `runtime '${cfg.runtime}' is not an autonomous skill-runner (need a SKILL ` +
        `that runs shell + writes files). Choose one of: ${autonomous.join(', ')}.`,
    );
  }

  // `cfg.runtime` is the wide `AgentSpecType` union; `AgentSpec` is discriminated
  // on the `type` literal, so a `{ type, model }` object is not assignable to it
  // without narrowing. The cast is sound: we've just validated `cfg.runtime` is
  // an autonomous type, and every autonomous spec accepts exactly `{ type, model }`
  // (all other fields are optional). See the report for this plan deviation.
  const spec = { type: cfg.runtime, model: cfg.model } as AgentSpec;

  return createAgent({
    spec,
    workdir: cfg.projectRoot,
    credentialBroker: bridgeBroker(new FileBroker(cfg.authPath)),
  });
}

/**
 * main — the worker subscribe loop.
 *
 * On start (and on every SSE "new work" wake) the worker DRAINS: pull the next
 * request, dispatch it by kind, post the result, repeat until the bridge returns
 * 204. Deterministic kinds run the `uxfactory` CLI; generative kinds run a SKILL
 * through the autonomous adapter (Task 4). A thrown handler never kills the loop —
 * it posts status 2 and keeps draining.
 *
 * The loop primitives (`drain`/`handleRequest`/`runWorker`) take an injected
 * `BridgeLike` + a `generative` callback, so they are exercised in tests with a
 * fake bridge and a stub CLI — WITHOUT touching the real adapter or helmsmith. The
 * concrete adapter is constructed only in `main()` (the composition root), lazily
 * loaded so importing this module never pulls in the LLM stack.
 */

import { pathToFileURL } from 'node:url';
import { WorkerBridgeClient } from './bridge-client.js';
import type { BridgeLike, PipelineRequest } from './bridge-client.js';
import { DETERMINISTIC, isDeterministic, runGenerative } from './dispatch.js';
import type { DispatchCtx, DispatchOutcome } from './dispatch.js';
import { loadConfig } from './config.js';
import { resolveCliBin } from './run-cli.js';
import { provisionAgentSandboxEnv } from './sandbox-env.js';

/** Everything the loop needs: the bridge, the dispatch context, and the generative branch. */
export interface WorkerDeps {
  bridge: BridgeLike;
  ctx: DispatchCtx;
  /** Generative dispatch (Task 4). Bound to the adapter+bridge by the composition root. */
  generative: (req: PipelineRequest) => Promise<DispatchOutcome>;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Dispatch ONE request and post its result. Robust by construction: a handler that
 * throws becomes a status-2 result, and a failed `postResult` is logged (the panel
 * can re-request) — neither aborts the surrounding drain.
 */
export async function handleRequest(req: PipelineRequest, deps: WorkerDeps): Promise<void> {
  let outcome: DispatchOutcome;
  try {
    if (isDeterministic(req.kind)) {
      const handler = DETERMINISTIC[req.kind];
      outcome =
        handler !== undefined
          ? await handler(req.payload, deps.ctx)
          : { status: 2, result: { error: `no deterministic handler for '${req.kind}'` } };
    } else {
      outcome = await deps.generative(req);
    }
  } catch (err) {
    outcome = { status: 2, result: { error: errMessage(err) } };
  }

  try {
    await deps.bridge.postResult(req.id, outcome.status, outcome.result);
  } catch (err) {
    console.error(`[worker] postResult failed for ${req.id}: ${errMessage(err)}`);
  }
}

/** Pull-and-dispatch until the bridge has no more work (pullRequest → null / 204). */
export async function drain(deps: WorkerDeps): Promise<void> {
  let req: PipelineRequest | null;
  while ((req = await deps.bridge.pullRequest()) !== null) {
    await handleRequest(req, deps);
  }
}

/**
 * Start the worker: drain once on start, then drain again on every SSE wake.
 * Drains are serialized — a wake that arrives mid-drain sets a pending flag so
 * exactly one more pass runs after the current one (no overlapping pulls, no
 * missed work). Returns a stop function (unsubscribe).
 */
export function runWorker(deps: WorkerDeps): () => void {
  return runPool(deps, 1);
}

/**
 * Run a POOL of `concurrency` independent drain lanes sharing one bridge. Each
 * lane serializes its own jobs (one at a time), but the lanes run concurrently,
 * so up to `concurrency` jobs are in flight at once. Atomic bridge claims hand
 * each lane a DISTINCT job. Safe for artifact producers (each writes only its
 * own scratch; the bridge is the single canonical writer). One shared wake
 * subscription ticks every lane. Returns an unsubscribe/stop function.
 */
export function runPool(deps: WorkerDeps, concurrency: number): () => void {
  const lanes = Array.from({ length: Math.max(1, concurrency) }, () => makeLane(deps));
  const tickAll = (): void => {
    for (const lane of lanes) lane();
  };
  const unsubscribe = deps.bridge.subscribeEvents(tickAll);
  tickAll(); // initial drain on start (don't wait for the first wake)
  return unsubscribe;
}

/** One drain lane: a busy/pending guard around drain, so the lane processes one
 * job at a time and re-drains if woken mid-flight. Returns its tick fn. */
function makeLane(deps: WorkerDeps): () => void {
  let busy = false;
  let pending = false;
  return (): void => {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    void (async () => {
      try {
        do {
          pending = false;
          await drain(deps);
        } while (pending);
      } catch (err) {
        console.error(`[worker] drain error: ${errMessage(err)}`);
      } finally {
        busy = false;
      }
    })();
  };
}

/**
 * Composition root — wires the real config, preflight, adapter, and bridge, then
 * runs the loop forever. `preflight`/`adapter` are imported lazily so this module
 * stays free of the helmsmith/LLM stack when only the loop primitives are imported.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();

  const { preflight, PreflightError } = await import('./preflight.js');
  try {
    preflight(cfg);
  } catch (err) {
    if (err instanceof PreflightError) {
      console.error(`[worker] preflight failed: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  // Self-provision the env the spawned agent inherits (uxfactory on PATH +
  // PLAYWRIGHT_BROWSERS_PATH) so a SKILL can always run the gate without any
  // manual env shimming. MUTATES process.env in place; idempotent. A filesystem
  // failure here (e.g. EACCES writing the shim) is a setup error — fail closed
  // like preflight (exit 2), not an unhandled rejection.
  try {
    const sandbox = provisionAgentSandboxEnv(cfg);
    console.error(
      `[worker] agent sandbox env: uxfactory shim=${sandbox.shimDir ?? 'n/a'} ` +
        `PLAYWRIGHT_BROWSERS_PATH=${sandbox.browsersPath}`,
    );
  } catch (err) {
    console.error(
      `[worker] agent sandbox env provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }

  const { createWorkerAdapter } = await import('./adapter.js');
  const bridge = new WorkerBridgeClient(cfg.bridgeUrl, cfg.projectRoot, cfg.kinds);
  const cliBin = resolveCliBin(cfg);
  const ctx: DispatchCtx = { projectRoot: cfg.projectRoot, cliBin };

  // Construct the (expensive) autonomous adapter lazily — only when the first
  // generative request actually needs it.
  let adapter: ReturnType<typeof createWorkerAdapter> | null = null;
  const generative = (req: PipelineRequest): Promise<DispatchOutcome> => {
    if (adapter === null) adapter = createWorkerAdapter(cfg);
    return runGenerative(req, adapter, bridge, ctx);
  };

  console.error(
    `[worker] up: bridge=${cfg.bridgeUrl} projectRoot=${cfg.projectRoot} cli=${cliBin}` +
      ` pool=${cfg.pool}${cfg.kinds !== undefined ? ` kinds=${cfg.kinds.join(',')}` : ''}`,
  );
  runPool({ bridge, ctx, generative }, cfg.pool);

  // Keep the process alive (the SSE subscription + its reconnect timer are unref'd).
  await new Promise<never>(() => {});
}

// Only auto-run when invoked directly (`tsx src/main.ts`), not when imported in tests.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

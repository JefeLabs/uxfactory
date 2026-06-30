/**
 * Manual spike — proves the autonomous path end-to-end against REAL creds.
 *
 * Run with `pnpm --filter uxfactory-worker spike` ONLY when the `claude` binary
 * is on PATH and `~/.agentx/auth.json` exists at mode 0600 with an anthropic key.
 * It constructs the real adapter via the composition root and asks it to run a
 * shell + write a file, then asserts `SPIKE_OK.txt` was created.
 *
 * Exit codes: 0 success; 1 the assertion failed (adapter ran but no file);
 * 2 setup/transport (preflight or adapter error).
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkerAdapter } from './adapter.js';
import { loadConfig } from './config.js';
import { preflight, PreflightError } from './preflight.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  console.log(`[spike] runtime=${cfg.runtime} model=${cfg.model}`);
  console.log(`[spike] projectRoot=${cfg.projectRoot}`);
  console.log(`[spike] authPath=${cfg.authPath}`);

  try {
    preflight(cfg);
  } catch (err) {
    if (err instanceof PreflightError) {
      console.error(`[spike] preflight failed: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const adapter = createWorkerAdapter(cfg);
  console.log(`[spike] adapter ready: type=${adapter.type} workdir=${adapter.workdir}`);

  const marker = join(cfg.projectRoot, 'SPIKE_OK.txt');
  // Remove any stale marker so the assertion is meaningful.
  if (existsSync(marker)) rmSync(marker);

  const result = await adapter.invoke({
    messages: [
      { role: 'user', content: 'Create ./SPIKE_OK.txt containing the word OK, then say done.' },
    ],
    systemPrompt: 'You can run shell + write files.',
  });

  console.log('[spike] --- adapter result ---');
  console.log(
    `[spike] finishReason=${result.finishReason ?? 'n/a'} durationMs=${result.durationMs}`,
  );
  console.log(`[spike] content: ${result.content}`);

  if (!existsSync(marker)) {
    console.error(`[spike] FAIL: ${marker} was not created.`);
    process.exit(1);
  }
  console.log(`[spike] OK: ${marker} exists.`);
}

main().catch((err: unknown) => {
  // AdapterError hierarchy (auth/billing/binary/etc.) + any transport failure
  // map to setup/transport (status 2).
  console.error('[spike] ERROR:', err);
  process.exit(2);
});

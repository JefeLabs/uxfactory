import { EXIT, TransportError } from "../exit.js";
import { loadSpec, printSpecProblem } from "../spec-file.js";
import type { IO } from "../io.js";
import type { BridgeClient } from "../client.js";

/** The subset of the bridge's /verify body the CLI reads (PRD §10.1). */
export interface VerifyResult {
  status?: "PASS" | "FAIL";
  verifyId?: string;
  renderId?: string;
  summary?: { checks: number; passed: number; failed: number; skipped: number };
  failures?: Array<{
    check?: string;
    nodeId?: string;
    name?: string;
    property?: string;
    expected?: unknown;
    actual?: unknown;
    tolerancePx?: number;
  }>;
  error?: string;
}

/**
 * Map the bridge's HTTP status + parsed body to an exit code and print the result.
 * 200 PASS → 0, 200 FAIL → 1, any non-200 → 2 (transport). Shared by `verify` and
 * `publish --verify`.
 */
export function reportVerify(io: IO, status: number, body: unknown, json?: boolean): number {
  const result = body as VerifyResult;

  if (status !== 200) {
    if (json) {
      io.out(JSON.stringify(result));
    } else {
      io.err(`verify error: ${result.error ?? `bridge returned HTTP ${status}`}`);
    }
    return EXIT.TRANSPORT;
  }

  if (json) {
    io.out(JSON.stringify(result));
  } else if (result.status === "PASS") {
    const s = result.summary;
    io.out(`PASS  ${s ? `${s.passed}/${s.checks} checks passed` : ""}`.trimEnd());
  } else {
    const s = result.summary;
    io.out(`FAIL  ${s ? `${s.failed} of ${s.checks} checks failed` : ""}`.trimEnd());
    for (const f of result.failures ?? []) {
      const target = f.name ?? f.nodeId ?? "?";
      const prop = f.property !== undefined ? `.${f.property}` : "";
      io.out(
        `  ${f.check ?? "?"} ${target}${prop}: ` +
          `expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`,
      );
    }
  }

  return result.status === "PASS" ? EXIT.OK : EXIT.GATE_FAIL;
}

/** `uxfactory verify <spec>` — gate the latest (or a specific) render over POST /verify. */
export async function verifyCmd(
  file: string,
  flags: { tolerance?: string; render?: string; json?: boolean },
  io: IO,
  client: BridgeClient,
): Promise<number> {
  const loaded = await loadSpec(file);
  if (!loaded.ok) return printSpecProblem(io, loaded, flags.json);

  try {
    const { status, body } = await client.verify({
      spec: loaded.spec,
      renderId: flags.render,
      tolerance:
        flags.tolerance !== undefined ? { geometryPx: Number(flags.tolerance) } : undefined,
    });
    return reportVerify(io, status, body, flags.json);
  } catch (err) {
    if (err instanceof TransportError) {
      io.err(err.message);
      return EXIT.TRANSPORT;
    }
    throw err;
  }
}

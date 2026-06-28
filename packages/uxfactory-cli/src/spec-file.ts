import { readFile } from "node:fs/promises";
import { validate } from "@uxfactory/spec";
import type { ValidationError } from "@uxfactory/spec";
import { EXIT } from "./exit.js";
import type { IO } from "./io.js";

/** Outcome of reading + parsing + schema-validating a spec file. */
export type LoadResult =
  | { ok: true; spec: unknown }
  | { ok: false; kind: "parse" | "invalid"; message: string; errors: ValidationError[] };

/** Read, JSON-parse, and schema-validate a spec file. Never throws on bad input. */
export async function loadSpec(file: string): Promise<LoadResult> {
  let spec: unknown;
  try {
    spec = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "parse", message, errors: [] };
  }
  const result = validate(spec);
  if (!result.valid) {
    return { ok: false, kind: "invalid", message: "invalid spec", errors: result.errors };
  }
  return { ok: true, spec };
}

/**
 * Print a load failure in the right shape (machine-readable when `json`), then
 * return EXIT.TRANSPORT so callers can `return printSpecProblem(...)`.
 */
export function printSpecProblem(
  io: IO,
  loaded: Extract<LoadResult, { ok: false }>,
  json?: boolean,
): number {
  if (json) {
    io.out(JSON.stringify({ valid: false, errors: loaded.errors }));
  } else if (loaded.kind === "parse") {
    io.err(loaded.message);
  } else {
    for (const e of loaded.errors) {
      io.err(`${e.path}: ${e.message}`);
    }
  }
  return EXIT.TRANSPORT;
}

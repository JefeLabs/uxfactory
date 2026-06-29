import { readFile } from "node:fs/promises";
import path from "node:path";

/** The `inputs` block of `uxfactory.batch.json` — each entry is a path (relative to the manifest). */
export interface BatchInputs {
  /** Design-system token register (colors → hex). */
  tokens?: string;
  /** User stories + acceptance criteria. */
  stories?: string;
  /** A declared user-flow step sequence. */
  flow?: string;
  /** Existing spec files to compose/reuse against. */
  reuse?: string[];
}

/** The committed `uxfactory.batch.json` manifest (§13.1). */
export interface BatchRegistry {
  version: 1;
  inputs: BatchInputs;
  /** Loop budget honored by the batch SKILL.md — the engine itself never loops. */
  maxIterations?: number;
}

/** Registry input paths resolved to absolute filesystem paths (null = not registered). */
export interface ResolvedInputs {
  tokens: string | null;
  stories: string | null;
  flow: string | null;
  reuse: string[];
}

/** Outcome of reading a registry: resolved inputs on success, a setup message on failure. */
export type ReadRegistryResult =
  { ok: true; registry: BatchRegistry; inputs: ResolvedInputs } | { ok: false; message: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure structural validation of a parsed registry. Never throws. */
export function validateRegistry(
  raw: unknown,
): { ok: true; registry: BatchRegistry } | { ok: false; message: string } {
  if (!isPlainObject(raw)) return { ok: false, message: "registry must be a JSON object" };
  if (raw["version"] !== 1) return { ok: false, message: "registry version must be 1" };
  if (!isPlainObject(raw["inputs"]))
    return { ok: false, message: "registry.inputs must be an object" };

  const inputs = raw["inputs"];
  for (const key of ["tokens", "stories", "flow"] as const) {
    const v = inputs[key];
    if (v !== undefined && typeof v !== "string") {
      return { ok: false, message: `registry.inputs.${key} must be a string path` };
    }
  }
  if (inputs["reuse"] !== undefined) {
    if (!Array.isArray(inputs["reuse"]) || inputs["reuse"].some((e) => typeof e !== "string")) {
      return { ok: false, message: "registry.inputs.reuse must be an array of string paths" };
    }
  }
  if (raw["maxIterations"] !== undefined) {
    const n = raw["maxIterations"];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
      return { ok: false, message: "registry.maxIterations must be a positive integer" };
    }
  }
  return { ok: true, registry: raw as unknown as BatchRegistry };
}

/** Resolve each registered input path relative to the manifest's directory. */
export function resolveInputs(registry: BatchRegistry, registryDir: string): ResolvedInputs {
  const abs = (p: string): string => path.resolve(registryDir, p);
  const { tokens, stories, flow, reuse } = registry.inputs;
  return {
    tokens: tokens !== undefined ? abs(tokens) : null,
    stories: stories !== undefined ? abs(stories) : null,
    flow: flow !== undefined ? abs(flow) : null,
    reuse: reuse !== undefined ? reuse.map(abs) : [],
  };
}

/** Read + JSON-parse + validate + resolve a registry file. Never throws on bad input. */
export async function readRegistry(registryPath: string): Promise<ReadRegistryResult> {
  let text: string;
  try {
    text = await readFile(registryPath, "utf8");
  } catch {
    return {
      ok: false,
      message: `cannot read ${registryPath} (run 'uxfactory batch' from the repo root)`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return { ok: false, message: `invalid JSON in ${registryPath}: ${(err as Error).message}` };
  }
  const result = validateRegistry(parsed);
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    registry: result.registry,
    inputs: resolveInputs(result.registry, path.dirname(registryPath)),
  };
}

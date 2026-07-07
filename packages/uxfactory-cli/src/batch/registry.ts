import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseScope } from "./scope.js";

/** The `inputs` block of `uxfactory.batch.json` — each entry is a path (relative to the manifest). */
export interface BatchInputs {
  /** Design-system token register (colors → hex). */
  tokens?: string;
  /** User stories + acceptance criteria. */
  stories?: string;
  /** A declared user-flow step sequence. */
  flow?: string;
  /** Feature groupings over stories — Coverage metric denominator (never gates). */
  features?: string;
  /** The copy deck — authored slot text; enables the copy-conformance must-gate. */
  copyDeck?: string;
  /** Existing spec files to compose/reuse against. */
  reuse?: string[];
  /** HTML tier: directory of authored HTML pages (presence selects HTML mode). */
  screens?: string;
  /** HTML tier: the trace.json coverage manifest (presence selects HTML mode). */
  trace?: string;
}

/**
 * Design-unit vocabulary (panel composer + worker generate-design). Page-tier
 * units keep full story coverage; component-tier units (organism/molecule/atom)
 * are gated claims-only; user-flow additionally owes the flow-steps check.
 */
export const UNIT_TYPES = [
  "user-flow",
  "home-page",
  "landing-page",
  "secondary-page",
  "tertiary-page",
  "page",
  "template",
  "organism",
  "molecule",
  "atom",
  "email",
  "instagram-post",
  "instagram-story",
  "youtube-thumbnail",
  "facebook-post",
  "x-post",
] as const;

export type UnitType = (typeof UNIT_TYPES)[number];

/** One concrete render viewport (stamped by the worker from the composer request). */
export interface RegistryViewport {
  name: string;
  width: number;
  height: number;
}

/** The committed `uxfactory.batch.json` manifest (§13.1). */
export interface BatchRegistry {
  version: 1;
  inputs: BatchInputs;
  /** Loop budget honored by the batch SKILL.md — the engine itself never loops. */
  maxIterations?: number;
  /**
   * Optional render scope committed in the registry: a preset name string (wireframe |
   * content | visual | interactive | production) or a partial vector object
   * { visual?, editorial?, coverage?, flow? } with each value low|medium|high.
   * CLI flags `--scope` / `--visual` / … override this at runtime.
   */
  scope?: string | Record<string, unknown>;
  /**
   * Optional design unit this batch targets (stamped by the worker from the
   * composer's unit droplist). Shapes the gate rubric: see {@link UNIT_TYPES}.
   */
  unit?: UnitType;
  /**
   * Optional render viewports (stamped by the worker from the composer's
   * viewport selection / channel canvas). The HTML batch renders every trace
   * view once per viewport; absent → the legacy single 390×844 render.
   */
  viewports?: RegistryViewport[];
  /**
   * Optional design-style slug (stamped by the worker from classification or
   * the per-request override). Enables the advisory style-conformance check.
   * Loose slug validation — the gate only has rules for a subset of styles.
   */
  designStyle?: string;
  /**
   * Escape-hatch provenance (stamped by the worker): the run was submitted
   * with required grounding artifacts missing. Reported, never gating.
   */
  ungoverned?: boolean;
  /**
   * Story-scoped generation contract (stamped by the worker from the
   * composer): the unit is accountable to EXACTLY these stories — the
   * coverage denominator scopes to them; an unknown ref is a must finding.
   */
  storyRefs?: string[];
}

/** Registry input paths resolved to absolute filesystem paths (null = not registered). */
export interface ResolvedInputs {
  tokens: string | null;
  stories: string | null;
  flow: string | null;
  features: string | null;
  copyDeck: string | null;
  reuse: string[];
  screens: string | null;
  trace: string | null;
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
  for (const key of ["tokens", "stories", "flow", "features", "copyDeck", "screens", "trace"] as const) {
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
  if (raw["scope"] !== undefined) {
    const s = raw["scope"];
    if (typeof s !== "string" && !isPlainObject(s)) {
      return {
        ok: false,
        message:
          "registry.scope must be a preset name string or a partial vector object {visual?,editorial?,coverage?,flow?}",
      };
    }
    const parsed = parseScope(s as string | Record<string, unknown>);
    if (!parsed.ok) {
      return { ok: false, message: `registry.scope: ${parsed.message}` };
    }
  }
  if (raw["unit"] !== undefined) {
    const u = raw["unit"];
    if (typeof u !== "string" || !(UNIT_TYPES as readonly string[]).includes(u)) {
      return {
        ok: false,
        message: `registry.unit must be one of: ${UNIT_TYPES.join(", ")}`,
      };
    }
  }
  if (raw["ungoverned"] !== undefined && raw["ungoverned"] !== true) {
    return { ok: false, message: "registry.ungoverned must be true when present" };
  }
  if (raw["storyRefs"] !== undefined) {
    const refs = raw["storyRefs"];
    if (!Array.isArray(refs) || refs.some((r) => typeof r !== "string" || r === "")) {
      return { ok: false, message: "registry.storyRefs must be an array of non-empty story ids" };
    }
  }
  if (raw["designStyle"] !== undefined) {
    const s = raw["designStyle"];
    if (typeof s !== "string" || !/^[a-z0-9-]+$/.test(s)) {
      return {
        ok: false,
        message: "registry.designStyle must be a lowercase slug (a-z, 0-9, hyphens)",
      };
    }
  }
  if (raw["viewports"] !== undefined) {
    const v = raw["viewports"];
    const isViewport = (e: unknown): boolean =>
      isPlainObject(e) &&
      typeof e["name"] === "string" &&
      typeof e["width"] === "number" &&
      Number.isInteger(e["width"]) &&
      (e["width"] as number) > 0 &&
      typeof e["height"] === "number" &&
      Number.isInteger(e["height"]) &&
      (e["height"] as number) > 0;
    if (!Array.isArray(v) || !v.every(isViewport)) {
      return {
        ok: false,
        message:
          "registry.viewports must be an array of {name, width, height} entries with positive integer sizes",
      };
    }
  }
  return { ok: true, registry: raw as unknown as BatchRegistry };
}

/** Resolve each registered input path relative to the manifest's directory. */
export function resolveInputs(registry: BatchRegistry, registryDir: string): ResolvedInputs {
  const abs = (p: string): string => path.resolve(registryDir, p);
  const { tokens, stories, flow, features, copyDeck, reuse, screens, trace } = registry.inputs;
  return {
    tokens: tokens !== undefined ? abs(tokens) : null,
    stories: stories !== undefined ? abs(stories) : null,
    flow: flow !== undefined ? abs(flow) : null,
    features: features !== undefined ? abs(features) : null,
    copyDeck: copyDeck !== undefined ? abs(copyDeck) : null,
    reuse: reuse !== undefined ? reuse.map(abs) : [],
    screens: screens !== undefined ? abs(screens) : null,
    trace: trace !== undefined ? abs(trace) : null,
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

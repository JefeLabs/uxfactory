/**
 * The fidelity VECTOR (§6.5) — fidelity is `{ coverage, editorial, visual, flow }`, each an
 * ordinal 0–2, NOT a single scalar level. Named presets expand to a default vector;
 * per-dimension overrides layer on top. Each gate binds INDEPENDENTLY on its own dimension:
 * a gate binds iff `vector[GATE_DIMENSION[id]] ≥ GATE_MIN_LEVEL[id]`. Pure + deterministic:
 * no I/O, no clock, no LLM.
 */

/** The four checkable dimensions (a11y/seo are future, declared-only). */
export type Dimension = "coverage" | "editorial" | "visual" | "flow";

/** A full fidelity vector — each dimension an ordinal 0–2. */
export interface Fidelity {
  coverage: number;
  editorial: number;
  visual: number;
  flow: number;
}

/** The named presets, each expanding to a default vector. */
export type PresetName = "wireframe" | "content" | "visual" | "interactive" | "production";

/** The dimensions in canonical order. */
export const DIMENSIONS: Dimension[] = ["coverage", "editorial", "visual", "flow"];

/** The preset names in ramp order. */
export const PRESET_NAMES: PresetName[] = [
  "wireframe",
  "content",
  "visual",
  "interactive",
  "production",
];

/** Each preset's default vector (the §6.5 table, verbatim). */
export const PRESETS: Record<PresetName, Fidelity> = {
  wireframe: { coverage: 1, editorial: 0, visual: 0, flow: 0 },
  content: { coverage: 1, editorial: 1, visual: 0, flow: 0 },
  visual: { coverage: 1, editorial: 1, visual: 1, flow: 0 },
  interactive: { coverage: 1, editorial: 1, visual: 1, flow: 1 },
  production: { coverage: 2, editorial: 2, visual: 2, flow: 2 },
};

/** A single dimension level is an integer 0–2. */
function isLevel(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 2;
}

/** Parse one dimension level ("0".."2" or 0..2) into 0–2, or null. */
export function parseLevel(s: string | number): number | null {
  const n = typeof s === "number" ? s : Number(String(s).trim());
  if (typeof s === "string" && s.trim() === "") return null;
  return isLevel(n) ? n : null;
}

/**
 * Parse a fidelity INPUT into a full vector, or null.
 * - a string is a PRESET NAME (case-insensitive) → that preset's vector;
 * - an object is a PARTIAL VECTOR → a full vector with missing dims = 0.
 * Unknown presets, unknown dimensions, and out-of-range / non-integer levels are rejected.
 */
export function parseFidelity(input: string | Record<string, unknown>): Fidelity | null {
  if (typeof input === "string") {
    const key = input.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PRESETS, key)) {
      return { ...PRESETS[key as PresetName] };
    }
    return null;
  }
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const out: Fidelity = { coverage: 0, editorial: 0, visual: 0, flow: 0 };
    for (const key of Object.keys(input)) {
      if (!(DIMENSIONS as string[]).includes(key)) return null; // unknown dimension → reject
      const v = input[key];
      if (!isLevel(v)) return null;
      out[key as Dimension] = v;
    }
    return out;
  }
  return null;
}

/** Apply per-dimension overrides on top of a base vector (returns a fresh vector). */
export function resolveFidelity(base: Fidelity, overrides: Partial<Fidelity>): Fidelity {
  const out: Fidelity = { ...base };
  for (const dim of DIMENSIONS) {
    const v = overrides[dim];
    if (v !== undefined) out[dim] = v;
  }
  return out;
}

/**
 * The dimension each EXISTING gate owes on. Keys are the actual gate ids from `checks.ts`.
 * `coverage-orphans` (advisory companion of `requirement-coverage`, also driven by `stories`)
 * owes on `coverage` so the coverage trio binds together.
 */
export const GATE_DIMENSION: Record<string, Dimension> = {
  "requirement-coverage": "coverage",
  reuse: "coverage",
  "coverage-orphans": "coverage",
  "token-conformance": "visual",
  "flow-reachability": "flow",
};

/** The minimum level on its dimension at which each gate becomes BINDING. */
export const GATE_MIN_LEVEL: Record<string, number> = {
  "requirement-coverage": 1,
  reuse: 1,
  "coverage-orphans": 1,
  "token-conformance": 1,
  "flow-reachability": 1,
};

/** The RUBRIC for a vector: every gate id that binds (`vector[dimension] ≥ minLevel`). */
export function bindingGateIds(v: Fidelity): string[] {
  return Object.keys(GATE_DIMENSION).filter((id) => {
    const dim = GATE_DIMENSION[id];
    const min = GATE_MIN_LEVEL[id];
    return dim !== undefined && min !== undefined && v[dim] >= min;
  });
}

/**
 * The MANDATORY registered inputs to REQUEST a batch at a vector: `stories` at coverage≥1,
 * `tokens` at visual≥1, `flow` at flow≥1. `reuse` is OPTIONAL (skip-and-declare) and never
 * appears here. `editorial` and future dims require no checkable input (declared only).
 */
export function requiredInputs(v: Fidelity): string[] {
  const out: string[] = [];
  if (v.coverage >= 1) out.push("stories");
  if (v.visual >= 1) out.push("tokens");
  if (v.flow >= 1) out.push("flow");
  return out;
}

/** A dimension that is required by the vector but has no checkable gate yet. */
export interface DeclaredFuture {
  dimension: string;
  level: number;
  reason: string;
}

/**
 * The DECLARED tiers for a vector — honest "required, not yet checked": `editorial` when
 * editorial≥1 (real copy is owed, no editorial gate yet), plus the future, not-yet-checkable
 * dimensions `a11y` and `seo`. Never blocking, never a silent pass.
 */
export function declaredFuture(v: Fidelity): DeclaredFuture[] {
  const out: DeclaredFuture[] = [];
  if (v.editorial >= 1) {
    out.push({
      dimension: "editorial",
      level: v.editorial,
      reason: "real copy required, no editorial gate yet",
    });
  }
  out.push({ dimension: "a11y", level: 0, reason: "future dimension, not yet checkable" });
  out.push({ dimension: "seo", level: 0, reason: "future dimension, not yet checkable" });
  return out;
}

/** A missing required input the agent must provide or generate before a batch can run. */
export interface ReadinessMissing {
  artifact: string;
  dimension: string;
  level: number;
  action: "provide-or-generate";
}

/** The readiness precondition result: ready + what's missing + what's declared-not-yet-checked. */
export interface ReadinessReport {
  ready: boolean;
  missing: ReadinessMissing[];
  declared: DeclaredFuture[];
}

/**
 * The PRECONDITION that gates whether a batch can be REQUESTED at a vector: are all REQUIRED
 * inputs (+ specs) present for the vector's dimensions? Missing any → not ready, each listed
 * with the dimension + level that requires it and the "provide-or-generate" action the
 * SKILL.md drives. The engine REPORTS what's missing; the skill generates it.
 */
export function checkReadiness(
  v: Fidelity,
  present: { stories: boolean; tokens: boolean; flow: boolean; specs: boolean },
): ReadinessReport {
  const missing: ReadinessMissing[] = [];
  if (!present.specs) {
    missing.push({
      artifact: "specs",
      dimension: "coverage",
      level: 0,
      action: "provide-or-generate",
    });
  }
  if (v.coverage >= 1 && !present.stories) {
    missing.push({
      artifact: "stories",
      dimension: "coverage",
      level: 1,
      action: "provide-or-generate",
    });
  }
  if (v.visual >= 1 && !present.tokens) {
    missing.push({
      artifact: "tokens",
      dimension: "visual",
      level: 1,
      action: "provide-or-generate",
    });
  }
  if (v.flow >= 1 && !present.flow) {
    missing.push({ artifact: "flow", dimension: "flow", level: 1, action: "provide-or-generate" });
  }
  return { ready: missing.length === 0, missing, declared: declaredFuture(v) };
}

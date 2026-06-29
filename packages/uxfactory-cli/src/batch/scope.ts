/**
 * Four-dial Render Scope (§6.5 design doc).
 *
 * A batch is scoped by a VECTOR of four dials {visual, editorial, coverage, flow}.
 * Each dial is low|medium|high.  Gates bind only when scope.<dial> >= min_<dial>
 * for ALL four dials.  Pure + deterministic: no I/O, no clock, no LLM.
 *
 * Replaces the superseded 0–2 scalar fidelity.ts model.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ordinal level.  `none` is a threshold-only value; scope dials are low|medium|high. */
export type Level = "none" | "low" | "medium" | "high";

/** The four scope dials. */
export type Dial = "visual" | "editorial" | "coverage" | "flow";

/** A fully-resolved render scope — every dial is low|medium|high. */
export type RenderScope = {
  visual: Level;
  editorial: Level;
  coverage: Level;
  flow: Level;
};

/** Per-gate threshold on all four dials (each Level; `none` means "not gated on this dial"). */
export type GateThresholds = {
  min_visual: Level;
  min_editorial: Level;
  min_coverage: Level;
  min_flow: Level;
};

// ---------------------------------------------------------------------------
// Level ordinal
// ---------------------------------------------------------------------------

/** Ordinal map: none(0) < low(1) < medium(2) < high(3). */
export const LEVEL_ORD: Record<Level, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

// ---------------------------------------------------------------------------
// Presets (§4 table, verbatim) — order: visual, editorial, coverage, flow
// ---------------------------------------------------------------------------

export type PresetName = "wireframe" | "content" | "visual" | "interactive" | "production";

export const PRESETS: Record<PresetName, RenderScope> = {
  wireframe: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
  content: { visual: "low", editorial: "high", coverage: "medium", flow: "low" },
  visual: { visual: "high", editorial: "medium", coverage: "medium", flow: "medium" },
  interactive: { visual: "high", editorial: "high", coverage: "high", flow: "high" },
  production: { visual: "high", editorial: "high", coverage: "high", flow: "high" },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const VALID_DIALS = new Set<string>(["visual", "editorial", "coverage", "flow"]);
const DIAL_LEVELS = new Set<string>(["low", "medium", "high"]);
const PRESET_NAMES = new Set<string>(Object.keys(PRESETS));

function isDialLevel(v: unknown): v is Level {
  return typeof v === "string" && DIAL_LEVELS.has(v);
}

function isPresetName(s: string): s is PresetName {
  return PRESET_NAMES.has(s);
}

/** Expand a plain object into a full RenderScope, with missing dials defaulting to "low". */
function vectorFromObject(
  input: Record<string, unknown>,
): { ok: true; scope: RenderScope } | { ok: false; message: string } {
  const scope: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };
  for (const key of Object.keys(input)) {
    if (!VALID_DIALS.has(key)) {
      return {
        ok: false,
        message: `Unknown dial key: "${key}". Valid dials: visual, editorial, coverage, flow.`,
      };
    }
    const v = input[key];
    if (!isDialLevel(v)) {
      return {
        ok: false,
        message: `Invalid value for dial "${key}": ${JSON.stringify(v)}. Must be one of low, medium, high (not none).`,
      };
    }
    scope[key as Dial] = v;
  }
  return { ok: true, scope };
}

// ---------------------------------------------------------------------------
// parseScope
// ---------------------------------------------------------------------------

/**
 * Parse a scope input — a preset name string, or a partial/full dial vector object.
 *
 * - String: must be a preset name; returns the preset's full vector.
 * - Object: each key must be a valid Dial; each value must be low|medium|high (not none);
 *   missing dials default to "low".
 * - Rejects unknown dial keys, non-low/medium/high values, and `none` as a dial value.
 */
export function parseScope(
  input: string | Record<string, unknown>,
): { ok: true; scope: RenderScope } | { ok: false; message: string } {
  if (typeof input === "string") {
    if (isPresetName(input)) {
      return { ok: true, scope: { ...PRESETS[input] } };
    }
    return {
      ok: false,
      message: `Unknown preset name: "${input}". Valid presets: ${[...PRESET_NAMES].join(", ")}.`,
    };
  }
  return vectorFromObject(input);
}

// ---------------------------------------------------------------------------
// resolveScope
// ---------------------------------------------------------------------------

/**
 * Resolve a final RenderScope from a base (preset name or partial vector) plus per-dial overrides.
 *
 * - base undefined → null (no scope set).
 * - base invalid → null.
 * - Otherwise: parse base, then apply overrides on each dial.
 */
export function resolveScope(
  base: string | object | undefined,
  overrides: Partial<Record<Dial, Level>>,
): RenderScope | null {
  if (base === undefined) return null;

  const input = typeof base === "string" ? base : (base as Record<string, unknown>);

  const parsed = parseScope(input as string | Record<string, unknown>);
  if (!parsed.ok) return null;

  const scope: RenderScope = { ...parsed.scope };
  for (const dial of ["visual", "editorial", "coverage", "flow"] as const) {
    const v = overrides[dial];
    if (v !== undefined) scope[dial] = v;
  }
  return scope;
}

// ---------------------------------------------------------------------------
// GATE_THRESHOLDS (§3 table — actual gate ids)
// ---------------------------------------------------------------------------

/** Per-gate binding thresholds.  A gate binds iff scope.<dial> >= min_<dial> on all four dials. */
export const GATE_THRESHOLDS: Record<string, GateThresholds> = {
  "requirement-coverage": {
    min_visual: "none",
    min_editorial: "none",
    min_coverage: "low",
    min_flow: "none",
  },
  reuse: {
    min_visual: "none",
    min_editorial: "none",
    min_coverage: "low",
    min_flow: "none",
  },
  "coverage-orphans": {
    min_visual: "none",
    min_editorial: "none",
    min_coverage: "low",
    min_flow: "none",
  },
  "token-conformance": {
    min_visual: "medium",
    min_editorial: "none",
    min_coverage: "none",
    min_flow: "none",
  },
  "flow-reachability": {
    min_visual: "none",
    min_editorial: "none",
    min_coverage: "none",
    min_flow: "medium",
  },
};

// ---------------------------------------------------------------------------
// binds / bindingGateIds
// ---------------------------------------------------------------------------

/**
 * Returns true iff scope meets ALL four thresholds for the given gate.
 * `none(0)` threshold is met by any scope level (low >= none, etc.).
 */
export function binds(t: GateThresholds, s: RenderScope): boolean {
  return (
    LEVEL_ORD[s.visual] >= LEVEL_ORD[t.min_visual] &&
    LEVEL_ORD[s.editorial] >= LEVEL_ORD[t.min_editorial] &&
    LEVEL_ORD[s.coverage] >= LEVEL_ORD[t.min_coverage] &&
    LEVEL_ORD[s.flow] >= LEVEL_ORD[t.min_flow]
  );
}

/** The rubric — every gate id that binds for the given scope. */
export function bindingGateIds(s: RenderScope): string[] {
  return Object.keys(GATE_THRESHOLDS).filter((id) => {
    const t = GATE_THRESHOLDS[id];
    return t !== undefined && binds(t, s);
  });
}

// ---------------------------------------------------------------------------
// requiredInputs
// ---------------------------------------------------------------------------

/**
 * The MANDATORY registered inputs for a scope: stories whenever coverage≥low (always for a
 * valid scope), tokens when visual≥medium, flow when flow≥medium.  `reuse` is optional —
 * never appears here.
 */
export function requiredInputs(s: RenderScope): string[] {
  const out: string[] = [];
  // requirement-coverage binds whenever coverage >= low (all valid scopes)
  if (LEVEL_ORD[s.coverage] >= LEVEL_ORD["low"]) out.push("stories");
  // token-conformance binds at visual >= medium
  if (LEVEL_ORD[s.visual] >= LEVEL_ORD["medium"]) out.push("tokens");
  // flow-reachability binds at flow >= medium
  if (LEVEL_ORD[s.flow] >= LEVEL_ORD["medium"]) out.push("flow");
  return out;
}

// ---------------------------------------------------------------------------
// declaredFuture
// ---------------------------------------------------------------------------

/** An informational future tier surfaced when the scope reaches that dial/level. */
export interface DeclaredFutureTier {
  artifact: string;
  dial: Dial;
  level: Level;
}

/**
 * Future tiers that are not yet implemented as gates.  Surfaced when the scope reaches the
 * corresponding dial/level.  Never blocking — informational only.
 *
 * Tiers: brand@visual:high, contrast@visual:high, motion@flow:high, keyboard@flow:medium,
 * content-voice@editorial:medium, i18n@editorial:high, a11y (always), discoverability@editorial:high.
 */
export function declaredFuture(s: RenderScope): DeclaredFutureTier[] {
  const out: DeclaredFutureTier[] = [];

  // visual:high tiers
  if (LEVEL_ORD[s.visual] >= LEVEL_ORD["high"]) {
    out.push({ artifact: "brand", dial: "visual", level: "high" });
    out.push({ artifact: "contrast", dial: "visual", level: "high" });
  }

  // flow tiers
  if (LEVEL_ORD[s.flow] >= LEVEL_ORD["medium"]) {
    out.push({ artifact: "keyboard", dial: "flow", level: "medium" });
  }
  if (LEVEL_ORD[s.flow] >= LEVEL_ORD["high"]) {
    out.push({ artifact: "motion", dial: "flow", level: "high" });
  }

  // editorial tiers
  if (LEVEL_ORD[s.editorial] >= LEVEL_ORD["medium"]) {
    out.push({ artifact: "content-voice", dial: "editorial", level: "medium" });
  }
  if (LEVEL_ORD[s.editorial] >= LEVEL_ORD["high"]) {
    out.push({ artifact: "i18n", dial: "editorial", level: "high" });
    out.push({ artifact: "discoverability", dial: "editorial", level: "high" });
  }

  // a11y — always declared (future tier, no specific threshold yet)
  out.push({ artifact: "a11y", dial: "coverage", level: "low" });

  return out;
}

// ---------------------------------------------------------------------------
// checkReadiness
// ---------------------------------------------------------------------------

/** A missing required input to report. */
export interface ReadinessMissing {
  artifact: string;
  dial: Dial;
  level: Level;
  action: "provide-or-generate";
}

/** Readiness precondition result. */
export interface ReadinessResult {
  ready: boolean;
  missing: ReadinessMissing[];
  declared: DeclaredFutureTier[];
}

/**
 * Readiness precondition: every REQUESTED input (stories/tokens/flow) of binding gates, plus
 * specs, must be present.  Missing → not ready; each absence listed with the dial+level that
 * requires it and the "provide-or-generate" action.  Declared-future tiers are listed
 * separately and are never blocking.
 */
export function checkReadiness(
  s: RenderScope,
  present: { stories: boolean; tokens: boolean; flow: boolean; specs: boolean },
): ReadinessResult {
  const missing: ReadinessMissing[] = [];

  // specs are always required (baseline for any batch)
  if (!present.specs) {
    missing.push({
      artifact: "specs",
      dial: "coverage",
      level: "low",
      action: "provide-or-generate",
    });
  }

  // stories required when coverage >= low (always in practice)
  if (LEVEL_ORD[s.coverage] >= LEVEL_ORD["low"] && !present.stories) {
    missing.push({
      artifact: "stories",
      dial: "coverage",
      level: "low",
      action: "provide-or-generate",
    });
  }

  // tokens required when visual >= medium
  if (LEVEL_ORD[s.visual] >= LEVEL_ORD["medium"] && !present.tokens) {
    missing.push({
      artifact: "tokens",
      dial: "visual",
      level: "medium",
      action: "provide-or-generate",
    });
  }

  // flow required when flow >= medium
  if (LEVEL_ORD[s.flow] >= LEVEL_ORD["medium"] && !present.flow) {
    missing.push({
      artifact: "flow",
      dial: "flow",
      level: "medium",
      action: "provide-or-generate",
    });
  }

  return { ready: missing.length === 0, missing, declared: declaredFuture(s) };
}

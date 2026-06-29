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

/** Scope dial levels — the three valid values for a RenderScope dial (never `none`; that is threshold-only). */
export type DialLevel = "low" | "medium" | "high";

/** Ordinal level.  `none` is a threshold-only value; scope dials are low|medium|high. */
export type Level = "none" | DialLevel;

/** The four scope dials. */
export type Dial = "visual" | "editorial" | "coverage" | "flow";

/** A fully-resolved render scope — every dial is low|medium|high (never none). */
export type RenderScope = {
  visual: DialLevel;
  editorial: DialLevel;
  coverage: DialLevel;
  flow: DialLevel;
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

function isDialLevel(v: unknown): v is DialLevel {
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
  overrides: Partial<Record<Dial, DialLevel>>,
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

/**
 * Per-gate required input specification.  Only gates with a required input appear here.
 * `optional:true` = skip-and-declare if absent, never block readiness (reuse).
 * `optional:false` = REQUESTED; must be present for readiness to pass.
 *
 * Single source of truth for both `requiredInputs()` and `checkReadiness()`.
 */
export const GATE_REQUIRED_INPUT: Record<string, { input: string; optional: boolean }> = {
  "requirement-coverage": { input: "stories", optional: false },
  "token-conformance": { input: "tokens", optional: false },
  "flow-reachability": { input: "flow", optional: false },
  reuse: { input: "reuse", optional: true },
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
// primaryBindingDial (internal)
// ---------------------------------------------------------------------------

/**
 * Extract the first non-none binding dial and its minimum level from a gate threshold.
 * Used by `checkReadiness` to derive the `{dial, level}` for a missing required input.
 */
function primaryBindingDial(t: GateThresholds): { dial: Dial; level: Level } | null {
  if (t.min_visual !== "none") return { dial: "visual", level: t.min_visual };
  if (t.min_editorial !== "none") return { dial: "editorial", level: t.min_editorial };
  if (t.min_coverage !== "none") return { dial: "coverage", level: t.min_coverage };
  if (t.min_flow !== "none") return { dial: "flow", level: t.min_flow };
  return null;
}

// ---------------------------------------------------------------------------
// requiredInputs
// ---------------------------------------------------------------------------

/**
 * The MANDATORY registered inputs for a scope — single-sourced from GATE_THRESHOLDS via
 * bindingGateIds() + GATE_REQUIRED_INPUT.  Only non-optional inputs are included; `reuse`
 * is optional and never appears here.
 *
 * Result: stories whenever coverage≥low (always for a valid scope), tokens when
 * visual≥medium, flow when flow≥medium.
 */
export function requiredInputs(s: RenderScope): string[] {
  return bindingGateIds(s)
    .filter((id) => {
      const gi = GATE_REQUIRED_INPUT[id];
      return gi !== undefined && !gi.optional;
    })
    .map((id) => GATE_REQUIRED_INPUT[id]!.input);
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
 * requires it (derived from GATE_THRESHOLDS via GATE_REQUIRED_INPUT — single-sourced) and the
 * "provide-or-generate" action.  Declared-future tiers are listed separately and never block.
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

  // Derive missing required inputs from GATE_REQUIRED_INPUT via bindingGateIds —
  // single-sourced from GATE_THRESHOLDS; dial+level come from the gate's threshold.
  const presentMap: Record<string, boolean> = {
    stories: present.stories,
    tokens: present.tokens,
    flow: present.flow,
  };

  for (const id of bindingGateIds(s)) {
    const gi = GATE_REQUIRED_INPUT[id];
    if (gi === undefined || gi.optional) continue;
    if (!presentMap[gi.input]) {
      const t = GATE_THRESHOLDS[id];
      const bd = t !== undefined ? primaryBindingDial(t) : null;
      missing.push({
        artifact: gi.input,
        dial: bd?.dial ?? "coverage",
        level: bd?.level ?? "low",
        action: "provide-or-generate",
      });
    }
  }

  return { ready: missing.length === 0, missing, declared: declaredFuture(s) };
}

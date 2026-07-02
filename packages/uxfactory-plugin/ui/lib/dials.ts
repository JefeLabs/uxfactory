/**
 * dials.ts — Bidirectional label↔engine-vocab maps for the six generation
 * default controls on the Project Setup 2 / Generation Defaults screen.
 *
 * PRD 02 §2 table (label → engine value written to uxfactory.profile.json or
 * uxfactory.classification.json):
 *
 * | Control          | Labels                        | Engine vocab              |
 * |------------------|-------------------------------|---------------------------|
 * | Style            | Informal / Mix / Formal       | informal / mix / formal   |
 * | Visual fidelity  | Low / Medium / High           | low / medium / high       |
 * | Editorial fidelity | Low / Medium / High         | low / medium / high       |
 * | Flows            | Shallow / Medium / Deep       | low / medium / high       |
 * | Coverage         | Thin / Medium / Exhaustive    | low / medium / high       |
 * | Coherence        | Low / Medium / High           | low / medium / high       |
 */

// ─── Style ───────────────────────────────────────────────────────────────────

export type StyleLabel = "Informal" | "Mix" | "Formal";
export type StyleEngine = "informal" | "mix" | "formal";

export const styleLabelToEngine: Record<StyleLabel, StyleEngine> = {
  Informal: "informal",
  Mix: "mix",
  Formal: "formal",
};

export const styleEngineToLabel: Record<StyleEngine, StyleLabel> = {
  informal: "Informal",
  mix: "Mix",
  formal: "Formal",
};

// ─── Visual fidelity ──────────────────────────────────────────────────────────

export type FidelityLabel = "Low" | "Medium" | "High";
export type FidelityEngine = "low" | "medium" | "high";

export const fidelityLabelToEngine: Record<FidelityLabel, FidelityEngine> = {
  Low: "low",
  Medium: "medium",
  High: "high",
};

export const fidelityEngineToLabel: Record<FidelityEngine, FidelityLabel> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

// ─── Flows (Shallow↔low, Medium↔medium, Deep↔high) ───────────────────────────

export type FlowsLabel = "Shallow" | "Medium" | "Deep";
export type FlowsEngine = "low" | "medium" | "high";

export const flowsLabelToEngine: Record<FlowsLabel, FlowsEngine> = {
  Shallow: "low",
  Medium: "medium",
  Deep: "high",
};

export const flowsEngineToLabel: Record<FlowsEngine, FlowsLabel> = {
  low: "Shallow",
  medium: "Medium",
  high: "Deep",
};

// ─── Coverage (Thin↔low, Medium↔medium, Exhaustive↔high) ─────────────────────

export type CoverageLabel = "Thin" | "Medium" | "Exhaustive";
export type CoverageEngine = "low" | "medium" | "high";

export const coverageLabelToEngine: Record<CoverageLabel, CoverageEngine> = {
  Thin: "low",
  Medium: "medium",
  Exhaustive: "high",
};

export const coverageEngineToLabel: Record<CoverageEngine, CoverageLabel> = {
  low: "Thin",
  medium: "Medium",
  high: "Exhaustive",
};

// ─── Coherence ────────────────────────────────────────────────────────────────
// Passes through label casing to the engine value (tenative dial, low/med/high).

export type CoherenceLabel = "Low" | "Medium" | "High";
export type CoherenceEngine = "low" | "medium" | "high";

export const coherenceLabelToEngine: Record<CoherenceLabel, CoherenceEngine> = {
  Low: "low",
  Medium: "medium",
  High: "high",
};

export const coherenceEngineToLabel: Record<CoherenceEngine, CoherenceLabel> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

// ─── Convenience re-exports ───────────────────────────────────────────────────
// Callers that want the generic pair for any control can use these aliases.

/** labelToEngine — all six controls. */
export const labelToEngine = {
  style: styleLabelToEngine,
  visual: fidelityLabelToEngine,
  editorial: fidelityLabelToEngine,
  flows: flowsLabelToEngine,
  coverage: coverageLabelToEngine,
  coherence: coherenceLabelToEngine,
} as const;

/** engineToLabel — all six controls. */
export const engineToLabel = {
  style: styleEngineToLabel,
  visual: fidelityEngineToLabel,
  editorial: fidelityEngineToLabel,
  flows: flowsEngineToLabel,
  coverage: coverageEngineToLabel,
  coherence: coherenceEngineToLabel,
} as const;

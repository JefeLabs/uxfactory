import type { FidelityLevel } from "./types.js";

/** The fidelity ramp, low → high (Artifacts PRD §6.5). */
export const FIDELITY_ORDER: readonly FidelityLevel[] = [
  "WIREFRAME",
  "CONTENT",
  "VISUAL",
  "INTERACTIVE",
  "PRODUCTION",
];

export function fidelityRank(f: FidelityLevel): number {
  return FIDELITY_ORDER.indexOf(f);
}

/** A check binds when the render's fidelity has reached the check's min_fidelity. */
export function fidelityGte(a: FidelityLevel, min: FidelityLevel): boolean {
  return fidelityRank(a) >= fidelityRank(min);
}

/** The next level up the ramp, or null at the top. */
export function nextFidelity(f: FidelityLevel): FidelityLevel | null {
  const i = fidelityRank(f);
  return i >= 0 && i < FIDELITY_ORDER.length - 1 ? FIDELITY_ORDER[i + 1]! : null;
}

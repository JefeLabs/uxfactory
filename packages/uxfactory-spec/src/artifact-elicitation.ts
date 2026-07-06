/**
 * artifact-elicitation.ts — interview scripts behind the "Create artifact"
 * affordance (source: .plans/artifact-schemas-and-elicitation.md).
 *
 * Only [E] (elicited — the human must answer) and [F] (defaulted — prefilled,
 * silence accepts) questions are encoded; [D] (derived) questions are the
 * resolver's job and never rendered as blank fields. Discipline from the doc:
 * an artifact's interview length = its [E] count, and rule 5 caps it at five —
 * the test suite enforces that cap.
 *
 * Keyed by REGISTRY artifact id (component-type-mapping), not panel keys.
 * Registered artifacts without questions (requirements, tokens) get [] —
 * their dialog is guidance-only.
 */

export interface ElicitationQuestion {
  id: string;
  /** E = must answer before generating; F = prefilled default, editable. */
  tag: "E" | "F";
  question: string;
  placeholder?: string;
  /** Prefill for [F] questions — silence accepts the default. */
  defaultValue?: string;
}

export const ARTIFACT_ELICITATION: Record<string, ElicitationQuestion[]> = {
  "product-brief": [
    { id: "problem", tag: "E", question: "What problem does this product solve, and for whom?", placeholder: "One sentence each" },
    { id: "outcomes", tag: "E", question: "How will you measure success? Name 1–3 outcomes with targets." },
    { id: "out-of-scope", tag: "E", question: "What is explicitly out of scope for this version?" },
    { id: "constraints", tag: "E", question: "What constraints are non-negotiable (technical, legal, brand, budget)?" },
  ],
  "acceptance-criteria": [],
  "sitemap": [
    { id: "pages", tag: "E", question: "List the pages this product needs — and flag anything the current sitemap is missing.", placeholder: "Home, Pricing, Docs, …" },
  ],
  "flows": [
    { id: "entry-exit", tag: "E", question: "Where does the flow start, and what counts as successful completion?" },
    { id: "steps", tag: "E", question: "Walk the steps: at each screen, what does the user do?" },
    { id: "branches", tag: "E", question: "Where can it branch or fail — and what happens then?" },
  ],
  "brand-colors": [
    { id: "existing", tag: "E", question: "Existing brand colors (hexes or a link), or the direction to explore if none exist?", placeholder: "#5B5BD6, #16A34A — or 'warm, editorial, high-contrast'" },
  ],
  "palettes": [
    { id: "roles", tag: "E", question: "Any role assignments to force (surface, text, interactive), or should they derive from brand colors?" },
  ],
  "fonts": [
    { id: "faces", tag: "E", question: "Existing brand typefaces (names or links), or the feel you want if none?", placeholder: "Inter + Lora — or 'confident, technical'" },
  ],
  "grid": [
    { id: "existing", tag: "E", question: "Is there an existing grid to import (Figma layout grid), or should one be derived?" },
    { id: "columns", tag: "F", question: "Columns and spacing base", defaultValue: "4/8/12 columns at an 8px base" },
  ],
  "tokens": [],
  "icons": [
    { id: "set", tag: "E", question: "Icon set preference — lucide, material, or custom (link if custom)?" },
    { id: "grid", tag: "F", question: "Icon grid and stroke", defaultValue: "24px grid, 1.5px stroke" },
  ],
  "photography": [
    { id: "direction", tag: "E", question: "Art direction in a phrase", placeholder: "candid, warm, natural light" },
    { id: "subjects", tag: "E", question: "Subjects to show — and anything to avoid?" },
    { id: "source", tag: "E", question: "Source: own library, stock (which license), or generated?" },
  ],
  "illustrations": [
    { id: "style", tag: "E", question: "Illustration style in a phrase", placeholder: "flat geometric, duotone, hand-drawn" },
  ],
};

// ─── Prerequisite chaining ────────────────────────────────────────────────────

/**
 * Trace-graph prerequisites: an artifact's interview derives [D] answers from
 * these, so they must exist FIRST (cross-cutting rule 1 — "the wizard never
 * runs a story interview before personas exist; a chip's create affordance
 * chains prerequisite interviews"). Only hard derivation edges are listed;
 * [F]-grade derivations (defaults) never chain.
 */
export const ARTIFACT_PREREQS: Record<string, string[]> = {
  // palettes are role assignments OVER brand colors — nothing to assign without them.
  "palettes": ["brand-colors"],
  // flows pick their stories and step through sitemap nodes.
  "flows": ["acceptance-criteria", "sitemap"],
  // tokens are MATERIALIZED from the system artifacts.
  "tokens": ["brand-colors", "palettes", "grid"],
  // illustration palettes are a subset of brand colors.
  "illustrations": ["brand-colors"],
  // the doc's canonical hard dependency (both still planned).
  "stories": ["personas"],
};

/**
 * Resolve the creation chain for `target`: missing prerequisites first (in
 * dependency order, deduplicated), the target last. `missing` reports whether
 * an artifact id currently lacks a file. Cycles are broken defensively.
 */
export function resolveCreationChain(
  target: string,
  missing: (artifactId: string) => boolean,
): string[] {
  const chain: string[] = [];
  const visit = (id: string, stack: Set<string>): void => {
    if (stack.has(id) || chain.includes(id)) return;
    stack.add(id);
    for (const dep of ARTIFACT_PREREQS[id] ?? []) {
      if (missing(dep)) visit(dep, stack);
    }
    chain.push(id);
  };
  visit(target, new Set());
  return chain;
}

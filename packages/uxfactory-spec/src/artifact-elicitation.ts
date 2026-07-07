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
  "stories": [
    // Per-story interview. [D] questions (actor picked from registered
    // personas, feature assignment) are derived, never rendered as blanks.
    { id: "want", tag: "E", question: "What does this actor want to do?", placeholder: "the \"I want\" clause" },
    { id: "so-that", tag: "E", question: "Why — what does it get them?", placeholder: "the \"so that\" clause" },
    { id: "acceptance", tag: "E", question: "How do we know it works? Give at least one Given/When/Then.", placeholder: "Given the FAQ page is open, when …, then …" },
    { id: "checkable", tag: "F", question: "Checkability per criterion", defaultValue: "auto when the Then clause references observable UI; else manual (flagged)" },
  ],
  "audience": [
    // Quantitative segmentation — modulates rendering (tone, density,
    // editorial); the demoted Target Demographic's persistent home.
    { id: "segments", tag: "E", question: "Who uses this? Describe each segment in a phrase (age range, context of use).", placeholder: "35–55 store managers, on the floor between tasks" },
    { id: "primary", tag: "E", question: "Which segment is primary when they conflict?" },
    { id: "a11y-characteristics", tag: "E", question: "Any segment with accessibility-relevant characteristics? (age-related vision, situational one-handed use — write 'none' if none)", placeholder: "none" },
    { id: "defaults", tag: "F", question: "Device mix, locales, and share", defaultValue: "device mix from the Platform chip; locales from the project Locale; even share split" },
  ],
  "features": [
    // Groups stories — never gates, only scopes (coverage denominator,
    // generation scoping, extend unit). [D]: story assignment clusters the
    // registered stories; origin derives from the project quadrant.
    { id: "capabilities", tag: "E", question: "Name the major capabilities of this product — chunks a user would recognize (5–12 typically).", placeholder: "Browse catalog, Checkout, Order tracking, …" },
    { id: "status", tag: "F", question: "Initial status per feature", defaultValue: "planned" },
  ],
  "personas": [
    { id: "archetypes", tag: "E", question: "Name each persona with a one-line archetype (2–4 total)", placeholder: "Returning Buyer — knows what she wants, hates friction" },
    { id: "goals", tag: "E", question: "Top 2–3 goals per persona when using the product" },
    { id: "frustrations", tag: "E", question: "Top frustrations or anxieties per persona" },
    { id: "context", tag: "E", question: "Expertise level and usage frequency per persona", placeholder: "novice, weekly — expert, daily" },
    { id: "quote", tag: "F", question: "Signature quotes", defaultValue: "generated from goals and frustrations — cosmetic, never load-bearing" },
  ],
  "sitemap": [
    { id: "pages", tag: "E", question: "List the pages this product needs — and flag anything the current sitemap is missing.", placeholder: "Home, Pricing, Docs, …" },
    // [D]-grade: derived from the stories each page serves; the agent links
    // nodes to features (featureRefs), stories ride transitively behind them.
    { id: "feature-links", tag: "F", question: "Which features does each page serve?", defaultValue: "derive from the stories each page realizes — link nodes to registered features" },
  ],
  "flows": [
    // [D]-grade: candidates prefill from the registered stories; the user
    // edits down to the subset this flow realizes (decision 6 trace graph).
    { id: "realizes", tag: "F", question: "Which registered stories does this flow realize?", defaultValue: "all registered stories" },
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
  "typography": [
    { id: "base-ratio", tag: "F", question: "Base size and scale ratio", defaultValue: "16px base, 1.25 ratio" },
    { id: "limits", tag: "F", question: "Readability limits", defaultValue: "min body 16px, line length 45–75ch" },
    { id: "house-rules", tag: "E", question: "Any house rules? (e.g. no italics, sentence-case headings — write 'none' if none)", placeholder: "none" },
  ],
  "a11y-spec": [
    { id: "target", tag: "F", question: "Conformance target", defaultValue: "WCAG 2.2 AA" },
    { id: "exceptions", tag: "E", question: "Known exceptions? Each needs a justification and expiry — write 'none' if none.", placeholder: "none" },
  ],
  "copy-deck": [
    // [D]: the slot inventory derives from sitemap + component specs — the
    // deck's skeleton is generated, never asked.
    { id: "copy", tag: "E", question: "Approve the generated candidate copy per slot, or supply your own — call out anything that must read exactly as written.", placeholder: "hero headline must be: Ship designs that match intent" },
    { id: "approver", tag: "E", question: "Who approves copy — is 'approved' status gated to a role? (write 'no gate' if anyone)", placeholder: "no gate" },
  ],
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
  "flows": ["stories", "sitemap"],
  // tokens are MATERIALIZED from the system artifacts.
  "tokens": ["brand-colors", "palettes", "typography", "grid"],
  // type tokens derive from the fonts inventory's default pairing.
  "typography": ["fonts"],
  // illustration palettes are a subset of brand colors.
  "illustrations": ["brand-colors"],
  // the doc's canonical hard dependency: every actor references a persona.
  "stories": ["personas"],
  // story assignment clusters the REGISTERED stories set — nothing to group without it.
  "features": ["stories"],
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

/**
 * Canonical authoring (supply) order — the trace graph flattened: product
 * intent → actors → stories → scope → IA → design system (a11y before
 * palettes: contrast math derives from it) → tokens (materialized last in
 * the system) → content vocabulary → assets → slot-dependent content →
 * governance. Chips and inventories sort by this; the test suite enforces
 * that every ARTIFACT_PREREQS edge points backwards in this list.
 */
export const AUTHORING_ORDER: string[] = [
  "product-brief",
  "audience",
  "personas",
  "stories",
  "acceptance-criteria",
  "features",
  "creative-brief",
  "journey-map",
  "sitemap",
  "navigation-model",
  "flows",
  "a11y-spec",
  "brand-colors",
  "palettes",
  "fonts",
  "typography",
  "grid",
  "tokens",
  "voice-tone",
  "glossary",
  "interaction-states",
  "brand-usage",
  "dataviz",
  "channel-canvas",
  "icons",
  "photography",
  "illustrations",
  "component-spec",
  "copy-deck",
  "reference-set",
  "conformance-policy",
  "generation-config",
];

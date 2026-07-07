/**
 * artifact-schemas.ts — Per-artifact section schemas and all guidance copy.
 *
 * Single source of truth for guidance text used in two places:
 *   1. ArtifactEditor — section cards show muted guidance below the title.
 *   2. CreateArtifactDialog — artifact-specific copy above the guidance textarea.
 *
 * Previously the dialog guidance lived inside CreateArtifactDialog.tsx;
 * it is now unified here so that both surfaces stay consistent.
 */

// ─── Editor section schema ────────────────────────────────────────────────────

export interface ArtifactSection {
  title: string;
  guidance: string;
}

/**
 * Per-artifact section schemas.
 *
 * Maps an artifact key to its ordered sections (title + muted guidance string).
 * Sections whose title matches an entry here show the schema guidance in the
 * editor; unmatched sections fall back to GENERIC_SECTION_GUIDANCE.
 */
export const ARTIFACT_SECTIONS: Record<string, ArtifactSection[]> = {
  brief: [
    {
      title: "Overview",
      guidance: "What is this product in one paragraph — the elevator story.",
    },
    {
      title: "Audience & insight",
      guidance:
        "Who is this for and what do we know about them beyond the demographics already pinned in setup?",
    },
    {
      title: "Goals & success metrics",
      guidance: "What outcomes define success — measurable where possible.",
    },
    {
      title: "Scope & constraints",
      guidance: "What's in, what's explicitly out, and any hard constraints.",
    },
    {
      title: "Risks & open questions",
      guidance: "What could sink this and what remains undecided.",
    },
  ],
};

/** Guidance text for sections that don't match any per-artifact schema entry. */
export const GENERIC_SECTION_GUIDANCE = "Add or refine content for this section.";

/** Look up the schema guidance for a named section, with generic fallback. */
export function sectionGuidanceFor(
  artifactKey: string,
  title: string,
): string {
  const schema = ARTIFACT_SECTIONS[artifactKey];
  if (!schema) return GENERIC_SECTION_GUIDANCE;
  return schema.find((s) => s.title === title)?.guidance ?? GENERIC_SECTION_GUIDANCE;
}

// ─── Create / Regenerate dialog guidance ──────────────────────────────────────

/**
 * Artifact-specific guiding copy shown above the guidance textarea in the
 * Create / Regenerate dialog.
 */
export const CREATE_GUIDANCE: Record<string, string> = {
  personas:
    "Behavioral archetypes — the 'As a ___' every story resolves to. Two to four, each with goals and frustrations.",
  typography:
    "The type system: scale, hierarchy rules, and readability limits — the checkable side of your fonts.",
  "a11y-spec":
    "Your accessibility contract. Defaults cover WCAG 2.2 AA — its value is in checking, not authoring.",
  brief:
    "Describe the product, its audience, and what success looks like — the agent drafts the product brief from this.",
  stories:
    "One story per file: an actor (persona), what they want, why — and at least one Given/When/Then that proves it works.",
  features:
    "Name the capabilities a user would recognize — the agent clusters your registered stories under them and derives inherited vs net-new from the project quadrant.",
  audience:
    "Describe who uses this in segments (age range, context of use) and which one wins when they conflict — device mix and locales derive from your project config.",
  sitemap:
    "List the main areas or journeys your product needs — the agent proposes the page map.",
  flows:
    "Name the key user flows (e.g. checkout, returns) and any steps they must include — the agent maps each one screen by screen.",
  "brand-colors":
    "Name anchor colors (hex codes welcome) or describe the brand personality to convey — the agent derives brand colors that fit.",
  palettes:
    "Describe the mood and contrast you want (e.g. calm neutrals with one bold accent) — the agent builds the full color ramps.",
  fonts:
    "Mention typefaces you like or the tone to strike (e.g. friendly, editorial, technical) — the agent selects the font pairing.",
  grid:
    "Note target devices, breakpoints, and how dense layouts should feel — the agent defines the grid and viewports.",
  tokens:
    "Call out platforms or naming conventions the tokens must serve — the agent assembles the design token set.",
  icons:
    "Describe the icon style you want (e.g. outlined, rounded, duotone) and any must-have glyphs — the agent curates the set.",
  photography:
    "Describe subject matter, mood, and treatment (e.g. candid people, warm light, high contrast) — the agent writes the photography direction.",
  illustrations:
    "Describe the illustration style (e.g. flat geometric, hand-drawn, editorial spot art) and where it will appear — the agent defines the direction.",
};

const DEFAULT_CREATE_GUIDANCE =
  "Add any direction you want the agent to follow — goals, constraints, and examples all help ground the result.";

/** Resolve the dialog guiding copy for an artifact key. */
export function createGuidanceCopyFor(artifactKey: string): string {
  return CREATE_GUIDANCE[artifactKey] ?? DEFAULT_CREATE_GUIDANCE;
}

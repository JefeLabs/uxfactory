/**
 * design-styles.ts — the design-style vocabulary (classification.designStyle).
 *
 * Slugs and traits are mirrored by the worker's STYLE_GUIDANCE
 * (clients/uxfactory-worker/src/generative.ts) — keep the two in sync.
 */

export interface DesignStyle {
  value: string;
  label: string;
  traits: string[];
}

export const DESIGN_STYLES: DesignStyle[] = [
  {
    value: "minimalism",
    label: "Minimalism",
    traits: [
      "Few elements",
      "No decorative details",
      "Lots of negative space",
      "Minimal use of bold colors",
    ],
  },
  {
    value: "neobrutalism",
    label: "Brutalism & Neobrutalism",
    traits: [
      "Provocative layouts",
      "Clashing color palettes",
      "Heavy shadows and outlines",
    ],
  },
  {
    value: "constructivism",
    label: "Constructivism",
    traits: [
      "Sans-serif fonts",
      "Various geometric shapes",
      "Elements aligned to one side of the page",
    ],
  },
  {
    value: "swiss",
    label: "Swiss Style",
    traits: [
      "Strong modular grid",
      "Clean sans-serif fonts",
      "Minimal, realistic photos and illustrations",
      "Poster-inspired composition",
    ],
  },
  {
    value: "editorial",
    label: "Editorial Style",
    traits: [
      "Print-inspired design",
      "High contrast in fonts",
      "Large visuals",
      "Plenty of decorative elements",
    ],
  },
  {
    value: "hand-drawn",
    label: "Hand-drawn Style",
    traits: [
      "Handwritten or script fonts",
      "Sketches and brush strokes",
      "Misaligned or free-form layout",
      "Intentional visual chaos",
    ],
  },
  {
    value: "retro",
    label: "Retro",
    traits: [
      "Bright color palettes and gradients",
      "Grainy textures and wear effects",
      "Design elements inspired by old-school tech",
    ],
  },
  {
    value: "flat",
    label: "Flat",
    traits: [
      "Total flatness — no shadows or 3D effects",
      "Pastel tones",
      "Clean, readable fonts",
    ],
  },
  {
    value: "bento",
    label: "Bento",
    traits: [
      "Many rectangular, rounded content blocks",
      "Very little empty space",
      "No decorative or unconventional design tricks",
    ],
  },
];

/** Display label for a slug ("swiss" → "Swiss Style"); undefined when unknown. */
export function designStyleLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return DESIGN_STYLES.find((s) => s.value === value)?.label;
}

/**
 * Industry/purpose → suggested design style. Industry keywords win over the
 * category default; the user can always override in the wizard.
 */
export function suggestDesignStyle(
  category: string | undefined,
  industry: string | undefined,
): string {
  const ind = (industry ?? "").toLowerCase();
  if (/(corporate|finan|bank|legal|insur|consult)/.test(ind)) return "swiss";
  if (/(creative|agency|art|fashion|media|editorial|publish)/.test(ind)) return "editorial";
  if (/(food|coffee|craft|bakery|restaurant|kids)/.test(ind)) return "hand-drawn";
  if (/(music|game|entertainment)/.test(ind)) return "retro";
  if (category === "webapp") return "bento";
  if (category === "ecommerce") return "flat";
  return "minimalism";
}

import { CATEGORY_TAXONOMY, normalizeCategory } from "@uxfactory/spec";
/**
 * design-styles.ts — the design-style vocabulary (classification.designStyle).
 *
 * Slugs and traits are mirrored by the worker's STYLE_GUIDANCE
 * (clients/uxfactory-worker/src/generative.ts) — a sync test in
 * worker.test.ts fails if the two vocabularies drift.
 */

export type DesignStyleGroup =
  | "core"
  | "paradigms"
  | "dimensional"
  | "nostalgic"
  | "artistic"
  | "thematic";

export const DESIGN_STYLE_GROUPS: { id: DesignStyleGroup; label: string }[] = [
  { id: "core", label: "Core styles" },
  { id: "paradigms", label: "Core digital paradigms" },
  { id: "dimensional", label: "Modern & dimensional" },
  { id: "nostalgic", label: "Nostalgic & retro" },
  { id: "artistic", label: "Artistic & cultural" },
  { id: "thematic", label: "Thematic & niche" },
];

export interface DesignStyle {
  value: string;
  label: string;
  traits: string[];
  group: DesignStyleGroup;
}

export const DESIGN_STYLES: DesignStyle[] = [
  // ── Core styles ─────────────────────────────────────────────────────────────
  {
    value: "minimalism",
    label: "Minimalism",
    group: "core",
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
    group: "core",
    traits: [
      "Provocative layouts",
      "Clashing color palettes",
      "Heavy shadows and outlines",
    ],
  },
  {
    value: "constructivism",
    label: "Constructivism",
    group: "core",
    traits: [
      "Sans-serif fonts",
      "Various geometric shapes",
      "Elements aligned to one side of the page",
    ],
  },
  {
    value: "swiss",
    label: "Swiss Style",
    group: "core",
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
    group: "core",
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
    group: "core",
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
    group: "core",
    traits: [
      "Bright color palettes and gradients",
      "Grainy textures and wear effects",
      "Design elements inspired by old-school tech",
    ],
  },
  {
    value: "flat",
    label: "Flat",
    group: "core",
    traits: [
      "Total flatness — no shadows or 3D effects",
      "Pastel tones",
      "Clean, readable fonts",
    ],
  },
  {
    value: "bento",
    label: "Bento",
    group: "core",
    traits: [
      "Many rectangular, rounded content blocks",
      "Very little empty space",
      "No decorative or unconventional design tricks",
    ],
  },

  // ── Core digital paradigms ──────────────────────────────────────────────────
  {
    value: "skeuomorphic",
    label: "Skeuomorphic",
    group: "paradigms",
    traits: [
      "Hyper-realistic textures, shadows, and lighting",
      "Mimics real-world materials (leather, brushed metal)",
      "Physical switches and controls",
    ],
  },
  {
    value: "material",
    label: "Material Design",
    group: "paradigms",
    traits: [
      "Realistic paper-and-ink lighting",
      "Grid-based layouts with disciplined padding",
      "Responsive, physically-grounded animations",
    ],
  },
  {
    value: "cupertino",
    label: "Cupertino (Apple HIG)",
    group: "paradigms",
    traits: [
      "Smooth blur and translucent surfaces",
      "Large typography",
      "Content depth and fluid navigation",
    ],
  },
  {
    value: "metro",
    label: "Metro (Flat 2.0)",
    group: "paradigms",
    traits: [
      "Sharp edges and solid blocks of color",
      "High-contrast typography",
      "Tile-based composition",
    ],
  },
  {
    value: "enterprise",
    label: "Enterprise / Utility-first",
    group: "paradigms",
    traits: [
      "Extreme data density",
      "Strict atomic component hierarchy",
      "High accessibility",
      "Rigid, functional layouts with no ornamental flair",
    ],
  },
  {
    value: "wireframe",
    label: "Wireframe / Skeletal",
    group: "paradigms",
    traits: [
      "Grayscale tones",
      "Simple stroke borders",
      "Placeholder typography",
      "Exposed structural bones of the interface",
    ],
  },

  // ── Modern & dimensional ────────────────────────────────────────────────────
  {
    value: "glassmorphism",
    label: "Glassmorphism",
    group: "dimensional",
    traits: [
      "Frosted-glass translucent panels",
      "Vivid background colors and gradients",
      "Layered vertical depth and hierarchy",
    ],
  },
  {
    value: "neumorphism",
    label: "Neumorphism (Soft UI)",
    group: "dimensional",
    traits: [
      "Low-contrast monochromatic palette",
      "Dual inner/outer soft shadows",
      "Elements appear extruded from the background material",
    ],
  },
  {
    value: "claymorphism",
    label: "Claymorphism",
    group: "dimensional",
    traits: [
      "Floating 3D elements",
      "Very soft rounded corners",
      "Double inner shadows",
      "Tactile, friendly clay-like feel with pastel colors",
    ],
  },
  {
    value: "aurora",
    label: "Aurora / Mesh Gradients",
    group: "dimensional",
    traits: [
      "Fluid, blurred mesh gradients",
      "Organic color blends",
      "Dynamic warmth behind an uncluttered foreground",
    ],
  },
  {
    value: "holographic",
    label: "Holographic",
    group: "dimensional",
    traits: [
      "Iridescent color palettes",
      "Shimmering gradients",
      "Glowing prism-refraction edges",
    ],
  },

  // ── Nostalgic & retro ───────────────────────────────────────────────────────
  {
    value: "y2k",
    label: "Y2K Aesthetic",
    group: "nostalgic",
    traits: [
      "Metallic gradients",
      "Bubble fonts",
      "Icy blues and purples",
      "Early-internet optimism",
    ],
  },
  {
    value: "brutalist-web",
    label: "Web 1.0 / Brutalist Web",
    group: "nostalgic",
    traits: [
      "Default browser styling",
      "Times New Roman and bright blue hyperlinks",
      "Visible table borders",
      "Chaotic, unstyled layouts",
    ],
  },
  {
    value: "retro-os",
    label: "90s OS (Win95 / Mac OS 9)",
    group: "nostalgic",
    traits: [
      "Thick bevels and gray dialog boxes",
      "Pixelated icons",
      "Strict grid-based window management",
    ],
  },
  {
    value: "vaporwave",
    label: "Vaporwave",
    group: "nostalgic",
    traits: [
      "Neon pinks and cyans",
      "Grid lines and retro-tech imagery",
      "Glitch effects with classical statues",
    ],
  },
  {
    value: "pixel-art",
    label: "Pixel Art / 8-bit",
    group: "nostalgic",
    traits: [
      "Blocky, low-resolution graphics",
      "Restricted color palettes",
      "Jagged, un-aliased typography",
    ],
  },

  // ── Artistic & cultural ─────────────────────────────────────────────────────
  {
    value: "bauhaus",
    label: "Bauhaus",
    group: "artistic",
    traits: [
      "Fundamental geometric shapes (circles, squares, triangles)",
      "Primary colors with thick borders",
      "Strict grid systems balancing form and function",
    ],
  },
  {
    value: "art-deco",
    label: "Art Deco",
    group: "artistic",
    traits: [
      "Geometric elegance and symmetrical layouts",
      "High-contrast gold and black palettes",
      "Sophisticated sans-serif typography",
    ],
  },
  {
    value: "pop-art",
    label: "Pop Art",
    group: "artistic",
    traits: [
      "Comic-book halftone dots",
      "Primary colors with thick black outlines",
      "High-energy, contrasting compositions",
    ],
  },
  {
    value: "memphis",
    label: "Memphis Design",
    group: "artistic",
    traits: [
      "Energetic abstract geometric patterns and squiggles",
      "Clashing pastel and neon colors",
      "Unconventional asymmetric layouts",
    ],
  },
  {
    value: "de-stijl",
    label: "De Stijl",
    group: "artistic",
    traits: [
      "Only straight horizontal and vertical lines",
      "Rectangular forms",
      "Black, white, gray, and primary colors",
    ],
  },
  {
    value: "kinetic",
    label: "Kinetic / Typographic-led",
    group: "artistic",
    traits: [
      "Typography carries the entire aesthetic",
      "Aggressively large, tightly kerned text",
      "Animated type as the primary interactive element",
    ],
  },

  // ── Thematic & niche ────────────────────────────────────────────────────────
  {
    value: "cyberpunk",
    label: "Cyberpunk / Dark Tech",
    group: "thematic",
    traits: [
      "Deep dark backgrounds by default",
      "High-contrast glowing neon accents (cyan, magenta, yellow)",
      "Monospaced typography and HUD-like interfaces",
    ],
  },
  {
    value: "organic",
    label: "Organic / Eco",
    group: "thematic",
    traits: [
      "Earth tones (greens, browns, warm whites)",
      "Organic, irregular shapes",
      "Natural textures (paper, grain)",
      "Humanist typography",
    ],
  },
  {
    value: "dark-academia",
    label: "Dark Academia",
    group: "thematic",
    traits: [
      "Deep browns, maroons, and forest greens",
      "Serif typography",
      "Vintage paper textures",
      "Studious, classical vibe",
    ],
  },
  {
    value: "glitch",
    label: "Glitch / Anti-design",
    group: "thematic",
    traits: [
      "Intentional distortion and chromatic aberration",
      "Misaligned grids and overlapping text",
      "A rejection of traditional usability conventions",
    ],
  },
  {
    value: "terminal",
    label: "Terminal / CLI",
    group: "thematic",
    traits: [
      "Purely text-based interface",
      "Monospaced typography",
      "Stark dark background with bright green or amber text",
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
  if (/(developer|devtool|infra|monitor|security)/.test(ind)) return "cyberpunk";
  if (/(eco|sustain|garden|farm|outdoor|wellness)/.test(ind)) return "organic";
  if (/(education|academ|library|research)/.test(ind)) return "dark-academia";
  const cat = normalizeCategory(category ?? "");
  const group = CATEGORY_TAXONOMY[cat]?.group;
  if (group === "saas-tools") return "bento";
  if (group === "commerce") return "flat";
  return "minimalism";
}

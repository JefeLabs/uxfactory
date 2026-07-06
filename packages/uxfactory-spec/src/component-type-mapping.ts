/**
 * component-type-mapping.ts — the component-type → artifact requirement
 * mapping as DATA (source: .plans/component-type-artifact-mapping.md §§1–5).
 *
 * Consumed by the plugin (Required Artifacts chips per selected type), and —
 * later — the worker (generation grounding) and the gate resolver. The
 * mapping is data, not code: extend the registry/mapping objects; the
 * consistency tests in test/component-type-mapping.test.ts enforce the doc's
 * schema invariants (registry closure, stories/AC lockstep, resolver-consumed
 * class exclusion).
 *
 * Resolution order (§4): base `requires` → quadrant overrides → drop `n/a`
 * → `planned` artifacts render but NEVER block.
 */

export type RequirementLevel = "required" | "recommended" | "optional" | "n/a";
export type RegistryStatus = "registered" | "planned";
export type TypeGroup = "flows" | "pages" | "components" | "channel";
export type ProjectQuadrant = "re-skin" | "extend" | "redesign" | "greenfield";

export interface ArtifactRegistryEntry {
  /** Human label for chips and reports. */
  label: string;
  category:
    | "product"
    | "ia-ux"
    | "design"
    | "assets"
    | "content"
    | "components"
    | "references"
    | "governance";
  /** `planned` IDs may appear in mappings; they render disabled and never block. */
  status: RegistryStatus;
}

/** §1 — canonical artifact IDs. IDs are stable; paths may move. */
export const ARTIFACT_REGISTRY: Record<string, ArtifactRegistryEntry> = {
  "product-brief": { label: "Brief", category: "product", status: "registered" },
  "creative-brief": { label: "Creative brief", category: "product", status: "planned" },
  "stories": { label: "Stories", category: "product", status: "planned" },
  "features": { label: "Features", category: "product", status: "planned" },
  "acceptance-criteria": { label: "Requirements", category: "product", status: "registered" },
  "audience": { label: "Audience", category: "product", status: "planned" },
  "personas": { label: "Personas", category: "product", status: "registered" },
  "sitemap": { label: "Sitemap", category: "ia-ux", status: "registered" },
  "flows": { label: "Flows", category: "ia-ux", status: "registered" },
  "journey-map": { label: "Journey map", category: "ia-ux", status: "planned" },
  "navigation-model": { label: "Navigation model", category: "ia-ux", status: "planned" },
  "brand-colors": { label: "Brand colors", category: "design", status: "registered" },
  "palettes": { label: "Palettes", category: "design", status: "registered" },
  "fonts": { label: "Fonts", category: "design", status: "registered" },
  "typography": { label: "Typography", category: "design", status: "registered" },
  "grid": { label: "Grid", category: "design", status: "registered" },
  "tokens": { label: "Tokens", category: "design", status: "registered" },
  "a11y-spec": { label: "A11y spec", category: "design", status: "registered" },
  "interaction-states": { label: "Interaction states", category: "design", status: "planned" },
  "brand-usage": { label: "Brand usage", category: "design", status: "planned" },
  "dataviz": { label: "Data viz", category: "design", status: "planned" },
  "channel-canvas": { label: "Channel canvas", category: "design", status: "planned" },
  "icons": { label: "Icons", category: "assets", status: "registered" },
  "photography": { label: "Photography", category: "assets", status: "registered" },
  "illustrations": { label: "Illustrations", category: "assets", status: "registered" },
  "copy-deck": { label: "Copy deck", category: "content", status: "planned" },
  "voice-tone": { label: "Voice & tone", category: "content", status: "planned" },
  "glossary": { label: "Glossary", category: "content", status: "planned" },
  "component-spec": { label: "Component spec", category: "components", status: "planned" },
  "reference-set": { label: "Reference set", category: "references", status: "planned" },
  "conformance-policy": { label: "Conformance policy", category: "governance", status: "planned" },
  "generation-config": { label: "Generation config", category: "governance", status: "planned" },
};

export interface TypeMappingEntry {
  group: TypeGroup;
  requires: Record<string, RequirementLevel>;
}

/** §5 — the mapping, transcribed verbatim. */
export const COMPONENT_TYPE_MAPPING: Record<string, TypeMappingEntry> = {
  "user-flow": {
    group: "flows",
    requires: {
      "stories": "required",
      "acceptance-criteria": "required",
      "personas": "required",
      "flows": "required",
      "sitemap": "recommended",
      "grid": "required",
      "typography": "required",
      "brand-colors": "optional",
      "fonts": "optional",
      "icons": "optional",
      "a11y-spec": "required",
      "interaction-states": "recommended",
      "journey-map": "optional",
    },
  },
  "home-page": {
    group: "pages",
    requires: {
      "stories": "required",
      "acceptance-criteria": "required",
      "product-brief": "required",
      "sitemap": "required",
      "brand-colors": "required",
      "fonts": "required",
      "typography": "required",
      "grid": "required",
      "tokens": "recommended",
      "icons": "required",
      "photography": "recommended",
      "illustrations": "optional",
      "copy-deck": "required",
      "audience": "recommended",
      "personas": "recommended",
      "a11y-spec": "required",
      "interaction-states": "recommended",
      "glossary": "recommended",
      "navigation-model": "recommended",
      "reference-set": "recommended",
      "brand-usage": "optional",
    },
  },
  "secondary-page": {
    group: "pages",
    requires: {
      "stories": "required",
      "acceptance-criteria": "required",
      "sitemap": "required",
      "brand-colors": "required",
      "fonts": "required",
      "typography": "required",
      "grid": "required",
      "tokens": "recommended",
      "icons": "required",
      "photography": "optional",
      "copy-deck": "required",
      "personas": "recommended",
      "a11y-spec": "required",
      "interaction-states": "recommended",
      "glossary": "recommended",
      "navigation-model": "recommended",
      "reference-set": "optional",
    },
  },
  "tertiary-page": {
    group: "pages",
    requires: {
      "stories": "required",
      "acceptance-criteria": "required",
      "sitemap": "recommended",
      "brand-colors": "required",
      "fonts": "required",
      "typography": "required",
      "grid": "required",
      "tokens": "recommended",
      "icons": "recommended",
      "copy-deck": "recommended",
      "a11y-spec": "required",
      "interaction-states": "recommended",
      "glossary": "recommended",
    },
  },
  "page": {
    group: "pages",
    requires: {
      "stories": "required",
      "acceptance-criteria": "required",
      "brand-colors": "required",
      "fonts": "required",
      "typography": "required",
      "grid": "required",
      "tokens": "recommended",
      "icons": "recommended",
      "copy-deck": "recommended",
      "a11y-spec": "required",
      "interaction-states": "recommended",
      "glossary": "recommended",
      "reference-set": "optional",
    },
  },
  "template": {
    group: "components",
    requires: {
      "stories": "optional",
      "acceptance-criteria": "optional",
      "grid": "required",
      "typography": "required",
      "brand-colors": "required",
      "fonts": "required",
      "tokens": "required",
      "component-spec": "required",
      "a11y-spec": "required",
      "interaction-states": "required",
    },
  },
  "organism": {
    group: "components",
    requires: {
      "stories": "required",
      "acceptance-criteria": "required",
      "brand-colors": "required",
      "fonts": "required",
      "typography": "required",
      "grid": "required",
      "tokens": "required",
      "icons": "recommended",
      "component-spec": "required",
      "personas": "optional",
      "a11y-spec": "required",
      "interaction-states": "required",
      "glossary": "recommended",
    },
  },
  "molecule": {
    group: "components",
    requires: {
      "stories": "optional",
      "acceptance-criteria": "optional",
      "brand-colors": "required",
      "fonts": "required",
      "typography": "required",
      "tokens": "required",
      "icons": "optional",
      "component-spec": "recommended",
      "a11y-spec": "required",
      "interaction-states": "required",
    },
  },
  "atom": {
    group: "components",
    requires: {
      "stories": "n/a",
      "acceptance-criteria": "n/a",
      "brand-colors": "required",
      "fonts": "required",
      "typography": "required",
      "tokens": "required",
      "a11y-spec": "required",
      "interaction-states": "required",
    },
  },
  "email": {
    group: "channel",
    requires: {
      "stories": "n/a",
      "acceptance-criteria": "n/a",
      "creative-brief": "required",
      "copy-deck": "required",
      "voice-tone": "required",
      "brand-colors": "required",
      "fonts": "required",
      "typography": "recommended",
      "channel-canvas": "required",
      "photography": "optional",
      "illustrations": "optional",
      "audience": "recommended",
      "a11y-spec": "recommended",
      "glossary": "recommended",
      "brand-usage": "recommended",
    },
  },
  "instagram-post": {
    group: "channel",
    requires: {
      "creative-brief": "required",
      "copy-deck": "required",
      "voice-tone": "required",
      "brand-colors": "required",
      "fonts": "required",
      "channel-canvas": "required",
      "photography": "recommended",
      "illustrations": "optional",
      "audience": "recommended",
      "personas": "recommended",
      "brand-usage": "recommended",
      "glossary": "recommended",
      "reference-set": "recommended",
    },
  },
  "instagram-story": {
    group: "channel",
    requires: {
      "creative-brief": "required",
      "copy-deck": "required",
      "voice-tone": "required",
      "brand-colors": "required",
      "fonts": "required",
      "channel-canvas": "required",
      "photography": "recommended",
      "audience": "recommended",
      "personas": "recommended",
      "brand-usage": "recommended",
      "glossary": "recommended",
      "reference-set": "recommended",
    },
  },
  "youtube-thumbnail": {
    group: "channel",
    requires: {
      "creative-brief": "required",
      "copy-deck": "required",
      "brand-colors": "required",
      "fonts": "required",
      "channel-canvas": "required",
      "photography": "recommended",
      "illustrations": "optional",
      "brand-usage": "recommended",
      "glossary": "recommended",
      "reference-set": "recommended",
    },
  },
  "facebook-post": {
    group: "channel",
    requires: {
      "creative-brief": "required",
      "copy-deck": "required",
      "voice-tone": "required",
      "brand-colors": "required",
      "fonts": "required",
      "channel-canvas": "required",
      "photography": "optional",
      "audience": "recommended",
      "personas": "recommended",
      "brand-usage": "recommended",
      "glossary": "recommended",
    },
  },
  "x-post": {
    group: "channel",
    requires: {
      "creative-brief": "required",
      "copy-deck": "required",
      "voice-tone": "required",
      "brand-colors": "required",
      "channel-canvas": "required",
      "brand-usage": "recommended",
      "glossary": "recommended",
    },
  },
};

/** §5 quadrantModifiers — global per-artifact overrides. */
export const QUADRANT_MODIFIERS: Record<ProjectQuadrant, Record<string, RequirementLevel>> = {
  "re-skin": {
    "stories": "recommended",
    "acceptance-criteria": "recommended",
    "sitemap": "recommended",
    "product-brief": "optional",
  },
  "extend": {},
  "redesign": {
    "product-brief": "recommended",
  },
  "greenfield": {},
};

export interface ResolvedRequirement {
  artifactId: string;
  label: string;
  level: Exclude<RequirementLevel, "n/a">;
  status: RegistryStatus;
  /** required AND registered — planned artifacts render but never block. */
  blocking: boolean;
}

/**
 * Resolve a type's artifact requirements. Unknown types resolve empty.
 * Quadrant overrides apply only to artifacts the type already requires —
 * they relax or tighten, never introduce.
 */
export function resolveRequirements(
  typeId: string,
  quadrant?: ProjectQuadrant,
): ResolvedRequirement[] {
  const entry = COMPONENT_TYPE_MAPPING[typeId];
  if (entry === undefined) return [];
  const overrides = quadrant !== undefined ? QUADRANT_MODIFIERS[quadrant] : {};
  const resolved: ResolvedRequirement[] = [];
  for (const [artifactId, baseLevel] of Object.entries(entry.requires)) {
    const level = overrides[artifactId] ?? baseLevel;
    if (level === "n/a") continue;
    const registry = ARTIFACT_REGISTRY[artifactId];
    if (registry === undefined) continue; // consistency tests make this unreachable
    resolved.push({
      artifactId,
      label: registry.label,
      level,
      status: registry.status,
      blocking: level === "required" && registry.status === "registered",
    });
  }
  return resolved;
}

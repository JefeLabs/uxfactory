/**
 * artifact-mapping.ts — registry artifact IDs (component-type mapping in
 * @uxfactory/spec) ↔ the panel's snapshot artifact keys. Only registered
 * artifacts have a panel key; planned IDs render as coming-soon chips.
 */

/** Registry ID → panel snapshot key. */
export const ARTIFACT_KEY_BY_ID: Record<string, string> = {
  "product-brief": "brief",
  "stories": "stories",
  "features": "features",
  "audience": "audience",
  "personas": "personas",
  "sitemap": "sitemap",
  "flows": "flows",
  "brand-colors": "brand-colors",
  "palettes": "palettes",
  "fonts": "fonts",
  "grid": "grid",
  "typography": "typography",
  "a11y-spec": "a11y-spec",
  "tokens": "tokens",
  "icons": "icons",
  "photography": "photography",
  "illustrations": "illustrations",
};

/** Panel snapshot key → registry ID (inverse of ARTIFACT_KEY_BY_ID). */
export const REGISTRY_ID_BY_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(ARTIFACT_KEY_BY_ID).map(([id, key]) => [key, id]),
);

/** Set artifacts (a directory of instances) — no single-file in-panel editor. */
export const SET_ARTIFACT_KEYS: ReadonlySet<string> = new Set(["personas", "stories"]);

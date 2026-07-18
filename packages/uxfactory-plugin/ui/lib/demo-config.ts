/**
 * demo-config.ts — resolve the project config into a prompt-ready context block
 * for the Demo button's `demo-brief` worker job. Panel-side because the
 * design-style GROUP names live only in ui/lib/design-styles.ts. Pure, never
 * throws: unknown/missing fields are omitted; the three taxonomy-backed
 * settings (category, industry, design-style) carry their dropdown GROUP names.
 */
import {
  CATEGORY_TAXONOMY, CATEGORY_GROUPS, normalizeCategory,
  INDUSTRY_TAXONOMY, INDUSTRY_SECTORS, normalizeIndustry,
} from "@uxfactory/spec";
import { DESIGN_STYLES, DESIGN_STYLE_GROUPS } from "./design-styles.js";

function str(o: Record<string, unknown> | null | undefined, k: string): string {
  const v = o?.[k];
  return typeof v === "string" ? v : "";
}
function groupLabel(groups: { id: string; label: string }[], id: string): string {
  return groups.find((g) => g.id === id)?.label ?? id;
}

export function buildDemoConfigContext(
  classification: Record<string, unknown> | null | undefined,
  profile: Record<string, unknown> | null | undefined,
): string {
  const lines: string[] = [];

  const catSlug = normalizeCategory(str(classification, "category"));
  const cat = CATEGORY_TAXONOMY[catSlug];
  if (cat !== undefined) {
    lines.push(
      `Product type: ${groupLabel(CATEGORY_GROUPS, cat.group)} › ${cat.label} — ${cat.oneLiner}.` +
        (cat.iaSeed.length > 0 ? ` Typical pages: ${cat.iaSeed.join(", ")}.` : ""),
    );
  }

  const indSlug = normalizeIndustry(str(classification, "industry"));
  const ind = INDUSTRY_TAXONOMY[indSlug];
  if (ind !== undefined) {
    lines.push(
      `Industry: ${groupLabel(INDUSTRY_SECTORS, ind.sector)} › ${ind.label}. ${ind.drivers}` +
        (ind.complianceFlags.length > 0
          ? ` Compliance to respect: ${ind.complianceFlags.join(", ")}.`
          : ""),
    );
  }

  const styleSlug = str(classification, "designStyle");
  const style = DESIGN_STYLES.find((s) => s.value === styleSlug);
  if (style !== undefined) {
    lines.push(
      `Design style (vibe/archetype only, do not name it in the answers): ` +
        `${groupLabel(DESIGN_STYLE_GROUPS, style.group)} › ${style.label}` +
        (style.traits.length > 0 ? ` (${style.traits.slice(0, 3).join(", ")})` : "") + ".",
    );
  }

  const locale = str(classification, "locale");
  if (locale !== "") lines.push(`Locale: ${locale}.`);
  const platforms = Array.isArray(classification?.["platforms"])
    ? (classification!["platforms"] as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  if (platforms.length > 0) lines.push(`Platforms: ${platforms.join(", ")}.`);
  const layout = str(classification, "layout");
  if (layout !== "") lines.push(`Layout: ${layout}.`);
  const age = str(classification, "ageGroup");
  if (age !== "") lines.push(`Target age group: ${age}.`);
  const tone = str(classification, "style");
  if (tone !== "") lines.push(`Tone of voice: ${tone}.`);

  const scope = (profile?.["scope"] ?? null) as Record<string, unknown> | null;
  if (scope !== null) {
    const dials = ["visual", "editorial", "coverage", "flow"]
      .map((d) => `${d} ${str(scope, d) || "?"}`)
      .join(", ");
    lines.push(`Scope/ambition: ${dials}.`);
  }
  const coherence = str((profile?.["experimental"] ?? null) as Record<string, unknown> | null, "coherence");
  if (coherence !== "") lines.push(`Coherence: ${coherence}.`);

  return lines.length > 0
    ? lines.join("\n")
    : "No project configuration set — invent a broadly appealing web app idea.";
}

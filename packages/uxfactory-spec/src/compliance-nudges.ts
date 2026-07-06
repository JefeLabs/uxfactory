/**
 * compliance-nudges.ts — the first CONSUMER of the taxonomy compliance flags
 * (industry-taxonomy doc §cross-cutting flags).
 *
 * Nudges are ADVISORY: they never change requirements silently — they surface
 * as suggestions the team accepts or rejects (eventually as proposed
 * conformance-policy entries; today as Project-config callouts).
 */
import { CATEGORY_TAXONOMY, normalizeCategory } from "./category-taxonomy.js";
import { INDUSTRY_TAXONOMY, normalizeIndustry } from "./industry-taxonomy.js";

export interface ClassificationLike {
  category?: string;
  industry?: string;
  ageGroup?: string;
  locale?: string;
}

/**
 * Advisory compliance nudges for a project classification. Deduplicated,
 * stable order. Empty for unremarkable configurations.
 */
export function complianceNudges(classification: ClassificationLike): string[] {
  const nudges: string[] = [];
  const industryId = normalizeIndustry(classification.industry ?? "");
  const industry = INDUSTRY_TAXONOMY[industryId];
  const categoryId = normalizeCategory(classification.category ?? "");
  const category = CATEGORY_TAXONOMY[categoryId];
  const flags = new Set(industry?.complianceFlags ?? []);
  const underage = classification.ageGroup === "under-18";

  if (flags.has("regulated")) {
    nudges.push(
      `Regulated industry (${industry!.label}) — stricter conformance profile suggested; disclosure questions will join content interviews.`,
    );
  }
  if (flags.has("age-gated")) {
    nudges.push(
      `Age-gated industry (${industry!.label}) — an age-verification pattern is expected before content.`,
    );
  }
  // COPPA-class: an under-18 audience with an age-sensitive industry OR any
  // commerce-category product (the doc's worked example: under-18 × Ecommerce).
  if (underage && (flags.has("age-sensitive") || category?.group === "commerce")) {
    nudges.push(
      "Under-18 audience — COPPA-class considerations apply: data-collection copy and parental-consent patterns.",
    );
  }
  if (flags.has("jurisdiction-sensitive")) {
    const locale = classification.locale ?? "your locale";
    nudges.push(
      `Jurisdiction-sensitive industry — disclosure sets vary by locale (${locale}).`,
    );
  }
  return nudges;
}

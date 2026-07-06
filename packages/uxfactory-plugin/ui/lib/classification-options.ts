/**
 * classification-options.ts — the project-classification vocabularies shared
 * by SetupClassification (the wizard form) and the ContextBar's inline chip
 * editors. Extend HERE so both surfaces stay in sync.
 */
import type { ChipGroupOption, SegmentedOption } from "../components/index.js";

export const INDUSTRY_OPTIONS: { label: string; value: string }[] = [
  { label: "Corporate", value: "corporate" },
  { label: "Finance", value: "finance" },
  { label: "Healthcare", value: "healthcare" },
  { label: "Education", value: "education" },
  { label: "Retail", value: "retail" },
  { label: "Technology", value: "technology" },
  { label: "Media", value: "media" },
  { label: "Government", value: "government" },
  { label: "Non-profit", value: "non-profit" },
  { label: "Other", value: "other" },
];

export const LOCALE_OPTIONS: { label: string; value: string }[] = [
  { label: "English (US)", value: "en-US" },
  { label: "English (UK)", value: "en-GB" },
  { label: "Spanish", value: "es" },
  { label: "French", value: "fr" },
  { label: "German", value: "de" },
  { label: "Japanese", value: "ja" },
  { label: "Chinese (Simplified)", value: "zh-CN" },
  { label: "Portuguese", value: "pt" },
];

export const PLATFORM_OPTIONS: ChipGroupOption[] = [
  { label: "Desktop", value: "desktop" },
  { label: "Tablet", value: "tablet" },
  { label: "Mobile", value: "mobile" },
];

export const LAYOUT_OPTIONS: SegmentedOption[] = [
  { label: "Responsive", value: "responsive" },
  { label: "Adaptive", value: "adaptive" },
];

export const LAYOUT_CAPTIONS: Record<string, string> = {
  responsive: "One fluid layout across your platforms",
  adaptive: "Distinct layouts per platform",
};

export const AGE_GROUP_OPTIONS: ChipGroupOption[] = [
  { label: "Under 18", value: "under-18" },
  { label: "18–39", value: "18-39" },
  { label: "40–64", value: "40-64" },
  { label: "65+", value: "65+" },
];

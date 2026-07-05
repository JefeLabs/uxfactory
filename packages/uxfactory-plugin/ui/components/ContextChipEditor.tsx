/**
 * ContextChipEditor.tsx — the inline editor deployed UNDER the ContextBar when
 * a chip is clicked. One field at a time; the control matches the field's
 * setup-wizard editor so editing feels the same everywhere.
 *
 * Classification facts (category, industry, locale, platforms, layout, age
 * group) persist through PUT /project/classification; generative defaults
 * (tone + the scope dials) persist through PUT /project/profile; design style
 * is a generative default stored in the classification file (set-or-clear).
 * The ContextBar owns that routing — this component only renders the control.
 */
import React from "react";
import { ChipGroup } from "./ChipGroup.js";
import { Segmented } from "./Segmented.js";
import type { SegmentedOption } from "./Segmented.js";
import { DesignStylePicker } from "./DesignStylePicker.js";
import {
  CATEGORY_OPTIONS,
  INDUSTRY_OPTIONS,
  LOCALE_OPTIONS,
  PLATFORM_OPTIONS,
  LAYOUT_OPTIONS,
  LAYOUT_CAPTIONS,
  AGE_GROUP_OPTIONS,
} from "../lib/classification-options.js";
import {
  styleLabelToEngine,
  fidelityLabelToEngine,
  flowsLabelToEngine,
  coverageLabelToEngine,
} from "../lib/dials.js";

// ─── Field registry ───────────────────────────────────────────────────────────

/** Every editable chip in the ContextBar. */
export type ChipField =
  | "designStyle"
  | "category"
  | "industry"
  | "locale"
  | "platforms"
  | "layout"
  | "ageGroup"
  | "tone"
  | "visual"
  | "editorial"
  | "flow"
  | "coverage"
  | "coherence";

/** Fields persisted via PUT /project/classification (facts + design style). */
export const CLASSIFICATION_FIELDS: ReadonlySet<ChipField> = new Set([
  "designStyle", "category", "industry", "locale", "platforms", "layout", "ageGroup",
]);

/** Short human name — drives the Save/Cancel button accessible names. */
export const CHIP_FIELD_LABEL: Record<ChipField, string> = {
  designStyle: "style",
  category: "category",
  industry: "industry",
  locale: "locale",
  platforms: "platforms",
  layout: "layout",
  ageGroup: "age group",
  tone: "tone",
  visual: "visual",
  editorial: "editorial",
  flow: "flows",
  coverage: "coverage",
  coherence: "coherence",
};

const toSegmented = (map: Record<string, string>): SegmentedOption[] =>
  Object.entries(map).map(([label, value]) => ({ label, value }));

const TONE_OPTIONS = toSegmented(styleLabelToEngine);
const FIDELITY_OPTIONS = toSegmented(fidelityLabelToEngine);
const FLOWS_OPTIONS = toSegmented(flowsLabelToEngine);
const COVERAGE_OPTIONS = toSegmented(coverageLabelToEngine);

// ─── Editor ───────────────────────────────────────────────────────────────────

export interface ContextChipEditorProps {
  field: ChipField;
  /** string for single-value fields; string[] for platforms. */
  draft: string | string[];
  onChange(next: string | string[]): void;
  /** Suggested design style (designStyle field only). */
  suggestedStyle?: string;
}

export function ContextChipEditor({
  field,
  draft,
  onChange,
  suggestedStyle,
}: ContextChipEditorProps): React.JSX.Element {
  switch (field) {
    case "designStyle":
      return (
        <DesignStylePicker
          ariaLabel="Project design style"
          value={typeof draft === "string" ? draft : ""}
          onChange={onChange}
          suggested={suggestedStyle}
        />
      );
    case "category":
      return (
        <ChipGroup
          options={CATEGORY_OPTIONS}
          value={draft as string}
          onChange={(v) => onChange(v as string)}
          ariaLabel="Category"
        />
      );
    case "industry":
    case "locale": {
      const options = field === "industry" ? INDUSTRY_OPTIONS : LOCALE_OPTIONS;
      return (
        <select
          aria-label={field === "industry" ? "Industry" : "Locale"}
          value={draft as string}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-sm border border-gray-300 rounded-[var(--radius-card)] px-3 py-2 bg-white text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "platforms":
      return (
        <ChipGroup
          multi
          options={PLATFORM_OPTIONS}
          values={Array.isArray(draft) ? draft : []}
          onChange={(v) => onChange(v as string[])}
          ariaLabel="Platforms"
        />
      );
    case "layout":
      return (
        <div className="space-y-1">
          <Segmented
            options={LAYOUT_OPTIONS}
            value={draft as string}
            onChange={(v) => onChange(v)}
            ariaLabel="Layout"
          />
          <p className="text-xs text-gray-500">
            {LAYOUT_CAPTIONS[draft as string] ?? ""}
          </p>
        </div>
      );
    case "ageGroup":
      return (
        <ChipGroup
          options={AGE_GROUP_OPTIONS}
          value={draft as string}
          onChange={(v) => onChange(v as string)}
          ariaLabel="Age group"
        />
      );
    case "tone":
      return (
        <Segmented options={TONE_OPTIONS} value={draft as string} onChange={onChange} ariaLabel="Tone" />
      );
    case "visual":
      return (
        <Segmented options={FIDELITY_OPTIONS} value={draft as string} onChange={onChange} ariaLabel="Visual fidelity" />
      );
    case "editorial":
      return (
        <Segmented options={FIDELITY_OPTIONS} value={draft as string} onChange={onChange} ariaLabel="Editorial fidelity" />
      );
    case "flow":
      return (
        <Segmented options={FLOWS_OPTIONS} value={draft as string} onChange={onChange} ariaLabel="Flows" />
      );
    case "coverage":
      return (
        <Segmented options={COVERAGE_OPTIONS} value={draft as string} onChange={onChange} ariaLabel="Coverage" />
      );
    case "coherence":
      return (
        <Segmented options={FIDELITY_OPTIONS} value={draft as string} onChange={onChange} ariaLabel="Coherence" />
      );
  }
}

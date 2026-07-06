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
import { PROJECT_QUADRANTS, normalizeQuadrant } from "@uxfactory/spec";
import { CategorySelect } from "./CategorySelect.js";
import { IndustrySelect } from "./IndustrySelect.js";
import { ChipGroup } from "./ChipGroup.js";
import { Segmented } from "./Segmented.js";
import type { SegmentedOption } from "./Segmented.js";
import { DesignStylePicker } from "./DesignStylePicker.js";
import {
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
  | "quadrant"
  | "tone"
  | "visual"
  | "editorial"
  | "flow"
  | "coverage"
  | "coherence";

/** Fields persisted via PUT /project/classification (facts + design style). */
export const CLASSIFICATION_FIELDS: ReadonlySet<ChipField> = new Set([
  "designStyle", "category", "industry", "locale", "platforms", "layout", "ageGroup", "quadrant",
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
  quadrant: "quadrant",
  tone: "tone",
  visual: "visual",
  editorial: "editorial",
  flow: "flows",
  coverage: "coverage",
  coherence: "coherence",
};

/**
 * Help text shown under each chip editor — what the field drives downstream.
 * designStyle and layout are absent: their editors render value-dependent
 * captions of their own (traits/exploring hint, layout captions). Visual and
 * coverage copy reuses the SetupDefaults tooltip wording verbatim.
 */
const CHIP_FIELD_HELP: Partial<Record<ChipField, string>> = {
  category: "What the product is — drives suggested styles and generation defaults.",
  industry: "The domain served — informs style suggestions and copy tone.",
  locale: "Primary language and region for generated copy.",
  platforms: "Target devices — the default viewports for generated designs.",
  ageGroup: "Primary audience — affects tone, density, and accessibility choices.",
  quadrant:
    "Project nature — relaxes or tightens which artifacts generation requires (re-skin inherits intent; greenfield is the full gate).",
  tone: "Voice of generated copy — informal, mixed, or formal.",
  visual: "Visual fidelity of generated designs. At Medium+, a11y/contrast/token checks bind.",
  editorial: "How polished generated copy is — placeholder to publication-ready.",
  flow: "How deep generated user flows go — happy path to edge cases.",
  coverage:
    "Floor for generation without specs — when requirements exist, they take precedence. Coverage ≥ Low → requirement coverage binds (T1).",
  coherence: "Experimental — how strongly designs stay visually consistent with each other.",
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
  const control = renderControl(field, draft, onChange, suggestedStyle);
  const help = CHIP_FIELD_HELP[field];
  return (
    <div className="space-y-1">
      {control}
      {help !== undefined && <p className="text-xs text-gray-500">{help}</p>}
    </div>
  );
}

function renderControl(
  field: ChipField,
  draft: string | string[],
  onChange: (next: string | string[]) => void,
  suggestedStyle?: string,
): React.JSX.Element {
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
        <CategorySelect
          value={draft as string}
          onChange={(v) => onChange(v)}
        />
      );
    case "industry":
      return (
        <IndustrySelect value={draft as string} onChange={(v) => onChange(v)} />
      );
    case "locale":
      return (
        <select
          aria-label="Locale"
          value={draft as string}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-sm border border-gray-300 rounded-[var(--radius-card)] px-3 py-2 bg-white text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        >
          {LOCALE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
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
    case "quadrant":
      return (
        <div className="space-y-1">
          <Segmented
            options={PROJECT_QUADRANTS.map((q) => ({ label: q.label, value: q.id }))}
            value={normalizeQuadrant(draft)}
            onChange={(v) => onChange(v)}
            ariaLabel="Quadrant"
          />
          <p className="text-xs text-gray-500">
            {PROJECT_QUADRANTS.find((q) => q.id === normalizeQuadrant(draft))?.description ?? ""}
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

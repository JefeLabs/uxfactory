/**
 * artifact-forms.ts — declarative field specs for the structured-data (JSON)
 * artifact editor.
 *
 * A spec describes WHICH fields an artifact has and how to render each; React
 * Hook Form owns the state and the panel's own Tailwind/Radix inputs render each
 * `kind`. This is the reusable strategy layer: adding an editor for another JSON
 * artifact = add a spec here, no new component. Artifacts with no spec fall back
 * to the read-only JSON view.
 */

interface FieldBase {
  /** JSON key at this level. */
  key: string;
  label: string;
  guidance?: string;
}

/** Free single-line text. `nullable` serializes an empty value back to `null`. */
export interface TextField extends FieldBase {
  kind: "text";
  placeholder?: string;
  nullable?: boolean;
}
/** Multi-line prose. `nullable` serializes an empty value back to `null`. */
export interface TextareaField extends FieldBase {
  kind: "textarea";
  nullable?: boolean;
}
/** A 0..1 ratio shown and edited as a whole-number percent (0.5 ↔ "50"). */
export interface PercentField extends FieldBase {
  kind: "percent";
}
/** A `string[]` edited as add/remove chips. */
export interface ChipsField extends FieldBase {
  kind: "chips";
}
/**
 * A single-select. Options come from a static list, or from the `nameKey` values
 * of another array — a sibling by default, or a root-level array when
 * `scope: "root"` (e.g. a node's `parent` pointing at any other node). `nullable`
 * adds a "(none)" choice that serializes to `null`.
 */
export interface EnumField extends FieldBase {
  kind: "enum";
  options?: string[];
  optionsFrom?: { array: string; nameKey: string; scope?: "sibling" | "root" };
  nullable?: boolean;
}
/** A nested object rendered inline (e.g. deviceMix → desktop/mobile). */
export interface ObjectField extends FieldBase {
  kind: "object";
  fields: FieldSpec[];
}
/** A repeatable array of objects rendered as add/remove cards. */
export interface GroupField extends FieldBase {
  kind: "group";
  /** Singular noun for the add button + card heading ("Segment"). */
  itemLabel: string;
  /** Sub-field key whose value titles each card (falls back to "itemLabel N"). */
  itemTitleKey?: string;
  fields: FieldSpec[];
}

export type FieldSpec =
  | TextField
  | TextareaField
  | PercentField
  | ChipsField
  | EnumField
  | ObjectField
  | GroupField;

/** Advisory (never-blocking) cross-field check: an array's field should sum to `target`. */
export interface SumCheck {
  array: string;
  field: string;
  target: number;
  label: string;
}

/**
 * A read-only hierarchy preview built from a flat adjacency array (each item
 * points at its parent by id). Rendered above the form so the tree structure is
 * legible while editing the cards below.
 */
export interface TreePreviewSpec {
  /** The flat array of nodes (e.g. "nodes"). */
  array: string;
  /** Node id key (e.g. "nodeId"). */
  idKey: string;
  /** Parent-id key; a missing/unknown value makes the node a root (e.g. "parent"). */
  parentKey: string;
  /** Label key (e.g. "title"). */
  titleKey: string;
  /** Optional trailing badge key (e.g. "role"). */
  badgeKey?: string;
}

export interface ArtifactFormSpec {
  fields: FieldSpec[];
  sumChecks?: SumCheck[];
  treePreview?: TreePreviewSpec;
}

/**
 * Per-artifact field specs. Keyed by the panel snapshot artifact key. Mirrors the
 * shape the deterministic validators expect (segments[] + primarySegment for
 * audience), so a well-formed form yields a validator-clean artifact.
 */
export const ARTIFACT_FORMS: Record<string, ArtifactFormSpec> = {
  audience: {
    fields: [
      {
        kind: "enum",
        key: "primarySegment",
        label: "Primary segment",
        guidance: "The segment the experience optimizes for first.",
        optionsFrom: { array: "segments", nameKey: "name" },
      },
      {
        kind: "group",
        key: "segments",
        label: "Segments",
        itemLabel: "Segment",
        itemTitleKey: "name",
        fields: [
          { kind: "text", key: "name", label: "Name", placeholder: "e.g. design leads" },
          { kind: "percent", key: "share", label: "Share" },
          { kind: "text", key: "ageRange", label: "Age range", placeholder: "e.g. 28-45" },
          { kind: "chips", key: "locales", label: "Locales" },
          { kind: "textarea", key: "context", label: "Context" },
          {
            kind: "object",
            key: "deviceMix",
            label: "Device mix",
            fields: [
              { kind: "percent", key: "desktop", label: "Desktop" },
              { kind: "percent", key: "mobile", label: "Mobile" },
            ],
          },
          { kind: "textarea", key: "accessibilityNotes", label: "Accessibility notes", nullable: true },
        ],
      },
    ],
    sumChecks: [{ array: "segments", field: "share", target: 1, label: "Segment shares" }],
  },

  sitemap: {
    fields: [
      {
        kind: "group",
        key: "nodes",
        label: "Pages",
        itemLabel: "Page",
        itemTitleKey: "title",
        fields: [
          { kind: "text", key: "nodeId", label: "ID", placeholder: "e.g. N-landing" },
          { kind: "text", key: "title", label: "Title" },
          {
            kind: "enum",
            key: "role",
            label: "Role",
            guidance: "Where the page sits in the navigation hierarchy.",
            options: ["home", "primary", "secondary", "tertiary", "utility"],
          },
          {
            kind: "enum",
            key: "parent",
            label: "Parent",
            guidance: "The page this one lives under. None = a top-level (root) page.",
            nullable: true,
            optionsFrom: { array: "nodes", nameKey: "nodeId", scope: "root" },
          },
          { kind: "chips", key: "featureRefs", label: "Features" },
          {
            kind: "enum",
            key: "status",
            label: "Status",
            options: ["planned", "in-progress", "live"],
          },
        ],
      },
    ],
    treePreview: { array: "nodes", idKey: "nodeId", parentKey: "parent", titleKey: "title", badgeKey: "role" },
  },
};

/** The form spec for an artifact key, or undefined (→ read-only JSON fallback). */
export function formSpecFor(key: string): ArtifactFormSpec | undefined {
  return ARTIFACT_FORMS[key];
}

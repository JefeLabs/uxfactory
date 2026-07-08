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
 * A `string[]` chosen from a KNOWN option set (unlike free `chips`). Options are
 * static, or resolved from an external source the editor host supplies (e.g.
 * "featureIds" → the registered features). Selected values render as removable
 * pills; an "add…" dropdown offers the not-yet-selected options.
 */
export interface MultiSelectField extends FieldBase {
  kind: "multiselect";
  options?: string[];
  optionsFrom?: { external: string };
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
  optionsFrom?: {
    array: string;
    nameKey: string;
    scope?: "sibling" | "root";
    /** Drop the current row's own `nameKey` value — a node can't reference itself. */
    excludeSelf?: boolean;
  };
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
  | MultiSelectField
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
            optionsFrom: { array: "nodes", nameKey: "nodeId", scope: "root", excludeSelf: true },
          },
          { kind: "multiselect", key: "featureRefs", label: "Features", optionsFrom: { external: "featureIds" } },
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

/** A resolved external option — the stored value plus a human label. */
export interface ExternalOption {
  value: string;
  label: string;
}

/**
 * The external option-source keys a spec references (e.g. ["featureIds"]) —
 * recursing into groups/objects. The editor host resolves these to `ExternalOption[]`
 * (e.g. from the trace) and passes them to the form.
 */
export function externalSourcesFor(spec: ArtifactFormSpec): string[] {
  const out = new Set<string>();
  const walk = (fields: FieldSpec[]): void => {
    for (const f of fields) {
      if (f.kind === "multiselect" && f.optionsFrom !== undefined) out.add(f.optionsFrom.external);
      if (f.kind === "group" || f.kind === "object") walk(f.fields);
    }
  };
  walk(spec.fields);
  return [...out];
}

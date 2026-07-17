/**
 * node-identity.ts — types, registries, defaults, and validation for
 * canonical Figma node addresses (e.g. `home/hero@desktop@theme=students`).
 *
 * Source: .superpowers/sdd/task-1-brief.md. An address is a rendered
 * projection over structure (extraction), registries (breakpoints/palette/
 * states), and prior names — never authored freehand. This module is pure
 * data + validation; it owns no I/O and does no address derivation itself
 * (later tasks build the deriver on top of these types).
 *
 * The viewport (breakpoint band) vocabulary and the mode token vocabulary
 * MUST be disjoint: an address segment like `@desktop` must unambiguously
 * mean one or the other. `validateIdentityRegistries` enforces this and
 * names the offending token.
 */

// ─── provenance ─────────────────────────────────────────────────────────────

export type Provenance = "derived" | "inferred" | "elicited" | "defaulted";

export interface ProvenancedValue {
  value: string;
  provenance: Provenance;
  /** teaching surface: where the value came from */
  source?: "structure" | "registry" | "prior-name" | "vision" | "user" | "registry-default";
  confidence?: "high" | "low"; // low → surface for confirmation, never auto-apply
  confirmed?: boolean; // inferred only: user ratified via confirm gate
}

// ─── registries ─────────────────────────────────────────────────────────────

export interface BreakpointBand {
  name: string;
  min: number;
  max: number | null; // max null = unbounded
}
export interface BreakpointRegistry {
  bands: BreakpointBand[]; // ordered ascending by min
}

export type PaletteAxis = "mode" | "theme";
export interface PaletteCollection {
  collectionId: string; // Figma variable collection id
  name: string;
  axis: PaletteAxis; // declared at setup — the axis tag
  values: { modeId: string; token: string }[]; // Figma mode id → canonical token ("light")
  defaultToken?: string; // enables omission-at-default
}
export interface PaletteRegistry {
  collections: PaletteCollection[];
}

export interface StateRegistry {
  states: string[];
  defaultState: string;
}

export interface IdentityRegistries {
  version: 1;
  breakpoints: BreakpointRegistry;
  palette: PaletteRegistry;
  states: StateRegistry;
}

// ─── component registry ─────────────────────────────────────────────────────

export type Matchability = "matchable" | "composed";
export type AtomicLevel = "atom" | "molecule" | "organism" | "template";
export interface ComponentTypeEntry {
  key: string; // Figma component key (stable) or slug for manual entries
  roleName: string; // canonical label used in addresses ("button", "card")
  source: "figma-document" | "figma-library" | "code-connect" | "manual";
  matchability: Matchability;
  atomicLevel?: AtomicLevel;
  propsSchema?: Record<string, unknown>;
  codeBinding?: string; // e.g. "@heroui/button" — NEVER serialized into an address
}
export interface ComponentRegistry {
  version: 1;
  components: ComponentTypeEntry[];
}

// ─── extraction ─────────────────────────────────────────────────────────────

export interface ExtractedNode {
  durableId: string;
  figmaNodeId: string;
  parentDurableId: string | null; // null for extraction roots (page children)
  ordinal: number; // index among parent's children
  kind: string; // Figma node type: "FRAME" | "INSTANCE" | ...
  width: number | null;
  currentName: string;
  resolvedModes: Record<string, string>; // collectionId → modeId
  mainComponent: { key: string; name: string; remote: boolean } | null;
  variantProperties: Record<string, string> | null;
  isPageChild: boolean; // identification tier (root tier)
}
export interface IdentityExtraction {
  version: 1;
  page: { figmaNodeId: string; name: string };
  pageCount: number; // drives the first-discriminating-tier rule for the page label
  nodes: ExtractedNode[]; // parent-before-child order
}

// ─── manifest ────────────────────────────────────────────────────────────────

export interface PathSegment {
  label: string;
  ordinal?: number; // present only on sibling label collision (2, 3, … doc order)
  provenance: Provenance;
  source?: ProvenancedValue["source"];
  confirmed?: boolean;
}
export interface Coordinates {
  viewport?: ProvenancedValue;
  mode?: ProvenancedValue;
  theme?: ProvenancedValue;
  state?: ProvenancedValue;
}
export interface NodeIdentityRecord {
  durableId: string;
  figmaNodeId: string; // refreshed each extraction; ephemeral
  address: string; // rendered projection (serializeAddress output)
  scope: string[]; // ambient singleton tiers dropped from the address
  path: PathSegment[]; // own label is the last segment
  coordinates: Coordinates;
  kind: string;
  pathRoleDefault: "section" | "component" | "element";
  isDefinition: boolean; // COMPONENT / COMPONENT_SET
  matchability?: Matchability;
  atomicLevel?: AtomicLevel;
  resolutionStatus?: "bound" | "drifted" | "custom";
  definitionRef?: string; // ComponentTypeEntry.key
  codeBinding?: string;
  composition: string[]; // child durableIds — Derived even when own label is Inferred
  route?: string; // URL anchor when the node is a nav destination
  currentName: string;
  reasoning?: string; // teaching surface ("named hero because …")
  updatedAt: string; // ISO timestamp
  appliedAddress?: string; // last written back to the canvas (Task 14)
  appliedAt?: string;
}
export interface NodeManifest {
  version: 1;
  records: Record<string, NodeIdentityRecord>;
}

// ─── defaults ────────────────────────────────────────────────────────────────

/** The out-of-the-box registries: standard 3-band breakpoints, no palette axes, default state list. */
export function defaultIdentityRegistries(): IdentityRegistries {
  return {
    version: 1,
    breakpoints: {
      bands: [
        { name: "mobile", min: 0, max: 767 },
        { name: "tablet", min: 768, max: 1279 },
        { name: "desktop", min: 1280, max: null },
      ],
    },
    palette: { collections: [] },
    states: { states: ["default", "hover", "focus", "disabled"], defaultState: "default" },
  };
}

// ─── token vocabularies ──────────────────────────────────────────────────────

function tokensForAxis(collections: PaletteCollection[], axis: PaletteAxis): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const collection of collections) {
    if (collection.axis !== axis) continue;
    for (const { token } of collection.values) {
      if (!seen.has(token)) {
        seen.add(token);
        out.push(token);
      }
    }
  }
  return out;
}

/** The token vocabulary of every `axis: "mode"` collection, de-duplicated in declaration order. */
export function modeTokens(r: IdentityRegistries): string[] {
  return tokensForAxis(r.palette.collections, "mode");
}

/** The token vocabulary of every `axis: "theme"` collection, de-duplicated in declaration order. */
export function themeTokens(r: IdentityRegistries): string[] {
  return tokensForAxis(r.palette.collections, "theme");
}

// ─── validation ──────────────────────────────────────────────────────────────

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Structurally validate an unknown value as `IdentityRegistries`, plus the
 * registry-level business rules: bands ordered/non-overlapping and kebab
 * named, viewport∪mode token disjointness (naming the offending token),
 * a non-empty state list containing `defaultState`, and kebab palette
 * tokens. Unknown/extra fields are tolerated, matching this package's
 * other hand-rolled validators (e.g. `parseStoryFile`).
 */
export function validateIdentityRegistries(
  r: unknown,
): { ok: true; value: IdentityRegistries } | { ok: false; errors: string[] } {
  if (!isObj(r)) {
    return { ok: false, errors: ["registries must be an object"] };
  }

  const errors: string[] = [];
  if (r["version"] !== 1) {
    errors.push('"version" must be 1');
  }

  // breakpoints.bands
  const bandsRaw = isObj(r["breakpoints"]) ? r["breakpoints"]["bands"] : undefined;
  const bands: BreakpointBand[] = [];
  if (!Array.isArray(bandsRaw)) {
    errors.push('"breakpoints.bands" must be an array');
  } else {
    for (const [i, raw] of bandsRaw.entries()) {
      if (
        !isObj(raw) ||
        typeof raw["name"] !== "string" ||
        typeof raw["min"] !== "number" ||
        !(typeof raw["max"] === "number" || raw["max"] === null)
      ) {
        errors.push(`breakpoints.bands[${i}] must be { name: string, min: number, max: number | null }`);
        continue;
      }
      bands.push({ name: raw["name"], min: raw["min"], max: raw["max"] as number | null });
    }
  }

  for (const band of bands) {
    if (!KEBAB_RE.test(band.name)) {
      errors.push(`breakpoint band name "${band.name}" must be kebab-case`);
    }
  }

  for (let i = 0; i < bands.length - 1; i++) {
    const cur = bands[i]!;
    const next = bands[i + 1]!;
    if (cur.min >= next.min) {
      errors.push(
        `breakpoint bands must be ordered ascending by min: "${cur.name}" (min ${cur.min}) is not before "${next.name}" (min ${next.min})`,
      );
      continue;
    }
    if (cur.max === null || cur.max >= next.min) {
      errors.push(`breakpoint bands "${cur.name}" and "${next.name}" overlap`);
    }
  }

  // palette.collections
  const collectionsRaw = isObj(r["palette"]) ? r["palette"]["collections"] : undefined;
  const collections: PaletteCollection[] = [];
  if (!Array.isArray(collectionsRaw)) {
    errors.push('"palette.collections" must be an array');
  } else {
    for (const [i, raw] of collectionsRaw.entries()) {
      if (
        !isObj(raw) ||
        typeof raw["collectionId"] !== "string" ||
        typeof raw["name"] !== "string" ||
        (raw["axis"] !== "mode" && raw["axis"] !== "theme") ||
        !Array.isArray(raw["values"])
      ) {
        errors.push(`palette.collections[${i}] must be { collectionId, name, axis: "mode" | "theme", values }`);
        continue;
      }
      const values: { modeId: string; token: string }[] = [];
      let valuesOk = true;
      for (const [j, v] of (raw["values"] as unknown[]).entries()) {
        if (!isObj(v) || typeof v["modeId"] !== "string" || typeof v["token"] !== "string") {
          errors.push(`palette.collections[${i}].values[${j}] must be { modeId: string, token: string }`);
          valuesOk = false;
          continue;
        }
        values.push({ modeId: v["modeId"], token: v["token"] });
      }
      if (!valuesOk) continue;
      collections.push({
        collectionId: raw["collectionId"],
        name: raw["name"],
        axis: raw["axis"],
        values,
        ...(typeof raw["defaultToken"] === "string" ? { defaultToken: raw["defaultToken"] } : {}),
      });
    }
  }

  for (const collection of collections) {
    for (const { token } of collection.values) {
      if (!KEBAB_RE.test(token)) {
        errors.push(`palette token "${token}" in collection "${collection.name}" must be kebab-case`);
      }
    }
  }

  // states
  const statesRaw = isObj(r["states"]) ? r["states"] : undefined;
  const statesList =
    statesRaw !== undefined && Array.isArray(statesRaw["states"])
      ? (statesRaw["states"] as unknown[]).filter((s): s is string => typeof s === "string")
      : undefined;
  const defaultState =
    statesRaw !== undefined && typeof statesRaw["defaultState"] === "string"
      ? statesRaw["defaultState"]
      : undefined;

  if (statesList === undefined) {
    errors.push('"states.states" must be an array of strings');
  } else if (statesList.length === 0) {
    errors.push('"states.states" must contain at least one state');
  }
  if (defaultState === undefined) {
    errors.push('"states.defaultState" must be a string');
  } else if (statesList !== undefined && !statesList.includes(defaultState)) {
    errors.push(`states.defaultState "${defaultState}" is not present in states.states`);
  }

  // viewport∪mode disjointness — band names vs the union of mode-axis tokens.
  const modeVocab = new Set(tokensForAxis(collections, "mode"));
  for (const band of bands) {
    if (modeVocab.has(band.name)) {
      errors.push(
        `viewport token "${band.name}" collides with a mode token — viewport and mode vocabularies must be disjoint`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      version: 1,
      breakpoints: { bands },
      palette: { collections },
      states: { states: statesList!, defaultState: defaultState! },
    },
  };
}

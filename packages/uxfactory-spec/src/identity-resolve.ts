/**
 * identity-resolve.ts — structural resolution helpers for canonical node
 * identity: width → viewport breakpoint, resolved variable modes → mode/
 * theme axes, prior node name → fallback path label, and variant properties
 * → coordinates. Pure, no I/O — every function here is the deterministic
 * half of node-identity.ts's provenance discipline (a structural fact routes
 * to `derived`; a registry default with no bound signal routes to
 * `defaulted`).
 *
 * Source: .superpowers/sdd/task-6-brief.md and
 * .plans/2026-0717-edwin-node-identity/node-identity-input-provenance.md §4
 * (width→breakpoint, variable-mode→mode+brand axes) and §7 (the degradation
 * ladder: bound → derived, out-of-band width → derived but low-confidence,
 * no signal → defaulted). The mode/brand axis split — never crossed, a dark
 * treatment is `mode`, a brand color is `theme` — is
 * node-identity-interpretation.SKILL.md §A4/§B1.
 */

import {
  type BreakpointBand,
  type Coordinates,
  type IdentityRegistries,
  type PaletteAxis,
  type PaletteCollection,
  type ProvenancedValue,
} from "./node-identity.js";
import { normalizeCoordinateToken, toKebabLabel, type CoordinateAxis } from "./canonical-address.js";

// ─── viewport ───────────────────────────────────────────────────────────────

export interface ViewportResolution {
  token: string;
  provenance: "derived";
  confidence: "high" | "low";
  reasoning: string;
}

function bandLabel(band: BreakpointBand): string {
  return `${band.min}–${band.max === null ? "∞" : band.max}`;
}

/** 0 when `width` is inside `band`'s range; otherwise the distance to its nearer edge. */
function bandDistance(width: number, band: BreakpointBand): number {
  if (width < band.min) return band.min - width;
  if (band.max !== null && width > band.max) return width - band.max;
  return 0;
}

/**
 * Match `width` against the breakpoint registry by range band (provenance
 * doc §4.2) — never exact equality, so a 1440 and a 1280 frame both resolve
 * `desktop`. Inside a band → `derived`/`high`. The default registries are
 * contiguous (0..∞, no gaps), so "outside all bands" only happens with a
 * gapped custom registry; when it does, falls back to the nearest band by
 * range distance, `derived`/`low` — flagged for confirmation rather than
 * silently applied (§7 rung 3).
 */
export function resolveViewport(width: number, r: IdentityRegistries): ViewportResolution {
  const bands = r.breakpoints.bands;
  if (bands.length === 0) {
    throw new Error("resolveViewport: registries define no breakpoint bands");
  }

  for (const band of bands) {
    if (bandDistance(width, band) === 0) {
      return {
        token: band.name,
        provenance: "derived",
        confidence: "high",
        reasoning: `width ${width} is inside the "${band.name}" band (${bandLabel(band)})`,
      };
    }
  }

  let nearest = bands[0]!;
  let nearestDistance = bandDistance(width, nearest);
  for (const band of bands.slice(1)) {
    const distance = bandDistance(width, band);
    if (distance < nearestDistance) {
      nearest = band;
      nearestDistance = distance;
    }
  }

  return {
    token: nearest.name,
    provenance: "derived",
    confidence: "low",
    reasoning: `width ${width} is outside all registered bands; nearest is "${nearest.name}" (${bandLabel(nearest)})`,
  };
}

// ─── mode / theme axes ──────────────────────────────────────────────────────

export interface AxesResolution {
  mode?: ProvenancedValue;
  theme?: ProvenancedValue;
}

/**
 * Resolve one axis ("mode" or "theme") from the collections declared with
 * that axis tag. Bound: the first axis-tagged collection whose resolved
 * mode id (`resolvedModes[collectionId]`) matches one of its `values` wins.
 * Unbound: the first axis-tagged collection with a `defaultToken` wins
 * instead. No axis-tagged collection at all → `undefined` (axis absent).
 */
function resolveOneAxis(
  collections: PaletteCollection[],
  axis: PaletteAxis,
  resolvedModes: Record<string, string>,
): ProvenancedValue | undefined {
  const axisCollections = collections.filter((c) => c.axis === axis);
  if (axisCollections.length === 0) return undefined;

  for (const collection of axisCollections) {
    const modeId = resolvedModes[collection.collectionId];
    if (modeId === undefined) continue;
    const bound = collection.values.find((v) => v.modeId === modeId);
    if (bound !== undefined) {
      return { value: bound.token, provenance: "derived", source: "structure", confidence: "high" };
    }
  }

  for (const collection of axisCollections) {
    if (collection.defaultToken !== undefined) {
      return { value: collection.defaultToken, provenance: "defaulted", source: "registry-default" };
    }
  }

  return undefined;
}

/**
 * Route each palette collection's resolved mode to its declared axis
 * (provenance doc §4.3) — NEVER crossed (SKILL §A4): a `mode`-axis
 * collection can only ever populate the returned `mode`, a `theme`-axis
 * collection only `theme`, by construction (each axis is resolved only from
 * collections filtered to that axis tag). Per collection:
 * `resolvedModes[collectionId]` resolved against that collection's `values`
 * → bound, `derived`/`high`. Unbound (no entry, or the mode id isn't in
 * `values`) but the collection declares a `defaultToken` →
 * `defaulted`/`registry-default` (§7 rung 4). No collection declared for an
 * axis → that axis is absent from the result (the key itself is omitted,
 * not present with an `undefined` value).
 */
export function resolveAxesFromModes(
  resolvedModes: Record<string, string>,
  r: IdentityRegistries,
): AxesResolution {
  const mode = resolveOneAxis(r.palette.collections, "mode", resolvedModes);
  const theme = resolveOneAxis(r.palette.collections, "theme", resolvedModes);
  return {
    ...(mode !== undefined ? { mode } : {}),
    ...(theme !== undefined ? { theme } : {}),
  };
}

// ─── fallback label ─────────────────────────────────────────────────────────

export interface FallbackLabelResolution {
  label: string;
  provenance: "inferred";
  source: "prior-name";
  reasoning: string;
}

/** lowercase, non-alphanumeric runs → single "-", trim leading/trailing "-". No length cap (unlike component role-name kebabing) — this is a path label, not a role name. */
function kebabCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * A kebab segment that is itself *viewport*-resolvable — a breakpoint band
 * name or a viewport device synonym. Reuses `normalizeCoordinateToken` so
 * this can never drift from the viewport registry/synonym table maintained
 * in canonical-address.ts.
 *
 * Deliberately does NOT check mode/theme: viewport is the actual
 * responsive-family suffix (a presentation variant of one semantic thing —
 * "Hero Section: Desktop" and "Hero Section: Ipad version" are the *same*
 * section), so stripping it is safe. Mode/theme are not — a section can be
 * legitimately *named* for its brand or mode (grammar §7's "Discover
 * Students" section keeps "students" in its label AND separately carries
 * `@theme=students`; the redundancy is intended, not noise). Stripping a
 * brand/mode token here would corrupt section identity — two differently
 * *named* sections (`discover-schools`, `discover-students`) would collapse
 * onto the same label the moment "schools"/"students" also happen to be
 * registered theme tokens, which is exactly the section-membership-from-
 * brand inference `node-identity-interpretation.SKILL.md` §D forbids. An
 * occasionally-redundant label (`hero-dark@dark`) is cosmetic; a corrupted,
 * colliding label is a correctness failure — so this errs conservative.
 */
function isCoordinateNoise(segment: string, r: IdentityRegistries): boolean {
  if (segment === "version") return true;
  if (normalizeCoordinateToken("viewport", segment, r) !== null) return true;
  return false;
}

/**
 * The path-label fallback when vision is unavailable or declines to name a
 * node (provenance doc §3's "path label … falls back to prior name" row) —
 * `Inferred`, not `Derived`, since a prior name is a human's old guess, not
 * a structural fact. Kebabs `currentName`, then strips every segment that is
 * itself viewport-resolvable (see `isCoordinateNoise`) plus the noise word
 * "version" — those belong in `coordinates`, not the path label. Mode/theme
 * tokens are deliberately KEPT (see `isCoordinateNoise`). Empty after
 * stripping → the lowercased `kind` ("FRAME" → "frame").
 *
 * Post-review fix (must-fix #1): the surviving segments are re-kebabbed
 * through `toKebabLabel`, not just joined — a plain `kebabCase` join can
 * still produce a `LABEL_RE`-invalid, digit-leading label ("404 Page" →
 * "404-page"), which is used UNMODIFIED as a path segment in
 * `identity-assemble.ts` and would throw the whole manifest assembly in
 * `serializeAddress`. When `toKebabLabel` rejects the joined candidate (only
 * possible via a leading digit — see `kebabCase` for why every other
 * `LABEL_RE` failure mode is already structurally impossible here), this
 * falls back to the lowercased `kind`, same as the empty-after-stripping
 * case below — a `kind` like "frame"/"instance" is always `LABEL_RE`-valid.
 */
export function deriveFallbackLabel(
  currentName: string,
  kind: string,
  r: IdentityRegistries,
): FallbackLabelResolution {
  const segments = kebabCase(currentName)
    .split("-")
    .filter((s) => s.length > 0);
  const stripped: string[] = [];
  const kept = segments.filter((segment) => {
    if (isCoordinateNoise(segment, r)) {
      stripped.push(segment);
      return false;
    }
    return true;
  });
  const strippedList = stripped.map((s) => `"${s}"`).join(", ");
  const strippedNote = stripped.length > 0 ? `, stripping coordinate token(s) ${strippedList}` : "";

  if (kept.length > 0) {
    const joined = kept.join("-");
    const label = toKebabLabel(joined);
    if (label !== "") {
      return {
        label,
        provenance: "inferred",
        source: "prior-name",
        reasoning: `kebabbed prior name "${currentName}"${strippedNote}`,
      };
    }
    return {
      label: kind.toLowerCase(),
      provenance: "inferred",
      source: "prior-name",
      reasoning: `kebabbed prior name "${currentName}"${strippedNote} produced "${joined}", which is not a valid path label (must start with a letter) — fell back to kind "${kind}"`,
    };
  }

  return {
    label: kind.toLowerCase(),
    provenance: "inferred",
    source: "prior-name",
    reasoning: `prior name "${currentName}" had no content left after stripping coordinate token(s) ${strippedList}; fell back to kind "${kind}"`,
  };
}

// ─── variant-prop coordinates ───────────────────────────────────────────────

/** Case-insensitive variant-property key → coordinate axis, including the "Breakpoint" synonym for viewport. */
const VARIANT_PROP_AXIS: Record<string, CoordinateAxis> = {
  viewport: "viewport",
  breakpoint: "viewport",
  mode: "mode",
  theme: "theme",
  state: "state",
};

/**
 * Component variant properties (Figma's native per-instance axis, e.g. a
 * `Viewport=Desktop, State=Hover` variant set) as `Coordinates` — the
 * "storage: variant properties" half of the naming grammar's coordinate
 * model (SKILL §B3). Keys are matched case-insensitively against
 * `viewport`/`mode`/`theme`/`state`, plus the synonym `breakpoint` →
 * `viewport`; values normalize via `normalizeCoordinateToken` (reused, not
 * reimplemented, so viewport device synonyms and registry membership stay
 * in one place). A key that doesn't match one of the four axes, or a value
 * that doesn't normalize into that axis's registry, is skipped — never
 * partially or speculatively populated.
 */
export function coordinatesFromVariantProps(
  props: Record<string, string>,
  r: IdentityRegistries,
): Partial<Coordinates> {
  const result: Partial<Coordinates> = {};
  for (const [rawKey, rawValue] of Object.entries(props)) {
    const axis = VARIANT_PROP_AXIS[rawKey.toLowerCase()];
    if (axis === undefined) continue;
    const token = normalizeCoordinateToken(axis, rawValue, r);
    if (token === null) continue;
    result[axis] = { value: token, provenance: "derived", source: "structure", confidence: "high" };
  }
  return result;
}

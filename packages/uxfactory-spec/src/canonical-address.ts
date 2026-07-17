/**
 * canonical-address.ts — serialize / parse / normalize for the canonical
 * node address grammar (e.g. `home/hero@desktop@theme=students`).
 *
 * Source: .superpowers/sdd/task-5-brief.md and
 * .plans/2026-0717-edwin-node-identity/node-identity-naming-grammar.md §3–§5
 * (EBNF), which this module implements exactly. Pure, no I/O — a
 * `CanonicalAddress` is the structured form; `serializeAddress` renders it to
 * the address string, `parseAddress` is its inverse, and
 * `normalizeCoordinateToken` maps loose input tokens (device names, casing)
 * onto a registry token for one axis.
 *
 * Path: `label[#ordinal]` segments joined by `/`; the ordinal suffix appears
 * only on sibling label collision (§2.4), never on a lone node.
 *
 * Coordinates: four axes (`viewport`, `mode`, `theme`, `state`), each
 * introduced by an `@` sigil, order-independent, at most one per axis (§3.2,
 * §4). `viewport`/`mode` serialize keyless (`@desktop`, `@dark`) because
 * their registries are disjoint (guaranteed by node-identity.ts's
 * `validateIdentityRegistries`) and a bare token resolves to an axis by
 * registry membership; `theme`/`state` serialize keyed (`@theme=students`,
 * `@state=hover`) because their vocabularies are project-defined and can
 * collide. The keyed form is also accepted as tolerant input for
 * viewport/mode and normalizes to keyless on re-serialize. A coordinate at
 * its axis's registry default is omitted on serialize — except `viewport`,
 * which has no default and is always rendered when present (§3.3).
 */

import {
  modeTokens,
  themeTokens,
  REGISTRY_TOKEN_RE,
  type IdentityRegistries,
  type PaletteAxis,
} from "./node-identity.js";

// ─── types ──────────────────────────────────────────────────────────────────

export type CoordinateAxis = "viewport" | "mode" | "theme" | "state";

export interface AddressCoordinates {
  viewport?: string;
  mode?: string;
  theme?: string;
  state?: string;
}

export interface CanonicalAddress {
  path: { label: string; ordinal?: number }[];
  coordinates: AddressCoordinates;
}

export type ParseAddressResult =
  | { ok: true; value: CanonicalAddress }
  | { ok: false; error: string };

// ─── grammar tokens (EBNF §5) ───────────────────────────────────────────────

/** `kebab-token` (§5) with constraint 1 (no leading/trailing/double hyphen), lowercase only. */
const LABEL_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * `registry-token` (§5) — lowercase alphanumeric, no hyphens; coordinate
 * values only. Imported from node-identity.ts, which enforces this same
 * charset on the registries themselves (`validateIdentityRegistries`), so
 * there is exactly one definition of "a valid coordinate value" shared by
 * both the registry boundary and the address grammar.
 */
const VALUE_RE = REGISTRY_TOKEN_RE;

const ORDINAL_RE = /^[0-9]+$/;

const AXIS_KEYS: readonly CoordinateAxis[] = ["viewport", "mode", "theme", "state"];

// ─── registry lookups ────────────────────────────────────────────────────────

function isViewportMember(r: IdentityRegistries, value: string): boolean {
  return r.breakpoints.bands.some((b) => b.name === value);
}

function isAxisMember(axis: CoordinateAxis, value: string, r: IdentityRegistries): boolean {
  switch (axis) {
    case "viewport":
      return isViewportMember(r, value);
    case "mode":
      return modeTokens(r).includes(value);
    case "theme":
      return themeTokens(r).includes(value);
    case "state":
      return r.states.states.includes(value);
  }
}

/**
 * The registry default for one axis, if one is defined — `PaletteCollection
 * .defaultToken` on the (first, declaration-order) collection tagged with
 * that axis for `mode`/`theme`, `StateRegistry.defaultState` for `state`.
 * `viewport` has no registry default (§3.3) and always returns `undefined`.
 */
function registryDefault(axis: "mode" | "theme" | "state", r: IdentityRegistries): string | undefined {
  if (axis === "state") return r.states.defaultState;
  const paletteAxis: PaletteAxis = axis;
  for (const collection of r.palette.collections) {
    if (collection.axis === paletteAxis && collection.defaultToken !== undefined) {
      return collection.defaultToken;
    }
  }
  return undefined;
}

// ─── serialize ───────────────────────────────────────────────────────────────

/**
 * Render a `CanonicalAddress` to its canonical string form. Path segments
 * join on `/`, with an `#ordinal` suffix only when `ordinal >= 2` (a lone
 * node, or one erroneously carrying `ordinal: 1`, renders with no suffix).
 * `viewport` and `mode` render keyless (`@desktop`); `theme` and `state`
 * render keyed (`@theme=students`). `mode`/`theme`/`state` coordinates equal
 * to their axis's registry default are dropped; `viewport` is always
 * rendered when present, since it has no default (§3.3).
 *
 * Throws if `a` contains a label or coordinate value that violates the
 * grammar's own charset rules (kebab-token for labels, registry-token for
 * coordinate values) — emitting such a string would silently produce
 * output `parseAddress` itself rejects, breaking the serialize/parse
 * round-trip invariant the whole grammar rests on. A `CanonicalAddress`
 * this malformed can only arise by hand-construction or a bad upstream
 * registry (Fix A closes that second path at `validateIdentityRegistries`),
 * so this is a programming-error invariant break, not a recoverable input
 * — hence throw rather than a `Result` return.
 */
export function serializeAddress(a: CanonicalAddress, r: IdentityRegistries): string {
  for (const seg of a.path) {
    if (!LABEL_RE.test(seg.label)) {
      throw new Error(
        `serializeAddress: invalid path label "${seg.label}" — labels must be lowercase kebab-case with no leading, trailing, or double hyphen`,
      );
    }
  }
  for (const axis of AXIS_KEYS) {
    const value = a.coordinates[axis];
    if (value !== undefined && !VALUE_RE.test(value)) {
      throw new Error(
        `serializeAddress: invalid ${axis} coordinate value "${value}" — must be a hyphen-free lowercase alphanumeric token (matches /^[a-z][a-z0-9]*$/)`,
      );
    }
  }

  const path = a.path
    .map((seg) => (seg.ordinal !== undefined && seg.ordinal >= 2 ? `${seg.label}#${seg.ordinal}` : seg.label))
    .join("/");

  const parts: string[] = [];

  if (a.coordinates.viewport !== undefined) {
    parts.push(`@${a.coordinates.viewport}`);
  }
  if (a.coordinates.mode !== undefined && a.coordinates.mode !== registryDefault("mode", r)) {
    parts.push(`@${a.coordinates.mode}`);
  }
  if (a.coordinates.theme !== undefined && a.coordinates.theme !== registryDefault("theme", r)) {
    parts.push(`@theme=${a.coordinates.theme}`);
  }
  if (a.coordinates.state !== undefined && a.coordinates.state !== registryDefault("state", r)) {
    parts.push(`@state=${a.coordinates.state}`);
  }

  return path + parts.join("");
}

// ─── parse ───────────────────────────────────────────────────────────────────

function duplicateAxisError(axis: CoordinateAxis): { ok: false; error: string } {
  return { ok: false, error: `duplicate coordinate axis "${axis}" — each axis may appear at most once` };
}

/** Which keyed form a keyless token needs, when it belongs to a keyed-only axis — for a useful error. */
function keyedHintFor(rest: string, r: IdentityRegistries): string | null {
  if (themeTokens(r).includes(rest)) {
    return `"@${rest}" is a theme token and must be written keyed as "@theme=${rest}"`;
  }
  if (r.states.states.includes(rest)) {
    return `"@${rest}" is a state token and must be written keyed as "@state=${rest}"`;
  }
  return null;
}

/**
 * Parse a canonical address string against `r`. Keyless coordinate tokens
 * (`@desktop`) resolve to `viewport` or `mode` by registry membership —
 * disjointness of those two registries is guaranteed upstream by
 * `validateIdentityRegistries`. Keyed tokens (`@axis=value`) are accepted
 * for all four axes, validated against that axis's registry, and — for
 * `viewport`/`mode` — normalize into the same keyless coordinate slot
 * (re-serializing drops the key). Duplicate axes, malformed labels/ordinals,
 * and unknown tokens fail with a message naming the offending text.
 */
export function parseAddress(s: string, r: IdentityRegistries): ParseAddressResult {
  if (typeof s !== "string" || s.length === 0) {
    return { ok: false, error: "address must be a non-empty string" };
  }

  const atIndex = s.indexOf("@");
  const pathPart = atIndex === -1 ? s : s.slice(0, atIndex);
  const coordsPart = atIndex === -1 ? "" : s.slice(atIndex);

  if (pathPart === "") {
    return { ok: false, error: `address "${s}" has no path — a canonical address needs at least one label before any coordinates` };
  }

  // path
  const path: { label: string; ordinal?: number }[] = [];
  for (const segment of pathPart.split("/")) {
    const hashIndex = segment.indexOf("#");
    const labelRaw = hashIndex === -1 ? segment : segment.slice(0, hashIndex);
    const ordinalRaw = hashIndex === -1 ? undefined : segment.slice(hashIndex + 1);

    if (!LABEL_RE.test(labelRaw)) {
      return {
        ok: false,
        error: `invalid path label "${labelRaw}" — labels must be lowercase kebab-case with no leading, trailing, or double hyphen`,
      };
    }

    if (ordinalRaw === undefined) {
      path.push({ label: labelRaw });
      continue;
    }
    if (!ORDINAL_RE.test(ordinalRaw)) {
      return { ok: false, error: `invalid ordinal "#${ordinalRaw}" on label "${labelRaw}" — must be a positive integer` };
    }
    const ordinal = Number(ordinalRaw);
    if (ordinal < 2) {
      return {
        ok: false,
        error: `ordinal suffix on "${labelRaw}" must be 2 or greater (a lone node carries no ordinal), got "#${ordinal}"`,
      };
    }
    path.push({ label: labelRaw, ordinal });
  }

  // coordinates
  const coordinates: AddressCoordinates = {};
  if (coordsPart.length > 0) {
    const tokens = coordsPart.split(/(?=@)/).filter((t) => t.length > 0);
    for (const token of tokens) {
      const rest = token.slice(1); // drop the leading "@"
      if (rest === "") {
        return { ok: false, error: `empty coordinate ("@" with no value) in "${s}"` };
      }

      const eqIndex = rest.indexOf("=");
      if (eqIndex === -1) {
        // keyless form — permitted only for viewport/mode, resolved by registry membership.
        if (!VALUE_RE.test(rest)) {
          return { ok: false, error: `invalid coordinate token "@${rest}" — must be lowercase alphanumeric` };
        }
        if (isViewportMember(r, rest)) {
          if (coordinates.viewport !== undefined) return duplicateAxisError("viewport");
          coordinates.viewport = rest;
        } else if (modeTokens(r).includes(rest)) {
          if (coordinates.mode !== undefined) return duplicateAxisError("mode");
          coordinates.mode = rest;
        } else {
          const hint = keyedHintFor(rest, r);
          if (hint !== null) return { ok: false, error: hint };
          return {
            ok: false,
            error: `unknown coordinate token "@${rest}" — not a registered viewport or mode value`,
          };
        }
        continue;
      }

      // keyed form — accepted for all four axes.
      const axisKey = rest.slice(0, eqIndex);
      const value = rest.slice(eqIndex + 1);
      if (!(AXIS_KEYS as readonly string[]).includes(axisKey)) {
        return { ok: false, error: `unknown coordinate axis "${axisKey}" in "@${rest}" — expected one of ${AXIS_KEYS.join(", ")}` };
      }
      if (!VALUE_RE.test(value)) {
        return { ok: false, error: `invalid value "${value}" for coordinate "${axisKey}" — must be lowercase alphanumeric` };
      }
      const axis = axisKey as CoordinateAxis;
      if (!isAxisMember(axis, value, r)) {
        return { ok: false, error: `"${value}" is not a registered ${axis} value` };
      }
      if (coordinates[axis] !== undefined) return duplicateAxisError(axis);
      coordinates[axis] = value;
    }
  }

  return { ok: true, value: { path, coordinates } };
}

// ─── normalize ───────────────────────────────────────────────────────────────

const VIEWPORT_SYNONYMS: Record<string, string> = {
  ipad: "tablet",
  iphone: "mobile",
  phone: "mobile",
  desktop: "desktop",
  web: "desktop",
};

/**
 * Normalize one loose input token to a registry token for `axis`, or `null`
 * when it doesn't resolve. Lowercases first. `viewport` additionally maps
 * device synonyms (`ipad`→`tablet`, `iphone`/`phone`→`mobile`,
 * `desktop`/`web`→`desktop`) before the registry membership check;
 * `mode`/`theme`/`state` are registry membership only, no synonyms.
 */
export function normalizeCoordinateToken(
  axis: CoordinateAxis,
  token: string,
  r: IdentityRegistries,
): string | null {
  const lower = token.toLowerCase();

  if (axis === "viewport") {
    const candidate = VIEWPORT_SYNONYMS[lower] ?? lower;
    return isViewportMember(r, candidate) ? candidate : null;
  }
  return isAxisMember(axis, lower, r) ? lower : null;
}

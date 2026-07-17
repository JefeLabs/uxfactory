/**
 * identity-assemble.ts — turns an `IdentityExtraction` + registries +
 * component registry (+ an optional prior manifest) into
 * `NodeIdentityRecord[]`: the convergence point of the naming grammar. Pure,
 * no I/O — every structural judgment reuses `identity-resolve.ts` /
 * `canonical-address.ts` rather than re-deriving it.
 *
 * Source: .superpowers/sdd/task-7-brief.md and the three design docs it
 * cites (`.plans/2026-0717-edwin-node-identity/`):
 * `node-identity-naming-grammar.md` (§0.1 first-discriminating-tier, §2
 * path/labels/ordinals, §3 coordinates, §6 record shape, §7 worked
 * examples), `node-identity-input-provenance.md` (§3 segment→provenance),
 * `node-identity-interpretation.SKILL.md` (§B procedure, §C
 * resolutionStatus).
 *
 * The seven assembly rules, briefly (full detail in the brief):
 *  1. Scope & page tier (§0.1) — pageCount===1 puts the page slug in
 *     `scope`; pageCount>1 makes it the first path segment of every record.
 *  2. Per-node label resolution (registry-bound instance / unregistered
 *     instance / component definition / composed fallback), plus the
 *     prior-manifest override for confirmed/elicited composed labels.
 *  3. Path = parent's path + own label (parent-before-child extraction
 *     order guarantees the parent record already exists).
 *  4. Sibling ordinals on address collision (§2.4) — see the note on
 *     `siblingKey` below for why this is *(label, coordinates)*, not just
 *     *(label)*.
 *  5. Coordinates — viewport resolved at page children, inherited by
 *     descendants (or overridden by a variant prop); mode/theme via
 *     `resolveAxesFromModes`; state from variant props only, never
 *     defaulted; plus, per axis, the SAME prior-manifest override as rule 2
 *     (Task 7b) — a confirmed/elicited prior coordinate survives
 *     re-derivation instead of being silently recomputed.
 *  6. Address + record fields (`serializeAddress`, `pathRoleDefault`,
 *     `composition`, prior `appliedAddress`/`appliedAt` carry-forward).
 *  7. `reasoning` — a teaching-surface string per record, composed from the
 *     underlying resolvers' own reasoning plus notes for anything
 *     non-trivial (inheritance, defaulting, ordinal collision, override).
 *
 * Two rule interactions the brief left implicit, resolved here (documented
 * again at point of use, and in the task report):
 *
 * - **Ordinal collision is scoped to (parent, label, coordinates), not just
 *   (parent, label).** The brief's own worked example requires this: the
 *   same-page "Hero Section: Desktop" / "Hero Section: Ipad version" frames
 *   both resolve the label "hero-section" and share a parent (the page
 *   root), yet the must-cover fixture asserts *neither* carries an ordinal
 *   (`home/hero-section@desktop`, `home/hero-section@tablet`) — because
 *   `viewport` is always part of the address, the two are already
 *   unambiguous without one. The three same-viewport "card" instances *do*
 *   collide (same label, same coordinates) and get `#2`/`#3`. Ordinals
 *   exist to keep the *rendered address* unique (grammar §2.4), so
 *   collision is address-shaped, not label-shaped.
 * - **`matchability`/`resolutionStatus`/`definitionRef` on cases the brief's
 *   rule 2 doesn't spell out for every case (unregistered instance,
 *   component definitions).** See `resolveLabel` below for the reasoning
 *   applied to each.
 */

import {
  type ComponentRegistry,
  type ComponentTypeEntry,
  type Coordinates,
  type ExtractedNode,
  type IdentityExtraction,
  type IdentityRegistries,
  type Matchability,
  type NodeIdentityRecord,
  type NodeManifest,
  type PathSegment,
  type Provenance,
  type ProvenancedValue,
} from "./node-identity.js";
import {
  serializeAddress,
  toKebabLabel,
  registryDefault,
  type AddressCoordinates,
  type CanonicalAddress,
} from "./canonical-address.js";
import { resolveViewport, resolveAxesFromModes, deriveFallbackLabel, coordinatesFromVariantProps } from "./identity-resolve.js";

// ─── small local helpers ────────────────────────────────────────────────────

/**
 * lowercase, non-alphanumeric runs -> single "-", trim ends. No length cap.
 * Used only as the pre-kebab step for the page-tier label below
 * (`resolvePageTier`), which then funnels the result through `toKebabLabel`
 * (must-fix #1) so a page named with a leading digit (e.g. "404 Prototypes")
 * can never produce a `LABEL_RE`-invalid `pageSegment.label` — that used to
 * throw in `serializeAddress` and abort the whole manifest on any multi-page
 * project with such a page name. `kebabComponentName` below independently
 * uses the guaranteed-valid `toKebabLabel` for the same reason.
 */
function kebab(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * Strip everything from the first variant-syntax delimiter ("/", ",", "=")
 * onward, mirroring Task 3's `harvestComponents` roleName derivation
 * (`identity-extract.ts`) — "Button/Primary" -> "Button", "Size=Large" ->
 * "Size". Applied before kebabbing a component/instance name that isn't
 * already a resolved registry `roleName`.
 */
function stripVariantSyntax(name: string): string {
  const match = /[/,=]/.exec(name);
  return match ? name.slice(0, match.index) : name;
}

/**
 * Kebab of a component/main-component name, stripped of variant syntax
 * first; falls back to "component" if nothing survives. Uses `toKebabLabel`
 * (not a plain kebab-case transform) so the result is GUARANTEED
 * `LABEL_RE`-valid — a plain kebab of e.g. "3D Card" would produce
 * "3d-card", which still fails the grammar's leading-letter constraint and
 * would throw in `serializeAddress` below. "component" itself is a valid
 * label, so the fallback never needs its own re-check.
 */
function kebabComponentName(name: string): string {
  const slug = toKebabLabel(stripVariantSyntax(name));
  return slug === "" ? "component" : slug;
}

// ─── §1: scope & page tier ──────────────────────────────────────────────────

interface PageTier {
  /** `scope` field for every record — the page slug, iff it's an ambient singleton (pageCount === 1). */
  scope: string[];
  /** The page's own path segment, prepended to every record's path, iff the page forks (pageCount > 1). */
  pageSegment: PathSegment | null;
}

function resolvePageTier(extraction: IdentityExtraction): PageTier {
  // Must-fix #1: a plain `kebab` of a digit-leading page name ("404 Page" ->
  // "404-page") is not `LABEL_RE`-valid and would throw in `serializeAddress`
  // below (pageCount > 1 makes this the FIRST path segment of every record —
  // one bad page name aborts the entire manifest). Funnel through
  // `toKebabLabel`; fall back to the safe constant "page" when nothing valid
  // survives, same shape as the pre-existing empty-name fallback.
  const pageLabel = toKebabLabel(kebab(extraction.page.name)) || "page";
  if (extraction.pageCount === 1) {
    return { scope: [pageLabel], pageSegment: null };
  }
  return {
    scope: [],
    pageSegment: { label: pageLabel, provenance: "derived", source: "structure" },
  };
}

// ─── §2: label resolution ───────────────────────────────────────────────────

interface LabelResolution {
  label: string;
  provenance: Provenance;
  source?: ProvenancedValue["source"];
  confirmed?: boolean;
  reasoning: string;
  matchability?: Matchability;
  resolutionStatus?: "bound" | "drifted" | "custom";
  definitionRef?: string;
  codeBinding?: string;
}

function findComponentEntry(components: ComponentRegistry, key: string): ComponentTypeEntry | undefined {
  return components.components.find((c) => c.key === key);
}

/**
 * A prior record's last path segment, when it's eligible to override a
 * freshly-*inferred* label (rule 2's "prior-manifest override"): `confirmed:
 * true` or `provenance: "elicited"`. Only ever consulted for the composed
 * (inferred-label) case — "Derived labels ALWAYS recompute" (rule 2) means
 * this is never consulted for instance/definition labels, however
 * confirmed the prior record.
 */
function priorOverrideSegment(durableId: string, prior: NodeManifest | undefined): PathSegment | null {
  if (!prior) return null;
  const priorRecord = prior.records[durableId];
  if (!priorRecord) return null;
  const last = priorRecord.path[priorRecord.path.length - 1];
  if (!last) return null;
  if (last.confirmed === true || last.provenance === "elicited") return last;
  return null;
}

/**
 * Resolve one node's own label (rule 2). Four cases, in priority order:
 *
 * 1. `INSTANCE` with a `mainComponent` whose key is in `components` —
 *    derived, source "registry", `resolutionStatus: "bound"`,
 *    `matchability: "matchable"`, `definitionRef`/`codeBinding` from the
 *    entry.
 * 2. `INSTANCE` with a `mainComponent` key NOT in `components` ("unregistered")
 *    — same derived/bound/matchable treatment (structure still tells us
 *    it's a bound instance of *something*), but the label comes from
 *    kebabbing the main component's own name and there's no `definitionRef`
 *    to point at.
 * 3. `COMPONENT`/`COMPONENT_SET` — a definition. `ExtractedNode` carries no
 *    field for "this definition's own registry key" (a gap in the frozen
 *    Task 1 types), so the only structurally-available match is
 *    `entry.key === node.figmaNodeId` — exactly the fallback key
 *    `harvestComponents` (Task 3) assigns local, non-remote definitions
 *    (`node.componentKey ?? node.id`) when no real Figma component key was
 *    wired through. Falls back to a kebabbed, variant-syntax-stripped
 *    `currentName` when unmatched.
 * 4. Everything else ("composed") — `deriveFallbackLabel`, inferred,
 *    source "prior-name" — subject to the prior-manifest override above.
 */
function resolveLabel(
  node: ExtractedNode,
  registries: IdentityRegistries,
  components: ComponentRegistry,
  prior: NodeManifest | undefined,
): LabelResolution {
  // Case 1 & 2: bound instance.
  if (node.kind === "INSTANCE" && node.mainComponent !== null) {
    const mc = node.mainComponent;
    const entry = findComponentEntry(components, mc.key);
    if (entry !== undefined) {
      // Post-review fix (parity with the proposals-merge route): entry.roleName
      // is a REGISTERED value, potentially written before the component-registry
      // PUT boundary started enforcing LABEL_RE (legacy data), or hand-edited on
      // disk. Normalize it the same way; a roleName that normalizes to nothing
      // usable falls back to the instance's own name rather than emitting an
      // invalid/empty label that would throw in serializeAddress downstream.
      const normalizedRoleName = toKebabLabel(entry.roleName);
      const label = normalizedRoleName !== "" ? normalizedRoleName : kebabComponentName(mc.name);
      return {
        label,
        provenance: "derived",
        source: "registry",
        reasoning:
          normalizedRoleName !== ""
            ? `label "${label}" derived from bound instance of "${mc.name}"`
            : `label "${label}" derived from bound instance of "${mc.name}" (registry roleName "${entry.roleName}" is not a valid kebab label — fell back to the instance name)`,
        matchability: "matchable",
        resolutionStatus: "bound",
        definitionRef: entry.key,
        ...(entry.codeBinding !== undefined ? { codeBinding: entry.codeBinding } : {}),
      };
    }
    const label = kebabComponentName(mc.name);
    return {
      label,
      provenance: "derived",
      source: "structure",
      reasoning: `label "${label}" derived from bound instance of "${mc.name}" (unregistered — no component-registry entry for key "${mc.key}")`,
      matchability: "matchable",
      resolutionStatus: "bound",
    };
  }

  // Case 3: component definition.
  if (node.kind === "COMPONENT" || node.kind === "COMPONENT_SET") {
    const entry = findComponentEntry(components, node.figmaNodeId);
    if (entry !== undefined) {
      // Same legacy-roleName guard as case 1 above.
      const normalizedRoleName = toKebabLabel(entry.roleName);
      const label = normalizedRoleName !== "" ? normalizedRoleName : kebabComponentName(node.currentName);
      return {
        label,
        provenance: "derived",
        source: "registry",
        reasoning:
          normalizedRoleName !== ""
            ? `label "${label}" derived from component definition "${node.currentName}"`
            : `label "${label}" derived from component definition "${node.currentName}" (registry roleName "${entry.roleName}" is not a valid kebab label — fell back to the definition name)`,
        matchability: "matchable",
        definitionRef: entry.key,
        ...(entry.codeBinding !== undefined ? { codeBinding: entry.codeBinding } : {}),
      };
    }
    const label = kebabComponentName(node.currentName);
    return {
      label,
      provenance: "derived",
      source: "structure",
      reasoning: `label "${label}" derived by kebab-casing component definition name "${node.currentName}", stripped of variant syntax`,
      matchability: "matchable",
    };
  }

  // Case 4: composed — the fallback population Phase 3 vision replaces.
  const override = priorOverrideSegment(node.durableId, prior);
  if (override !== null) {
    return {
      label: override.label,
      provenance: override.provenance,
      ...(override.source !== undefined ? { source: override.source } : {}),
      ...(override.confirmed !== undefined ? { confirmed: override.confirmed } : {}),
      reasoning: `kept prior label "${override.label}" (${override.provenance}${override.confirmed ? ", confirmed" : ""}) from the manifest instead of re-deriving`,
      matchability: "composed",
    };
  }
  const fresh = deriveFallbackLabel(node.currentName, node.kind, registries);
  return {
    label: fresh.label,
    provenance: fresh.provenance,
    source: fresh.source,
    reasoning: fresh.reasoning,
    matchability: "composed",
  };
}

// ─── §4: sibling ordinals ───────────────────────────────────────────────────

/**
 * A stable string key for a resolved coordinate vector — collision grouping
 * needs to compare vectors, not object identity.
 *
 * Post-review fix (must-fix #2): keyed on the ADDRESS-RENDERED vector, not
 * the raw one. `serializeAddress` OMITS any mode/theme/state coordinate that
 * equals its axis's registry default (canonical-address.ts), so two siblings
 * — one with e.g. `state` explicitly set to the default value, one with no
 * `state` at all — render byte-identical addresses but used to key
 * DIFFERENTLY here, so neither got an ordinal and the rendered addresses
 * collided undetected. Dropping default-valued mode/theme/state coordinates
 * before hashing (mirroring `registryDefault`, the exact predicate
 * `serializeAddress` itself uses) makes two siblings collide here IFF their
 * rendered addresses would collide. `viewport` has no registry default
 * (§3.3) and is never dropped.
 */
function coordinateKey(c: Coordinates, r: IdentityRegistries): string {
  const axisKey = (axis: "mode" | "theme" | "state", value: string | undefined): string => {
    if (value === undefined || value === registryDefault(axis, r)) return "";
    return value;
  };
  return [c.viewport?.value ?? "", axisKey("mode", c.mode?.value), axisKey("theme", c.theme?.value), axisKey("state", c.state?.value)].join(
    "|",
  );
}

// ─── §5: coordinates ────────────────────────────────────────────────────────

interface CoordinateResolution {
  coordinates: Coordinates;
  reasoningParts: string[];
}

function axisReasoningNote(axisName: string, pv: ProvenancedValue): string {
  if (pv.provenance === "derived") return `${axisName} "${pv.value}" resolved from a bound variable mode`;
  if (pv.provenance === "defaulted") return `${axisName} "${pv.value}" defaulted (no bound signal)`;
  return `${axisName} "${pv.value}" (${pv.provenance})`;
}

/**
 * A prior record's coordinate on one axis, when it's eligible to override a
 * freshly-*derived* coordinate — the SAME predicate `priorOverrideSegment`
 * (above) applies to labels, applied per coordinate axis instead of to the
 * path's last segment: `confirmed: true` (an inferred coordinate the user
 * ratified via the confirm gate) or provenance `"elicited"` (the user
 * replaced/created the coordinate outright via override — see the bridge's
 * `POST /project/identity/confirm` route, `applyConfirmation`). A prior
 * derived/defaulted coordinate is NOT preserved — like an unconfirmed
 * inferred label, it recomputes fresh on every extraction pass.
 */
function priorOverrideCoordinate(
  durableId: string,
  axis: keyof Coordinates,
  prior: NodeManifest | undefined,
): ProvenancedValue | null {
  if (!prior) return null;
  const priorRecord = prior.records[durableId];
  if (!priorRecord) return null;
  const priorValue = priorRecord.coordinates[axis];
  if (!priorValue) return null;
  if (priorValue.confirmed === true || priorValue.provenance === "elicited") return priorValue;
  return null;
}

/** Reasoning note for a preserved coordinate — mirrors `resolveLabel`'s override reasoning line for labels. */
function priorOverrideCoordinateReasoning(axisName: string, pv: ProvenancedValue): string {
  return `kept prior ${axisName} "${pv.value}" (${pv.provenance}${pv.confirmed ? ", confirmed" : ""}) from the manifest instead of re-deriving`;
}

/**
 * Resolve one node's coordinates (rule 5). Viewport: a variant prop wins
 * outright; else page children resolve from width (`resolveViewport`); else
 * descendants inherit the parent's already-resolved viewport value
 * (reasoning names it "inherited from root frame" per the brief). Mode/
 * theme: `resolveAxesFromModes` on the node's own `resolvedModes` (Figma
 * has already resolved inheritance into that map — no manual propagation
 * needed), overridden by a variant prop when present. State: variant prop
 * only — never defaulted (no `resolveState` helper exists; §3.3's
 * omission-at-default is enforced by `serializeAddress` for mode/theme, but
 * state has no registry-default-fill path at all, so it's simply absent
 * when no variant prop supplies it).
 *
 * LAST, per axis: `priorOverrideCoordinate` — a confirmed-inferred or
 * elicited prior coordinate on this durableId's axis SURVIVES re-derivation,
 * symmetric with rule 2's label override (`priorOverrideSegment`). This
 * wins over every fresh-derivation path above (variant prop included) — a
 * user's confirm/override gate outranks structure, exactly as it does for
 * labels. A preserved viewport also propagates to descendants via
 * `parentCoordinates`, since callers store this function's returned
 * `coordinates` (post-override) before resolving children.
 */
function resolveCoordinatesForNode(
  node: ExtractedNode,
  parentCoordinates: Coordinates | undefined,
  registries: IdentityRegistries,
  prior: NodeManifest | undefined,
): CoordinateResolution {
  const variantCoords = node.variantProperties ? coordinatesFromVariantProps(node.variantProperties, registries) : {};

  let viewport: ProvenancedValue | undefined;
  let viewportReasoning: string | undefined;
  if (variantCoords.viewport !== undefined) {
    viewport = variantCoords.viewport;
    viewportReasoning = `viewport "${viewport.value}" from a variant property`;
  } else if (node.isPageChild) {
    if (node.width !== null) {
      const resolved = resolveViewport(node.width, registries);
      viewport = { value: resolved.token, provenance: resolved.provenance, confidence: resolved.confidence, source: "structure" };
      viewportReasoning = resolved.reasoning;
    }
  } else if (parentCoordinates?.viewport !== undefined) {
    viewport = { value: parentCoordinates.viewport.value, provenance: "derived", source: "structure", confidence: "high" };
    viewportReasoning = `viewport "${viewport.value}" inherited from root frame`;
  }

  const axes = resolveAxesFromModes(node.resolvedModes, registries);
  let mode = variantCoords.mode ?? axes.mode;
  let modeReasoning: string | undefined;
  if (variantCoords.mode !== undefined) modeReasoning = `mode "${variantCoords.mode.value}" from a variant property`;
  else if (axes.mode !== undefined) modeReasoning = axisReasoningNote("mode", axes.mode);

  let theme = variantCoords.theme ?? axes.theme;
  let themeReasoning: string | undefined;
  if (variantCoords.theme !== undefined) themeReasoning = `theme "${variantCoords.theme.value}" from a variant property`;
  else if (axes.theme !== undefined) themeReasoning = axisReasoningNote("theme", axes.theme);

  let state = variantCoords.state;
  let stateReasoning: string | undefined;
  if (state !== undefined) stateReasoning = `state "${state.value}" from a variant property`;

  const viewportOverride = priorOverrideCoordinate(node.durableId, "viewport", prior);
  if (viewportOverride !== null) {
    viewport = viewportOverride;
    viewportReasoning = priorOverrideCoordinateReasoning("viewport", viewportOverride);
  }
  const modeOverride = priorOverrideCoordinate(node.durableId, "mode", prior);
  if (modeOverride !== null) {
    mode = modeOverride;
    modeReasoning = priorOverrideCoordinateReasoning("mode", modeOverride);
  }
  const themeOverride = priorOverrideCoordinate(node.durableId, "theme", prior);
  if (themeOverride !== null) {
    theme = themeOverride;
    themeReasoning = priorOverrideCoordinateReasoning("theme", themeOverride);
  }
  const stateOverride = priorOverrideCoordinate(node.durableId, "state", prior);
  if (stateOverride !== null) {
    state = stateOverride;
    stateReasoning = priorOverrideCoordinateReasoning("state", stateOverride);
  }

  const reasoningParts = [viewportReasoning, modeReasoning, themeReasoning, stateReasoning].filter(
    (part): part is string => part !== undefined,
  );

  const coordinates: Coordinates = {
    ...(viewport !== undefined ? { viewport } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(theme !== undefined ? { theme } : {}),
    ...(state !== undefined ? { state } : {}),
  };
  return { coordinates, reasoningParts };
}

function toAddressCoordinates(c: Coordinates): AddressCoordinates {
  return {
    ...(c.viewport !== undefined ? { viewport: c.viewport.value } : {}),
    ...(c.mode !== undefined ? { mode: c.mode.value } : {}),
    ...(c.theme !== undefined ? { theme: c.theme.value } : {}),
    ...(c.state !== undefined ? { state: c.state.value } : {}),
  };
}

// ─── §6: pathRoleDefault ────────────────────────────────────────────────────

function pathRoleDefaultFor(node: ExtractedNode): "section" | "component" | "element" {
  if (node.kind === "INSTANCE" || node.kind === "COMPONENT" || node.kind === "COMPONENT_SET") return "component";
  if (node.isPageChild && node.kind === "FRAME") return "section";
  return "element";
}

// ─── assembleIdentities ─────────────────────────────────────────────────────

export interface AssembleIdentitiesResult {
  records: NodeIdentityRecord[];
}

/**
 * Turn an `IdentityExtraction` + registries into `NodeIdentityRecord[]`
 * (see file header for the seven rules). Four internal passes over
 * `extraction.nodes`, each with a different ordering dependency:
 *
 *  A. Coordinates — needs only the parent's *coordinates* (not its full
 *     record), so a single forward pass in the given parent-before-child
 *     order suffices.
 *  B. Labels — fully independent per node (no sibling/parent dependency at
 *     all).
 *  C. Ordinals — needs every sibling's (label, coordinates) in a
 *     `parentDurableId` group, sorted by the structural `ordinal` field
 *     (document order) — computed once A and B are complete for the whole
 *     extraction.
 *  D. Records — needs the parent's fully-resolved *path* (which bakes in
 *     the parent's own ordinal), so a second forward pass in
 *     parent-before-child order, consuming A/B/C's results.
 */
export function assembleIdentities(
  extraction: IdentityExtraction,
  registries: IdentityRegistries,
  components: ComponentRegistry,
  prior?: NodeManifest,
): AssembleIdentitiesResult {
  const now = new Date().toISOString();
  const { scope, pageSegment } = resolvePageTier(extraction);

  // Pass A: coordinates (parent-before-child; only needs parent coordinates).
  const coordById = new Map<string, Coordinates>();
  const coordReasoningById = new Map<string, string[]>();
  for (const node of extraction.nodes) {
    const parentCoords = node.parentDurableId === null ? undefined : coordById.get(node.parentDurableId);
    const { coordinates, reasoningParts } = resolveCoordinatesForNode(node, parentCoords, registries, prior);
    coordById.set(node.durableId, coordinates);
    coordReasoningById.set(node.durableId, reasoningParts);
  }

  // Pass B: labels (independent per node).
  const labelById = new Map<string, LabelResolution>();
  for (const node of extraction.nodes) {
    labelById.set(node.durableId, resolveLabel(node, registries, components, prior));
  }

  // Pass C: sibling ordinals, grouped by parent, sorted by document order —
  // collision is (label, coordinates), not just (label): see file header.
  const siblingGroups = new Map<string, ExtractedNode[]>();
  for (const node of extraction.nodes) {
    const key = node.parentDurableId ?? "__root__";
    const group = siblingGroups.get(key);
    if (group) group.push(node);
    else siblingGroups.set(key, [node]);
  }
  const ordinalById = new Map<string, number | undefined>();
  for (const siblings of siblingGroups.values()) {
    const sorted = [...siblings].sort((a, b) => a.ordinal - b.ordinal);
    const seen = new Map<string, number>();
    for (const sib of sorted) {
      const label = labelById.get(sib.durableId)!.label;
      const coords = coordById.get(sib.durableId)!;
      const key = `${label} ${coordinateKey(coords, registries)}`;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      ordinalById.set(sib.durableId, count >= 2 ? count : undefined);
    }
  }

  // Composition (direct children durableIds, in document order).
  const childrenOf = new Map<string, ExtractedNode[]>();
  for (const node of extraction.nodes) {
    if (node.parentDurableId === null) continue;
    const group = childrenOf.get(node.parentDurableId);
    if (group) group.push(node);
    else childrenOf.set(node.parentDurableId, [node]);
  }

  // Pass D: assemble full records (parent-before-child; needs parent's path).
  const pathById = new Map<string, PathSegment[]>();
  const records: NodeIdentityRecord[] = [];

  for (const node of extraction.nodes) {
    const lbl = labelById.get(node.durableId)!;
    const ordinal = ordinalById.get(node.durableId);
    const ownSegment: PathSegment = {
      label: lbl.label,
      ...(ordinal !== undefined ? { ordinal } : {}),
      provenance: lbl.provenance,
      ...(lbl.source !== undefined ? { source: lbl.source } : {}),
      ...(lbl.confirmed !== undefined ? { confirmed: lbl.confirmed } : {}),
    };

    const parentPath = node.parentDurableId === null ? (pageSegment ? [pageSegment] : []) : pathById.get(node.parentDurableId)!;
    const path = [...parentPath, ownSegment];
    pathById.set(node.durableId, path);

    const coordinates = coordById.get(node.durableId)!;
    const address = serializeAddress(
      {
        path: path.map((seg) => ({ label: seg.label, ...(seg.ordinal !== undefined ? { ordinal: seg.ordinal } : {}) })),
        coordinates: toAddressCoordinates(coordinates),
      } satisfies CanonicalAddress,
      registries,
    );

    const composition = (childrenOf.get(node.durableId) ?? [])
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((c) => c.durableId);

    const priorRecord = prior?.records[node.durableId];

    const reasoningParts = [lbl.reasoning, ...(coordReasoningById.get(node.durableId) ?? [])];
    if (ordinal !== undefined) {
      reasoningParts.push(`sibling ordinal ${ordinal} assigned: label "${lbl.label}" collides with an earlier sibling at the same coordinates (document order)`);
    }
    const reasoning = reasoningParts.filter((p) => p.length > 0).join("; ");

    const record: NodeIdentityRecord = {
      durableId: node.durableId,
      figmaNodeId: node.figmaNodeId,
      address,
      scope,
      path,
      coordinates,
      kind: node.kind,
      pathRoleDefault: pathRoleDefaultFor(node),
      isDefinition: node.kind === "COMPONENT" || node.kind === "COMPONENT_SET",
      ...(lbl.matchability !== undefined ? { matchability: lbl.matchability } : {}),
      ...(lbl.resolutionStatus !== undefined ? { resolutionStatus: lbl.resolutionStatus } : {}),
      ...(lbl.definitionRef !== undefined ? { definitionRef: lbl.definitionRef } : {}),
      ...(lbl.codeBinding !== undefined ? { codeBinding: lbl.codeBinding } : {}),
      composition,
      currentName: node.currentName,
      ...(reasoning.length > 0 ? { reasoning } : {}),
      updatedAt: now,
      ...(priorRecord?.appliedAddress !== undefined ? { appliedAddress: priorRecord.appliedAddress } : {}),
      ...(priorRecord?.appliedAt !== undefined ? { appliedAt: priorRecord.appliedAt } : {}),
    };

    records.push(record);
  }

  return { records };
}

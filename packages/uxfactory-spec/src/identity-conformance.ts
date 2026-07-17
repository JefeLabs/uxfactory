/**
 * identity-conformance.ts — deterministic, LLM-free conformance checks over
 * the node-identity stores (manifest + registries + component registry, plus
 * an optional story→route promise list).
 *
 * Source: .superpowers/sdd/task-15-brief.md (Phase 5: conformance hooks).
 * This is what turns node-identity from "a naming tool" into governance:
 * every check here is a pure function over already-loaded data — no I/O, no
 * model call — so `uxfactory identity check` (the CLI wrapper, in
 * `packages/uxfactory-cli/src/commands/identity.ts`) can run it against
 * whatever the bridge already serves, and this module itself stays testable
 * with plain fixtures.
 *
 * Five checks, each returning zero or more `ConformanceFinding`s:
 *  1. `checkAddressValidity`      — every record's `address` must still
 *     `parseAddress` against the CURRENT registries (catches a registry edit
 *     that invalidates previously-valid names). The only `error`-level
 *     check — everything else is `warn`.
 *  2. `checkDriftSurfacing`       — every `resolutionStatus: "drifted"`
 *     record surfaces as "should rebind", naming the matched component via
 *     `definitionRef` when present. This is Task 14's recreation-fix made
 *     visible in a report, not just in the panel.
 *  3. `checkComposedNodeConformance` — a record with a non-empty
 *     `composition` conforms only if every INSTANCE-kind child is
 *     `resolutionStatus: "bound"`; an unbound/drifted instance child warns
 *     ON THE PARENT ("<parent> conforms iff its parts are governed").
 *  4. `checkRouteTraceableStories` — a story's promised route with no
 *     manifest record claiming that route warns. As of this task, the
 *     canonical story schema (`story-schema.ts`'s `CanonicalStory`) carries
 *     NO route/destination field — `parseStoryFile` does not read one, and
 *     nothing in the bridge's trace join (`buildTrace` in
 *     `packages/uxfactory-bridge/src/project.ts`) produces one either. So in
 *     production this check is always called with an empty `storyRoutes`
 *     list and runs vacuously green; the CLI states that explicitly rather
 *     than staying silent about why zero findings came back. The function
 *     itself stays schema-agnostic (`StoryRoutePromise[]` in, not a
 *     `CanonicalStory[]`) precisely so it's exercisable today via fixtures
 *     and needs no change the day a route field is added upstream.
 *  5. `checkNavConsumesAnchors`   — records whose `route` is set form the
 *     anchor set; a record that LOOKS like a nav/link element (see
 *     `looksLikeNavOrLink` below for the exact, deliberately simple pattern)
 *     and itself carries a `route` warns if no OTHER record in the manifest
 *     claims that same route. (Checking against a set that includes the nav
 *     record's own entry would never fire — a value is always a member of a
 *     set built from itself — so "outside the anchor set" is implemented as
 *     "no other record claims it": the broken-reference case this check
 *     exists to catch.) `route` is optional everywhere, so a manifest with
 *     no routes at all degrades to a vacuous pass, same as check 4.
 */

import type { ComponentTypeEntry, NodeIdentityRecord, NodeManifest, IdentityRegistries } from "./node-identity.js";
import { parseAddress } from "./canonical-address.js";

// ─── shared finding shape ────────────────────────────────────────────────────

export type ConformanceLevel = "error" | "warn";

/** The stable check identifiers, in the order `runConformanceChecks` runs them (also the CLI's report order). */
export const CONFORMANCE_CHECKS = [
  "address-validity",
  "drift-surfacing",
  "composed-node-conformance",
  "route-traceable-stories",
  "nav-consumes-anchors",
] as const;
export type ConformanceCheckName = (typeof CONFORMANCE_CHECKS)[number];

export interface ConformanceFinding {
  level: ConformanceLevel;
  check: ConformanceCheckName;
  durableId?: string;
  message: string;
}

function records(manifest: NodeManifest): NodeIdentityRecord[] {
  return Object.values(manifest.records);
}

/** A record's own (last) path segment label — see node-identity.ts's `path: PathSegment[]` doc ("own label is the last segment"). "" when a record somehow carries no path (defensive; assembleIdentities never produces one). */
function ownLabel(record: NodeIdentityRecord): string {
  return record.path[record.path.length - 1]?.label ?? "";
}

// ─── 1. address validity ─────────────────────────────────────────────────────

/**
 * Every manifest record's `address` must still `parseAddress` against `registries`.
 * A record written against a prior registry state (e.g. a breakpoint band or
 * theme token since removed) fails here even though nothing about the record
 * itself changed — the registry moved out from under it. `error`-level: the
 * only check that is (see module doc) — the CLI's exit-1 condition keys on this.
 */
export function checkAddressValidity(
  manifest: NodeManifest,
  registries: IdentityRegistries,
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const record of records(manifest)) {
    const result = parseAddress(record.address, registries);
    if (!result.ok) {
      findings.push({
        level: "error",
        check: "address-validity",
        durableId: record.durableId,
        message: `address "${record.address}" no longer parses against the current registries: ${result.error}`,
      });
    }
  }
  return findings;
}

// ─── 2. drift surfacing ──────────────────────────────────────────────────────

/**
 * Every `resolutionStatus: "drifted"` record surfaces a "should rebind"
 * warning, naming the matched component (by `roleName`) when `definitionRef`
 * points at a real `ComponentTypeEntry.key` in `components`.
 */
export function checkDriftSurfacing(
  manifest: NodeManifest,
  components: ComponentTypeEntry[],
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const record of records(manifest)) {
    if (record.resolutionStatus !== "drifted") continue;
    const matched =
      record.definitionRef !== undefined
        ? components.find((c) => c.key === record.definitionRef)
        : undefined;
    const componentNote = matched !== undefined ? ` from "${matched.roleName}"` : "";
    findings.push({
      level: "warn",
      check: "drift-surfacing",
      durableId: record.durableId,
      message: `${record.address} has drifted${componentNote} — should rebind`,
    });
  }
  return findings;
}

// ─── 3. composed-node conformance ────────────────────────────────────────────

/**
 * A record with a non-empty `composition` conforms only if every INSTANCE-
 * kind child record is `resolutionStatus: "bound"`. An unbound (or drifted,
 * or custom) instance child warns ON THE PARENT, naming each offending
 * child's address. A `composition` entry with no matching manifest record
 * (out of extraction scope) is skipped — not this check's concern. Non-
 * INSTANCE children (e.g. plain FRAME sections nested under a composed node)
 * never gate this check — only actual component instances are "parts" that
 * must be governed.
 */
export function checkComposedNodeConformance(manifest: NodeManifest): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const record of records(manifest)) {
    if (record.composition.length === 0) continue;
    const ungoverned: string[] = [];
    for (const childId of record.composition) {
      const child = manifest.records[childId];
      if (child === undefined) continue;
      if (child.kind !== "INSTANCE") continue;
      if (child.resolutionStatus !== "bound") {
        ungoverned.push(child.address);
      }
    }
    if (ungoverned.length > 0) {
      findings.push({
        level: "warn",
        check: "composed-node-conformance",
        durableId: record.durableId,
        message: `${record.address} conforms iff its parts are governed — unbound/drifted part(s): ${ungoverned.join(", ")}`,
      });
    }
  }
  return findings;
}

// ─── 4. route-traceable stories ──────────────────────────────────────────────

/**
 * One story's promised destination — schema-agnostic on purpose (see module
 * doc §4): today nothing produces this list in production, so the CLI always
 * calls `checkRouteTraceableStories` with `[]`.
 */
export interface StoryRoutePromise {
  storyId: string;
  route: string;
}

/**
 * A promised `route` with no manifest record claiming it (via `record.route`)
 * warns. `storyRoutes.length === 0` (the production case today — see module
 * doc) is a vacuous pass: an empty input array, an empty findings array.
 */
export function checkRouteTraceableStories(
  manifest: NodeManifest,
  storyRoutes: StoryRoutePromise[],
): ConformanceFinding[] {
  if (storyRoutes.length === 0) return [];
  const anchors = new Set(
    records(manifest)
      .map((r) => r.route)
      .filter((r): r is string => r !== undefined),
  );
  const findings: ConformanceFinding[] = [];
  for (const promise of storyRoutes) {
    if (!anchors.has(promise.route)) {
      findings.push({
        level: "warn",
        check: "route-traceable-stories",
        message: `story "${promise.storyId}" promises route "${promise.route}" but no manifest record claims that route`,
      });
    }
  }
  return findings;
}

// ─── 5. nav-consumes-anchors ─────────────────────────────────────────────────

/**
 * "Looks like a nav/link element": deliberately simple — the record's own
 * (last) path-segment label OR its raw `currentName` contains "nav" or
 * "link" as a case-insensitive substring. Covers both an already-canonical
 * label (`nav`, `nav-link`, `footer-link`) and a stale/pre-rename raw Figma
 * layer name ("Navigation", "Footer Link") without needing a third
 * vocabulary. Documented here, not hidden — this is the one arbitrary call
 * in the check, per the task brief's "keep it simple and documented".
 */
const NAV_LINK_PATTERN = /nav|link/i;
function looksLikeNavOrLink(record: NodeIdentityRecord): boolean {
  return NAV_LINK_PATTERN.test(ownLabel(record)) || NAV_LINK_PATTERN.test(record.currentName);
}

/**
 * A nav/link-labeled record that itself carries a `route` warns if no OTHER
 * manifest record claims that same route — a dangling reference: the nav
 * item still points at a URL nothing in the manifest is actually anchored
 * to (e.g. the destination section was renamed/removed and its `route`
 * moved or disappeared, but the nav item's own `route` wasn't updated).
 * Degrades gracefully: no record with `route` set at all → no candidates →
 * vacuous pass, same as check 4.
 */
export function checkNavConsumesAnchors(manifest: NodeManifest): ConformanceFinding[] {
  const all = records(manifest);
  const findings: ConformanceFinding[] = [];
  for (const record of all) {
    if (record.route === undefined) continue;
    if (!looksLikeNavOrLink(record)) continue;
    const claimedElsewhere = all.some((other) => other.durableId !== record.durableId && other.route === record.route);
    if (!claimedElsewhere) {
      findings.push({
        level: "warn",
        check: "nav-consumes-anchors",
        durableId: record.durableId,
        message: `${record.address} looks like a nav/link element pointing to route "${record.route}", but no other manifest record claims that route as its anchor — broken reference`,
      });
    }
  }
  return findings;
}

// ─── run all ─────────────────────────────────────────────────────────────────

export interface ConformanceInputs {
  manifest: NodeManifest;
  registries: IdentityRegistries;
  components: ComponentTypeEntry[];
  /** Story route promises — see `StoryRoutePromise` doc; defaults to `[]` (today's always-vacuous production case). */
  storyRoutes?: StoryRoutePromise[];
}

/** Run all five checks in `CONFORMANCE_CHECKS` order and concatenate their findings. */
export function runConformanceChecks(inputs: ConformanceInputs): ConformanceFinding[] {
  const storyRoutes = inputs.storyRoutes ?? [];
  return [
    ...checkAddressValidity(inputs.manifest, inputs.registries),
    ...checkDriftSurfacing(inputs.manifest, inputs.components),
    ...checkComposedNodeConformance(inputs.manifest),
    ...checkRouteTraceableStories(inputs.manifest, storyRoutes),
    ...checkNavConsumesAnchors(inputs.manifest),
  ];
}

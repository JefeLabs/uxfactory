import { getByPath } from "./sources.js";
import { setAutoFilled } from "./map-io.js";
import type { ComponentMap, MapEntry } from "./map-schema.js";
import type { ResolvedSource } from "./sources.js";
import type { Spec } from "@uxfactory/spec";
import type { RenderReport } from "@uxfactory/bridge";

/** The four ways design and code drift apart (PRD §11.2–§11.3). */
export type DriftKind = "field" | "deleted-orphan" | "undiagrammed-orphan" | "stale";

/** A single drift signal. `expected` is reality (code/infra); `actual` is the diagram. */
export interface DriftFinding {
  kind: DriftKind;
  component?: string;
  property?: string;
  expected?: unknown;
  actual?: unknown;
  detail: string;
}

/** The structured drift verdict. */
export interface DriftReport {
  findings: DriftFinding[];
  clean: boolean;
}

/** A component found in a source file, with its source ref for orphan detection. */
export interface DiscoveredRef {
  component: string;
  /** The synthesized `source.ref` for this resource, e.g. `infra/main.tf#aws_x.main`. */
  ref: string;
}

/** Fully pre-resolved input — the command layer does all I/O so this core stays pure. */
export interface DriftInput {
  map: ComponentMap;
  /** Spec file name → parsed spec. */
  specs: Record<string, Spec>;
  /** The latest render report, or null (drift still runs source-vs-spec). */
  report: RenderReport | null;
  /** `source.ref` → its resolution. */
  sources: Record<string, ResolvedSource>;
  /**
   * Components discovered in the source files, with their synthesized `source.ref` values.
   * The undiagrammed-orphan check joins on `ref` (NOT on `component`), so a map entry
   * whose `component` id differs from the resource name will not produce a false positive
   * as long as `entry.source.ref === disc.ref`.
   */
  discoveredComponents: DiscoveredRef[];
  /** component → "git says the source changed since last render" (for compare-less entries). */
  staleness: Record<string, boolean>;
}

/** Pure comparator: map/spec/source/report in, structured drift report out. Deterministic. */
export function computeDrift(input: DriftInput): DriftReport {
  const findings: DriftFinding[] = [];
  // Join key for orphan detection is source.ref, NOT the component display name.
  // A map entry whose component id differs from the discovered resource name must NOT
  // produce a false positive as long as entry.source.ref matches the discovered ref.
  const mappedRefs = new Set(input.map.components.map((e) => e.source.ref));

  for (const entry of input.map.components) {
    const src = input.sources[entry.source.ref];
    // deleted-but-diagrammed: the source ref no longer resolves
    if (src === undefined || !src.resolved) {
      findings.push({
        kind: "deleted-orphan",
        component: entry.component,
        detail: `source ${entry.source.ref} no longer resolves ("${entry.component}" documents a deleted resource)`,
      });
      continue;
    }
    const compare = entry.source.compare;
    if (compare !== undefined && Object.keys(compare).length > 0) {
      findings.push(...fieldDiffs(entry, src, input.specs, input.report));
    } else if (input.staleness[entry.component] === true) {
      findings.push({
        kind: "stale",
        component: entry.component,
        detail: `source for "${entry.component}" changed since the diagram last rendered (git-staleness; no compare bindings)`,
      });
    }
  }

  // implemented-but-undiagrammed: a discovered source ref with no map entry.
  // We compare by source.ref so that a map entry with a different component id
  // (e.g. a human-assigned alias) does not generate a spurious orphan finding.
  for (const disc of input.discoveredComponents) {
    if (!mappedRefs.has(disc.ref)) {
      findings.push({
        kind: "undiagrammed-orphan",
        component: disc.component,
        detail: `component "${disc.component}" (ref: ${disc.ref}) exists in source but has no map entry (implemented but undiagrammed)`,
      });
    }
  }

  return { findings, clean: findings.length === 0 };
}

function fieldDiffs(
  entry: MapEntry,
  src: ResolvedSource,
  specs: Record<string, Spec>,
  report: RenderReport | null,
): DriftFinding[] {
  const out: DriftFinding[] = [];
  const specNode = findSpecNode(specs[entry.spec], entry.node);
  const reportNode = report?.nodes.find((n) => n.name === entry.node) ?? null;
  for (const [logical, attr] of Object.entries(entry.source.compare ?? {})) {
    const expectedRaw = src.values[attr] as unknown; // reality (code/infra); YAML may produce number/boolean
    if (expectedRaw === undefined || expectedRaw === null) continue; // attribute not present → nothing to diff
    const expected = String(expectedRaw); // coerce so numeric "8080" === string "8080"
    const fromSpec = specNode !== null ? getByPath(specNode, logical) : undefined;
    const actualRaw =
      fromSpec !== undefined
        ? fromSpec
        : reportNode !== null
          ? getByPath(reportNode, logical)
          : undefined;
    const actual = actualRaw === undefined || actualRaw === null ? undefined : String(actualRaw);
    if (actual !== expected) {
      out.push({
        kind: "field",
        component: entry.component,
        property: logical,
        expected,
        actual: actual,
        detail: `"${entry.component}".${logical}: source says ${JSON.stringify(expected)}, diagram says ${JSON.stringify(actual)}`,
      });
    }
  }
  return out;
}

/** Find a named node anywhere in a spec (a frame/section or one of their children). Pure. */
export function findSpecNode(spec: Spec | undefined, name: string): Record<string, unknown> | null {
  if (spec === undefined) return null;
  const s = spec as { frames?: unknown[]; sections?: unknown[] };
  for (const group of [s.frames, s.sections]) {
    if (!Array.isArray(group)) continue;
    for (const raw of group) {
      const c = raw as Record<string, unknown>;
      if (c.name === name) return c;
      const children = c.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          const ch = child as Record<string, unknown>;
          if (ch.name === name) return ch;
        }
      }
    }
  }
  return null;
}

/**
 * Auto-fill `figmaId` + `lastSynced` for every entry whose `node` matches a render-report
 * node by name. Pure — returns a new map; maintained fields are never touched (via setAutoFilled).
 *
 * `commit` is optional: when git is unavailable, pass `undefined` (or omit it) and the
 * `lastSynced.commit` field will be omitted entirely — never written as an empty string.
 */
export function syncMapFromReport(
  map: ComponentMap,
  report: RenderReport,
  commit?: string,
): ComponentMap {
  let next = map;
  for (const entry of map.components) {
    const node = report.nodes.find((n) => n.name === entry.node);
    if (node === undefined) continue;
    const lastSynced =
      commit !== undefined && commit.length > 0
        ? { render: report.renderId, commit }
        : { render: report.renderId };
    next = setAutoFilled(next, entry.component, { figmaId: node.id, lastSynced });
  }
  return next;
}

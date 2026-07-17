/**
 * identity-apply.ts — pure write-back planner for the node-identity manifest
 * (Task 14, Phase 4). Turns a set of `NodeIdentityRecord`s into a plan of
 * canvas renames the main thread can execute, plus the records that were
 * held back and why. No I/O — the plugin main thread (`code.ts`) is the only
 * caller that touches real Figma nodes.
 *
 * STORAGE SPLIT (grammar §3.1 — .plans/2026-0717-edwin-node-identity/
 * node-identity-naming-grammar.md): a plain, non-component node (FRAME,
 * GROUP, SECTION, …) cannot hold variant properties, so its coordinates have
 * nowhere structured to live — the FULL rendered `address` string becomes
 * its stored `node.name`. A COMPONENT/COMPONENT_SET/INSTANCE *can* hold
 * coordinates as native variant properties, so only its path LABEL — the
 * last `path` segment's `label`, deliberately re-read off that field rather
 * than sliced out of `address` — becomes the stored name. Re-reading the
 * field (not the string) is what drops the ordinal suffix (`#2` — render-only,
 * §2.4) automatically: `PathSegment.ordinal` is a separate field `label`
 * never carries. Variant-prop AUTHORING is deliberately not built here (plan
 * §5: "hygiene lever … recommended where the team is willing, not forced")
 * — a component/instance whose coordinates would need variant props still
 * gets exactly its label written; the coordinates are simply not pushed
 * anywhere on this pass.
 *
 * GATING (apply-with-flag lean — plan's absent-binding degradation posture:
 * "Apply-with-flag; hold-for-confirm on low confidence"). A record's own
 * address is determined by its own last path segment (its label) plus its
 * own coordinate values — NOT any ancestor's label, which lives on the
 * ancestor's own record and is gated there, on that record's own pass
 * through this planner. Each of those segments is either:
 *   - SETTLED: provenance is "derived", "elicited", or "defaulted", OR
 *     provenance is "inferred" AND the segment already carries
 *     `confirmed: true`. Settled segments never hold up a record.
 *   - HOLD-LOW: provenance "inferred", NOT confirmed, `confidence: "low"`.
 *     Always held, regardless of `includeFlagged` — the strongest signal in
 *     this system that a guess isn't trustworthy enough to auto-apply.
 *   - HOLD-FLAG: provenance "inferred", NOT confirmed, confidence "high" or
 *     unspecified. `PathSegment` (a path label) carries no `confidence`
 *     field at all (only `ProvenancedValue` — coordinates — does), so an
 *     unconfirmed inferred LABEL always lands here, never in HOLD-LOW. Held
 *     unless `opts.includeFlagged` is true, in which case it applies
 *     (apply-with-flag).
 * A record holds if ANY of its segments hold; HOLD-LOW on any one segment
 * vetoes the whole record even if `includeFlagged` is true and another
 * segment would otherwise have been flag-eligible. A held record is never
 * silently dropped — it always appears in `held[]` with a reason string.
 */

import type { Coordinates, NodeIdentityRecord, PathSegment, ProvenancedValue } from "@uxfactory/spec";

export interface IdentityWritebackRename {
  figmaNodeId: string;
  durableId: string;
  newName: string;
}

export interface IdentityWritebackHold {
  durableId: string;
  reason: string;
}

export interface IdentityWritebackPlan {
  renames: IdentityWritebackRename[];
  held: IdentityWritebackHold[];
}

export const LOW_CONFIDENCE_HOLD_REASON = "low-confidence, needs confirmation";
export const UNCONFIRMED_HOLD_REASON =
  'unconfirmed suggestion — enable "include unconfirmed suggestions (flagged)" to apply';

/** Node kinds that can hold native Figma variant properties (grammar §3.1). */
const COMPONENT_KINDS = new Set(["INSTANCE", "COMPONENT", "COMPONENT_SET"]);

type SegmentGate = "settled" | "hold-low" | "hold-flag";

/** `PathSegment` carries no `confidence` field — an unconfirmed inferred
 *  label always falls into the flag-eligible bucket, never hold-low. */
function pathSegmentGate(seg: PathSegment): SegmentGate {
  if (seg.provenance !== "inferred") return "settled";
  if (seg.confirmed === true) return "settled";
  return "hold-flag";
}

function coordinateGate(cv: ProvenancedValue): SegmentGate {
  if (cv.provenance !== "inferred") return "settled";
  if (cv.confirmed === true) return "settled";
  return cv.confidence === "low" ? "hold-low" : "hold-flag";
}

const COORD_AXES: (keyof Coordinates)[] = ["viewport", "mode", "theme", "state"];

/** The strictest gate across a record's own label + its own present
 *  coordinates — hold-low beats hold-flag beats settled. `path`/
 *  `coordinates` fall back to `[]`/`{}` — the same tolerant-of-a-partial/
 *  legacy-record convention IdentityInventory.tsx's `buildTree` and
 *  `IdentityRow` already use — a record missing these (e.g. a minimal test
 *  fixture, or older manifest data) is simply gate-free rather than a crash. */
function recordGate(record: NodeIdentityRecord): SegmentGate {
  let worst: SegmentGate = "settled";
  const path = record.path ?? [];
  const lastSeg = path[path.length - 1];
  if (lastSeg !== undefined) {
    const gate = pathSegmentGate(lastSeg);
    if (gate === "hold-low") return "hold-low";
    if (gate === "hold-flag") worst = "hold-flag";
  }
  const coordinates = record.coordinates ?? {};
  for (const axis of COORD_AXES) {
    const cv = coordinates[axis];
    if (cv === undefined) continue;
    const gate = coordinateGate(cv);
    if (gate === "hold-low") return "hold-low";
    if (gate === "hold-flag") worst = "hold-flag";
  }
  return worst;
}

/** The stored `node.name` for an applyable record, per the §3.1 storage
 *  split. Falls back to the full address on the (should-never-happen)
 *  degenerate case of an empty/absent `path`. */
function storedName(record: NodeIdentityRecord): string {
  if (!COMPONENT_KINDS.has(record.kind)) return record.address;
  const path = record.path ?? [];
  const lastSeg = path[path.length - 1];
  return lastSeg?.label ?? record.address;
}

/**
 * Plans the canvas write-back for `records`: which get renamed (and to
 * what), and which are held back (and why). Pure — takes no bus/bridge,
 * does no I/O. `opts.includeFlagged` is the apply-with-flag toggle: when
 * true, unconfirmed-but-high-confidence inferred segments apply; low
 * confidence is never swept in regardless.
 */
export function planIdentityWriteback(
  records: NodeIdentityRecord[],
  opts: { includeFlagged: boolean },
): IdentityWritebackPlan {
  const renames: IdentityWritebackRename[] = [];
  const held: IdentityWritebackHold[] = [];

  for (const record of records) {
    const gate = recordGate(record);
    if (gate === "hold-low") {
      held.push({ durableId: record.durableId, reason: LOW_CONFIDENCE_HOLD_REASON });
      continue;
    }
    if (gate === "hold-flag" && !opts.includeFlagged) {
      held.push({ durableId: record.durableId, reason: UNCONFIRMED_HOLD_REASON });
      continue;
    }
    renames.push({
      figmaNodeId: record.figmaNodeId,
      durableId: record.durableId,
      newName: storedName(record),
    });
  }

  return { renames, held };
}

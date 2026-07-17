/**
 * IdentityInventory.tsx — the Components tab's suggest→confirm→apply surface
 * for the node-identity manifest (Task 13 + Task 14, Phase 4). Renders
 * identityManifestQuery's flat NodeIdentityRecord map as a tree, with
 * per-segment provenance chips, confirm gates, inline override, a
 * teaching-surface reasoning tooltip, a library-source filter/badge row, and
 * a write-back Apply surface. Mounted by Components.tsx alongside its
 * existing selection/link-composer content — this joins the tab, it doesn't
 * replace anything there.
 *
 * APPLY / WRITE-BACK (Task 14): `planIdentityWriteback` (src/identity-apply.ts,
 * a pure module — imported directly, not duplicated) decides, per record,
 * whether it's settled enough to write to the canvas and what the stored
 * `node.name` should be (the §3.1 storage split). Per-row "Apply" and the
 * header "Apply all" both plan over the same set — the currently VISIBLE
 * rows (mirrors "Confirm all high-confidence"'s scoping below: a row hidden
 * by the library filter is never silently applied) — with the SAME
 * `includeFlagged` toggle, so a row's individual Apply button and the batch
 * button always agree on whether that row is eligible. Applying is a TWO-STEP
 * round trip: `bus.requestIdentityApply` fires the renames at the plugin main
 * thread (fire-and-forget); the `identity-applied` ack names which durableIds
 * actually got written. Only THOSE stamp `POST /project/identity/applied`
 * with `appliedAddress` = the record's full canonical `address` (never the
 * possibly-label-only `newName` that was actually written to `node.name` for
 * a component/instance — the stamp records the canonical address, storage
 * detail is beneath it). A row is "Applied" once `record.address ===
 * record.appliedAddress`.
 *
 * TREE DERIVATION: parent→child comes from each record's own `composition`
 * array — node-identity.ts documents it explicitly as "child durableIds"
 * (Derived even when the record's own label is Inferred). This is NOT
 * re-derived from `path` prefixes: `path` is an address projection (its last
 * entry is the record's OWN label), while `composition` is the authoritative
 * structural edge the manifest already carries. Roots are records nobody's
 * `composition` lists as a child (the page-children tier) — rendered first,
 * each followed by a depth-first walk of its descendants, so indentation is
 * the walk depth.
 *
 * CONFIRM/OVERRIDE: wires Task 12's POST /project/identity/confirm exactly.
 * `segment` is the route's closed 5-value enum — "label" always means THIS
 * record's own last `path` segment (never an ancestor's; an ancestor's label
 * is confirmed via THAT record's own row). "Confirm all high-confidence"
 * composes one request from every inferred, not-yet-confirmed segment across
 * the currently VISIBLE rows only (post library-filter) — a row hidden by
 * the filter is never silently swept into a batch the user can't see, which
 * would defeat hold-for-confirm. Coordinate segments additionally require
 * confidence !== "low" (a low-confidence value is never swept into the
 * batch, though it stays individually confirmable via its own row button).
 * Path labels have no `confidence` field at all (only ProvenancedValue —
 * coordinates — carry one; PathSegment does not), so an inferred label is
 * always batch-eligible. The route 200s even when individual items are
 * tier-2-rejected (`{ok:true, updated, errors:["<durableId>.<segment>: ..."]}`)
 * — the confirm mutation's onSuccess checks `data.errors` and toasts a
 * summary so a rejected override/confirm never looks like silent success.
 *
 * LIBRARY FILTER: a multi-select over the four ComponentTypeEntry.source
 * values, defaulting to all-selected (nothing hidden on load). A record with
 * no resolvable `definitionRef` (no badge) is never hidden by this filter —
 * it isn't part of what the filter labels. This is explicitly a display
 * surface (task-13 brief): matching PRECEDENCE (figma-document over
 * figma-library) is decided in assembly and is not re-implemented here —
 * the dropdown only documents that ordering as a note.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, Pencil } from "lucide-react";
import type { ComponentTypeEntry, Coordinates, NodeIdentityRecord, Provenance } from "@uxfactory/spec";
import { BridgeError, type Bridge, type IdentityConfirmSegment, type IdentityConfirmationItem } from "../../lib/bridge.js";
import type { PluginBus } from "../../lib/plugin-bus.js";
import { Card, ChipGroup, InfoTooltip } from "../../components/index.js";
import { useAppStore } from "../../stores/app.js";
import {
  activeRoot,
  confirmIdentityMutation,
  identityComponentsQuery,
  identityManifestQuery,
  queryKeys,
} from "../../queries.js";
import { planIdentityWriteback, type IdentityWritebackRename } from "../../../src/identity-apply.js";

type SegmentKind = IdentityConfirmSegment;
type CoordAxis = keyof Coordinates;

const COORD_AXES: CoordAxis[] = ["viewport", "mode", "theme", "state"];

/** Display order only — a NOTE (internal DS before vendor); real precedence lives in assembly. */
const LIBRARY_SOURCES: { label: string; value: string }[] = [
  { label: "figma-document", value: "figma-document" },
  { label: "figma-library", value: "figma-library" },
  { label: "code-connect", value: "code-connect" },
  { label: "manual", value: "manual" },
];

interface TreeRow {
  record: NodeIdentityRecord;
  depth: number;
}

/**
 * Flatten the manifest into parent-before-child rows using each record's own
 * `composition` (documented child-durableId list). Roots are records nobody
 * else's `composition` references. A `visited` guard tolerates a
 * malformed/cyclic manifest defensively — this should never happen from a
 * well-formed assembler output.
 */
function buildTree(records: Record<string, NodeIdentityRecord>): TreeRow[] {
  // `composition` is tolerated as absent — a defensive fallback for any
  // partial/legacy record shape (e.g. an older fixture or a manifest write
  // that predates this field); a well-formed assembler output always sets it.
  const childIds = new Set<string>();
  for (const rec of Object.values(records)) {
    for (const id of rec.composition ?? []) childIds.add(id);
  }
  const roots = Object.values(records).filter((r) => !childIds.has(r.durableId));

  const rows: TreeRow[] = [];
  const visited = new Set<string>();
  function walk(rec: NodeIdentityRecord, depth: number): void {
    if (visited.has(rec.durableId)) return;
    visited.add(rec.durableId);
    rows.push({ record: rec, depth });
    for (const childId of rec.composition ?? []) {
      const child = records[childId];
      if (child !== undefined) walk(child, depth + 1);
    }
  }
  for (const root of roots) walk(root, 0);
  return rows;
}

/**
 * Every inferred, not-yet-confirmed segment across ALL records — the
 * "Confirm all high-confidence" batch. Coordinate segments additionally
 * require confidence !== "low" (never batched; still individually
 * confirmable). Label segments have no confidence field, so are always
 * batch-eligible once inferred + unconfirmed.
 */
function collectHighConfidenceConfirmations(
  records: Record<string, NodeIdentityRecord>,
): IdentityConfirmationItem[] {
  const items: IdentityConfirmationItem[] = [];
  for (const record of Object.values(records)) {
    const path = record.path ?? [];
    const lastSeg = path[path.length - 1];
    if (lastSeg !== undefined && lastSeg.provenance === "inferred" && lastSeg.confirmed !== true) {
      items.push({ durableId: record.durableId, segment: "label", action: "confirm" });
    }
    const coordinates = record.coordinates ?? {};
    for (const axis of COORD_AXES) {
      const cv = coordinates[axis];
      if (
        cv !== undefined &&
        cv.provenance === "inferred" &&
        cv.confirmed !== true &&
        cv.confidence !== "low"
      ) {
        items.push({ durableId: record.durableId, segment: axis, action: "confirm" });
      }
    }
  }
  return items;
}

/** The registry `source` a record's `definitionRef` resolves to, or null when
 *  unset/unresolved — such a record is never hidden by the library filter
 *  (it isn't part of what the filter labels). */
function sourceForRecord(
  record: NodeIdentityRecord,
  components: ComponentTypeEntry[],
): string | null {
  if (record.definitionRef === undefined) return null;
  const entry = components.find((c) => c.key === record.definitionRef);
  return entry?.source ?? null;
}

// ─── Segment chip — provenance tier styling + confirm/override affordances ────
//
// Derived: settled/quiet — plain muted text, no chip surface, no action.
// Inferred: accent chip + confirmable (confirm button while unconfirmed; a
//   quiet checkmark once ratified). Low-confidence inferred coordinates get
//   an amber flag alongside — still individually confirmable, just excluded
//   from the batch above.
// Elicited / Defaulted: muted chip (already settled by a user or a registry
//   default) — no confirm action (only "inferred" segments can be confirmed;
//   the confirm route itself rejects anything else).
// Every segment (any tier) carries an override pencil — an override always
// replaces the current value/provenance outright, so it makes sense even on
// an already-settled value.

const TIER_CLASS: Record<Provenance, string> = {
  derived: "text-gray-500",
  inferred: "bg-primary-50 text-primary-700 border border-primary-100",
  elicited: "bg-gray-100 text-gray-600 border border-gray-200",
  defaulted: "bg-gray-100 text-gray-600 border border-gray-200",
};

function SegmentChip({
  rowLabel,
  segment,
  value,
  provenance,
  confidence,
  confirmed,
  onConfirm,
  onOverride,
}: {
  rowLabel: string;
  segment: SegmentKind;
  value: string;
  provenance: Provenance;
  confidence?: "high" | "low";
  confirmed?: boolean;
  onConfirm: (segment: SegmentKind) => void;
  onOverride: (segment: SegmentKind, value: string) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  // Keep `draft` pinned to the true current value whenever the editor is
  // closed — so a rejected override (tier-2 error surfaced elsewhere, then
  // the manifest refetches unchanged) or any other prop update never leaves
  // a stale draft behind for the next time the editor opens.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const isConfirmable = provenance === "inferred" && confirmed !== true;
  const isConfirmedInferred = provenance === "inferred" && confirmed === true;
  const isLowConfidence = confidence === "low";

  function commit(): void {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed === "" || trimmed === value) {
      setDraft(value);
      return;
    }
    onOverride(segment, trimmed);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(value);
          }
        }}
        onBlur={commit}
        aria-label={`Override ${segment} for ${rowLabel}`}
        className="text-[11px] font-mono border border-primary-300 rounded px-1.5 py-0.5 w-28 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      />
    );
  }

  return (
    <span
      data-segment={segment}
      data-provenance={provenance}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${TIER_CLASS[provenance]}`}
    >
      <span className="font-mono">{value}</span>
      {isLowConfidence && (
        <AlertTriangle
          className="w-3 h-3 text-amber-500"
          aria-label={`Low confidence ${segment}`}
        />
      )}
      {isConfirmedInferred && (
        <CheckCircle2 className="w-3 h-3 text-green-500" aria-label={`${segment} confirmed`} />
      )}
      {isConfirmable && (
        <button
          type="button"
          onClick={() => onConfirm(segment)}
          aria-label={`Confirm ${segment} for ${rowLabel}`}
          className="text-primary-600 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 rounded"
        >
          <Check className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Override ${segment} for ${rowLabel}`}
        className="text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 rounded"
      >
        <Pencil className="w-3 h-3" aria-hidden="true" />
      </button>
    </span>
  );
}

// ─── Row-level apply control — write-back to the canvas (Task 14) ───────────
//
// Applied: `record.address === record.appliedAddress` — a quiet check badge,
// no action (re-applying an unchanged address is a no-op the user has no
// reason to repeat). Not applied + plannable (this record survived
// planIdentityWriteback's gate): an enabled Apply button. Not applied + held:
// a disabled Apply button carrying the planner's hold `reason` as its title,
// so hovering explains why (never a silent no-op).

function RowApplyControl({
  record,
  rename,
  heldReason,
  applyDisabled,
  onApply,
}: {
  record: NodeIdentityRecord;
  rename: IdentityWritebackRename | undefined;
  heldReason: string | undefined;
  applyDisabled: boolean;
  onApply: () => void;
}): React.JSX.Element {
  const isApplied = record.address !== "" && record.address === record.appliedAddress;

  if (isApplied) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-green-600 shrink-0"
        title={`Applied to canvas as "${record.appliedAddress}"`}
      >
        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
        Applied
      </span>
    );
  }

  const canApply = rename !== undefined && !applyDisabled;
  return (
    <button
      type="button"
      onClick={onApply}
      disabled={!canApply}
      aria-label={`Apply ${record.address}`}
      title={rename === undefined ? heldReason : undefined}
      className={[
        "text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0 transition-colors",
        canApply
          ? "bg-primary-50 text-primary-700 border border-primary-100 hover:bg-primary-100"
          : "bg-gray-50 text-gray-300 border border-gray-100 cursor-not-allowed",
      ].join(" ")}
    >
      Apply
    </button>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────────

function IdentityRow({
  record,
  depth,
  sourceBadge,
  rename,
  heldReason,
  applyDisabled,
  onConfirm,
  onOverride,
  onApply,
}: {
  record: NodeIdentityRecord;
  depth: number;
  sourceBadge: string | null;
  rename: IdentityWritebackRename | undefined;
  heldReason: string | undefined;
  applyDisabled: boolean;
  onConfirm: (durableId: string, segment: SegmentKind) => void;
  onOverride: (durableId: string, segment: SegmentKind, value: string) => void;
  onApply: (durableId: string) => void;
}): React.JSX.Element {
  const path = record.path ?? [];
  const lastSeg = path[path.length - 1];
  const coordinates = record.coordinates ?? {};

  return (
    <div
      data-durable-id={record.durableId}
      data-depth={depth}
      className="py-1.5 pr-3 border-b border-gray-50 last:border-b-0"
      style={{ paddingLeft: `${depth * 16 + 12}px` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-800 truncate flex-1" title={record.currentName}>
          {record.currentName}
        </span>
        <span className="text-[11px] font-mono text-gray-600 shrink-0">{record.address}</span>
        {sourceBadge !== null && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 shrink-0"
            title={`Bound to a "${sourceBadge}" component`}
          >
            {sourceBadge}
          </span>
        )}
        {record.reasoning !== undefined && record.reasoning !== "" && (
          <InfoTooltip label={`Reasoning: ${record.reasoning}`} content={record.reasoning} />
        )}
        <RowApplyControl
          record={record}
          rename={rename}
          heldReason={heldReason}
          applyDisabled={applyDisabled}
          onApply={() => onApply(record.durableId)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 mt-1">
        {lastSeg !== undefined && (
          <SegmentChip
            rowLabel={record.address}
            segment="label"
            value={lastSeg.label}
            provenance={lastSeg.provenance}
            confirmed={lastSeg.confirmed}
            onConfirm={(seg) => onConfirm(record.durableId, seg)}
            onOverride={(seg, v) => onOverride(record.durableId, seg, v)}
          />
        )}
        {COORD_AXES.map((axis) => {
          const cv = coordinates[axis];
          if (cv === undefined) return null;
          return (
            <SegmentChip
              key={axis}
              rowLabel={record.address}
              segment={axis}
              value={cv.value}
              provenance={cv.provenance}
              confidence={cv.confidence}
              confirmed={cv.confirmed}
              onConfirm={(seg) => onConfirm(record.durableId, seg)}
              onOverride={(seg, v) => onOverride(record.durableId, seg, v)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── IdentityInventory ───────────────────────────────────────────────────────

export function IdentityInventory({
  bridge,
  bus,
}: {
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const toast = useAppStore((s) => s.toast);

  const manifestResult = useQuery(identityManifestQuery(bridge));
  const componentsResult = useQuery(identityComponentsQuery(bridge));
  const [selectedSources, setSelectedSources] = useState<string[]>(
    LIBRARY_SOURCES.map((s) => s.value),
  );

  // ── Apply / write-back (Task 14) ────────────────────────────────────────
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [isApplyPending, setIsApplyPending] = useState(false);
  // durableId → the record's full canonical `address` at the moment its
  // rename was sent — read back once the identity-applied ack names which
  // durableIds actually landed, so the applied-stamp POST always carries the
  // CANONICAL address (never the possibly-label-only `newName` a component/
  // instance actually got written as — see the module doc).
  const pendingAddressRef = useRef<Map<string, string>>(new Map());

  const confirmMutation = useMutation({
    ...confirmIdentityMutation(bridge),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.identityManifest(activeRoot(bridge)),
      });
      // The route 200s with {ok:true, ...} even when individual items were
      // rejected (tier-2 business-rule failures — e.g. an override value
      // that doesn't normalize, or a confirm that raced a provenance
      // change) — react-query's onError never fires for those, so a silent
      // 200 would otherwise look like success right up until the
      // invalidated refetch quietly reverts the row. Surface via the same
      // toast idiom every other mutation in this screen uses on failure.
      if (data.errors !== undefined && data.errors.length > 0) {
        toast(
          data.errors.length === 1
            ? `Identity confirmation failed: ${data.errors[0]}`
            : `${data.errors.length} identity confirmations failed: ${data.errors.join("; ")}`,
        );
      }
    },
    onError: () => toast("Failed to save identity confirmation — is the bridge running?"),
  });

  const records = manifestResult.data?.manifest.records ?? {};
  const components = componentsResult.data?.components ?? [];

  const tree = useMemo(() => buildTree(records), [records]);

  // Rows currently hidden by the library filter — deriving this here (not
  // just at render time) lets the batch below scope to exactly what's on
  // screen.
  const visibleRows = useMemo(
    () =>
      tree.filter((row) => {
        const source = sourceForRecord(row.record, components);
        return source === null || selectedSources.includes(source);
      }),
    [tree, components, selectedSources],
  );

  // "Confirm all high-confidence" must never confirm a segment the user
  // can't currently see — a filter that hides `figma-library` rows to
  // review only internal-DS ones would otherwise silently ratify inferred
  // segments on the hidden rows too, defeating hold-for-confirm. Scoped to
  // visibleRows, not the full manifest.
  const batchItems = useMemo(() => {
    const visibleRecords: Record<string, NodeIdentityRecord> = {};
    for (const row of visibleRows) visibleRecords[row.record.durableId] = row.record;
    return collectHighConfidenceConfirmations(visibleRecords);
  }, [visibleRows]);

  // Same VISIBLE-rows scoping as "Confirm all high-confidence" above, for
  // the exact same reason: a row hidden by the library filter must never be
  // silently swept into a write-back batch the user can't currently see.
  // Per-row Apply and "Apply all" both read this ONE plan, so they always
  // agree on a given row's eligibility.
  const writebackPlan = useMemo(
    () => planIdentityWriteback(visibleRows.map((row) => row.record), { includeFlagged }),
    [visibleRows, includeFlagged],
  );
  const renameByDurableId = useMemo(() => {
    const m = new Map<string, IdentityWritebackRename>();
    for (const rename of writebackPlan.renames) m.set(rename.durableId, rename);
    return m;
  }, [writebackPlan]);
  const heldReasonByDurableId = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of writebackPlan.held) m.set(h.durableId, h.reason);
    return m;
  }, [writebackPlan]);

  // Subscribe to the plugin main thread's identity-applied ack. Only
  // durableIds the main thread actually confirmed (`payload.applied`) get
  // stamped — a `failed` entry (e.g. a deleted node) is surfaced via toast,
  // never silently swallowed and never stamped as applied.
  useEffect(() => {
    const unsub = bus.onIdentityApplied?.((raw) => {
      setIsApplyPending(false);
      if (raw === null || typeof raw !== "object") return;
      const payload = raw as {
        applied: { durableId: string; newName: string }[];
        failed: { durableId: string; error: string }[];
      };

      const stampItems = payload.applied
        .map((a) => {
          const appliedAddress = pendingAddressRef.current.get(a.durableId);
          return appliedAddress !== undefined ? { durableId: a.durableId, appliedAddress } : null;
        })
        .filter((x): x is { durableId: string; appliedAddress: string } => x !== null);

      if (stampItems.length > 0) {
        void bridge
          .postIdentityApplied?.(stampItems)
          .then(() => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.identityManifest(activeRoot(bridge)),
            });
          })
          .catch((err: unknown) => {
            toast(
              err instanceof BridgeError && err.status === 404
                ? "Bridge not ready for identity apply yet"
                : "Failed to save applied identity stamp — is the bridge running?",
            );
          });
      }

      if (payload.failed.length > 0) {
        toast(
          payload.failed.length === 1
            ? `Failed to apply to canvas: ${payload.failed[0]!.durableId}: ${payload.failed[0]!.error}`
            : `${payload.failed.length} canvas applies failed: ${payload.failed
                .map((f) => `${f.durableId}: ${f.error}`)
                .join("; ")}`,
        );
      }
    });
    return () => unsub?.();
  }, [bus, bridge, toast, queryClient]);

  // Nothing scanned/assembled yet — the Scan/Interpret controls above already
  // communicate that state; this surface just stays out of the way.
  if (Object.keys(records).length === 0) return null;

  function handleConfirm(durableId: string, segment: SegmentKind): void {
    confirmMutation.mutate([{ durableId, segment, action: "confirm" }]);
  }
  function handleOverride(durableId: string, segment: SegmentKind, value: string): void {
    confirmMutation.mutate([{ durableId, segment, action: "override", value }]);
  }
  function handleConfirmAll(): void {
    if (batchItems.length === 0) return;
    confirmMutation.mutate(batchItems);
  }

  /** Sends one or many planned renames over the bus, remembering each
   *  durableId's canonical address so the ack handler can stamp it. */
  function sendApply(renames: IdentityWritebackRename[]): void {
    if (renames.length === 0) return;
    for (const rename of renames) {
      const record = records[rename.durableId];
      if (record !== undefined) pendingAddressRef.current.set(rename.durableId, record.address);
    }
    setIsApplyPending(true);
    bus.requestIdentityApply?.(renames);
  }
  function handleApply(durableId: string): void {
    const rename = renameByDurableId.get(durableId);
    if (rename === undefined) return;
    sendApply([rename]);
  }
  function handleApplyAll(): void {
    sendApply(writebackPlan.renames);
  }

  return (
    <div>
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Identity Inventory
        </span>
        <button
          type="button"
          onClick={handleConfirmAll}
          disabled={batchItems.length === 0 || confirmMutation.isPending}
          aria-label="Confirm all high-confidence"
          className={[
            "text-[11px] px-2 py-1 rounded font-medium transition-colors",
            batchItems.length > 0 && !confirmMutation.isPending
              ? "bg-primary-600 text-white hover:bg-primary-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          {`Confirm all high-confidence${batchItems.length > 0 ? ` (${batchItems.length})` : ""}`}
        </button>
      </div>

      <div className="flex items-center justify-between px-3 pb-1 gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={includeFlagged}
            onChange={(e) => setIncludeFlagged(e.target.checked)}
            className="accent-primary-600"
          />
          include unconfirmed suggestions (flagged)
        </label>
        <button
          type="button"
          onClick={handleApplyAll}
          disabled={writebackPlan.renames.length === 0 || isApplyPending}
          aria-label="Apply all"
          className={[
            "text-[11px] px-2 py-1 rounded font-medium transition-colors shrink-0",
            writebackPlan.renames.length > 0 && !isApplyPending
              ? "bg-primary-600 text-white hover:bg-primary-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          {`Apply all${writebackPlan.renames.length > 0 ? ` (${writebackPlan.renames.length})` : ""}`}
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-400 shrink-0">Library:</span>
          <ChipGroup
            multi
            ariaLabel="Filter by component-registry source"
            options={LIBRARY_SOURCES}
            values={selectedSources}
            onChange={(v) => setSelectedSources(v as string[])}
          />
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          figma-document (internal design system) is listed above figma-library (vendor) —
          matching precedence is decided in assembly, not here.
        </p>
      </div>

      <Card>
        {visibleRows.map(({ record, depth }) => (
          <IdentityRow
            key={record.durableId}
            record={record}
            depth={depth}
            sourceBadge={sourceForRecord(record, components)}
            rename={renameByDurableId.get(record.durableId)}
            heldReason={heldReasonByDurableId.get(record.durableId)}
            applyDisabled={isApplyPending}
            onConfirm={handleConfirm}
            onOverride={handleOverride}
            onApply={handleApply}
          />
        ))}
      </Card>
    </div>
  );
}

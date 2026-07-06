/**
 * Artifacts.tsx — Spec-inventory screen: the system-of-record view.
 *
 * PRD: .plans/panel/04-artifacts-PRD.md
 *
 * Layout:
 *   - Heading "{name} artifacts" + right-aligned freshness rollup "N of M up to date"
 *   - Subcopy: "The specifications your designs are verified against."
 *   - Grouped inventory: PRODUCT / IA & UX / DESIGN / ASSETS
 *     Each section = <section role="region" aria-label="…"> + SectionHeader + Card of Rows
 *
 * Row anatomy: freshness dot · name · meta (monospace if file-ish) · trailing action
 *   - up-to-date/draft with path → "Open" button
 *   - draft with path → additional always-visible "Regenerate" secondary action
 *   - missing → "Create" primary button
 *   - generating → "generating…" replacing action
 *
 * Generate flow:
 *   Create/Regenerate → CreateArtifactDialog (guiding copy + optional guidance)
 *   → Generate → bridge.enqueue({kind:"generate-artifact", payload:{artifact:key, guidance}})
 *   → inline "generating…" + invalidateQueries on enqueue-resolve + 3s delayed re-invalidate
 *   → refetchInterval while pending rows exist → cleanup on unmount
 *
 * Failure surfacing (results do NOT flow on the SSE — POST /pipeline/result is
 * stored, never broadcast; only worker-streamed /pipeline/event frames are):
 *   - While any row is pending, subscribe to bridge.events(); a failure-shaped
 *     frame for a tracked enqueue-id (adapter {type:"error"} chunk, or a
 *     terminal complete/done/result frame with a failed/non-zero status) clears
 *     pending and shows a row-level error note with Retry.
 *   - Regardless, a 5-minute pending timeout converts the row to the same
 *     error note (the reliable guard against the "stuck forever" spinner).
 *
 * Open: bridge.openPath(row.path) → BridgeError → row-level amber note (no modal)
 *
 * Focus: ?focus=<key> search param → scroll-to + highlight that row → clear search
 *
 * SELECTOR DISCIPLINE: every useAppStore call selects a single primitive or
 * stable stored reference. Never return a new object literal from a selector.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Bridge, ArtifactRow } from "../lib/bridge.js";
import { BridgeError } from "../lib/bridge.js";
import type { ArtifactGroup } from "../lib/bridge.js";
import { Card, Row, SectionHeader } from "../components/index.js";
import { CreateArtifactDialog } from "../components/CreateArtifactDialog.js";
import { ArtifactEditor } from "./ArtifactEditor.js";
import { useAppStore } from "../stores/app.js";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { snapshotQuery, enqueueMutation, queryKeys, activeRoot } from "../queries.js";
import { getRouteApi, useNavigate } from "@tanstack/react-router";

// Typed search access without importing artifactsRoute (router.tsx imports this
// screen — a route-object import would be circular). getRouteApi resolves the
// route by path through the Register augmentation, so `focus` stays typed.
const artifactsRouteApi = getRouteApi("/tabs/artifacts");

// ─── Group registry (fixed order per PRD §4) ─────────────────────────────────

const GROUPS: Array<{ group: ArtifactGroup; label: string }> = [
  { group: "product", label: "PRODUCT" },
  { group: "ia-ux", label: "IA & UX" },
  { group: "design", label: "DESIGN" },
  { group: "assets", label: "ASSETS" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusToDot(
  status: ArtifactRow["status"],
): "green" | "amber" | "hollow" {
  if (status === "up-to-date") return "green";
  if (status === "draft") return "amber";
  return "hollow";
}

/** True when meta looks like a filename (has a file extension). */
function isFileMeta(meta: string): boolean {
  return /\.[a-z]{1,6}$/i.test(meta);
}

/** Pending rows flip to a row-level error after this long without resolution. */
export const PENDING_TIMEOUT_MS = 5 * 60 * 1000;

/** Row-level note shown when generation fails or times out. */
const GENERATION_FAILED_MSG = "Generation failed — see worker logs";

/**
 * True when an SSE frame payload signals a failed generation.
 *
 * The bridge never broadcasts POST /pipeline/result on the SSE, so terminal
 * status arrives opportunistically at best: an adapter {type:"error"} chunk
 * today, or a worker-emitted terminal frame (complete/done/result carrying a
 * failed/non-zero status) if one is ever added. Both shapes are handled; the
 * 5-minute timeout remains the reliable guard.
 */
function isFailureEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const e = event as { type?: unknown; status?: unknown; outcome?: unknown };
  if (e.type === "error") return true;
  if (e.type === "complete" || e.type === "done" || e.type === "result") {
    if (e.outcome === "failed" || e.status === "failed") return true;
    if (typeof e.status === "number" && e.status !== 0) return true;
  }
  return false;
}

// ─── Artifacts screen ─────────────────────────────────────────────────────────

export function Artifacts({ bridge }: { bridge: Bridge }): React.JSX.Element {
  // SELECTOR DISCIPLINE: single primitive/stable reference per selector
  const queryClient = useQueryClient();
  const hasPendingRef = useRef(false); // set below from pendingKeys.size
  const snapshotResult = useQuery({
    ...snapshotQuery(bridge),
    refetchInterval: () => (hasPendingRef.current ? 5000 : false),
  });
  const snapshot = snapshotResult.data ?? null;
  const navigate = useNavigate();
  const search = artifactsRouteApi.useSearch();
  const focusArtifactKey = search.focus;

  // ── Local state ─────────────────────────────────────────────────────────────

  /** Artifact keys currently being generated (enqueue in flight). */
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  hasPendingRef.current = pendingKeys.size > 0;
  /** Row-level open errors: key → human-readable message. */
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({});
  /** Row-level generation errors (SSE failure or timeout): key → message. */
  const [genErrors, setGenErrors] = useState<Record<string, string>>({});
  /** Row whose guided-Create dialog is open (null = closed). */
  const [dialogRow, setDialogRow] = useState<ArtifactRow | null>(null);
  /** Highlighted artifact key (from focus intent). */
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  /** Key of the artifact currently open in the in-panel editor (null = inventory). */
  const [editingKey, setEditingKey] = useState<string | null>(null);

  /** DOM refs to each artifact row wrapper, keyed by artifact key. */
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** Enqueue-id → artifact key for every in-flight generation. */
  const pendingIdsRef = useRef<Record<string, string>>({});
  /** Per-key 5-minute pending-timeout handles. */
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Focus intent: scroll-to + highlight + clear search param ────────────────
  // Waits for the snapshot: a MISSING focused artifact auto-opens its
  // elicitation dialog (the Generate tab's required-missing chips land here
  // expecting the interview, not just a highlight). Consuming the param
  // before the snapshot loads would drop that intent on the floor.

  useEffect(() => {
    if (!focusArtifactKey || snapshot === null) return;

    setHighlightedKey(focusArtifactKey);

    const el = rowRefs.current[focusArtifactKey];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    const row = snapshot.artifacts.find((r) => r.key === focusArtifactKey);
    if (row !== undefined && row.status === "missing") {
      setDialogRow(row);
    }

    void navigate({ to: "/tabs/artifacts", search: {} });

    // Fade highlight after 2s
    const timer = setTimeout(() => setHighlightedKey(null), 2000);
    return () => clearTimeout(timer);
  }, [focusArtifactKey, snapshot, navigate]);

  // ── Pending cleanup when snapshot updates ────────────────────────────────────

  useEffect(() => {
    if (!snapshot || pendingKeys.size === 0) return;

    const stillPending = new Set(
      [...pendingKeys].filter((key) => {
        const row = snapshot.artifacts.find((r) => r.key === key);
        // Keep pending if row is still missing/draft (not yet up-to-date)
        return !row || row.status !== "up-to-date";
      }),
    );

    if (stillPending.size !== pendingKeys.size) {
      setPendingKeys(stillPending);
    }
  }, [snapshot, pendingKeys]);

  // ── Failure surfacing: mark a pending generation as failed ──────────────────

  /** Clear pending state for a key and surface the row-level error note. */
  const failGeneration = useCallback((key: string): void => {
    const timer = timersRef.current[key];
    if (timer !== undefined) {
      clearTimeout(timer);
      delete timersRef.current[key];
    }
    for (const [reqId, k] of Object.entries(pendingIdsRef.current)) {
      if (k === key) delete pendingIdsRef.current[reqId];
    }
    setPendingKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setGenErrors((prev) => ({ ...prev, [key]: GENERATION_FAILED_MSG }));
  }, []);

  // ── SSE: surface failed results for tracked enqueue-ids while pending ───────

  const hasPending = pendingKeys.size > 0;

  useEffect(() => {
    if (!hasPending) return;

    const teardown = bridge.events((ev) => {
      const key = pendingIdsRef.current[ev.requestId];
      if (key === undefined) return;
      if (isFailureEvent(ev.event)) failGeneration(key);
    });

    return teardown;
  }, [hasPending, bridge, failGeneration]);

  // ── Prune timers/enqueue-ids for keys that resolved (left pendingKeys) ──────

  useEffect(() => {
    for (const [key, timer] of Object.entries(timersRef.current)) {
      if (!pendingKeys.has(key)) {
        clearTimeout(timer);
        delete timersRef.current[key];
      }
    }
    for (const [reqId, key] of Object.entries(pendingIdsRef.current)) {
      if (!pendingKeys.has(key)) delete pendingIdsRef.current[reqId];
    }
  }, [pendingKeys]);

  // Clear all outstanding timeout timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, []);

  const enqueue = useMutation(enqueueMutation(bridge));

  // ── Open artifact in external editor via bridge (the ↗ icon button) ──────────

  async function handleExternalOpen(row: ArtifactRow): Promise<void> {
    if (!row.path) return;
    try {
      await bridge.openPath(row.path);
    } catch (err) {
      const msg =
        err instanceof BridgeError
          ? `Could not open file (error ${err.status})`
          : "Could not open file";
      setOpenErrors((prev) => ({ ...prev, [row.key]: msg }));
    }
  }

  // ── Enqueue generate-artifact job (from the dialog's Generate) ──────────────

  async function handleGenerate(row: ArtifactRow, guidance: string): Promise<void> {
    setDialogRow(null);
    setGenErrors((prev) => {
      if (!(row.key in prev)) return prev;
      const { [row.key]: _dropped, ...rest } = prev;
      return rest;
    });
    setPendingKeys((prev) => new Set([...prev, row.key]));

    // "Stuck forever" guard: pending flips to a row-level error after 5 min.
    const previousTimer = timersRef.current[row.key];
    if (previousTimer !== undefined) clearTimeout(previousTimer);
    timersRef.current[row.key] = setTimeout(
      () => failGeneration(row.key),
      PENDING_TIMEOUT_MS,
    );

    try {
      const { id } = await enqueue.mutateAsync({
        kind: "generate-artifact",
        payload: { artifact: row.key, guidance },
      });
      pendingIdsRef.current[id] = row.key;
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) }),
        3000,
      );
    } catch {
      // Enqueue failed silently — the 5-minute timeout surfaces the error
    }
  }

  // ── Dialog open/retry ────────────────────────────────────────────────────────

  function openDialog(row: ArtifactRow): void {
    setDialogRow(row);
  }

  function handleRetry(row: ArtifactRow): void {
    setGenErrors((prev) => {
      const { [row.key]: _dropped, ...rest } = prev;
      return rest;
    });
    setDialogRow(row);
  }

  // ── Rollup ───────────────────────────────────────────────────────────────────

  const artifacts = snapshot?.artifacts ?? [];
  const upToDateCount = artifacts.filter((r) => r.status === "up-to-date").length;
  const totalCount = artifacts.length;

  // ── Empty / loading state ────────────────────────────────────────────────────

  if (!snapshot) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center p-8">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  // ── In-panel editor subview ──────────────────────────────────────────────────
  // When editingKey is set the editor fills the tab area; Back clears it.

  const editingRow = editingKey
    ? (artifacts.find((r) => r.key === editingKey) ?? null)
    : null;

  // One dialog instance shared by BOTH branches — the editor branch returns
  // early, so mounting the dialog only in the inventory branch would orphan
  // the editor's Regenerate (state set, nothing rendered).
  const createDialog = (
    <CreateArtifactDialog
      artifactKey={dialogRow?.key ?? ""}
      artifactLabel={dialogRow?.label ?? ""}
      open={dialogRow !== null}
      onOpenChange={(open) => {
        if (!open) setDialogRow(null);
      }}
      onGenerate={(guidance) => {
        if (dialogRow !== null) void handleGenerate(dialogRow, guidance);
      }}
    />
  );

  if (editingRow !== null) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <ArtifactEditor
          artifactKey={editingRow.key}
          label={editingRow.label}
          status={editingRow.status}
          bridge={bridge}
          onBack={() => setEditingKey(null)}
          onRegenerate={() => openDialog(editingRow)}
        />
        {createDialog}
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="flex flex-col gap-4 p-4">

        {/* Heading row */}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">
            {snapshot.name} artifacts
          </h2>
          <span className="text-xs text-gray-500 shrink-0" aria-label="Freshness rollup">
            {upToDateCount} of {totalCount} up to date
          </span>
        </div>

        {/* Subcopy (verbatim per PRD §2) */}
        <p className="text-sm text-gray-500 -mt-2">
          The specifications your designs are verified against.
        </p>

        {/* Grouped inventory */}
        {GROUPS.map(({ group, label }) => {
          const rows = artifacts.filter((r) => r.group === group);
          if (rows.length === 0) return null;

          return (
            <section key={group} role="region" aria-label={label}>
              <Card>
                <SectionHeader>{label}</SectionHeader>

                {rows.map((row) => {
                  const isPending = pendingKeys.has(row.key);
                  const openError = openErrors[row.key];
                  const genError = genErrors[row.key];
                  const isHighlighted = highlightedKey === row.key;

                  // Compute display meta: use row.meta if set, else derive from status
                  const displayMeta =
                    row.meta !== "" ? row.meta : row.status === "draft" ? "draft" : "";

                  // Build the trailing action node
                  let action: React.ReactNode;

                  if (isPending) {
                    action = (
                      <span
                        className="text-xs text-gray-400 italic"
                        aria-live="polite"
                        data-testid={`generating-${row.key}`}
                      >
                        generating…
                      </span>
                    );
                  } else if (row.status === "missing") {
                    action = (
                      <button
                        type="button"
                        onClick={() => openDialog(row)}
                        className="text-xs px-2 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                        aria-label={`Create ${row.label}`}
                      >
                        Create
                      </button>
                    );
                  } else if (row.path !== null) {
                    // up-to-date or draft — show Open (in-panel) + ↗ (external);
                    // draft rows also show Regenerate.
                    action = (
                      <div className="flex items-center gap-2">
                        {row.status === "draft" && (
                          <button
                            type="button"
                            onClick={() => openDialog(row)}
                            className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                            aria-label={`Regenerate ${row.label}`}
                          >
                            Regenerate
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingKey(row.key)}
                          className="text-xs text-primary-600 hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          aria-label={`Open ${row.label}`}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleExternalOpen(row)}
                          className="text-xs text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          aria-label="Open in external editor"
                          title="Open in external editor"
                        >
                          ↗
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={row.key}
                      ref={(el) => {
                        rowRefs.current[row.key] = el;
                      }}
                    >
                      <Row
                        dot={statusToDot(row.status)}
                        name={row.label}
                        meta={displayMeta !== "" ? displayMeta : undefined}
                        metaMono={isFileMeta(displayMeta)}
                        action={action}
                        highlighted={isHighlighted}
                      />

                      {/* Row-level open error (amber note, no modal) */}
                      {openError !== undefined && (
                        <p
                          className="text-xs text-warn-600 px-3 pb-2"
                          role="alert"
                          data-testid={`open-error-${row.key}`}
                        >
                          {openError}
                        </p>
                      )}

                      {/* Row-level generation failure (amber note + Retry) */}
                      {genError !== undefined && (
                        <p
                          className="text-xs text-warn-600 px-3 pb-2"
                          role="alert"
                          data-testid={`generate-error-${row.key}`}
                        >
                          {genError}{" "}
                          <button
                            type="button"
                            onClick={() => handleRetry(row)}
                            className="underline text-warn-600 hover:text-warn-700 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                            aria-label={`Retry ${row.label}`}
                          >
                            Retry
                          </button>
                        </p>
                      )}
                    </div>
                  );
                })}
              </Card>
            </section>
          );
        })}
      </div>

      {/* Guided-Create dialog (one instance, driven per-row) */}
      {createDialog}
    </div>
  );
}

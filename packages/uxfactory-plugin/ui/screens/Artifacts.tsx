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
 *   Create/Regenerate → bridge.enqueue({kind:"generate-artifact", payload:{artifact:key}})
 *   → inline "generating…" + refreshSnapshot on enqueue-resolve + 3s delayed re-refresh
 *   → poll every 5s while any row pending → cleanup on unmount
 *
 * Open: bridge.openPath(row.path) → BridgeError → row-level amber note (no modal)
 *
 * Focus: focus.artifactKey (from app store) → scroll-to + highlight that row → clearFocus()
 *
 * SELECTOR DISCIPLINE: every useAppStore call selects a single primitive or
 * stable stored reference. Never return a new object literal from a selector.
 */

import React, { useEffect, useRef, useState } from "react";
import type { Bridge, ArtifactRow } from "../lib/bridge.js";
import { BridgeError } from "../lib/bridge.js";
import type { ArtifactGroup } from "../lib/bridge.js";
import { Card, Row, SectionHeader } from "../components/index.js";
import { useAppStore } from "../stores/app.js";

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

// ─── Artifacts screen ─────────────────────────────────────────────────────────

export function Artifacts({ bridge }: { bridge: Bridge }): React.JSX.Element {
  // SELECTOR DISCIPLINE: single primitive/stable reference per selector
  const snapshot = useAppStore((s) => s.snapshot);
  const refreshSnapshot = useAppStore((s) => s.refreshSnapshot);
  const focusArtifactKey = useAppStore((s) => s.focus?.artifactKey);
  const clearFocus = useAppStore((s) => s.clearFocus);

  // ── Local state ─────────────────────────────────────────────────────────────

  /** Artifact keys currently being generated (enqueue in flight). */
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  /** Row-level open errors: key → human-readable message. */
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({});
  /** Highlighted artifact key (from focus intent). */
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);

  /** DOM refs to each artifact row wrapper, keyed by artifact key. */
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ── Focus intent: scroll-to + highlight + clearFocus ────────────────────────

  useEffect(() => {
    if (!focusArtifactKey) return;

    setHighlightedKey(focusArtifactKey);

    const el = rowRefs.current[focusArtifactKey];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    clearFocus();

    // Fade highlight after 2s
    const timer = setTimeout(() => setHighlightedKey(null), 2000);
    return () => clearTimeout(timer);
  }, [focusArtifactKey, clearFocus]);

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

  // ── Poll every 5s while any artifact is pending ──────────────────────────────

  useEffect(() => {
    if (pendingKeys.size === 0) return;

    const id = setInterval(() => {
      void refreshSnapshot(bridge);
    }, 5000);

    return () => clearInterval(id);
  }, [pendingKeys.size, bridge, refreshSnapshot]);

  // ── Open file via bridge ─────────────────────────────────────────────────────

  async function handleOpen(row: ArtifactRow): Promise<void> {
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

  // ── Enqueue generate-artifact job ────────────────────────────────────────────

  async function handleGenerate(row: ArtifactRow): Promise<void> {
    setPendingKeys((prev) => new Set([...prev, row.key]));
    try {
      await bridge.enqueue({
        kind: "generate-artifact",
        payload: { artifact: row.key },
      });
      void refreshSnapshot(bridge);
      setTimeout(() => void refreshSnapshot(bridge), 3000);
    } catch {
      // Poll will pick up the result; keep pending state
    }
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

  // ── Main render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto bg-gray-50">
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
                        onClick={() => void handleGenerate(row)}
                        className="text-xs px-2 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                        aria-label={`Create ${row.label}`}
                      >
                        Create
                      </button>
                    );
                  } else if (row.path !== null) {
                    // up-to-date or draft — show Open; draft with path also shows Regenerate
                    action = (
                      <div className="flex items-center gap-2">
                        {row.status === "draft" && (
                          <button
                            type="button"
                            onClick={() => void handleGenerate(row)}
                            className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                            aria-label={`Regenerate ${row.label}`}
                          >
                            Regenerate
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleOpen(row)}
                          className="text-xs text-primary-600 hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          aria-label={`Open ${row.label}`}
                        >
                          Open
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
                    </div>
                  );
                })}
              </Card>
            </section>
          );
        })}
      </div>
    </div>
  );
}

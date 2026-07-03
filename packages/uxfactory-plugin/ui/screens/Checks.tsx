/**
 * Checks.tsx — Tiered gate results: the verification console.
 *
 * PRD: .plans/panel/07-checks-PRD.md
 * Spec: docs/superpowers/specs/2026-07-02-uxfactory-panel-redesign-v1-design.md §5 Checks
 *
 * Architecture:
 *   ChecksView — pure presentational component; tests drive this directly with
 *                fixture TierModels. Exported so tests can import it.
 *   Checks     — data container: fetches bridge.latestRender() best-effort, maps
 *                to TierModel, manages history + annotation state.
 *
 * V1 seam (documented per spec honesty table):
 *   bridge.latestRender() → unknown. The container tries to parse it as both a
 *   BatchReport (T1/T2) and a GateResult (T3). Batch report / craft report are not
 *   bridge-served today, so T1, T2, VLM rows are "pending" when live data is absent.
 *   This seam is a one-swap once PP2 adds bridge routes for batch + craft results.
 *
 * Annotation path (T14 note):
 *   `parent.postMessage({pluginMessage:{type:"review",report}}, "*")` is called
 *   directly in `postToMain()`. When T14 adds bus.postToMain(), move this there.
 *
 * Node-ref click (T14 note):
 *   No bus method exists for select/zoom today. The container falls back to
 *   bus.notify(`Node: ${nodeId}`). T14 adds bus.selectNode(nodeId).
 *
 * SELECTOR DISCIPLINE: every useAppStore() / useRunsStore() call selects a
 * single primitive or stable stored reference. Never return a new object literal.
 */

import React, { useEffect, useId, useState } from "react";
import type { Bridge } from "../lib/bridge.js";
import type { PluginBus } from "../lib/plugin-bus.js";
import { toTierModel } from "../lib/tiers.js";
import type { TierId, TierFinding, TierModel, TierRowModel } from "../lib/tiers.js";
import { useAppStore } from "../stores/app.js";
import { useRunsStore } from "../stores/runs.js";
import { Card, SectionHeader } from "../components/index.js";

// ─── Mirrored type (do not import from src/) ────────────────────────────────

/** Subset of ReviewReportLike accepted by `drawReview`. Mirrored from src/annotation-plan.ts. */
interface ReviewReport {
  conformant: boolean;
  findings: Array<{
    requirement?: string;
    property?: string;
    status: string;
    detail: string;
  }>;
  skipped?: unknown[];
  reliability?: "exact" | "best-effort";
}

// ─── Storage shape ───────────────────────────────────────────────────────────

/**
 * M-5: versioned storage payload for persisted run counter + history.
 * Stored at `checks:v1:${fileKey}`.
 * Legacy shape was `HistoryEntry[]` (array) — still accepted for backward compat.
 */
interface ChecksStorage {
  entries: HistoryEntry[];
  /** Monotonic counter: the run number to assign to the CURRENT run. Incremented on each save. */
  runCounter: number;
}

// ─── Local types ────────────────────────────────────────────────────────────

export interface RunMeta {
  unit?: string;
  profile?: string;
  runNumber?: number;
  escalationSkipped?: boolean;
}

export interface HistoryEntry {
  id: string;
  label: string;
  model: TierModel;
}

export interface ChecksViewProps {
  model: TierModel;
  isEmpty: boolean;
  runMeta: RunMeta;
  hasAnnotations: boolean;
  // I-3: isAnnotating removed — post is fire-and-forget; annotate button is never
  // disabled. Removing the prop avoids the phantom `setIsAnnotating(false)` bug
  // (was immediately resetting to false after post, never reaching true in renders).
  historyEntries: HistoryEntry[];
  currentHistoryId?: string;
  onCopyReport(): void;
  onAnnotate(): void;
  onClearAnnotations(): void;
  onNodeRef(nodeId: string): void;
  onComponentsLink(): void;
  onSelectHistory(id: string): void;
  /** Manual escape-hatch: refetch latestRender + rebuild model. */
  onRefresh(): void;
}

// ─── Markdown report builder (pure, deterministic) ───────────────────────────

function buildMarkdownReport(model: TierModel, meta: RunMeta): string {
  const lines: string[] = [];
  lines.push("# UXFactory Check Report");
  if (meta.runNumber !== undefined) lines.push(`Run: #${meta.runNumber}`);
  if (meta.unit) lines.push(`Unit: ${meta.unit}`);
  if (meta.profile) lines.push(`Profile: ${meta.profile}`);
  lines.push("");
  lines.push("## Results");

  for (const row of model.rows) {
    const icon =
      row.status === "pass"
        ? "✓"
        : row.status === "fail"
          ? "✗"
          : row.status === "gated"
            ? "◇"
            : "—";
    const detail = row.stats ?? row.skipReason ?? row.status;
    lines.push(`${row.tier} ${row.name}: ${icon} ${detail}`);
    for (const f of row.findings) {
      const expected = f.expected !== undefined ? ` expected:${String(f.expected)}` : "";
      const actual = f.actual !== undefined ? ` actual:${String(f.actual)}` : "";
      const nodeRef = f.nodeId ? ` (node ${f.nodeId})` : "";
      lines.push(`  - [${f.ruleId}] ${f.message}${expected}${actual}${nodeRef}`);
    }
  }

  lines.push("");
  lines.push(`Open findings: ${model.openFindings}`);
  if (meta.escalationSkipped) lines.push("Escalation: skipped");
  return lines.join("\n");
}

// ─── Status icon ────────────────────────────────────────────────────────────

function TierStatusIcon({ status }: { status: TierRowModel["status"] }): React.JSX.Element {
  if (status === "pass") {
    return (
      <span className="text-green-600 font-bold w-4 shrink-0" aria-hidden="true">
        ✓
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className="text-red-600 font-bold w-4 shrink-0" aria-hidden="true">
        ✗
      </span>
    );
  }
  if (status === "gated") {
    return (
      <span
        className="inline-block w-4 h-4 shrink-0 border-2 border-dashed border-gray-400 rounded"
        aria-hidden="true"
      />
    );
  }
  if (status === "running") {
    return (
      <span
        className="inline-block w-3 h-3 shrink-0 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"
        aria-hidden="true"
      />
    );
  }
  // skipped or pending
  return (
    <span
      className="inline-block w-3 h-3 shrink-0 rounded-full border-2 border-gray-300"
      aria-hidden="true"
    />
  );
}

// ─── Finding card ────────────────────────────────────────────────────────────

function FindingCard({
  finding,
  onNodeRef,
}: {
  finding: TierFinding;
  onNodeRef(nodeId: string): void;
}): React.JSX.Element {
  return (
    <div className="border border-red-200 rounded-[var(--radius-card)] bg-red-50 p-3 flex flex-col gap-1">
      {/* Rule id (mono red) + node ref chip */}
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs text-red-700 shrink-0">
          {finding.ruleId}
        </span>
        {finding.nodeId && (
          <button
            type="button"
            onClick={() => onNodeRef(finding.nodeId!)}
            title={`Select node ${finding.nodeId}`}
            aria-label={`node ${finding.nodeId}`}
            className="text-xs text-blue-600 hover:underline font-mono shrink-0"
          >
            node {finding.nodeId}
          </button>
        )}
      </div>

      {/* Message */}
      <p className="text-xs text-gray-700">{finding.message}</p>

      {/* Expected / actual */}
      {(finding.expected !== undefined || finding.actual !== undefined) && (
        <div className="flex gap-3 text-xs text-gray-500 font-mono">
          {finding.expected !== undefined && (
            <span>expected: {String(finding.expected)}</span>
          )}
          {finding.actual !== undefined && (
            <span>actual: {String(finding.actual)}</span>
          )}
        </div>
      )}

      {/* I-1: render hint with hintPrefix — "nearest: " for token findings, none for craft fixes */}
      {finding.hint && (
        <p className="text-xs text-gray-500 italic">
          {finding.hintPrefix ?? ""}{finding.hint}
        </p>
      )}
    </div>
  );
}

// ─── Tier row ────────────────────────────────────────────────────────────────

function TierRow({
  row,
  isExpanded,
  onToggle,
  onNodeRef,
}: {
  row: TierRowModel;
  isExpanded: boolean;
  onToggle(): void;
  onNodeRef(nodeId: string): void;
}): React.JSX.Element {
  const hasFindings = row.findings.length > 0;
  const rightLabel = row.stats ?? row.skipReason ?? "";

  return (
    <div>
      <button
        type="button"
        onClick={hasFindings ? onToggle : undefined}
        aria-expanded={hasFindings ? isExpanded : undefined}
        aria-label={`${row.tier} ${row.name} ${row.status}${rightLabel ? ` · ${rightLabel}` : ""}`}
        disabled={!hasFindings}
        className={[
          "w-full flex items-center gap-2 px-3 py-2 text-sm text-left",
          hasFindings
            ? "cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            : "",
        ].join(" ")}
      >
        <TierStatusIcon status={row.status} />

        <span className="font-mono text-xs text-gray-400 w-7 shrink-0">
          {row.tier}
        </span>

        <span
          className={`flex-1 font-medium ${row.status === "fail" ? "text-red-700" : "text-gray-800"}`}
        >
          {row.name}
        </span>

        {rightLabel && (
          <span
            className={`text-xs shrink-0 ${
              row.status === "fail"
                ? "text-red-600"
                : row.status === "pass"
                  ? "text-green-600"
                  : "text-gray-400"
            }`}
          >
            {rightLabel}
          </span>
        )}

        {hasFindings && (
          <span className="text-gray-400 text-xs" aria-hidden="true">
            {isExpanded ? "▲" : "▼"}
          </span>
        )}
      </button>

      {isExpanded && hasFindings && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          {row.findings.map((f, i) => (
            <FindingCard key={i} finding={f} onNodeRef={onNodeRef} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Run banner ──────────────────────────────────────────────────────────────

function RunBanner({
  model,
  meta,
  historyEntries,
  currentHistoryId,
  onSelectHistory,
}: {
  model: TierModel;
  meta: RunMeta;
  historyEntries: HistoryEntry[];
  currentHistoryId?: string;
  onSelectHistory(id: string): void;
}): React.JSX.Element {
  const selectId = useId();

  const allPending = model.rows.every(
    (r) => r.status === "pending" || r.status === "gated",
  );
  const hasFail = model.failedTier !== null;
  const allLocalPass =
    !allPending &&
    model.rows
      .filter((r) => r.tier !== "VLM")
      .every((r) => r.status === "pass" || r.status === "skipped");

  // Find the name of the failing tier
  const failingRow = model.rows.find((r) => r.status === "fail");
  const failLabel = failingRow
    ? `${failingRow.tier} · ${failingRow.name}`
    : "";

  const bannerColor = hasFail
    ? "bg-red-50 border-red-200 text-red-700"
    : allLocalPass
      ? "bg-green-50 border-green-200 text-green-700"
      : "bg-gray-50 border-gray-200 text-gray-600";

  const headline = hasFail
    ? `✗ Run failed at ${failLabel}`
    : allLocalPass
      ? "✓ Run passed"
      : "Checking…";

  // Context line
  const contextParts: string[] = [];
  if (meta.unit) contextParts.push(meta.unit);
  if (meta.profile) contextParts.push(`${meta.profile} profile`);
  if (meta.escalationSkipped) contextParts.push("escalation skipped");
  const contextLine = contextParts.join(" · ");

  return (
    <div
      role="banner"
      className={`border rounded-[var(--radius-card)] p-3 flex flex-col gap-1 ${bannerColor}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm">{headline}</span>

        <div className="flex items-center gap-2 shrink-0">
          {meta.runNumber !== undefined && (
            <span className="text-xs font-mono">run #{meta.runNumber}</span>
          )}

          {historyEntries.length > 0 && (
            <div>
              <label htmlFor={selectId} className="sr-only">
                Run history
              </label>
              <select
                id={selectId}
                value={currentHistoryId ?? ""}
                onChange={(e) => onSelectHistory(e.target.value)}
                aria-label="Run history"
                className="text-xs border border-current rounded px-1 py-0.5 bg-transparent"
              >
                <option value="">current</option>
                {historyEntries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {contextLine && (
        <p className="text-xs opacity-75">{contextLine}</p>
      )}
    </div>
  );
}

// ─── ChecksView (presentational, exported for tests) ────────────────────────

export function ChecksView({
  model,
  isEmpty,
  runMeta,
  hasAnnotations,
  historyEntries,
  currentHistoryId,
  onCopyReport,
  onAnnotate,
  onClearAnnotations,
  onNodeRef,
  onComponentsLink,
  onSelectHistory,
  onRefresh,
}: ChecksViewProps): React.JSX.Element {
  const [expandedTier, setExpandedTier] = useState<TierId | undefined>(
    () => model.failedTier ?? undefined,
  );

  // ── Shared Refresh header (visible in all states as escape hatch) ────────────
  const refreshHeader = (
    <div className="flex items-center justify-end px-4 py-2 border-b border-gray-100">
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh checks"
        className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 hover:bg-gray-50"
      >
        Refresh
      </button>
    </div>
  );

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (isEmpty) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {refreshHeader}
        <div className="flex flex-col flex-1 items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm text-gray-600">
            No checks yet — link components and press{" "}
            <strong>Check my design</strong>
          </p>
          <button
            type="button"
            onClick={onComponentsLink}
            className="text-sm text-primary-600 hover:underline font-medium"
          >
            Go to Components →
          </button>
        </div>
      </div>
    );
  }

  // ── Main layout ─────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      {refreshHeader}
      <div className="flex flex-col gap-3 p-4">

        {/* Run banner */}
        <RunBanner
          model={model}
          meta={runMeta}
          historyEntries={historyEntries}
          currentHistoryId={currentHistoryId}
          onSelectHistory={onSelectHistory}
        />

        {/* Tier list */}
        <Card>
          {model.rows.map((row) => (
            <TierRow
              key={row.tier}
              row={row}
              isExpanded={expandedTier === row.tier}
              onToggle={() =>
                setExpandedTier((prev) =>
                  prev === row.tier ? undefined : row.tier,
                )
              }
              onNodeRef={onNodeRef}
            />
          ))}
        </Card>
      </div>

      {/* Footer actions */}
      <div className="mt-auto px-4 py-3 border-t border-gray-100 flex gap-2 flex-wrap justify-between items-center">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCopyReport}
            className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            Copy report
          </button>

          {hasAnnotations && (
            <button
              type="button"
              onClick={onClearAnnotations}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              Clear annotations
            </button>
          )}
        </div>

        {model.openFindings > 0 && (
          <button
            type="button"
            onClick={onAnnotate}
            className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 font-medium"
          >
            Annotate {model.openFindings}{" "}
            {model.openFindings === 1 ? "failure" : "failures"} on canvas
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Checks (container) ─────────────────────────────────────────────────────

export function Checks({
  bridge,
  bus,
}: {
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  // Store selectors — single primitives only
  const setTab = useAppStore((s) => s.setTab);
  // focus?.runId: Checks refetches when a runId intent arrives (generate→Checks
  // navigation). clearFocus is called synchronously so the effect doesn't re-fire.
  const focusRunId = useAppStore((s) => s.focus?.runId);
  const clearFocus = useAppStore((s) => s.clearFocus);

  // Local state
  const [model, setModel] = useState<TierModel>(() => toTierModel({}));
  const [isEmpty, setIsEmpty] = useState(true);
  const [runMeta, setRunMeta] = useState<RunMeta>({ escalationSkipped: true });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | undefined>();
  const [hasAnnotations, setHasAnnotations] = useState(false);
  // I-3: isAnnotating state removed — post is fire-and-forget; annotate button is
  // never disabled. Removing avoids the phantom reset bug (was always set to false).

  // Fetch live data on mount
  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when a runId focus intent arrives (generate→Checks navigation).
  // clearFocus() is called synchronously to prevent the effect from re-firing.
  useEffect(() => {
    if (focusRunId !== undefined) {
      void init();
      clearFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRunId]);

  async function init(): Promise<void> {
    // Resolve fileKey for storage
    let fk: string | undefined;
    try {
      const fi = await bus.fileInfo();
      fk = fi.fileKey;
    } catch {
      /* no fileKey — continue without history */
    }

    // M-5: load run history + persisted monotonic counter from storage.
    // Legacy shape was HistoryEntry[] (array) — still accepted for backward compat.
    let loadedHistory: HistoryEntry[] = [];
    let runCounter = 1; // default for first-ever run
    if (fk) {
      try {
        const stored = await bus.storageGet<ChecksStorage | HistoryEntry[]>(
          `checks:v1:${fk}`,
        );
        if (
          stored !== null &&
          stored !== undefined &&
          typeof stored === "object" &&
          !Array.isArray(stored) &&
          "entries" in stored
        ) {
          // New ChecksStorage format
          const cs = stored as ChecksStorage;
          loadedHistory = cs.entries.slice(0, 20);
          runCounter = cs.runCounter;
        } else if (Array.isArray(stored)) {
          // Legacy HistoryEntry[] format — compute counter from length
          loadedHistory = (stored as HistoryEntry[]).slice(0, 20);
          runCounter = loadedHistory.length + 1;
        }
        if (loadedHistory.length > 0) {
          setHistory(loadedHistory);
        }
      } catch {
        /* non-fatal */
      }
    }

    // Fetch the latest render report from the bridge.
    // V1 seam: the render report (GET /rendered) is the only bridge-served data
    // source today. We try to parse it as both a GateResult (T3) and a BatchReport
    // (T1/T2). Batch + craft reports are not served — those rows will be "pending".
    //
    // AC-5 live tier streaming: deferred to T14/PP2 (run-event plumbing).
    // When T14 adds bridge.events(), a streaming subscription would be established
    // here to receive tier updates in real-time as each tier completes.
    let gotLiveData = false;
    let liveTierModel: TierModel | null = null;
    try {
      const raw = await bridge.latestRender();
      if (raw !== null && raw !== undefined) {
        liveTierModel = toTierModel({
          batchReport: raw,
          verifyResult: raw,
        });
        setModel(liveTierModel);
        setIsEmpty(false);
        gotLiveData = true;

        // Derive run metadata — read store imperatively to avoid stale closure
        const latestRunUnitType = useRunsStore.getState().runs[0]?.unitType;
        setRunMeta({
          unit: latestRunUnitType,
          escalationSkipped: true,
          runNumber: runCounter, // M-5: use persisted counter
        });
      }
    } catch {
      /* keep pending model */
    }

    // M-5: on live data, persist the incremented counter + new history entry.
    if (gotLiveData && fk && liveTierModel !== null) {
      const newEntry: HistoryEntry = {
        id: `run-${runCounter}`,
        label: `Run #${runCounter} · ${liveTierModel.failedTier ? "fail" : "pass"}`,
        model: liveTierModel,
      };
      const updatedHistory = [newEntry, ...loadedHistory].slice(0, 20);
      const payload: ChecksStorage = {
        entries: updatedHistory,
        runCounter: runCounter + 1,
      };
      try {
        await bus.storageSet(`checks:v1:${fk}`, payload);
        setHistory(updatedHistory);
      } catch {
        /* non-fatal — history loss is acceptable */
      }
    }

    // If no live data but history exists, show the most recent history entry
    // rather than the empty state. This covers the case where the bridge is
    // offline but previous check results are stored locally.
    if (!gotLiveData && loadedHistory.length > 0) {
      const mostRecent = loadedHistory[0]!;
      setModel(mostRecent.model);
      setCurrentHistoryId(mostRecent.id);
      setIsEmpty(false);
    }
  }

  // ── Annotation ─────────────────────────────────────────────────────────────

  function handleAnnotate(): void {
    const findings = model.rows
      .filter((r) => r.status === "fail")
      .flatMap((r) => r.findings);

    // I-2: route findings to the correct annotation shape.
    // - T1 coverage findings: have `requirement` → CoverageGap (numbered pin, no node targeting).
    // - Others (T2/T3/VLM): prefer `nodeName` (node NAME matched by drawReview) then `nodeId`.
    const mappedFindings = findings.map((f) => {
      if (f.requirement !== undefined) {
        return {
          requirement: f.requirement,
          property: f.nodeId ?? "",
          status: "unmet" as const,
          detail: `${f.ruleId}: ${f.message}`,
        };
      }
      return {
        property: f.nodeName ?? f.nodeId ?? "",
        status: "unmet" as const,
        detail: `${f.ruleId}: ${f.message}`,
      };
    });

    // M-3: count findings that have no canvas target (no requirement, nodeName, or nodeId).
    // The button label counts ALL findings; a post-post toast reports non-placeables.
    const placeableCount = findings.filter(
      (f) =>
        f.requirement !== undefined ||
        f.nodeName !== undefined ||
        f.nodeId !== undefined,
    ).length;
    const nonPlaceableCount = findings.length - placeableCount;

    const report: ReviewReport = {
      conformant: false,
      findings: mappedFindings,
      reliability: "best-effort",
    };

    bus.postReview(report);
    setHasAnnotations(true);

    // M-3: inform user when some findings had no canvas target
    if (nonPlaceableCount > 0) {
      useAppStore
        .getState()
        .toast(
          `${placeableCount} placeable · ${nonPlaceableCount} without canvas targets`,
        );
    }
  }

  function handleClearAnnotations(): void {
    // Clear by posting an empty review (no findings → no annotations drawn)
    const emptyReport: ReviewReport = {
      conformant: true,
      findings: [],
      reliability: "best-effort",
    };
    bus.postReview(emptyReport);
    setHasAnnotations(false);
  }

  // ── Copy report ────────────────────────────────────────────────────────────

  function handleCopyReport(): void {
    const text = buildMarkdownReport(model, runMeta);
    void navigator.clipboard.writeText(text).catch(() => {
      /* silently ignore clipboard failures */
    });
  }

  // ── Node ref click ─────────────────────────────────────────────────────────

  function handleNodeRef(nodeId: string): void {
    // If it looks like a Figma node id (digits:digits), select it on canvas.
    if (/^\d+:\d+$/.test(nodeId)) {
      bus.selectNodes([nodeId]);
    } else {
      bus.notify(`Node: ${nodeId}`);
    }
  }

  // ── History navigation ─────────────────────────────────────────────────────

  function handleSelectHistory(id: string): void {
    const entry = history.find((e) => e.id === id);
    if (entry) {
      setModel(entry.model);
      setCurrentHistoryId(id);
      setHasAnnotations(false);
      setIsEmpty(false);
    }
  }

  return (
    <ChecksView
      // Remount ChecksView when history selection changes so local
      // expandedTier state is reset from the new model.
      key={currentHistoryId ?? "current"}
      model={model}
      isEmpty={isEmpty}
      runMeta={runMeta}
      hasAnnotations={hasAnnotations}
      historyEntries={history}
      currentHistoryId={currentHistoryId}
      onCopyReport={handleCopyReport}
      onAnnotate={handleAnnotate}
      onClearAnnotations={handleClearAnnotations}
      onNodeRef={handleNodeRef}
      onComponentsLink={() => setTab("components")}
      onSelectHistory={handleSelectHistory}
      onRefresh={() => void init()}
    />
  );
}

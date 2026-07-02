/**
 * Prompt.tsx — Front door to the generate-design pipeline.
 *
 * PRD: .plans/panel/03-prompt-PRD.md
 * Mock: .screenshots/img_3-prompt.png
 *
 * Layout (top → bottom):
 *   1. Composer card (indigo outline): textarea + unit-type chip + platform chip + submit
 *   2. GROUNDED IN chip row (artifact freshness from snapshot)
 *   3. Empty-artifacts callout (when all grounding artifacts are missing)
 *   4. RECENT list (top 3 runs from the runs store with live progress)
 *   5. Footer hint
 *
 * Composer state (unitType, platforms) lives in the runs store so it persists
 * across tab switches within a session.
 *
 * Platform chip uses a native <select> (not Radix Select) for jsdom testability,
 * consistent with the SetupClassification pattern in this codebase.
 *
 * SELECTOR DISCIPLINE: every useAppStore() / useRunsStore() call selects a
 * single primitive or stable stored reference. Never return a new object literal
 * from a selector — React 19 detects a changed snapshot on every render and
 * throws an infinite-update error.
 */

import React, { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Bridge, BridgeEvent } from "../lib/bridge.js";
import type { PluginBus } from "../lib/plugin-bus.js";
import { useAppStore } from "../stores/app.js";
import { useRunsStore } from "../stores/runs.js";
import type { RunEntry, RunStatus } from "../stores/runs.js";
import { Card, SectionHeader } from "../components/index.js";

// ─── Local types ──────────────────────────────────────────────────────────────

/** Duck-typed worker event payload carried inside BridgeEvent.event. */
interface WorkerPayload {
  type?: string;
  phase?: string;
  note?: string;
  /** Outcome key from the gate/craft result. */
  outcome?: string;
  /** Alternative status key some workers emit. */
  status?: string;
  warnings?: unknown;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UNIT_OPTIONS: { label: string; value: string }[] = [
  { label: "Page", value: "page" },
  { label: "Template", value: "template" },
  { label: "Organism", value: "organism" },
  { label: "Molecule", value: "molecule" },
];

/**
 * Artifact keys consumed during generation (grounding set).
 * Order matches the PRD chip row.
 */
const GROUNDING_KEYS = [
  "requirements",
  "brand-colors",
  "fonts",
  "grid",
  "icons",
] as const;

const GROUNDING_LABELS: Record<string, string> = {
  "requirements": "Requirements",
  "brand-colors": "Brand colors",
  "fonts": "Font pairings",
  "grid": "Grid & viewports",
  "icons": "Icon set",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function platformsLabel(platforms: string[]): string {
  return platforms.map(capitalize).join(" + ");
}

function composerPlaceholder(unitType: string): string {
  return unitType === "organism" || unitType === "molecule"
    ? "Describe the component to generate…"
    : "Describe the screen to generate…";
}

/** Map a raw worker status string to the RunStatus vocabulary. */
function toRunStatus(raw: string | undefined): Exclude<RunStatus, "generating"> {
  if (raw === "checked" || raw === "warnings" || raw === "failed") return raw;
  return "failed";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Chip-styled native <select> for testability in jsdom.
 * Consistent with SetupClassification's NativeSelect pattern.
 */
function ChipSelect({
  id,
  value,
  onChange,
  options,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  ariaLabel: string;
}) {
  return (
    <div className="relative inline-flex items-center">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={[
          "appearance-none bg-white border border-gray-300 rounded-full",
          "px-3 py-1 pr-7 text-sm text-gray-700 cursor-pointer",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600",
        ].join(" ")}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        aria-hidden="true"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
    </div>
  );
}

/** Grounding chip: ✓ green / ! amber / hollow gray based on artifact status. */
function GroundingChip({
  label,
  artifactStatus,
  onClick,
}: {
  label: string;
  artifactStatus: "up-to-date" | "draft" | "missing";
  onClick: () => void;
}) {
  const base =
    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs cursor-pointer transition-colors select-none";

  if (artifactStatus === "up-to-date") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label} — up to date`}
        className={`${base} bg-green-50 border-green-500 text-green-700`}
      >
        <span aria-hidden="true">✓</span>
        {label}
      </button>
    );
  }

  if (artifactStatus === "draft") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label} — draft`}
        className={`${base} bg-amber-50 border-amber-500 text-amber-700`}
      >
        <span aria-hidden="true">!</span>
        {label}
      </button>
    );
  }

  // missing — hollow chip, tooltip explains defaults will be used
  return (
    <button
      type="button"
      onClick={onClick}
      title="Generation proceeds with defaults"
      aria-label={`${label} — missing, generation proceeds with defaults`}
      className={`${base} bg-white border-gray-300 text-gray-400`}
    >
      <span
        aria-hidden="true"
        className="w-2 h-2 rounded-full border-2 border-gray-300 shrink-0"
      />
      {label}
    </button>
  );
}

/** Status badge for a run row in the RECENT list. */
function RunBadge({ run }: { run: RunEntry }) {
  if (run.status === "generating") {
    const progressText = run.progress
      ? `${run.progress.phase}${run.progress.note ? ` · ${run.progress.note}` : ""}`
      : "generating…";
    return (
      <span className="text-xs text-gray-400 animate-pulse" aria-label="generating">
        {progressText}
      </span>
    );
  }
  if (run.status === "checked") {
    return (
      <span className="text-xs text-green-700 font-medium" aria-label="checked">
        ✓ checked
      </span>
    );
  }
  if (run.status === "warnings") {
    const count = run.warnings?.length ?? 0;
    return (
      <span className="text-xs text-amber-700 font-medium" aria-label={`${count} warnings`}>
        {count} {count === 1 ? "warning" : "warnings"}
      </span>
    );
  }
  return (
    <span className="text-xs text-red-700 font-medium" aria-label="failed">
      failed
    </span>
  );
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

export function Prompt({
  bridge,
}: {
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  // ── Store selectors — single primitives / stable stored refs only ──────────

  // Snapshot: return the stored reference (null or the classification object).
  // Zustand does not create new objects on unchanged state, so this is stable.
  const snapshotClassification = useAppStore((s) => s.snapshot?.classification ?? null);
  const snapshotArtifacts = useAppStore((s) => s.snapshot?.artifacts ?? null);
  const setTab = useAppStore((s) => s.setTab);

  const runs = useRunsStore((s) => s.runs);
  const composerUnitType = useRunsStore((s) => s.composerUnitType);
  const composerPlatforms = useRunsStore((s) => s.composerPlatforms);
  const setComposerState = useRunsStore((s) => s.setComposerState);

  // ── Local state ────────────────────────────────────────────────────────────
  const [promptText, setPromptText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const unitTypeId = useId();
  const platformId = useId();

  // ── Derived: classification platforms ─────────────────────────────────────
  // Safe to derive here (not in a selector) — no new array literal in selectors.
  const classificationPlatforms: string[] = Array.isArray(
    snapshotClassification?.["platforms"],
  )
    ? (snapshotClassification["platforms"] as string[])
    : [];

  // Effective platforms: stored value (if any) or fall back to all classification platforms.
  const effectivePlatforms =
    composerPlatforms.length > 0 ? composerPlatforms : classificationPlatforms;

  // Platform select value: "__all__" if effectivePlatforms matches all classification platforms.
  const allPlatformsSorted = [...classificationPlatforms].sort().join(",");
  const effectiveSorted = [...effectivePlatforms].sort().join(",");
  const platformSelectValue =
    classificationPlatforms.length === 0 || effectiveSorted === allPlatformsSorted
      ? "__all__"
      : (effectivePlatforms[0] ?? "__all__");

  const platformOptions: { label: string; value: string }[] =
    classificationPlatforms.length > 0
      ? [
          { label: platformsLabel(classificationPlatforms), value: "__all__" },
          ...classificationPlatforms.map((p) => ({
            label: capitalize(p),
            value: p,
          })),
        ]
      : [{ label: "All Platforms", value: "__all__" }];

  // ── Derived: grounding chips from snapshot artifacts ───────────────────────
  const artifacts = Array.isArray(snapshotArtifacts) ? snapshotArtifacts : [];
  const groundingChips = GROUNDING_KEYS.map((key) => {
    const artifact = artifacts.find((a) => a.key === key);
    return {
      key,
      label: GROUNDING_LABELS[key] ?? key,
      status: (artifact?.status ?? "missing") as "up-to-date" | "draft" | "missing",
    };
  });
  const allMissing = groundingChips.every((c) => c.status === "missing");

  // ── SSE subscription — bridge events → run progress / completion ───────────
  useEffect(() => {
    const teardown = bridge.events((ev: BridgeEvent) => {
      // Only dispatch for runs this screen initiated.
      const knownRun = useRunsStore.getState().runs.find((r) => r.id === ev.requestId);
      if (!knownRun) return;

      const payload = ev.event as WorkerPayload;

      if (payload.type === "progress") {
        useRunsStore.getState().progress(ev.requestId, {
          phase: String(payload.phase ?? ""),
          note: String(payload.note ?? ""),
        });
        return;
      }

      if (payload.type === "complete" || payload.type === "done") {
        const rawStatus = payload.outcome ?? payload.status;
        const finalStatus = toRunStatus(rawStatus);
        const warnings = Array.isArray(payload.warnings)
          ? (payload.warnings as string[])
          : undefined;
        useRunsStore.getState().complete(ev.requestId, finalStatus, warnings);
      }
    });

    return teardown;
  }, [bridge]);

  // ── Submit handler ─────────────────────────────────────────────────────────
  async function handleSubmit() {
    const trimmed = promptText.trim();
    if (!trimmed || isSubmitting) return;

    // Snapshot current chip state imperatively to avoid stale closure issues.
    const unitType = useRunsStore.getState().composerUnitType;
    const storedPlatforms = useRunsStore.getState().composerPlatforms;
    const clsPlatforms = Array.isArray(
      useAppStore.getState().snapshot?.classification?.["platforms"],
    )
      ? (useAppStore.getState().snapshot!.classification!["platforms"] as string[])
      : [];
    const platforms = storedPlatforms.length > 0 ? storedPlatforms : clsPlatforms;

    setIsSubmitting(true);
    try {
      const { id } = await bridge.enqueue({
        kind: "generate-design",
        payload: { prompt: trimmed, unitType, platforms },
      });

      useRunsStore.getState().add({
        id,
        prompt: trimmed,
        unitType,
        platforms,
        status: "generating",
      });

      setPromptText(""); // Clear textarea; chips stay via store.
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Platform chip change ───────────────────────────────────────────────────
  function handlePlatformChange(value: string) {
    const currentUnitType = useRunsStore.getState().composerUnitType;
    const platforms =
      value === "__all__" ? classificationPlatforms : [value];
    setComposerState(currentUnitType, platforms);
  }

  // ── Unit-type chip change ──────────────────────────────────────────────────
  function handleUnitTypeChange(value: string) {
    const currentPlatforms = useRunsStore.getState().composerPlatforms;
    setComposerState(value, currentPlatforms);
  }

  // ── Recent runs (top 3 visible) ────────────────────────────────────────────
  const recentRuns = runs.slice(0, 3);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="flex flex-col gap-4 p-4">

        {/* ── Composer card (indigo outline) ─────────────────────────────── */}
        <div className="bg-white border-2 border-primary-600 rounded-[var(--radius-card)] p-3 flex flex-col gap-2">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder={composerPlaceholder(composerUnitType)}
            rows={4}
            aria-label="Prompt"
            className="w-full text-sm text-gray-700 placeholder-gray-400 resize-none focus:outline-none"
          />

          <div className="flex items-center gap-2 flex-wrap justify-between">
            {/* Chip row: unit type + platform */}
            <div className="flex items-center gap-2 flex-wrap">
              <ChipSelect
                id={unitTypeId}
                value={composerUnitType}
                onChange={handleUnitTypeChange}
                options={UNIT_OPTIONS}
                ariaLabel="Unit type"
              />
              {classificationPlatforms.length > 0 && (
                <ChipSelect
                  id={platformId}
                  value={platformSelectValue}
                  onChange={handlePlatformChange}
                  options={platformOptions}
                  ariaLabel="Platform target"
                />
              )}
            </div>

            {/* Circular submit button (↑) */}
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!promptText.trim() || isSubmitting}
              aria-label="Generate design"
              aria-busy={isSubmitting}
              className={[
                "flex items-center justify-center w-9 h-9 rounded-full text-lg font-bold shrink-0 transition-colors",
                promptText.trim() && !isSubmitting
                  ? "bg-primary-600 text-white hover:bg-primary-700"
                  : "bg-primary-300 text-white cursor-not-allowed",
              ].join(" ")}
            >
              ↑
            </button>
          </div>
        </div>

        {/* ── GROUNDED IN chips ─────────────────────────────────────────── */}
        <div>
          <SectionHeader>GROUNDED IN</SectionHeader>
          <div className="flex flex-wrap gap-2 px-3 pt-1 pb-2">
            {groundingChips.map(({ key, label, status }) => (
              <GroundingChip
                key={key}
                label={label}
                artifactStatus={status}
                onClick={() => setTab("artifacts")}
              />
            ))}
          </div>

          {/* Empty-artifacts callout: all grounding chips hollow */}
          {allMissing && (
            <div className="mx-3 mb-2 p-3 bg-gray-100 rounded-[var(--radius-card)] text-xs text-gray-600">
              No artifacts yet — designs will use generation defaults only.{" "}
              <button
                type="button"
                onClick={() => setTab("artifacts")}
                className="text-primary-600 hover:underline font-medium"
              >
                Create artifacts →
              </button>
            </div>
          )}
        </div>

        {/* ── RECENT run list ───────────────────────────────────────────── */}
        {recentRuns.length > 0 && (
          <div>
            <SectionHeader>RECENT</SectionHeader>
            <Card>
              {recentRuns.map((run, idx) => (
                <div
                  key={run.id}
                  className={[
                    "flex flex-col px-3 py-2 gap-0.5",
                    idx < recentRuns.length - 1
                      ? "border-b border-gray-100"
                      : "",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2 justify-between">
                    <span className="flex-1 text-sm text-gray-800 truncate">
                      {run.prompt}
                    </span>
                    {/* View → switches to Checks tab.
                        Note: no ui-state field exists on the app store for run scoping;
                        T9 (Checks screen) will implement run-history scoping independently.
                        We simply switch to the checks tab here. */}
                    <button
                      type="button"
                      onClick={() => setTab("checks")}
                      className="text-xs text-primary-600 hover:underline shrink-0"
                    >
                      View
                    </button>
                  </div>
                  <RunBadge run={run} />
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>

      {/* ── Footer hint ──────────────────────────────────────────────────── */}
      <div className="mt-auto px-4 py-3 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center">
          Generates on canvas using your artifacts &amp; generation defaults.
        </p>
      </div>
    </div>
  );
}

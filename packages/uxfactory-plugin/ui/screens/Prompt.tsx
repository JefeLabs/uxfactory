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

import React, { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import type { Bridge, BridgeEvent } from "../lib/bridge.js";
import type { PluginBus } from "../lib/plugin-bus.js";
import { useAppStore } from "../stores/app.js";
import { useRunsStore } from "../stores/runs.js";
import type { RunEntry, RunStatus } from "../stores/runs.js";
import { Card, SectionHeader } from "../components/index.js";
import { enqueueMutation } from "../queries.js";

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
  /** Node ids from the landing report (when the worker provides them). */
  nodeIds?: unknown;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UNIT_OPTIONS: { label: string; value: string }[] = [
  { label: "User Flow", value: "user-flow" },
  { label: "Home Page", value: "home-page" },
  { label: "Secondary Page", value: "secondary-page" },
  { label: "Tertiary Page", value: "tertiary-page" },
  { label: "Page", value: "page" },
  { label: "Template", value: "template" },
  { label: "Organism", value: "organism" },
  { label: "Molecule", value: "molecule" },
  { label: "Atom", value: "atom" },
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

const COMPOSER_PLACEHOLDER = "Describe the component(s) to generate";

const VIEWPORT_OPTIONS: { label: string; value: string }[] = [
  { label: "Desktop", value: "desktop" },
  { label: "Tablet", value: "tablet" },
  { label: "Mobile", value: "mobile" },
];
const VIEWPORT_VALUES = VIEWPORT_OPTIONS.map((o) => o.value);

const ORIENTATION_OPTIONS: { label: string; value: string }[] = [
  { label: "Auto orientation", value: "auto" },
  { label: "Portrait", value: "portrait" },
  { label: "Landscape", value: "landscape" },
];

const VARIATION_OPTIONS: { label: string; value: string }[] = [
  { label: "1 variation", value: "1" },
  { label: "2 variations", value: "2" },
  { label: "3 variations", value: "3" },
];

const FIDELITY_OPTIONS: { label: string; value: string }[] = [
  { label: "Low fidelity", value: "low" },
  { label: "Medium fidelity", value: "medium" },
  { label: "High fidelity", value: "high" },
];

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
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string; disabled?: boolean }[];
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        disabled={disabled}
        className={[
          "appearance-none bg-white border border-gray-300 rounded-full",
          "px-3 py-1 pr-7 text-sm text-gray-700 cursor-pointer",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600",
          "disabled:opacity-60 disabled:cursor-not-allowed",
        ].join(" ")}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
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

/**
 * Chip-styled viewport picker with a checkbox popup. The trigger shows every
 * selected viewport ("Desktop + Mobile"). `single` (user-flow unit) makes the
 * checkboxes behave radio-like: picking one replaces the selection.
 */
function ViewportMultiSelect({
  selected,
  single,
  onToggle,
}: {
  selected: string[];
  single: boolean;
  onToggle: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    selected.length > 0
      ? VIEWPORT_OPTIONS.filter((o) => selected.includes(o.value))
          .map((o) => o.label)
          .join(" + ")
      : "Viewports";
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        aria-label="Viewports"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={[
          "inline-flex items-center bg-white border border-gray-300 rounded-full",
          "px-3 py-1 pr-7 text-sm text-gray-700 cursor-pointer relative",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600",
        ].join(" ")}
      >
        {label}
        <ChevronDown
          size={12}
          aria-hidden="true"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
      </button>
      {open && (
        <div
          role="group"
          aria-label="Viewport options"
          className="absolute bottom-full left-0 mb-1 z-10 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex flex-col gap-1"
        >
          {VIEWPORT_OPTIONS.map((o) => {
            const checked = selected.includes(o.value);
            // Multi mode: the last checked row can't be unchecked (≥1 viewport).
            const lastChecked = !single && checked && selected.length === 1;
            return (
              <label
                key={o.value}
                className="flex items-center gap-2 text-sm text-gray-700 px-1 py-0.5 cursor-pointer whitespace-nowrap"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={lastChecked}
                  onChange={() => onToggle(o.value)}
                  className="accent-primary-600"
                />
                {o.label}
              </label>
            );
          })}
        </div>
      )}
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
  bus,
}: {
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  // ── Store selectors — single primitives / stable stored refs only ──────────

  // Snapshot: return the stored reference (null or the classification object).
  // Zustand does not create new objects on unchanged state, so this is stable.
  const snapshotClassification = useAppStore((s) => s.snapshot?.classification ?? null);
  const snapshotArtifacts = useAppStore((s) => s.snapshot?.artifacts ?? null);
  const toast = useAppStore((s) => s.toast);

  const navigate = useNavigate();
  const enqueue = useMutation(enqueueMutation(bridge));

  const runs = useRunsStore((s) => s.runs);
  const composerUnitType = useRunsStore((s) => s.composerUnitType);
  const composerPlatforms = useRunsStore((s) => s.composerPlatforms);
  const composerOrientation = useRunsStore((s) => s.composerOrientation);
  const composerVariations = useRunsStore((s) => s.composerVariations);
  const composerFidelity = useRunsStore((s) => s.composerFidelity);
  const setComposerState = useRunsStore((s) => s.setComposerState);

  // ── Local state ────────────────────────────────────────────────────────────
  const [promptText, setPromptText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // User-flow is a single journey: one viewport, no variations.
  const isUserFlow = composerUnitType === "user-flow";

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
        // Node ids from the landing report — stored on the run entry so the
        // View action can scope Checks (and later zoom the canvas).
        const nodeIds = Array.isArray(payload.nodeIds)
          ? (payload.nodeIds as unknown[]).filter(
              (n): n is string => typeof n === "string",
            )
          : undefined;
        useRunsStore.getState().complete(ev.requestId, finalStatus, warnings, nodeIds);
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

    // Non-default composer extras ride the payload; defaults stay off the wire
    // so legacy consumers see byte-identical requests.
    const orientation = useRunsStore.getState().composerOrientation;
    const variations = useRunsStore.getState().composerVariations;
    const fidelity = useRunsStore.getState().composerFidelity;

    setIsSubmitting(true);
    try {
      const { id } = await enqueue.mutateAsync({
        kind: "generate-design",
        payload: {
          prompt: trimmed,
          unitType,
          platforms,
          ...(orientation !== "auto" ? { orientation } : {}),
          ...(variations > 1 ? { variations } : {}),
          ...(fidelity !== "medium" ? { fidelity } : {}),
        },
      });

      // Ordering matters: the run row is added only AFTER enqueue resolves
      // with an id — a rejected enqueue must not leave a phantom row.
      useRunsStore.getState().add({
        id,
        prompt: trimmed,
        unitType,
        platforms,
        status: "generating",
      });

      setPromptText(""); // Clear textarea; chips stay via store.
    } catch {
      // Surface the failure; keep the composer text so the user can retry.
      toast("Generation failed to enqueue — is the bridge running?");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Viewport checkbox toggle ───────────────────────────────────────────────
  // The [] sentinel (fall back to classification platforms at submit) survives
  // until the first explicit toggle; from then on the list is explicit.
  function handleViewportToggle(value: string) {
    const current = effectivePlatforms;
    const has = current.includes(value);
    if (isUserFlow) {
      // Single-select: picking a viewport replaces the selection.
      if (!has) setComposerState({ composerPlatforms: [value] });
      return;
    }
    if (has && current.length <= 1) return; // keep at least one viewport
    const next = VIEWPORT_VALUES.filter((v) =>
      v === value ? !has : current.includes(v),
    );
    setComposerState({ composerPlatforms: next });
  }

  // ── Unit-type chip change ──────────────────────────────────────────────────
  function handleUnitTypeChange(value: string) {
    const partial: Parameters<typeof setComposerState>[0] = {
      composerUnitType: value,
    };
    if (value === "user-flow") {
      // A flow is one journey: clamp to a single viewport and one variation.
      const first =
        VIEWPORT_VALUES.find((v) => effectivePlatforms.includes(v)) ??
        effectivePlatforms[0];
      if (first !== undefined) partial.composerPlatforms = [first];
      partial.composerVariations = 1;
    }
    setComposerState(partial);
  }

  // ── Variations change — high fidelity is single-variation only ─────────────
  function handleVariationsChange(value: string) {
    const n = Number(value);
    const partial: Parameters<typeof setComposerState>[0] = {
      composerVariations: n,
    };
    if (n > 1 && useRunsStore.getState().composerFidelity === "high") {
      partial.composerFidelity = "medium";
    }
    setComposerState(partial);
  }

  // ── Recent runs (top 3 visible) ────────────────────────────────────────────
  const recentRuns = runs.slice(0, 3);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="flex flex-col gap-4 p-4">

        {/* ── Composer card (indigo outline) ─────────────────────────────── */}
        <div className="bg-white border-2 border-primary-600 rounded-[var(--radius-card)] p-3 flex flex-col gap-2">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder={COMPOSER_PLACEHOLDER}
            rows={4}
            aria-label="Prompt"
            className="w-full text-sm text-gray-700 placeholder-gray-400 resize-none focus:outline-none"
          />

          <div className="flex items-center gap-2 flex-wrap justify-between">
            {/* Chip row: unit type + platform */}
            <div className="flex items-center gap-2 flex-wrap">
              <ChipSelect
                value={composerUnitType}
                onChange={handleUnitTypeChange}
                options={UNIT_OPTIONS}
                ariaLabel="Unit type"
              />
              <ViewportMultiSelect
                selected={effectivePlatforms.filter((p) =>
                  VIEWPORT_VALUES.includes(p),
                )}
                single={isUserFlow}
                onToggle={handleViewportToggle}
              />
              <ChipSelect
                value={composerOrientation}
                onChange={(v) => setComposerState({ composerOrientation: v })}
                options={ORIENTATION_OPTIONS}
                ariaLabel="Orientation"
              />
              <ChipSelect
                value={String(composerVariations)}
                onChange={handleVariationsChange}
                options={VARIATION_OPTIONS}
                ariaLabel="Variations"
                disabled={isUserFlow}
              />
              <ChipSelect
                value={composerFidelity}
                onChange={(v) => setComposerState({ composerFidelity: v })}
                options={FIDELITY_OPTIONS.map((o) =>
                  o.value === "high" && composerVariations > 1
                    ? { ...o, disabled: true }
                    : o,
                )}
                ariaLabel="Fidelity"
              />
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
                onClick={() => {
                  void navigate({ to: "/tabs/artifacts", search: { focus: key } });
                }}
              />
            ))}
          </div>

          {/* Empty-artifacts callout: all grounding chips hollow */}
          {allMissing && (
            <div className="mx-3 mb-2 p-3 bg-gray-100 rounded-[var(--radius-card)] text-xs text-gray-600">
              No artifacts yet — designs will use generation defaults only.{" "}
              <button
                type="button"
                onClick={() => void navigate({ to: "/tabs/artifacts", search: {} })}
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
                    {/* View → navigate to Checks scoped to this run + canvas select. */}
                    <button
                      type="button"
                      onClick={() => {
                        void navigate({ to: "/tabs/checks", search: { run: run.id } });
                        // Zoom the canvas to the generated nodes if available.
                        if (run.nodeIds && run.nodeIds.length > 0) {
                          bus.selectNodes(run.nodeIds);
                        }
                      }}
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

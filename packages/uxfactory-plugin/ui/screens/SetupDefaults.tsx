/**
 * SetupDefaults.tsx — Setup wizard step 2: generation defaults (profile dials).
 *
 * PRD: .plans/panel/02-project-setup-generation-defaults-PRD.md
 * Mock: .screenshots/img_2-project-setup-2.png
 *
 * SELECTOR DISCIPLINE: every store selector returns a single primitive or a
 * stable stored reference. Never return a new object literal `{}` from a
 * selector — React 19 detects a changed snapshot on every render and throws
 * an infinite-update error.
 */

import React, { useEffect, useId, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { putProfileMutation } from "../queries.js";
import type { Bridge } from "../lib/bridge.js";
import { useAppStore } from "../stores/app.js";
import { useWizardStore } from "../stores/wizard.js";
import { DesignStylePicker, Field, Segmented, StatusPill } from "../components/index.js";
import type { SegmentedOption } from "../components/index.js";
import { suggestDesignStyle } from "../lib/design-styles.js";
import {
  styleLabelToEngine,
  fidelityLabelToEngine,
  flowsLabelToEngine,
  coverageLabelToEngine,
} from "../lib/dials.js";

// ─── Dial option sets ─────────────────────────────────────────────────────────
// Derived from lib/dials.ts maps — single source of truth for label↔engine vocab.
// Options use engine values as `value` and display labels as `label`.
// The Segmented controls work directly with engine vocabulary stored in the
// wizard draft — no conversion needed in the render path.

const STYLE_OPTIONS: SegmentedOption[] = Object.entries(styleLabelToEngine).map(
  ([label, value]) => ({ label, value }),
);

const FIDELITY_OPTIONS: SegmentedOption[] = Object.entries(fidelityLabelToEngine).map(
  ([label, value]) => ({ label, value }),
);

// Flows: Shallow→low, Medium→medium, Deep→high  (dials.ts flowsLabelToEngine)
const FLOWS_OPTIONS: SegmentedOption[] = Object.entries(flowsLabelToEngine).map(
  ([label, value]) => ({ label, value }),
);

// Coverage: Thin→low, Medium→medium, Exhaustive→high  (dials.ts coverageLabelToEngine)
const COVERAGE_OPTIONS: SegmentedOption[] = Object.entries(coverageLabelToEngine).map(
  ([label, value]) => ({ label, value }),
);

// Verbatim caption from PRD 02 §2 (acceptance criteria §6 item 5).
const COVERAGE_CAPTION =
  "Floor for generation without specs — when requirements exist, they take precedence.";

// Tooltip copy for binding consequences (PRD 02 §3).
const VISUAL_TOOLTIP = "At Medium+, a11y/contrast/token checks bind";
// Coverage tooltip: caption + T1 binding consequence (PRD 02 §3).
const COVERAGE_TOOLTIP =
  `${COVERAGE_CAPTION} Coverage ≥ Low → requirement coverage binds (T1).`;

// ─── Category display labels ──────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  marketing: "Marketing",
  ecommerce: "Ecommerce",
  webapp: "Web App",
  news: "News",
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

function industryLabel(ind: string): string {
  return ind.charAt(0).toUpperCase() + ind.slice(1);
}

// ─── InfoTooltip ─────────────────────────────────────────────────────────────

/** Small info icon button that opens a Radix tooltip on hover/focus. */
function InfoTooltip({ label, content }: { label: string; content: string }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          {/* aria-label carries the full tooltip text so assertions can find
              the binding consequence without needing to open the tooltip. */}
          <button
            type="button"
            aria-label={label}
            className="inline-flex items-center justify-center w-4 h-4 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 rounded"
          >
            <Info size={12} aria-hidden="true" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={4}
            className="max-w-xs rounded-[var(--radius-card)] bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          >
            {content}
            <Tooltip.Arrow className="fill-gray-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

// ─── SetupDefaults ────────────────────────────────────────────────────────────

export function SetupDefaults({ bridge }: { bridge: Bridge }) {
  // ── Store selectors (primitives only) ───────────────────────────────────────
  const snapshotName = useAppStore((s) => s.snapshot?.name ?? null);
  const fileInfoName = useAppStore((s) => s.fileInfo?.name ?? null);
  const toastFn = useAppStore((s) => s.toast);

  const category = useWizardStore((s) => s.classification.category);
  const industry = useWizardStore((s) => s.classification.industry);
  const designStyle = useWizardStore((s) => s.classification.designStyle);
  const setClassification = useWizardStore((s) => s.setClassification);
  const style = useWizardStore((s) => s.defaults.style);
  const visual = useWizardStore((s) => s.defaults.visual);
  const editorial = useWizardStore((s) => s.defaults.editorial);
  const flow = useWizardStore((s) => s.defaults.flow);
  const coverage = useWizardStore((s) => s.defaults.coverage);
  const coherence = useWizardStore((s) => s.defaults.coherence);
  const setDefault = useWizardStore((s) => s.setDefault);
  const applySuggestions = useWizardStore((s) => s.applySuggestions);
  const [saving, setSaving] = useState(false);
  const designStyleId = useId();

  // ── Router + mutation ─────────────────────────────────────────────────────────
  const navigate = useNavigate();
  const putProfile = useMutation({
    ...putProfileMutation(bridge),
    onSuccess: () => {
      toastFn("Applies to new runs");
      void navigate({ to: "/tabs/prompt" });
    },
    onError: () => {
      toastFn("Could not save — is the bridge running?");
      setSaving(false);
    },
  });

  // ── Apply suggestions when classification changes ───────────────────────────
  // `applySuggestions` respects `userEdited` flags — it only overwrites fields
  // the user has NOT manually edited. On re-entry, `prefillFrom` marks persisted
  // fields as userEdited so they are protected from re-suggestion.
  useEffect(() => {
    applySuggestions({ category, industry });
    // Run when classification changes (e.g., user went back and changed category).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, industry]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (saving) return;
    setSaving(true);
    // Design style lives in the classification file (the worker and gate read
    // it there) even though it is EDITED here as a generative default. Persist
    // it first with set-or-clear semantics: exploring ("") omits the key.
    const cls = useWizardStore.getState().classification;
    try {
      await bridge.putClassification({
        category: cls.category,
        industry: cls.industry,
        locale: cls.locale,
        platforms: cls.platforms,
        layout: cls.layout,
        ageGroup: cls.ageGroup,
        ...(cls.designStyle ? { designStyle: cls.designStyle } : {}),
      });
    } catch {
      toastFn("Could not save — is the bridge running?");
      setSaving(false);
      return;
    }
    putProfile.mutate({ style, visual, editorial, flow, coverage, coherence });
  }

  function handleBack() {
    void navigate({ to: "/setup/classification" });
  }

  const projectName = snapshotName ?? fileInfoName ?? "Project";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Project header bar (repo path omitted at step 2 per PRD 02 §2) */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <span className="flex-1 text-sm font-semibold text-gray-900 truncate">
          {projectName}
        </span>
        <StatusPill status="connected" />
      </div>

      {/* Scrollable form body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 py-5 space-y-6">
          {/* Heading block */}
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Generation defaults
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              What the agent produces when you generate designs — tone, depth
              and detail. Suggested for{" "}
              <strong className="text-gray-700">
                {categoryLabel(category)} · {industryLabel(industry)}
              </strong>{" "}
              — change anytime.
            </p>
          </div>

          {/* Six dial controls */}
          <div className="space-y-4">
            {/* Design style — a generative default with an explicit exploring
                state; nothing is auto-committed from the industry suggestion. */}
            <Field label="Design style" id={designStyleId} align="start">
              <DesignStylePicker
                id={designStyleId}
                value={designStyle}
                onChange={(v) => setClassification({ designStyle: v })}
                suggested={suggestDesignStyle(category, industry)}
              />
            </Field>

            {/* Tone (renamed from Style — "Style" now means the design style) */}
            <Field label="Tone">
              <Segmented
                options={STYLE_OPTIONS}
                value={style}
                onChange={(v) => setDefault("style", v)}
                ariaLabel="Tone"
              />
            </Field>

            {/* Visual fidelity — info tooltip */}
            <Field label="Visual fidelity">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Segmented
                    options={FIDELITY_OPTIONS}
                    value={visual}
                    onChange={(v) => setDefault("visual", v)}
                    ariaLabel="Visual fidelity"
                  />
                </div>
                <InfoTooltip
                  label={`Visual fidelity: ${VISUAL_TOOLTIP}`}
                  content={VISUAL_TOOLTIP}
                />
              </div>
            </Field>

            {/* Editorial fidelity */}
            <Field label="Editorial fidelity">
              <Segmented
                options={FIDELITY_OPTIONS}
                value={editorial}
                onChange={(v) => setDefault("editorial", v)}
                ariaLabel="Editorial fidelity"
              />
            </Field>

            {/* Flows */}
            <Field label="Flows">
              <Segmented
                options={FLOWS_OPTIONS}
                value={flow}
                onChange={(v) => setDefault("flow", v)}
                ariaLabel="Flows"
              />
            </Field>

            {/* Coverage — info tooltip + caption */}
            <Field label="Coverage">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Segmented
                      options={COVERAGE_OPTIONS}
                      value={coverage}
                      onChange={(v) => setDefault("coverage", v)}
                      ariaLabel="Coverage"
                    />
                  </div>
                  <InfoTooltip
                    label={`Coverage: ${COVERAGE_TOOLTIP}`}
                    content={COVERAGE_TOOLTIP}
                  />
                </div>
                {/* Verbatim caption — acceptance criteria §6 item 5 */}
                <p className="text-xs text-gray-500">{COVERAGE_CAPTION}</p>
              </div>
            </Field>

            {/* Coherence (tentative dial — generation hint only; no check enforcement) */}
            <Field label="Coherence">
              <Segmented
                options={FIDELITY_OPTIONS}
                value={coherence}
                onChange={(v) => setDefault("coherence", v)}
                ariaLabel="Coherence"
              />
            </Field>
          </div>
        </div>
      </div>

      {/* Wizard footer */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
        >
          ← Back
        </button>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className={[
            "px-4 py-2 text-sm font-medium rounded-[var(--radius-card)] transition-colors",
            saving
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-primary-600 text-white hover:bg-primary-700",
          ].join(" ")}
        >
          Save &amp; continue
        </button>
      </div>
    </div>
  );
}

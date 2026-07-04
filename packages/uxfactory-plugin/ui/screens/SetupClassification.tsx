/**
 * SetupClassification.tsx — Setup wizard step 1: project classification + starting mode.
 *
 * PRD: .plans/panel/01-project-setup-classification-PRD.md
 * Mock: .screenshots/img_1-project-setup-1.png
 *
 * SELECTOR DISCIPLINE: every store selector returns a single primitive or a
 * stable stored reference. Never return a new object literal `{}` from a
 * selector — React 19 detects a changed snapshot on every render and throws
 * an infinite-update error.
 */

import React, { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { putClassificationMutation } from "../queries.js";
import type { Bridge, ProjectSnapshot } from "../lib/bridge.js";
import { useAppStore } from "../stores/app.js";
import { useWizardStore } from "../stores/wizard.js";
import { DESIGN_STYLES, suggestDesignStyle } from "../lib/design-styles.js";
import { ChipGroup, Segmented, RadioCard, Field, StatusPill } from "../components/index.js";
import type { ChipGroupOption, SegmentedOption } from "../components/index.js";

// ─── Static option lists ──────────────────────────────────────────────────────

const CATEGORY_OPTIONS: ChipGroupOption[] = [
  { label: "Marketing", value: "marketing" },
  { label: "Ecommerce", value: "ecommerce" },
  { label: "Web App", value: "webapp" },
  { label: "News", value: "news" },
];

const INDUSTRY_OPTIONS: { label: string; value: string }[] = [
  { label: "Corporate", value: "corporate" },
  { label: "Finance", value: "finance" },
  { label: "Healthcare", value: "healthcare" },
  { label: "Education", value: "education" },
  { label: "Retail", value: "retail" },
  { label: "Technology", value: "technology" },
  { label: "Media", value: "media" },
  { label: "Government", value: "government" },
  { label: "Non-profit", value: "non-profit" },
  { label: "Other", value: "other" },
];

const LOCALE_OPTIONS: { label: string; value: string }[] = [
  { label: "English (US)", value: "en-US" },
  { label: "English (UK)", value: "en-GB" },
  { label: "Spanish", value: "es" },
  { label: "French", value: "fr" },
  { label: "German", value: "de" },
  { label: "Japanese", value: "ja" },
  { label: "Chinese (Simplified)", value: "zh-CN" },
  { label: "Portuguese", value: "pt" },
];

const PLATFORM_OPTIONS: ChipGroupOption[] = [
  { label: "Desktop", value: "desktop" },
  { label: "Tablet", value: "tablet" },
  { label: "Mobile", value: "mobile" },
];

const LAYOUT_OPTIONS: SegmentedOption[] = [
  { label: "Responsive", value: "responsive" },
  { label: "Adaptive", value: "adaptive" },
];

const LAYOUT_CAPTIONS: Record<string, string> = {
  responsive: "One fluid layout across your platforms",
  adaptive: "Distinct layouts per platform",
};

const AGE_GROUP_OPTIONS: ChipGroupOption[] = [
  { label: "Under 18", value: "under-18" },
  { label: "18–39", value: "18-39" },
  { label: "40–64", value: "40-64" },
  { label: "65+", value: "65+" },
];

// ─── Scan-derived helpers ─────────────────────────────────────────────────────

function getScanHeading(snapshot: ProjectSnapshot | null): string {
  if (snapshot?.hasClassification) return "Welcome back — review your project profile";
  const reqCount = snapshot?.requirements.length ?? 0;
  const artifactCount = snapshot?.artifacts.length ?? 0;
  if (reqCount > 0 || artifactCount > 0) return "We found existing work";
  return "This looks like a new project";
}

/** Compose the `Detected — …` badge for the "Use existing work" card. */
function getExistingBadge(snapshot: ProjectSnapshot | null): string | undefined {
  if (!snapshot) return undefined;
  const reqCount = snapshot.requirements.length;
  const hasArtifacts = snapshot.artifacts.length > 0;
  const parts: string[] = [];
  if (reqCount > 0) parts.push(`${reqCount} requirement${reqCount !== 1 ? "s" : ""}`);
  if (hasArtifacts) parts.push("design tokens");
  if (parts.length === 0) return undefined;
  return `Detected — ${parts.join(" · ")}`;
}

function hasExistingWork(snapshot: ProjectSnapshot | null): boolean {
  return (snapshot?.requirements.length ?? 0) > 0 || (snapshot?.artifacts.length ?? 0) > 0;
}

// ─── Styled native select ─────────────────────────────────────────────────────
// Native <select> for testability in jsdom (getByLabelText / getByDisplayValue).

function NativeSelect({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-white border border-gray-200 rounded-[var(--radius-card)] px-3 py-2 text-sm text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 pr-8 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
    </div>
  );
}

// ─── SetupClassification ──────────────────────────────────────────────────────

export function SetupClassification({ bridge }: { bridge: Bridge }) {
  // ── Store selectors (primitives only) ───────────────────────────────────────
  const snapshot = useAppStore((s) => s.snapshot);
  const repoPath = useAppStore((s) => s.connection.repoPath);
  const snapshotName = useAppStore((s) => s.snapshot?.name ?? null);
  const fileInfoName = useAppStore((s) => s.fileInfo?.name ?? null);
  const category = useWizardStore((s) => s.classification.category);
  const industry = useWizardStore((s) => s.classification.industry);
  const locale = useWizardStore((s) => s.classification.locale);
  const platforms = useWizardStore((s) => s.classification.platforms);
  const layout = useWizardStore((s) => s.classification.layout);
  const ageGroup = useWizardStore((s) => s.classification.ageGroup);
  const startingMode = useWizardStore((s) => s.classification.startingMode);
  const designStyleDraft = useWizardStore((s) => s.classification.designStyle);
  const setClassification = useWizardStore((s) => s.setClassification);

  // Unset ("" or absent in older drafts) = follow the industry/purpose
  // suggestion; an explicit pick overrides it.
  const designStyle = designStyleDraft || suggestDesignStyle(category, industry);
  const designStyleTraits =
    DESIGN_STYLES.find((s) => s.value === designStyle)?.traits ?? [];
  const applySuggestions = useWizardStore((s) => s.applySuggestions);
  const prefillFrom = useWizardStore((s) => s.prefillFrom);
  const toastFn = useAppStore((s) => s.toast);

  // ── Scan-based initialization ───────────────────────────────────────────────
  // Runs on mount. If the project already has a classification (re-entering
  // setup), prefill the draft from the snapshot so the heading and controls
  // reflect the persisted state. Otherwise, derive the default starting mode
  // from the scan result.
  useEffect(() => {
    if (snapshot?.hasClassification) {
      prefillFrom(snapshot);
    } else if (hasExistingWork(snapshot)) {
      setClassification({ startingMode: "use-existing" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // ── Derived UI values ───────────────────────────────────────────────────────
  const projectName = snapshotName ?? fileInfoName ?? "Project";
  const heading = getScanHeading(snapshot);
  const existingBadge = getExistingBadge(snapshot);
  const isEmpty = !hasExistingWork(snapshot) && !snapshot?.hasClassification;
  const canContinue = Boolean(category);
  const industryId = useId();
  const localeId = useId();
  const designStyleId = useId();
  const [saving, setSaving] = useState(false);

  // ── Router + mutation ─────────────────────────────────────────────────────────
  const navigate = useNavigate();
  const putClassification = useMutation({
    ...putClassificationMutation(bridge),
    onSuccess: () => {
      applySuggestions({ category, industry });
      void navigate({ to: "/setup/defaults" });
    },
    onError: () => {
      toastFn("Could not save — is the bridge running?");
      setSaving(false);
    },
  });

  // ── Handlers ────────────────────────────────────────────────────────────────
  async function handleContinue() {
    if (!canContinue || saving) return;
    setSaving(true);
    putClassification.mutate({ category, industry, locale, platforms, layout, ageGroup, designStyle });
  }

  function handleBack() {
    void navigate({ to: "/connect" });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Project header bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-gray-900 truncate block">
            {projectName}
          </span>
          {repoPath && (
            <span className="text-xs font-mono text-gray-500 truncate block">
              {repoPath}
            </span>
          )}
        </div>
        <StatusPill status="connected" />
      </div>

      {/* Scrollable form body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 py-5 space-y-6">
          {/* Heading block */}
          <div>
            <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
            <p className="mt-1 text-sm text-gray-500">
              We scanned your repository to see what's already there. Pick how
              you'd like to start.
            </p>
          </div>

          {/* Classification form */}
          <div className="space-y-4">
            <Field label="Category" error={!category ? undefined : undefined}>
              <ChipGroup
                options={CATEGORY_OPTIONS}
                value={category}
                onChange={(v) => setClassification({ category: v as typeof category })}
                ariaLabel="Category"
              />
            </Field>

            <Field label="Industry" id={industryId}>
              <NativeSelect
                id={industryId}
                value={industry}
                onChange={(v) => setClassification({ industry: v })}
                options={INDUSTRY_OPTIONS}
              />
            </Field>

            <Field label="Locale" id={localeId}>
              <NativeSelect
                id={localeId}
                value={locale}
                onChange={(v) => setClassification({ locale: v })}
                options={LOCALE_OPTIONS}
              />
            </Field>

            <Field label="Platforms">
              <ChipGroup
                options={PLATFORM_OPTIONS}
                values={platforms}
                onChange={(v) =>
                  setClassification({ platforms: v as string[] })
                }
                multi
                ariaLabel="Platforms"
              />
            </Field>

            <Field label="Layout">
              <div className="space-y-1">
                <Segmented
                  options={LAYOUT_OPTIONS}
                  value={layout}
                  onChange={(v) =>
                    setClassification({ layout: v as typeof layout })
                  }
                  ariaLabel="Layout"
                />
                <p className="text-xs text-gray-500">
                  {LAYOUT_CAPTIONS[layout] ?? ""}
                </p>
              </div>
            </Field>

            <Field label="Age group">
              <ChipGroup
                options={AGE_GROUP_OPTIONS}
                value={ageGroup}
                onChange={(v) => setClassification({ ageGroup: v as string })}
                ariaLabel="Age group"
              />
            </Field>

            <Field label="Design style" id={designStyleId}>
              <div className="space-y-1">
                <select
                  id={designStyleId}
                  value={designStyle}
                  onChange={(e) => setClassification({ designStyle: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-[var(--radius-card)] px-3 py-2 bg-white text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                >
                  {DESIGN_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                      {s.value === suggestDesignStyle(category, industry)
                        ? " (suggested)"
                        : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">
                  {designStyleTraits.join(" · ")}
                </p>
              </div>
            </Field>
          </div>

          {/* Starting-mode radio cards */}
          <div
            role="radiogroup"
            aria-label="Starting mode"
            className="space-y-3"
          >
            <RadioCard
              title="Start fresh"
              badge={isEmpty ? "Detected — project is empty" : undefined}
              selected={startingMode === "start-fresh"}
              onSelect={() => setClassification({ startingMode: "start-fresh" })}
            >
              No specs found yet. UX Factory will help you create your first
              specifications from your designs.
            </RadioCard>

            {/* PRD-01 §2: on empty repo, "Use existing work" gets a dimmed look
                (reduced opacity) while remaining fully selectable. Wrap in a div
                for opacity — do NOT change the RadioCard kit component itself. */}
            <div className={isEmpty ? "opacity-50" : undefined}>
              <RadioCard
                title="Use existing work"
                badge={existingBadge}
                selected={startingMode === "use-existing"}
                onSelect={() => setClassification({ startingMode: "use-existing" })}
              >
                {isEmpty ? (
                  <>
                    Nothing detected — you can still point us at your specs later
                    in <span className="font-medium">Artifacts</span>.
                  </>
                ) : (
                  "For projects that already have specifications, requirements, or design tokens — UX Factory will check your designs against them."
                )}
              </RadioCard>
            </div>
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
          onClick={() => void handleContinue()}
          disabled={!canContinue || saving}
          aria-disabled={!canContinue || saving}
          className={[
            "px-4 py-2 text-sm font-medium rounded-[var(--radius-card)] transition-colors",
            canContinue && !saving
              ? "bg-primary-600 text-white hover:bg-primary-700"
              : "bg-gray-200 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

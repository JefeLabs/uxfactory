/**
 * ExpandedHeader.tsx — Expanded project header with classification + dial chips
 * and an inline quick-dial row.
 *
 * PRD: .plans/panel/04-artifacts-PRD.md §2 Layout §1
 *
 * Contract:
 *   export function ExpandedHeader({bridge}: {bridge: Bridge})
 *
 * Classification chips (Category/Industry/Locale/Age/Platforms/Layout):
 *   click → wizard.prefillFrom(snapshot) + goto("setup-1") (edit mode)
 *
 * Dial chips (Style/Visual/Editorial/Flows/Coverage/Coherence):
 *   click → toggles inline Segmented for that dial
 *   Segmented change → bridge.putProfile({<wireKey>: <engineValue>}) (flat, single-field)
 *                     + refreshSnapshot(bridge) + toast("Applies to new runs")
 *
 * SELECTOR DISCIPLINE: every useAppStore/useWizardStore call selects a single
 * primitive or stable stored reference. Never return a new object literal.
 */

import React, { useState } from "react";
import type { Bridge, ProjectSnapshot } from "../lib/bridge.js";
import { Chip, Segmented } from "./index.js";
import type { SegmentedOption } from "./index.js";
import { useAppStore } from "../stores/app.js";
import { useWizardStore } from "../stores/wizard.js";
import { engineToLabel, labelToEngine } from "../lib/dials.js";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { putProfileMutation, queryKeys } from "../queries.js";

// ─── Dial configuration ───────────────────────────────────────────────────────

type DialKey = "style" | "visual" | "editorial" | "flows" | "coverage" | "coherence";

interface DialConfig {
  /** Display label on chip and quick-dial heading. */
  label: string;
  /** Wire key used in bridge.putProfile flat body. */
  wireKey: string;
  /** Segmented options (label + engine value). */
  options: SegmentedOption[];
  /** Read the current engine value from snapshot. */
  getValue(snapshot: ProjectSnapshot): string;
  /** Map the current engine value to a display label. */
  getDisplayLabel(snapshot: ProjectSnapshot): string;
}

function scopeOf(snapshot: ProjectSnapshot): Record<string, unknown> {
  const p = snapshot.profile;
  if (!p || typeof p !== "object") return {};
  const s = (p as Record<string, unknown>)["scope"];
  return s && typeof s === "object" && !Array.isArray(s)
    ? (s as Record<string, unknown>)
    : {};
}

function experimentalOf(snapshot: ProjectSnapshot): Record<string, unknown> {
  const p = snapshot.profile;
  if (!p || typeof p !== "object") return {};
  const e = (p as Record<string, unknown>)["experimental"];
  return e && typeof e === "object" && !Array.isArray(e)
    ? (e as Record<string, unknown>)
    : {};
}

function clsStyle(snapshot: ProjectSnapshot): string {
  const cls = snapshot.classification;
  if (!cls) return "mix";
  const v = (cls as Record<string, unknown>)["style"];
  return typeof v === "string" ? v : "mix";
}

const DIAL_CONFIGS: Record<DialKey, DialConfig> = {
  style: {
    label: "Style",
    wireKey: "style",
    options: Object.entries(labelToEngine.style).map(([label, value]) => ({ label, value })),
    getValue: clsStyle,
    getDisplayLabel: (s) => {
      const v = clsStyle(s);
      return engineToLabel.style[v as keyof typeof engineToLabel.style] ?? v;
    },
  },
  visual: {
    label: "Visual",
    wireKey: "visual",
    options: Object.entries(labelToEngine.visual).map(([label, value]) => ({ label, value })),
    getValue: (s) => String(scopeOf(s)["visual"] ?? "medium"),
    getDisplayLabel: (s) => {
      const v = String(scopeOf(s)["visual"] ?? "medium");
      return engineToLabel.visual[v as keyof typeof engineToLabel.visual] ?? v;
    },
  },
  editorial: {
    label: "Editorial",
    wireKey: "editorial",
    options: Object.entries(labelToEngine.editorial).map(([label, value]) => ({ label, value })),
    getValue: (s) => String(scopeOf(s)["editorial"] ?? "medium"),
    getDisplayLabel: (s) => {
      const v = String(scopeOf(s)["editorial"] ?? "medium");
      return engineToLabel.editorial[v as keyof typeof engineToLabel.editorial] ?? v;
    },
  },
  flows: {
    label: "Flows",
    wireKey: "flow", // wire key is "flow" (not "flows"); see project.ts PUT /project/profile
    options: Object.entries(labelToEngine.flows).map(([label, value]) => ({ label, value })),
    getValue: (s) => String(scopeOf(s)["flow"] ?? "medium"),
    getDisplayLabel: (s) => {
      const v = String(scopeOf(s)["flow"] ?? "medium");
      return engineToLabel.flows[v as keyof typeof engineToLabel.flows] ?? v;
    },
  },
  coverage: {
    label: "Coverage",
    wireKey: "coverage",
    options: Object.entries(labelToEngine.coverage).map(([label, value]) => ({ label, value })),
    getValue: (s) => String(scopeOf(s)["coverage"] ?? "medium"),
    getDisplayLabel: (s) => {
      const v = String(scopeOf(s)["coverage"] ?? "medium");
      return engineToLabel.coverage[v as keyof typeof engineToLabel.coverage] ?? v;
    },
  },
  coherence: {
    label: "Coherence",
    wireKey: "coherence",
    options: Object.entries(labelToEngine.coherence).map(([label, value]) => ({ label, value })),
    getValue: (s) => String(experimentalOf(s)["coherence"] ?? "medium"),
    getDisplayLabel: (s) => {
      const v = String(experimentalOf(s)["coherence"] ?? "medium");
      return engineToLabel.coherence[v as keyof typeof engineToLabel.coherence] ?? v;
    },
  },
};

const DIAL_KEYS: DialKey[] = [
  "style",
  "visual",
  "editorial",
  "flows",
  "coverage",
  "coherence",
];

// ─── Classification chips ─────────────────────────────────────────────────────

interface ClassChip {
  id: string;
  label: string;
  value: string;
}

function capitalize(s: unknown): string {
  if (s === undefined || s === null) return "—";
  const str = String(s);
  if (str === "") return "—";
  return str[0]!.toUpperCase() + str.slice(1);
}

function classChipsFrom(snapshot: ProjectSnapshot): ClassChip[] {
  const cls = (snapshot.classification ?? {}) as Record<string, unknown>;
  const platforms = cls["platforms"];
  const platformStr = Array.isArray(platforms)
    ? (platforms as string[]).map(capitalize).join("·")
    : "—";

  return [
    { id: "category", label: "Category", value: capitalize(cls["category"]) },
    { id: "industry", label: "Industry", value: capitalize(cls["industry"]) },
    { id: "locale", label: "Locale", value: String(cls["locale"] ?? "—") || "—" },
    { id: "age", label: "Age", value: String(cls["ageGroup"] ?? "—") || "—" },
    { id: "platforms", label: "Platforms", value: platformStr },
    { id: "layout", label: "Layout", value: capitalize(cls["layout"]) },
  ];
}

// ─── ExpandedHeader ───────────────────────────────────────────────────────────

export function ExpandedHeader({ bridge }: { bridge: Bridge }): React.JSX.Element | null {
  // SELECTOR DISCIPLINE: single primitive / stable reference per selector
  const snapshot = useAppStore((s) => s.snapshot);
  const toast = useAppStore((s) => s.toast);
  const prefillFrom = useWizardStore((s) => s.prefillFrom);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const putProfile = useMutation({
    ...putProfileMutation(bridge),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot });
      toast("Applies to new runs");
    },
  });

  const [activeDialKey, setActiveDialKey] = useState<DialKey | null>(null);

  if (!snapshot) return null;

  const classChips = classChipsFrom(snapshot);

  // ── Classification chip click → edit mode ───────────────────────────────────

  function handleClassificationClick(): void {
    prefillFrom(snapshot!);
    void navigate({ to: "/setup/classification" });
  }

  // ── Dial chip click → toggle quick-dial row ─────────────────────────────────

  function handleDialChipClick(key: DialKey): void {
    setActiveDialKey((prev) => (prev === key ? null : key));
  }

  // ── Dial value change → putProfile mutation (flat, single-field) + invalidate ─

  async function handleDialChange(key: DialKey, engineValue: string): Promise<void> {
    const cfg = DIAL_CONFIGS[key];
    // Failure surfaces via the mutation's onError toast; swallow the rejection
    // so it doesn't propagate to the Segmented onChange caller unhandled.
    await putProfile.mutateAsync({ [cfg.wireKey]: engineValue }).catch(() => {});
  }

  // ── Quick dial row rendering ────────────────────────────────────────────────

  const activeDial = activeDialKey !== null ? DIAL_CONFIGS[activeDialKey] : null;
  const activeValue =
    activeDialKey !== null ? DIAL_CONFIGS[activeDialKey].getValue(snapshot) : "";

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {/* Classification chips — clicking any opens setup step 1 (edit mode) */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Classification">
        {classChips.map((chip) => (
          <Chip
            key={chip.id}
            tone="dial"
            label={chip.label}
            value={chip.value}
            onSelect={handleClassificationClick}
          />
        ))}
      </div>

      {/* Dial chips — clicking opens the inline quick-dial Segmented below */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dials">
        {DIAL_KEYS.map((key) => {
          const cfg = DIAL_CONFIGS[key];
          return (
            <Chip
              key={key}
              tone="dial"
              label={cfg.label}
              value={cfg.getDisplayLabel(snapshot)}
              selected={activeDialKey === key}
              onSelect={() => handleDialChipClick(key)}
            />
          );
        })}
      </div>

      {/* Quick dial row — inline Segmented for the active dial */}
      {activeDial !== null && activeDialKey !== null && (
        <div
          className="flex items-center gap-3 py-1"
          data-testid="quick-dial-row"
          aria-label={`${activeDial.label} quick dial`}
        >
          <span className="text-xs text-gray-500 shrink-0 font-medium">
            {activeDial.label} fidelity
          </span>
          <Segmented
            ariaLabel={`${activeDial.label} fidelity`}
            options={activeDial.options}
            value={activeValue}
            onChange={(v) => void handleDialChange(activeDialKey, v)}
          />
        </div>
      )}
    </div>
  );
}

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

import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, Monitor, SlidersHorizontal, Smartphone, Tablet } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Bridge, BridgeEvent } from "../lib/bridge.js";
import type { PluginBus } from "../lib/plugin-bus.js";
import { useAppStore } from "../stores/app.js";
import { useRunsStore, DEFAULT_DEVICE_CONFIG } from "../stores/runs.js";
import {
  DESIGN_STYLES,
  DESIGN_STYLE_GROUPS,
  designStyleLabel,
  suggestDesignStyle,
} from "../lib/design-styles.js";
import type { DeviceConfig, DeviceSize } from "../stores/runs.js";
import type { RunEntry, RunStatus } from "../stores/runs.js";
import { ActionTooltip, Card, SectionHeader, WorkerBanner } from "../components/index.js";
import { traceQuery, enqueueMutation } from "../queries.js";
import {
  ARTIFACT_PREREQS,
  ARTIFACT_REGISTRY,
  AUTHORING_ORDER,
  COMPONENT_TYPE_MAPPING,
  normalizeQuadrant,
  resolveRequirements,
} from "@uxfactory/spec";
import type { ProjectQuadrant } from "@uxfactory/spec";
import { ARTIFACT_KEY_BY_ID } from "../lib/artifact-mapping.js";

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
  /** Loop iteration number (design loop `iter`). */
  iter?: unknown;
  /** Gate id being worked at this step. */
  gate?: unknown;
  /** Open-findings count at this step. */
  findings?: unknown;
  warnings?: unknown;
  /** Node ids from the landing report (when the worker provides them). */
  nodeIds?: unknown;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const UNIT_OPTIONS: { label: string; value: string }[] = [
  { label: "User Flow", value: "user-flow" },
  { label: "Home Page", value: "home-page" },
  { label: "Landing Page", value: "landing-page" },
  { label: "Secondary Page", value: "secondary-page" },
  { label: "Tertiary Page", value: "tertiary-page" },
  { label: "Page", value: "page" },
  { label: "Template", value: "template" },
  { label: "Organism", value: "organism" },
  { label: "Molecule", value: "molecule" },
  { label: "Atom", value: "atom" },
  // Channel units — fixed-canvas graphics/templates for specific destinations.
  { label: "Email", value: "email" },
  { label: "Instagram Post", value: "instagram-post" },
  { label: "Instagram Story", value: "instagram-story" },
  { label: "YouTube Thumbnail", value: "youtube-thumbnail" },
  { label: "Facebook Post", value: "facebook-post" },
  { label: "X Post", value: "x-post" },
];

/** One grounding chip, resolved from the mapping for the selected type. */
interface GroundingChipModel {
  key: string;
  label: string;
  level: "required" | "recommended" | "optional";
  planned: boolean;
  status: "up-to-date" | "draft" | "missing";
  /** Tooltip naming MISSING trace-graph prerequisites (real edges only). */
  prereqHint?: string;
}

/**
 * Resolve the selected type's artifact requirements into chip models.
 * PRD §2 semantics: planned → disabled coming-soon (never blocks);
 * optional → shown only when the artifact exists; n/a already dropped.
 * Chips list in AUTHORING_ORDER — the order artifacts should be supplied.
 */
function groundingChipsFor(
  unitType: string,
  artifacts: { key: string; status: string }[],
  quadrant: ProjectQuadrant = "greenfield",
): GroundingChipModel[] {
  const orderOf = (id: string) => {
    const i = AUTHORING_ORDER.indexOf(id);
    return i === -1 ? AUTHORING_ORDER.length : i;
  };
  return resolveRequirements(unitType, quadrant)
    .slice()
    .sort((a, b) => orderOf(a.artifactId) - orderOf(b.artifactId))
    .flatMap((req) => {
    if (req.status === "planned") {
      if (req.level === "optional") return [];
      return [{
        key: req.artifactId, label: req.label, level: req.level,
        planned: true, status: "missing" as const,
      }];
    }
    const key = ARTIFACT_KEY_BY_ID[req.artifactId] ?? req.artifactId;
    const status = (artifacts.find((a) => a.key === key)?.status ?? "missing") as
      | "up-to-date" | "draft" | "missing";
    if (req.level === "optional" && status === "missing") return [];
    // Only real edges, and only when the prerequisite is itself missing.
    const missingPrereqs = (ARTIFACT_PREREQS[req.artifactId] ?? [])
      .filter((dep) => {
        const depKey = ARTIFACT_KEY_BY_ID[dep] ?? dep;
        return (artifacts.find((a) => a.key === depKey)?.status ?? "missing") === "missing";
      })
      .map((dep) => ARTIFACT_REGISTRY[dep]?.label ?? dep);
    const prereqHint =
      status === "missing" && missingPrereqs.length > 0
        ? `Needs ${missingPrereqs.join(", ")} first — created in sequence on click`
        : undefined;
    return [{
      key, label: req.label, level: req.level, planned: false, status,
      ...(prereqHint !== undefined ? { prereqHint } : {}),
    }];
  });
}

/** Blocking requirements (required + registered) currently missing. */
function missingBlockingCount(
  unitType: string,
  artifacts: { key: string; status: string }[],
  quadrant: ProjectQuadrant = "greenfield",
): number {
  return resolveRequirements(unitType, quadrant).filter((req) => {
    if (!req.blocking) return false;
    const key = ARTIFACT_KEY_BY_ID[req.artifactId] ?? req.artifactId;
    return (artifacts.find((a) => a.key === key)?.status ?? "missing") === "missing";
  }).length;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function platformsLabel(platforms: string[]): string {
  return platforms.map(capitalize).join(" + ");
}

/** Words that keep their brand casing when the unit label is lowercased. */
const BRAND_WORDS = new Set(["YouTube", "Instagram", "Facebook", "X"]);

/** "Describe the {componentType} to generate" — follows the active unit type. */
function composerPlaceholder(unitType: string): string {
  const label = UNIT_OPTIONS.find((o) => o.value === unitType)?.label ?? "component(s)";
  const phrase = label
    .split(" ")
    .map((word) => (BRAND_WORDS.has(word) ? word : word.toLowerCase()))
    .join(" ");
  return `Describe the ${phrase} to generate`;
}

/**
 * Viewport = device × orientation, one flat pick-list. Dimensions come from the
 * per-category devices configured in Settings (DEFAULT_DEVICE_CONFIG until
 * changed); landscape variants swap width/height.
 */
const VIEWPORT_BASE: {
  label: string;
  value: string;
  category: keyof DeviceConfig;
  landscapeSwap: boolean;
  Icon: typeof Monitor;
  rotated?: boolean;
}[] = [
  { label: "Desktop", value: "desktop", category: "desktop", landscapeSwap: false, Icon: Monitor },
  { label: "Tablet portrait", value: "tablet-portrait", category: "tablet", landscapeSwap: false, Icon: Tablet },
  { label: "Tablet landscape", value: "tablet-landscape", category: "tablet", landscapeSwap: true, Icon: Tablet, rotated: true },
  { label: "Mobile portrait", value: "mobile-portrait", category: "mobile", landscapeSwap: false, Icon: Smartphone },
  { label: "Mobile landscape", value: "mobile-landscape", category: "mobile", landscapeSwap: true, Icon: Smartphone, rotated: true },
];
const VIEWPORT_VALUES = VIEWPORT_BASE.map((o) => o.value);

interface ViewportOption {
  label: string;
  value: string;
  dims: string;
  Icon: typeof Monitor;
  rotated?: boolean;
}

function viewportOptionsFor(devices: DeviceConfig): ViewportOption[] {
  return VIEWPORT_BASE.map((o) => {
    const d = devices[o.category];
    return {
      label: o.label,
      value: o.value,
      dims: o.landscapeSwap ? `${d.height}×${d.width}` : `${d.width}×${d.height}`,
      Icon: o.Icon,
      ...(o.rotated !== undefined ? { rotated: o.rotated } : {}),
    };
  });
}

/** Bare classification tokens ("tablet"/"mobile") display as their portrait variant. */
function normalizeViewport(token: string): string {
  if (token === "tablet") return "tablet-portrait";
  if (token === "mobile") return "mobile-portrait";
  return token;
}

// Count only — the pill's "Variations" type label carries the meaning.
const VARIATION_OPTIONS: { label: string; value: string }[] = [
  { label: "1", value: "1" },
  { label: "2", value: "2" },
  { label: "3", value: "3" },
];

// Design-language labels over engine dial values (low/medium/high on the wire).
const FIDELITY_OPTIONS: { label: string; value: string }[] = [
  { label: "Wireframe", value: "low" },
  { label: "Mockup", value: "medium" },
  { label: "Hi-fi", value: "high" },
];

// Per-request design-style override; "" follows the project's classification.
/**
 * Composer style sentinel. "" means "no per-request override" — its label
 * depends on the project: with a designStyle default it reads
 * "Project default — <Label>"; while exploring (no default) it reads
 * "Exploring", because there is no default to fall back to and the sentinel
 * IS the exploring state. "Exploring" is never offered once a default exists.
 */
function styleSentinelOption(projectStyle: string): { label: string; value: string } {
  return projectStyle !== ""
    ? { label: `Default — ${designStyleLabel(projectStyle)}`, value: "" }
    : { label: "Exploring", value: "" };
}

/** The 36 styles in the SAME category groups the ContextBar editor shows. */
function styleOptionGroups(
  suggested: string,
): { label: string; options: { label: string; value: string }[] }[] {
  return DESIGN_STYLE_GROUPS.map((group) => ({
    label: group.label,
    options: DESIGN_STYLES.filter((s) => s.group === group.id).map((s) => ({
      label: s.value === suggested ? `${s.label} (suggested)` : s.label,
      value: s.value,
    })),
  }));
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
  value,
  onChange,
  options,
  groups,
  ariaLabel,
  disabled = false,
  fullWidth = false,
  size = "md",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string; disabled?: boolean }[];
  /** Optional <optgroup> sections rendered after the flat options. */
  groups?: { label: string; options: { label: string; value: string; disabled?: boolean }[] }[];
  ariaLabel: string;
  disabled?: boolean;
  /** Stretch to the container width — the stacked config column aligns on it. */
  fullWidth?: boolean;
  /** "sm" matches the ContextBar's compact project-config chips. */
  size?: "md" | "sm";
  /** Muted type label rendered inside the pill, left of the selection. */
  label?: string;
}) {
  return (
    <div
      className={[
        fullWidth ? "w-full" : "",
        "relative inline-flex items-center bg-white border border-gray-300 rounded-full",
        size === "sm" ? "px-2 py-0.5 gap-1 text-[11px]" : "px-3 py-1 gap-1.5 text-sm",
        disabled ? "opacity-60" : "",
        "focus-within:ring-2 focus-within:ring-primary-600",
      ].join(" ")}
    >
      {label !== undefined && (
        <span className="text-gray-400 shrink-0 select-none" aria-hidden="true">
          {label}
        </span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        disabled={disabled}
        className={[
          "appearance-none bg-transparent flex-1 min-w-0",
          size === "sm" ? "pr-4" : "pr-5",
          "text-gray-700 cursor-pointer focus:outline-none",
          "disabled:cursor-not-allowed",
        ].join(" ")}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
        {groups?.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown
        size={12}
        aria-hidden="true"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
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
  options,
  selected,
  single,
  onToggle,
  fullWidth = false,
  size = "md",
  label,
}: {
  options: ViewportOption[];
  selected: string[];
  single: boolean;
  onToggle: (v: string) => void;
  /** Stretch to the container width — the stacked config column aligns on it. */
  fullWidth?: boolean;
  /** "sm" matches the ContextBar's compact project-config chips. */
  size?: "md" | "sm";
  /** Muted type label rendered inside the pill, left of the icons. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedOptions = options.filter((o) => selected.includes(o.value));
  const iconSize = size === "sm" ? 12 : 14;
  return (
    <div className={`relative inline-flex ${fullWidth ? "w-full" : ""}`}>
      <button
        type="button"
        aria-label="Viewports"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={[
          fullWidth ? "w-full justify-start" : "",
          "inline-flex items-center gap-1 bg-white border border-gray-300 rounded-full",
          size === "sm" ? "px-2 py-0.5 pr-6 text-[11px]" : "px-3 py-1 pr-7 text-sm",
          "text-gray-700 cursor-pointer relative",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600",
        ].join(" ")}
      >
        {label !== undefined && (
          <span className="text-gray-400 shrink-0 select-none" aria-hidden="true">
            {label}
          </span>
        )}
        {selectedOptions.length > 0 ? (
          <span className="flex items-center gap-1" aria-hidden="true">
            {selectedOptions.map((o) => (
              <o.Icon
                key={o.value}
                size={iconSize}
                className={o.rotated ? "rotate-90" : undefined}
              />
            ))}
          </span>
        ) : (
          <Monitor size={iconSize} aria-hidden="true" />
        )}
        {/* Names live in sr-only text so the trigger stays compact but readable. */}
        <span className="sr-only">
          {selectedOptions.length > 0
            ? selectedOptions.map((o) => o.label).join(" + ")
            : "Viewports"}
        </span>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
      </button>
      {/* Opens DOWNWARD: the composer sits at the top of the scroll area, so an
          upward popup clips its first rows against the scroll container edge.
          fullWidth = the right-edge config column: anchor right so the popup
          (wider than the column) grows leftward instead of off-panel. */}
      {open && (
        <div
          role="group"
          aria-label="Viewport options"
          className={[
            "absolute top-full mt-1 z-10 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex flex-col gap-1",
            fullWidth ? "right-0" : "left-0",
          ].join(" ")}
        >
          {options.map((o) => {
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
                  aria-label={o.label}
                  checked={checked}
                  disabled={lastChecked}
                  onChange={() => onToggle(o.value)}
                  className="accent-primary-600"
                />
                <o.Icon
                  size={14}
                  aria-hidden="true"
                  className={[
                    "text-gray-500 shrink-0",
                    o.rotated ? "rotate-90" : "",
                  ].join(" ")}
                />
                {o.label}
                <span className="text-xs text-gray-400 ml-auto pl-3">{o.dims}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Checkbox with an indeterminate (partial) state — the feature-row control in
 * the enforcement-scope list. `indeterminate` can't be set via JSX, so a ref
 * callback stamps the DOM property.
 */
function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  ariaLabel: string;
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={ariaLabel}
      onChange={onChange}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate && !checked;
      }}
      className="w-3.5 h-3.5 shrink-0 accent-primary-600"
    />
  );
}

/** Grounding chip: ✓ green / ! amber / hollow gray based on artifact status. */
function GroundingChip({
  label,
  artifactStatus,
  onClick,
  level = "recommended",
  planned = false,
  prereqHint,
}: {
  label: string;
  artifactStatus: "up-to-date" | "draft" | "missing";
  onClick: () => void;
  /** Requirement level from the component-type mapping. */
  level?: "required" | "recommended" | "optional";
  /** Planned registry artifacts render disabled — they cannot be created yet. */
  planned?: boolean;
  /** Tooltip naming missing trace-graph prerequisites (real edges only). */
  prereqHint?: string;
}) {
  const base =
    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs cursor-pointer transition-colors select-none";

  if (planned) {
    return (
      <button
        type="button"
        disabled
        title="Coming soon"
        aria-label={`${label} — coming soon`}
        className={`${base} bg-gray-50 border-dashed border-gray-300 text-gray-400 cursor-not-allowed`}
      >
        {label}
      </button>
    );
  }

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

  // required + missing — the create/link affordance chip (PRD §2)
  if (level === "required") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={prereqHint ?? "Required — click to create"}
        aria-label={`${label} — required, missing`}
        className={`${base} bg-white border-red-300 text-red-600 hover:border-red-400`}
      >
        <span aria-hidden="true">+</span>
        {label}
      </button>
    );
  }

  // missing — hollow chip, tooltip explains defaults will be used
  return (
    <button
      type="button"
      onClick={onClick}
      title={prereqHint ?? "Generation proceeds with defaults"}
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
    const p = run.progress;
    let progressText = "generating…";
    if (p) {
      const iter = p.iter !== undefined ? `iter ${p.iter}` : "";
      const head = [iter, p.phase].filter(Boolean).join(" · ");
      const tail = p.note ? ` · ${p.note}` : "";
      progressText = `${head}${tail}` || "generating…";
    }
    // A failing-findings count is the "is it converging?" signal — surface it.
    const failing = p && p.status === "fail" && typeof p.findings === "number" ? p.findings : null;
    return (
      <span className="text-xs text-gray-400 animate-pulse" aria-label="generating">
        {progressText}
        {failing !== null && failing > 0 && (
          <span className="ml-1 text-amber-600">· {failing} failing</span>
        )}
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
  const composerVariations = useRunsStore((s) => s.composerVariations);
  const composerFidelity = useRunsStore((s) => s.composerFidelity);
  const composerDesignStyle = useRunsStore((s) => s.composerDesignStyle);
  const projectDesignStyle =
    typeof snapshotClassification?.["designStyle"] === "string"
      ? (snapshotClassification["designStyle"] as string)
      : "";
  const suggestedDesignStyle = suggestDesignStyle(
    typeof snapshotClassification?.["category"] === "string"
      ? (snapshotClassification["category"] as string)
      : "",
    typeof snapshotClassification?.["industry"] === "string"
      ? (snapshotClassification["industry"] as string)
      : "",
  );
  const deviceConfig = useRunsStore((s) => s.deviceConfig);
  const setComposerState = useRunsStore((s) => s.setComposerState);

  // ── Local state ────────────────────────────────────────────────────────────
  const [promptText, setPromptText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Generate config hidden by default — the Config chip reveals the five
  // controls as a column on the left inside the input area.
  const [configOpen, setConfigOpen] = useState(false);

  // Autosize: the prompt grows with its content (4 rows is the floor) instead
  // of scrolling inside a fixed box. height:auto first so shrinking works too.
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = promptRef.current;
    if (el === null) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [promptText, configOpen]);

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

  // Viewport selection for display/toggling: normalized to known tokens,
  // defaulting to Desktop when nothing resolves selected.
  const knownViewports = effectivePlatforms
    .map(normalizeViewport)
    .filter((p) => VIEWPORT_VALUES.includes(p));
  const selectedViewports = knownViewports.length > 0 ? knownViewports : ["desktop"];

  // User-flow is a single journey: one viewport, no variations.
  const isUserFlow = composerUnitType === "user-flow";

  // ── Derived: type-aware grounding chips from the component-type mapping ────
  const artifacts = Array.isArray(snapshotArtifacts) ? snapshotArtifacts : [];
  // Story-scoped contract: null = all registered stories (no contract on the wire).
  const traceResult = useQuery(traceQuery(bridge));
  const storyOptions = React.useMemo(() => {
    const data = traceResult.data;
    if (data === undefined) return [] as Array<{ id: string; want: string }>;
    const seen = new Set<string>();
    const out: Array<{ id: string; want: string }> = [];
    for (const s of [...data.features.flatMap((f) => f.stories), ...data.unassigned]) {
      if (seen.has(s.storyId)) continue;
      seen.add(s.storyId);
      out.push({ id: s.storyId, want: s.want });
    }
    return out;
  }, [traceResult.data]);
  // Feature hierarchy for the scope selector — features are the unit humans
  // reason about once the backlog grows past a handful of stories.
  const scopeGroups = React.useMemo(() => {
    const data = traceResult.data;
    if (data === undefined) return [];
    const groups = data.features
      .filter((f) => f.stories.length > 0)
      .map((f) => ({
        id: f.featureId,
        name: f.name,
        stories: f.stories.map((s) => ({ id: s.storyId, want: s.want })),
      }));
    if (data.unassigned.length > 0) {
      groups.push({
        id: "__unassigned",
        name: "Unassigned",
        stories: data.unassigned.map((s) => ({ id: s.storyId, want: s.want })),
      });
    }
    return groups;
  }, [traceResult.data]);
  const [scopedStories, setScopedStories] = useState<string[] | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const normalizeScope = (next: string[]): string[] | null =>
    next.length === storyOptions.length ? null : next;
  const toggleStory = (id: string): void => {
    setScopedStories((prev) => {
      const base = prev ?? storyOptions.map((o) => o.id);
      return normalizeScope(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
    });
  };
  const toggleGroup = (ids: string[]): void => {
    setScopedStories((prev) => {
      const base = prev ?? storyOptions.map((o) => o.id);
      const allIn = ids.every((id) => base.includes(id));
      const next = allIn
        ? base.filter((x) => !ids.includes(x))
        : [...new Set([...base, ...ids])];
      return normalizeScope(next);
    });
  };
  // Scope applies only where the gate enforces story coverage: page-tier and
  // flow units. Component tiers are claims-only; channel units hinge on the
  // creative brief — the selector never appears there.
  const unitGroup = COMPONENT_TYPE_MAPPING[composerUnitType]?.group;
  const storyScopeVisible =
    storyOptions.length > 0 && (unitGroup === "pages" || unitGroup === "flows");
  const projectQuadrant = normalizeQuadrant(snapshotClassification?.["quadrant"]);
  const groundingChips = groundingChipsFor(composerUnitType, artifacts, projectQuadrant);
  const missingBlocking = missingBlockingCount(composerUnitType, artifacts, projectQuadrant);
  const allMissing = groundingChips
    .filter((c) => !c.planned)
    .every((c) => c.status === "missing");

  // ── Consume a pending story-scope handoff from Requirements' per-story
  //    Generate action (one-shot: read + clear on mount). ─────────────────────
  useEffect(() => {
    const refs = useAppStore.getState().consumePendingStoryRefs();
    if (refs !== null && refs.length > 0) setScopedStories(refs);
  }, []);

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
          ...(typeof payload.iter === "number" ? { iter: payload.iter } : {}),
          ...(typeof payload.gate === "string" ? { gate: payload.gate } : {}),
          ...(typeof payload.status === "string" ? { status: payload.status } : {}),
          ...(typeof payload.findings === "number" ? { findings: payload.findings } : {}),
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
    const resolved = storedPlatforms.length > 0 ? storedPlatforms : clsPlatforms;
    // Never send an empty viewport list — Desktop is the floor default.
    const platforms = resolved.length > 0 ? resolved : ["desktop"];

    // Non-default composer extras ride the payload; defaults stay off the wire
    // so legacy consumers see byte-identical requests.
    const variations = useRunsStore.getState().composerVariations;
    const fidelity = useRunsStore.getState().composerFidelity;
    const designStyle = useRunsStore.getState().composerDesignStyle;
    const devices = useRunsStore.getState().deviceConfig;
    const sizeOf = (d: DeviceSize) => `${d.width}x${d.height}`;
    const viewportSizes = {
      desktop: sizeOf(devices.desktop),
      tablet: sizeOf(devices.tablet),
      mobile: sizeOf(devices.mobile),
    };
    const isCustomDevices =
      viewportSizes.desktop !== sizeOf(DEFAULT_DEVICE_CONFIG.desktop) ||
      viewportSizes.tablet !== sizeOf(DEFAULT_DEVICE_CONFIG.tablet) ||
      viewportSizes.mobile !== sizeOf(DEFAULT_DEVICE_CONFIG.mobile);

    // Escape-hatch semantics (mapping decision 1): missing blocking artifacts
    // never block submission, but the run is annotated as an ungoverned draft.
    const submitArtifacts = Array.isArray(useAppStore.getState().snapshot?.artifacts)
      ? useAppStore.getState().snapshot!.artifacts
      : [];
    const submitQuadrant = normalizeQuadrant(
      useAppStore.getState().snapshot?.classification?.["quadrant"],
    );
    const ungoverned = missingBlockingCount(unitType, submitArtifacts, submitQuadrant) > 0;

    setIsSubmitting(true);
    try {
      const { id } = await enqueue.mutateAsync({
        kind: "generate-design",
        payload: {
          prompt: trimmed,
          unitType,
          platforms,
          ...(variations > 1 ? { variations } : {}),
          ...(fidelity !== "medium" ? { fidelity } : {}),
          ...(designStyle !== "" ? { designStyle } : {}),
          ...(isCustomDevices ? { viewportSizes } : {}),
          ...(ungoverned ? { ungoverned: true } : {}),
          ...(scopedStories !== null && scopedStories.length > 0
            ? { storyRefs: scopedStories }
            : {}),
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
    const current = selectedViewports;
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
      const first = VIEWPORT_VALUES.find((v) => selectedViewports.includes(v));
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

        <WorkerBanner kind="generate-design" />

        {/* ── Composer row: card (indigo outline) + config droplists OUTSIDE.
              items-stretch: the card matches the open config column's height,
              and the textarea flex-fills the card — no dead space below it. ── */}
        <div className="flex items-stretch gap-2">
          <div className="flex-1 min-w-0 bg-white border-2 border-primary-600 rounded-[var(--radius-card)] p-3 flex flex-col gap-2">
            <div className="flex items-stretch gap-2 flex-1 min-h-0">
              <textarea
                ref={promptRef}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder={composerPlaceholder(composerUnitType)}
                rows={4}
                aria-label="Prompt"
                className="flex-1 min-w-0 text-sm text-gray-700 placeholder-gray-400 resize-none focus:outline-none overflow-hidden"
              />
              {/* Config toggle INSIDE the input area — the droplists deploy
                  outside the card so the textarea never resizes. Sized
                  identically to the submit button (w-8 h-8, 14px icon). */}
              <ActionTooltip label="Generate config">
                <button
                  type="button"
                  aria-label="Generate config"
                  aria-expanded={configOpen}
                  onClick={() => setConfigOpen((v) => !v)}
                  className={[
                    "flex items-center justify-center w-8 h-8 rounded-full border cursor-pointer transition-colors select-none shrink-0 self-start",
                    configOpen
                      ? "bg-primary-50 border-primary-600 text-primary-600"
                      : "bg-white border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700",
                  ].join(" ")}
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                </button>
              </ActionTooltip>
            </div>

            <div className="flex items-center justify-end">
              {/* Circular submit button (↑) */}
              <ActionTooltip label="Generate design">
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!promptText.trim() || isSubmitting}
                  aria-label="Generate design"
                  aria-busy={isSubmitting}
                  className={[
                    "flex items-center justify-center w-8 h-8 rounded-full shrink-0 transition-colors",
                    promptText.trim() && !isSubmitting
                      ? "bg-primary-600 text-white hover:bg-primary-700"
                      : "bg-primary-300 text-white cursor-not-allowed",
                  ].join(" ")}
                >
                  <ArrowUp size={14} strokeWidth={2.5} aria-hidden="true" />
                </button>
              </ActionTooltip>
            </div>
          </div>

          {/* Config droplists — deployed beside the card only while open. */}
          {configOpen && (
            <div className="w-36 flex flex-col gap-1.5 items-stretch shrink-0">
              <>
                <ChipSelect
                  value={composerUnitType}
                  onChange={handleUnitTypeChange}
                  options={UNIT_OPTIONS}
                  ariaLabel="Unit type"
                  label="Type"
                  fullWidth
                  size="sm"
                />
                <ViewportMultiSelect
                  options={viewportOptionsFor(deviceConfig)}
                  selected={selectedViewports}
                  single={isUserFlow}
                  onToggle={handleViewportToggle}
                  label="Viewports"
                  fullWidth
                  size="sm"
                />
                <ChipSelect
                  value={String(composerVariations)}
                  onChange={handleVariationsChange}
                  options={VARIATION_OPTIONS}
                  ariaLabel="Variations"
                  label="Variations"
                  disabled={isUserFlow}
                  fullWidth
                  size="sm"
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
                  label="Fidelity"
                  fullWidth
                  size="sm"
                />
                <ChipSelect
                  value={composerDesignStyle}
                  onChange={(v) => setComposerState({ composerDesignStyle: v })}
                  options={[styleSentinelOption(projectDesignStyle)]}
                  groups={styleOptionGroups(suggestedDesignStyle)}
                  ariaLabel="Design style"
                  label="Style"
                  fullWidth
                  size="sm"
                />
              </>
            </div>
          )}
        </div>

        {/* ── GROUNDED IN chips — resolved per selected type from the mapping ── */}
        <div>
          <SectionHeader>GROUNDED IN</SectionHeader>
          <div className="flex flex-wrap gap-2 px-3 pt-1 pb-2">
            {groundingChips.map(({ key, label, status, level, planned, prereqHint }) => (
              <GroundingChip
                key={key}
                label={label}
                artifactStatus={status}
                level={level}
                planned={planned}
                prereqHint={prereqHint}
                onClick={() => {
                  void navigate({ to: "/tabs/artifacts", search: { focus: key } });
                }}
              />
            ))}
          </div>

          {/* Enforcement scope — a checkbox list of features → stories. Checked
              stories are held by the coverage gate; a strict subset rides as
              storyRefs, the full set sends no contract. */}
          {storyScopeVisible && (
            <div className="px-3 pb-2">
              <button
                type="button"
                onClick={() => setScopeOpen((o) => !o)}
                aria-expanded={scopeOpen}
                aria-label="Enforcement scope"
                className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-primary-700"
              >
                {scopeOpen ? (
                  <ChevronDown className="w-3 h-3 text-gray-400" aria-hidden="true" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-gray-400" aria-hidden="true" />
                )}
                <span className="font-medium">Enforce coverage for</span>
                <span className="text-gray-400">
                  {scopedStories === null
                    ? `all ${storyOptions.length} stories`
                    : `${scopedStories.length} of ${storyOptions.length} stories`}
                </span>
              </button>
              {scopeOpen && (
                <div className="mt-1 border border-gray-200 rounded overflow-hidden">
                  <p className="px-2 py-1 text-[11px] text-gray-400 bg-gray-50 border-b border-gray-100">
                    Checked stories are enforced by the coverage gate on this run.
                  </p>
                  <ul className="max-h-52 overflow-y-auto py-0.5">
                    {scopeGroups.map((g) => {
                      const base = scopedStories ?? storyOptions.map((o) => o.id);
                      const ids = g.stories.map((s) => s.id);
                      const selCount = ids.filter((id) => base.includes(id)).length;
                      const allIn = selCount === g.stories.length;
                      return (
                        <li key={g.id}>
                          <label className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50 cursor-pointer">
                            <TriCheckbox
                              checked={allIn}
                              indeterminate={selCount > 0}
                              onChange={() => toggleGroup(ids)}
                              ariaLabel={`Enforce feature ${g.name}`}
                            />
                            <span className="flex-1 truncate">{g.name}</span>
                            <span className="text-gray-400 font-normal shrink-0">
                              {selCount}/{g.stories.length}
                            </span>
                          </label>
                          <ul>
                            {g.stories.map((s) => {
                              const sel = base.includes(s.id);
                              return (
                                <li key={s.id}>
                                  <label className="flex items-center gap-1.5 pl-6 pr-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={sel}
                                      onChange={() => toggleStory(s.id)}
                                      aria-label={`Enforce story ${s.id}`}
                                      className="w-3.5 h-3.5 shrink-0 accent-primary-600"
                                    />
                                    <span className="flex-1 truncate" title={s.id}>
                                      {s.want || s.id}
                                    </span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Missing blocking requirements → runs are annotated as ungoverned */}
          {missingBlocking > 0 && (
            <p className="px-3 pb-1 text-xs text-amber-700">
              {missingBlocking} required artifact{missingBlocking === 1 ? "" : "s"} missing —
              runs generate as ungoverned drafts.
            </p>
          )}

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

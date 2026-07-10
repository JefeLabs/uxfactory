/**
 * Assets.tsx — Approved asset registry: icon grid, photography tiles,
 * illustration create-card.
 *
 * PRD:  .plans/panel/06-assets-PRD.md
 * Spec: docs/superpowers/specs/2026-07-02-uxfactory-panel-redesign-v1-design.md §5
 *
 * Real in v1:
 *   - Icons: lucide grid (named imports only; no `import *`).
 *     Click / keyboard-Enter → bus.insertIcon(name, iconSvg(name), 24) → toast.
 *   - Illustrations Create → bridge.enqueue generate-artifact + inline state.
 *
 * Fixture seams in v1 (one-swap interfaces in ui/fixtures/assets.ts):
 *   - Photography: 3 fixture tiles (FIXTURE_PHOTOS) with muted placeholders.
 *   - Icon manifest: DEFAULT_ICON_NAMES / FULL_ICON_SET from fixtures; real
 *     manifest lives in the icon-set artifact once the registry is wired.
 *   - Illustration grid: deferred — section shows create-card until the
 *     illustration style artifact exists in the snapshot.
 *
 * Drag-to-canvas: deferred to PP2. The footer hint sets user expectations;
 * click-insert (bus.insertIcon) is the v1 interaction.
 *
 * Bundle discipline:
 *   Only the curated icon set is imported from lucide-react (named imports).
 *   SVG serialization uses renderToStaticMarkup from react-dom/server — Vite
 *   resolves the browser-safe export (react-dom/server.browser); no Node.js
 *   streams are included in the singlefile bundle.
 *
 * SELECTOR DISCIPLINE: every useAppStore call selects a single primitive or
 * stable stored reference. Never return a new object literal from a selector.
 */

import React, { useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Download,
  Edit2,
  Eye,
  EyeOff,
  File,
  Folder,
  Heart,
  Home,
  Image,
  Info,
  Link,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  Minus,
  Phone,
  Plus,
  Search,
  Settings,
  Share2,
  ShoppingCart,
  Star,
  Trash2,
  Unlock,
  Upload,
  User,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Bridge } from "../lib/bridge.js";
import type { PluginBus } from "../lib/plugin-bus.js";
import { useAppStore } from "../stores/app.js";
import { ActionTooltip, Card, ChipGroup } from "../components/index.js";
import {
  FIXTURE_PHOTOS,
  DEFAULT_ICON_NAMES,
  FULL_ICON_SET,
} from "../fixtures/assets.js";
import { enqueueMutation } from "../queries.js";

// ─── Icon registry (curated lucide subset — NO wildcard import) ───────────────

/**
 * Maps fixture/artifact kebab-case icon names to lucide-react components.
 *
 * All entries in FULL_ICON_SET must appear here. Adding a new icon requires:
 *   1. A named import at the top of this file.
 *   2. An entry in this map.
 *   3. A name in FULL_ICON_SET (ui/fixtures/assets.ts).
 *
 * SEAM: when the project icon-set artifact provides the full manifest, this map
 * would be auto-generated from the artifact's glyph list filtered against the
 * available lucide exports (same shape, one import per glyph).
 */
const ICON_MAP: Record<string, LucideIcon> = {
  "alert-circle": AlertCircle,
  "arrow-down": ArrowDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  bell: Bell,
  calendar: Calendar,
  check: Check,
  "check-circle": CheckCircle,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  clock: Clock,
  download: Download,
  "edit-2": Edit2,
  eye: Eye,
  "eye-off": EyeOff,
  file: File,
  folder: Folder,
  heart: Heart,
  home: Home,
  image: Image,
  info: Info,
  link: Link,
  lock: Lock,
  "log-out": LogOut,
  mail: Mail,
  "map-pin": MapPin,
  "message-circle": MessageCircle,
  minus: Minus,
  phone: Phone,
  plus: Plus,
  search: Search,
  settings: Settings,
  "share-2": Share2,
  "shopping-cart": ShoppingCart,
  star: Star,
  "trash-2": Trash2,
  unlock: Unlock,
  upload: Upload,
  user: User,
  x: X,
};

// ─── Placeholder background classes for photo tiles ───────────────────────────
// Explicit class strings so Tailwind v4 includes them in the singlefile build.

const PHOTO_TONE_BG: Record<string, string> = {
  slate: "bg-slate-200",
  stone: "bg-stone-200",
  zinc: "bg-zinc-200",
};

// ─── SVG serialization helper ─────────────────────────────────────────────────

/**
 * Serializes a lucide icon to an SVG string suitable for bus.insertIcon.
 *
 * Uses react-dom/server.browser (browser-safe; no Node.js stream APIs in
 * the Vite singlefile bundle). Falls back to a minimal empty SVG for names
 * that are not in ICON_MAP.
 */
function iconSvg(name: string): string {
  const Icon = ICON_MAP[name];
  if (!Icon) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"></svg>';
  }
  return renderToStaticMarkup(<Icon size={24} strokeWidth={2} />);
}

// ─── Scope filter ─────────────────────────────────────────────────────────────

type ScopeFilter = "all" | "icons" | "photos" | "illustrations";

const SCOPE_OPTIONS: { label: string; value: ScopeFilter }[] = [
  { label: "All", value: "all" },
  { label: "Icons", value: "icons" },
  { label: "Photos", value: "photos" },
  { label: "Illustrations", value: "illustrations" },
];

// ─── Assets screen ────────────────────────────────────────────────────────────

export function Assets({
  bridge,
  bus,
}: {
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  // SELECTOR DISCIPLINE: single primitive / stable ref per selector.
  const snapshot = useAppStore((s) => s.snapshot);
  const toast = useAppStore((s) => s.toast);

  const enqueue = useMutation(enqueueMutation(bridge));

  // ── Local state ───────────────────────────────────────────────────────────

  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [iconsExpanded, setIconsExpanded] = useState(false);
  /** True while the illustration generate-artifact job is in flight. */
  const [illusGenerating, setIllusGenerating] = useState(false);

  // ── Derived values (inline — arrays are small; useMemo not needed) ─────────

  const searchLower = search.toLowerCase().trim();

  /**
   * Icon section header meta:
   *   - Non-missing icons artifact with meta → use that.
   *   - Empty meta or missing artifact → fixture fallback "Lucide · 24px outline".
   */
  const iconsMeta = (() => {
    const artifact = snapshot?.artifacts.find(
      (a) => a.key === "icons" && a.status !== "missing",
    );
    return (artifact?.meta) || "Lucide · 24px outline";
  })();

  /** True when the snapshot has a non-missing illustration style artifact. */
  const illusDefined = (() => {
    const artifact = snapshot?.artifacts.find(
      (a) => a.key === "illustrations",
    );
    return artifact !== undefined && artifact.status !== "missing";
  })();

  /**
   * Icons to display:
   *   - Search active → filter FULL_ICON_SET (show all filtered results).
   *   - No search + expanded → FULL_ICON_SET.
   *   - No search + collapsed → DEFAULT_ICON_NAMES (8 visible in mock).
   */
  const displayedIcons = searchLower
    ? FULL_ICON_SET.filter((n) => n.includes(searchLower))
    : iconsExpanded
      ? FULL_ICON_SET
      : DEFAULT_ICON_NAMES;

  /** Photo tiles — filtered by alt text during search. */
  const displayedPhotos = searchLower
    ? FIXTURE_PHOTOS.filter((p) =>
        p.alt.toLowerCase().includes(searchLower),
      )
    : FIXTURE_PHOTOS;

  /**
   * Illustrations section visibility during search — show when the search
   * term partially matches the section label.
   */
  const illusVisible = !searchLower || "illustrations".includes(searchLower);

  // Scope-gate — hide sections not matching the active filter chip.
  const showIcons = scope === "all" || scope === "icons";
  const showPhotos = scope === "all" || scope === "photos";
  const showIllus = scope === "all" || scope === "illustrations";

  // ── Clear generating state when illustrations become defined ───────────────

  useEffect(() => {
    if (illusDefined) setIllusGenerating(false);
  }, [illusDefined]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Insert a lucide icon at the viewport centre via the plugin bus.
   * SVG is serialized server-side (renderToStaticMarkup) so Figma receives a
   * complete vector string with no React-specific props.
   * On success: toast "Inserted {name}".
   * On failure: silent (no error reason available without typed bus errors).
   */
  async function handleIconClick(name: string): Promise<void> {
    try {
      await bus.insertIcon(name, iconSvg(name), 24);
      toast(`Inserted ${name}`);
    } catch {
      // Insert failures are silent in v1.
    }
  }

  /**
   * Enqueue an illustration style generate-artifact job.
   * The inline "Generating…" state persists until the snapshot shows the
   * illustrations artifact as non-missing (illusDefined effect clears it).
   */
  async function handleCreate(): Promise<void> {
    setIllusGenerating(true);
    try {
      await enqueue.mutateAsync({
        kind: "generate-artifact",
        payload: { artifact: "illustrations" },
      });
      // Generating state persists until snapshot reflects the artifact;
      // the illusDefined useEffect above clears it when the store updates.
    } catch {
      setIllusGenerating(false);
      toast("Could not start generation — is the bridge running?");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="flex flex-col gap-3 p-4">

        {/* Search field */}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search assets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-primary-600"
            aria-label="Search assets"
          />
        </div>

        {/* Filter chips — single-select scope (ChipGroup wraps Radix ToggleGroup; roving tabindex + ArrowLeft/Right handled by Radix) */}
        <ChipGroup
          options={SCOPE_OPTIONS}
          value={scope}
          onChange={(v) => setScope(v as ScopeFilter)}
          ariaLabel="Asset type filter"
        />

        {/* ── ICONS section ──────────────────────────────────────────────── */}
        {showIcons && (
          <section aria-label="ICONS">
            <Card>
              {/* Section header */}
              <div className="flex items-center justify-between px-3 pt-3 pb-2">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    ICONS
                  </span>
                  <span className="text-xs text-gray-400 ml-1">
                    — {iconsMeta}
                  </span>
                </div>

                {/* Expand / Back control — hidden during search (search shows full filtered set) */}
                {!searchLower && !iconsExpanded && (
                  <button
                    type="button"
                    onClick={() => setIconsExpanded(true)}
                    className="text-xs text-primary-600 hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                    aria-label={`Show all ${FULL_ICON_SET.length} icons`}
                  >
                    All {FULL_ICON_SET.length}
                  </button>
                )}
                {iconsExpanded && (
                  <button
                    type="button"
                    onClick={() => setIconsExpanded(false)}
                    className="text-xs text-primary-600 hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  >
                    Back
                  </button>
                )}
              </div>

              {/* Icon grid or no-matches */}
              {displayedIcons.length > 0 ? (
                <div className="grid grid-cols-4 gap-2 px-3 pb-3">
                  {displayedIcons.map((name) => {
                    const Icon = ICON_MAP[name];
                    if (!Icon) return null;
                    return (
                      <ActionTooltip key={name} label={name}>
                        <button
                          type="button"
                          aria-label={name}
                          onClick={() => void handleIconClick(name)}
                          className={[
                            "aspect-square border border-gray-200 rounded-lg",
                            "flex items-center justify-center bg-white",
                            "hover:bg-gray-50 hover:border-primary-300 transition-colors",
                            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600",
                            "cursor-pointer",
                          ].join(" ")}
                        >
                          <Icon
                            size={20}
                            strokeWidth={1.5}
                            className="text-gray-600"
                            aria-hidden="true"
                          />
                        </button>
                      </ActionTooltip>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic px-3 pb-3">
                  No matches
                </p>
              )}
            </Card>
          </section>
        )}

        {/* ── PHOTOGRAPHY section ─────────────────────────────────────────── */}
        {showPhotos && (
          <section aria-label="PHOTOGRAPHY">
            <Card>
              {/* Section header */}
              <div className="flex items-center justify-between px-3 pt-3 pb-2">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    PHOTOGRAPHY
                  </span>
                  {/* v1 fixture meta — real value from photography artifact */}
                  <span className="text-xs text-gray-400 ml-1">
                    — 212 approved · licensed
                  </span>
                </div>
                {/* "All" is a fixture stub — real nav to full registry deferred to PP2 */}
                <span className="text-xs text-gray-400">All</span>
              </div>

              {/* Photo tiles or no-matches */}
              {displayedPhotos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 px-3 pb-3">
                  {displayedPhotos.map((photo) => (
                    <div
                      key={photo.id}
                      role="img"
                      aria-label={photo.alt}
                      className={[
                        "aspect-square rounded-lg flex items-center justify-center",
                        PHOTO_TONE_BG[photo.tone] ?? "bg-gray-200",
                      ].join(" ")}
                    >
                      <Image
                        size={20}
                        className="text-gray-400"
                        aria-hidden="true"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic px-3 pb-3">
                  No matches
                </p>
              )}
            </Card>
          </section>
        )}

        {/* ── ILLUSTRATIONS section ───────────────────────────────────────── */}
        {showIllus && (
          <section aria-label="ILLUSTRATIONS">
            <Card>
              {/* Section header */}
              <div className="flex items-center px-3 pt-3 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  ILLUSTRATIONS
                </span>
                {!illusDefined && (
                  <span className="text-xs text-warn-600 ml-1">
                    — style not defined yet
                  </span>
                )}
              </div>

              {/* Content: create-card, generating state, defined placeholder, or no-matches */}
              {illusVisible ? (
                illusDefined ? (
                  // v1 placeholder when defined — full illustration grid deferred to PP2
                  <p className="text-sm text-gray-500 px-3 pb-3">
                    Illustration style defined.
                  </p>
                ) : illusGenerating ? (
                  <p
                    className="text-sm text-gray-400 italic px-3 pb-3"
                    aria-live="polite"
                    data-testid="illus-generating"
                  >
                    Generating…
                  </p>
                ) : (
                  /* Dashed create-card (style undefined state) */
                  <div className="mx-3 mb-3 border-2 border-dashed border-gray-300 rounded-lg p-4 flex flex-col items-center gap-3">
                    <p className="text-sm text-gray-500 text-center">
                      Define an illustration style so generated designs stay
                      on-brand.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCreate()}
                      className={[
                        "text-sm px-4 py-2 rounded-lg",
                        "bg-primary-600 text-white hover:bg-primary-700",
                        "font-medium",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600",
                      ].join(" ")}
                    >
                      Create
                    </button>
                  </div>
                )
              ) : (
                <p className="text-sm text-gray-400 italic px-3 pb-3">
                  No matches
                </p>
              )}
            </Card>
          </section>
        )}

        {/* Footer hint (verbatim per PRD §2.7) */}
        {/* Note: drag-to-canvas deferred to PP2; click-insert is the v1 interaction. */}
        <p className="text-xs text-gray-400 text-center px-2">
          Drag onto canvas — usage is checked against your asset rules.
        </p>
      </div>
    </div>
  );
}

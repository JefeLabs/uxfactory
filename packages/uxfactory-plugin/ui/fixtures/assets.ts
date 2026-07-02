/**
 * assets.ts — Fixture data for the Assets screen.
 *
 * Every export here is a v1 fixture seam behind the same interface that a real
 * asset-registry backend would satisfy in PP2+. To swap in a real backend,
 * replace each constant with the appropriate bridge/snapshot read.
 *
 * Fixture seam notes (for future implementors):
 *   - FIXTURE_PHOTOS: real backend returns thumbnails via a bridge route or
 *     a cached DAM URL (see PRD §7 — proxy design required for localhost-only
 *     manifest compatibility).
 *   - DEFAULT_ICON_NAMES / FULL_ICON_SET: replace with the project icon-set
 *     artifact manifest (snapshot.artifacts.find(a => a.key === "icons")),
 *     which would carry the full glyph list.
 *   - Illustration grid: when the illustration style artifact exists in the
 *     snapshot, the section becomes a browsable grid; that grid data would
 *     also be served from fixtures or the bridge manifest.
 */

// ─── Photography ──────────────────────────────────────────────────────────────

/**
 * Photography tile descriptor (v1 fixture).
 * `tone` is a Tailwind color name used to generate a `bg-{tone}-200` placeholder.
 * Real backend: replace `tone` with `thumbnailUrl: string`.
 */
export interface PhotoFixture {
  id: string;
  alt: string;
  /** Tailwind base color name for the placeholder background (e.g. "slate"). */
  tone: string;
}

/**
 * Three photo tiles matching the mock screenshot.
 * SEAM: replace with `await bridge.getPhotos()` (GET /project/assets/photos)
 * when a real photography registry exists.
 */
export const FIXTURE_PHOTOS: PhotoFixture[] = [
  { id: "p1", alt: "Product hero image", tone: "slate" },
  { id: "p2", alt: "Lifestyle shot", tone: "stone" },
  { id: "p3", alt: "Team portrait", tone: "zinc" },
];

// ─── Icons ────────────────────────────────────────────────────────────────────

/**
 * The 8 icon names visible in the collapsed Assets view (default first page).
 * These are the names displayed before the user clicks "All N" to expand.
 * All names must be valid keys in ICON_MAP (Assets.tsx).
 *
 * SEAM: replace with the first N entries from the icon-set artifact manifest
 * (snapshot.artifacts.find(a => a.key === "icons")?.meta / payload).
 */
export const DEFAULT_ICON_NAMES: string[] = [
  "search",
  "shopping-cart",
  "user",
  "heart",
  "star",
  "log-out",
  "mail",
  "bell",
];

/**
 * Curated ~43-name lucide subset for the expanded icon grid.
 * All names must have corresponding entries in ICON_MAP in Assets.tsx.
 *
 * Import-cost note: Assets.tsx imports only the named exports for this list
 * from lucide-react — no wildcard import (`import *`) is used, so tree-shaking
 * in the Vite singlefile build keeps the icon footprint bounded.
 *
 * SEAM: replace with the full project icon-set artifact manifest when a real
 * icon registry exists (e.g. Lucide 24px outline with 312 glyphs).
 */
export const FULL_ICON_SET: string[] = [
  "search",
  "shopping-cart",
  "user",
  "heart",
  "star",
  "log-out",
  "mail",
  "bell",
  "home",
  "settings",
  "trash-2",
  "edit-2",
  "plus",
  "minus",
  "check",
  "x",
  "arrow-right",
  "arrow-left",
  "arrow-up",
  "arrow-down",
  "chevron-right",
  "chevron-left",
  "chevron-up",
  "chevron-down",
  "eye",
  "eye-off",
  "lock",
  "unlock",
  "download",
  "upload",
  "share-2",
  "link",
  "image",
  "file",
  "folder",
  "calendar",
  "clock",
  "map-pin",
  "phone",
  "message-circle",
  "info",
  "alert-circle",
  "check-circle",
];

# PRD — Artifacts screen (the spec inventory)

**Source:** `.screenshots/img_4-artifacts.png`
**Position in flow:** second tab. The system-of-record view: "The specifications your designs are verified against."

## 2. Purpose

Give one glanceable inventory of every **artifact** the project's generation grounds in and the gate verifies against — grouped by concern, with freshness, quick access, and creation of missing pieces. Also hosts the **expanded project header** (full classification chips + a quick fidelity dial).

## 2. Layout

1. **Expanded project header** (this screenshot shows the expanded state):
   - Row 1: chevron (collapse), `Demo Shop`, `● Connected`, expand-to-modal.
   - Chip set (wraps, 2 rows): `Category Ecommerce · Industry Corporate · Locale EN-US · Age 18–39 · Platforms Desktop·Mobile · Layout Responsive · Style Mix · Visual High (selected/active) · Editorial Medium · Flows Shallow · Coverage Medium · Coherence High`. Each chip = label + value; clicking a dial chip activates the quick-dial row below; clicking a classification chip deep-links to setup step 1 (edit mode).
   - **Quick dial row:** the active chip's control inline — screenshot: `Visual fidelity  Low | Medium | High(selected)`. Same storage/semantics as Setup 2 (§02 PRD); applies to new runs.
2. **Tab nav:** Artifacts active.
3. **Heading row:** "Demo Shop artifacts" + right-aligned freshness rollup `10 of 12 up to date`. Subcopy: "The specifications your designs are verified against."
4. **Grouped inventory** (cards with section headers):
   - **PRODUCT:** `Product brief — brief.md` · `Requirements — 6 criteria` (both green, `Open`).
   - **IA & UX:** `Site map — draft` (amber dot + `draft` tag) · `User flows — checkout, returns` (green).
   - **DESIGN:** `Brand colors` (2 swatches) · `Color palettes — 3 palettes` (swatch strip) · `Font pairings — Archivo + Source Serif` · `Grid & viewports — 8pt · 12 col · 1440 / 390` · `Design tokens — 1,204 resolved` (all green, `Open`).
   - **ASSETS:** `Icon set — Lucide · 24px outline` · `Photography — style rules · 212 approved` (green) · `Illustrations — missing` (hollow dot + primary `Create` button).

Row anatomy: freshness dot · name (semibold) · metadata (muted, monospace where file-ish) · trailing action (`Open` link, or `Create` button when missing).

## 3. Freshness model

- **Green (up to date):** artifact exists, validates, and is newer than (or hash-matched to) its upstream dependency.
- **Amber (draft/stale):** exists but flagged draft, failed validation softly, or upstream changed since (e.g. requirements edited after site map generation).
- **Hollow (missing):** registered concern with no artifact — shows `Create`.
- Rollup counts green over total registered concerns.

## 4. Behaviors

- **Open:** file-backed artifacts open in the user's editor via the bridge (`open <path>`), never inside the panel (v1); structured artifacts (brand colors, grid) may open a lightweight read-only popover (v1.1).
- **Create:** enqueues the matching `generate-artifact` job (e.g. illustrations style) with progress inline on the row (`generating…` replaces the action); on completion the row flips green.
- **Draft rows** expose a secondary action on hover: `Regenerate` (re-runs the producing job) alongside `Open`.
- **Quick dial** writes the profile immediately (toast: "Applies to new runs").
- Grouping/order is fixed (Product → IA & UX → Design → Assets) for scanability.

## 5. Data & system touchpoints

- Registry: `uxfactory.batch.json` inputs (stories/requirements, tokens, screens, trace) + artifact registry for non-gate artifacts (brief, site map, flows, brand/palettes/fonts/grid, icon/photo/illustration rules).
- `Design tokens — 1,204 resolved` reads the bridge token index (see Settings).
- Freshness hashes computed bridge-side; the panel stores only IDs + hashes (File storage rule).
- `Create`/`Regenerate` → bridge pipeline `generate-artifact` jobs → worker.

## 6. Acceptance criteria

1. The inventory renders all registered concerns grouped exactly as above, with per-row freshness dots and the correct rollup ("10 of 12" for the screenshot fixture).
2. `Open` opens the backing file locally within 1s (bridge-mediated); missing-file errors surface as a row-level amber note, not a modal.
3. `Create` on Illustrations enqueues a job, shows inline progress, and flips the row green on success without a full-screen refresh.
4. Editing requirements (upstream) flips dependent artifacts to amber within one refresh cycle (tab focus or 30s poll).
5. The quick dial persists to the profile and is reflected in the header chip immediately.
6. Clicking a classification chip opens setup step 1 in edit mode with values prefilled.
7. Keyboard: rows are focusable; `Open`/`Create` reachable via keyboard; section headers are landmarks.

## 7. Open questions

- Should `Requirements` open a structured viewer (list of ACs with ids) instead of the raw file? (Components links by AC id — a shared AC viewer would serve both.)
- Artifact concern registry: fixed 12-concern taxonomy vs project-configurable set — v1 assumes the fixed taxonomy shown.
- Conflict handling when a user edits an artifact file while a regenerate job is running (last-writer-wins + amber flag assumed).

## 8. Out of scope

In-panel artifact editing; artifact version history/diffing (git owns that); multi-file artifact concerns.

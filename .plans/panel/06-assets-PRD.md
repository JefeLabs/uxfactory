# PRD — Assets screen (approved asset registry)

**Source:** `.screenshots/img_6-assets.png`
**Position in flow:** fourth tab. The approved-materials library whose usage the checks enforce.

## 1. Purpose

Browse and use the project's **approved assets** — icon set, photography, illustrations — with the guarantee that anything dragged onto the canvas is **rule-checked** (right set, right size, licensed). Surface gaps (undefined styles) as first-class creatable artifacts.

## 2. Layout

1. **Project context bar** (collapsed) + tab nav (Assets active).
2. **Search field:** "Search assets…" (filters all sections live).
3. **Filter chips:** `All (selected) · Icons · Photos · Illustrations` — single-select scope.
4. **ICONS section:** header `ICONS — Lucide · 24px outline` + trailing `All 312` link. Grid of icon tiles (8 visible: search, cart, user, heart, star, export, mail, bell) — tile = 1:1 bordered card, icon centered.
5. **PHOTOGRAPHY section:** header `PHOTOGRAPHY — 212 approved · licensed` + `All` link. Row of 3 image thumbnails (rounded, muted placeholders in mock).
6. **ILLUSTRATIONS section:** header `ILLUSTRATIONS — style not defined yet` (amber). Dashed-border empty card: "Define an illustration style so generated designs stay on-brand." + primary `Create` button.
7. **Footer hint:** "Drag onto canvas — usage is checked against your asset rules."

## 3. Behaviors

- **Drag-to-canvas:** dragging a tile inserts the asset at the drop point (icon = vector/instance at its canonical size; photo = fill or image frame). Insertion tags the node with asset metadata (set id, asset id) so checks can verify usage.
- **Click tile:** inserts at viewport center (keyboard-accessible alternative to drag); shift-click opens a detail popover (name, tags, license for photos).
- **`All N` links:** expand the section to a paginated grid view within the tab (back affordance returns to the overview).
- **Search:** matches asset names/tags across sections; sections with no matches collapse to a "no matches" line.
- **Create (Illustrations):** enqueues the illustration-style `generate-artifact` job (same pattern as Artifacts→Create); on completion the section becomes a browsable grid.
- **Rule enforcement (passive here, active in Checks):** usage rules (icon size/stroke, photo licensing/approval, illustration style adherence) are artifacts; T2/T3 checks flag violations (e.g. off-set icon, unapproved image). The footer line sets that expectation.

## 4. States

| State | Treatment |
|---|---|
| All sections populated | grids as in screenshot (icons + photos) |
| Style not defined | dashed create-card (Illustrations in screenshot) |
| Empty search | per-section "no matches" |
| Asset set stale (source changed) | amber header note + `Refresh` |
| Insert fails (font/licensing) | toast with reason; nothing inserted |

## 5. Data & system touchpoints

- Asset registries are artifacts: icon set (e.g. `Lucide · 24px outline` + the 312-glyph manifest), photography rules + approved list (212), illustration style rules. Registered in the artifact store; browsable content cached bridge-side (heavy payloads never in the Figma file — File storage rule).
- Insertion metadata: node plugin-data `{ assetSet, assetId, version }` — consumed by the checks.
- `Create` → bridge pipeline `generate-artifact` (illustration style) → worker.

## 6. Acceptance criteria

1. The three sections render with correct counts/metadata from the registries (`312`, `212 approved · licensed`, `style not defined yet`).
2. Dragging an icon onto the canvas inserts it at 24px with the correct vector content and tags it with asset metadata.
3. A node inserted from the panel passes the asset-usage check; the same glyph hand-drawn or resized off-rule fails it (verified via Checks fixture).
4. Search filters across sections in <100ms for 500 assets (local index).
5. `Create` on Illustrations runs the job inline and converts the section to a grid on success.
6. `All 312` opens the full grid with pagination or virtualized scroll; back returns without losing search state.
7. Keyboard: tiles focusable, Enter inserts at center; sections are landmarks.

## 7. Open questions

- Photo assets: are binaries served from the bridge cache (assumed) or referenced from a DAM/URL (would violate the localhost-only manifest — needs a proxy design)?
- Icon insertion form: Figma component instances (library) vs flattened vectors — instances preferred for swap-ability; requires a generated icon library file (relates to component masters work).
- Multi-set icons (brand + product sets) — v1 single set assumed.

## 8. Out of scope

Asset uploading/management UI (rules + sets are authored as artifacts); DAM integrations; per-asset usage analytics.

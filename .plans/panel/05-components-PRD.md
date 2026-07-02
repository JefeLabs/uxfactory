# PRD — Components screen (design-unit ↔ requirement linking)

**Source:** `.screenshots/img_5-components.png`
**Position in flow:** third tab. The traceability workspace: which canvas design units satisfy which requirements, and the launchpad for checking them.

## 1. Purpose

Bind **design units on the canvas** (Pages/Templates/Organisms/Molecules) to **requirements** (acceptance criteria), show link coverage at a glance, and run the gate on what's linked. This is the panel face of the coverage trace: a requirement without a linked, checked unit is unproven.

## 2. Layout

1. **Project context bar** (collapsed) + tab nav (Components active).
2. **Selection card** (reflects the current canvas selection):
   - Checkbox (multi-select mode affordance) · unit name `Checkout / Error State` · unit-type dropdown chip `Page ▾` (reclassifiable) · node id `12:308` (monospace, right-aligned; click = select/zoom on canvas).
   - Meta row: `47 styles in use` · `✓ In sync with code` (green; from the code-mapping/drift facility — states: `✓ In sync` / `⚠ drift detected` / `not mapped`).
   - Empty-selection state: "Select a frame on the canvas to link it" + the linked list below remains.
3. **Link composer row:** `Requirement:` dropdown (searchable, lists ACs by title; screenshot: `Payment declined error`) + primary `Link` button. Disabled when nothing is selected or the pair already exists.
4. **LINKED COMPONENTS** section: header + rollup `4 of 6 linked`. Rows:
   - `Checkout / Default — Page — AC-101` (green dot)
   - `Checkout / Error State — Page — AC-104` (green; highlighted as current selection, AC id in indigo)
   - `Checkout / Loading — Template — AC-102` (green)
   - `Checkout / Empty Cart — Organism — AC-103` (green)
   - `Checkout / Success — Page — not linked yet` (hollow dot, amber text)
   - `Checkout / 3DS Challenge — Molecule — not linked yet`
   Row anatomy: status dot · unit name · unit-type tag chip · trailing AC id (link → AC viewer) or `not linked yet`. Click row = select unit on canvas.
5. **Primary CTA (sticky footer):** full-width `Check my design` — runs the gate over the linked set (or current selection when one unit is focused), routing to **Checks** with the run.

## 3. Behaviors

- **Selection sync:** panel listens to canvas selection; the selection card updates live. Multi-select (checkbox) enables bulk-link to one AC.
- **Link:** creates `unit(node id) ↔ AC id` in the trace store; the row flips green with the AC id; rollup updates. Unlink via row hover action (`Unlink`).
- **Unit-type chip** reclassifies the unit (Page/Template/Organism/Molecule) — affects check rubric scoping (page-level vs component-level expectations) and Prompt defaults.
- **In-sync badge:** reads the component↔code mapping (map/drift). `⚠ drift detected` deep-links to a drift summary (v1: opens Checks with the drift report).
- **Check my design:** enqueues a check run scoped to the linked units → Checks tab live view. Unlinked units are included as coverage failures ("not linked yet" = requirement coverage gap when an AC has no unit, and unit gap when a unit has no AC — both surfaced in T1).
- **List population:** units appear from (a) landed generations (auto-named + auto-linked to their source ACs when the trace is known) and (b) manual linking of hand-drawn frames.

## 4. States

| State | Treatment |
|---|---|
| Canvas selection = linked unit | screenshot state (row highlighted) |
| No selection | selection card empty-state; list still browsable |
| AC already linked to another unit | Link allowed (many-to-many), tooltip notes existing links |
| Drift detected | amber badge in the selection card |
| Zero ACs in project | link composer replaced by callout "No requirements yet — create them in Artifacts" |

## 5. Data & system touchpoints

- AC list: requirements artifact (ids + titles).
- Links: trace store (bridge-side; the panel stores ids only). The links feed the coverage check (T1) and the generation grounding (a linked unit's AC becomes context for regeneration).
- Node references: Figma node ids; stale ids (deleted frames) render the row with a `missing on canvas` amber note + `Relink` action.
- `styles in use`: computed from the node subtree on selection (local plugin computation).
- Sync badge: `uxfactory.map.json` mapping + drift facility.

## 6. Acceptance criteria

1. Selecting a canvas frame updates the selection card (name, type, node id, styles count, sync badge) within 500ms.
2. Link creates the association, updates the row + rollup without refresh, and persists across plugin restarts (bridge-side store).
3. `Check my design` starts a run scoped to linked units and lands on Checks with live progress; unlinked ACs/units appear as T1 coverage findings.
4. Reclassifying a unit's type persists and is reflected in tags everywhere (list, Checks headers).
5. Deleting a linked frame on canvas flags the row `missing on canvas` with `Relink` (no silent removal).
6. Row click selects + zooms the unit on canvas.
7. AC id click opens the requirement (shared AC viewer or file open, per Artifacts open question).

## 7. Open questions

- Many-to-many link semantics in coverage scoring: does one unit satisfying two ACs count both (assumed yes, mirrors trace `covers[]`)?
- Auto-linking heuristics for landed generations: exact (trace-known) only in v1, fuzzy name-matching later?
- Should `47 styles in use` warn when styles are off-token (quick pre-check before a full run)?

## 8. Out of scope

Component publishing to Figma libraries; cross-file linking; requirement authoring (Artifacts owns it).

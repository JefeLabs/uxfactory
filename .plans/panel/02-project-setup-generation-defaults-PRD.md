# PRD — Project setup 2: Generation defaults (profile dials)

**Source:** `.screenshots/img_2-project-setup-2.png`
**Position in flow:** step 2 of the setup wizard (after Classification). Also reachable later from the expanded project header ("change anytime").

## 1. Purpose

Pin the project's **generation defaults** — tone, depth, and detail of what the agent produces — as the panel expression of the **profile scope dials** (`uxfactory.profile.json`). These are the same dials that decide which gate checks bind, so this screen sets both *what gets generated* and *how strictly it is verified*.

## 2. Layout

1. **Project header bar:** name + `● Connected` (repo path omitted at this step).
2. **Heading block:** "Generation defaults" + subcopy "What the agent produces when you generate designs — tone, depth and detail. Suggested for **Ecommerce · Corporate** — change anytime." (bold pair reflects the step-1 classification; the suggestion engine seeds all six controls).
3. **Six labeled segmented controls** (full-width, three options each, selected = indigo tint):

| Control | Options (screenshot default bold) | Maps to |
|---|---|---|
| Style | Informal · **Mix** · Formal | editorial tone (classification `style`) |
| Visual fidelity | Low · Medium · **High** | profile dial `visual` |
| Editorial fidelity | Low · **Medium** · High | profile dial `editorial` |
| Flows | **Shallow** · Medium · Deep | profile dial `flow` (low/medium/high) |
| Coverage | Thin · **Medium** · Exhaustive | profile dial `coverage` (low/medium/high) |
| Coherence | Low · Medium · **High** | new panel-level dial (cross-screen consistency pressure) |

4. **Coverage helper caption:** "Floor for generation without specs — when requirements exist, they take precedence." (This is the registry-scope precedence rule surfaced as UX copy.)
5. **Wizard footer:** `← Back` · `Save & continue` (primary).

## 3. Semantics (the part that must be right)

- **Dial values persist to `uxfactory.profile.json`** through the bridge using the engine vocabulary: `visual/editorial/coverage/flow ∈ low|medium|high`. Panel labels are friendly synonyms (`Shallow→low`, `Thin→low`, `Exhaustive→high`, etc.) — the mapping is fixed and documented in code next to the write.
- **Binding consequences** (must appear as info tooltips on each control):
  - Visual ≥ Medium → a11y, contrast, and token-conformance checks bind (T2 Integrity).
  - Coverage ≥ Low → requirement coverage binds (T1).
  - These tooltips keep the "generation default" and "verification strictness" duality honest.
- **Suggestion engine:** classification → default dial set (e.g. Ecommerce·Corporate → High visual, Medium editorial, Shallow flows, Medium coverage, High coherence, Mix style). Suggestions are a starting point; user edits win and are never silently overwritten on re-entry.
- **Precedence:** when requirements/specs exist, generation honors them over the Coverage floor (caption above); the dial then acts as the floor for *unspecified* areas only.

## 4. Behaviors

- Save & continue: persists profile via bridge → routes to the main panel (**Prompt** tab) with the project context bar now showing the full chip set.
- Back: returns to step 1 with values intact.
- Changing dials later (from the expanded header, Artifacts quick-dial, or re-running setup) re-persists and takes effect on the **next** generation/check run — an inline toast notes "Applies to new runs".
- Every control change updates a lightweight preview line under the heading (optional v1.1: "≈ 4 screens · full states · strict checks").

## 5. Data & system touchpoints

- Write: `uxfactory.profile.json` (dials + style + coherence) — bridge-mediated.
- Read: `uxfactory.classification.json` (for the "Suggested for …" line and defaults).
- The Artifacts screen exposes a quick single-dial control (Visual fidelity) — same storage, same semantics (see 04).

## 6. Acceptance criteria

1. Defaults render exactly as suggested for the step-1 classification; changing classification in step 1 and returning re-suggests (with a "suggestions updated" note) unless the user already edited a control.
2. Save & continue writes a profile the engine accepts verbatim (`low|medium|high` vocabulary) and the batch gate binds checks accordingly (Visual High → contrast/token/a11y bind).
3. Tooltips on Visual/Coverage state their binding consequences.
4. Re-entering the screen shows persisted values, not re-suggested ones.
5. The Coverage caption is present verbatim ("Floor for generation without specs — when requirements exist, they take precedence.").
6. Keyboard: each segmented control is one radio group; arrow keys move within, tab moves between.

## 7. Decisions & open questions

- **Decided (2026-07-02) — Style:** confirmed; stored in `uxfactory.classification.json` (where `style` already exists), presented here.
- **Decided (2026-07-02) — Coherence:** tentative. Ships v1 as a **generation hint only** (passed to the agent prompt; enforced by no check), visually identical to the other dials but marked internally as experimental — cuttable without data migration. Validate its value before wiring any enforcement.

## 8. Out of scope

Per-run dial overrides (those belong to the Prompt screen's advanced options, future); team-level default templates.

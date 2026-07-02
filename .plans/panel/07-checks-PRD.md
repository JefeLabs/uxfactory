# PRD — Checks screen (tiered gate results)

**Source:** `.screenshots/img_7-checks.png`
**Position in flow:** fifth tab. The verification console: every run's tiered results, findings with node-level precision, and canvas annotation.

## 1. Purpose

Show a **check run** as the tiered pipeline it is — fail fast, cheap tiers first, expensive judgment last — with findings actionable enough to fix without leaving Figma: exact rule ids, expected-vs-actual values, node references, and one-click canvas annotation.

## 2. The tier model (rendered as stacked rows)

| Tier | Name | What it verifies (engine mapping) | Screenshot state |
|---|---|---|---|
| T0 | Schema | artifacts/spec structural validity (validate()) | ✓ `2/2 · 4ms` |
| T1 | Coverage | requirement coverage — every AC ↔ visible unit (render-coverage / link coverage) | ✓ `6/6 · 11ms` |
| T2 | Integrity | deterministic quality: contrast, token conformance, a11y (axe / hit targets) | ✗ `44/47 · 3 fail` (expanded) |
| T3 | Conformance | spec↔render agreement (counts/presence/geometry gate) | `skipped — short-circuit` |
| VLM | Craft review | the independent craft judge (vision rubric) | `requires local pass` (dashed tile) |

Short-circuit semantics: a failing tier stops execution of later tiers; skipped tiers say why (`short-circuit`); the VLM tier is additionally gated on all local tiers passing (`requires local pass`) — judgment is never spent on broken inputs.

## 3. Layout

1. **Run banner** (red when failed, green when clean): `✗ Run failed at T2 · Integrity` + context line `Checkout / Error State · hi-fi profile · 0.9s local · escalation skipped` + right-aligned `run #38`. Context encodes: unit, profile preset, wall time, and whether cloud escalation happened.
2. **Tier list:** one row per tier — status icon (✓ green / ✗ red / hollow = skipped / dashed = gated), tier code (T0…, VLM), name, right-aligned stats (`passed/total · duration` or skip reason).
3. **Failing tier expands** to its findings (red-outlined cards):
   - `contrast.text-min` — `"Retry payment" label — 2.9:1 on #FDF3F4, requires ≥ 4.5:1` — `node 12:341`
   - `token.color-raw` — `Fill #E24C4C is not a resolved token — nearest: semantic/danger-500` — `node 12:355`
   - `a11y.hit-target` — `Dismiss icon 32×32 < 44×44 minimum` — `node 12:362`
   Finding anatomy: **rule id** (monospace, red) · human sentence with expected vs actual (and a *nearest-fix hint* where computable — the token finding's `nearest:` is the pattern) · node ref (click = select/zoom the node).
4. **Footer actions:** `Copy report` (secondary — full run report as markdown/JSON to clipboard) · `Annotate 3 failures on canvas` (primary, red — count = open findings).

## 4. Behaviors

- **Run sources:** `Check my design` (Components), auto-check after a generation lands (Prompt), or re-run from this screen (banner hover → `Re-run`).
- **Live mode:** while a run executes, tiers fill in top-to-bottom with per-tier spinners; the banner shows `Running… T1` etc. (this is the Prompt progress line's full view).
- **Annotate on canvas:** places review annotations (the plugin's annotation facility) at each failing node — pin + short label (`contrast 2.9:1 < 4.5:1`); a second press clears stale annotations from previous runs first. Annotations are visually distinct from Figma comments and removable via `Clear annotations` (appears after annotating).
- **Node ref click:** selects + zooms; if the node no longer exists, the finding row notes `node deleted` and annotation skips it.
- **Copy report:** deterministic text block (run id, unit, profile, tiers, findings with ids) suitable for pasting into a PR/issue.
- **Escalation:** `escalation skipped` states that no cloud escalation ran (policy: local-first; escalate only when configured and local tiers pass but VLM is remote). When escalation runs, the context line shows `escalated · vlm 12s`.
- **History:** `run #38` is a dropdown — previous runs for this project (last 20), selecting one renders its frozen report (read-only banner tint).

## 5. States

| State | Treatment |
|---|---|
| Failed at a tier | screenshot state (red banner, expanded failing tier, skip cascade) |
| All local pass, VLM pending | green-ish banner `Local checks passed · craft review running…`, VLM row spinner |
| Fully clean | green banner `✓ Run passed`, all tiers ✓, primary action becomes `Copy report` |
| No runs yet | empty state: "No checks yet — link components and press Check my design" (links to Components) |
| Stale (canvas changed since run) | amber banner note `canvas changed since this run` + `Re-run` |

## 6. Data & system touchpoints

- Runs execute engine-side (bridge/worker): T0–T3 are the deterministic gate (schema validate, coverage, contrast/token/a11y integrity, spec↔render conformance); VLM is the craft-judge skill. The panel is a **renderer of reports**, never a checker itself.
- Findings carry `{ ruleId, nodeId, message, expected, actual, hint? }`; reports are stored bridge-side, indexed by run id (panel stores ids — File storage rule).
- Annotation uses the plugin annotation path keyed by nodeId.

## 7. Acceptance criteria

1. A failing run renders: red banner with tier name, per-tier stats, expanded findings with rule id + expected/actual + node ref, later tiers marked `skipped — short-circuit`, VLM `requires local pass`.
2. `Annotate N failures on canvas` places N annotations adjacent to the offending nodes and is idempotent across presses (no duplicates).
3. Node ref click selects and zooms the exact node (`12:341` style ids).
4. `Copy report` produces a complete, deterministic report including run id and all findings.
5. Live runs stream tier-by-tier without blocking the panel; a bridge disconnect mid-run resumes rendering from the stored report on reconnect.
6. The run history dropdown reloads any of the last 20 runs read-only.
7. A fully green run shows the clean banner and enables the VLM tier row with its craft score summary (e.g. `craft 4/5 · pass`).
8. Rule ids match the engine vocabulary 1:1 (`contrast.text-min`, `token.color-raw`, `a11y.hit-target`, …) — no panel-side renaming.

**Decided (2026-07-02) — rule taxonomy:** the fine-grained rule-id vocabulary shown here is adopted as the canonical engine finding id set. The existing four check ids become tier families: `render-coverage` → T1; `contrast`/`token-conformance`/`a11y` → T2 rule families (`contrast.*`, `token.*`, `a11y.*`); the spec↔render gate (counts/presence/geometry) → T3 (`conform.*`). The engine emits `{tier, ruleId, …}` findings; the panel renders them verbatim. Migrating the engine's finding shape to this taxonomy is an engine work item that precedes this screen's build.

## 8. Open questions

- Auto-fix affordances: the token finding computes `nearest: semantic/danger-500` — offer a one-click `Apply nearest token`? (High value; needs a safe write path; v1.1 candidate.)
- Warning-severity findings (non-must checks): render as amber cards within the tier without failing it — confirm severity taxonomy mapping.
- Should annotation survive file close (persisted plugin data) or be session-only? Assumed persisted until cleared/re-run.

## 9. Out of scope

Editing rule thresholds (profile owns strictness); CI surface of the same reports (exists engine-side); cross-run trend analytics.

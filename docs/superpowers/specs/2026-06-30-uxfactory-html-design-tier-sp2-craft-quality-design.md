# UXFactory — HTML Design Tier, SP2: Craft-Quality System design

**Date:** 2026-06-30
**Status:** draft — awaiting user review
**Part of:** the HTML high-fidelity design-generation tier. **SP1** (shipped, `origin/main`) built the *verifiable* loop — a real agent authors HTML that passes deterministic gates (render-coverage · a11y · contrast · token-conformance) and reaches a green bar, proven by a live paid run. **SP2 (this doc)** closes the gap SP1 deliberately left open: those gates verify **correctness, not craft**. **SP3** (later) is Figma landing.
**Motivating evidence:** SP1's first live agent output (`checkout-success`: an outlined card, system font, a link styled as a button, flat whitespace) *passed every deterministic gate and still looks like a wireframe*. Green ≠ beautiful. That is the exact, expected ceiling of a correctness-only floor.
**Builds on:** the SP1 loop (`skill/design/SKILL.md`, the `generate-design` worker kind, `.uxfactory/batch/previews/*.png` screenshots) and the existing vision-review *pattern* (`skill/vision-review`, `canvas-review` kind, `canvas` CLI) — agent-does-the-vision, engine-stays-LLM-free, structured findings, honest "best-effort" labeling. SP2 reuses that **pattern**, not its purpose (that skill judges requirement *coverage*; SP2 judges *craft*).

## 1 · Goal

Drive the HTML tier's output from "passes gates but plain" to "production-quality craft" using two levers together: **(A) authoring uplift** — richer raw materials + craft direction so the agent *can* reach a high bar — and **(B) an independent craft judge** — a rigorous, unbiased vision review that *forces* it to. The loop stops only when the design is both deterministically green **and** craft ≥ a bar (or the iteration budget is spent, surfaced honestly).

## 2 · The core problem (why one lever isn't enough)

A vision judge can only push quality as high as the author can reach. Given 6 flat color tokens, a system font, and a prompt that optimizes for "pass the gates," a judge that says "improve the hierarchy" just makes the loop thrash. So SP2 is **two levers working together**: the judge is the forcing function; the authoring uplift is what lets the loop *converge* instead of spin. Neither alone closes the gap the examples exposed.

## 3 · Boundary (unchanged invariant)

Craft judgment is an LLM act; it lives **entirely in the worker / skill / agent layer**. The **engine stays deterministic and LLM-free** — SP2 adds **no new engine gates and no `packages/**` changes**. The deterministic gates remain the hard floor; craft rides on top as a **soft, iterated gate** whose *structure* is verifiable even though its *scores* are subjective.

## 4 · Lever A — Authoring uplift (raise the ceiling)

Entirely `skill/design` content (prose + a concrete starter) — no code, no engine change:

- **Design-system starter.** The skill ships a strong, concrete starting design system the agent *adapts to the project's brand/style* rather than inventing from nothing: a **color role set**, a **type scale** (family, sizes, weights, line-heights), a **spacing rhythm** (a consistent scale), **elevation** (shadow tokens), **radii**, and **base component styles** (buttons that read as buttons, inputs, cards). Expressed as CSS custom properties + example base CSS. The engine's hard `token-conformance` still validates only the color hexes (unchanged); the rest is craft material the agent must *use well* (enforced by the judge, §5–6).
- **Craft direction.** `skill/design` gains explicit production-quality direction: establish real visual hierarchy; use the type + spacing scales (no ad-hoc values); give components genuine affordance (a primary action is a filled button, not underlined text); use elevation/whitespace for depth; and honor the project's **style/brand** from `uxfactory.classification.json` (category · industry · age · style).
- **See your own work.** Before finishing, the agent MUST open its rendered screenshots (`.uxfactory/batch/previews/*.png`) and self-assess — the agent is multimodal; authoring blind is part of why the output was plain. (Self-assessment ≠ the judge; the independent judge in §5 is the gate.)

## 5 · Lever B — The independent craft judge

After `uxfactory batch` is deterministically green, an **independent craft judge** — a fresh context given *only* the screenshots + rubric + the project's brand/style, with **no authoring context** and an adversarial brief ("what about this is not production-quality?") — scores the design and returns specific, actionable findings.

**Mechanism (verified in Plan Task 1, contract-invariant either way):**
- **Primary — in-session judge subagent:** the authoring agent dispatches a fresh judge subagent (the runtime's Task/subagent facility) with the `skill/craft-review` brief + the screenshot paths. Clean context = no self-grading. Stays inside the one worker-orchestrated `generate-design` session.
- **Fallback — worker-orchestrated judge session:** if the autonomous sandbox does not expose a usable subagent facility (to be verified — the SP1 paid run showed the sandbox grants only a narrow tool set), the worker runs a separate judge session between author iterations (a new `craft-review` generative kind on the existing `generate-artifact`/`canvas-review` pattern), feeding findings back to the author.

Either mechanism satisfies the same **contract**: *an unbiased craft verdict, computed from the screenshots + rubric + brand alone, fed back into the authoring loop.* The plan selects the working mechanism first (a small feasibility spike) so the rest is built once.

## 6 · The craft rubric + verdict (structured, so it stays verifiable)

The judge scores these **dimensions, 1–5 each**, against a high bar (default pass = every dimension ≥ 4 AND overall ≥ 4; the bar is a pinned constant, tunable):

| Dimension | What it judges |
|---|---|
| **hierarchy** | clear primary/secondary/tertiary emphasis; the eye knows where to go |
| **typography** | a real type scale used consistently; sane measure/leading; no default-system flatness where the brand implies otherwise |
| **spacing** | consistent rhythm from the scale; intentional grouping/whitespace, not arbitrary gaps |
| **color** | harmonious, purposeful palette use (beyond "it passes contrast") |
| **components** | affordances read correctly — a primary action looks pressable, inputs look editable |
| **depth** | elevation/layering used where it aids structure |
| **brand-fit** | matches the project's `style`/`category`/`industry`/`age` from the classification |
| **production-readiness** | overall: would this ship in a real product? |

**Verdict = a structured JSON** the authoring agent (and the panel) consume deterministically — `craft-report.json`:
```json
{
  "version": 1,
  "overall": 3,
  "pass": false,
  "reliability": "best-effort",
  "dimensions": [
    { "name": "hierarchy", "score": 2,
      "findings": [ { "screen": "checkout-success", "issue": "the confirmation card competes with nothing; no clear primary emphasis or secondary detail tiering", "fix": "raise the heading to the display type size, demote the receipt line to a muted caption, add a filled primary button" } ] }
  ]
}
```
A shared **schema + never-throws validator** (like SP1's `trace.ts`) checks the verdict's *structure* — the "verifiable" thesis applied to a subjective signal: scores are the judge's opinion, but the report shape is machine-checked so the loop and the panel can't be fed garbage.

## 7 · The loop

```
author HTML (uplifted craft direction + design-system starter)
  → uxfactory batch  → deterministic gate GREEN (SP1, unchanged)
  → dispatch independent craft judge (screenshots + rubric + brand)
  → craft-report.json: pass?
       no  → act on findings (revise HTML/tokens) → re-batch + re-judge
       yes → STOP: green AND craft-pass
  (iteration budget = maxIterations, shared with SP1)
```

**Craft is a SOFT gate.** Unlike a11y (a hard binary), a subjective craft score must not trap the loop forever: it *drives iteration* while craft < bar and budget remains, but at budget it **stops and surfaces honestly** — "deterministic green; craft best-effort `overall:N/5` with M open findings" — never a false "beautiful." `UXF::PROGRESS` gains a `phase:"craft"` line (iteration, overall score, findings count) so the panel shows craft progress live.

## 8 · Components & file layout

- **`skill/design/SKILL.md`** (modify) — add the design-system starter, the craft direction, the "open your renders" step, and the craft-judge dispatch + soft-gate loop step.
- **`skill/craft-review/SKILL.md`** (new) — the independent judge's adversarial brief + the rubric + the exact `craft-report.json` output contract.
- **`craft-report` schema + loader** (new, `clients/uxfactory-worker/src/craft-report.ts`) — TS types + never-throws validator. The worker validates the judge's verdict and forwards its score/findings as `phase:"craft"` progress events; the plugin renders the forwarded score generically from the event (no cross-package type import). NOT an engine gate — no `packages/**`.
- **Worker** — if the fallback mechanism is chosen: a `craft-review` generative kind (`generative.ts`) on the existing pattern; otherwise no worker change beyond forwarding the `phase:"craft"` progress events (already generic).
- **Plugin** (minimal) — the loop feed shows the craft score + phase (extends the existing `UXF::PROGRESS` routing; the gate strip already renders generic ids).
- **Design-system starter asset** — the concrete tokens + base CSS example, embedded in `skill/design` (no separate build artifact).

## 9 · Invariants / Global Constraints

- **Engine untouched & LLM-free:** no `packages/uxfactory-{cli,gate,spec}` gate changes; craft is worker/skill-layer only. (The `craft-report` validator lives in the worker — pure types + a validator, no LLM, no gate; the engine never sees it.)
- **Deterministic floor preserved:** the SP1 gates remain the hard pass/fail; craft never relaxes them.
- **Honest labeling:** craft verdicts carry `reliability: "best-effort"` (subjective), mirroring the existing vision-review honesty.
- **cc-invariant** on the new/edited skills; `sk-…` masking; secret-free rubric. **Never `git add -A`**; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; work on main.
- TS ESM/NodeNext, `.js` specifiers, `verbatimModuleSyntax`, vitest.

## 10 · Testing strategy

- **`craft-report` validator:** unit tests over valid/invalid verdicts (bad version, out-of-range score, missing dimension, non-object) — deterministic, no LLM.
- **Skills:** cc-invariant tests + a doc↔schema bind — `skill/craft-review`'s embedded example `craft-report.json` must validate against the real validator (like SP1's `skill-design.test.ts` trace bind), so the rubric doc can't drift from the schema.
- **Loop contract:** if the fallback worker kind is built, a dispatch test (the `craft-review` kind routes to the craft-review skill) mirroring the existing generative-kind tests.
- **Non-testable by design:** the vision judgment itself (scores) is non-deterministic — verified by the **live run**, not unit tests. The plan ends with a paid run confirming the loop iterates on craft and the output is visibly better than the SP1 baseline.

## 11 · Out of scope (SP2)

- New **engine** craft gates (craft stays a worker/skill soft gate).
- **Multiple design directions / variations** and the design-unit granularity axis (the separate future phase).
- **SP3 Figma landing.**
- A human-in-the-loop craft approval UI beyond surfacing the score in the panel feed.

## 12 · Risks & mitigations

- **Subagent feasibility (primary mechanism):** the autonomous sandbox may not expose a usable Task/subagent facility (SP1's paid run showed a narrow tool grant). **Mitigation:** Plan Task 1 is a feasibility spike; the worker-orchestrated judge session is the always-works fallback, and the rubric/verdict/loop are mechanism-agnostic.
- **Craft subjectivity / reproducibility:** scores vary run-to-run. **Mitigation:** the *structure* is validated; the bar is a pinned constant; the verdict is `best-effort`; the deterministic floor is unaffected. Determinism is not claimed for craft — only that it's structured, iterated, and honestly labeled.
- **Cost:** an extra vision pass per iteration spends tokens. **Mitigation:** the judge runs only *after* deterministic-green (not every draft), and the soft gate + `maxIterations` bound the iterations.
- **Uplift without judge convergence:** if the bar is set unreachably high, the loop always spends full budget. **Mitigation:** default bar = ≥4/5 (good, not perfect); tunable; best-effort surfacing prevents a hard trap.

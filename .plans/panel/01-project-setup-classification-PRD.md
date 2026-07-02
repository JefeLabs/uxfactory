# PRD — Project setup 1: Classification & starting mode

**Source:** `.screenshots/img_1-project-setup-1.png`
**Position in flow:** immediately after first successful Connect on a repo without project state. Step 1 of a 2-step setup wizard (→ Generation defaults).

## 1. Purpose

Capture the **project classification** that grounds all downstream generation and checking (`uxfactory.classification.json`), and let the user choose a **starting mode** based on what a repo scan actually found: start fresh (empty repo) or verify against existing work.

## 2. Layout

1. **Project header bar:** project name (`Demo Shop`) + repo path in monospace + `● Connected` pill. Confirms what was just linked; not editable here.
2. **Heading block:** "This looks like a new project" + subcopy "We scanned your repository to see what's already there. Pick how you'd like to start." — heading text is **scan-dependent** (see §4).
3. **Classification form** (label left, control right):
   - **Category:** chip group, single-select — `Marketing · Ecommerce · Web App · News` (screenshot: Ecommerce selected).
   - **Industry:** dropdown (screenshot: Corporate).
   - **Locale:** dropdown (screenshot: English (US)).
   - **Platforms:** chip group, **multi-select** — `Desktop · Tablet · Mobile` (screenshot: Desktop + Mobile).
   - **Layout:** segmented `Responsive | Adaptive` + helper caption ("One fluid layout across your platforms" / adaptive variant: "Distinct layouts per platform").
   - **Age group:** chip group, single-select — `Under 18 · 18–39 · 40–64 · 65+`.
4. **Starting-mode radio cards:**
   - **Start fresh** — badge `Detected — project is empty` (indigo tint). Body: "No specs found yet. UXFactory will help you create your first specifications from your designs."
   - **Use existing work** — body: "For projects that already have specifications, requirements, or design tokens — UXFactory will check your designs against them." Disabled-looking (gray radio) when scan found nothing; still selectable with a confirmation ("Nothing detected — you can still point us at your specs later in Artifacts").
5. **Wizard footer:** `← Back` (returns to Connect, keeps the connection) · `Continue` (primary).

## 3. Data & system touchpoints

- **Repo scan on entry** (bridge): detects `uxfactory.classification.json`, `uxfactory.profile.json`, `uxfactory.batch.json` inputs (stories/tokens/screens/trace), existing spec files. Drives the heading, the `Detected` badge, and the default radio.
- **Persist on Continue:** write `uxfactory.classification.json` `{ category, industry, locale, platforms[], layout, ageGroup }` via the bridge (never from the plugin sandbox directly). Chips map 1:1 to the intake model; `style` lives in step 2.
- Prefill: if a classification file already exists (re-running setup), controls initialize from it and the heading becomes "Welcome back — review your project profile".

## 4. Scan-dependent variants

| Scan result | Heading | Default mode |
|---|---|---|
| Empty repo | "This looks like a new project" | Start fresh (badge `Detected — project is empty`) |
| Specs/tokens found | "We found existing work" | Use existing work (badge lists what was found, e.g. `Detected — 6 requirements · design tokens`) |
| Partial (e.g. tokens only) | "We found some existing work" | Use existing work, with per-artifact detail in the card body |

## 5. Behaviors

- All controls have defaults suggested by the scan + Figma file heuristics where possible (e.g. locale from Figma user locale); nothing blocks Continue except Category (required).
- Continue: persists classification + chosen mode, advances to Setup 2. Back never loses entered values (wizard state kept in panel memory).
- Multi-select Platforms requires ≥ 1 selection; Layout defaults Responsive.
- Every chip/segment is keyboard-navigable (radio-group semantics for single-select, checkbox semantics for Platforms).

## 6. Acceptance criteria

1. On an empty repo the screen renders exactly the screenshot defaults: Ecommerce, Corporate, English (US), Desktop+Mobile, Responsive, 18–39, Start fresh selected with the `Detected` badge.
2. Continue writes a valid `uxfactory.classification.json` through the bridge and routes to Setup 2; the file round-trips (reopening setup shows the saved values).
3. On a repo with existing specs, the scan variant shows "We found existing work", pre-selects **Use existing work**, and names the detected artifacts.
4. Back returns to Connect without dropping the connection or entered values.
5. No classification write occurs if the user closes the plugin mid-wizard.

## 7. Open questions

- Category/Industry taxonomies: fixed lists vs extensible (the intake model currently has free-form values — the panel should constrain to a curated list with "Other…").
- Should `Use existing work` deep-link into Artifacts immediately after setup completes (skipping Prompt)?

## 8. Out of scope

Editing classification post-setup (lives in the expanded project header / Settings follow-up); team templates.

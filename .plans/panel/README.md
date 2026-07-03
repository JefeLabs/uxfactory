# UXFactory Plugin Panel — Screen PRDs

**Source:** `.screenshots/img-0-connect.png` … `img_8-settings.png` (9 screens, "Developer VM" edition).
**Scope:** the Figma plugin panel UX for the full UXFactory loop — connect → classify → tune generation → prompt → artifacts → components → assets → checks → settings.

## Screens

| # | PRD | Screen | One-liner |
|---|-----|--------|-----------|
| 0 | [00-connect-PRD.md](00-connect-PRD.md) | Connect | Link the Figma file to a repo via the local bridge (or Cloud) |
| 1 | [01-project-setup-classification-PRD.md](01-project-setup-classification-PRD.md) | Project setup 1 | Classification intake + start-fresh vs use-existing |
| 2 | [02-project-setup-generation-defaults-PRD.md](02-project-setup-generation-defaults-PRD.md) | Project setup 2 | Generation defaults (the profile dials) |
| 3 | [03-prompt-PRD.md](03-prompt-PRD.md) | Generate (né Prompt) | Generate a design unit from a prompt, grounded in artifacts |
| 4 | [04-artifacts-PRD.md](04-artifacts-PRD.md) | Artifacts | The spec inventory designs are verified against |
| 5 | [05-components-PRD.md](05-components-PRD.md) | Components | Link design units to requirements; run checks |
| 6 | [06-assets-PRD.md](06-assets-PRD.md) | Assets | Approved icons/photos/illustrations, rule-checked usage |
| 7 | [07-checks-PRD.md](07-checks-PRD.md) | Checks | Tiered gate results (T0–T3 + VLM craft) with canvas annotation |
| 8 | [08-settings-PRD.md](08-settings-PRD.md) | Settings | Bridge daemon, subscription/worker, skills, storage |
| 9 | [09-queue-PRD.md](09-queue-PRD.md) | Queue | Offline work landing — previews + specs applied sequentially |

## Shared shell (all screens)

- **Title bar:** UXFactory logo mark + `UXFactory (Developer VM)` + close (×). Fixed.
- **Project context bar** (post-connect screens): collapse chevron, project name (`Demo Shop`), summary chips (`Ecommerce`, `Responsive`, `+10` overflow → expands to the full chip set seen on Artifacts), connection pill (`● Connected` green / `● Disconnected` gray / `● Reconnecting…` amber), expand-to-modal icon button.
- **Tab nav** (post-setup screens): `Generate · Artifacts · Components · Assets · Checks · Queue · Settings` — active tab in indigo with underline. Tabs persist per session; deep-linkable from other screens (e.g. Checks CTA from Components).
- **Footer hint bar** (some screens): single muted line of contextual help (e.g. "Generates on canvas using your artifacts & generation defaults.").
- **Type/color system:** indigo-600 primary (`#5B5BD6`-family per mock), green success, amber warning, red failure; chips are pill-shaped, selected = indigo tint fill + indigo border + semibold label; cards on white with 1px gray-200 border, 8–12px radius; 8pt spacing rhythm.

## Domain grounding (terminology used across the PRDs)

- **Bridge** — the local relay daemon (`uxfactory bridge`); health, queue, render reports, token index. Plugin only ever talks to `localhost` (manifest `devAllowedDomains`).
- **Classification** — `uxfactory.classification.json` (category · industry · locale · age; the mock adds platforms/layout).
- **Generation defaults / profile dials** — `uxfactory.profile.json` scope dials (`visual` / `editorial` / `coverage` / `flow`) plus panel-level `style` and `coherence`.
- **Artifacts** — the registered inputs in `uxfactory.batch.json` (stories/requirements, tokens, screens, trace) plus product/IA/design/asset artifacts produced by generate-artifact jobs.
- **Design unit** — `Page · Template · Organism · Molecule` granularity for generation and linking.
- **Checks tiers** — T0 Schema, T1 Coverage, T2 Integrity (contrast/token/a11y), T3 Conformance, VLM Craft review (the independent judge; requires local pass).
- **Worker** — the pipeline agent that fulfills `generate-*` jobs via the bridge.

## Decisions (2026-07-02)

1. **Bridge port:** canonical default is the existing **`:3779`** (the mocks' `:4141` is illustrative). Editable in Settings; Connect and Settings PRDs updated.
2. **Style & Coherence:** **Style is confirmed** — stored in `uxfactory.classification.json` (where `style` already lives), presented in Generation defaults. **Coherence is tentative** — ships v1 as a generation hint only (surfaced to the agent prompt, enforced by nothing), flagged for validation and cuttable without migration.
3. **Rule taxonomy:** adopt the **fine-grained rule-id vocabulary** (`contrast.text-min`, `token.color-raw`, `a11y.hit-target`, …) as the canonical engine finding ids, grouped under the tier model (T1 Coverage = render-coverage family; T2 Integrity = contrast/token/a11y families; T3 Conformance = counts/presence/geometry). The panel renders engine rule ids 1:1 — no renaming layer.
4. **Design-unit granularity** (`Page · Template · Organism · Molecule`) is **retained as a firm requirement** across Prompt and Components (N-variations remains a separate future phase).

## Decisions (2026-07-03)

5. **Prompt tab renamed to "Generate"** — visible label only; the internal tab value/route key stays `prompt` (no store or deep-link migration).
5a. **Artifacts work directory** (2026-07-03): panel artifacts live in **`.uxfactory/artifacts/`** — one deterministic location for the panel, bridge-called agents, and SKILL.md flows. Reads fall back to legacy paths; writes migrate-on-touch. Engine gate inputs (acceptance-criteria, token-set) stay at their `design/` conventional paths (registry-overridable). Applies to the artifact-registry catalog when that feature lands.

6. **Queue tab added** (position: between Checks and Settings) — see [09-queue-PRD.md](09-queue-PRD.md). Restores the bridge→canvas landing path the legacy pipeline panel owned: CI/offline publishes surface as previews + specs, applied sequentially by the user (per-item or Render All). Listing is non-destructive; no auto-drain in v1.

## Cross-screen conventions

- **Freshness dots:** green = up to date · amber = draft/stale · hollow = missing.
- **Status vocabulary:** `✓ checked` (green) · `N warnings` (amber) · `generating…` (muted, animated) · `failed` (red).
- **Never block the canvas:** every long operation is async with progress; the panel is a companion, not a modal gate.
- **Secrets never enter the plugin** (keys held by the bridge/worker; see Settings).

# Product Brief

_Draft — grounded in `uxfactory.classification.json` and `uxfactory.profile.json`. Review before treating as final._

## 1. Project Classification

| Dimension  | Value           |
| ---------- | --------------- |
| Category   | marketing       |
| Industry   | other           |
| Locale     | en-US           |
| Platforms  | desktop, mobile |
| Layout     | responsive      |
| Age group  | 18–39           |
| Style      | informal        |

This is a **marketing** effort with no specialized industry vertical declared. It must work across **desktop and mobile** with a **responsive** layout, targeting **18–39-year-old** users in the **en-US** locale, with an **informal** voice and tone throughout copy and UI microcopy.

## 2. Scope Profile (Gate Dials)

| Dial                      | Level  |
| -------------------------- | ------ |
| Visual                      | high   |
| Editorial                   | high   |
| Coverage                    | low    |
| Flow                        | low    |
| Coherence (experimental)    | medium |

**What this means for the artifacts produced downstream:**

- **Visual: high** — design tokens (color, type, spacing, radius) must be fully specified and every color used in a spec must be a registered token; token-conformance checks are binding at this level.
- **Editorial: high** — copy and content quality bar is elevated; microcopy, headings, and CTAs should read as polished and on-tone for an informal, 18–39 marketing audience, not placeholder text.
- **Coverage: low** — acceptance criteria only need to cover the `success` state per story; `empty` / `loading` / `error` / `edge` states are not required at this scope.
- **Flow: low** — a single primary screen/path is sufficient; branching, back/cancel, and deep-link paths are not required at this scope.
- **Coherence: medium** (experimental) — cross-artifact consistency (naming, tone, structure) should be reasonably aligned but doesn't need exhaustive enforcement.

## 3. Audience & Tone

- **Primary audience:** adults aged 18–39, en-US locale.
- **Voice:** informal — conversational, direct, low-jargon. Avoid corporate or legalistic phrasing.
- **No age-gating or minor-safety obligations apply** — the declared age group (18–39) is adult, so no COPPA-style disclosure or parental-consent constraints are implied by the classification.

## 4. Platform & Layout Requirements

- Must render coherently on **desktop and mobile** breakpoints.
- Layout strategy is **responsive** (not adaptive/fixed) — components and flows should reflow rather than swap to platform-specific variants.

## 5. Constraints Honored

No explicit `constraints` array is present in `uxfactory.profile.json` — the profile only carries the `scope` and `experimental` dials shown above. Assumption made in the absence of an explicit list: standard accessibility hygiene (readable contrast, responsive layout for desktop/mobile) is treated as a baseline expectation given `visual: high`, but no industry- or age-driven regulatory constraint (e.g. COPPA, HIPAA-style disclosure) applies given `industry: other` and `ageGroup: 18-39`. If a constraints array is added to the profile later, this brief should be revisited.

## 6. Out of Scope (per current dials)

- Non-success state handling (empty/loading/error/edge) — deferred until `coverage` is raised above `low`.
- Multi-path/branching flows, back/cancel handling, deep links — deferred until `flow` is raised above `low`.

## 7. Next Steps

1. Review this brief for accuracy against the intended product scope.
2. Confirm or update `uxfactory.profile.json` constraints if any regulatory/accessibility obligations were omitted.
3. Proceed to draft the seeded user-story / acceptance-criteria / user-journey artifacts against this brief.
4. Run the Confirm gate and `uxfactory batch` to validate.

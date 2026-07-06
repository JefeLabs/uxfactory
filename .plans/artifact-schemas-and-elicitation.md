# Artifact Schemas & Elicitation

Companion to `component-type-artifact-mapping.md`. For each registry artifact: purpose, schema sketch, and the questions that must be answered to author it. **The elicitation block is the interview script behind the "Create artifacts →" affordance** — when a required-artifact chip is missing and the user clicks create, the plugin runs that artifact's questions.

## Elicitation discipline

Every question is tagged:

- **[E] Elicited** — only the human knows this; must ask.
- **[D] Derived** — computable from upstream artifacts or the manifest; **never ask what the trace graph already knows.** Show for confirmation at most.
- **[F] Defaulted** — sane default exists; confirm, don't ask. Silence accepts the default.

An artifact's interview length = its [E] count. Keeping [E] counts low is a product requirement, not a style preference: elicitation cost is the adoption tax on the whole conformance model.

## Common envelope

Every artifact shares this wrapper; per-artifact schemas below describe only `body`.

```json
{
  "id": "artifact-id",
  "schemaVersion": "1.0",
  "version": 3,
  "provenance": "OWNED | REFERENCED | MATERIALIZED",
  "source": "url-or-path if REFERENCED/MATERIALIZED, else null",
  "drift": { "policy": "pin | track", "checkedAt": "iso8601", "status": "current | drifted" },
  "authoredBy": "user | assisted | imported",
  "updatedAt": "iso8601",
  "body": { }
}
```

Envelope elicitation (asked once per artifact, not per question): drift policy [F: `pin`].

For **set artifacts** (stories, personas, component-spec, creative-brief, reference-set, journey-map — one file per instance), the envelope `id` is always the REGISTRY artifact ID (`stories`, `personas`, …); instance identity lives in `body` (`storyId`, `personaId`, …). One envelope per file.

---

# Product

## `product-brief` — `.uxfactory/artifacts/product-brief.md`

Purpose: what the product is, for whom, and what success measurably looks like. Product-brief shape: capability judged by measurable outcome.

```json
{
  "problem": "string",
  "productStatement": "string",
  "primaryOutcomes": [{ "metric": "string", "target": "string" }],
  "scope": { "inScope": ["string"], "outOfScope": ["string"] },
  "constraints": ["string"],
  "audienceRef": "audience",
  "positioning": "string"
}
```

Elicitation:
1. [E] What problem does this product solve, and for whom (one sentence each)?
2. [E] How will you measure success? Name 1–3 outcomes with targets.
3. [E] What is explicitly out of scope for this version?
4. [E] What constraints are non-negotiable (technical, legal, brand, budget)?
5. [D] Audience — derived from `audience` artifact if registered; else triggers its interview.
6. [F] Positioning statement [F: generated from answers 1–2, shown for edit].

## `creative-brief` — `.uxfactory/artifacts/creative/*.md` (per-campaign set, instance-bound)

Purpose: message intent for one campaign/deliverable. Creative-brief shape: message judged by reception. The channel-surface gate hinge.

```json
{
  "campaign": "string",
  "singleMindedProposition": "string",
  "audienceRef": "audience | persona-ids[]",
  "desiredResponse": { "think": "string", "feel": "string", "do": "string" },
  "mandatories": ["string"],
  "channels": ["email | instagram-post | ..."],
  "toneOverrides": "string | null",
  "expiry": "iso8601 | null"
}
```

Elicitation:
1. [E] What is the single-minded proposition — the one thing this must communicate? (Reject compound answers; that's the point of the field.)
2. [E] After seeing it, what should the audience think, feel, and do?
3. [E] Which channels will carry it?
4. [E] Any mandatories (legal lines, offer terms, logos)?
5. [D] Audience/personas — pick from registered set.
6. [F] Tone [F: inherit `voice-tone`; ask only if overriding]. Expiry [F: none].

## `stories` — `.uxfactory/artifacts/stories/*.json` (project-bound set)

Purpose: registered intent units. Each story names its persona actor and owns its ACs (per mapping decision 6, nested shape).

```json
{
  "storyId": "ST-001",
  "actor": "persona-id",
  "want": "string",
  "soThat": "string",
  "featureRef": "feature-id | null",
  "acceptanceCriteria": [
    { "acId": "AC-001", "given": "string", "when": "string", "then": "string", "checkable": "auto | manual" }
  ],
  "status": "draft | registered | retired"
}
```

Elicitation (per story):
1. [D] Actor — pick from registered `personas`. **Hard dependency: no personas, no story interview.** Free-text actors are how orphaned-actor failures are born.
2. [E] What does this actor want to do? (the "I want" clause)
3. [E] Why — what does it get them? (the "so that" clause)
4. [E] How do we know it works? Elicit ≥1 Given/When/Then. Push back on unfalsifiable answers ("it feels intuitive" → "what would the user see?").
5. [D] Feature assignment — suggest from `features` by keyword; confirm.
6. [F] Checkability per AC [F: `auto` if the Then clause references observable UI; else `manual`, flagged].

Bulk path: import from user's tracker/backlog file → parse → run only questions 1 and 4 per story where missing.

## `features` — `.uxfactory/artifacts/features.json`

Purpose: groups stories. Never gates, only scopes (coverage denominator, generation scoping, extend unit).

```json
{
  "features": [
    { "featureId": "F-01", "name": "string", "summary": "string",
      "storyRefs": ["ST-001"], "origin": "inherited | net-new", "status": "planned | active | shipped" }
  ]
}
```

Elicitation:
1. [E] Name the major capabilities of this product (chunks a user would recognize, 5–12 typically).
2. [D] Story assignment — cluster registered stories under features by similarity; confirm.
3. [D] Origin — `inherited` vs `net-new` derived from project quadrant + manifest; extend projects confirm per feature.
4. [F] Status [F: `planned`].

## `acceptance-criteria` — `design/acceptance-criteria.json`

**Deprecation path.** Per mapping decision 6, ACs nest inside stories. This file remains only as the migration source. No elicitation of its own — the AC interview lives inside `stories` question 4. If the standalone file persists, its schema is the AC object above plus `"storyRef": "ST-001"` (making AC→story integrity checkable).

**Gate feed during/after migration:** the engine resolves its stories input through registry-aware path resolution (exactly as tokens/requirements resolve today) — once stories migrate, the registry entry points the gate at `.uxfactory/artifacts/stories/`; until then the legacy file remains the resolved input. No MATERIALIZED compatibility file is needed, and the verify loop never loses its input.

## `audience` — `.uxfactory/artifacts/audience.json`

Purpose: quantitative segmentation; modulates rendering (tone, density, editorial). The demoted Target Demographic panel's persistent home.

```json
{
  "segments": [
    { "name": "string", "ageRange": "string", "locales": ["en-US"],
      "context": "string", "deviceMix": { "desktop": 0.5, "mobile": 0.4, "tablet": 0.1 },
      "accessibilityNotes": "string | null", "share": 0.6 }
  ],
  "primarySegment": "name"
}
```

Elicitation:
1. [E] Who uses this? Describe each segment in a phrase (age range, context of use).
2. [E] Which segment is primary when they conflict?
3. [F] Device mix [F: from project config Platform chip]. Locales [F: project Locale]. Share [F: even split].
4. [E] Any segment with accessibility-relevant characteristics (age-related vision, situational one-handed use)? Feeds `a11y-spec` derivation.

## `personas` — `.uxfactory/artifacts/personas/*.json` (project-bound set)

Purpose: behavioral archetypes; the "As a ___" referent. Upstream of stories in the trace graph.

```json
{
  "personaId": "P-01",
  "name": "string",
  "archetype": "string",
  "segmentRef": "audience segment | null",
  "goals": ["string"],
  "frustrations": ["string"],
  "context": { "expertise": "novice | intermediate | expert", "frequency": "string", "environment": "string" },
  "quote": "string | null"
}
```

Elicitation (per persona; suggest 2–4 total, warn above 6):
1. [E] Name and one-line archetype ("Returning Buyer — knows what she wants, hates friction").
2. [E] Top 2–3 goals when using the product.
3. [E] Top frustrations or anxieties.
4. [E] Expertise level and usage frequency.
5. [D] Segment link — map to `audience` segment; confirm.
6. [F] Quote [F: generated from answers 2–3, editable]. Explicitly cosmetic; never load-bearing.

---

# IA / UX

## `sitemap` — `.uxfactory/artifacts/sitemap.json`

Purpose: page inventory and hierarchy. Changes which nodes exist → setup-adjacent; the wizard seeds it.

```json
{
  "nodes": [
    { "nodeId": "N-home", "title": "string", "role": "home | secondary | tertiary",
      "parent": "nodeId | null", "featureRefs": ["F-01"], "status": "planned | generated | conformed" }
  ],
  "navigation": { "$ref": "navigation-model" }
}
```

Elicitation:
1. [D] Seed from project quadrant: brownfield/redesign/re-skin/extend → crawl or import existing IA; greenfield → derive candidate pages from `features` and present for pruning.
2. [E] Confirm/prune the candidate page list; name anything missing.
3. [D] Roles (home/secondary/tertiary) — inferred from depth; confirm exceptions.
4. [D] Feature links — from the stories each page serves.

## `flows` — `.uxfactory/artifacts/flows.json`

Purpose: task paths through screens (distinct from journey maps: screens, not touchpoints).

```json
{
  "flows": [
    { "flowId": "FL-01", "name": "string", "personaRef": "P-01",
      "storyRefs": ["ST-001"], "entry": "nodeId", "exit": { "success": "nodeId", "abandon": ["nodeId"] },
      "steps": [{ "nodeRef": "N-x", "action": "string", "branch": [{ "condition": "string", "to": "step-index" }] }] }
  ]
}
```

Elicitation (per flow):
1. [D] Which stories does this flow realize? Pick from registered stories — actor (persona) inherits from them.
2. [E] Where does it start, and what counts as successful completion?
3. [E] Walk the steps: at each screen, what does the user do? (Conversational; the plugin transcribes into steps.)
4. [E] Where can it branch or fail? What happens then? (This is the unhappy-path elicitation — mirror of `interaction-states`.)
5. [D] Node refs — matched against `sitemap`; unmatched steps prompt sitemap addition (integrity by construction).

## `journey-map` — `.uxfactory/artifacts/journey-maps/*.json` (parked)

Purpose: NN/g journey map — experience across touchpoints with emotional arc. Upstream research; no gate consumer yet.

```json
{
  "personaRef": "P-01", "scenario": "string",
  "phases": [{ "name": "string", "actions": ["string"], "touchpoints": ["string"],
               "emotion": -2, "opportunities": ["string"] }]
}
```

Elicitation (deferred until a consumer exists): 1. [D] Persona. 2. [E] Scenario. 3. [E] Phases with actions/touchpoints/emotional high-low points. 4. [E] Where are the opportunity moments?

## `navigation-model` — `sitemap.json#navigation` (fragment)

Purpose: global nav, breadcrumbs, wayfinding.

```json
{
  "primaryNav": { "items": ["nodeId"], "maxDepth": 2, "pattern": "topbar | sidebar | hybrid" },
  "utilityNav": ["nodeId"],
  "breadcrumbs": { "enabled": true, "showOn": ["secondary", "tertiary"] },
  "footer": { "groups": [{ "title": "string", "items": ["nodeId"] }] }
}
```

Elicitation: 1. [D] Candidate primary nav — top-level sitemap nodes; confirm/reorder. 2. [F] Pattern [F: from Layout/Platform config]. 3. [F] Breadcrumbs [F: on for secondary+]. 4. [E] Anything that must always be reachable (cart, search, account)?

---

# Design

## `brand-colors` — `design-system.json#colors`

Purpose: raw sanctioned values (inventory).

```json
{ "colors": [{ "name": "string", "hex": "#RRGGBB", "role": "brand | neutral | semantic", "source": "brand-guide | chosen" }] }
```

Elicitation: 1. [E] Do brand colors exist? If yes: import (file/Figma styles/URL) — provenance may be REFERENCED. 2. If no: [E] pick direction (2–3 generated ramps shown), [F] neutrals and semantic (success/warn/error) generated for contrast against `a11y-spec` target.

## `palettes` — `design-system.json#palettes`

Purpose: usage assignments (system): which color plays which role where.

```json
{ "assignments": { "surface": "colorRef", "surfaceAlt": "colorRef", "textPrimary": "colorRef",
  "textSecondary": "colorRef", "interactive": "colorRef", "interactiveHover": "colorRef",
  "border": "colorRef", "semantic": { "success": "colorRef", "warning": "colorRef", "error": "colorRef" } },
  "modes": ["light", "dark"] }
```

Elicitation: 1. [D] Default assignment generated from `brand-colors` + `a11y-spec` contrast math; shown as a rendered sample, not a form. 2. [E] Approve or swap roles. 3. [F] Dark mode [F: off unless Platform/config implies it].

## `fonts` — `design-system.json#fonts`

Purpose: sanctioned typefaces and pairings (inventory).

```json
{ "faces": [{ "family": "string", "source": "google | adobe | custom", "license": "string", "roles": ["heading","body","mono"] }],
  "pairings": [{ "heading": "family", "body": "family", "default": true }] }
```

Elicitation: 1. [E] Existing brand typefaces? Import if so. 2. If not: [E] pick from 3 pairings generated against project Style/Tone config. 3. [D] License check — flag faces without embeddable licenses.

## `typography` — `design-system.json#typography`

Purpose: the type system — scale, hierarchy rules, line heights, responsive behavior. OWNED semantics; type tokens MATERIALIZED from it.

```json
{
  "scale": { "base": 16, "ratio": 1.25, "steps": [{ "name": "body", "size": 16, "lineHeight": 1.5, "weight": 400, "face": "body" }] },
  "hierarchyRules": ["h-levels must be monotonic", "one h1 per page"],
  "responsive": [{ "breakpointRef": "grid", "scaleFactor": 0.9 }],
  "limits": { "minBodySizePx": { "desktop": 16, "mobile": 16 }, "lineLengthCh": { "min": 45, "max": 75 } }
}
```

Elicitation: 1. [F] Base size [F: 16] and ratio [F: 1.25; show 1.2/1.25/1.333 rendered]. 2. [D] Faces from `fonts` default pairing. 3. [F] Limits [F: from `a11y-spec`; these are the checkable clauses]. 4. [E] Any house rules? (e.g., "no italics", "sentence case headings" — the latter cross-checks `glossary`.)

## `grid` — `design-system.json#grid`

Purpose: spatial system — columns, gutters, breakpoints, spacing rhythm. Spacing tokens MATERIALIZED from it.

```json
{ "breakpoints": [{ "name": "mobile", "minWidth": 0, "columns": 4, "gutter": 16, "margin": 16 }],
  "spacingBase": 8, "containerMax": 1280, "verticalRhythm": "spacingBase multiples" }
```

Elicitation: 1. [D] Breakpoints from Platform + Viewports config. 2. [F] Columns/gutters [F: 4/8/12 at 8px base]. 3. [E] Existing grid to import (Figma layout grid)? If yes → REFERENCED, drift-tracked.

## `tokens` — `design/token-set.json`

Purpose: MATERIALIZED values from system artifacts (colors, palettes, typography, grid). **No elicitation** — a compile target, not an authored artifact. Interview: none. Regeneration is the drift remedy; hand-edits are drift violations against the owning system artifact.

```json
{ "materializedFrom": ["brand-colors@v3", "palettes@v2", "typography@v1", "grid@v1"],
  "tokens": { "color.surface": "#FFF", "type.body.size": "16px", "space.2": "16px" } }
```

## `a11y-spec` — `.uxfactory/artifacts/accessibility.json`

Purpose: the accessibility contract; the most automatable check class.

```json
{
  "target": "WCAG-2.2-AA",
  "contrast": { "text": 4.5, "largeText": 3.0, "nonText": 3.0 },
  "touchTargetMinPx": 44,
  "focus": { "visibleIndicator": true, "orderRule": "reading-order" },
  "motion": { "respectReducedMotion": true, "maxAutoplaySec": 5 },
  "media": { "altTextRequired": true },
  "exceptions": [{ "scope": "nodeId | typeId", "rule": "string", "justification": "string", "expires": "iso8601" }]
}
```

Elicitation: 1. [F] Target [F: WCAG 2.2 AA; only asks if legal/regulatory context (EAA, government) forces AAA or specific statutes]. 2. [D] Adjustments from `audience` accessibility notes (older segments → larger min sizes). 3. [E] Known exceptions? Each demands a justification and expiry — waivers are ledger entries, not comments. Everything else defaults from the target level; **this is deliberately the shortest interview in the registry** because its value is in checking, not authoring.

## `interaction-states` — `design-system.json#states`

Purpose: state vocabulary and visual grammar — interaction states + content states. Kills happy-path-only generation.

```json
{
  "interaction": { "hover": { "treatment": "string" }, "focus": { "treatment": "ref:a11y-spec.focus" },
                   "active": {}, "disabled": { "treatment": "string", "contrastExempt": true } },
  "content": { "empty": { "pattern": "illustration+cta | text" }, "loading": { "pattern": "skeleton | spinner", "thresholdMs": 300 },
               "error": { "pattern": "inline | toast | page", "tone": "ref:voice-tone" }, "partial": { "pattern": "string" } },
  "motion": { "durationsMs": { "fast": 100, "base": 200 }, "easing": "ease-out", "reducedMotion": "ref:a11y-spec" }
}
```

Elicitation: 1. [F] Interaction treatments [F: generated from palettes; rendered on a sample button, approve/tweak]. 2. [E] Empty states: illustration-led or text-led? 3. [E] Loading: skeletons or spinners? 4. [E] Errors: inline, toast, or page-level — and when each? 5. [F] Motion [F: fast/base/ease-out].

## `brand-usage` — `design-system.json#brand`

Purpose: logo and brand application rules; channel-weighted.

```json
{ "logo": { "assets": ["path"], "clearspace": "1x logomark", "minSizePx": 24,
            "misuse": ["no stretching", "no recolor"], "backgrounds": ["colorRef"] },
  "coBranding": { "allowed": false, "rules": ["string"] } }
```

Elicitation: 1. [E] Upload logo variants (or import brand guide → REFERENCED). 2. [F] Clearspace/min-size [F: standard]. 3. [E] Known misuse rules from the brand owner? 4. [F] Co-branding [F: disallowed].

## `dataviz` — `design-system.json#dataviz` (lazily activated)

Purpose: chart conventions. No consuming type yet.

```json
{ "categoricalPalette": ["colorRef"], "sequentialRamp": ["colorRef"],
  "rules": ["zero-baseline for bar charts", "max 6 series before grouping"], "numberFormat": { "locale": "ref:config", "compact": true } }
```

Elicitation (on activation): 1. [D] Palettes derived from `brand-colors` with colorblind-safe check against `a11y-spec`. 2. [E] House rules on chart types? 3. [F] Number formats [F: locale].

## `channel-canvas` — `design-system.json#channels`

Purpose: per-channel canvas constraints; replaces `grid` on the channel surface.

```json
{ "channels": {
    "email": { "maxWidthPx": 600, "safeFonts": ["faceRef"], "darkModeBehavior": "string", "imageToTextRatio": 0.4 },
    "instagram-post": { "canvas": [1080, 1350], "safeMarginPx": 60, "textMaxShare": 0.2 },
    "instagram-story": { "canvas": [1080, 1920], "uiAvoidZonesPx": { "top": 250, "bottom": 250 } },
    "youtube-thumbnail": { "canvas": [1280, 720], "minTitleSizePx": 60 },
    "facebook-post": { "canvas": [1200, 630] },
    "x-post": { "canvas": [1600, 900] }
} }
```

Elicitation: **near-zero.** 1. [F] All specs default from current platform requirements (shipped with the product, version-tracked as REFERENCED against platform docs — platforms change specs; drift-track this one). 2. [E] Only asked: which channels does this project use? (Activates sections.)

---

# Assets

## `icons` — `assets/icons.json`

```json
{ "set": "lucide | material | custom", "style": "outline | filled | duotone",
  "gridPx": 24, "strokePx": 1.5, "customGlyphs": [{ "name": "string", "path": "path" }] }
```

Elicitation: 1. [E] Existing set or pick one (rendered samples in project style)? 2. [F] Grid/stroke [F: 24/1.5]. 3. [E] Custom glyphs to import?

## `photography` — `assets/photography.json`

```json
{ "direction": "string", "treatment": { "saturation": "string", "overlay": "colorRef | null" },
  "subjects": ["string"], "avoid": ["string"], "sources": [{ "type": "library | stock | generated", "ref": "string", "license": "string" }] }
```

Elicitation: 1. [E] Art direction in a phrase ("candid, warm, natural light"). 2. [E] Subjects to show / avoid. 3. [E] Source: own library (import), stock (which license), or generated? 4. [F] Treatment [F: derived from palettes].

## `illustrations` — `assets/illustrations.json`

```json
{ "style": "string", "strokeAlignment": "ref:icons", "palette": ["colorRef"], "usage": ["empty-states", "onboarding"], "sources": [] }
```

Elicitation: 1. [E] Illustration style (rendered samples)? 2. [D] Palette subset from `brand-colors`. 3. [F] Usage contexts [F: empty states + onboarding, per `interaction-states`].

---

# Content

## `copy-deck` — `content/copy-deck.json`

Purpose: real language for generation; the anti-lorem-ipsum artifact. Keyed to nodes/components, not freeform.

```json
{ "entries": [
    { "key": "nodeId.slot | componentId.slot", "text": "string", "maxChars": 60,
      "toneRef": "voice-tone", "localeVariants": { "en-US": "string" }, "status": "draft | approved" }
  ] }
```

Elicitation: 1. [D] Slot inventory derived from sitemap + component specs — the deck's skeleton is generated, never asked. 2. [E] Per slot: approve generated candidate copy (from voice-tone + glossary + story context) or supply your own. 3. [E] Who approves copy — is `approved` status gated to a role? (Feeds `conformance-policy`.)

## `voice-tone` — `content/voice-tone.json`

```json
{ "voice": { "traits": ["string"], "isNot": ["string"] },
  "toneBySituation": [{ "situation": "error | success | onboarding | marketing", "adjustment": "string" }],
  "conventions": { "person": "second", "contractions": true, "sentenceLengthMax": 20 } }
```

Elicitation: 1. [E] Three traits your product's voice has — and for each, what it is *not* ("confident, not arrogant"). 2. [E] How does tone shift in errors vs. celebration vs. marketing? 3. [F] Conventions [F: second person, contractions on].

## `glossary` — `content/glossary.json`

Purpose: sanctioned terms; the widest-footprint recommended artifact. Exact-match checks.

```json
{ "terms": [{ "use": "Sign in", "never": ["Log in", "Login"], "context": "auth", "caseSensitive": true }],
  "productNouns": [{ "term": "string", "definition": "string" }],
  "capitalization": "sentence | title", "locale": "ref:config" }
```

Elicitation: 1. [D] Candidate product nouns extracted from stories/features — confirm definitions. 2. [E] Known term battles? ("Do you say cart or basket? Sign in or log in?") — present common pairs for the project's category, pick sides. 3. [F] Capitalization [F: sentence case].

---

# Components

## `component-spec` — `components/*.json` (project-bound set)

Purpose: contract per component — slots, props, states, token bindings, AC traces.

```json
{
  "componentId": "C-search-bar", "level": "template | organism | molecule",
  "purpose": "string",
  "slots": [{ "name": "string", "accepts": ["componentId | text | media"] }],
  "props": [{ "name": "string", "type": "string", "default": "any" }],
  "states": ["ref:interaction-states vocabulary"],
  "tokenBindings": { "surface": "color.surface" },
  "storyRefs": ["ST-004"],
  "a11y": { "role": "string", "keyboardMap": [{ "key": "Enter", "action": "string" }] }
}
```

Elicitation (per component): 1. [E] What is this component for (one sentence)? 2. [D] Level — inferred from composition; confirm. 3. [E] What varies (props) and what's slotted (content areas)? 4. [D] States — checklist from `interaction-states` vocabulary; declare which apply. Implementing an undeclared state or missing a declared one = conformance failure (mapping decision 15). 5. [D] Story traces — required at organism level (mapping: "must trace to ≥1 AC"). 6. [D] a11y role/keyboard from pattern library defaults per component archetype; confirm.

---

# References

## `reference-set` — `references/*.json` (REFERENCED provenance)

```json
{ "refId": "R-01", "kind": "exemplar | competitor | moodboard",
  "source": { "url": "string | null", "file": "path | null" },
  "whatToTake": ["density", "nav pattern"], "whatToIgnore": ["their colors"],
  "appliesTo": ["typeId | nodeId"] }
```

Elicitation (per reference): 1. [E] Add the reference (URL/image). 2. [E] **What specifically should generation take from it — and what must it ignore?** (The ignore clause is the anti-plagiarism and anti-drift guard; an unqualified reference is a liability, not an input.) 3. [F] Applies-to [F: all generation-heavy types].

---

# Governance

## `conformance-policy` — `.uxfactory/artifacts/policy.json` (resolver-consumed)

Purpose: the gate's own configuration. Converts mapping decisions 1–2 into team-owned defaults.

```json
{
  "checks": [{ "checkId": "a11y.contrast", "severity": "block | warn | off" }],
  "driftDefaults": { "pin": "block", "track": "warn" },
  "ungovernedDraft": { "allowed": true, "watermark": true, "excludedFromCoverage": true },
  "waivers": { "requireJustification": true, "requireExpiry": true, "approverRole": "string | null" },
  "inputIntegrity": { "onFailure": "block | warn" }
}
```

Elicitation: 1. [F] Everything defaults (drift: pin→block/track→warn; ungoverned drafts allowed but watermarked; waivers need justification+expiry). 2. [E] Only two real questions: *How strict on day one — advisory (warn-heavy) or enforcing (block-heavy)?* (Sets the severity profile wholesale.) And: *does anyone have to approve waivers?*

## `generation-config` — `.uxfactory/artifacts/generation-config.json` (resolver-consumed)

Purpose: versioned generation defaults for provenance stamping.

```json
{ "dials": { "tone": "mix", "visual": "high", "editorial": "medium", "flows": "shallow", "coherence": "high" },
  "style": "Minimalism", "fidelityDefault": "mockup", "variationsDefault": 1 }
```

Elicitation: **none new** — this artifact is the existing project-config dials, captured and versioned. Created automatically on first generation; the only interaction is a version bump confirmation when dials change ("save as config v4?").

---

# Cross-cutting rules

1. **Interview ordering follows the trace graph.** `audience` → `personas` → `stories` → everything downstream. The wizard never runs a story interview before personas exist; a chip's create affordance chains prerequisite interviews.
2. **Derived beats elicited.** Any question answerable from a registered artifact, the manifest, or project config is [D] and rendered as a confirmation, not a blank field. The [E] count per artifact is a tracked metric; interviews that grow [E] questions need justification.
3. **Every [E] answer becomes checkable or gets cut.** If an elicited field never feeds generation or a check, it's ceremony — remove it from the schema.
4. **Imports change provenance, not schema.** Importing a brand guide or Figma styles fills the same `body`, sets provenance REFERENCED, and activates drift tracking against the source. The interview shrinks to confirmations.
5. **Assisted authoring is default.** [F] and [D] answers pre-fill; the human's job is approval and the [E] residue. Target: no artifact interview above 5 [E] questions except `stories` (which is per-story and bulk-importable).
6. **Reshaped registered artifacts migrate on touch.** Four registered artifacts (`brand-colors`, `palettes`, `fonts`, `grid`) change body shape versus today's `design-system.json` (flat arrays/objects → role-tagged structures). Readers treat envelope-less legacy bodies as `schemaVersion: "0"` and accept them; the first write through the new schema migrates the body and stamps the envelope — the same migrate-on-touch behavior artifact writes already use for legacy paths.
7. **`ref:` targets are integrity-checked.** The cross-artifact reference convention (`ref:a11y-spec.focus`, `ref:voice-tone`, `ref:icons`) joins the input-integrity family from mapping decision 11 — a dangling `ref:` is the same failure class as an orphaned story actor.

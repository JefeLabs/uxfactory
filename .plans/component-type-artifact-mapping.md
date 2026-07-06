# Component Type → Artifact Requirement Mapping

Draft for splice into the Design Artifacts & Models PRD. The mapping is **data, not code**: the plugin reads it to render Required Artifacts chips per selected Type and to gate generation. Project quadrant modifiers are applied at resolution time.

---

## 1. Artifact ID registry

Canonical IDs derived from the current inventory. IDs are stable; paths may move.

| ID | Category | Path | Status |
|---|---|---|---|
| `product-brief` | Product | `.uxfactory/artifacts/product-brief.md` *(migrate from `brief.md`)* | registered |
| `creative-brief` | Product | `.uxfactory/artifacts/creative/*.md` — **per-campaign set, not singleton** | **unregistered** |
| `stories` | Product | `.uxfactory/artifacts/stories/*.json` — project-bound set; each story names its persona actor and owns its ACs | **unregistered** |
| `features` | Product | `.uxfactory/artifacts/features.json` — groups stories; **never gates, only scopes** (coverage denominator, generation scoping, extend-quadrant unit) | **unregistered** |
| `acceptance-criteria` | Product | `design/acceptance-criteria.json` *(already story-shaped — `{stories:[…]}` with ACs inside; see decision 6)* | registered |
| `sitemap` | IA/UX | `.uxfactory/artifacts/sitemap.json` | registered |
| `flows` | IA/UX | `.uxfactory/artifacts/flows.json` | registered |
| `journey-map` | IA/UX *(proposed)* | `.uxfactory/artifacts/journey-maps/*.json` — NN/g sense: experience across touchpoints with emotional arc; upstream research, gate-adjacent only | **unregistered** |
| `navigation-model` | IA/UX *(proposed)* | `sitemap.json#navigation` — global nav, breadcrumbs, wayfinding; fragment, not a new file | **unregistered** |
| `brand-colors` | Design | `.uxfactory/artifacts/design-system.json#colors` | registered |
| `palettes` | Design | `.uxfactory/artifacts/design-system.json#palettes` | registered |
| `fonts` | Design | `.uxfactory/artifacts/design-system.json#fonts` | registered |
| `typography` | Design | `.uxfactory/artifacts/design-system.json#typography` — type scale, hierarchy rules, line heights, responsive scaling; `tokens` MATERIALIZED from it | **unregistered** |
| `grid` | Design | `.uxfactory/artifacts/design-system.json#grid` | registered |
| `tokens` | Design | `design/token-set.json` | registered |
| `a11y-spec` | Design *(proposed)* | `.uxfactory/artifacts/accessibility.json` — WCAG target level, contrast ratios, touch targets, focus order, motion-reduction | **unregistered** |
| `interaction-states` | Design *(proposed)* | `design-system.json#states` — hover/focus/active/disabled + empty/loading/error/partial content states; motion & easing | **unregistered** |
| `brand-usage` | Design *(proposed)* | `design-system.json#brand` — logo clearspace, misuse rules, co-branding | **unregistered** |
| `dataviz` | Design *(proposed)* | `design-system.json#dataviz` — chart palettes, axis rules; enters mappings lazily when a dashboard-class type exists | **unregistered** |
| `icons` | Assets | `.uxfactory/artifacts/assets/icons.json` | registered |
| `photography` | Assets | `.uxfactory/artifacts/assets/photography.json` | registered |
| `illustrations` | Assets | `.uxfactory/artifacts/assets/illustrations.json` | registered |
| `copy-deck` | Content *(proposed)* | `.uxfactory/artifacts/content/copy-deck.md` | **unregistered** |
| `voice-tone` | Content *(proposed)* | `.uxfactory/artifacts/content/voice-tone.json` | **unregistered** |
| `glossary` | Content *(proposed)* | `.uxfactory/artifacts/content/glossary.json` — sanctioned/forbidden terms, capitalization; locale-aware (gives the `en-US` config chip a governed referent) | **unregistered** |
| `component-spec` | Components *(proposed)* | `.uxfactory/artifacts/components/*.json` | **unregistered** |
| `channel-canvas` | Design *(proposed)* | `design-system.json#channels` | **unregistered** |
| `audience` | Product *(proposed)* | `.uxfactory/artifacts/audience.json` — quantitative segmentation; modulates rendering | **unregistered** |
| `personas` | Product *(proposed)* | `.uxfactory/artifacts/personas/*.json` — project-bound set; behavioral archetypes referenced by stories ("As a ___") | **unregistered** |
| `reference-set` | References *(proposed)* | `.uxfactory/artifacts/references/*.json` — exemplar designs, competitor screens, moodboards; the registry's first **REFERENCED**-provenance artifact | **unregistered** |
| `conformance-policy` | Governance *(proposed)* | `.uxfactory/artifacts/policy.json` — check set & severities, drift defaults (pin/track), waiver rules; **resolver/Checks-consumed, never gates** | **unregistered** |
| `generation-config` | Governance *(proposed)* | `.uxfactory/artifacts/generation-config.json` — versioned generation defaults (tone/visual/editorial dials) for provenance stamping; never gates | **unregistered** |

Unregistered IDs may appear in mappings with `"status": "planned"`; the plugin renders them as disabled chips ("coming soon") rather than blocking on artifacts that cannot yet be created. When a Content/Components artifact type ships, flipping its registry status activates the requirement everywhere it is referenced — no mapping edits needed.

**`stories` gate, `features` scope.** Stories and ACs move in lockstep at every requirement level (UI may render them as one composite "Stories & ACs" chip; they remain distinct artifacts underneath). Lockstep is a schema invariant: a type listing either `stories` or `acceptance-criteria` must list BOTH at the same level — including `n/a` (see atom, email); omitting both means "not rendered" for the pair. `features` appears in **no** `requires` block by design — features are consumed by coverage reporting (the denominator behind the project-config Coverage setting), generation scoping ("generate pages for feature X"), and the extend-quadrant inherited-vs-net-new resolution, never by the gate.

**The resolver-consumed class** now has three members: `features`, `conformance-policy`, `generation-config`. None ever appears in a `requires` block — they configure or scope the gate rather than feed it. `conformance-policy` in particular converts open decisions 1 and 2 (escape hatch, drift blocking) from product decisions into team-owned defaults: the gate's behavior becomes governed data, waivers become auditable entries rather than exceptions.

**Provenance coverage**: `reference-set` is the registry's first REFERENCED artifact; everything else is OWNED (with `tokens` MATERIALIZED from system artifacts per decision 9). If the provenance taxonomy is complete, GENERATED artifacts exist too — but those are outputs in the manifest, never registry entries. Inputs are OWNED, REFERENCED, or MATERIALIZED; outputs are GENERATED. That sentence may be worth lifting into the provenance section of the PRD.

**`audience` vs. `personas`** is a segmentation/actor split: `audience` is quantitative (the demoted Target Demographic panel — modulates tone, density, editorial level at rendering time); `personas` are qualitative behavioral archetypes that participate in intent — the "As a ___" of every story resolves to a persona. Personas therefore sit upstream of `acceptance-criteria` in the trace graph (`persona → story → AC → node`), making them a dependency of the gate hinge rather than a peer of it. Requirement resolves as existence **plus referential integrity** (every story's actor references a registered persona). Targeting a specific persona in a generation is a generation parameter, not a binding semantics.

**Design style and `reference-set`.** Design style is deliberately absent from this registry — it is project config (`classification.designStyle`, with an explicit exploring state and per-generation overrides), not an artifact. `reference-set` is where style exploration converges into governed material: while exploring, per-request style overrides produce candidates; winning exemplars are captured as `reference-set` entries; the team then adopts a project default from the ContextBar. Lifecycle: **exploring → reference-set → adopted default**. The advisory style-conformance checks read the config; `reference-set` grounds generation quality — config decides, the artifact remembers why.

**`fonts` vs. `typography`** follows the `brand-colors`/`palettes` precedent: inventory vs. system. `fonts` = sanctioned typefaces and pairings (selection artifact); `typography` = type scale, hierarchy rules, line heights, responsive scaling (rules artifact). The product surface consumes the system; the channel surface consumes only the inventory (a social canvas has no responsive hierarchy). Nearly all typographic conformance checks hinge on `typography`, not `fonts` — the split is what makes type checkable.

---

## 2. Requirement levels

| Level | Gate behavior | Chip rendering |
|---|---|---|
| `required` | Generation blocked until registered and current per drift policy | Filled = satisfied; hollow + create/link affordance = missing; amber = drifted (pin/track policy decides block vs. warn) |
| `recommended` | Generation proceeds; result annotated as partially grounded | Hollow, non-blocking |
| `optional` | Consumed if present, never surfaced as missing | Shown only when registered |
| `n/a` | Below intent granularity or out of scope for this type | Not rendered |

Gate rule (canonical sentence for the PRD): **conformance is judged at the level where intent lives.** Stories/ACs are `required` only for types at or above that level.

---

## 3. Type groups

The flat 15-item dropdown reorganized into four groups. Group membership determines the gate hinge.

| Group | Types | Gate hinge |
|---|---|---|
| `flows` | User Flow | `stories` + `acceptance-criteria` (multi-story) + `flows` |
| `pages` | Home Page, Secondary Page, Tertiary Page, Page | `stories` + `acceptance-criteria` |
| `components` | Template, Organism, Molecule, Atom | `stories` + `acceptance-criteria` (Organism+ only) |
| `channel` | Email, Instagram Post, Instagram Story, YouTube Thumbnail, Facebook Post, X Post | `creative-brief` (**not** ACs); `copy-deck` demotes to rendering input |

---

## 4. Mapping schema

```json
{
  "$schema": "uxfactory/component-type-mapping/v1",
  "artifactRegistry": "…(section 1 as data)…",
  "types": {
    "<typeId>": {
      "group": "flows | pages | components | channel",
      "requires": { "<artifactId>": "required | recommended | optional" },
      "quadrantModifiers": {
        "<quadrant>": { "<artifactId>": "<overridden level>" }
      }
    }
  }
}
```

Resolution order: base `requires` → apply `quadrantModifiers[project.quadrant]` → drop any artifact whose registry status is `planned` down to non-blocking → render chips, compute gate.

---

## 5. The mapping

```json
{
  "$schema": "uxfactory/component-type-mapping/v1",
  "types": {

    "user-flow": {
      "group": "flows",
      "requires": {
        "stories": "required",
        "acceptance-criteria": "required",
        "personas": "required",
        "flows": "required",
        "sitemap": "recommended",
        "grid": "required",
        "typography": "required",
        "brand-colors": "optional",
        "fonts": "optional",
        "icons": "optional",
        "a11y-spec": "required",
        "interaction-states": "recommended",
        "journey-map": "optional"
      }
    },

    "home-page": {
      "group": "pages",
      "requires": {
        "stories": "required",
        "acceptance-criteria": "required",
        "product-brief": "required",
        "sitemap": "required",
        "brand-colors": "required",
        "fonts": "required",
        "typography": "required",
        "grid": "required",
        "tokens": "recommended",
        "icons": "required",
        "photography": "recommended",
        "illustrations": "optional",
        "copy-deck": "required",
        "audience": "recommended",
        "personas": "recommended",
        "a11y-spec": "required",
        "interaction-states": "recommended",
        "glossary": "recommended",
        "navigation-model": "recommended",
        "reference-set": "recommended",
        "brand-usage": "optional"
      }
    },

    "secondary-page": {
      "group": "pages",
      "requires": {
        "stories": "required",
        "acceptance-criteria": "required",
        "sitemap": "required",
        "brand-colors": "required",
        "fonts": "required",
        "typography": "required",
        "grid": "required",
        "tokens": "recommended",
        "icons": "required",
        "photography": "optional",
        "copy-deck": "required",
        "personas": "recommended",
        "a11y-spec": "required",
        "interaction-states": "recommended",
        "glossary": "recommended",
        "navigation-model": "recommended",
        "reference-set": "optional"
      }
    },

    "tertiary-page": {
      "group": "pages",
      "requires": {
        "stories": "required",
        "acceptance-criteria": "required",
        "sitemap": "recommended",
        "brand-colors": "required",
        "fonts": "required",
        "typography": "required",
        "grid": "required",
        "tokens": "recommended",
        "icons": "recommended",
        "copy-deck": "recommended",
        "a11y-spec": "required",
        "interaction-states": "recommended",
        "glossary": "recommended"
      }
    },

    "page": {
      "group": "pages",
      "requires": {
        "stories": "required",
        "acceptance-criteria": "required",
        "brand-colors": "required",
        "fonts": "required",
        "typography": "required",
        "grid": "required",
        "tokens": "recommended",
        "icons": "recommended",
        "copy-deck": "recommended",
        "a11y-spec": "required",
        "interaction-states": "recommended",
        "glossary": "recommended",
        "reference-set": "optional"
      }
    },

    "template": {
      "group": "components",
      "requires": {
        "stories": "optional",
        "acceptance-criteria": "optional",
        "grid": "required",
        "typography": "required",
        "brand-colors": "required",
        "fonts": "required",
        "tokens": "required",
        "component-spec": "required",
        "a11y-spec": "required",
        "interaction-states": "required"
      },
      "notes": "Structural, not story-bound. component-spec here = slot/region schema."
    },

    "organism": {
      "group": "components",
      "requires": {
        "stories": "required",
        "acceptance-criteria": "required",
        "brand-colors": "required",
        "fonts": "required",
        "typography": "required",
        "grid": "required",
        "tokens": "required",
        "icons": "recommended",
        "component-spec": "required",
        "personas": "optional",
        "a11y-spec": "required",
        "interaction-states": "required",
        "glossary": "recommended"
      },
      "notes": "Lowest level where intent lives; must trace to ≥1 AC."
    },

    "molecule": {
      "group": "components",
      "requires": {
        "stories": "optional",
        "acceptance-criteria": "optional",
        "brand-colors": "required",
        "fonts": "required",
        "typography": "required",
        "tokens": "required",
        "icons": "optional",
        "component-spec": "recommended",
        "a11y-spec": "required",
        "interaction-states": "required"
      }
    },

    "atom": {
      "group": "components",
      "requires": {
        "stories": "n/a",
        "acceptance-criteria": "n/a",
        "brand-colors": "required",
        "fonts": "required",
        "typography": "required",
        "tokens": "required",
        "a11y-spec": "required",
        "interaction-states": "required"
      },
      "notes": "Below intent granularity. Token bindings are the conformance surface."
    },

    "email": {
      "group": "channel",
      "requires": {
        "stories": "n/a",
        "acceptance-criteria": "n/a",
        "creative-brief": "required",
        "copy-deck": "required",
        "voice-tone": "required",
        "brand-colors": "required",
        "fonts": "required",
        "typography": "recommended",
        "channel-canvas": "required",
        "photography": "optional",
        "illustrations": "optional",
        "audience": "recommended",
        "a11y-spec": "recommended",
        "glossary": "recommended",
        "brand-usage": "recommended"
      },
      "notes": "channel-canvas resolves to email constraints (600px, client-safe fonts)."
    },

    "instagram-post": { "group": "channel", "requires": { "creative-brief": "required", "copy-deck": "required", "voice-tone": "required", "brand-colors": "required", "fonts": "required", "channel-canvas": "required", "photography": "recommended", "illustrations": "optional", "audience": "recommended", "personas": "recommended", "brand-usage": "recommended", "glossary": "recommended", "reference-set": "recommended" } },
    "instagram-story": { "group": "channel", "requires": { "creative-brief": "required", "copy-deck": "required", "voice-tone": "required", "brand-colors": "required", "fonts": "required", "channel-canvas": "required", "photography": "recommended", "audience": "recommended", "personas": "recommended", "brand-usage": "recommended", "glossary": "recommended", "reference-set": "recommended" } },
    "youtube-thumbnail": { "group": "channel", "requires": { "creative-brief": "required", "copy-deck": "required", "brand-colors": "required", "fonts": "required", "channel-canvas": "required", "photography": "recommended", "illustrations": "optional", "brand-usage": "recommended", "glossary": "recommended", "reference-set": "recommended" } },
    "facebook-post": { "group": "channel", "requires": { "creative-brief": "required", "copy-deck": "required", "voice-tone": "required", "brand-colors": "required", "fonts": "required", "channel-canvas": "required", "photography": "optional", "audience": "recommended", "personas": "recommended", "brand-usage": "recommended", "glossary": "recommended" } },
    "x-post": { "group": "channel", "requires": { "creative-brief": "required", "copy-deck": "required", "voice-tone": "required", "brand-colors": "required", "channel-canvas": "required", "brand-usage": "recommended", "glossary": "recommended" } }
  },

  "quadrantModifiers": {
    "re-skin": {
      "description": "Intent inherited and frozen; presentation regenerated.",
      "overrides": {
        "stories": "recommended",
        "acceptance-criteria": "recommended",
        "sitemap": "recommended",
        "product-brief": "optional"
      }
    },
    "extend": {
      "description": "Existing intent inherited; new nodes need new intent.",
      "overrides": {},
      "notes": "No blanket relaxation — new pages/organisms still require ACs. Resolver checks whether the target node is inherited (relaxed) or net-new (base requirements)."
    },
    "redesign": {
      "description": "Brownfield: intent inherited, presentation regenerated.",
      "overrides": {
        "product-brief": "recommended"
      }
    },
    "greenfield": {
      "description": "No relaxation. Full gate.",
      "overrides": {}
    }
  }
}
```

Quadrant modifiers are declared globally per-artifact rather than per-type — a re-skin relaxes ACs everywhere or nowhere. If a type-specific exception surfaces, the schema allows per-type `quadrantModifiers` to shadow the global block.

---

## 6. Open decisions

1. **Escape hatch**: is "Generate ungoverned draft — will not pass checks" offered when `required` artifacts are missing, or is the gate absolute? Affects `required` semantics in §2.
2. **Drift blocking**: does a `track`-policy artifact that has drifted block generation or warn? Suggested default: pin → block, track → warn.
3. **`extend` resolution**: the inherited-vs-net-new node check requires the resolver to consult the manifest, making the mapping resolution manifest-aware. Confirm this is acceptable coupling.
4. **Home Page requiring `product-brief`**: defensible (the home page is the brief made visible) but it's the only page type that does — confirm or flatten.
5. **`channel-canvas` shape**: one artifact with per-channel sections vs. one artifact per channel. Per-channel sections assumed above.
6. ~~Stories as first-class~~ **Resolved**: `stories` added, paired with `acceptance-criteria` at every level. Remaining sub-decision: file shape. Corrected framing: the engine's `design/acceptance-criteria.json` is **already story-shaped** — the gate reads `{stories: [{id, title, …}]}` with ACs living inside their stories today. Nesting is therefore not a restructure but a formalization (and at most a relocation); it's the separate `stories/*.json` + referencing-file option that would introduce NEW fragmentation plus an AC→story integrity check that nesting gets for free. Recommendation: nest — one artifact, one integrity surface, near-zero migration.
7. **Instance-binding for `creative-brief`**: it is a per-campaign set, not a singleton, so `required` cannot mean "exists in the project" — it must mean "one is linked to this generation." This introduces a second requirement semantics (instance-bound vs. project-bound) that the resolver and chip UI must distinguish. Chip affordance becomes a picker ("Select creative brief") rather than a create/link prompt.
8. **Design brief composition**: with the split, decide whether the design brief is a third registered artifact or a generation-time composition of `product-brief` + `audience`. Leaning composition — fewer artifact types, and audience already warrants its own file.
9. **`typography` → `tokens` materialization**: assumed here that `typography` is the OWNED semantic definition and type tokens in `token-set.json` are MATERIALIZED from it (mirroring colors → color tokens). Confirm, and confirm the same relationship holds for `grid` → spacing tokens — if so, the pattern generalizes: *system artifacts own semantics; token-set materializes values*, and drift between a system artifact and its tokens becomes a checkable condition.
10. **Personas in the trace graph**: `persona → story → AC → node` makes personas the only registered dependency of the gate hinge itself. Decide whether the trace graph models this edge explicitly (enabling impact analysis: "which nodes are affected if this persona changes?") or treats personas as opaque references inside stories.
11. **Input-integrity check family**: with stories first-class the family is now enumerable — story→persona (orphaned actor), AC→story (orphaned criterion), story→AC (untestable story), story→feature (unscoped story, warning-grade only since features never gate). These validate intent artifacts against each other, distinct from output conformance — a new §14 category. Decide whether input-integrity failures block generation (bad intent can't gate anything) or surface as warnings.
12. **Coverage semantics**: the project-config Coverage setting needs `features` as its denominator to mean anything — coverage = features whose stories have conforming nodes / total features. Confirm this definition, and whether Coverage (currently a generation dial) should instead be a *reported metric* in Checks. A dial implies the user sets it; a metric implies the system computes it. It cannot coherently be both.
13. **Feature as extend unit**: if the extend quadrant's inherited-vs-net-new resolution operates at feature granularity, the resolver needs `features` registered even though no type requires it — an artifact required by the *resolver*, not by any *type*. Schema may need a `resolverRequires` block per quadrant.
14. **a11y default target**: does `a11y-spec` ship with a default (WCAG 2.2 AA) that applies even before the team registers one, or is an unregistered a11y-spec simply unchecked? Given EAA/ADA exposure, a checked-by-default posture is defensible and differentiating — but it means the gate enforces something the team never registered, which cuts against "conformance to *your* registered intent." Suggested resolution: default-on as `recommended`-grade warnings, escalating to blocking only once the team registers a spec.
15. **`interaction-states` vs. `component-spec` seam**: global state conventions (this artifact) vs. per-component state enumerations (inside `component-spec`). Proposed rule: `interaction-states` defines the vocabulary and visual grammar; each `component-spec` declares which states it implements. Conformance check: a component implementing a state not in the vocabulary, or missing a state its spec declares.
16. **`generation-config` vs. the manifest-node test**: versioning generation defaults as an artifact gives every generation provenance ("produced under config v3") but blurs the setup/artifact boundary — config dials don't change which nodes exist. Resolution: it passes the test *because* it fails it — it's not setup precisely because it doesn't change node existence, which is why it belongs in artifact space. Confirm this reading or keep config ephemeral.

---

## 7. Build priority (computed)

Mechanically derived from §5: for each **unregistered** artifact, count its requirement slots across the 15 types. Gate-demand score = required×3 + recommended×1. **Regenerate this table after any mapping edit** — it is a projection of §5, not an independent opinion. (Script: parse the §5 JSON, tally levels per artifact ID, filter to unregistered.)

| Rank | Artifact | Required | Recommended | Optional | Score | Note |
|---|---|---|---|---|---|---|
| 1 | `typography` | 9 | 1 | 0 | 28 | Entire product surface + email; unlocks the largest visible check class |
| 1 | `a11y-spec` | 9 | 1 | 0 | 28 | Same reach; external compliance pressure; strongest §14 demo |
| 3 | `copy-deck` | 8 | 2 | 0 | 26 | All pages + all channel; without it, generation is lorem-ipsum-grade |
| 4 | `stories` | 6 | 0 | 2 | 18 | Gate hinge upstream half; blocks the conformance story end-to-end |
| 4 | `creative-brief` | 6 | 0 | 0 | 18 | Sole channel-surface gate hinge; instance-bound (decision 7) |
| 4 | `channel-canvas` | 6 | 0 | 0 | 18 | Channel surface cannot generate without canvas specs |
| 7 | `interaction-states` | 4 | 5 | 0 | 17 | Required at all component levels; kills happy-path-only generation |
| 8 | `voice-tone` | 5 | 0 | 0 | 15 | Channel surface only |
| 9 | `glossary` | 0 | 11 | 0 | 11 | Never blocks, but widest recommended footprint in the registry |
| 10 | `personas` | 1 | 5 | 1 | 8 | **Score misleads — see dependency note** |
| 11 | `component-spec` | 2 | 1 | 0 | 7 | Template/Organism blocked without it |
| 12 | `brand-usage` | 0 | 6 | 1 | 6 | Channel-weighted |
| 13 | `audience` | 0 | 5 | 0 | 5 | Rendering modulation only |
| 14 | `reference-set` | 0 | 4 | 2 | 4 | Generation quality, not gate |
| 15 | `navigation-model` | 0 | 2 | 0 | 2 | Sitemap fragment |
| 16 | `journey-map` | 0 | 0 | 1 | 0 | Parked by design |
| — | `dataviz` | 0 | 0 | 0 | 0 | Lazily activated; no dashboard-class type yet |
| — | `features` | 0 | 0 | 0 | 0 | **Resolver-consumed — score structurally 0, see below** |
| — | `conformance-policy` | 0 | 0 | 0 | 0 | **Resolver-consumed — score structurally 0, see below** |
| — | `generation-config` | 0 | 0 | 0 | 0 | **Resolver-consumed — score structurally 0, see below** |

Two corrections the raw score cannot see:

**Dependency ordering beats slot count.** `stories` (18) is unusable without `personas` (8): every story's actor must reference a registered persona, so personas must exist *first* even though they hold fewer slots. The intent chain builds in trace-graph order — `personas → stories (+ACs) → gate` — regardless of score. Same logic puts `component-spec` ahead of its rank for any roadmap where Organism generation ships early.

**The resolver-consumed class scores zero by construction.** `features`, `conformance-policy`, and `generation-config` appear in no `requires` block *by design* (§1), so gate-demand scoring is blind to them. Their priority comes from what they unblock: `conformance-policy` unblocks decisions 1–2 and the waiver model; `features` unblocks Coverage (decision 12) and extend resolution (decision 13). Score measures gate demand, not build priority — it is one input to sequencing, not the sequence.

**Suggested build order** (score + dependency + resolver corrections): `typography`, `a11y-spec` → `personas`, `stories` (with nested ACs per decision 6) → `copy-deck`, `interaction-states` → `conformance-policy` → channel cluster (`creative-brief`, `channel-canvas`, `voice-tone`) as one unit, since the channel surface is all-or-nothing. Everything below rank 9 is demand-driven.

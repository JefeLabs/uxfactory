# UXFactory — Design Artifacts & Data Models

**Product:** UXFactory (JefeLabs)
**Document:** PRD — Design Artifacts & Data Models
**Version:** 0.3 (Draft for review)
**Owner:** Edwin Cruz
**Last updated:** 2026-06-29
**Status:** Draft

> **0.3 changelog.** Generalizes fidelity into a **four-dial render scope** (§6.5): two *fidelity* dials (**Visual**, **Editorial** — how polished a state is) and two *completeness* dials (**Coverage**, **Flow** — how much of the spec graph is rendered: states-per-view and paths-across-views). Corrects the prior "structural tiers always run" — Tiers 0·1·2 now ramp on the Coverage and Flow dials. `GateCheck` / `GateRun` / `RenderBatch` / `ProjectClassification` carry the 4-vector `scope`.

> **0.2 changelog.** Adds the **Project Classification (Intake)** layer (§5.8) — the enumerated hardening of `DesignBrief` into a controlled-vocabulary vector (category · industry · age · style · scope dials · flows). Adds the **classification-driven conditioning function + pre-batch Confirm gate** (§6.6): the vector derives an *Artifact Manifest* (requested / generatable / suppressed) and pins a tuned *GateProfile* before a batch renders. Resolves OQ#11 (brief as enforced parameter source); advances OQ#1 and OQ#4.

---

## 1. Overview & Thesis

UXFactory is the authoring and quality-gate layer for an AI UI-rendering agent. It stores the documents that describe what a UI *should be*, binds them to the design (Figma) and the code, and runs a tiered quality gate that decides whether a rendered output passes, fails, or escalates to a human.

**Core thesis — three claims that the whole product rests on:**

1. **Every source-of-truth document compiles into a gate check.** An acceptance criterion, a brand rule, a design principle — each one compiles into a check of some *hardness* (deterministic lint, integration test, visual diff, or VLM-judge-with-rubric). UXFactory's authoring experience is not "write nice UX docs"; it is "write docs that compile into gates." That is the product wedge a generic Figma plugin or Notion template structurally cannot replicate.

2. **Own the spec and the trace; reference the rest by pointer + hash.** Figma already owns geometry and tokens; the code repo (and its component registry) already owns components. UXFactory's unique, durable artifact is the **trace graph** — the binding between a story's acceptance criteria, the view-states they imply, the Figma nodes that render them, and the components that implement them. That bridge is the thing everyone else leaves implicit and lets rot. Making it first-class is the moat.

3. **The gate is reference-based, not reference-free.** "Does this render match this Figma node and satisfy these acceptance criteria?" is a far tighter, lower-variance question than "is this good?" UXFactory always gates against two sources of truth — the design (fidelity) and the acceptance criteria (coverage) — plus the guideline rubric (craft/brand). Each covers the others' blind spots.

**Positioning note.** UXFactory is the vertical front-end; the gate ladder, HITL routing, and DevContainer/registry substrate are a separate horizontal engine — orchestration and integration-test infrastructure this product rides on, not part of it. UXFactory monetizes the design-quality vertical without re-implementing orchestration.

---

## 2. Goals & Non-Goals

### Goals
- Provide a structured authoring model for the full chain: **Story Map → Activity → Task → Story → Acceptance Criteria → View-State → View → Component.**
- Own and version the **trace/binding graph** linking problem-space specs to solution-space renderings.
- Compile authored documents (ACs, design principles, brand rules) into an executable **gate profile**.
- Run a **tiered quality gate** over rendered output, short-circuiting cheap→expensive and deterministic→judgment.
- Materialize **Figma variables** into a queryable token index the conformance tier can resolve against.
- Route soft/judgment failures through a **role-based HITL gate ladder** with the correct escalation owner per check class.

### Non-Goals
- Re-storing Figma geometry or token *values* as authored copies (referenced by pointer + hash; variables are materialized-with-provenance, not authored).
- Replacing the orchestration control plane or the integration-test/registry layer (both external to this product).
- Acting as the design canvas itself — UXFactory binds to Figma, it does not replace it.
- Maintaining a single rigid end-to-end artifact across the product/design tool boundary (the durable link is acceptance criteria + naming convention + the binding graph, not one spanning tool).

---

## 3. Conceptual Model

### 3.1 The spine

```
Activity (epic)                ── problem space (product-owned)
  └─ Task
       └─ Story  "As a <role>, I want <goal> so that <benefit>"
            ├─ AcceptanceCriterion         ← the HINGE
            │     └─ ViewState (empty | loading | error | success | edge)
            └─ View(s) / route(s)          ── solution space (design/eng-owned)
                  └─ Component
```

**Acceptance criteria are the hinge** between problem and solution space. They are written in user terms but directly *enumerate the states* that must be built. States fall **out of** ACs — they are not invented independently. A designer adding a state with no backing AC is a signal of either a missing story or scope creep; either way it surfaces a conversation.

### 3.2 Cross-cutting guidelines

Two artifact families are **not** nested under a story — they attach at tenant/project scope and are inherited by every view:

- **BrandGuide** (tenant scope) — voice, logo, color-meaning, naming. Applies across a white-label customer's projects.
- **DesignGuide** (project scope) — tokens (referenced) + design principles (owned): hierarchy, rhythm, density, motion, component-usage.

This restores the clean split: **ACs are local** (per story, behavioral); **guidelines are global** (cross-cutting, principled). A gate run composes all three — per-view ACs + project design principles + tenant brand rules.

### 3.3 Cardinality that matters

| Relationship | Cardinality | Consequence |
|---|---|---|
| Story ↔ View | many-to-many | a story spans views; a view serves many stories |
| AcceptanceCriterion → ViewState | one-to-many | each AC implies one or more states |
| ViewState → Binding → FigmaNode / Component | one-to-one(ish) | the trace anchor |
| BrandGuide → Project | one-to-many | brand inherited across a customer's projects |
| Collection mode → tenant/viewport | one-to-one | a mode = a theme or a breakpoint |

### 3.4 The intake root (forward ref)

Above the spec tree sits an **intake**: the `DesignBrief` (§5.7) and its enumerated projection, the **`ProjectClassification`** (§5.8). The classification is a small controlled-vocabulary vector — *category, industry, age, style, the four scope dials (visual · editorial · coverage · flow), flows* — answered once. It is the sole input to a **conditioning function** (§6.6) that derives which artifacts are *requested* vs. *generatable* and pins a tuned gate profile, which a human approves at a **Confirm gate** before any batch renders. Two refinements ride in with it: **Category** as an archetype dimension (no prior mechanism scoped view-state/component patterns by app type), and a **four-dial render scope** (§6.5) — two *fidelity* dials (visual, editorial) and two *completeness* dials (coverage, flow). The whole layer is a three-phase **Intake → Scoping → Confirm** shape applied at batch scope.

---

## 4. Design Artifact Catalog

Each artifact is classified by **ownership** — `OWNED` (authored, exists nowhere else), `REFERENCED` (pointer + content hash into Figma/repo), `MATERIALIZED` (synced cache with provenance hash), or `GENERATED` (produced by the gate, stored for audit).

| Artifact | Ownership | Scope | Purpose |
|---|---|---|---|
| **StoryMap** | OWNED | project | 2D organizing surface; backbone of activities × prioritized tasks |
| **Activity** | OWNED | project | backbone node; maps loosely to an epic |
| **Task** | OWNED | activity | decomposes an activity into steps |
| **Story** | OWNED | task | `As a/I want/so that` unit of value |
| **AcceptanceCriterion** | OWNED | story | behavioral source of truth; compiles into coverage/correctness checks |
| **View / Route** | OWNED | project | a navigable surface; many-to-many with stories |
| **ViewState** | OWNED (derived) | view | empty/loading/error/success/edge; derived from ACs |
| **Binding** | OWNED | view-state | **the trace** — links state ↔ Figma node ↔ component (the moat) |
| **DesignGuide.Principle** | OWNED | project | prose rubric for integrity/craft tiers |
| **DesignGuide.token_ref** | REFERENCED | project | pointer + hash into Figma tokens/variables |
| **BrandGuide.Rule** | OWNED | tenant | brand assertions; compile into lint or judge rubric |
| **VariableCollection / Variable** | MATERIALIZED | project | lossless mirror of Figma variables + provenance hash |
| **ResolvedToken** | MATERIALIZED (derived) | project | flattened, alias-walked token index the gate greps |
| **GateProfile** | GENERATED (semi) | project | which checks apply to which view/component class + escalation routing |
| **GateRun / GateResult** | GENERATED | run | audit record of a gate execution, with trace back-links |

### Artifact definitions (narrative)

- **Story Map** — a collection of stories plus *two dimensions of meaning*: horizontal = narrative sequence; vertical = priority / release slices. It is a flexible organizing surface, not a rigid parent/child tree.
- **User Story** — one small unit of requirement, `As a <role>, I want <goal> so that <benefit>`. Captures *what* and *why* for one piece of functionality. Says nothing about flow or emotion.
- **User Journey** *(input artifact, not stored as a gate source)* — end-to-end experience with stages, actions, thoughts, touchpoints, pain points, emotion. Used upstream to reveal friction that motivates stories. Not dereferenced by the gate.
- **User Flow** *(input artifact)* — screen-level navigation logic with decision points/branches. Informs view/route structure.
- **View / ViewState** — a view is a surface; its states are the explicit conditions the surface moves through. States are first-class because the gate's coverage tier checks that every AC-implied state is rendered. (Cf. the three-state intake pattern — Intake → Scoping → Confirm — a single conceptual view decomposed into explicit states, each corresponding to a phase of the underlying job.)
- **Binding (trace)** — the durable link between a view-state and the `figma_node_ref` + `component_ref` that realize it. Pointer + hash, never copies. This is the artifact that exists nowhere else and is UXFactory's reason to exist.
- **DesignGuide** — half-pointer (`token_ref` into Figma), half-owned (prose `Principle`s the VLM judge needs as a rubric).
- **BrandGuide** — owned `Rule`s (or `imported_ref` + distilled rules when sourced from a brand portal/PDF), scoped to the tenant, inherited across their projects.

---

## 5. Data Models

Schemas below are storage-agnostic pseudo-schema. IDs cross-reference between entities. Grouped by **storage class** — the spine of the "what to store" decision.

### 5.1 OWNED — Spec tree

```
StoryMap
  id, project_id, name

Activity            # backbone node (≈ epic)
  id, story_map_id, name, sequence_index      # horizontal narrative order

Task
  id, activity_id, name, priority_rank          # vertical priority axis

Story
  id, task_id
  role, goal, benefit          # "As a <role>, I want <goal> so that <benefit>"
  release_slice                # which release this story belongs to

AcceptanceCriterion            # ← the unit that compiles into gate checks
  id, story_id
  statement                    # "shows error if payment fails"
  implied_state                # error | empty | loading | success | edge
  verifier_hint                # integration_test | visual_diff | vlm_judge | axe
  hardness                     # hard | soft | escalate
```

### 5.2 OWNED — Views, states, trace (the moat)

```
View
  id, project_id, route, name

# many-to-many Story ↔ View
StoryViewLink
  story_id, view_id

ViewState                      # derived from acceptance criteria
  id, view_id
  state_kind                   # empty | loading | error | success | edge
  derived_from_ac_id           # provenance: which AC implied this state

Binding                        # THE TRACE GRAPH — owned, unique IP
  id, view_state_id
  figma_node_ref               # pointer + content_hash, NOT a copy
  component_ref                # pointer into the component registry, NOT a copy
  # nullable component_ref when gating pure visual output (see §10)
```

### 5.3 OWNED — Guidelines / rubric (cross-cutting)

```
BrandGuide                     # scope: tenant (white-label customer)
  id, tenant_id
  source                       # authored | imported_ref
  source_ref                   # pointer + hash when imported (PDF/Frontify/Figma)
  Rule:
    id, brand_guide_id
    statement                  # "UI labels use sentence case"; "logo min clear-space"
    kind                       # voice | logo | color_meaning | imagery | naming
    compiles_to                # lint_rule | judge_rubric | manual
    hardness                   # hard | soft | escalate
    escalation_owner           # brand | tenant_admin   ← differs from eng
    exemplars[]                # pass/fail samples fed to the judge

DesignGuide                    # scope: project
  id, project_id
  token_ref                    # pointer + content_hash into Figma variables  (REFERENCED)
  Principle:                   # the owned prose half
    id, design_guide_id
    statement                  # "single clear focal point per view"
    compiles_to                # judge_rubric | lint_rule
    hardness
    exemplars[]
```

### 5.4 MATERIALIZED — Figma variable representation

Ingest the Figma shape losslessly (provenance), then derive a flattened index the gate queries. See §7 for access paths.

```
── RAW MIRROR (lossless ingest; provenance) ──────────────────
VariableCollection
  id, name, key
  modes: [{ modeId, name, parentModeId }]   # parentModeId only on extensions
  defaultModeId
  isExtension, parentVariableCollectionId   # native theming / white-label mechanism
  variableIds[]
  _provenance: { figma_file_key, content_hash, synced_at, source }
                                            # source = rest_api | plugin_export

Variable
  id, name                     # slash-namespaced: "color/bg/primary"
  resolvedType                 # COLOR | FLOAT | STRING | BOOLEAN   (only 4)
  valuesByMode: { [modeId]: RawValue | VariableAlias }   # alias = semantic layer
  scopes: VariableScope[]      # which props it may bind to
  codeSyntax: { WEB, ANDROID, iOS }    # ← the design↔code bridge field
  description, hiddenFromPublishing

── RESOLVED INDEX (derived projection; what the gate greps) ──
ResolvedToken
  token_path                   # "color/bg/primary"
  mode                         # light | dark | tenant-acme | viewport-sm
  resolved_value               # alias chain fully walked → concrete value
  alias_chain[]                # ["color/bg/primary" → "color/brand/500"]  (KEEP)
  code_symbol                  # codeSyntax.WEB → "--color-bg-primary"
  legal_scopes                 # for scope-violation checks
  source_hash                  # back to the mirror; drift → re-derive
```

**Why materialized, not referenced:** the conformance tier must *resolve* the legal token set (name → value → code symbol) on every check to verify the rendering used a token rather than a magic value. You cannot grep code against a pointer. Variables are therefore a synced cache keyed by a content hash, not an authored copy and not a bare pointer.

**Keep the alias chain, not just the resolved value:** the rule "use semantic tokens, not raw primitives" is only checkable if you can see that code reached for `color/brand/500` directly instead of the semantic `color/bg/primary` that aliases to it. Resolved-only loses this.

### 5.5 GENERATED — Gate profile and runs

```
GateProfile                    # largely compiled from ACs + guidelines
  id, project_id
  check_bindings: [{ check_id, applies_to }]   # view class / component class
  escalation_routing: [{ check_class, owner }]

GateCheck                      # the compiled, executable unit
  id
  tier                # coverage | correctness | conformance | integrity | a11y | craft | brand | content_voice | discoverability
  source_of_truth     # figma_ref | acceptance_criteria | design_system | brand_guide | editorial_style | discoverability | none
  verifier            # deterministic | integration_test | visual_diff | vlm_judge | axe | llm_judge
  hardness            # hard (blocks) | soft (advisory) | escalate (HITL)
  min_visual          # none | low | medium | high      ← Visual dial    (see §6.5)
  min_editorial       # none | low | medium | high      ← Editorial dial
  min_coverage        # none | low | medium | high      ← Coverage dial
  min_flow            # none | low | medium | high      ← Flow dial
                      #   binding when render.scope meets EVERY threshold it declares
  assertion           # the specific thing checked
  compiled_from       # ac_id | design_principle_id | brand_rule_id | editorial_style_id | discoverability_id   ← traceability

GateRun
  id, project_id, view_id, rendered_artifact_ref, scope, started_at, status
                      # scope = { visual, editorial, coverage, flow }; runs checks the scope meets

GateResult
  id, gate_run_id, check_id
  status              # pass | fail | escalate
  evidence            # screenshot | diff | failing_ac_id | token_violation | axe_finding
  trace               # back-link to story / AC / figma_node   ← makes failures actionable
```

**The `trace` / `compiled_from` fields close the loop.** A failure points at the exact AC, design principle, brand rule, or Figma node — so the rendering agent (or the human) knows *what* to fix, not merely *that* it is wrong.

### 5.6 Design System Primitives & Requirement Profiles

Design-system primitives (colors, spacing, grids, typography, icons, imagery, logos, motion, radius, elevation, …) are **not** a flat set of new entities. Each follows the same shape as the rest of the model — a **values layer** (referenced or materialized) plus a **policy layer** (owned) — and slots under the existing `BrandGuide` (tenant) / `DesignGuide` (project) containers. Token *values* already live in `ResolvedToken` (§5.4); this section adds the **owned policy** for those tokens and the families Figma variables structurally cannot express (type pairings, asset libraries, grids, motion choreography).

**a11y and i18n are a different shape.** They are not primitives/assets — they are **cross-cutting requirement profiles** that (a) *generate* checks directly and (b) *constrain* the primitive families (a11y bounds color tokens via contrast; i18n bounds type/layout via expansion + RTL). They are modeled as Profiles, not Sets/Libraries.

**Typed families vs. prose rules.** Apply the hardness gradient to the schema shape itself: families with enough structure to drive a *deterministic* check (grids, spacing steps, logo geometry, icon manifest) are **typed entities**; inherently-prose families (imagery "feel", pairing rationale) remain **judge-rubric Rules**. Structured schema → lint check; prose schema → VLM check.

#### Family → layer → tier mapping

| Family | Values (class) | Policy (class) | Scope | Primary tier(s) |
|---|---|---|---|---|
| Colors | variable → `ResolvedToken` (MAT) | meaning rule (OWN) | tenant (meaning) / project (ramp) | 3 conformance · 5 contrast · 7 meaning |
| Spacing | FLOAT var (MAT) | rhythm / grid-step (OWN) | project | 3 · 4 |
| Radius / elevation / opacity *(etc.)* | FLOAT·COLOR var (MAT) | usage rule (OWN) | project | 3 |
| Grids | grid style (REF) | grid rule (OWN) | project | 3 snap · 4 breakpoints |
| Breakpoints | = variable **modes** (MAT) | rule (OWN) | project | 4 integrity |
| Typography scale | size/lh/weight var · text style (MAT/REF) | scale rule (OWN) | project | 3 |
| Font pairings | font-family token · `font_ref` (REF) | pairing + rationale (OWN) | project | 6 craft · 3 |
| Icon set | Figma set + code pkg (REF) | usage policy (OWN) | project | 3 approved-set · 5 labels |
| Imagery set | asset library (REF) | treatment rules (OWN) | tenant | 7 brand · 4 responsive |
| Logos | logo variants (REF) | clear-space / min-size (OWN) | tenant | 7 brand |
| Motion | duration/easing var (MAT) | choreography (OWN) | project | 4·6 match · 5 reduced-motion |
| a11y *(profile)* | — | target + rules (OWN) → results (GEN) | project | **5 (own tier)**; constrains 3·4·7 |
| i18n *(profile)* | string catalog (REF) | locales/RTL/expansion (OWN) | project | 1 externalized · 4 expansion/RTL · 5 lang |

#### Schemas

```
DesignSystem
  id, scope (tenant | project), name

# ── TOKEN FAMILIES — values MATERIALIZED (variables) / policy OWNED ──
TokenSet
  id, family        # color | spacing | radius | elevation | opacity | motion_timing | type_scale | breakpoint
  token_refs[]      # → ResolvedToken (§5.4); values live there, never copied
  policy[]          # OWNED Principle/Rule, hardness gradient ("4pt grid"; "danger = color/semantic/danger")

# ── ASSET LIBRARIES — values REFERENCED (pointer+hash) / policy OWNED ──
AssetLibrary
  id, kind          # icon | imagery | logo | illustration
  manifest_ref      # pointer+hash → Figma component set AND/OR code package (e.g. lucide-react)
  members[]         # { asset_id, name, variants[], figma_node_ref, code_symbol }   ← refs, NOT binaries
  usage_policy[]    # OWNED Rule: sizing, clear-space, treatment, do/don't, scope_constraints, exemplars

# ── LAYOUT — grid REFERENCED / rule OWNED ──
LayoutSystem
  id
  grid              # { columns, gutter, margin, max_width, grid_ref(pointer+hash) }
  breakpoints[]     # { name, min_width } — align to variable modes (viewport axis)
  density_modes[]   # optional

# ── TYPOGRAPHY — composite styles REFERENCED / pairing OWNED ──
TypographySystem
  id
  type_scale_refs[] # → ResolvedToken (size/lh/weight FLOAT) or text-style refs
  font_families     # { role: heading|body|mono, family_token | font_ref }
  pairings[]        # OWNED Rule: the intentional combination + rationale + exemplars

# ── MOTION — timing MATERIALIZED / choreography OWNED ──
MotionSystem
  id
  timing_refs[]     # → ResolvedToken (duration FLOAT, easing STRING)
  choreography[]    # OWNED Principle: what animates, enter/exit, reduced-motion fallback
  motion_context_ref # → Figma timeline (get_motion_context) when authored in Figma

# ── REQUIREMENT PROFILES — NOT assets; OWNED targets that GENERATE checks + CONSTRAIN families ──
A11yProfile
  id, scope
  target            # WCAG_2_2_AA | AAA
  rules[]           # project-specific: min touch-target px, focus-ring spec
  constrains        # color contrast · motion (reduced) · i18n (lang) · spacing (targets)

I18nProfile
  id, scope
  locales[]         # { code, dir: ltr | rtl }
  string_catalog_ref # pointer+hash → code i18n messages (next-intl / i18next)
  rules[]           # expansion tolerance %, no-hardcoded-copy, locale formatting
  constrains        # layout (expansion/RTL mirror) · type (CJK line-height) · coverage (externalized)
```

**Scope / inheritance:** tenant-scoped families (logos, imagery, color-meaning) attach to `BrandGuide` and inherit across the customer's projects; project-scoped families (grids, type, spacing, motion) attach to `DesignGuide`. The two Profiles attach at project scope and cut across every family. This is not a parallel hierarchy — it is what `BrandGuide` and `DesignGuide` contain.

### 5.7 Context & Content Envelope

Four artifacts wrap the product surface rather than describe its appearance: the **design brief** (where it comes from), **editorial style** (the words on it), **discoverability strategy** (how it is found), and **viewport strategy** (the contexts it renders in). Two introduce new gate classes (Tiers 8–9); the brief sits *above* the spec tree as root provenance; the viewport strategy refines Tiers 4–5.

**The brief parameterizes the downstream profiles** — this is the connective structure:

```
DesignBrief.audience      → I18nProfile.locales · A11yProfile.target · EditorialStyle.reading_level
DesignBrief.positioning   → EditorialStyle.voice
DesignBrief.goals         → StoryMap.activities
ViewportStrategy.classes  → Tier-4 test matrix · variable viewport modes
EditorialStyle.lexicon    ↔ BrandGuide naming (shared)
DiscoverabilityStrategy   ↔ A11yProfile (shared semantic substrate: landmarks, headings, alt, lang)
```

#### Schemas

```
# ── DESIGN BRIEF — OWNED root charter; ABOVE StoryMap; parameterizes downstream ──
DesignBrief
  id, scope (engagement | project)
  problem, goals[]
  audience[]            # { segment, locale_needs, a11y_needs, reading_level }
  constraints[]         # tech · brand · regulatory (e.g. FERPA/COPPA) · timeline
  success_criteria[]    # { metric, target }  → OPTIONAL compile to correctness/integrity checks
  positioning           # → seeds EditorialStyle.voice
  # provenance root: Activities / Stories / Profiles cite brief_id for "why"

# ── EDITORIAL STYLE / VOICE — OWNED content source of truth; new content gate class ──
EditorialStyle
  id, scope (tenant | project)         # voice usually tenant; refinements per project
  voice:                # CONSTANT personality (define once)
    axes                # market: segment positioning · tone: register · explore: generative preview/variation
    descriptors[]       # "plain, concrete, no hype" + do/don't exemplars
  tone_map[]            # CONTEXTUAL — varies by situation
    { context: error|empty|success|onboarding|destructive, register, exemplars[] }
  lexicon               # preferred / avoided terms (↔ BrandGuide naming)
  reading_level         # target grade level (from DesignBrief.audience)
  # compiles → Tier 8 Content & Voice (judge); render-agent microcopy is checked here

# ── SEO + AIO STRATEGY — OWNED distribution contract; on-page gateable, off-page monitored ──
DiscoverabilityStrategy
  id, scope (project)
  target_queries[]      # conversational, qualifier-aware ("...for enterprise", "...in 2026")
  entities[]            # { name, type(schema.org), relationships[] } → JSON-LD entity markup
  schema_types[]        # Article | Organization | FAQPage | Product | HowTo | BreadcrumbList
  metadata_policy       # title/description patterns · canonical · OG/Twitter
  answer_first          # require direct answer in first 40–60 words; self-contained H2s
  llms_txt              # presence + content policy
  freshness_policy      # refresh cadence + visible version signal
  # ON-PAGE  → Tier 3 (markup, deterministic) + Tier 5 (shared substrate) + Tier 9 (content judge)
  # OFF-PAGE (backlinks, off-site trust, cross-platform presence, citation rate)
  #          → NOT render-gateable; separate monitoring loop, out of scope for the render gate

# ── VIEWPORT STRATEGY — OWNED; extends LayoutSystem; parameterizes Tier-4 matrix + Tier-5 modality ──
ViewportStrategy
  id, scope (project)
  approach              # mobile_first | desktop_first
  classes[]             # the test matrix
    { name: desktop|tablet|mobile,
      breakpoint_ref,           # → LayoutSystem.breakpoints / variable viewport mode
      input: pointer|touch|hybrid,   # → Tier-5 touch-target sizing, no hover-only affordances
      adaptation: reflow|stack|hide|show|reveal,
      nav_pattern,              # sidebar → drawer / hamburger
      density }
  # compiles → Tier 4 integrity (render at each class) + Tier 5 a11y (modality constraints)
```

**The SEO/AIO scope boundary is load-bearing.** The render gate owns *on-page* signals (semantic structure, JSON-LD, metadata, answer-first shape, `llms.txt`). It does **not** own *off-page* signals — the majority of AI brand citations originate off-site, and citability depends on trust footprint and freshness that no render-time check can verify. Off-page belongs to a separate monitoring loop (a sibling concern), and the gate must not promise what it structurally cannot check.

**Content & Voice and Discoverability are separate tiers despite a shared verifier** (both judge the words via an LLM) because their escalation owners differ — content/brand vs. SEO/growth — the same role-based-HITL reason Brand is separate from Craft.

### 5.8 Project Classification (Intake)

The `DesignBrief` (§5.7) is the free-form root charter — prose problem, goals, audience. For the *generation loop* it hardens into a small **enumerated classification vector**: a controlled vocabulary the user answers at intake. This vector — not the prose brief — is the sole input to the conditioning function (§6.6). Most dimensions are typed projections of existing `DesignBrief` / profile fields; the rest are new — `category` (archetype) and the four scope dials (§6.5), of which **Coverage** and **Flow** are genuinely new completeness axes.

**Why enumerate the brief.** A prose audience ("busy parents") can seed a profile but cannot deterministically *select* an artifact set. An enum (`age_demographic = children`) can — it maps to a fixed set of manifest and gate-profile effects. Enumerating is what turns the brief from a thing that *suggests* downstream params into a thing that *derives* them (resolves OQ#11).

**Dimension → what it drives:**

| Dimension | Enum (extensible) | Parameterizes | Origin |
|---|---|---|---|
| **Category** (archetype) | marketing · ecommerce · web_app · news | view-state archetypes, component patterns, tier weighting | **NEW** |
| **Industry** | education · corporate · healthcare · finance · consumer · … | `DesignBrief.constraints` (FERPA/COPPA/HIPAA), brand register, A11y floor | derives `constraints` |
| **Age demographic** | children · teens · 18-25 · 26-35 · 36-50 · 50+ | `A11yProfile.target`, `EditorialStyle.reading_level`, flow complexity, dark-pattern ban | derives `audience` |
| **Style** | informal · mix · formal | `EditorialStyle.voice` register, type/brand register | derives `voice` |
| **Visual** (dial) | low · medium · high | `min_visual` cut on Tiers 3·4·5·6·7 | fidelity |
| **Editorial** (dial) | low · medium · high | `min_editorial` cut on Tiers 1·8·9 | fidelity |
| **Coverage** (dial) | low · medium · high | `min_coverage` cut on Tiers 0·1·4 — states per view | **NEW dial** |
| **Flow** (dial) | low · medium · high | `min_flow` cut on Tiers 2·5 — paths across views | **NEW dial** |
| **Flows** (selection) | [selected `User Flow`s] | *which* flows seed the batch (≠ the Flow dial's depth) | derives `View`/`ViewState` set |

```
ProjectClassification              # OWNED; enumerated hardening of DesignBrief; the intake answer
  id, project_id, brief_id         # cites the brief it specialises
  category                         # marketing | ecommerce | web_app | news
  industry                         # education | corporate | healthcare | finance | consumer | ...
  age_demographic                  # children | teens | 18-25 | 26-35 | 36-50 | 50+
  style                            # informal | mix | formal
  scope:                           # the four dials (§6.5); archetype seeds defaults, editable at Confirm
    visual                         # low | medium | high   — FIDELITY: how it looks
    editorial                      # low | medium | high   — FIDELITY: what it says
    coverage                       # low | medium | high   — COMPLETENESS: states per view
    flow                           # low | medium | high   — COMPLETENESS: paths across views
  flow_refs[]                      # → User Flow inputs; WHICH flows seed the batch (≠ the flow dial)
  # the conditioning function (§6.6) reads ONLY this vector to derive the manifest + pin the profile
```

**Archetype is a preset, not a cage.** `category` seeds a default manifest the user overrides at Confirm (§6.6); it does not lock the artifact set. Whether tenants can author their own archetype presets is an open question (OQ#13).

**Compliance falls out of the vector.** `industry = education` + `age_demographic = children` auto-requires the FERPA/COPPA `constraints` entry and raises the `A11yProfile` floor — a standard compliance shape for regulated domains, now *derived* from two enum answers rather than hand-set per project.

---

## 6. Quality Gate Model

### 6.1 Principles

- **Tiered, cheap→expensive, deterministic→judgment, short-circuiting.** Do not spend a VLM call on craft if state coverage already failed (same logic as the admission/coordinator stage).
- **Reference-based over reference-free.** Always gate against the Figma node and the ACs.
- **Binary decomposition over holistic scoring.** Many y/n assertions have a fraction of the variance of a single 1–10 score. The judge never emits a holistic number.
- **Rubric-anchored prompts** with concrete pass/fail exemplars for checks that genuinely need taste.
- **An instance of the HITL gate ladder.** Hard-deterministic failures auto-reject with no human; soft/judgment results escalate to the role-appropriate owner. This is not a new mechanism — it is the existing ladder specialized for UI.

### 6.2 Tier table (canonical)

| Tier | Source of truth | Verifier | Hardness |
|---|---|---|---|
| **0 · Spec presence** | — | deterministic | hard (a missing spec is itself a finding) |
| **1 · Coverage** | acceptance criteria | deterministic + integration test | hard |
| **2 · Correctness** | acceptance criteria | integration test | hard |
| **3 · Conformance** | tokens (`token_ref`, pointer) **+** `DesignGuide.Rule` (owned) **+** required SEO/AIO markup (semantic landmarks, valid JSON-LD, meta, canonical) | AST / lint | hard |
| **4 · Integrity** | `DesignGuide.Principle` (owned rubric) + `ViewportStrategy` matrix + Figma as target instance | snapshot + VLM judge | soft |
| **5 · A11y** | — (shares semantic substrate with SEO/AIO markup) | axe-core + judge | mixed |
| **6 · Craft** | `DesignGuide.Principle` rubric + exemplars; Figma as instance | VLM judge | escalate (HITL) |
| **7 · Brand** | `BrandGuide.Rule` + exemplars | lint (structured) / VLM judge | mixed → escalate |
| **8 · Content & Voice** | `EditorialStyle` + exemplars | LLM judge | escalate (owner: content / brand) |
| **9 · Discoverability (AIO content)** | `DiscoverabilityStrategy` — answer-first, entity density, citability shape (on-page only) | LLM judge | soft → escalate (owner: SEO / growth) |

### 6.3 What each tier checks

- **0 Spec presence** — ACs exist; states are enumerable. Blocks; absence is a finding.
- **1 Coverage** — every AC-implied state is rendered; every AC has a manifestation; every view exists.
- **2 Correctness** — interactions produce specified outcomes; branches handled; data bound correctly. (Handled by the integration-test layer — component-reactive integration tests reading from the component registry.)
- **3 Conformance** — tokens only, no magic values; reuses system components; respects variable `scopes`; **required SEO/AIO markup present** (semantic landmarks, valid JSON-LD for declared `schema_types`, meta/canonical per `metadata_policy`). Deterministic once the ResolvedToken index and `DiscoverabilityStrategy` exist.
- **4 Integrity** — holds across the `ViewportStrategy` matrix (desktop/tablet/mobile); long strings, large/small data, i18n expansion, overflow.
- **5 A11y** — semantics, keyboard, contrast, focus order, touch-target sizing per viewport input modality. Shares the semantic-structure substrate (landmarks, headings, alt, `lang`) with the SEO/AIO markup check — one verifier serves both.
- **6 Craft** — hierarchy, rhythm, alignment, intentionality. Escalates to a human.
- **7 Brand** — logo usage, color meaning, imagery treatment, naming. Earns its own class chiefly because the **escalation owner differs** (brand / tenant admin, not eng).
- **8 Content & Voice** — generated microcopy (labels, empty/error/success text, headings) matches `EditorialStyle` voice + `tone_map` context + lexicon + reading level. New class because nothing else gates the *words* the render agent produces; owner is content/brand.
- **9 Discoverability (AIO content)** — *on-page* citability shape: direct answer in first 40–60 words, self-contained sections, entity density, statistic/source density. **Off-page signals (backlinks, off-site trust, cross-platform presence, actual citation rates) are out of scope for the render gate** — they belong to a separate monitoring loop, not a render-time check.

### 6.4 The compile pipeline

```
AcceptanceCriterion ─┐
DesignGuide.Principle ┼─→ compile ─→ GateCheck (tier, verifier, hardness, assertion)
BrandGuide.Rule ──────┘                         │
                                                ├─ hard      → auto pass/reject
                                                ├─ soft      → advisory, attach evidence
                                                └─ escalate  → HITL ladder → role owner
```

"Sentence-case labels" compiles to a near-deterministic lint rule. "Maintain clear hierarchy" compiles to a judge-rubric line with exemplars. "Logo clear-space" may compile to `manual`/escalate. One pipeline, varying hardness.

### 6.5 Render Scope — Four Dials (Visual · Editorial · Coverage · Flow)

Not every render owes every gate. A render's **scope** is a selector over the catalog and the ladder: it decides which slice is binding. A greybox failing "uses design tokens," a happy-path snapshot failing "renders the error state," or a single screen failing "back-navigation works" is all noise — scope suppresses gates that do not yet apply and turns them on as the render matures. This is not new machinery; it is a set of thresholds on the existing checks.

**Scope is four orthogonal dials, in two pairs.** The first pair is *fidelity* — how polished a rendered state is. The second is *completeness* — how much of the spec graph is actually rendered. The pairs are independent; any one dial moves without the others.

*Fidelity — depth of a single rendered `ViewState`:*

- **Visual** — how it *looks*: `low` greybox/wireframe → `medium` tokens/type/color applied → `high` full visual, production-styled. Selects Tiers **3** (tokens), **4** (visual integrity), **5** (contrast), **6** (craft), **7** (brand).
- **Editorial** — what it *says*: `low` placeholder/lorem permitted → `medium` draft real copy → `high` final, on-voice, reading-level-gated, i18n-externalized. Selects Tier **8** (content & voice), Tier **1** (i18n externalization), Tier **9** (discoverability content).

*Completeness — how far you traverse the spine:*

- **Coverage** — state breadth *within* a view (the `AC → ViewState` axis): `low` success/populated state only → `medium` + empty · loading · error → `high` + all AC-implied edge states (overflow, long strings, large/small/partial data, permission-denied). Selects Tier **0** (spec presence), Tier **1** (state coverage), Tier **4** (data-shape edge cases).
- **Flow** — path breadth *across* views (the `View → View` graph): `low` single screen / happy-path snapshot → `medium` the primary flow end-to-end (forward navigation works) → `high` all branches, error-recovery, back/cancel, cross-flow, deep-linking. Selects Tier **2** (correctness / interaction outcomes / branch handling), Tier **5** (keyboard/focus navigation).

**Coverage and Flow are the structural tiers (0·1·2) ramping on their own dials — not "always on."** That is the correction the two-pair model forces: a deliberately narrow render — one screen, happy state — must not fail for states or downstream routes it never claimed. The gate now knows the *intended* breadth, not just the *intended polish*.

**Mechanism — four thresholds per check (`min_visual`, `min_editorial`, `min_coverage`, `min_flow`), alongside `hardness`.** Each `GateCheck` declares the level on each dial at which it becomes binding (any may be `none`). A render carries a 4-vector `scope` and runs exactly the checks whose *every* declared threshold the scope meets. Most checks key off one dial; a few are multi-dial (Tier 5 contrast keys off Visual, its keyboard-nav check off Flow). Ordinal thresholds, not a config table.

**Tiers ramp on their dial, they do not toggle.** Because thresholds are per-check, a single tier activates progressively: A11y's landmark/heading check binds at Visual `low`, contrast at Visual `high`, keyboard/focus at Flow `medium`. Same tier, three dials, different rungs. (Mirrors how `hardness` is per-check, not per-tier.)

**The five named levels are convenient presets — points in the 4-cube, not a forced ladder.** Each names a common `(visual, editorial, coverage, flow)` setting; the dials move independently, so any off-preset combination is first-class:

| Level | Adds these artifacts as binding | Activates (tiers) | Medium |
|---|---|---|---|
| **1 · Wireframe** | `StoryMap`/`AC` coverage · `LayoutSystem` grid · `ViewportStrategy` structural reflow | 0 spec · 1 coverage · 4 *structural* · 5 *landmarks* | greybox design |
| **2 · Content** | `EditorialStyle` (voice/tone/reading-level) · real component usage · `I18nProfile` string externalization | + 8 content & voice · + 3 *components* · + 1 *i18n externalized* | mid-fi / stubbed |
| **3 · Visual** | full `TokenSet`/type/color/spacing/icons · `BrandGuide` · `DesignGuide.Principle` | + 3 *tokens* · + 6 craft · + 7 brand · + 4 *visual* · + 5 *contrast* | hi-fi design |
| **4 · Interactive** | `MotionSystem` · interaction outcomes · all states exercised | + 2 correctness · + motion · + 5 *keyboard/focus* | wired proto / code |
| **5 · Production** | full `A11yProfile` · full `I18nProfile` (RTL, formatting) · `DiscoverabilityStrategy` · perf | + 9 discoverability · 5 *full a11y* · 4 *full i18n* · all | code |

**Level → coordinate** `(visual, editorial, coverage, flow)`. wireframe ≈ `(low, low, low, low)` · content ≈ `(low, high, medium, low)` · visual ≈ `(high, medium, medium, medium)` · interactive ≈ `(high, high, high, high)` minus full a11y · production ≈ `(high, high, high, high)` + full a11y/i18n + code medium. The point of independent dials is the **off-preset** render: `(visual high, editorial low, coverage low, flow low)` is the *hero vibe* — one pixel-complete screen, lorem copy, happy state only — gated for craft/brand with the no-placeholder, error-state, and navigation checks all correctly dormant. `(visual low, editorial high, coverage high, flow medium)` is the *spec-review* render — greybox, but every state and the primary flow present with final copy.

**Scope is a promotion ratchet per dial, not just a filter.** Each of the four dials ratchets independently: a render is promoted on a dial only when every hard check gated by that dial at the current level passes (and its soft/escalate checks are resolved). The named presets are the common promotion path; a batch may legitimately ratchet Visual ahead of Coverage, or lock Flow while Editorial climbs. This is the HITL gate ladder staged by scope — structurally the same as a staged phase progression.

```
Dial (ordinal, ×4)           none < low < medium < high
  visual · editorial         FIDELITY     — depth of a rendered ViewState
  coverage · flow            COMPLETENESS — traversal of AC→ViewState and View→View

Render.scope                 { visual, editorial, coverage, flow }   declared for this output
Gate selection               run checks where  scope.visual    >= check.min_visual
                                          AND  scope.editorial >= check.min_editorial
                                          AND  scope.coverage  >= check.min_coverage
                                          AND  scope.flow      >= check.min_flow

ScopeGate (promotion; per dial)
  dial (visual | editorial | coverage | flow), from_level → to_level
  requires: all HARD checks gated by `dial` (min_<dial> <= from_level) pass
            + all SOFT/ESCALATE gated by `dial` at from_level resolved
```

**Medium is derived, not a separate flag.** Medium (design vs. code) tracks the **visual** axis plus the production rung: visual `low`–`high` design output is usually Figma-medium; production (visual `high` + full a11y/i18n) is code-medium, the crossover at interactive. Derive medium rather than add a fifth dial — four scope dials plus a derived medium, not a five-dimensional matrix. This still resolves the former code-vs-visual question: **visual output = visual `high`; code output = production**, so `component_ref` / `code_symbol` are required only at the production rung and null below.

### 6.6 Classification-Driven Selection & the Confirm Gate

Fidelity (§6.5) is one selector input. Generalize: the full **`ProjectClassification`** vector (§5.8) is the input to a **conditioning function** that runs once at intake and emits two derived objects — an **Artifact Manifest** (each catalog artifact marked *requested*, *generatable*, or *suppressed*) and a tuned, **pinned `GateProfile`** — which a human approves at a **Confirm gate** before the batch renders. This is the **Intake → Scoping → Confirm** shape (§3.1) lifted to batch scope; the fidelity-as-selector machinery, widened from `{fidelity}` to the whole vector.

**Stage 1 · Intake.** The user answers the seven dimensions. Chip-tap-as-submit; each answer narrows the next (a progressive-disclosure intake pattern). Output: one `ProjectClassification` row.

**Stage 2 · Scoping — the conditioning function.** A pure map `classification → (ArtifactManifest, GateProfile)`. Each §4 artifact resolves to exactly one disposition:

- **REQUESTED** (required) — must be authored or approved; compiles to **hard / blocking** checks. *Forced* by a dimension (ecommerce → payment-failure ACs; education + children → `A11yProfile` target + FERPA/COPPA `constraints`). Removing one at Confirm demands justification.
- **GENERATABLE** (allowed) — UXFactory auto-drafts it and offers it for approval; compiles to **soft / advisory** until approved, then hardens. (`EditorialStyle.voice` drafted from style + industry; `DiscoverabilityStrategy` drafted for news.)
- **SUPPRESSED** (N/A) — out of scope for this archetype / fidelity; **no checks**. (`MotionSystem` at visual `low`; `DiscoverabilityStrategy` for an internal web_app.)

Dispositions are *derivations*, not free config — each dimension carries a fixed effect set. Representative slice (not exhaustive):

| Dimension value | Manifest / profile effect |
|---|---|
| `category = ecommerce` | requests cart/checkout/PDP states, payment-failure ACs, trust-badge brand rules; weights Tier 2 up |
| `category = news` | requests article/feed/section archetypes; **promotes Tier 9 (discoverability) to REQUESTED**; gentler reading-level |
| `category = marketing` | requests hero/CTA/landing states; weights Tiers 6–7 (craft/brand) up; Tier 2 light; **defaults Coverage/Flow low** (shallow surfaces) |
| `category = web_app` | requests dashboard/CRUD/auth/empty states; **suppresses Tier 9** (internal); weights Tiers 2–4 up; **defaults Coverage/Flow high** (stateful, multi-route) |
| `industry = education` | requires FERPA/COPPA `constraints`; raises A11y floor; age-appropriate copy |
| `industry = healthcare / finance` | requires regulatory `constraints` (HIPAA / disclosure); raises Tier 5 + Tier 8 rigor |
| `age = children` | `A11yProfile.target` → stricter (target size, contrast); `reading_level` → low; **dark-pattern ban**; simplified flows |
| `style = formal` | `EditorialStyle.voice` = formal; formal type/brand register; tightens Tier 8 voice threshold |
| `scope.visual` | sets `min_visual` cut across Tiers 3·4·5·6·7 |
| `scope.editorial` | sets `min_editorial` cut across Tiers 1·8·9; `low` ⇒ no-placeholder check **off** |
| `scope.coverage` | sets `min_coverage` cut across Tiers 0·1·4; `low` ⇒ only the success state is required |
| `scope.flow` | sets `min_flow` cut across Tiers 2·5; `low` ⇒ navigation/branch checks dormant |
| `flow_refs` | enumerate *which* flows seed the batch's view-states; expected sequence → Tier 2 (OQ#4) |

Conflicting effects resolve **strictest-wins** — a compliance-raising effect always dominates a relaxing one (OQ#14).

**Stage 3 · Confirm — the pre-batch gate.** The manifest plus every GENERATABLE artifact (now drafted) is surfaced for human approval **before** the batch renders. The user accepts or edits each draft, satisfies each REQUESTED gap, and signs off; only then does the batch render. This is a HITL gate on the **plan**, not the output, with **asymmetric friction**: adding an artifact/gate to the batch is one tap; removing a REQUESTED one demands justification, because a dimension forced it. The Confirm sign-off is the **compute-commit boundary** — nothing renders until the plan is approved, and the `GateProfile` is **pinned** at that moment.

**Why a batch.** A *batch* = the view-states implied by the selected `flow_refs` under one classification, rendered and gated together against one frozen manifest + pinned profile. Freezing the plan at Confirm makes the batch's gate results mutually comparable and the run auditable. Re-answering the classification produces a **new** batch with a newly pinned plan — it never mutates a batch mid-flight.

```
ArtifactManifest                   # GENERATED at Scoping; pinned at Confirm
  id, classification_id
  entries[]:
    artifact_kind                  # any §4 catalog entry (AC, EditorialStyle, A11yProfile, MotionSystem, ...)
    requirement                    # requested | generatable | suppressed
    origin                         # authored | generated | imported
    status                         # pending | drafted | approved | satisfied
    derived_from[]                 # which classification dimension(s) forced this entry   ← provenance
    gate_effect                    # hard | soft | suppressed   (how it compiles into the pinned profile)

RenderBatch
  id, project_id, classification_id, manifest_id, gate_profile_id
  view_state_ids[]                 # batch contents, from flow_refs
  scope                            # { visual, editorial, coverage, flow } the batch renders at (§6.5)
  confirm_status                   # draft | awaiting_approval | approved | rendering | gated
  confirmed_by, confirmed_at       # the compute-commit boundary; GateProfile pinned here
  # a batch renders only after confirm_status = approved
```

**This makes the classification the enforced parameter source (resolves OQ#11).** The brief no longer merely *suggests* downstream params — its enumerated projection *derives the manifest and pins the profile*, with the entire human override surface consolidated at one Confirm gate rather than scattered per-profile. Provenance is total: every gate in a run traces to the dimension that forced it.

---

## 7. Figma Variable Integration

### 7.1 Access paths (decision-critical)

| Path | Endpoint | Fidelity | Gate |
|---|---|---|---|
| **REST API** | `GET /v1/files/:key/variables/local` | full (modes, scopes, codeSyntax, aliases) | **Enterprise Full-seat only**; guests excluded |
| **Plugin API** | `figma.variables` export → JSON | full read/export | **no plan gate** |

- The REST API requires an Enterprise org + Full seat. Most small design teams UXFactory sells to are **not** Enterprise, so the product cannot assume this path.
- `/variables/published` does **not** return modes — use `/variables/local` for mode values. "Published" is the wrong endpoint for a gate that cares about theming.
- **Recommended ingestion:** a Figma plugin serializes the variable graph to JSON → drops into a folder-watch bridge → UXFactory ingests the mirror schema. This is the same architecture already used to sidestep the MCP enterprise restriction, repurposed for token extraction. Support **both** REST (Enterprise tenants) and plugin-export-via-bridge (everyone else) feeding the identical mirror. Figma ships an official Variables-sync GitHub Action whose envelope the export format can model.

### 7.2 Modes = multi-tenant + viewport in one primitive

A collection's modes are per-context value sets. **Extended collections** (`isExtension` / `parentVariableCollectionId`) are Figma's native way to fork a base theme per brand. Therefore:

- a white-label **tenant theme** = an extension collection (or a mode),
- a responsive **breakpoint** = a mode.

This folds directly into white-label multi-tenancy *and* the tier-4 "holds across viewport range" integrity check — same mechanism, two axes. Model `mode` as a first-class dimension on `ResolvedToken` rather than special-casing light/dark.

### 7.3 `codeSyntax` is the linchpin

`codeSyntax.WEB` is the literal Figma-variable → code-symbol map. Tier-3 conformance becomes a deterministic match — *did the emitted React reference `code_symbol` rather than a hardcoded hex?* No judge required. This is the design↔code bridge made first-class — UXFactory's reason to exist.

---

## 8. Storage Taxonomy (summary)

| Class | Examples | Why | Form |
|---|---|---|---|
| **Authored / Owned** | ACs, DesignGuide principles, BrandGuide rules, Binding graph | exists nowhere else | source of truth |
| **Pointer + hash** | frame geometry, node layout, `token_ref`, `component_ref` | high-churn; gate never resolves it deterministically | link + fingerprint |
| **Materialized + provenance** | Figma variables (mirror + ResolvedToken) | the conformance *contract*; gate must resolve it every check | synced cache keyed by hash |
| **Generated** | GateProfile, GateRun, GateResult | produced by execution | audit record |

**Net stored-doc set:** ACs (owned, per-story) · DesignGuide principles + BrandGuide rules (owned, cross-cutting rubric) · the trace/binding graph (owned — the moat) · the variable mirror + resolved index (materialized) · gate runs (generated, audit). **Referenced by pointer + hash:** Figma nodes, tokens, components.

---

## 9. Authoring Experience (the product wedge)

The differentiator is **gate-ready authoring**. The authoring flow captures `implied_state`, `verifier_hint`, and `hardness` at the moment a human writes an AC; it captures `compiles_to`, `hardness`, and `exemplars` at the moment a human writes a design principle or brand rule. Then:

- An **AC is not a separate thing from a GateCheck — it compiles into one.**
- The **GateProfile half-generates itself** from the authored spec + guidelines.
- The guidance UXFactory sells is *"write docs that compile into gates,"* not *"write nice UX docs."*

This collapses the SPEC and PROFILE layers into a single authored act — the thing a generic Figma plugin or Notion template structurally cannot do.

**Composition as a feature:** brand inherited across a customer's projects (tenant), design per project, ACs per story. A single gate run composes all three, which is itself a sellable capability and fits the existing multi-tenant shape.

**Import path for brand:** when a BrandGuide is imported (PDF / Frontify / Figma) rather than authored, store `source: imported_ref` as pointer + hash **and** persist a distilled set of structured `Rule`s extracted once at import — you cannot feed a 40-page brand PDF into every gate run, so extraction-to-assertions happens at import time (the same compile step, front-loaded). Push users toward authoring-in-UXFactory, which skips extraction and is structured from the start.

---

## 10. Open Questions & Forks

1. **~~Code vs. visual output~~ → RESOLVED by fidelity (§6.5).** Two points on the now-2-axis grid: **visual output = visual `high`; code output = production** (visual `high` + full a11y/i18n). `component_ref` / `code_symbol` are required only at the production rung and null below, rather than gated by a mode flag. Remaining sub-decision: whether interactive prototypes default to design-medium or code-medium.

2. **Brand escalation routing.** Brand violations escalate to a different owner (brand / tenant admin) than eng-facing conformance failures. Confirm the routing model and whether tenant admins get a distinct HITL surface.

3. **Variable access default.** Ship plugin-export-via-bridge as the primary path (works for non-Enterprise), with REST sync as an Enterprise upgrade? Or gate the whole token-conformance tier behind variable availability and degrade gracefully when absent?

4. **Journey/Flow as stored gate sources? → partly advanced (§5.8/§6.6).** `flow_refs` now enumerate a batch's view-states, and an expected step sequence is *proposed* to compile into a Tier 2 correctness check. Open: whether sequence-correctness is on by default or opt-in per batch, and whether journey emotion/pain-point signals ever gate (currently no).

5. **Drift policy.** On `content_hash` mismatch for a `figma_node_ref` or variable mirror — auto-re-sync, flag-and-hold, or fail the affected checks? Affects how stale the gate is allowed to be.

6. **Asset binaries vs. references.** `AssetLibrary.members[]` stores *references* (Figma node + code symbol), not binaries. Confirm UXFactory never stores logo/icon/image binaries itself, and that the gate verifies "uses an approved asset" by matching `code_symbol` / `figma_node_ref` rather than by image comparison. (Image comparison may still be needed for tier-7 imagery *treatment*.)

7. **Typed-family threshold.** Which primitive families graduate from generic `Rule { statement, kind }` to typed entities? Proposed line: anything whose policy can drive a *deterministic* check (grids, spacing steps, logo geometry, icon manifest, breakpoints) is typed; prose-only families stay generic. Confirm the cut and whether tenants can author new typed families.

8. **a11y / i18n constraint propagation.** Profiles *constrain* token families (contrast bounds colors; expansion bounds type/layout). Decide whether those constraints are enforced at **authoring time** (reject a color pair that fails AA when the token is defined) or only at **gate time** (flag the rendered output). Authoring-time is stronger but couples the token editor to the profiles.

9. **SEO/AIO scope line.** Confirm the render gate owns *on-page* only and that off-page citability (backlinks, trust, cross-platform presence, citation rates) is a separate monitoring product/loop — not a render-time check. Decide whether UXFactory ships that monitor at all or integrates an external one.

10. **`market/tone/explore` semantics.** Confirm whether these are voice *axes* (segment positioning / register / a third dimension) or authoring *modes/operations* (define market, define tone, generative explore). Changes whether `explore` is a stored field or an editor affordance.

11. **~~Brief as enforced parameter source~~ → RESOLVED (§5.8/§6.6).** The enumerated `ProjectClassification` *derives* the manifest and *pins* the profile; brief-derived params (locales, a11y target, reading level, voice) auto-populate from the vector and are editable **only at the Confirm gate**, with asymmetric friction on relaxing compliance-forced ones. Coupling is tight (full provenance); flexibility survives at exactly one surface.

12. **Viewport class set.** desktop|tablet|mobile is the default matrix. Decide whether tenants can add classes (e.g. `wide`, `watch`, `tv`) and whether each class must map to a Figma variable mode or can be a gate-only test target without a corresponding mode.

13. **Archetype preset authorship.** `category` ships with fixed presets (marketing/ecommerce/web_app/news) seeding the manifest. Decide whether tenants can author custom archetype presets (e.g. `saas-onboarding`, `editorial-longform`), and whether presets are static rules or learned from a tenant's prior approved manifests.

14. **Conditioning conflict resolution.** When two dimensions push opposite effects (`scope.editorial = low` permits placeholder copy, but `industry = healthcare` demands reviewed disclosure copy), the proposed rule is **strictest-wins** (compliance dominates). Confirm this is universal, or whether any axis may override compliance.

15. **Manifest suppression override.** A SUPPRESSED artifact has no checks. Decide whether a user may *promote* a suppressed artifact to generatable/requested at Confirm (adding scope), and whether *demoting* a REQUESTED one is ever permitted without a recorded compliance exception.

16. **Batch granularity & re-pinning.** A `RenderBatch` pins its profile at Confirm. Decide the batch unit (one flow? one release slice? a user-chosen view-state set?) and the policy when the classification or upstream brief changes after a batch is pinned — new batch (proposed default) vs. controlled re-pin with diff.

17. **Default scope per archetype + which dials are user-set.** `category` should seed sensible dial defaults (marketing → Coverage/Flow low; web_app → Coverage/Flow high; news → Coverage medium / Flow low). Decide the default matrix, and whether all four dials are freely user-adjustable at intake or some are *derived* and only floor-adjustable — e.g. **Coverage** could be computed from the AC set (you cannot dial coverage above the states your ACs imply), making it a derived ceiling rather than a free dial.

---

## Appendix — Glossary

| Term | Meaning |
|---|---|
| **Activity / backbone** | top-level story-map node, left→right narrative order; ≈ epic |
| **Acceptance criterion (AC)** | behavioral requirement; the hinge between problem and solution space; compiles into a gate check |
| **Binding / trace** | owned link from a view-state to its Figma node + component (pointer + hash); the moat |
| **codeSyntax** | Figma variable's per-platform code name map; the design↔code bridge |
| **Hardness** | `hard` (blocks) · `soft` (advisory) · `escalate` (HITL) |
| **HITL gate ladder** | role-based human-in-the-loop escalation; the gate reuses it |
| **Materialized + provenance** | synced cache keyed by content hash (variables), neither owned-copy nor bare pointer |
| **Mode** | a Figma collection's per-context value set; = tenant theme or viewport breakpoint |
| **Pointer + hash** | a reference into Figma/repo plus a content fingerprint for drift detection |
| **ResolvedToken** | flattened, alias-walked projection of variables that the gate greps |
| **Source of truth** | what a check dereferences: acceptance criteria, Figma ref, design system, brand guide, or none |
| **View-state** | an explicit condition a view moves through; derived from an AC |
| **Project classification** | the enumerated intake vector (category · industry · age · style · visual fidelity · editorial fidelity · flows); sole input to the conditioning function |
| **Conditioning function** | pure map `classification → (artifact manifest, gate profile)`; runs once at intake |
| **Artifact manifest** | per-artifact disposition for a batch — requested · generatable · suppressed; pinned at Confirm |
| **Render scope** | the 4-dial vector `{visual, editorial, coverage, flow}` (each `none<low<medium<high`) selecting which checks bind |
| **Visual / Editorial dial** | *fidelity* — how polished a rendered ViewState is (how it looks / what it says) |
| **Coverage dial** | *completeness* — state breadth within a view (`AC→ViewState`): success → +empty/loading/error → +edge |
| **Flow dial** | *completeness* — path breadth across views (`View→View`): single screen → primary flow → all branches/recovery |
| **Render batch** | the view-states of selected flows, rendered + gated together against one pinned manifest + profile |
| **Confirm gate** | pre-batch HITL approval of the derived plan; the compute-commit boundary that pins the profile |
| **Archetype** | a `category` preset that seeds the manifest (marketing · ecommerce · web_app · news); a default, not a cage |

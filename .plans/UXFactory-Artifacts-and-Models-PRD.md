# UXFactory — Design Artifacts & Data Models

**Product:** UXFactory (JefeLabs)
**Document:** PRD — Design Artifacts & Data Models
**Companion to:** UXFactory Implementation PRD
**Runtime substrate:** AWS AgentCore (harness + runtime); tier-2 correctness + component registry via generic CI + code repo
**Version:** 0.1 (Draft for review)
**Owner:** Edwin Cruz
**Last updated:** 2026-06-27
**Status:** Draft

---

## 1. Overview & Thesis

UXFactory is the authoring and quality-gate layer for an AI UI-rendering agent. It stores the documents that describe what a UI _should be_, binds them to the design (Figma) and the code, and runs a tiered quality gate that decides whether a rendered output passes, fails, or escalates to a human.

**Core thesis — three claims that the whole product rests on:**

1. **Every source-of-truth document compiles into a gate check.** An acceptance criterion, a brand rule, a design principle — each one compiles into a check of some _hardness_ (deterministic lint, integration test, visual diff, or VLM-judge-with-rubric). UXFactory's authoring experience is not "write nice UX docs"; it is "write docs that compile into gates." That is the product wedge a generic Figma plugin or Notion template structurally cannot replicate.

2. **Own the spec and the trace; reference the rest by pointer + hash.** Figma already owns geometry and tokens; the code repo / component registry already owns components. UXFactory's unique, durable artifact is the **trace graph** — the binding between a story's acceptance criteria, the view-states they imply, the Figma nodes that render them, and the components that implement them. That bridge is the thing everyone else leaves implicit and lets rot. Making it first-class is the moat.

3. **The gate is reference-based, not reference-free.** "Does this render match this Figma node and satisfy these acceptance criteria?" is a far tighter, lower-variance question than "is this good?" UXFactory always gates against two sources of truth — the design (fidelity) and the acceptance criteria (coverage) — plus the guideline rubric (craft/brand). Each covers the others' blind spots.

**Positioning note.** UXFactory is the **design-quality vertical**: it owns the design artifacts, the trace graph, and the design-specific gate tiers (0—1, 3—9) plus the compile step. Orchestration, the iterate-to-threshold loop, HITL routing, and runtime are provided by the **AWS AgentCore harness + runtime**; tier-2 correctness (integration tests) and the component registry are generic **CI + code-repo** concerns. UXFactory monetizes the design-quality vertical without re-implementing orchestration.

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

- Re-storing Figma geometry or token _values_ as authored copies (referenced by pointer + hash; variables are materialized-with-provenance, not authored).
- Replacing the orchestration/runtime substrate (**AWS AgentCore**) or the integration-test/registry layer (generic **CI + code repo**).
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

**Acceptance criteria are the hinge** between problem and solution space. They are written in user terms but directly _enumerate the states_ that must be built. States fall **out of** ACs — they are not invented independently. A designer adding a state with no backing AC is a signal of either a missing story or scope creep; either way it surfaces a conversation.

### 3.2 Cross-cutting guidelines

Two artifact families are **not** nested under a story — they attach at tenant/project scope and are inherited by every view:

- **BrandGuide** (tenant scope) — voice, logo, color-meaning, naming. Applies across a white-label customer's projects.
- **DesignGuide** (project scope) — tokens (referenced) + design principles (owned): hierarchy, rhythm, density, motion, component-usage.

This restores the clean split: **ACs are local** (per story, behavioral); **guidelines are global** (cross-cutting, principled). A gate run composes all three — per-view ACs + project design principles + tenant brand rules.

### 3.3 Cardinality that matters

| Relationship                                | Cardinality     | Consequence                                     |
| ------------------------------------------- | --------------- | ----------------------------------------------- |
| Story ↔ View                                | many-to-many    | a story spans views; a view serves many stories |
| AcceptanceCriterion → ViewState             | one-to-many     | each AC implies one or more states              |
| ViewState → Binding → FigmaNode / Component | one-to-one(ish) | the trace anchor                                |
| BrandGuide → Project                        | one-to-many     | brand inherited across a customer's projects    |
| Collection mode → tenant/viewport           | one-to-one      | a mode = a theme or a breakpoint                |

---

## 4. Design Artifact Catalog

Each artifact is classified by **ownership** — `OWNED` (authored, exists nowhere else), `REFERENCED` (pointer + content hash into Figma/repo), `MATERIALIZED` (synced cache with provenance hash), or `GENERATED` (produced by the gate, stored for audit).

| Artifact                          | Ownership              | Scope      | Purpose                                                               |
| --------------------------------- | ---------------------- | ---------- | --------------------------------------------------------------------- |
| **StoryMap**                      | OWNED                  | project    | 2D organizing surface; backbone of activities × prioritized tasks     |
| **Activity**                      | OWNED                  | project    | backbone node; maps loosely to an epic                                |
| **Task**                          | OWNED                  | activity   | decomposes an activity into steps                                     |
| **Story**                         | OWNED                  | task       | `As a/I want/so that` unit of value                                   |
| **AcceptanceCriterion**           | OWNED                  | story      | behavioral source of truth; compiles into coverage/correctness checks |
| **View / Route**                  | OWNED                  | project    | a navigable surface; many-to-many with stories                        |
| **ViewState**                     | OWNED (derived)        | view       | empty/loading/error/success/edge; derived from ACs                    |
| **Binding**                       | OWNED                  | view-state | **the trace** — links state ↔ Figma node ↔ component (the moat)       |
| **DesignGuide.Principle**         | OWNED                  | project    | prose rubric for integrity/craft tiers                                |
| **DesignGuide.token_ref**         | REFERENCED             | project    | pointer + hash into Figma tokens/variables                            |
| **BrandGuide.Rule**               | OWNED                  | tenant     | brand assertions; compile into lint or judge rubric                   |
| **VariableCollection / Variable** | MATERIALIZED           | project    | lossless mirror of Figma variables + provenance hash                  |
| **ResolvedToken**                 | MATERIALIZED (derived) | project    | flattened, alias-walked token index the gate greps                    |
| **GateProfile**                   | GENERATED (semi)       | project    | which checks apply to which view/component class + escalation routing |
| **GateRun / GateResult**          | GENERATED              | run        | audit record of a gate execution, with trace back-links               |

### Artifact definitions (narrative)

- **Story Map** — a collection of stories plus _two dimensions of meaning_: horizontal = narrative sequence; vertical = priority / release slices. It is a flexible organizing surface, not a rigid parent/child tree.
- **User Story** — one small unit of requirement, `As a <role>, I want <goal> so that <benefit>`. Captures _what_ and _why_ for one piece of functionality. Says nothing about flow or emotion.
- **User Journey** _(input artifact, not stored as a gate source)_ — end-to-end experience with stages, actions, thoughts, touchpoints, pain points, emotion. Used upstream to reveal friction that motivates stories. Not dereferenced by the gate.
- **User Flow** _(input artifact)_ — screen-level navigation logic with decision points/branches. Informs view/route structure.
- **View / ViewState** — a view is a surface; its states are the explicit conditions the surface moves through. States are first-class because the gate's coverage tier checks that every AC-implied state is rendered. (Cf. the JobComposer three-state pattern — Intake → Scoping → Confirm — a single conceptual view decomposed into explicit states, each corresponding to a phase of the underlying job.)
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
  component_ref                # pointer into the component registry (code repo), NOT a copy
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

**Why materialized, not referenced:** the conformance tier must _resolve_ the legal token set (name → value → code symbol) on every check to verify the rendering used a token rather than a magic value. You cannot grep code against a pointer. Variables are therefore a synced cache keyed by a content hash, not an authored copy and not a bare pointer.

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
  min_fidelity        # wireframe | content | visual | interactive | production   ← second axis (see §6.5)
                      #   check is binding when render.fidelity >= min_fidelity
  assertion           # the specific thing checked
  compiled_from       # ac_id | design_principle_id | brand_rule_id | editorial_style_id | discoverability_id   ← traceability

GateRun
  id, project_id, view_id, rendered_artifact_ref, fidelity, started_at, status
                      # runs only checks where min_fidelity <= fidelity

GateResult
  id, gate_run_id, check_id
  status              # pass | fail | escalate
  evidence            # screenshot | diff | failing_ac_id | token_violation | axe_finding
  trace               # back-link to story / AC / figma_node   ← makes failures actionable
```

**The `trace` / `compiled_from` fields close the loop.** A failure points at the exact AC, design principle, brand rule, or Figma node — so the rendering agent (or the human) knows _what_ to fix, not merely _that_ it is wrong.

### 5.6 Design System Primitives & Requirement Profiles

Design-system primitives (colors, spacing, grids, typography, icons, imagery, logos, motion, radius, elevation, …) are **not** a flat set of new entities. Each follows the same shape as the rest of the model — a **values layer** (referenced or materialized) plus a **policy layer** (owned) — and slots under the existing `BrandGuide` (tenant) / `DesignGuide` (project) containers. Token _values_ already live in `ResolvedToken` (§5.4); this section adds the **owned policy** for those tokens and the families Figma variables structurally cannot express (type pairings, asset libraries, grids, motion choreography).

**a11y and i18n are a different shape.** They are not primitives/assets — they are **cross-cutting requirement profiles** that (a) _generate_ checks directly and (b) _constrain_ the primitive families (a11y bounds color tokens via contrast; i18n bounds type/layout via expansion + RTL). They are modeled as Profiles, not Sets/Libraries.

**Typed families vs. prose rules.** Apply the hardness gradient to the schema shape itself: families with enough structure to drive a _deterministic_ check (grids, spacing steps, logo geometry, icon manifest) are **typed entities**; inherently-prose families (imagery "feel", pairing rationale) remain **judge-rubric Rules**. Structured schema → lint check; prose schema → VLM check.

#### Family → layer → tier mapping

| Family                                | Values (class)                            | Policy (class)                       | Scope                             | Primary tier(s)                           |
| ------------------------------------- | ----------------------------------------- | ------------------------------------ | --------------------------------- | ----------------------------------------- |
| Colors                                | variable → `ResolvedToken` (MAT)          | meaning rule (OWN)                   | tenant (meaning) / project (ramp) | 3 conformance · 5 contrast · 7 meaning    |
| Spacing                               | FLOAT var (MAT)                           | rhythm / grid-step (OWN)             | project                           | 3 · 4                                     |
| Radius / elevation / opacity _(etc.)_ | FLOAT·COLOR var (MAT)                     | usage rule (OWN)                     | project                           | 3                                         |
| Grids                                 | grid style (REF)                          | grid rule (OWN)                      | project                           | 3 snap · 4 breakpoints                    |
| Breakpoints                           | = variable **modes** (MAT)                | rule (OWN)                           | project                           | 4 integrity                               |
| Typography scale                      | size/lh/weight var · text style (MAT/REF) | scale rule (OWN)                     | project                           | 3                                         |
| Font pairings                         | font-family token · `font_ref` (REF)      | pairing + rationale (OWN)            | project                           | 6 craft · 3                               |
| Icon set                              | Figma set + code pkg (REF)                | usage policy (OWN)                   | project                           | 3 approved-set · 5 labels                 |
| Imagery set                           | asset library (REF)                       | treatment rules (OWN)                | tenant                            | 7 brand · 4 responsive                    |
| Logos                                 | logo variants (REF)                       | clear-space / min-size (OWN)         | tenant                            | 7 brand                                   |
| Motion                                | duration/easing var (MAT)                 | choreography (OWN)                   | project                           | 4·6 match · 5 reduced-motion              |
| a11y _(profile)_                      | —                                         | target + rules (OWN) → results (GEN) | project                           | **5 (own tier)**; constrains 3·4·7        |
| i18n _(profile)_                      | string catalog (REF)                      | locales/RTL/expansion (OWN)          | project                           | 1 externalized · 4 expansion/RTL · 5 lang |

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

Four artifacts wrap the product surface rather than describe its appearance: the **design brief** (where it comes from), **editorial style** (the words on it), **discoverability strategy** (how it is found), and **viewport strategy** (the contexts it renders in). Two introduce new gate classes (Tiers 8–9); the brief sits _above_ the spec tree as root provenance; the viewport strategy refines Tiers 4–5.

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

**The SEO/AIO scope boundary is load-bearing.** The render gate owns _on-page_ signals (semantic structure, JSON-LD, metadata, answer-first shape, `llms.txt`). It does **not** own _off-page_ signals — the majority of AI brand citations originate off-site, and citability depends on trust footprint and freshness that no render-time check can verify. Off-page belongs to a separate monitoring loop (a sibling concern), and the gate must not promise what it structurally cannot check.

**Content & Voice and Discoverability are separate tiers despite a shared verifier** (both judge the words via an LLM) because their escalation owners differ — content/brand vs. SEO/growth — the same role-based-HITL reason Brand is separate from Craft.

---

## 6. Quality Gate Model

### 6.1 Principles

- **Tiered, cheap→expensive, deterministic→judgment, short-circuiting.** Do not spend a VLM call on craft if state coverage already failed (same logic as the admission/coordinator stage).
- **Reference-based over reference-free.** Always gate against the Figma node and the ACs.
- **Binary decomposition over holistic scoring.** Many y/n assertions have a fraction of the variance of a single 1–10 score. The judge never emits a holistic number.
- **Rubric-anchored prompts** with concrete pass/fail exemplars for checks that genuinely need taste.
- **An instance of the HITL gate ladder.** Hard-deterministic failures auto-reject with no human; soft/judgment results escalate to the role-appropriate owner. This is not a new mechanism — it is the existing ladder specialized for UI.

### 6.2 Tier table (canonical)

| Tier                                  | Source of truth                                                                                                                                   | Verifier                         | Hardness                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------- |
| **0 · Spec presence**                 | —                                                                                                                                                 | deterministic                    | hard (a missing spec is itself a finding) |
| **1 · Coverage**                      | acceptance criteria                                                                                                                               | deterministic + integration test | hard                                      |
| **2 · Correctness**                   | acceptance criteria                                                                                                                               | integration test (CI)            | hard                                      |
| **3 · Conformance**                   | tokens (`token_ref`, pointer) **+** `DesignGuide.Rule` (owned) **+** required SEO/AIO markup (semantic landmarks, valid JSON-LD, meta, canonical) | AST / lint                       | hard                                      |
| **4 · Integrity**                     | `DesignGuide.Principle` (owned rubric) + `ViewportStrategy` matrix + Figma as target instance                                                     | snapshot + VLM judge             | soft                                      |
| **5 · A11y**                          | — (shares semantic substrate with SEO/AIO markup)                                                                                                 | axe-core + judge                 | mixed                                     |
| **6 · Craft**                         | `DesignGuide.Principle` rubric + exemplars; Figma as instance                                                                                     | VLM judge                        | escalate (HITL)                           |
| **7 · Brand**                         | `BrandGuide.Rule` + exemplars                                                                                                                     | lint (structured) / VLM judge    | mixed → escalate                          |
| **8 · Content & Voice**               | `EditorialStyle` + exemplars                                                                                                                      | LLM judge                        | escalate (owner: content / brand)         |
| **9 · Discoverability (AIO content)** | `DiscoverabilityStrategy` — answer-first, entity density, citability shape (on-page only)                                                         | LLM judge                        | soft → escalate (owner: SEO / growth)     |

### 6.3 What each tier checks

- **0 Spec presence** — ACs exist; states are enumerable. Blocks; absence is a finding.
- **1 Coverage** — every AC-implied state is rendered; every AC has a manifestation; every view exists.
- **2 Correctness** — interactions produce specified outcomes; branches handled; data bound correctly. (Component-reactive integration tests in CI, reading from the component registry.)
- **3 Conformance** — tokens only, no magic values; reuses system components; respects variable `scopes`; **required SEO/AIO markup present** (semantic landmarks, valid JSON-LD for declared `schema_types`, meta/canonical per `metadata_policy`). Deterministic once the ResolvedToken index and `DiscoverabilityStrategy` exist.
- **4 Integrity** — holds across the `ViewportStrategy` matrix (desktop/tablet/mobile); long strings, large/small data, i18n expansion, overflow.
- **5 A11y** — semantics, keyboard, contrast, focus order, touch-target sizing per viewport input modality. Shares the semantic-structure substrate (landmarks, headings, alt, `lang`) with the SEO/AIO markup check — one verifier serves both.
- **6 Craft** — hierarchy, rhythm, alignment, intentionality. Escalates to a human.
- **7 Brand** — logo usage, color meaning, imagery treatment, naming. Earns its own class chiefly because the **escalation owner differs** (brand / tenant admin, not eng).
- **8 Content & Voice** — generated microcopy (labels, empty/error/success text, headings) matches `EditorialStyle` voice + `tone_map` context + lexicon + reading level. New class because nothing else gates the _words_ the render agent produces; owner is content/brand.
- **9 Discoverability (AIO content)** — _on-page_ citability shape: direct answer in first 40–60 words, self-contained sections, entity density, statistic/source density. **Off-page signals (backlinks, off-site trust, cross-platform presence, actual citation rates) are out of scope for the render gate** — they belong to a separate monitoring loop, not a render-time check.

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

### 6.5 Fidelity Levels — Gate Scoping

Not every render owes every gate. Fidelity is a **selector over the catalog and the ladder**: it decides which slice of the artifact catalog is binding for a given render. A wireframe failing "uses design tokens" or "on-brand" is noise — fidelity suppresses gates that do not yet apply and turns them on as the render matures. This is not new machinery; it is a threshold on the existing checks.

**Mechanism — `min_fidelity` per check (a second axis alongside `hardness`).** Each `GateCheck` declares the level at which it becomes binding. A render at fidelity `F` runs exactly the checks where `min_fidelity ≤ F`. Fidelity is an ordinal threshold, not a config table.

**Tiers ramp, they do not toggle.** Because `min_fidelity` is per-check, a single tier activates progressively: A11y's landmark/heading check binds at `wireframe`, contrast at `visual`, keyboard/focus at `interactive`. Same tier, three `min_fidelity` values. (Mirrors how `hardness` is per-check, not per-tier.)

**The five levels — each a strict superset of the prior:**

| Level               | Adds these artifacts as binding                                                                           | Activates (tiers)                                                    | Medium             |
| ------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| **1 · Wireframe**   | `StoryMap`/`AC` coverage · `LayoutSystem` grid · `ViewportStrategy` structural reflow                     | 0 spec · 1 coverage · 4 _structural_ · 5 _landmarks_                 | greybox design     |
| **2 · Content**     | `EditorialStyle` (voice/tone/reading-level) · real component usage · `I18nProfile` string externalization | + 8 content & voice · + 3 _components_ · + 1 _i18n externalized_     | mid-fi / stubbed   |
| **3 · Visual**      | full `TokenSet`/type/color/spacing/icons · `BrandGuide` · `DesignGuide.Principle`                         | + 3 _tokens_ · + 6 craft · + 7 brand · + 4 _visual_ · + 5 _contrast_ | hi-fi design       |
| **4 · Interactive** | `MotionSystem` · interaction outcomes · all states exercised                                              | + 2 correctness · + motion · + 5 _keyboard/focus_                    | wired proto / code |
| **5 · Production**  | full `A11yProfile` · full `I18nProfile` (RTL, formatting) · `DiscoverabilityStrategy` · perf              | + 9 discoverability · 5 _full a11y_ · 4 _full i18n_ · all            | code               |

**Fidelity is a promotion ratchet, not just a filter.** Because each level is a superset, the levels are pipeline stages: a render is promoted from Lₙ to Lₙ₊₁ only when every hard check with `min_fidelity ≤ Lₙ` passes and the soft/escalate checks at that level are resolved. This is the HITL gate ladder staged by fidelity — structurally the same as the phase progression in the dashboard model (Discover → … → Verify → Run).

```
FidelityLevel (ordinal)   1 wireframe · 2 content · 3 visual · 4 interactive · 5 production

Render.fidelity           the declared level of this output
Gate selection            run checks where check.min_fidelity <= render.fidelity

FidelityGate (promotion)
  from_level → to_level
  requires: all HARD checks (min_fidelity <= from_level) pass
            + all SOFT/ESCALATE at from_level resolved
```

**Medium is derived from level, not a separate flag.** Fidelity (how complete) and medium (design vs. code) are correlated but not identical: L1–L3 are usually Figma-medium, L4–L5 usually code-medium, with L4 the crossover. The clean call is to let fidelity be the primary selector and derive medium from level for the default ladder — one axis, not a 5×2 matrix. This is what resolves the former code-vs-visual question: **visual output is L3, code output is L5**, so `component_ref` / `code_symbol` are required at `min_fidelity = production` and null below.

---

## 7. Figma Variable Integration

### 7.1 Access paths (decision-critical)

| Path           | Endpoint                             | Fidelity                                  | Gate                                           |
| -------------- | ------------------------------------ | ----------------------------------------- | ---------------------------------------------- |
| **REST API**   | `GET /v1/files/:key/variables/local` | full (modes, scopes, codeSyntax, aliases) | **Enterprise Full-seat only**; guests excluded |
| **Plugin API** | `figma.variables` export → JSON      | full read/export                          | **no plan gate**                               |

- The REST API requires an Enterprise org + Full seat. Most small design teams UXFactory sells to are **not** Enterprise, so the product cannot assume this path.
- `/variables/published` does **not** return modes — use `/variables/local` for mode values. "Published" is the wrong endpoint for a gate that cares about theming.
- **Recommended ingestion:** a Figma plugin serializes the variable graph to JSON → drops into a folder-watch bridge → UXFactory ingests the mirror schema. This is the same architecture already used to sidestep the MCP enterprise restriction, repurposed for token extraction. Support **both** REST (Enterprise tenants) and plugin-export-via-bridge (everyone else) feeding the identical mirror. Figma ships an official Variables-sync GitHub Action whose envelope the export format can model.

### 7.2 Modes = multi-tenant + viewport in one primitive

A collection's modes are per-context value sets. **Extended collections** (`isExtension` / `parentVariableCollectionId`) are Figma's native way to fork a base theme per brand. Therefore:

- a white-label **tenant theme** = an extension collection (or a mode),
- a responsive **breakpoint** = a mode.

This folds directly into the SkoolScout-shaped multi-tenancy _and_ the tier-4 "holds across viewport range" integrity check — same mechanism, two axes. Model `mode` as a first-class dimension on `ResolvedToken` rather than special-casing light/dark.

### 7.3 `codeSyntax` is the linchpin

`codeSyntax.WEB` is the literal Figma-variable → code-symbol map. Tier-3 conformance becomes a deterministic match — _did the emitted React reference `code_symbol` rather than a hardcoded hex?_ No judge required. This is the design↔code bridge made first-class — UXFactory's reason to exist.

---

## 8. Storage Taxonomy (summary)

| Class                         | Examples                                                     | Why                                                          | Form                       |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------- |
| **Authored / Owned**          | ACs, DesignGuide principles, BrandGuide rules, Binding graph | exists nowhere else                                          | source of truth            |
| **Pointer + hash**            | frame geometry, node layout, `token_ref`, `component_ref`    | high-churn; gate never resolves it deterministically         | link + fingerprint         |
| **Materialized + provenance** | Figma variables (mirror + ResolvedToken)                     | the conformance _contract_; gate must resolve it every check | synced cache keyed by hash |
| **Generated**                 | GateProfile, GateRun, GateResult                             | produced by execution                                        | audit record               |

**Net stored-doc set:** ACs (owned, per-story) · DesignGuide principles + BrandGuide rules (owned, cross-cutting rubric) · the trace/binding graph (owned — the moat) · the variable mirror + resolved index (materialized) · gate runs (generated, audit). **Referenced by pointer + hash:** Figma nodes, tokens, components.

---

## 9. Authoring Experience (the product wedge)

The differentiator is **gate-ready authoring**. The authoring flow captures `implied_state`, `verifier_hint`, and `hardness` at the moment a human writes an AC; it captures `compiles_to`, `hardness`, and `exemplars` at the moment a human writes a design principle or brand rule. Then:

- An **AC is not a separate thing from a GateCheck — it compiles into one.**
- The **GateProfile half-generates itself** from the authored spec + guidelines.
- The guidance UXFactory sells is _"write docs that compile into gates,"_ not _"write nice UX docs."_

This collapses the SPEC and PROFILE layers into a single authored act — the thing a generic Figma plugin or Notion template structurally cannot do.

**Composition as a feature:** brand inherited across a customer's projects (tenant), design per project, ACs per story. A single gate run composes all three, which is itself a sellable capability and fits the existing multi-tenant shape.

**Import path for brand:** when a BrandGuide is imported (PDF / Frontify / Figma) rather than authored, store `source: imported_ref` as pointer + hash **and** persist a distilled set of structured `Rule`s extracted once at import — you cannot feed a 40-page brand PDF into every gate run, so extraction-to-assertions happens at import time (the same compile step, front-loaded). Push users toward authoring-in-UXFactory, which skips extraction and is structured from the start.

---

## 10. Open Questions & Forks

1. **~~Code vs. visual output~~ → RESOLVED by fidelity (§6.5).** This was never a real fork — code and visual are two points on the fidelity axis. **Visual output is L3 (Visual); code output is L5 (Production).** `component_ref` and `code_symbol` are therefore required at `min_fidelity = production` and null below it, rather than gated by a mode flag. Remaining sub-decision: whether L4 (Interactive) prototypes are gated as design-medium or code-medium by default.

2. **Brand escalation routing.** Brand violations escalate to a different owner (brand / tenant admin) than eng-facing conformance failures. Confirm the routing model and whether tenant admins get a distinct HITL surface.

3. **Variable access default.** Ship plugin-export-via-bridge as the primary path (works for non-Enterprise), with REST sync as an Enterprise upgrade? Or gate the whole token-conformance tier behind variable availability and degrade gracefully when absent?

4. **Journey/Flow as stored gate sources?** Currently treated as upstream input artifacts, not dereferenced by the gate. Decide whether any journey/flow signal (e.g., expected step sequence) should compile into a correctness check.

5. **Drift policy.** On `content_hash` mismatch for a `figma_node_ref` or variable mirror — auto-re-sync, flag-and-hold, or fail the affected checks? Affects how stale the gate is allowed to be.

6. **Asset binaries vs. references.** `AssetLibrary.members[]` stores _references_ (Figma node + code symbol), not binaries. Confirm UXFactory never stores logo/icon/image binaries itself, and that the gate verifies "uses an approved asset" by matching `code_symbol` / `figma_node_ref` rather than by image comparison. (Image comparison may still be needed for tier-7 imagery _treatment_.)

7. **Typed-family threshold.** Which primitive families graduate from generic `Rule { statement, kind }` to typed entities? Proposed line: anything whose policy can drive a _deterministic_ check (grids, spacing steps, logo geometry, icon manifest, breakpoints) is typed; prose-only families stay generic. Confirm the cut and whether tenants can author new typed families.

8. **a11y / i18n constraint propagation.** Profiles _constrain_ token families (contrast bounds colors; expansion bounds type/layout). Decide whether those constraints are enforced at **authoring time** (reject a color pair that fails AA when the token is defined) or only at **gate time** (flag the rendered output). Authoring-time is stronger but couples the token editor to the profiles.

9. **SEO/AIO scope line.** Confirm the render gate owns _on-page_ only and that off-page citability (backlinks, trust, cross-platform presence, citation rates) is a separate monitoring product/loop — not a render-time check. Decide whether UXFactory ships that monitor at all or integrates an external one.

10. **`market/tone/explore` semantics.** Confirm whether these are voice _axes_ (segment positioning / register / a third dimension) or authoring _modes/operations_ (define market, define tone, generative explore). Changes whether `explore` is a stored field or an editor affordance.

11. **Brief as enforced parameter source.** `DesignBrief.audience` is proposed to _derive_ i18n locales, a11y target, and reading level. Decide whether these are auto-populated-and-locked from the brief, auto-suggested-then-editable, or merely advisory. Tighter coupling improves provenance but reduces per-profile flexibility.

12. **Viewport class set.** desktop|tablet|mobile is the default matrix. Decide whether tenants can add classes (e.g. `wide`, `watch`, `tv`) and whether each class must map to a Figma variable mode or can be a gate-only test target without a corresponding mode.

---

## Appendix — Glossary

| Term                          | Meaning                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| **Activity / backbone**       | top-level story-map node, left→right narrative order; ≈ epic                                     |
| **Acceptance criterion (AC)** | behavioral requirement; the hinge between problem and solution space; compiles into a gate check |
| **Binding / trace**           | owned link from a view-state to its Figma node + component (pointer + hash); the moat            |
| **codeSyntax**                | Figma variable's per-platform code name map; the design↔code bridge                              |
| **Hardness**                  | `hard` (blocks) · `soft` (advisory) · `escalate` (HITL)                                          |
| **HITL gate ladder**          | role-based human-in-the-loop escalation; the gate reuses it                                      |
| **Materialized + provenance** | synced cache keyed by content hash (variables), neither owned-copy nor bare pointer              |
| **Mode**                      | a Figma collection's per-context value set; = tenant theme or viewport breakpoint                |
| **Pointer + hash**            | a reference into Figma/repo plus a content fingerprint for drift detection                       |
| **ResolvedToken**             | flattened, alias-walked projection of variables that the gate greps                              |
| **Source of truth**           | what a check dereferences: acceptance criteria, Figma ref, design system, brand guide, or none   |
| **View-state**                | an explicit condition a view moves through; derived from an AC                                   |

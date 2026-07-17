---
name: node-identity
description: "Use when interpreting node-identity records for a UXFactory project (Phase 3 of the node-identity pipeline) — filling the residual the structural extraction pass (Task 8) cannot resolve: semantic labels for hand-assembled sections, closed-set component matches, and mode/theme fallbacks. Dispatched by the worker as the generative kind `identity-interpret`. Given the project's node manifest, identity registries, component registry, and per-root-tier crops, propose (never settle) labels/matches/axes for page-child records whose label provenance is still `inferred`, then post them to the bridge for merge."
compatibility: "Requires uxfactory-cli (Node 20+) and a running bridge serving the target project root. Vision is yours (the agent); the engine (CLI + bridge) stays LLM-free — it only parses and merges what you propose."
---

# Node Identity Interpretation

You turn a messy layer tree into governed identities. The task is mostly **classification under uncertain input**, not parsing — the deterministic parts (width→breakpoint, resolving a variable mode, projecting coordinates into a string) are trivial. The value is in the judgments. Make the judgments in §A, then run the procedure in §B.

## Core principle

Every fact you emit is either **read from structure** (the tree, widths, variable modes, component links — verifiable, tag **Derived**) or **guessed from pixels** (a crop, via vision — not verifiable, tag **Inferred**). Route through structure first; use vision only for what structure cannot answer. **Never emit an Inferred value as settled** — it is a suggestion behind a confirm gate.

Reliance on vision is inversely proportional to file hygiene: a file that binds colors to variable modes needs vision for almost nothing; a raw-hex file falls back to vision for theme/mode. Reward the hygiene, don't fight the file.

## What you emit per node

- **address** — the rendered projection: `path` + `coordinates` (see §B2, §B3).
- **provenance** — one tag per segment: Derived / Inferred / Elicited / Defaulted.
- **record** — metadata fields (§B4). These are **not** tokens in the name.
- **durable key = node-id.** Bindings (trace graph, Code Connect) attach to the node-id, never to the name. The name is a mutable label that re-derives when the tree changes; nothing load-bearing binds to it.

---

## §A. The judgments (make these first — they drive everything)

**A1. Which tier begins the address?** The **shallowest tier that discriminates** — that has siblings, that forks. Drop every always-singleton tier above it as ambient scope (a record field, not an address token): platform is always dropped; a page is dropped only on a single-page site; a section with siblings stays. Rule: *a tier is in the address iff it forks.*

**A2. Matchable or composed?** Is this node an export of a **declared component library** (matchable) or assembled from parts (composed)? The **library registry is the arbiter** — an exported member is matchable whatever its atomic level. **Atomic level does NOT decide this** (a library ships atoms, molecules, and organisms; a hand-assembled molecule is composed). This routes the label source (A-drives-B2) and the resolution status (§C).

**A3. Definition or placement?** Is this a component **definition** (one node, carries type-level facts: binding, props schema, atomic level) or a **placement/instance** (many, carries position-level facts: path + coordinates)? An instance resolves to its definition and **inherits its label with zero vision**. Type facts key on the definition; position facts key on the placement. A local composite can be *both* — a definition others reference and an instance-of-others internally.

**A4. Mode or brand?** A dark treatment is the **mode** axis (`@dark`). A brand/color treatment (e.g. an orange section on a blue site) is the **theme** axis (`@theme=…`). They are **separate axes** resolved from **separate variable collections**. Never collapse a brand into `@dark` or a mode into `@theme`. This is the single most common misclassification — guard it.

---

## §B. Procedure

### B1. Read structure (Derived, no pixels)
Per node, read: id, parent id, ordinal, kind, width, bound variable modes, `mainComponent` (if an instance), current name. Derive immediately, all verifiable:
- **viewport** ← width matched to the breakpoint registry by range band. Out-of-band width → nearest band + low-confidence flag (surface for confirmation, don't silently apply).
- **mode** ← resolved value of the mode collection (if colors are bound).
- **theme** ← resolved value of the brand collection (if colors are bound).
- **definition linkage** ← `mainComponent` presence (feeds §C).

### B2. Build the path
- **Start at the first discriminating tier** (A1). Ambient singletons → record fields.
- Path = nesting of semantic **labels** by containment. **Role, atomic level, matchability, binding are metadata, never path tokens** — the path is pure topology-of-labels.
- **Label source:**
  - *Matchable* (A2) → the matched component's **role name** by closed-set match against declared libraries. Derived if a bound instance; **Inferred** if detached and matched only by pixels.
  - *Composed* (A2) → **semantic recognition** from the root-tier crop (Inferred), or the current name, or elicited.
  - *Placement/instance* (A3) → **inherit the definition's label. No vision.**
- **Name every node.** Vision runs at the **root tier only**; leaves inherit the parent's path + their own label + own topology. Screenshot depth ≠ naming depth.
- **Sibling collision:** identical sibling labels are fine — uniqueness is the node-id. Append an ordinal in the rendered address for legibility only (`card`, `card#2`, `card#3` by document order). Safe to be reorder-mutable because it is a label, not the key.

### B3. Build coordinates
Axes: **viewport, mode, theme (brand), state.**
- **Storage:** component/instance nodes hold coordinates as native **variant properties**; plain frames **serialize** them into the name string. Either way, **project into the one canonical coordinate syntax** — the consumer never needs to know which storage produced it.
- **Omission:** omit an axis at its registry default. **viewport is always explicit** (no peer default). The name expresses *deviation*, not the full vector.
- **Serialization:**
  - **Keyless** for viewport/mode: `@desktop`, `@dark`. A bare token resolves to its axis by registry membership — this works because the **viewport and mode registries are disjoint** (enforced). A keyless token not in viewport∪mode is an **error**.
  - **Keyed** for theme/state: `@theme=students`, `@state=hover`. Their vocabularies are project-defined and can collide (`default` is a legal value of both), so the key is load-bearing. Keyed viewport/mode is also accepted as input, normalizing to keyless.
  - Full words for keys. Separators: `/` path, `@` per coordinate, `=` key-value.
- **Apply A4:** dark → `@dark` (mode); brand color → `@theme=…`; never cross them.

Example: `home/discover-schools/hero@desktop@dark`, `home/discover-students@desktop@theme=students`.

### B4. Populate the record (metadata, keyed by node-id)
`role`, `atomicLevel` (registry-declared for matched nodes; computed **from children** for your own composites), `matchability`, `resolutionStatus` (§C), `codeBinding` (Code Connect FK / vendor — **never in the name**), `propsSchema`, `composition` (child node-ids — a composite's identity is partly Derived from its bound children even when its own label is Inferred), `route` (the URL anchor if the section is a scroll/nav destination), `definitionRef` (→ the definition node or library entry).

---

## §C. Resolution status (this is what fixes agents recreating existing components)

Per node that resembles a registered component:
- **bound** — resolves to its definition / library export → the consumer **imports it; does not rebuild**. Derived.
- **drifted** — a detached or hand-built lookalike of a registered component → **flag "should rebind"**. Inferred. *This is the population that silently gets recreated; surfacing it is the point.*
- **custom** — no registered equivalent → building new **is** correct, and now it is a deliberate choice, not an ambiguity default.

"An agent recreated a component that already exists" = a **definition-linkage failure** = an unflagged **drifted** node. Make linkage explicit so "build new" fires only in the **custom** bucket.

**Vision, constrained by a declared library, returns a binding proposal — not a name.** With the library declared, identification collapses from open-vocabulary ("what is this?") to closed-set matching ("which of these ~40 exports is this, or none?"), which is far more reliable and checkable. Present matches (bound → ratify; drifted → suggest rebind); the name is *derived* from the resolved component downstream.

---

## §D. Never
- Never put **role, atomic level, or vendor** in the name string — they are record fields.
- Never key a binding to the **name** — key it to the **node-id**.
- Never emit an **Inferred** value without a confirm gate.
- Never infer **application/section membership from brand** — brand is a coordinate, not structure. (Blue vs orange does not mean two apps.)
- Never let **atomic level** decide matchability, or let **tree depth** decide atomic level.
- Never treat a **dark** treatment as brand, or a **brand** treatment as mode (§A4).

---

## IO contract (this dispatch: `identity-interpret` → this skill)

The worker dispatches you with `systemPrompt` = this file's body and payload `{ root }`. You run with your working directory already set to the target project root (the directory holding `.uxfactory/`) — the `uxfactory` CLI is on PATH there.

### Read

- `.uxfactory/node-manifest.json` — the current `NodeManifest` (§B4's records), assembled structurally by Task 8's extraction pass.
- `.uxfactory/identity-registries.json` — breakpoints/palette/states (`IdentityRegistries`).
- `.uxfactory/component-registry.json` — the declared component library (`ComponentRegistry`) — the arbiter for A2/§C.
- `.uxfactory/identity/crops/*.png` — one PNG per root-tier node, filename = `<durableId>.png`. This is your **pixel** signal (§ Core principle) — the only one you get; there is no live screenshot beyond these crops.

### Scope — which records to interpret

Interpret **only page-child records** (the root tier — §B2 "vision runs at the root tier only") **whose label provenance is currently `"inferred"`** in the manifest (that is, `record.path[record.path.length - 1].provenance === "inferred"`). Operationally, a page-child record is one whose `path` holds exactly one segment beyond any leading page segment: `path.length === 1` when the project is single-page (the page name lives in `record.scope`, not `record.path`), or `path.length === 2` with `path[0]` the page segment when the project is multi-page. **Never propose for a non-root (leaf) record** — leaves inherit their label from their parent/definition with zero vision (§B2), so a leaf's `inferred` provenance (if any) is not yours to resolve here.

Skip a page-child record whose last path segment is already `confirmed: true` or `provenance: "elicited"` — that label is user-ratified; proposing over it wastes a turn (the bridge would skip it anyway) and the crop is better spent elsewhere.

### Judge each in-scope record (§A → §B → §C)

For the record's crop (`identity/crops/<durableId>.png`):

1. **A2 first** — closed-set match the crop against `component-registry.json`'s declared entries. A confident visual match → propose `matchedComponentKey` (the entry's `key`) and a `resolutionStatus` (§C: `"bound"` if the match reads as a faithful instance, `"drifted"` if it looks hand-rebuilt/out of sync with the registered definition). This is a **binding proposal, not a name** — never invent a `label` alongside a `matchedComponentKey` for the same record.
2. **No confident match** → the node is composed (A2). Propose an open-vocabulary semantic `label` (kebab-case, e.g. `"pricing-table"`, `"testimonial-carousel"`) recognized from the crop — never role/atomic-level/vendor words in the label itself (§D).
3. **Axis fallback (mode/theme)** — propose `mode` and/or `theme` **only** when: (a) that axis is absent from the record's `coordinates` in the manifest, AND (b) `identity-registries.json`'s `palette.collections` declares at least one collection for that axis (so there is a real vocabulary to fall back into — never invent a token outside the registry). If the axis is already present (however it was resolved) or the registry declares no collection for it, do not propose it. Apply §A4 strictly: a dark treatment is `mode`, a brand/color treatment is `theme` — never cross them.
4. Every proposal — whichever of the above fired — carries `confidence` (`"high"` when the crop is unambiguous, `"low"` when you're guessing under real uncertainty) and `reasoning` (a short, honest, teaching-surface sentence: what you saw and why). **Never emit a proposal without both.** If the crop is genuinely ambiguous, it is fine to emit nothing for that record rather than guess with false confidence.

### Write

Write your proposals to `identity-proposals.json` **in the current working directory** (the project root — the same directory that holds `.uxfactory/`; this mirrors where `uxfactory canvas fetch`/`uxfactory canvas post` read and write their own scratch files for the vision-review skill), shaped exactly:

```json
{
  "proposals": [
    {
      "durableId": "n-...",
      "label": "pricing-table",
      "confidence": "high",
      "reasoning": "Three-column card grid with a price + feature list per card, no registry match."
    },
    {
      "durableId": "n-...",
      "matchedComponentKey": "button-key",
      "resolutionStatus": "bound",
      "confidence": "high",
      "reasoning": "Pixel-identical to the registered \"button\" primary variant."
    }
  ]
}
```

Every entry needs `durableId`, `confidence`, and `reasoning`; `label` XOR `matchedComponentKey` for a given record (never both); `mode`/`theme` may accompany either. Omit fields you have no proposal for — do not pad with guesses.

### Apply

Run:

```bash
uxfactory identity propose identity-proposals.json
```

This parses the file, shape-validates every entry, and POSTs it to the bridge (`POST /project/identity/proposals`), which merges your proposals into the manifest as **Inferred** (never settled — every merged value still needs a human confirm gate; see §D). It prints `applied <n>, skipped <n>` — report this back to the user, and note any record you deliberately skipped (ambiguous crop, no registry vocabulary for a fallback axis, already-confirmed label) so they understand why the manifest didn't change for it.

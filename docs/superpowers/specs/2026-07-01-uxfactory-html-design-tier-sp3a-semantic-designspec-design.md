# UXFactory HTML Design Tier — SP3a: Semantic DesignSpec + Plugin Render (Design)

**Date:** 2026-07-01
**Status:** Design — awaiting user review before plan
**Parent:** SP3 (Figma landing) of the HTML high-fidelity design tier. See `2026-06-30-uxfactory-html-design-tier-sp1-design.md` (verifiable HTML loop) and `2026-06-30-uxfactory-html-design-tier-sp2-craft-quality-design.md` (craft-quality).

---

## 1. Context & where this fits

The HTML tier authors real HTML/CSS/JS per screen-state (SP1), drives a deterministic render+gate to green (SP1), and iterates to a craft bar via an independent judge (SP2). The remaining piece — **SP3, Figma landing** — turns the gated design into **editable Figma nodes**, so the verified design becomes a real, editable Figma file rather than only a screenshot.

The user chose the **headless-deterministic, semantic** landing path (over an interactive Figma-MCP path or a flat absolute-positioned extraction): the whole tier stays autonomous, verifiable, and free of any external Figma-MCP dependency, and the landing produces **designer-native structure** — auto-layout, nested frames, and reusable components — not a flat pile of absolutely-positioned boxes.

SP3 decomposes into three sequential sub-projects (each its own spec → plan → build):

- **SP3a (this spec) — Semantic target.** Extend the `DesignSpec` model and the plugin's `renderSpec` so they can *represent and render* Figma auto-layout, nested frames, local components, and effects. Deliverable: the plugin lands a **hand-written** semantic spec as a nicely-structured, auto-layout, component-based Figma design.
- **SP3b — DOM→semantic extractor** (engine, deterministic): walk the rendered DOM → infer layout (flex/grid/flow → auto-layout), nest containers → frames. Produces the semantic spec.
- **SP3c — Component detection + integration/delivery/landing-verification**: detect repeated patterns → components/instances; run extraction after the loop; publish; land all screens; verify.

SP3a is the **foundation**: the extractor (SP3b/c) needs a defined, renderable target to aim at. This spec builds and proves that target *in isolation*, using hand-authored semantic specs in tests — no extractor yet.

## 2. Goal & non-goals

**Goal:** The `DesignSpec` interchange and the plugin renderer gain the vocabulary to express and render a semantically-structured Figma design — **additively and backward-compatibly**, so every existing flat spec renders byte-identically.

**In scope (SP3a):**
1. Extend the `DesignSpec` TS model (`packages/uxfactory-spec/src/types.ts`) with: auto-layout on frames, **nested frames** (recursive children), **local component definitions + instances** (with a bounded override alphabet), and **effects** (drop/inner shadow). Plus minor style additions the semantic target needs (per-corner radius).
2. Extend the JSON Schema (`packages/uxfactory-spec/schema/uxfactory.schema.json`) in lockstep so the new optional fields validate (and invalid values are rejected).
3. Extend the plugin renderer (`packages/uxfactory-plugin/src/code.ts`): make node rendering **recursive**, apply **auto-layout** when a frame carries `layout`, build Figma **components** from `components` and instantiate them (applying overrides), and apply **effects**. Extend the mockable `FigmaApi`/`EditableNode` seam accordingly.
4. Tests: spec-package validation tests (new fields accepted / bad values rejected) and plugin render tests (a hand-written semantic spec drives the right auto-layout/component/effect calls through the fake `fig`; existing flat specs still render unchanged).

**Non-goals (explicitly deferred):**
- The DOM→DesignSpec extractor (**SP3b**) and component detection (**SP3c**).
- Running extraction after the loop, publishing, or landing real screens (**SP3c**).
- Any change to the engine/gate (`packages/uxfactory-cli`), the worker, or the skills. SP3a is model + plugin only.
- Rich effect types beyond drop/inner shadow (layer/background blur), gradient/image fills, component variants/props, auto-layout `layoutWrap`, absolute-positioned children *inside* an auto-layout frame, and constraints. Out of v1; can extend later additively.

## 3. Architecture & boundaries

Two packages change; nothing else.

- **`packages/uxfactory-spec`** (the interchange; LLM-free data + Ajv validator). The `DesignSpec` types and the JSON Schema gain optional fields. This is the contract SP3b/SP3c and the plugin share.
- **`packages/uxfactory-plugin`** (the Figma-side renderer; runs in Figma). `renderSpec` learns to render the new vocabulary through its existing **mockable `fig` seam** (`FigmaApi`/`EditableNode` interfaces), which is exactly how the plugin's tests inject a fake Figma.

**Invariants preserved:**
- **Engine untouched** → the LLM-free / offline / deterministic engine invariant holds trivially (SP3a never touches `uxfactory-cli`).
- **Additive & backward-compatible** → every new field is optional. A spec with no `layout` / `components` / `effects` produces the exact same Figma nodes as today. The CLI publish path (`commands/publish.ts`) passes specs through untouched (it validates + enqueues; it does not traverse node semantics), so it keeps working once the schema accepts the new fields.
- **DesignSpec stays plaintext JSON** (per the storage decision: artifacts are git-diffable/reviewable; no DB). SP3a adds JSON fields, not a schema store.

## 4. The model extension (`types.ts` + schema, in lockstep)

All additions are **optional**. The `DesignSpec` friendly vocabulary stays portable; the plugin maps friendly values → Figma enums (§5).

### 4.1 Auto-layout + nesting on frames

`Frame` (and the new nestable container) gains an optional `layout` and `sizing`, and `FrameChild` gains a recursive frame:

```ts
export type Align = "start" | "center" | "end";
export type PrimaryAlign = Align | "space-between";
export type Sizing = "fixed" | "hug" | "fill";

export interface AutoLayout {
  mode: "horizontal" | "vertical";
  gap?: number;                                   // Figma itemSpacing
  padding?: number | { top: number; right: number; bottom: number; left: number };
  primaryAlign?: PrimaryAlign;                    // main-axis distribution
  counterAlign?: Align;                           // cross-axis alignment
}

export interface SizingSpec {
  horizontal?: Sizing;                            // FIXED | HUG | FILL
  vertical?: Sizing;
}

export interface Frame extends Box {
  name: string;
  layout?: AutoLayout;                            // NEW — absent ⇒ absolute positioning (today's behavior)
  sizing?: SizingSpec;                            // NEW
  effects?: Effect[];                             // NEW (§4.3)
  cornerRadius?: CornerRadius;                    // NEW (§4.4)
  fill?: HexColor;                                // NEW — frames may have a background
  children?: FrameChild[];
}

export type FrameChild = ShapeNode | TextNode | InstanceNode | ComponentInstanceNode | Frame;
//                                                             ^NEW (§4.2)          ^NEW: frames nest recursively
```

**Semantics:** when a frame has `layout`, Figma auto-layout owns child positioning — child `x`/`y` become ignored/managed (children flow by `mode`/`gap`/`padding`/alignment). Without `layout`, children are absolutely positioned by their `x`/`y` exactly as today. `sizing` maps to `layoutSizingHorizontal`/`Vertical` (a `fill` child stretches on the counter axis, `hug` shrinks to contents). A nested `Frame` child may itself carry `layout` — arbitrarily deep.

`ShapeNode`, `TextNode`, and `InstanceNode` also gain optional `effects?` and (shape only) `cornerRadius?: CornerRadius`.

### 4.2 Local components (definitions + instances + overrides)

Distinct from the existing `InstanceNode` (which imports a **published library asset** by key via `importComponentByKeyAsync` — e.g. an AWS icon). The new **local** component is defined *within the same spec* and instantiated from a local master.

```ts
/** A reusable master: a frame-like node tree turned into a Figma component. */
export interface ComponentDef {
  name: string;
  layout?: AutoLayout;
  sizing?: SizingSpec;
  width: number;
  height: number;
  fill?: HexColor;
  cornerRadius?: CornerRadius;
  effects?: Effect[];
  children?: FrameChild[];                        // same child grammar as a frame
}

/** Bounded per-descendant override alphabet (v1). */
export interface InstanceOverride {
  characters?: string;
  fill?: HexColor;
  visible?: boolean;
}

/** An instance of a local ComponentDef, resolved by `component` id. */
export interface ComponentInstanceNode {
  type: "component-instance";
  name: string;
  component: string;                              // key into DesignSpec.components
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  overrides?: Record<string, InstanceOverride>;   // descendant node name → override
}

export interface DesignSpec {
  editor?: "figma";
  page?: string;
  components?: Record<string, ComponentDef>;      // NEW — id → master
  frames: Frame[];
  connectors?: Connector[];
  edits?: Edit[];
}
```

**Semantics:** the plugin builds one Figma component per `components` entry (rendered off the main flow — see §5.4), then for each `component-instance` creates an instance of the referenced master, positions/sizes it, and applies `overrides` by matching descendant node `name`. Overrides are bounded to `characters`/`fill`/`visible` in v1 — enough for the extractor (SP3c) to vary instances (e.g. two buttons from one component with different labels) without a full component-property system.

### 4.3 Effects (depth)

```ts
export interface Effect {
  type: "drop-shadow" | "inner-shadow";
  color: HexColor;                                // opacity carried separately
  opacity?: number;                               // 0..1, default 1
  x: number;
  y: number;
  blur: number;                                   // Figma "radius"
  spread?: number;
}
```

Maps to Figma `DropShadowEffect` / `InnerShadowEffect`. This gives the craft judge's "depth" dimension a real representation on landed nodes.

### 4.4 Per-corner radius

```ts
export type CornerRadius = number | { tl: number; tr: number; br: number; bl: number };
```

Replaces the bare `cornerRadius?: number` usage additively: a `number` sets uniform radius (today's behavior); an object sets `topLeftRadius`/`topRightRadius`/`bottomRightRadius`/`bottomLeftRadius`. `EditSet.cornerRadius` (surgical edits) stays `number` — unchanged.

### 4.5 Schema lockstep

Every field above is mirrored in `schema/uxfactory.schema.json`:
- new `definitions`: `autoLayout`, `sizingSpec`, `effect`, `cornerRadius`, `componentDef`, `componentInstanceNode`, `instanceOverride`;
- `frame.properties` gains `layout`/`sizing`/`effects`/`cornerRadius`/`fill`; `frame.children` `oneOf` gains `componentInstanceNode` **and a `$ref` back to `frame`** (recursion);
- `shapeNode`/`textNode`/`instanceNode` gain `effects` (+ `cornerRadius` for shape as the object form);
- `designSpec.properties` gains `components` (object with `additionalProperties: componentDef`).
All new properties are optional. Each new field must be added to the schema in lockstep with `types.ts` (whatever the schema's current `additionalProperties` posture) — a spec using a field the schema doesn't declare will validate-fail. Keeping the two in step is an explicit plan checklist item, and a test asserts a fully-semantic fixture validates.

## 5. The plugin render extension (`code.ts`)

### 5.1 Mockable seam additions

Extend the two interfaces the tests fake:

```ts
// FigmaApi (the `fig` seam)
createComponent(): EditableNode;                  // local component master

// EditableNode — auto-layout + effects props (Figma names)
layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
itemSpacing?: number;
paddingLeft?: number; paddingRight?: number; paddingTop?: number; paddingBottom?: number;
primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
counterAxisAlignItems?: "MIN" | "CENTER" | "MAX";
layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
effects?: unknown[];
topLeftRadius?: number; topRightRadius?: number; bottomRightRadius?: number; bottomLeftRadius?: number;
createInstance(): EditableNode;                   // on a component master node
```

### 5.2 Recursive rendering

Today `renderChild` builds a leaf and `appendChild`s it. SP3a introduces a recursive path so a `Frame`/`ComponentDef` child is created as a Figma frame, has its layout/effects applied, and its children rendered into it — then that frame is `appendChild`ed to the parent. `renderChild` dispatches on `kind`: `"frame"` → `renderContainer(child, parent)` (recurse); `"component-instance"` → instantiate (§5.4); existing kinds (`text`/`sticky`/`instance`/shape) unchanged. `renderSpec`'s top-level frame loop delegates to the same `renderContainer` so top-level and nested frames share one code path.

### 5.3 Auto-layout application

After a frame node is created and its children appended, if the source frame has `layout`: set `layoutMode` (`horizontal`→`HORIZONTAL`, `vertical`→`VERTICAL`), `itemSpacing = gap`, the four `padding*` from `padding` (number → all four; object → per side), `primaryAxisAlignItems`/`counterAxisAlignItems` from `primaryAlign`/`counterAlign` (`start`→`MIN`, `center`→`CENTER`, `end`→`MAX`, `space-between`→`SPACE_BETWEEN`), and `layoutSizing*` from `sizing`. **Order matters:** children are appended *before* sizing is set (`FILL`/`HUG` require a parent auto-layout + existing children). Frames without `layout` keep absolute positioning.

### 5.4 Components

Before the frame loop, `renderSpec` builds a component registry: for each `[id, def]` in `spec.components`, `const master = fig.createComponent()`, render the def (auto-layout + children) into it via `renderContainer`, and store `id → master`. Masters render off the visible flow (e.g. a dedicated on-canvas "Components" strip or negative-X offset — a plan detail; Figma requires masters to exist on the canvas). Then a `component-instance` child does `master.createInstance()`, positions/resizes it, and applies `overrides` by walking the instance's descendants and matching `name` → set `characters`/`fills`/`visible`. A missing `component` id or a failed instantiate is **skipped with a note** (mirroring the existing `instance` import-failure path — `onSkip` → `editDiffs`), never aborting the render.

### 5.5 Effects & per-corner radius

`effects` → `node.effects = effects.map(toFigmaEffect)` (drop/inner shadow with 0..1 color+opacity, `offset {x,y}`, `radius = blur`, `spread`). `cornerRadius` as a number → `node.cornerRadius` (today); as an object → the four `*Radius` props.

### 5.6 Reporting

`toReportNode` already reports id/name/type/geometry/fill for each created node; nested/component nodes are reported the same way as they're created (no new report fields required for v1). The round-trip report stays best-effort.

## 6. Data flow

```
hand-written semantic DesignSpec (test fixture)
  → validate()            [schema accepts new optional fields]
  → planRender()          [carries layout / components / nested children / effects into the plan]
  → renderSpec()          [build components → render frames recursively → apply auto-layout/effects]
  → fake fig (in tests)   [records createComponent / layoutMode / itemSpacing / createInstance / effects calls]
  → real figma (in Figma) [auto-layout frames, component instances, shadows]
```

## 7. Error handling

- **Invalid structure** (bad enum, missing `component-instance.component`, malformed `layout`) → Ajv validation fails → `renderSpec` posts `render-error` (today's behavior), nothing partially rendered.
- **Valid spec, unresolvable component reference or instantiate failure** → skip that instance with a recorded note (`editDiffs`), continue — one bad instance never aborts the batch. Same contract as the existing published-`instance` skip.
- **Auto-layout on an empty frame** → set `layoutMode` with no children (valid Figma; renders an empty auto-layout frame).

## 8. Testing

**`packages/uxfactory-spec` (validation):**
- New optional fields accepted: a `DesignSpec` with a `layout` frame, nested frame child, `components` + `component-instance`, `effects`, and object `cornerRadius` validates.
- Bad values rejected: `layout.mode: "diagonal"`, `sizing.horizontal: "stretch"`, `component-instance` missing `component`, unknown top-level key → `valid: false` with a pointer.
- Backward-compat: every existing spec fixture still validates unchanged.

**`packages/uxfactory-plugin` (render, via fake `fig`):**
- **Auto-layout:** a vertical `layout` frame with `gap`/`padding`/alignment → the fake node records `layoutMode:"VERTICAL"`, `itemSpacing`, `padding*`, `primaryAxisAlignItems`, and children appended *before* `layoutSizing*`.
- **Nesting:** a frame containing a frame → two `createFrame` calls, inner appended to outer, outer to page.
- **Components:** one `components` entry + two `component-instance`s → one `createComponent`, two `createInstance`; overrides applied (a descendant's `characters`/`fill`/`visible` set on each instance independently).
- **Effects / per-corner radius:** a shape with a drop-shadow + object `cornerRadius` → `effects` set and the four `*Radius` props set.
- **Backward-compat:** an existing flat spec fixture produces the same `fig` calls as before (no `layoutMode`/`createComponent`/`effects` touched).

Run: `pnpm --filter @uxfactory/spec test` and `pnpm --filter @uxfactory/plugin test`; `pnpm -r build` (typecheck) green.

## 9. File structure (what changes)

- **Modify** `packages/uxfactory-spec/src/types.ts` — the new interfaces + optional fields (§4).
- **Modify** `packages/uxfactory-spec/schema/uxfactory.schema.json` — lockstep definitions + refs (§4.5).
- **Modify** `packages/uxfactory-spec/test/*` — validation tests (§8).
- **Modify** `packages/uxfactory-plugin/src/code.ts` — seam additions + recursive/auto-layout/component/effect rendering (§5).
- **Modify** `packages/uxfactory-plugin/test/*` — render tests + fake-`fig` extension (§8).
- No new files required, though the plan may split a `render-semantic.ts` helper out of `code.ts` if that file grows unwieldy (a plan-time call, following the existing single-file plugin convention unless it becomes a problem).

## 10. Locked decisions (resolving open questions)

- **Components ship in SP3a** (not deferred). The target must render components for the extractor (SP3c) to have something to emit; a target that can't represent components isn't the target.
- **Per-corner radius is in** (cheap, additive, common in real UI). `EditSet.cornerRadius` stays `number`.
- **Override alphabet is bounded to `characters`/`fill`/`visible`** per named descendant — real enough for instance variation, far short of a component-property system (deferred).
- **Effects limited to drop/inner shadow** in v1; blur/gradient/image deferred.
- **Absolute-positioned children inside an auto-layout frame** are out of v1 (a frame is either auto-layout or absolute, not mixed).

## 11. What SP3b/SP3c build on this

SP3b (the DOM→semantic extractor) targets exactly this vocabulary: computed flex/grid/flow → `AutoLayout`; DOM container nesting → nested `Frame`s; computed box/border/radius/shadow → `fill`/`stroke`/`CornerRadius`/`Effect`. SP3c detects repeated subtrees → `ComponentDef` + `component-instance` with per-instance `overrides`, then wires extraction into the loop and lands via the existing publish→bridge→`renderSpec` path. SP3a makes all of that renderable and verifiable in isolation first.

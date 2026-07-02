# SP3a — Semantic DesignSpec + Plugin Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `DesignSpec` interchange and the plugin's renderer to represent and render Figma auto-layout, nested frames, local components (with bounded overrides), and shadow effects — additively, so every existing spec validates and renders byte-identically.

**Architecture:** Two packages only. `@uxfactory/spec` gains optional fields on its TS model (`types.ts`) and JSON Schema (`schema/uxfactory.schema.json`) in lockstep. `@uxfactory/plugin` extends its pure `planner.ts` (spec → `RenderPlan`) and its `code.ts` renderer (RenderPlan → Figma nodes via the mockable `fig` seam). The engine (`uxfactory-cli`), the worker, and the skills are untouched.

**Tech Stack:** TypeScript (ESM / NodeNick `.js` specifiers, `verbatimModuleSyntax`), Ajv (draft-07 JSON Schema), Vitest, pnpm workspaces.

## Global Constraints

- **Scope:** primarily `@uxfactory/spec` and `@uxfactory/plugin`. **Engine-consumer exception (approved boundary decision):** `FrameChild` is a *shared* type, so the engine's approximate SVG renderer `packages/uxfactory-cli/src/render/svg.ts` compiles against it and MUST be updated in lockstep whenever a new `FrameChild` member is added. Per the user's decision, `svg.ts` must **render** the new nested/semantic children — recurse into nested `Frame`s (Task 1) and draw `component-instance`s as approximate boxes (Task 2), NOT skip them — while staying deterministic/offline/LLM-free and byte-identical for existing (non-nested) specs (guarded by `packages/uxfactory-cli/test/svg.test.ts`). Do NOT touch anything else in `packages/uxfactory-cli`, `clients/*`, or `skill/*`.
- **Additive & backward-compatible:** every new field is OPTIONAL. Existing specs must validate and render identically. Every schema definition uses `"additionalProperties": false`, so **every new field must be added to the schema explicitly** or a spec using it validate-fails — keep `types.ts` and `uxfactory.schema.json` in lockstep.
- **Friendly values stay in the model and plan; Figma-enum mapping happens only in `code.ts`** (e.g. `"horizontal"` → `"HORIZONTAL"`, `"start"` → `"MIN"`). The planner (`planner.ts`) stays Figma-agnostic.
- **Render is fail-soft for bad references:** a `component-instance` naming a missing component, or a failed instantiate, is skipped with a note in `editDiffs` (mirroring the existing published-`instance` skip) — never aborts the render.
- **Auto-layout sizing (`layoutSizing*`) is set AFTER children are appended** (Figma requires the parent auto-layout + existing children first).
- **A frame is either auto-layout or absolute, never mixed.** No `layoutWrap`, gradient/image fills, blur effects, or component variants/props in v1.
- **Bounded override alphabet:** `characters`, `fill`, `visible` only.
- **Effects:** `drop-shadow` and `inner-shadow` only.
- **`CornerRadius`** is `number | { tl, tr, br, bl }`. `EditSet.cornerRadius` stays `number` — do NOT change it.
- Commits: work on `main` (no feature branch); stage explicit paths only (never `git add -A`); every commit ends with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Verification commands: `pnpm --filter @uxfactory/spec test`, `pnpm --filter @uxfactory/plugin test`, and `pnpm -r build`. To run one plugin test file: `pnpm --filter @uxfactory/plugin exec vitest run test/<file>`.
- **Typecheck gates (IMPORTANT):** `pnpm -r build` typechecks `@uxfactory/spec`, `@uxfactory/cli`, `@uxfactory/gate`, `@uxfactory/bridge` (all `tsc`) but **NOT `@uxfactory/plugin`** — the plugin's `build` is esbuild (no typecheck) and vitest doesn't typecheck either. The plugin's real typecheck is the separate `pnpm --filter @uxfactory/plugin typecheck` (`tsc -p tsconfig.typecheck.json`). Because the shared spec-type widenings (Tasks 1–3) break the plugin's type-consumers (`planner.ts`, `code.ts`) before the planner (Task 4) and render (Task 5) repair them, **the plugin typecheck is expected RED from Task 1 through Task 4 — do not chase it during those tasks.** It MUST be restored GREEN at **Task 5** and kept green through Tasks 6–8. Spec/engine tasks (1–3) gate on `pnpm -r build` + package tests; render tasks (5–8) additionally gate on `pnpm --filter @uxfactory/plugin typecheck`.

## File map

- `packages/uxfactory-spec/src/types.ts` — new optional interfaces + fields (Tasks 1–3).
- `packages/uxfactory-spec/schema/uxfactory.schema.json` — lockstep schema definitions (Tasks 1–3).
- `packages/uxfactory-spec/test/cases.ts` — new valid/invalid validation fixtures (Tasks 1–3).
- `packages/uxfactory-plugin/src/planner.ts` — plan model + `planRender` extension (Task 4).
- `packages/uxfactory-plugin/test/planner.test.ts` — plan tests (Task 4).
- `packages/uxfactory-plugin/src/code.ts` — `EditableNode`/`FigmaApi` seam + recursive/auto-layout/component/effect rendering (Tasks 5–7).
- `packages/uxfactory-plugin/test/figma-mock.ts` — fake `fig` extensions (Tasks 5–7).
- `packages/uxfactory-plugin/test/code.test.ts` — render tests + backward-compat (Tasks 5–8).

---

## Task 1: Spec model — auto-layout, sizing, frame fill, nested frames

**Files:**
- Modify: `packages/uxfactory-spec/src/types.ts`
- Modify: `packages/uxfactory-spec/schema/uxfactory.schema.json`
- Test: `packages/uxfactory-spec/test/cases.ts`

**Interfaces:**
- Produces: `AutoLayout`, `SizingSpec`, `Padding`, `Align`, `PrimaryAlign`, `Sizing` types; `Frame` gains optional `layout`, `sizing`, `fill`; `FrameChild` union gains `Frame` (recursion). Schema gains `autoLayout`, `sizingSpec`, `padding` definitions and `frame` gains those properties + a self-`$ref` in `children`.

**Engine consumer (approved boundary decision):** adding `Frame` to `FrameChild` breaks `packages/uxfactory-cli/src/render/svg.ts` at compile time. Update it to **recurse into nested frames**, not skip them: replace the `normalize` frame loop with a recursive `pushFrame(frame, ox, oy, out)` that pushes the frame's box (absolute origin `ox+frame.x`, `oy+frame.y`) then, per child, calls `leaf(child, ax, ay)` when `"type" in child` else `pushFrame(child, ax, ay, out)` (nested `Frame`). Top-level frames call `pushFrame(frame, 0, 0, out)` — byte-identical to today for non-nested specs. Optionally thread `frame.fill` onto the frame `Drawable` (`fill?: string`, `drawDrawable` uses `d.fill ?? FRAME_FILL`). Add a `specToSvg` test in `packages/uxfactory-cli/test/svg.test.ts` asserting a nested frame renders (inner frame rect + its child), and that a non-nested spec is unchanged. Do NOT alter any other engine behavior.

- [ ] **Step 1: Write the failing validation fixtures**

In `packages/uxfactory-spec/test/cases.ts`, append to the `cases` array:

```ts
  {
    name: "frame with vertical auto-layout + sizing + fill",
    valid: true,
    input: {
      frames: [
        {
          name: "col", x: 0, y: 0, width: 320, height: 480, fill: "#FFFFFF",
          layout: { mode: "vertical", gap: 16, padding: 24, primaryAlign: "start", counterAlign: "center" },
          sizing: { horizontal: "fill", vertical: "hug" },
          children: [{ type: "text", name: "t", x: 0, y: 0, width: 100, height: 20, characters: "Hi" }],
        },
      ],
    },
  },
  {
    name: "frame with object padding + nested frame child",
    valid: true,
    input: {
      frames: [
        {
          name: "outer", x: 0, y: 0, width: 400, height: 400,
          layout: { mode: "horizontal", padding: { top: 8, right: 8, bottom: 8, left: 8 } },
          children: [
            { name: "inner", x: 0, y: 0, width: 100, height: 100,
              layout: { mode: "vertical", gap: 4 }, children: [] },
          ],
        },
      ],
    },
  },
  {
    name: "invalid auto-layout mode is rejected",
    valid: false,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10, layout: { mode: "diagonal" } }],
    },
  },
  {
    name: "invalid sizing value is rejected",
    valid: false,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10, sizing: { horizontal: "stretch" } }],
    },
  },
```

- [ ] **Step 2: Run the tests to verify the new cases fail**

Run: `pnpm --filter @uxfactory/spec test`
Expected: the two `valid: true` cases FAIL (`layout`/`fill`/nested frame rejected because the schema doesn't declare them yet); the two `valid: false` cases already pass.

- [ ] **Step 3: Add the TS types**

In `packages/uxfactory-spec/src/types.ts`, after the `Box` interface add:

```ts
/** Auto-layout alignment on either axis. */
export type Align = "start" | "center" | "end";
/** Main-axis distribution (adds space-between to Align). */
export type PrimaryAlign = Align | "space-between";
/** Auto-layout child sizing on one axis. */
export type Sizing = "fixed" | "hug" | "fill";

/** Explicit four-side padding for an auto-layout frame. */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Figma auto-layout on a frame. Absent ⇒ children are absolutely positioned. */
export interface AutoLayout {
  mode: "horizontal" | "vertical";
  gap?: number;
  padding?: number | Padding;
  primaryAlign?: PrimaryAlign;
  counterAlign?: Align;
}

/** Per-axis auto-layout sizing (FIXED | HUG | FILL). */
export interface SizingSpec {
  horizontal?: Sizing;
  vertical?: Sizing;
}
```

Then modify the `Frame` interface and the `FrameChild` union:

```ts
/** Children allowed inside a Figma frame. */
export type FrameChild = ShapeNode | TextNode | InstanceNode | Frame;

/** A Figma frame containing children. */
export interface Frame extends Box {
  name: string;
  layout?: AutoLayout;
  sizing?: SizingSpec;
  fill?: HexColor;
  children?: FrameChild[];
}
```

(The `Frame` in `FrameChild` is a forward self-reference — legal in TS because interfaces hoist.)

- [ ] **Step 4: Add the schema definitions in lockstep**

In `packages/uxfactory-spec/schema/uxfactory.schema.json`, add these three entries to `definitions` (place them just before `"frame"`):

```json
    "padding": {
      "type": "object",
      "required": ["top", "right", "bottom", "left"],
      "additionalProperties": false,
      "properties": {
        "top": { "type": "number" },
        "right": { "type": "number" },
        "bottom": { "type": "number" },
        "left": { "type": "number" }
      }
    },
    "autoLayout": {
      "type": "object",
      "required": ["mode"],
      "additionalProperties": false,
      "properties": {
        "mode": { "enum": ["horizontal", "vertical"] },
        "gap": { "type": "number", "minimum": 0 },
        "padding": {
          "oneOf": [{ "type": "number", "minimum": 0 }, { "$ref": "#/definitions/padding" }]
        },
        "primaryAlign": { "enum": ["start", "center", "end", "space-between"] },
        "counterAlign": { "enum": ["start", "center", "end"] }
      }
    },
    "sizingSpec": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "horizontal": { "enum": ["fixed", "hug", "fill"] },
        "vertical": { "enum": ["fixed", "hug", "fill"] }
      }
    },
```

Then in the existing `"frame"` definition, add three properties and a self-`$ref` in `children`:

```json
    "frame": {
      "type": "object",
      "required": ["name", "x", "y", "width", "height"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number" },
        "height": { "type": "number" },
        "layout": { "$ref": "#/definitions/autoLayout" },
        "sizing": { "$ref": "#/definitions/sizingSpec" },
        "fill": { "$ref": "#/definitions/hexColor" },
        "children": {
          "type": "array",
          "items": {
            "oneOf": [
              { "$ref": "#/definitions/shapeNode" },
              { "$ref": "#/definitions/textNode" },
              { "$ref": "#/definitions/instanceNode" },
              { "$ref": "#/definitions/frame" }
            ]
          }
        }
      }
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @uxfactory/spec test`
Expected: PASS (all four new cases + every pre-existing case).

- [ ] **Step 6: Typecheck**

Run: `pnpm -r build`
Expected: no TS errors.

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-spec/src/types.ts packages/uxfactory-spec/schema/uxfactory.schema.json packages/uxfactory-spec/test/cases.ts
git commit -m "feat(spec): auto-layout, sizing, frame fill, nested frames (SP3a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Spec model — local components + instances + overrides

**Files:**
- Modify: `packages/uxfactory-spec/src/types.ts`
- Modify: `packages/uxfactory-spec/schema/uxfactory.schema.json`
- Test: `packages/uxfactory-spec/test/cases.ts`

**Interfaces:**
- Consumes: `AutoLayout`, `SizingSpec`, `FrameChild` (Task 1).
- Produces: `ComponentDef`, `ComponentInstanceNode`, `InstanceOverride` types; `FrameChild` gains `ComponentInstanceNode`; `DesignSpec` gains `components?: Record<string, ComponentDef>`. Schema gains `componentDef`, `componentInstanceNode`, `instanceOverride` definitions.

**Engine consumer (approved boundary decision):** adding `ComponentInstanceNode` (`type:"component-instance"`) to `FrameChild` makes `leaf()` in `packages/uxfactory-cli/src/render/svg.ts` non-exhaustive. Add `ComponentInstanceNode` to that file's `LeafChild` type and a `case "component-instance"` to `leaf()`'s switch that returns an approximate box drawable (a dashed rect labelled with the `component` id, sized from `width ?? INSTANCE_W` / `height ?? INSTANCE_H` — reuse the existing `instance` styling). Add a `specToSvg` test asserting a `component-instance` child renders an approximate box. Stay deterministic; do NOT alter other engine behavior.

- [ ] **Step 1: Write the failing validation fixtures**

Append to `cases` in `packages/uxfactory-spec/test/cases.ts`:

```ts
  {
    name: "design spec with local component + two instances + overrides",
    valid: true,
    input: {
      components: {
        button: {
          name: "Button", width: 120, height: 40,
          layout: { mode: "horizontal", gap: 8, padding: 12 },
          children: [{ type: "text", name: "label", x: 0, y: 0, width: 96, height: 16, characters: "OK" }],
        },
      },
      frames: [
        {
          name: "screen", x: 0, y: 0, width: 400, height: 300,
          children: [
            { type: "component-instance", name: "primary", component: "button", x: 20, y: 20,
              overrides: { label: { characters: "Pay now", fill: "#FFFFFF" } } },
            { type: "component-instance", name: "secondary", component: "button", x: 20, y: 80,
              overrides: { label: { characters: "Cancel", visible: true } } },
          ],
        },
      ],
    },
  },
  {
    name: "component-instance missing component id is rejected",
    valid: false,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10,
        children: [{ type: "component-instance", name: "x", x: 0, y: 0 }] }],
    },
  },
  {
    name: "instance override with an unknown key is rejected",
    valid: false,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10,
        children: [{ type: "component-instance", name: "x", component: "b", x: 0, y: 0,
          overrides: { label: { color: "#fff" } } }] }],
    },
  },
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `pnpm --filter @uxfactory/spec test`
Expected: the `valid: true` case FAILS (`components` / `component-instance` unknown to the schema); the two `valid: false` cases pass already.

- [ ] **Step 3: Add the TS types**

In `packages/uxfactory-spec/src/types.ts`, after the `InstanceNode` interface add:

```ts
/** Bounded per-descendant override alphabet for a component instance (v1). */
export interface InstanceOverride {
  characters?: string;
  fill?: HexColor;
  visible?: boolean;
}

/** An instance of a local ComponentDef, resolved by `component` id. */
export interface ComponentInstanceNode {
  type: "component-instance";
  name: string;
  component: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  overrides?: Record<string, InstanceOverride>;
}

/** A reusable master: a frame-like node tree turned into a Figma component. */
export interface ComponentDef {
  name: string;
  width: number;
  height: number;
  layout?: AutoLayout;
  sizing?: SizingSpec;
  fill?: HexColor;
  children?: FrameChild[];
}
```

Update the `FrameChild` union (from Task 1) to include the instance node:

```ts
export type FrameChild = ShapeNode | TextNode | InstanceNode | ComponentInstanceNode | Frame;
```

Update the `DesignSpec` interface to add `components`:

```ts
export interface DesignSpec {
  editor?: "figma";
  page?: string;
  components?: Record<string, ComponentDef>;
  frames: Frame[];
  connectors?: Connector[];
  edits?: Edit[];
}
```

- [ ] **Step 4: Add the schema definitions in lockstep**

In `uxfactory.schema.json`, add to `definitions` (place before `"frame"`):

```json
    "instanceOverride": {
      "type": "object",
      "additionalProperties": false,
      "minProperties": 1,
      "properties": {
        "characters": { "type": "string" },
        "fill": { "$ref": "#/definitions/hexColor" },
        "visible": { "type": "boolean" }
      }
    },
    "componentInstanceNode": {
      "type": "object",
      "required": ["type", "name", "component", "x", "y"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "component-instance" },
        "name": { "type": "string" },
        "component": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number" },
        "height": { "type": "number" },
        "rotation": { "type": "number" },
        "opacity": { "type": "number", "minimum": 0, "maximum": 1 },
        "overrides": {
          "type": "object",
          "additionalProperties": { "$ref": "#/definitions/instanceOverride" }
        }
      }
    },
    "componentDef": {
      "type": "object",
      "required": ["name", "width", "height"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string" },
        "width": { "type": "number" },
        "height": { "type": "number" },
        "layout": { "$ref": "#/definitions/autoLayout" },
        "sizing": { "$ref": "#/definitions/sizingSpec" },
        "fill": { "$ref": "#/definitions/hexColor" },
        "children": {
          "type": "array",
          "items": {
            "oneOf": [
              { "$ref": "#/definitions/shapeNode" },
              { "$ref": "#/definitions/textNode" },
              { "$ref": "#/definitions/instanceNode" },
              { "$ref": "#/definitions/componentInstanceNode" },
              { "$ref": "#/definitions/frame" }
            ]
          }
        }
      }
    },
```

Add `componentInstanceNode` to the `"frame"` definition's `children` `oneOf` (it becomes: shapeNode, textNode, instanceNode, componentInstanceNode, frame):

```json
          "items": {
            "oneOf": [
              { "$ref": "#/definitions/shapeNode" },
              { "$ref": "#/definitions/textNode" },
              { "$ref": "#/definitions/instanceNode" },
              { "$ref": "#/definitions/componentInstanceNode" },
              { "$ref": "#/definitions/frame" }
            ]
          }
```

Add `components` to the `"designSpec"` definition's `properties`:

```json
        "components": {
          "type": "object",
          "additionalProperties": { "$ref": "#/definitions/componentDef" }
        },
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @uxfactory/spec test`
Expected: PASS (all three new cases + all prior).

- [ ] **Step 6: Typecheck**

Run: `pnpm -r build`
Expected: no TS errors.

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-spec/src/types.ts packages/uxfactory-spec/schema/uxfactory.schema.json packages/uxfactory-spec/test/cases.ts
git commit -m "feat(spec): local components, instances, bounded overrides (SP3a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Spec model — effects + per-corner radius

**Files:**
- Modify: `packages/uxfactory-spec/src/types.ts`
- Modify: `packages/uxfactory-spec/schema/uxfactory.schema.json`
- Test: `packages/uxfactory-spec/test/cases.ts`

**Interfaces:**
- Produces: `Effect`, `CornerRadius` types; `effects?: Effect[]` added to `ShapeNode`, `TextNode`, `InstanceNode`, `Frame`, `ComponentDef`; `ShapeNode.cornerRadius`/`Frame.cornerRadius`/`ComponentDef.cornerRadius` become `CornerRadius`. Schema gains `effect`, `effectsArray`, `cornerRadius` definitions. `EditSet.cornerRadius` is unchanged (`number`).

**Engine consumer (approved boundary decision):** widening `ShapeNode.cornerRadius` from `number` to `CornerRadius` breaks `packages/uxfactory-cli/src/render/svg.ts` — `leaf()`'s shape case does `cornerRadius: child.cornerRadius` into a `Drawable` whose `cornerRadius?` is `number`. Fix it by **flattening the object form to a single number** for the approximate `rx`: change that line to `cornerRadius: typeof child.cornerRadius === "number" ? child.cornerRadius : child.cornerRadius?.tl` (use the top-left radius as the approximate uniform radius). Effects are NOT read by `svg.ts` (it ignores unknown fields), so they need no engine change. This is the only Task 3 engine ripple; `svg.ts` output stays byte-identical for existing numeric-radius specs. The plugin type-consumers (`planner.ts`/`code.ts`) are NOT part of the `pnpm -r build` gate and are repaired in Tasks 4–5 — the plugin typecheck stays red here (see Global Constraints); do not touch them in Task 3.

- [ ] **Step 1: Write the failing validation fixtures**

Append to `cases` in `packages/uxfactory-spec/test/cases.ts`:

```ts
  {
    name: "shape with drop-shadow effect + per-corner radius",
    valid: true,
    input: {
      frames: [
        {
          name: "f", x: 0, y: 0, width: 200, height: 200,
          effects: [{ type: "drop-shadow", color: "#000000", opacity: 0.2, x: 0, y: 4, blur: 12, spread: 0 }],
          children: [
            { type: "shape", name: "card", x: 0, y: 0, width: 100, height: 60,
              cornerRadius: { tl: 8, tr: 8, br: 0, bl: 0 },
              effects: [{ type: "inner-shadow", color: "#101828", x: 0, y: 1, blur: 2 }] },
          ],
        },
      ],
    },
  },
  {
    name: "numeric cornerRadius still valid (backward-compat)",
    valid: true,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10,
        children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10, height: 10, cornerRadius: 4 }] }],
    },
  },
  {
    name: "invalid effect type is rejected",
    valid: false,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10,
        effects: [{ type: "glow", color: "#000000", x: 0, y: 0, blur: 1 }] }],
    },
  },
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `pnpm --filter @uxfactory/spec test`
Expected: the two `valid: true` cases FAIL (`effects` and object `cornerRadius` not yet declared); the numeric-cornerRadius case may already pass, the invalid-effect case already passes.

- [ ] **Step 3: Add the TS types**

In `packages/uxfactory-spec/src/types.ts`, after the `HexColor` type add:

```ts
/** A drop or inner shadow effect. */
export interface Effect {
  type: "drop-shadow" | "inner-shadow";
  color: HexColor;
  opacity?: number;
  x: number;
  y: number;
  blur: number;
  spread?: number;
}

/** Uniform radius (number) or per-corner radii. */
export type CornerRadius = number | { tl: number; tr: number; br: number; bl: number };
```

Modify `ShapeNode` — widen `cornerRadius`, add `effects`:

```ts
export interface ShapeNode extends Box {
  type: "shape";
  name: string;
  fill?: HexColor;
  stroke?: HexColor;
  strokeWidth?: number;
  cornerRadius?: CornerRadius;
  rotation?: number;
  opacity?: number;
  characters?: string;
  effects?: Effect[];
}
```

Add `effects?: Effect[]` to `TextNode` and `InstanceNode` (append the field to each interface). Add `effects?: Effect[]` and `cornerRadius?: CornerRadius` to `Frame` (from Task 1) and `ComponentDef` (from Task 2):

```ts
// in Frame:
  effects?: Effect[];
  cornerRadius?: CornerRadius;
// in ComponentDef:
  effects?: Effect[];
  cornerRadius?: CornerRadius;
```

Leave `EditSet.cornerRadius` as `number` — do not touch it.

- [ ] **Step 4: Add the schema definitions in lockstep**

In `uxfactory.schema.json`, add to `definitions` (place before `"shapeNode"`):

```json
    "effect": {
      "type": "object",
      "required": ["type", "color", "x", "y", "blur"],
      "additionalProperties": false,
      "properties": {
        "type": { "enum": ["drop-shadow", "inner-shadow"] },
        "color": { "$ref": "#/definitions/hexColor" },
        "opacity": { "type": "number", "minimum": 0, "maximum": 1 },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "blur": { "type": "number", "minimum": 0 },
        "spread": { "type": "number" }
      }
    },
    "effectsArray": { "type": "array", "items": { "$ref": "#/definitions/effect" } },
    "cornerRadius": {
      "oneOf": [
        { "type": "number", "minimum": 0 },
        {
          "type": "object",
          "required": ["tl", "tr", "br", "bl"],
          "additionalProperties": false,
          "properties": {
            "tl": { "type": "number", "minimum": 0 },
            "tr": { "type": "number", "minimum": 0 },
            "br": { "type": "number", "minimum": 0 },
            "bl": { "type": "number", "minimum": 0 }
          }
        }
      ]
    },
```

Then:
- In `"shapeNode"`, replace `"cornerRadius": { "type": "number", "minimum": 0 }` with `"cornerRadius": { "$ref": "#/definitions/cornerRadius" }`, and add `"effects": { "$ref": "#/definitions/effectsArray" }`.
- In `"textNode"` and `"instanceNode"`, add `"effects": { "$ref": "#/definitions/effectsArray" }`.
- In `"frame"` and `"componentDef"`, add `"effects": { "$ref": "#/definitions/effectsArray" }` and `"cornerRadius": { "$ref": "#/definitions/cornerRadius" }`.
- Do NOT change `"editSet"`.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @uxfactory/spec test`
Expected: PASS (all three new cases + all prior).

- [ ] **Step 6: Typecheck**

Run: `pnpm -r build`
Expected: no TS errors.

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-spec/src/types.ts packages/uxfactory-spec/schema/uxfactory.schema.json packages/uxfactory-spec/test/cases.ts
git commit -m "feat(spec): shadow effects + per-corner radius (SP3a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Planner — carry semantic fields into the RenderPlan

**Files:**
- Modify: `packages/uxfactory-plugin/src/planner.ts`
- Test: `packages/uxfactory-plugin/test/planner.test.ts`

**Interfaces:**
- Consumes: `AutoLayout`, `SizingSpec`, `Effect`, `CornerRadius`, `InstanceOverride`, `ComponentDef`, `ComponentInstanceNode`, `Frame`, `FrameChild` (`@uxfactory/spec`, Tasks 1–3).
- Produces: `PlannedChild` gains `kind` values `"frame"`/`"component-instance"` and fields `layout`, `sizing`, `effects`, `children`, `component`, `overrides`, and a widened `cornerRadius`. `PlannedFrame` gains `layout`/`sizing`/`fill`/`effects`/`cornerRadius`. New `PlannedComponent`. `RenderPlan` gains `components?: Record<string, PlannedComponent>`. `planRender` maps all of it. (Values stay friendly — no Figma enums here.)

- [ ] **Step 1: Write the failing planner tests**

Append to `packages/uxfactory-plugin/test/planner.test.ts` (inside the top-level `describe`, after the existing tests):

```ts
  it("carries auto-layout, fill, and nested frames into the plan", () => {
    const spec: DesignSpec = {
      frames: [
        {
          name: "col", x: 0, y: 0, width: 320, height: 480, fill: "#FFFFFF",
          layout: { mode: "vertical", gap: 16, padding: 24, primaryAlign: "start" },
          sizing: { horizontal: "fill" },
          children: [
            { name: "inner", x: 0, y: 0, width: 100, height: 100, layout: { mode: "horizontal" }, children: [] },
          ],
        },
      ],
    };
    const frame = planRender(spec).frames[0];
    expect(frame.fill).toBe("#FFFFFF");
    expect(frame.layout).toEqual({ mode: "vertical", gap: 16, padding: 24, primaryAlign: "start" });
    expect(frame.sizing).toEqual({ horizontal: "fill" });
    expect(frame.children[0]).toMatchObject({ kind: "frame", name: "inner", layout: { mode: "horizontal" }, children: [] });
  });

  it("plans components and component-instances with overrides", () => {
    const spec: DesignSpec = {
      components: {
        button: { name: "Button", width: 120, height: 40,
          children: [{ type: "text", name: "label", x: 0, y: 0, width: 96, height: 16, characters: "OK" }] },
      },
      frames: [
        { name: "screen", x: 0, y: 0, width: 400, height: 300, children: [
          { type: "component-instance", name: "primary", component: "button", x: 20, y: 20,
            overrides: { label: { characters: "Pay", fill: "#FFFFFF" } } },
        ] },
      ],
    };
    const plan = planRender(spec);
    expect(plan.components?.button).toMatchObject({ name: "Button", width: 120, height: 40 });
    expect(plan.components?.button.children[0]).toMatchObject({ kind: "text", name: "label" });
    const inst = plan.frames[0].children[0];
    expect(inst).toMatchObject({ kind: "component-instance", component: "button", overrides: { label: { characters: "Pay", fill: "#FFFFFF" } } });
  });

  it("carries effects and object corner radius", () => {
    const spec: DesignSpec = {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10, children: [
        { type: "shape", name: "card", x: 0, y: 0, width: 10, height: 10,
          cornerRadius: { tl: 8, tr: 8, br: 0, bl: 0 },
          effects: [{ type: "drop-shadow", color: "#000000", x: 0, y: 4, blur: 12 }] },
      ] }],
    };
    const card = planRender(spec).frames[0].children[0];
    expect(card.cornerRadius).toEqual({ tl: 8, tr: 8, br: 0, bl: 0 });
    expect(card.effects).toEqual([{ type: "drop-shadow", color: "#000000", x: 0, y: 4, blur: 12 }]);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uxfactory/plugin exec vitest run test/planner.test.ts`
Expected: FAIL (the plan doesn't carry `layout`/`components`/nested `children`/`effects` yet).

- [ ] **Step 3: Extend the plan types**

In `packages/uxfactory-plugin/src/planner.ts`, extend the import and the interfaces. Update the top import block to add the new spec types:

```ts
import type {
  Spec,
  Editor,
  Frame,
  Section,
  Connector,
  Edit,
  FrameChild,
  SectionChild,
  AutoLayout,
  SizingSpec,
  Effect,
  CornerRadius,
  InstanceOverride,
  ComponentDef,
  ComponentInstanceNode,
} from "@uxfactory/spec";
```

Replace the `PlannedChild` interface with:

```ts
/** A normalized node inside a planned frame, section, or component. */
export interface PlannedChild {
  kind: "shape" | "text" | "instance" | "sticky" | "frame" | "component-instance";
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: CornerRadius;
  rotation?: number;
  opacity?: number;
  characters?: string;
  asset?: string;
  effects?: Effect[];
  // kind === "frame":
  layout?: AutoLayout;
  sizing?: SizingSpec;
  children?: PlannedChild[];
  // kind === "component-instance":
  component?: string;
  overrides?: Record<string, InstanceOverride>;
}
```

Add `layout`/`sizing`/`fill`/`effects`/`cornerRadius` to `PlannedFrame`, and add a `PlannedComponent` interface + `components` on `RenderPlan`:

```ts
export interface PlannedFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layout?: AutoLayout;
  sizing?: SizingSpec;
  fill?: string;
  effects?: Effect[];
  cornerRadius?: CornerRadius;
  children: PlannedChild[];
}

/** A planned local component master (no canvas position — placed by the renderer). */
export interface PlannedComponent {
  name: string;
  width: number;
  height: number;
  layout?: AutoLayout;
  sizing?: SizingSpec;
  fill?: string;
  effects?: Effect[];
  cornerRadius?: CornerRadius;
  children: PlannedChild[];
}
```

In `RenderPlan`, add the optional `components` field:

```ts
export interface RenderPlan {
  editor: Editor;
  page: string;
  components?: Record<string, PlannedComponent>;
  frames: PlannedFrame[];
  sections: PlannedSection[];
  connectors: PlannedConnector[];
  edits: Edit[];
}
```

- [ ] **Step 4: Extend the mapping functions**

Replace `mapChild` with a version that branches on nested frame (no `type`) and `component-instance`:

```ts
function mapChild(child: FrameChild | SectionChild): PlannedChild {
  // A FrameChild with no `type` discriminant is a nested Frame.
  if (!("type" in child)) {
    const f = child as Frame;
    const out: PlannedChild = {
      kind: "frame",
      name: f.name,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      children: (f.children ?? []).map(mapChild),
    };
    if (f.layout !== undefined) out.layout = f.layout;
    if (f.sizing !== undefined) out.sizing = f.sizing;
    if (f.fill !== undefined) out.fill = f.fill;
    if (f.effects !== undefined) out.effects = f.effects;
    if (f.cornerRadius !== undefined) out.cornerRadius = f.cornerRadius;
    return out;
  }
  if (child.type === "component-instance") {
    const ci = child as ComponentInstanceNode;
    const out: PlannedChild = { kind: "component-instance", name: ci.name, x: ci.x, y: ci.y, component: ci.component };
    if (ci.width !== undefined) out.width = ci.width;
    if (ci.height !== undefined) out.height = ci.height;
    if (ci.rotation !== undefined) out.rotation = ci.rotation;
    if (ci.opacity !== undefined) out.opacity = ci.opacity;
    if (ci.overrides !== undefined) out.overrides = ci.overrides;
    return out;
  }
  const out: PlannedChild = { kind: child.type, name: child.name, x: child.x, y: child.y };
  if ("width" in child && child.width !== undefined) out.width = child.width;
  if ("height" in child && child.height !== undefined) out.height = child.height;
  if ("fill" in child && child.fill !== undefined) out.fill = child.fill;
  if ("stroke" in child && child.stroke !== undefined) out.stroke = child.stroke;
  if ("strokeWidth" in child && child.strokeWidth !== undefined) out.strokeWidth = child.strokeWidth;
  if ("cornerRadius" in child && child.cornerRadius !== undefined) out.cornerRadius = child.cornerRadius;
  if ("rotation" in child && child.rotation !== undefined) out.rotation = child.rotation;
  if ("opacity" in child && child.opacity !== undefined) out.opacity = child.opacity;
  if ("characters" in child && child.characters !== undefined) out.characters = child.characters;
  if ("asset" in child && child.asset !== undefined) out.asset = child.asset;
  if ("effects" in child && child.effects !== undefined) out.effects = child.effects;
  return out;
}
```

Replace `planFrame` and add `planComponent`:

```ts
function planFrame(frame: Frame): PlannedFrame {
  const out: PlannedFrame = {
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    children: (frame.children ?? []).map(mapChild),
  };
  if (frame.layout !== undefined) out.layout = frame.layout;
  if (frame.sizing !== undefined) out.sizing = frame.sizing;
  if (frame.fill !== undefined) out.fill = frame.fill;
  if (frame.effects !== undefined) out.effects = frame.effects;
  if (frame.cornerRadius !== undefined) out.cornerRadius = frame.cornerRadius;
  return out;
}

function planComponent(def: ComponentDef): PlannedComponent {
  const out: PlannedComponent = {
    name: def.name,
    width: def.width,
    height: def.height,
    children: (def.children ?? []).map(mapChild),
  };
  if (def.layout !== undefined) out.layout = def.layout;
  if (def.sizing !== undefined) out.sizing = def.sizing;
  if (def.fill !== undefined) out.fill = def.fill;
  if (def.effects !== undefined) out.effects = def.effects;
  if (def.cornerRadius !== undefined) out.cornerRadius = def.cornerRadius;
  return out;
}
```

In `planRender`, build and attach `components` (keep it absent when the spec has none, to preserve existing plan shape):

```ts
export function planRender(spec: Spec): RenderPlan {
  const editor: Editor = spec.editor ?? "figma";
  const page = ("page" in spec ? spec.page : undefined) ?? "Page 1";
  const frames = "frames" in spec ? spec.frames.map(planFrame) : [];
  const sections = "sections" in spec ? spec.sections.map(planSection) : [];
  const connectors =
    "connectors" in spec && spec.connectors ? spec.connectors.map(planConnector) : [];
  const edits = spec.edits ? spec.edits.map(cloneEdit) : [];
  const plan: RenderPlan = { editor, page, frames, sections, connectors, edits };
  if ("components" in spec && spec.components) {
    plan.components = Object.fromEntries(
      Object.entries(spec.components).map(([id, def]) => [id, planComponent(def)]),
    );
  }
  return plan;
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @uxfactory/plugin exec vitest run test/planner.test.ts`
Expected: PASS (the three new tests + the existing determinism/order tests unchanged).

- [ ] **Step 6: Full plugin suite + typecheck**

Run: `pnpm --filter @uxfactory/plugin test` then `pnpm -r build`
Expected: PASS / no TS errors. (`code.ts` still compiles — it reads only fields it already knew.)

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-plugin/src/planner.ts packages/uxfactory-plugin/test/planner.test.ts
git commit -m "feat(plugin): planner carries auto-layout, components, effects (SP3a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Render — auto-layout + nested frames

**Files:**
- Modify: `packages/uxfactory-plugin/src/code.ts`
- Modify: `packages/uxfactory-plugin/test/figma-mock.ts`
- Test: `packages/uxfactory-plugin/test/code.test.ts`

**Interfaces:**
- Consumes: `PlannedChild`, `PlannedFrame`, `RenderPlan` (Task 4).
- Produces: `EditableNode` gains auto-layout props; a `RenderCtx` type; a `renderContainer(frame, parent, ctx)` used by both the top-level frame loop and the nested-frame child branch; `renderChild` gains a `"frame"` branch and a `ctx` parameter. `FakeNode` gains the same auto-layout props.

- [ ] **Step 1: Write the failing render tests**

Append to `packages/uxfactory-plugin/test/code.test.ts` (inside the `describe("code.ts render", ...)` block):

```ts
  it("applies auto-layout to a frame and nests child frames", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        {
          name: "col", x: 0, y: 0, width: 320, height: 480,
          layout: { mode: "vertical", gap: 16, padding: { top: 24, right: 8, bottom: 24, left: 8 }, primaryAlign: "space-between", counterAlign: "center" },
          sizing: { horizontal: "fill", vertical: "hug" },
          children: [
            { name: "row", x: 0, y: 0, width: 100, height: 40, layout: { mode: "horizontal", gap: 4 }, children: [] },
          ],
        },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j1" });

    const col = fig.currentPage.children.find((n) => n.name === "col")!;
    expect(col.layoutMode).toBe("VERTICAL");
    expect(col.itemSpacing).toBe(16);
    expect(col.paddingTop).toBe(24);
    expect(col.paddingLeft).toBe(8);
    expect(col.primaryAxisAlignItems).toBe("SPACE_BETWEEN");
    expect(col.counterAxisAlignItems).toBe("CENTER");
    expect(col.layoutSizingHorizontal).toBe("FILL");
    expect(col.layoutSizingVertical).toBe("HUG");
    const row = col.children.find((n) => n.name === "row")!;
    expect(row.type).toBe("FRAME");
    expect(row.layoutMode).toBe("HORIZONTAL");
  });

  it("sets layoutSizing only after children are appended", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        { name: "col", x: 0, y: 0, width: 200, height: 200, layout: { mode: "vertical" }, sizing: { horizontal: "fill" },
          children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10, height: 10 }] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j2" });
    const col = fig.currentPage.children.find((n) => n.name === "col")!;
    // sizing recorded the child count present at the moment it was set
    expect(col.__childCountAtSizing).toBe(1);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uxfactory/plugin exec vitest run test/code.test.ts`
Expected: FAIL (`layoutMode` etc. are `undefined`; `__childCountAtSizing` unset).

- [ ] **Step 3: Extend the fake node with auto-layout props**

In `packages/uxfactory-plugin/test/figma-mock.ts`, add fields to `FakeNode` (after `clipsContent`):

```ts
  layoutMode: string | undefined = undefined;
  itemSpacing: number | undefined = undefined;
  paddingTop: number | undefined = undefined;
  paddingRight: number | undefined = undefined;
  paddingBottom: number | undefined = undefined;
  paddingLeft: number | undefined = undefined;
  primaryAxisAlignItems: string | undefined = undefined;
  counterAxisAlignItems: string | undefined = undefined;
  _layoutSizingHorizontal: string | undefined = undefined;
  _layoutSizingVertical: string | undefined = undefined;
  /** Test probe: children length captured when layoutSizingHorizontal was set. */
  __childCountAtSizing: number | undefined = undefined;
  get layoutSizingHorizontal(): string | undefined {
    return this._layoutSizingHorizontal;
  }
  set layoutSizingHorizontal(v: string | undefined) {
    this.__childCountAtSizing = this.children.length;
    this._layoutSizingHorizontal = v;
  }
  get layoutSizingVertical(): string | undefined {
    return this._layoutSizingVertical;
  }
  set layoutSizingVertical(v: string | undefined) {
    this._layoutSizingVertical = v;
  }
```

- [ ] **Step 4: Extend the `EditableNode` interface in `code.ts`**

In `packages/uxfactory-plugin/src/code.ts`, add to the `EditableNode` interface (after `characters`):

```ts
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
```

- [ ] **Step 5: Add auto-layout mapping helpers + `renderContainer`, and thread a `RenderCtx`**

In `code.ts`, add near the other helpers (above `renderChild`) the friendly→Figma mappers and a context type:

```ts
interface RenderCtx {
  byName: Map<string, EditableNode>;
  reportNodes: Map<string, ReportNode>;
  editDiffs: ReportEditDiff[];
}

const PRIMARY_ALIGN: Record<string, string> = {
  start: "MIN", center: "CENTER", end: "MAX", "space-between": "SPACE_BETWEEN",
};
const COUNTER_ALIGN: Record<string, string> = { start: "MIN", center: "CENTER", end: "MAX" };
const SIZING: Record<string, string> = { fixed: "FIXED", hug: "HUG", fill: "FILL" };

function applyAutoLayout(node: EditableNode, layout: PlannedChild["layout"], sizing: PlannedChild["sizing"]): void {
  if (!layout) return;
  node.layoutMode = layout.mode === "vertical" ? "VERTICAL" : "HORIZONTAL";
  if (layout.gap !== undefined) node.itemSpacing = layout.gap;
  if (layout.padding !== undefined) {
    const p = layout.padding;
    const box = typeof p === "number" ? { top: p, right: p, bottom: p, left: p } : p;
    node.paddingTop = box.top;
    node.paddingRight = box.right;
    node.paddingBottom = box.bottom;
    node.paddingLeft = box.left;
  }
  if (layout.primaryAlign !== undefined) node.primaryAxisAlignItems = PRIMARY_ALIGN[layout.primaryAlign];
  if (layout.counterAlign !== undefined) node.counterAxisAlignItems = COUNTER_ALIGN[layout.counterAlign];
  // sizing AFTER children are appended (see renderContainer)
  if (sizing?.horizontal !== undefined) node.layoutSizingHorizontal = SIZING[sizing.horizontal];
  if (sizing?.vertical !== undefined) node.layoutSizingVertical = SIZING[sizing.vertical];
}
```

The existing import `import { planRender, type PlannedChild } from "./planner.js";` already provides `PlannedChild` — no import change is needed (`renderContainer` uses the `PlannedFrameLike` alias below, built from `PlannedChild`).

Declare the `PlannedFrameLike` structural alias near the top of `code.ts` (type aliases hoist within the module, so declaration order relative to `renderContainer` does not matter). It covers both a top-level `PlannedFrame` and a `kind:"frame"` child — both carry `name/x/y/width/height/children` and the optional layout fields:

```ts
type PlannedFrameLike = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  layout?: PlannedChild["layout"];
  sizing?: PlannedChild["sizing"];
  children: PlannedChild[];
};
```

Add `renderContainer` (place above `renderChild`):

```ts
async function renderContainer(
  frame: PlannedFrameLike,
  parent: EditableNode,
  ctx: RenderCtx,
): Promise<EditableNode> {
  const node = fig.createFrame();
  node.name = frame.name;
  node.x = frame.x;
  node.y = frame.y;
  node.resize(frame.width, frame.height);
  if (frame.fill !== undefined) node.fills = solidPaint(frame.fill);
  parent.appendChild(node);
  ctx.byName.set(frame.name, node);
  for (const child of frame.children) {
    const childNode = await renderChild(child, node, ctx);
    if (childNode) {
      ctx.byName.set(child.name, childNode);
      ctx.reportNodes.set(childNode.id, toReportNode(childNode));
    }
  }
  applyAutoLayout(node, frame.layout, frame.sizing);
  return node;
}
```

- [ ] **Step 6: Give `renderChild` a `ctx` param + a `"frame"` branch**

Change the `renderChild` signature and add the frame branch at the top. Replace the current signature/`onSkip` plumbing:

```ts
async function renderChild(
  child: PlannedChild,
  parent: EditableNode,
  ctx: RenderCtx,
): Promise<EditableNode | null> {
  if (child.kind === "frame") {
    return renderContainer(child as PlannedFrameLike, parent, ctx);
  }

  let node: EditableNode;
  if (child.kind === "instance") {
    try {
      const component = await fig.importComponentByKeyAsync(child.asset ?? "");
      node = component.createInstance();
    } catch (err) {
      ctx.editDiffs.push({ name: child.name, diff: `skipped: instance "${child.name}" import failed: ${String(err)}` });
      return null;
    }
  } else if (child.kind === "text") {
    node = fig.createText();
  } else if (child.kind === "sticky") {
    node = fig.createSticky();
  } else {
    node = fig.createRectangle();
  }

  node.name = child.name;
  node.x = child.x;
  node.y = child.y;
  if (child.width !== undefined || child.height !== undefined) {
    node.resize(child.width ?? node.width, child.height ?? node.height);
  }
  if (child.fill !== undefined) node.fills = solidPaint(child.fill);
  if (child.stroke !== undefined) node.strokes = solidPaint(child.stroke);
  if (child.strokeWidth !== undefined) node.strokeWeight = child.strokeWidth;
  if (child.cornerRadius !== undefined && typeof child.cornerRadius === "number") node.cornerRadius = child.cornerRadius;
  if (child.rotation !== undefined) node.rotation = child.rotation;
  if (child.opacity !== undefined) node.opacity = child.opacity;

  if (child.characters !== undefined) {
    if (child.kind === "sticky") {
      if (node.text !== undefined) node.text.characters = child.characters;
    } else if (child.kind === "text") {
      await fig.loadFontAsync(node.fontName ?? { family: "Inter", style: "Regular" });
      node.characters = child.characters;
    } else {
      node.characters = child.characters;
    }
  }

  parent.appendChild(node);
  return node;
}
```

(Note: the object-form `cornerRadius` is handled in Task 7; here we keep the numeric path only. The `component-instance` branch is added in Task 6.)

- [ ] **Step 7: Rewrite `renderSpec`'s frame/section loops to use `ctx` + `renderContainer`**

In `renderSpec`, replace the three local maps + the frame loop + the section loop. Build one `ctx` and drive frames through `renderContainer`:

```ts
    const reportNodes = new Map<string, ReportNode>();
    const byName = new Map<string, EditableNode>();
    const editDiffs: ReportEditDiff[] = [];
    const ctx: RenderCtx = { byName, reportNodes, editDiffs };

    for (const frame of plan.frames) {
      await renderContainer(frame, page as unknown as EditableNode, ctx);
    }

    for (const section of plan.sections) {
      const node = fig.createSection();
      node.name = section.name;
      node.x = section.x;
      node.y = section.y;
      node.resize(section.width, section.height);
      page.appendChild(node);
      byName.set(section.name, node);
      for (const child of section.children) {
        const childNode = await renderChild(child, node, ctx);
        if (childNode) {
          byName.set(child.name, childNode);
          reportNodes.set(childNode.id, toReportNode(childNode));
        }
      }
    }
```

Everything downstream of these loops (connectors using `byName`, the report assembly using `reportNodes`/`editDiffs`) is unchanged — the variables keep their names. `page` is a `PageNode`; `renderContainer` calls `parent.appendChild(node)`, which `PageNode` supports, so the `as unknown as EditableNode` cast is only to satisfy the parameter type.

**Behavior-preservation note:** the original code did NOT add the top-level frame node to `reportNodes` (only its children), so neither does `renderContainer`'s caller here — do not re-add a `reportNodes.set(frameNode …)`. This keeps `report.counts`/`report.nodes` byte-identical for legacy flat specs (Task 8 guards it). `renderContainer` *does* register each child (including nested frames, which are new) in `reportNodes`, exactly as the old inner loop did.

- [ ] **Step 8: Run to verify they pass**

Run: `pnpm --filter @uxfactory/plugin exec vitest run test/code.test.ts`
Expected: PASS (the two new tests; the existing render tests still pass — a flat frame with no `layout` leaves `layoutMode` undefined).

- [ ] **Step 9: Full plugin suite + typecheck**

Run: `pnpm --filter @uxfactory/plugin test` then `pnpm -r build`
Expected: PASS / no TS errors.

- [ ] **Step 10: Commit**

```bash
git add packages/uxfactory-plugin/src/code.ts packages/uxfactory-plugin/test/figma-mock.ts packages/uxfactory-plugin/test/code.test.ts
git commit -m "feat(plugin): render auto-layout + nested frames (SP3a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Render — local components + instances + overrides

**Files:**
- Modify: `packages/uxfactory-plugin/src/code.ts`
- Modify: `packages/uxfactory-plugin/test/figma-mock.ts`
- Test: `packages/uxfactory-plugin/test/code.test.ts`

**Interfaces:**
- Consumes: `RenderCtx`, `renderContainer`, `PlannedComponent` (Tasks 4–5).
- Produces: `FigmaApi.createComponent()`; `EditableNode.createInstance()`; a component registry built in `renderSpec` from `plan.components`; a `renderChild` `"component-instance"` branch that instantiates + applies overrides + skips-on-failure. `FakeFigma.createComponent` and a fake `createInstance` that clones child names/props.

- [ ] **Step 1: Write the failing render tests**

Append to `code.test.ts` (inside the render `describe`):

```ts
  it("builds a component once and instantiates it with per-instance overrides", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      components: {
        button: { name: "Button", width: 120, height: 40, layout: { mode: "horizontal", gap: 8 },
          children: [{ type: "text", name: "label", x: 0, y: 0, width: 96, height: 16, characters: "OK", fill: "#101828" }] },
      },
      frames: [
        { name: "screen", x: 0, y: 0, width: 400, height: 300, children: [
          { type: "component-instance", name: "primary", component: "button", x: 20, y: 20,
            overrides: { label: { characters: "Pay now", fill: "#FFFFFF" } } },
          { type: "component-instance", name: "secondary", component: "button", x: 20, y: 80,
            overrides: { label: { characters: "Cancel" } } },
        ] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j3" });

    expect(fig.createComponentCalls).toBe(1);
    const screen = fig.currentPage.children.find((n) => n.name === "screen")!;
    const primary = screen.children.find((n) => n.name === "primary")!;
    expect(primary.type).toBe("INSTANCE");
    const primaryLabel = primary.children.find((n) => n.name === "label")!;
    expect(primaryLabel.characters).toBe("Pay now");
    const secondary = screen.children.find((n) => n.name === "secondary")!;
    const secondaryLabel = secondary.children.find((n) => n.name === "label")!;
    expect(secondaryLabel.characters).toBe("Cancel");
  });

  it("skips a component-instance with an unknown component id without aborting", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        { name: "screen", x: 0, y: 0, width: 200, height: 200, children: [
          { type: "component-instance", name: "ghost", component: "missing", x: 0, y: 0 },
          { type: "shape", name: "ok", x: 0, y: 0, width: 10, height: 10, fill: "#1E88E5" },
        ] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j4" });
    const rendered = lastOfType(fig, "rendered");
    expect(rendered).toBeDefined();
    const screen = fig.currentPage.children.find((n) => n.name === "screen")!;
    expect(screen.children.some((n) => n.name === "ok")).toBe(true);
    expect(screen.children.some((n) => n.name === "ghost")).toBe(false);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uxfactory/plugin exec vitest run test/code.test.ts`
Expected: FAIL (`createComponentCalls` undefined; no instance rendering).

- [ ] **Step 3: Extend the fake with `createComponent` + cloning `createInstance`**

In `figma-mock.ts`, add a `createComponentCalls` counter to the `FakeFigma` interface:

```ts
  createComponent(): FakeNode;
  createComponentCalls: number;
```

In `makeFigma`, add a deep-clone helper and the `createComponent` implementation. Place the helper near `create`:

```ts
  const cloneNode = (src: FakeNode): FakeNode => {
    const copy = new FakeNode(src.type === "COMPONENT" ? "INSTANCE" : src.type, `${(counter += 1)}:1`);
    copy.name = src.name;
    copy.x = src.x;
    copy.y = src.y;
    copy.width = src.width;
    copy.height = src.height;
    copy.fills = src.fills;
    copy.characters = src.characters;
    copy.visible = src.visible;
    for (const c of src.children) copy.appendChild(cloneNode(c));
    return copy;
  };
  let createComponentCalls = 0;
  const createComponent = (): FakeNode => {
    createComponentCalls += 1;
    const node = create("COMPONENT");
    (node as unknown as Record<string, unknown>).createInstance = () => cloneNode(node);
    return node;
  };
```

Add `createComponent` and `get createComponentCalls()` to the returned `result` object:

```ts
    createComponent,
    get createComponentCalls() {
      return createComponentCalls;
    },
```

Note: `cloneNode` copies `characters` directly (the clone's `characters` is a plain field, not the font-guarded accessor — overrides on an instance need no `loadFontAsync`).

- [ ] **Step 4: Extend `FigmaApi` + `EditableNode` in `code.ts`**

Add to the `FigmaApi` interface (near `createFrame`):

```ts
  createComponent(): EditableNode;
```

Add this one line to the `EditableNode` interface (`fontName?` is already declared there — do NOT re-add it):

```ts
  createInstance?(): EditableNode;
```

- [ ] **Step 5: Build the component registry + the instance branch**

In `renderSpec`, before the `for (const frame of plan.frames)` loop, build masters from `plan.components` and stash them on `ctx` via a module-scoped map passed through. Simplest: add a `components` map to `RenderCtx`:

```ts
interface RenderCtx {
  byName: Map<string, EditableNode>;
  reportNodes: Map<string, ReportNode>;
  editDiffs: ReportEditDiff[];
  components: Map<string, EditableNode>;
}
```

Build it right after creating `ctx`:

```ts
    const ctx: RenderCtx = { byName, reportNodes, editDiffs, components: new Map() };
    if (plan.components) {
      for (const [id, def] of Object.entries(plan.components)) {
        const master = fig.createComponent();
        master.name = def.name;
        master.resize(def.width, def.height);
        if (def.fill !== undefined) master.fills = solidPaint(def.fill);
        for (const child of def.children) {
          await renderChild(child, master, ctx);
        }
        applyAutoLayout(master, def.layout, def.sizing);
        page.appendChild(master); // masters must live on the canvas
        ctx.components.set(id, master);
      }
    }
```

Add the `"component-instance"` branch to `renderChild` (just after the `"frame"` branch):

```ts
  if (child.kind === "component-instance") {
    const master = child.component ? ctx.components.get(child.component) : undefined;
    if (!master || typeof master.createInstance !== "function") {
      ctx.editDiffs.push({ name: child.name, diff: `skipped: component "${child.component ?? "?"}" not found` });
      return null;
    }
    let inst: EditableNode;
    try {
      inst = master.createInstance();
    } catch (err) {
      ctx.editDiffs.push({ name: child.name, diff: `skipped: instance "${child.name}" failed: ${String(err)}` });
      return null;
    }
    inst.name = child.name;
    inst.x = child.x;
    inst.y = child.y;
    if (child.width !== undefined || child.height !== undefined) {
      inst.resize(child.width ?? inst.width, child.height ?? inst.height);
    }
    if (child.rotation !== undefined) inst.rotation = child.rotation;
    if (child.opacity !== undefined) inst.opacity = child.opacity;
    if (child.overrides) applyInstanceOverrides(inst, child.overrides);
    parent.appendChild(inst);
    return inst;
  }
```

Add the override applier near `renderContainer` (reusing the existing recursive `findByName`):

```ts
function applyInstanceOverrides(inst: EditableNode, overrides: NonNullable<PlannedChild["overrides"]>): void {
  for (const [descName, ov] of Object.entries(overrides)) {
    const target = findByName(inst, descName);
    if (!target) continue;
    if (ov.characters !== undefined && target.characters !== undefined) target.characters = ov.characters;
    if (ov.fill !== undefined) target.fills = solidPaint(ov.fill);
    if (ov.visible !== undefined) target.visible = ov.visible;
  }
}
```

(`findByName(page, name)` already exists for connectors; confirm it recurses `node.children`. If it only searches a page's direct children, add a small recursive `findByName(root: EditableNode, name)` helper that walks `root.children`.)

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm --filter @uxfactory/plugin exec vitest run test/code.test.ts`
Expected: PASS (both new tests; prior tests unaffected — specs with no `components` skip the registry loop entirely).

- [ ] **Step 7: Full plugin suite + typecheck**

Run: `pnpm --filter @uxfactory/plugin test` then `pnpm -r build`
Expected: PASS / no TS errors.

- [ ] **Step 8: Commit**

```bash
git add packages/uxfactory-plugin/src/code.ts packages/uxfactory-plugin/test/figma-mock.ts packages/uxfactory-plugin/test/code.test.ts
git commit -m "feat(plugin): render local components + instance overrides (SP3a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Render — effects + per-corner radius

**Files:**
- Modify: `packages/uxfactory-plugin/src/code.ts`
- Modify: `packages/uxfactory-plugin/test/figma-mock.ts`
- Test: `packages/uxfactory-plugin/test/code.test.ts`

**Interfaces:**
- Consumes: `PlannedChild.effects`, `PlannedChild.cornerRadius`, `renderContainer`, `renderChild` (Tasks 4–6).
- Produces: `applyEffects(node, effects)` + `applyCornerRadius(node, cr)` helpers called in both `renderContainer` and the leaf path of `renderChild`; `EditableNode`/`FakeNode` gain `effects` and the four `*Radius` props.

- [ ] **Step 1: Write the failing render tests**

Append to `code.test.ts` (render `describe`):

```ts
  it("applies drop-shadow effects and per-corner radius", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        { name: "f", x: 0, y: 0, width: 200, height: 200,
          effects: [{ type: "drop-shadow", color: "#000000", opacity: 0.25, x: 0, y: 4, blur: 12, spread: 1 }],
          children: [
            { type: "shape", name: "card", x: 0, y: 0, width: 100, height: 60,
              cornerRadius: { tl: 8, tr: 8, br: 0, bl: 0 } },
          ] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j5" });
    const frame = fig.currentPage.children.find((n) => n.name === "f")!;
    expect(Array.isArray(frame.effects)).toBe(true);
    const eff = (frame.effects as Array<Record<string, unknown>>)[0];
    expect(eff.type).toBe("DROP_SHADOW");
    expect(eff.radius).toBe(12);
    expect(eff.offset).toEqual({ x: 0, y: 4 });
    const card = frame.children.find((n) => n.name === "card")!;
    expect(card.topLeftRadius).toBe(8);
    expect(card.bottomRightRadius).toBe(0);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @uxfactory/plugin exec vitest run test/code.test.ts`
Expected: FAIL (`effects`/`topLeftRadius` unset).

- [ ] **Step 3: Extend the fake node**

In `figma-mock.ts`, add to `FakeNode` (after the auto-layout fields):

```ts
  effects: unknown = undefined;
  topLeftRadius: number | undefined = undefined;
  topRightRadius: number | undefined = undefined;
  bottomRightRadius: number | undefined = undefined;
  bottomLeftRadius: number | undefined = undefined;
```

- [ ] **Step 4: Extend `EditableNode` in `code.ts`**

Add to the `EditableNode` interface:

```ts
  effects?: unknown;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
```

- [ ] **Step 5: Add the effect + corner-radius appliers and call them**

In `code.ts`, add near `applyAutoLayout`:

```ts
function toFigmaEffect(e: NonNullable<PlannedChild["effects"]>[number]): Record<string, unknown> {
  const { r, g, b } = hexToRgb(e.color);
  return {
    type: e.type === "inner-shadow" ? "INNER_SHADOW" : "DROP_SHADOW",
    color: { r, g, b, a: e.opacity ?? 1 },
    offset: { x: e.x, y: e.y },
    radius: e.blur,
    spread: e.spread ?? 0,
    visible: true,
    blendMode: "NORMAL",
  };
}

function applyEffects(node: EditableNode, effects: PlannedChild["effects"]): void {
  if (effects && effects.length > 0) node.effects = effects.map(toFigmaEffect);
}

function applyCornerRadius(node: EditableNode, cr: PlannedChild["cornerRadius"]): void {
  if (cr === undefined) return;
  if (typeof cr === "number") {
    node.cornerRadius = cr;
  } else {
    node.topLeftRadius = cr.tl;
    node.topRightRadius = cr.tr;
    node.bottomRightRadius = cr.br;
    node.bottomLeftRadius = cr.bl;
  }
}
```

In `renderContainer`, after `if (frame.fill !== undefined) node.fills = solidPaint(frame.fill);` add:

```ts
  applyEffects(node, frame.effects);
  applyCornerRadius(node, frame.cornerRadius);
```

In `renderChild`'s leaf path, replace the numeric-only corner-radius line

```ts
  if (child.cornerRadius !== undefined && typeof child.cornerRadius === "number") node.cornerRadius = child.cornerRadius;
```

with a call to the shared helpers (place after the `strokeWeight` line):

```ts
  applyCornerRadius(node, child.cornerRadius);
  applyEffects(node, child.effects);
```

Also call `applyEffects`/`applyCornerRadius` for component masters in the `plan.components` loop (after `master.fills`):

```ts
        applyEffects(master, def.effects);
        applyCornerRadius(master, def.cornerRadius);
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @uxfactory/plugin exec vitest run test/code.test.ts`
Expected: PASS.

- [ ] **Step 7: Full plugin suite + typecheck**

Run: `pnpm --filter @uxfactory/plugin test` then `pnpm -r build`
Expected: PASS / no TS errors.

- [ ] **Step 8: Commit**

```bash
git add packages/uxfactory-plugin/src/code.ts packages/uxfactory-plugin/test/figma-mock.ts packages/uxfactory-plugin/test/code.test.ts
git commit -m "feat(plugin): render shadow effects + per-corner radius (SP3a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Backward-compatibility characterization

**Files:**
- Test: `packages/uxfactory-plugin/test/code.test.ts`

**Interfaces:**
- Consumes: the full renderer (Tasks 5–7).
- Produces: a guard test proving a legacy flat spec renders with no semantic props touched.

- [ ] **Step 1: Write the characterization test**

Append to `code.test.ts` (render `describe`), reusing the existing top-of-file `design` fixture (a flat design spec with a shape + an instance + a connector):

```ts
  it("renders a legacy flat spec with no semantic props touched (backward-compat)", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    await fig.__send({ type: "render", spec: design, jobId: "legacy" });

    const rendered = lastOfType(fig, "rendered");
    expect(rendered).toBeDefined();
    expect(rendered!.report.counts).toEqual({ frames: 1, sections: 0, objects: 2, connectors: 1 });

    const vpc = fig.currentPage.children.find((n) => n.name === "vpc")!;
    expect(vpc.type).toBe("FRAME");
    // No auto-layout, no effects, no per-corner radius applied to a legacy frame.
    expect(vpc.layoutMode).toBeUndefined();
    expect(vpc.itemSpacing).toBeUndefined();
    expect(vpc.effects).toBeUndefined();
    expect(vpc.topLeftRadius).toBeUndefined();
    expect(vpc.layoutSizingHorizontal).toBeUndefined();
    // No components were created for a spec without a components map.
    expect(fig.createComponentCalls).toBe(0);
    const api = vpc.children.find((n) => n.name === "api")!;
    expect(api).toMatchObject({ type: "RECTANGLE", x: 80, y: 80 });
  });
```

- [ ] **Step 2: Run to verify it passes immediately**

Run: `pnpm --filter @uxfactory/plugin exec vitest run test/code.test.ts`
Expected: PASS (this is a characterization test — it should pass with no source change; if it fails, a prior task regressed backward-compat and must be fixed before proceeding).

- [ ] **Step 3: Full workspace verification**

Run: `pnpm --filter @uxfactory/spec test`, `pnpm --filter @uxfactory/plugin test`, `pnpm -r build`
Expected: all PASS / no TS errors.

- [ ] **Step 4: Commit**

```bash
git add packages/uxfactory-plugin/test/code.test.ts
git commit -m "test(plugin): backward-compat characterization for legacy specs (SP3a)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **`findByName` (Task 6):** verify the existing helper recurses into `node.children`. The connector code calls `findByName(page, connector.from)`. If it only scans a page's direct children, add/confirm a recursive variant so instance-descendant overrides resolve. This is the one place to read the surrounding code before implementing.
- **`renderContainer` parameter type (Task 5):** ignore the conditional-type sketch — use the plain `PlannedFrameLike` alias. A top-level `PlannedFrame` is structurally assignable to it (it has all the same fields plus `children: PlannedChild[]`).
- **`page.appendChild` cast (Task 5/6):** `renderContainer`/master creation append to a `PageNode`; cast the page to `EditableNode` for the parameter type only — do not change `PageNode`.
- **Determinism:** the planner must stay pure; `Object.entries`/`Object.fromEntries` preserve insertion order, so `planRender` stays deep-equal across calls (a pre-existing planner test guards this).
- **Never** touch `packages/uxfactory-cli`, `clients/*`, or `skill/*`. If a change seems to require it, stop and escalate.

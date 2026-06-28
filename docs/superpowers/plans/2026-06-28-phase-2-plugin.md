# Phase 2 — `@uxfactory/plugin` (Figma plugin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@uxfactory/plugin` — the Figma/FigJam plugin that polls the bridge, renders specs deterministically to the canvas, applies reversible surgical edits, forwards selection, drives the 3-state panel UX, and emits a `RenderReport` that exactly matches `@uxfactory/gate`'s contract.

**Architecture:** A Figma plugin runs in two message-passing contexts: a **main thread** (`code.ts`, has `figma.*`, no DOM/fetch) and an **iframe UI** (`ui.ts`/`ui.html`, has DOM + fetch, no `figma.*`). All rendering logic is factored into **pure modules** (planner / edits / undo-stack / report / selection / panel) that import nothing from `figma` or DOM and carry full Vitest coverage; `code.ts` is a thin orchestrator delegating to them. Because there is **no live Figma session in this environment (BUILD-TO-SPEC PHASE)**, `code.ts` is exercised through a focused hand-written `figma` mock, `ui.ts` through jsdom + a mocked `fetch`, and the manifest + esbuild bundles are verified structurally. Determinism is proven at the _plan_ level (`planRender` is pure and deterministic; the canvas follows mechanically from the plan).

**Tech Stack:** TypeScript 6.0.3 (ESM, NodeNext, `verbatimModuleSyntax`), esbuild 0.28.1 (two bundles: `code.ts`→`dist/code.js` IIFE, `ui.ts`→inlined into `dist/ui.html`), `@figma/plugin-typings` 1.130.0 (typecheck-only global `figma`/`__html__`), Vitest 4.1.9 (node env for pure modules + the figma mock; jsdom env for `ui.ts`), value-importing `@uxfactory/spec` (`validate`) and `@uxfactory/gate` (`RenderReport` type) which esbuild bundles into the plugin.

## Global Constraints

- Node `>=20.10`; TypeScript exact `6.0.3`; ESM only (`"type":"module"`), NodeNext for the pure modules; relative imports carry `.js`; `verbatimModuleSyntax` ON (split value vs `import type`).
- Package `@uxfactory/plugin`, dir `packages/uxfactory-plugin/`. NOT published to npm (it's the Figma plugin): `"private": true` (no `exports`/`files`).
- devDeps: `@figma/plugin-typings@1.130.0`, `esbuild@0.28.1`, `@types/node@26.0.1`. Deps: `@uxfactory/spec` + `@uxfactory/gate` (`workspace:*`) — esbuild BUNDLES them into the plugin, so they may be value-imported.
- Pure logic is unit-tested with Vitest; `code.ts` is tested via a FOCUSED `figma` mock; `ui.ts` via jsdom + mocked `fetch`; manifest + bundles are structurally verified. There is no live Figma session.
- Manifest `networkAccess` MUST be exactly `{ "allowedDomains": ["http://localhost:3779"] }`; `editorType` MUST be `["figma","figjam"]`; `api` `"1.0.0"`; `main` `dist/code.js`; `ui` `dist/ui.html` (PRD §NF2, §NF4).
- Honor the cross-phase contract notes: echo `jobId` in the report body posted to `POST /rendered`; emit a filename-safe `renderId` (`[A-Za-z0-9_-]+`); include EVERY edit-target node in `report.nodes` with full post-edit props (the gate reads post-edit values from `report.nodes`, NOT from `report.edits[]`); emit 6-digit lowercase hex colors; populate `ReportNode` optional fields where relevant. PNG previews are OPTIONAL (the gate ignores pixels).
- Determinism (§19): same spec → identical render PLAN (`planRender(spec)` deep-equals itself). Undo stack capped at 50 (evict oldest); undo never pushes its own inverse. Surgical edits set ONLY listed props, no-op on missing target (skip, not error), one bad edit doesn't kill the batch.
- §7.7 (batch review mode) and §7.8 (conformance annotation) are **DEFERRED to Phase 6/7** (they depend on the batch/review subsystems). Phase 2 builds the plugin CORE.

### Monorepo conventions (established — follow exactly)

- `paths` for `@uxfactory/spec` + `@uxfactory/gate` live in `tsconfig.typecheck.json` ONLY (`rootDir: ".."`, `noEmit`), NOT in `tsconfig.json`. Add `"types": ["@figma/plugin-typings", "node"]` and `"lib": ["ES2022","DOM"]` to the typecheck config so the `figma` global (code.ts), DOM/fetch (ui.ts), AND Node globals (tests) all resolve. `skipLibCheck` (inherited from base) absorbs DOM↔node lib overlaps.
- Root `vitest.config.ts` already aliases `@uxfactory/spec`, `@uxfactory/gate`, `@uxfactory/bridge` to `src` — the plugin only value-imports spec + gate, both already aliased, so **NO root config change is needed**.
- Pure modules import NOTHING from figma or DOM. `code.ts` casts the global `figma` to a narrow local `FigmaApi`; `ui.ts` uses DOM + fetch. esbuild bundles `code.ts` and `ui.ts` separately, aliasing spec/gate to their `src/index.ts` so the bundle is self-contained (no prior `tsc` build of spec/gate required).
- Commit scoped per task (`git add packages/uxfactory-plugin`, plus `pnpm-lock.yaml` when deps change); never `git add -A`.

### Message protocol (shared `src/messages.ts`, imported type-only by both contexts)

UI → main: `{ type:"render"; spec: unknown; jobId?: string }` · `{ type:"undo" }` · `{ type:"resize"; width: number; height: number }`.
main → UI: `{ type:"rendered"; report: PluginRenderReport }` · `{ type:"selection"; selection: SelectionPayload }` · `{ type:"undo-count"; count: number }` · `{ type:"render-error"; message: string }`.
Transport: UI→main `parent.postMessage({ pluginMessage: msg }, "*")`; main→UI `figma.ui.postMessage(msg)`, received on `window.onmessage` → `event.data.pluginMessage`.

---

## Task 1: Scaffold — package, configs, manifest, message protocol, esbuild build, placeholders

**Files:**

- Create: `packages/uxfactory-plugin/package.json`
- Create: `packages/uxfactory-plugin/tsconfig.json`
- Create: `packages/uxfactory-plugin/tsconfig.typecheck.json`
- Create: `packages/uxfactory-plugin/.gitignore`
- Create: `packages/uxfactory-plugin/manifest.json`
- Create: `packages/uxfactory-plugin/scripts/build-plugin.mjs`
- Create: `packages/uxfactory-plugin/src/messages.ts`
- Create: `packages/uxfactory-plugin/src/report.ts` (the `PluginRenderReport` type lands here; full `assembleReport` in Task 4)
- Create: `packages/uxfactory-plugin/src/code.ts` (minimal placeholder)
- Create: `packages/uxfactory-plugin/src/ui.ts` (minimal placeholder)
- Create: `packages/uxfactory-plugin/src/ui.html`
- Test: `packages/uxfactory-plugin/test/scaffold.test.ts`

**Interfaces:**

- Produces (`src/messages.ts`): `SelectionNode`, `SelectionPayload`, `UiToMain`, `MainToUi` (union types above).
- Produces (`src/report.ts`): `PluginRenderReport = RenderReport & { jobId?: string; pagePng?: string }` (the plugin emits a superset of the gate's `RenderReport`; the gate ignores the extra fields).
- Produces (`scripts/build-plugin.mjs`): `buildPlugin(): Promise<void>` (also runs when executed directly).

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-plugin/test/scaffold.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPlugin } from "../scripts/build-plugin.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

describe("manifest", () => {
  it("declares a truthful, localhost-only manifest", async () => {
    const manifest = JSON.parse(await readFile(`${pkgRoot}manifest.json`, "utf8"));
    expect(manifest.api).toBe("1.0.0");
    expect(manifest.main).toBe("dist/code.js");
    expect(manifest.ui).toBe("dist/ui.html");
    expect(manifest.editorType).toEqual(["figma", "figjam"]);
    expect(manifest.networkAccess).toEqual({ allowedDomains: ["http://localhost:3779"] });
  });
});

describe("build", () => {
  it("emits a non-empty dist/code.js and a dist/ui.html that inlines the UI bundle", async () => {
    await buildPlugin();
    const code = await readFile(`${pkgRoot}dist/code.js`, "utf8");
    const html = await readFile(`${pkgRoot}dist/ui.html`, "utf8");
    expect(code.length).toBeGreaterThan(0);
    expect(html).toContain("<script>");
    expect(html).not.toContain("/*__UI_BUNDLE__*/"); // placeholder was replaced
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-plugin/test/scaffold.test.ts`
Expected: FAIL — the package, configs, and `build-plugin.mjs` do not exist yet.

- [ ] **Step 3: Create the package scaffold**

`packages/uxfactory-plugin/package.json`:

```json
{
  "name": "@uxfactory/plugin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "engines": {
    "node": ">=20.10"
  },
  "scripts": {
    "build": "node scripts/build-plugin.mjs",
    "typecheck": "tsc -p tsconfig.typecheck.json"
  },
  "dependencies": {
    "@uxfactory/gate": "workspace:*",
    "@uxfactory/spec": "workspace:*"
  },
  "devDependencies": {
    "@figma/plugin-typings": "1.130.0",
    "@types/node": "26.0.1",
    "esbuild": "0.28.1"
  }
}
```

`packages/uxfactory-plugin/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src"]
}
```

`packages/uxfactory-plugin/tsconfig.typecheck.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "..",
    "lib": ["ES2022", "DOM"],
    "types": ["@figma/plugin-typings", "node"],
    "paths": {
      "@uxfactory/spec": ["../uxfactory-spec/src/index.ts"],
      "@uxfactory/gate": ["../uxfactory-gate/src/index.ts"]
    }
  },
  "include": ["src", "test"]
}
```

`packages/uxfactory-plugin/.gitignore`:

```
dist
```

- [ ] **Step 4: Create the manifest**

`packages/uxfactory-plugin/manifest.json`:

```json
{
  "name": "UXFactory",
  "id": "uxfactory-plugin",
  "api": "1.0.0",
  "main": "dist/code.js",
  "ui": "dist/ui.html",
  "editorType": ["figma", "figjam"],
  "networkAccess": {
    "allowedDomains": ["http://localhost:3779"]
  }
}
```

- [ ] **Step 5: Create the message protocol and the report supertype**

`packages/uxfactory-plugin/src/messages.ts`:

```ts
import type { PluginRenderReport } from "./report.js";

/** A selected node mapped to the §7.5 reporting fields. */
export interface SelectionNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity?: number;
  rotation?: number;
  visible?: boolean;
  cornerRadius?: number;
  characters?: string;
}

/** The body POSTed to the bridge `POST /selection`. */
export interface SelectionPayload {
  page: string;
  fileName: string;
  fileKey: string;
  nodes: SelectionNode[];
}

/** Messages the iframe UI sends to the main thread. */
export type UiToMain =
  | { type: "render"; spec: unknown; jobId?: string }
  | { type: "undo" }
  | { type: "resize"; width: number; height: number };

/** Messages the main thread sends to the iframe UI. */
export type MainToUi =
  | { type: "rendered"; report: PluginRenderReport }
  | { type: "selection"; selection: SelectionPayload }
  | { type: "undo-count"; count: number }
  | { type: "render-error"; message: string };
```

`packages/uxfactory-plugin/src/report.ts` (Task-1 slice — only the type; `assembleReport`/`newRenderId` added in Task 4):

```ts
import type { RenderReport, ReportNode, ReportCounts, ReportEditDiff } from "@uxfactory/gate";

export type { RenderReport, ReportNode, ReportCounts, ReportEditDiff };

/**
 * The plugin emits a SUPERSET of the gate's `RenderReport`: it echoes the
 * `jobId` (so the bridge can resolve a pending `POST /edits` waiter) and may
 * carry an optional whole-page PNG. The gate ignores both extra fields.
 */
export type PluginRenderReport = RenderReport & { jobId?: string; pagePng?: string };
```

- [ ] **Step 6: Create the esbuild build script and the UI shell + placeholders**

`packages/uxfactory-plugin/scripts/build-plugin.mjs`:

```js
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

// Resolve workspace deps to their TypeScript source so the bundle is
// self-contained — no prior `tsc` build of spec/gate is required.
const alias = {
  "@uxfactory/spec": path.join(root, "..", "uxfactory-spec", "src", "index.ts"),
  "@uxfactory/gate": path.join(root, "..", "uxfactory-gate", "src", "index.ts"),
};

const common = {
  bundle: true,
  format: "iife",
  target: "es2017",
  platform: "browser",
  alias,
};

export async function buildPlugin() {
  await mkdir(dist, { recursive: true });

  // 1. main thread → dist/code.js
  await build({
    ...common,
    entryPoints: [path.join(root, "src/code.ts")],
    outfile: path.join(dist, "code.js"),
  });

  // 2. iframe UI → bundled JS string, inlined into ui.html
  const uiResult = await build({
    ...common,
    entryPoints: [path.join(root, "src/ui.ts")],
    write: false,
  });
  const uiJs = uiResult.outputFiles[0].text;
  const template = await readFile(path.join(root, "src/ui.html"), "utf8");
  // Function replacement avoids `$`-pattern expansion in the bundled JS.
  const html = template.replace("/*__UI_BUNDLE__*/", () => uiJs);
  await writeFile(path.join(dist, "ui.html"), html, "utf8");

  console.log("plugin build complete: dist/code.js, dist/ui.html");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildPlugin().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

`packages/uxfactory-plugin/src/ui.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        font-family: Inter, system-ui, sans-serif;
        margin: 0;
        padding: 12px;
        font-size: 12px;
      }
      #panel[data-state="CONNECTED_MIN"] #actions {
        display: none;
      }
      #panel:not([data-state="CONNECTED_MIN"]) #expand {
        display: none;
      }
      #errors {
        color: #c62828;
        white-space: pre-wrap;
      }
      textarea {
        width: 100%;
        box-sizing: border-box;
      }
    </style>
  </head>
  <body>
    <div id="panel" data-state="COMPACT">
      <div id="status">Disconnected</div>
      <div id="actions">
        <details id="details">
          <summary>Manual spec</summary>
          <textarea id="spec" rows="10"></textarea>
          <button id="render-manual">Render</button>
        </details>
        <button id="undo">Undo (0)</button>
        <div id="errors"></div>
      </div>
      <button id="expand">Expand</button>
    </div>
    <script>
      /*__UI_BUNDLE__*/
    </script>
  </body>
</html>
```

`packages/uxfactory-plugin/src/code.ts` (Task-1 placeholder — replaced in full in Task 6):

```ts
declare const __html__: string;
const api = figma as unknown as {
  showUI(html: string, opts: { width: number; height: number }): void;
};
api.showUI(__html__, { width: 540, height: 220 });
```

`packages/uxfactory-plugin/src/ui.ts` (Task-1 placeholder — replaced in full in Task 7):

```ts
export {};
```

- [ ] **Step 7: Install and run the test to confirm it passes**

Run: `pnpm install` then `pnpm vitest run packages/uxfactory-plugin/test/scaffold.test.ts`
Expected: PASS — manifest is truthful; `buildPlugin()` emits a non-empty `dist/code.js` and a `dist/ui.html` with the bundle inlined (placeholder gone).

- [ ] **Step 8: Commit**

```bash
git add packages/uxfactory-plugin pnpm-lock.yaml
git commit -m "feat(plugin): scaffold @uxfactory/plugin with manifest, message protocol, esbuild build"
```

---

## Task 2: `src/planner.ts` — pure, deterministic render plan

**Files:**

- Create: `packages/uxfactory-plugin/src/planner.ts`
- Test: `packages/uxfactory-plugin/test/planner.test.ts`

**Interfaces:**

- Consumes (type-only): `Spec`, `Editor`, `Frame`, `Section`, `Connector`, `Edit`, `FrameChild`, `SectionChild` from `@uxfactory/spec`.
- Produces: `RenderPlan`, `PlannedFrame`, `PlannedSection`, `PlannedChild`, `PlannedConnector`; `planRender(spec: Spec): RenderPlan`.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-plugin/test/planner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { DesignSpec, FigjamSpec, EditOnlySpec } from "@uxfactory/spec";
import { planRender } from "../src/planner.js";

const design: DesignSpec = {
  editor: "figma",
  page: "Architecture",
  frames: [
    {
      name: "vpc",
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      children: [
        {
          type: "shape",
          name: "api",
          x: 80,
          y: 80,
          width: 160,
          height: 64,
          fill: "#1E88E5",
          characters: "API",
        },
        { type: "instance", name: "lambda", asset: "aws:lambda", x: 320, y: 80 },
      ],
    },
  ],
  connectors: [{ from: "api", to: "lambda", label: "invokes" }],
};

describe("planRender", () => {
  it("is pure and deterministic (deep-equal across calls)", () => {
    expect(planRender(design)).toEqual(planRender(design));
  });

  it("plans a design spec, preserving child order and resolving editor", () => {
    const plan = planRender(design);
    expect(plan.editor).toBe("figma");
    expect(plan.page).toBe("Architecture");
    expect(plan.frames).toHaveLength(1);
    expect(plan.frames[0].children.map((c) => c.name)).toEqual(["api", "lambda"]);
    expect(plan.frames[0].children[0]).toMatchObject({
      kind: "shape",
      fill: "#1E88E5",
      characters: "API",
    });
    expect(plan.frames[0].children[1]).toMatchObject({ kind: "instance", asset: "aws:lambda" });
    expect(plan.sections).toEqual([]);
    expect(plan.connectors).toEqual([{ from: "api", to: "lambda", label: "invokes" }]);
  });

  it("defaults a missing editor to figma and a missing page to Page 1", () => {
    const plan = planRender({ frames: [] } as DesignSpec);
    expect(plan.editor).toBe("figma");
    expect(plan.page).toBe("Page 1");
  });

  it("plans a figjam spec into sections", () => {
    const figjam: FigjamSpec = {
      editor: "figjam",
      sections: [
        {
          name: "retro",
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          children: [{ type: "sticky", name: "note", x: 10, y: 10, characters: "ship it" }],
        },
      ],
    };
    const plan = planRender(figjam);
    expect(plan.editor).toBe("figjam");
    expect(plan.frames).toEqual([]);
    expect(plan.sections[0].children[0]).toMatchObject({ kind: "sticky", characters: "ship it" });
  });

  it("plans an edit-only spec (no frames/sections, edits present)", () => {
    const editOnly: EditOnlySpec = { edits: [{ id: "1:2", set: { x: 5 } }] };
    const plan = planRender(editOnly);
    expect(plan.frames).toEqual([]);
    expect(plan.sections).toEqual([]);
    expect(plan.edits).toEqual([{ id: "1:2", set: { x: 5 } }]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-plugin/test/planner.test.ts`
Expected: FAIL — `../src/planner.js` does not exist.

- [ ] **Step 3: Implement the planner**

`packages/uxfactory-plugin/src/planner.ts`:

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
} from "@uxfactory/spec";

/** A normalized leaf node inside a planned frame or section. */
export interface PlannedChild {
  kind: "shape" | "text" | "instance" | "sticky";
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  rotation?: number;
  opacity?: number;
  characters?: string;
  asset?: string;
}

export interface PlannedFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: PlannedChild[];
}

export interface PlannedSection {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: PlannedChild[];
}

export interface PlannedConnector {
  from: string;
  to: string;
  label?: string;
}

/** A deterministically-ordered, defaults-resolved representation of a spec. */
export interface RenderPlan {
  editor: Editor;
  page: string;
  frames: PlannedFrame[];
  sections: PlannedSection[];
  connectors: PlannedConnector[];
  edits: Edit[];
}

function mapChild(child: FrameChild | SectionChild): PlannedChild {
  const out: PlannedChild = { kind: child.type, name: child.name, x: child.x, y: child.y };
  if ("width" in child && child.width !== undefined) out.width = child.width;
  if ("height" in child && child.height !== undefined) out.height = child.height;
  if ("fill" in child && child.fill !== undefined) out.fill = child.fill;
  if ("stroke" in child && child.stroke !== undefined) out.stroke = child.stroke;
  if ("strokeWidth" in child && child.strokeWidth !== undefined)
    out.strokeWidth = child.strokeWidth;
  if ("cornerRadius" in child && child.cornerRadius !== undefined)
    out.cornerRadius = child.cornerRadius;
  if ("rotation" in child && child.rotation !== undefined) out.rotation = child.rotation;
  if ("opacity" in child && child.opacity !== undefined) out.opacity = child.opacity;
  if ("characters" in child && child.characters !== undefined) out.characters = child.characters;
  if ("asset" in child && child.asset !== undefined) out.asset = child.asset;
  return out;
}

function planFrame(frame: Frame): PlannedFrame {
  return {
    name: frame.name,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    children: (frame.children ?? []).map(mapChild),
  };
}

function planSection(section: Section): PlannedSection {
  return {
    name: section.name,
    x: section.x,
    y: section.y,
    width: section.width,
    height: section.height,
    children: (section.children ?? []).map(mapChild),
  };
}

function planConnector(connector: Connector): PlannedConnector {
  const out: PlannedConnector = { from: connector.from, to: connector.to };
  if (connector.label !== undefined) out.label = connector.label;
  return out;
}

function cloneEdit(edit: Edit): Edit {
  const out: Edit = { set: { ...edit.set } };
  if (edit.id !== undefined) out.id = edit.id;
  if (edit.name !== undefined) out.name = edit.name;
  return out;
}

/**
 * Build a pure, deterministic render plan from a spec. Resolves defaults
 * (editor → "figma", page → "Page 1"), keeps children in given order, and
 * omits absent optional properties. No I/O, no clock, no randomness:
 * `planRender(spec)` deep-equals itself across calls.
 */
export function planRender(spec: Spec): RenderPlan {
  const editor: Editor = spec.editor ?? "figma";
  const page = ("page" in spec ? spec.page : undefined) ?? "Page 1";
  const frames = "frames" in spec ? spec.frames.map(planFrame) : [];
  const sections = "sections" in spec ? spec.sections.map(planSection) : [];
  const connectors =
    "connectors" in spec && spec.connectors ? spec.connectors.map(planConnector) : [];
  const edits = spec.edits ? spec.edits.map(cloneEdit) : [];
  return { editor, page, frames, sections, connectors, edits };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm vitest run packages/uxfactory-plugin/test/planner.test.ts`
Expected: PASS — all five cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-plugin
git commit -m "feat(plugin): add pure deterministic planRender"
```

---

## Task 3: `src/edits.ts` — surgical edit planning + inverse capture

**Files:**

- Create: `packages/uxfactory-plugin/src/edits.ts`
- Test: `packages/uxfactory-plugin/test/edits.test.ts`

**Interfaces:**

- Consumes (type-only): `Edit`, `EditSet` from `@uxfactory/spec`.
- Produces: `planEdit(edit: Edit, present: boolean): { apply: boolean; props: Partial<EditSet> }`; `captureInverse(edit: Edit, before: Record<string, unknown>): Edit`.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-plugin/test/edits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planEdit, captureInverse } from "../src/edits.js";

describe("planEdit", () => {
  it("applies only the listed props when the target is present", () => {
    expect(planEdit({ id: "1:2", set: { x: 120, fill: "#43a047" } }, true)).toEqual({
      apply: true,
      props: { x: 120, fill: "#43a047" },
    });
  });

  it("is a no-op when the target is missing", () => {
    expect(planEdit({ name: "ghost", set: { x: 1 } }, false)).toEqual({ apply: false, props: {} });
  });
});

describe("captureInverse", () => {
  it("targets by id and captures only the before-values of the changed props", () => {
    const inverse = captureInverse(
      { id: "9:9", name: "renamed-by-forward-edit", set: { x: 120, fill: "#43a047" } },
      { x: 10, fill: "#000000", y: 999 },
    );
    expect(inverse).toEqual({ id: "9:9", set: { x: 10, fill: "#000000" } });
    expect(inverse.name).toBeUndefined();
    expect(Object.keys(inverse.set)).toEqual(["x", "fill"]); // not y
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-plugin/test/edits.test.ts`
Expected: FAIL — `../src/edits.js` does not exist.

- [ ] **Step 3: Implement the edit helpers**

`packages/uxfactory-plugin/src/edits.ts`:

```ts
import type { Edit, EditSet } from "@uxfactory/spec";

/**
 * Plan a single edit. When the target is missing the edit is a no-op
 * (skipped, never an error); otherwise `props` is exactly the `set` entries
 * to apply — nothing else is touched.
 */
export function planEdit(
  edit: Edit,
  present: boolean,
): { apply: boolean; props: Partial<EditSet> } {
  if (!present) return { apply: false, props: {} };
  return { apply: true, props: { ...edit.set } };
}

/**
 * Capture the inverse of a forward edit: an edit targeting by the SAME node
 * `id` (never name — a forward edit may rename the node) whose `set` holds the
 * before-values of exactly the properties the forward edit changes. The caller
 * passes an edit already resolved to the concrete node id.
 */
export function captureInverse(edit: Edit, before: Record<string, unknown>): Edit {
  const set: Record<string, unknown> = {};
  for (const key of Object.keys(edit.set)) {
    set[key] = before[key];
  }
  const inverse: Edit = { set: set as EditSet };
  if (edit.id !== undefined) inverse.id = edit.id;
  return inverse;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm vitest run packages/uxfactory-plugin/test/edits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-plugin
git commit -m "feat(plugin): add planEdit + captureInverse (inverse targets by id)"
```

---

## Task 4: `src/undo-stack.ts`, `src/report.ts`, `src/selection.ts`

**Files:**

- Create: `packages/uxfactory-plugin/src/undo-stack.ts`
- Modify: `packages/uxfactory-plugin/src/report.ts` (add `ReportInput`, `assembleReport`, `newRenderId`)
- Create: `packages/uxfactory-plugin/src/selection.ts`
- Test: `packages/uxfactory-plugin/test/undo-stack.test.ts`
- Test: `packages/uxfactory-plugin/test/report.test.ts`
- Test: `packages/uxfactory-plugin/test/selection.test.ts`

**Interfaces:**

- Produces (`undo-stack.ts`): `class UndoStack { readonly cap = 50; push(inverse: Edit): void; pop(): Edit | undefined; get size(): number }`.
- Produces (`report.ts`): `interface ReportInput`; `assembleReport(input: ReportInput): PluginRenderReport`; `newRenderId(seedCounter: number): string`.
- Produces (`selection.ts`): `interface RawSelNode`; `mapSelection(nodes: RawSelNode[], meta: { page; fileName; fileKey }): SelectionPayload`.
- Consumes: `gate` (value) + `RenderReport` etc. (type) from `@uxfactory/gate` (in the report test); `SelectionNode`/`SelectionPayload` from `./messages.js`.

- [ ] **Step 1: Write the failing tests**

`packages/uxfactory-plugin/test/undo-stack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { UndoStack } from "../src/undo-stack.js";
import type { Edit } from "@uxfactory/spec";

const edit = (n: number): Edit => ({ id: `n_${n}`, set: { x: n } });

describe("UndoStack", () => {
  it("pops nothing when empty", () => {
    const s = new UndoStack();
    expect(s.size).toBe(0);
    expect(s.pop()).toBeUndefined();
  });

  it("pops LIFO", () => {
    const s = new UndoStack();
    s.push(edit(1));
    s.push(edit(2));
    expect(s.pop()?.id).toBe("n_2");
    expect(s.pop()?.id).toBe("n_1");
  });

  it("caps at 50, evicting the oldest", () => {
    const s = new UndoStack();
    for (let i = 0; i <= 50; i++) s.push(edit(i)); // 51 pushes (0..50)
    expect(s.size).toBe(50);
    expect(s.pop()?.id).toBe("n_50"); // newest stays
    // drain to the bottom; n_0 was evicted so the oldest survivor is n_1
    let last: Edit | undefined;
    while (s.size > 0) last = s.pop();
    expect(last?.id).toBe("n_1");
  });
});
```

`packages/uxfactory-plugin/test/report.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assembleReport, newRenderId } from "../src/report.js";
import { gate } from "@uxfactory/gate";
import type { DesignSpec } from "@uxfactory/spec";

describe("newRenderId", () => {
  it("is filename-safe", () => {
    expect(newRenderId(7)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("assembleReport", () => {
  it("populates every §7.4 field, normalizes colors, echoes jobId", () => {
    const report = assembleReport({
      editor: "figma",
      page: "Architecture",
      pageKey: "0:1",
      fileName: "Infra",
      fileKey: "k",
      renderId: "r_1",
      jobId: "job_42",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 1 },
      nodes: [
        {
          id: "1:2",
          name: "api",
          type: "shape",
          x: 80,
          y: 80,
          w: 160,
          h: 64,
          fill: "#1E88E5",
          stroke: "#ABC",
        },
      ],
    });
    expect(report).toMatchObject({
      editor: "figma",
      page: "Architecture",
      pageKey: "0:1",
      fileName: "Infra",
      fileKey: "k",
      renderId: "r_1",
      jobId: "job_42",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 1 },
    });
    expect(report.nodes[0].fill).toBe("#1e88e5"); // lowercased
    expect(report.nodes[0].stroke).toBe("#aabbcc"); // 3-digit expanded
  });

  it("produces a report the gate accepts (shape-compatible) and can PASS", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "f",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          children: [
            { type: "shape", name: "box", x: 10, y: 10, width: 20, height: 20, fill: "#1E88E5" },
          ],
        },
      ],
    };
    const report = assembleReport({
      editor: "figma",
      page: "Page 1",
      pageKey: "0:1",
      fileName: "F",
      fileKey: "k",
      renderId: "r_2",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
      nodes: [
        { id: "1:2", name: "box", type: "shape", x: 10, y: 10, w: 20, h: 20, fill: "#1E88E5" },
      ],
    });
    const result = gate(spec, report);
    expect(result.status).toBe("PASS");
    expect(result.summary.checks).toBe(5);
  });
});
```

`packages/uxfactory-plugin/test/selection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapSelection } from "../src/selection.js";

describe("mapSelection", () => {
  it("maps §7.5 node fields and carries page/file meta", () => {
    const payload = mapSelection(
      [
        {
          id: "1:2",
          name: "api",
          type: "shape",
          x: 1,
          y: 2,
          w: 3,
          h: 4,
          opacity: 0.5,
          rotation: 90,
          visible: true,
          cornerRadius: 8,
          characters: "hi",
        },
      ],
      { page: "P", fileName: "F", fileKey: "k" },
    );
    expect(payload).toEqual({
      page: "P",
      fileName: "F",
      fileKey: "k",
      nodes: [
        {
          id: "1:2",
          name: "api",
          type: "shape",
          x: 1,
          y: 2,
          w: 3,
          h: 4,
          opacity: 0.5,
          rotation: 90,
          visible: true,
          cornerRadius: 8,
          characters: "hi",
        },
      ],
    });
  });

  it("omits absent optional fields", () => {
    const payload = mapSelection(
      [{ id: "1:3", name: "n", type: "frame", x: 0, y: 0, w: 10, h: 10 }],
      { page: "P", fileName: "F", fileKey: "k" },
    );
    expect(payload.nodes[0]).toEqual({
      id: "1:3",
      name: "n",
      type: "frame",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm vitest run packages/uxfactory-plugin/test/undo-stack.test.ts packages/uxfactory-plugin/test/report.test.ts packages/uxfactory-plugin/test/selection.test.ts`
Expected: FAIL — `undo-stack.js`/`selection.js` missing; `report.js` lacks `assembleReport`/`newRenderId`.

- [ ] **Step 3: Implement the undo stack**

`packages/uxfactory-plugin/src/undo-stack.ts`:

```ts
import type { Edit } from "@uxfactory/spec";

/**
 * A bounded LIFO stack of inverse edits. Capped at 50; the oldest entry is
 * evicted on overflow. Applying an undo must NOT push its own inverse — that
 * is the caller's responsibility (no "redo via undo" loop).
 */
export class UndoStack {
  readonly cap = 50;
  #items: Edit[] = [];

  push(inverse: Edit): void {
    this.#items.push(inverse);
    if (this.#items.length > this.cap) this.#items.shift();
  }

  pop(): Edit | undefined {
    return this.#items.pop();
  }

  get size(): number {
    return this.#items.length;
  }
}
```

- [ ] **Step 4: Implement assembleReport + newRenderId (append to report.ts)**

Append to `packages/uxfactory-plugin/src/report.ts` (keep the existing Task-1 type block at the top):

```ts
import type { Editor } from "@uxfactory/spec";

/** Everything the main thread collects before posting a report. */
export interface ReportInput {
  editor: Editor;
  page: string;
  pageKey: string;
  fileName: string;
  fileKey: string;
  renderId: string;
  jobId?: string;
  nodes: ReportNode[];
  counts: ReportCounts;
  edits?: ReportEditDiff[];
  pagePng?: string;
}

/** Normalize a hex color to 6-digit lowercase (`#1E88E5`→`#1e88e5`, `#abc`→`#aabbcc`). */
function normalizeHex(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let hex = value.trim().toLowerCase();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  const body = hex.slice(1);
  if (/^[0-9a-f]{3}$/.test(body)) return `#${body.replace(/./g, (c) => c + c)}`;
  return hex;
}

/** A filename-safe render id (`[A-Za-z0-9_-]+`); the bridge sanitizes anyway. */
export function newRenderId(seedCounter: number): string {
  return `r_${seedCounter}`;
}

/** Assemble a gate-compatible render report, normalizing node colors. */
export function assembleReport(input: ReportInput): PluginRenderReport {
  const nodes: ReportNode[] = input.nodes.map((n) => {
    const out: ReportNode = { ...n };
    if (n.fill !== undefined) out.fill = normalizeHex(n.fill);
    if (n.stroke !== undefined) out.stroke = normalizeHex(n.stroke);
    return out;
  });
  const report: PluginRenderReport = {
    renderId: input.renderId,
    editor: input.editor,
    page: input.page,
    pageKey: input.pageKey,
    fileName: input.fileName,
    fileKey: input.fileKey,
    counts: input.counts,
    nodes,
  };
  if (input.edits !== undefined) report.edits = input.edits;
  if (input.jobId !== undefined) report.jobId = input.jobId;
  if (input.pagePng !== undefined) report.pagePng = input.pagePng;
  return report;
}
```

- [ ] **Step 5: Implement the selection mapper**

`packages/uxfactory-plugin/src/selection.ts`:

```ts
import type { SelectionNode, SelectionPayload } from "./messages.js";

/** The §7.5 fields the main thread reads off each selected node. */
export interface RawSelNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity?: number;
  rotation?: number;
  visible?: boolean;
  cornerRadius?: number;
  characters?: string;
}

export function mapSelection(
  nodes: RawSelNode[],
  meta: { page: string; fileName: string; fileKey: string },
): SelectionPayload {
  return {
    page: meta.page,
    fileName: meta.fileName,
    fileKey: meta.fileKey,
    nodes: nodes.map((n) => {
      const out: SelectionNode = {
        id: n.id,
        name: n.name,
        type: n.type,
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h,
      };
      if (n.opacity !== undefined) out.opacity = n.opacity;
      if (n.rotation !== undefined) out.rotation = n.rotation;
      if (n.visible !== undefined) out.visible = n.visible;
      if (n.cornerRadius !== undefined) out.cornerRadius = n.cornerRadius;
      if (n.characters !== undefined) out.characters = n.characters;
      return out;
    }),
  };
}
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `pnpm vitest run packages/uxfactory-plugin/test/undo-stack.test.ts packages/uxfactory-plugin/test/report.test.ts packages/uxfactory-plugin/test/selection.test.ts`
Expected: PASS — including the gate-credibility test (`gate(spec, report)` returns `PASS` with 5 checks), proving the assembled report matches the gate's `RenderReport` contract.

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-plugin
git commit -m "feat(plugin): add UndoStack, assembleReport (gate-compatible) + mapSelection"
```

---

## Task 5: `src/panel.ts` — the §7.6 panel state machine

**Files:**

- Create: `packages/uxfactory-plugin/src/panel.ts`
- Test: `packages/uxfactory-plugin/test/panel.test.ts`

**Interfaces:**

- Produces: `PanelState`, `PanelEvent`, `PanelView`; `nextPanel(state: PanelState, event: PanelEvent): PanelView`.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-plugin/test/panel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextPanel } from "../src/panel.js";

describe("nextPanel", () => {
  it("toggles COMPACT ↔ EXPANDED on toggle-details with correct dimensions", () => {
    expect(nextPanel("COMPACT", "toggle-details")).toEqual({
      state: "EXPANDED",
      width: 540,
      height: 560,
    });
    expect(nextPanel("EXPANDED", "toggle-details")).toEqual({
      state: "COMPACT",
      width: 540,
      height: 220,
    });
  });

  it("auto-engages CONNECTED_MIN on connect from any state", () => {
    expect(nextPanel("COMPACT", "connect")).toEqual({
      state: "CONNECTED_MIN",
      width: 156,
      height: 72,
    });
    expect(nextPanel("EXPANDED", "connect")).toEqual({
      state: "CONNECTED_MIN",
      width: 156,
      height: 72,
    });
  });

  it("expands CONNECTED_MIN → COMPACT on expand-click (stays connected)", () => {
    expect(nextPanel("CONNECTED_MIN", "expand-click")).toEqual({
      state: "COMPACT",
      width: 540,
      height: 220,
    });
  });

  it("returns to COMPACT on disconnect from any state", () => {
    expect(nextPanel("CONNECTED_MIN", "disconnect")).toEqual({
      state: "COMPACT",
      width: 540,
      height: 220,
    });
    expect(nextPanel("EXPANDED", "disconnect")).toEqual({
      state: "COMPACT",
      width: 540,
      height: 220,
    });
  });

  it("ignores irrelevant events (no-op transitions)", () => {
    expect(nextPanel("CONNECTED_MIN", "toggle-details").state).toBe("CONNECTED_MIN");
    expect(nextPanel("COMPACT", "expand-click").state).toBe("COMPACT");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-plugin/test/panel.test.ts`
Expected: FAIL — `../src/panel.js` does not exist.

- [ ] **Step 3: Implement the state machine**

`packages/uxfactory-plugin/src/panel.ts`:

```ts
export type PanelState = "COMPACT" | "EXPANDED" | "CONNECTED_MIN";
export type PanelEvent = "toggle-details" | "connect" | "expand-click" | "disconnect";

export interface PanelView {
  state: PanelState;
  width: number;
  height: number;
}

const DIMENSIONS: Record<PanelState, { width: number; height: number }> = {
  COMPACT: { width: 540, height: 220 },
  EXPANDED: { width: 540, height: 560 },
  CONNECTED_MIN: { width: 156, height: 72 },
};

function view(state: PanelState): PanelView {
  return { state, ...DIMENSIONS[state] };
}

/** The §7.6 panel transitions. Unhandled (state, event) pairs are no-ops. */
export function nextPanel(state: PanelState, event: PanelEvent): PanelView {
  switch (event) {
    case "toggle-details":
      if (state === "COMPACT") return view("EXPANDED");
      if (state === "EXPANDED") return view("COMPACT");
      return view(state);
    case "connect":
      return view("CONNECTED_MIN");
    case "expand-click":
      return state === "CONNECTED_MIN" ? view("COMPACT") : view(state);
    case "disconnect":
      return view("COMPACT");
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm vitest run packages/uxfactory-plugin/test/panel.test.ts`
Expected: PASS — every transition and dimension verified.

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-plugin
git commit -m "feat(plugin): add §7.6 panel state machine"
```

---

## Task 6: `src/code.ts` — main-thread orchestration + the figma mock

**Files:**

- Modify: `packages/uxfactory-plugin/src/code.ts` (replace the Task-1 placeholder with the full orchestrator)
- Create: `packages/uxfactory-plugin/test/figma-mock.ts`
- Test: `packages/uxfactory-plugin/test/code.test.ts`

**Interfaces:**

- Consumes: `validate` (value) + `Spec`/`Edit`/`EditSet` (type) from `@uxfactory/spec`; `ReportNode`/`ReportCounts`/`ReportEditDiff` (type) from `@uxfactory/gate`; the pure modules; `MainToUi`/`UiToMain` (type) from `./messages.js`.
- `code.ts` runs side effects on import: `figma.showUI`, registers `figma.ui.onmessage` and `figma.on("selectionchange", …)`. It exports nothing — it is exercised through the mock.
- Produces (`test/figma-mock.ts`): `class FakeNode`; `interface FakeFigma`; `makeFigma(): FakeFigma`.

- [ ] **Step 1: Write the figma mock (test helper)**

`packages/uxfactory-plugin/test/figma-mock.ts`:

```ts
import type { MainToUi, UiToMain } from "../src/messages.js";

/** A fake scene node exposing only the surface `code.ts` touches. */
export class FakeNode {
  name = "";
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  fills: unknown = undefined;
  strokes: unknown = undefined;
  strokeWeight: number | undefined = undefined;
  cornerRadius: number | undefined = undefined;
  opacity: number | undefined = undefined;
  rotation: number | undefined = undefined;
  visible: boolean | undefined = undefined;
  characters: string | undefined = undefined;
  connectorStart: unknown = undefined;
  connectorEnd: unknown = undefined;
  children: FakeNode[] = [];
  constructor(
    readonly type: string,
    readonly id: string,
  ) {}
  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
  }
  appendChild(child: FakeNode): void {
    this.children.push(child);
  }
  remove(): void {}
}

export interface FakeFigma {
  currentPage: FakeNode & { selection: FakeNode[] };
  root: { name: string };
  fileKey: string;
  showUI(html: string, opts: { width: number; height: number }): void;
  getNodeById(id: string): FakeNode | null;
  on(type: string, cb: () => void): void;
  createFrame(): FakeNode;
  createRectangle(): FakeNode;
  createText(): FakeNode;
  createSection(): FakeNode;
  createSticky(): FakeNode;
  createConnector(): FakeNode;
  importComponentByKeyAsync(key: string): Promise<{ createInstance(): FakeNode }>;
  exportAsync(): Promise<Uint8Array>;
  ui: {
    posted: MainToUi[];
    onmessage: ((msg: UiToMain) => unknown) | null;
    postMessage(msg: MainToUi): void;
    resize(width: number, height: number): void;
  };
  /** Fire all registered selectionchange handlers. */
  __fireSelectionChange(): void;
  /** Deliver a UI→main message and await the handler's async work. */
  __send(msg: UiToMain): Promise<void>;
}

export function makeFigma(): FakeFigma {
  const registry = new Map<string, FakeNode>();
  const selectionHandlers: Array<() => void> = [];
  let counter = 0;
  const create = (type: string): FakeNode => {
    counter += 1;
    const node = new FakeNode(type, `${counter}:1`);
    registry.set(node.id, node);
    return node;
  };

  const page = Object.assign(create("PAGE"), { selection: [] as FakeNode[] });
  const posted: MainToUi[] = [];
  const ui: FakeFigma["ui"] = {
    posted,
    onmessage: null,
    postMessage(msg) {
      posted.push(msg);
    },
    resize() {},
  };

  return {
    currentPage: page,
    root: { name: "Test File" },
    fileKey: "file-key-123",
    showUI() {},
    getNodeById: (id) => registry.get(id) ?? null,
    on(type, cb) {
      if (type === "selectionchange") selectionHandlers.push(cb);
    },
    createFrame: () => create("FRAME"),
    createRectangle: () => create("RECTANGLE"),
    createText: () => create("TEXT"),
    createSection: () => create("SECTION"),
    createSticky: () => create("STICKY"),
    createConnector: () => create("CONNECTOR"),
    importComponentByKeyAsync: () => Promise.resolve({ createInstance: () => create("INSTANCE") }),
    exportAsync: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    ui,
    __fireSelectionChange() {
      for (const cb of selectionHandlers) cb();
    },
    async __send(msg) {
      await ui.onmessage?.(msg);
    },
  };
}
```

- [ ] **Step 2: Write the failing orchestration test**

`packages/uxfactory-plugin/test/code.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { makeFigma, type FakeFigma } from "./figma-mock.js";
import type { MainToUi } from "../src/messages.js";
import type { DesignSpec, FigjamSpec } from "@uxfactory/spec";

async function loadCode(fig: FakeFigma): Promise<void> {
  (globalThis as Record<string, unknown>).figma = fig;
  (globalThis as Record<string, unknown>).__html__ = "<html></html>";
  vi.resetModules();
  await import("../src/code.js");
}

const lastOfType = <T extends MainToUi["type"]>(fig: FakeFigma, type: T) =>
  [...fig.ui.posted].reverse().find((m) => m.type === type) as
    Extract<MainToUi, { type: T }> | undefined;

const design: DesignSpec = {
  editor: "figma",
  page: "Architecture",
  frames: [
    {
      name: "vpc",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      children: [
        { type: "shape", name: "api", x: 80, y: 80, width: 160, height: 64, fill: "#1E88E5" },
        { type: "instance", name: "lambda", asset: "aws:lambda", x: 320, y: 80 },
      ],
    },
  ],
  connectors: [{ from: "api", to: "lambda" }],
};

describe("code.ts render", () => {
  it("renders a design spec and posts a complete report echoing jobId", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    await fig.__send({ type: "render", spec: design, jobId: "job_7" });

    const rendered = lastOfType(fig, "rendered");
    expect(rendered).toBeDefined();
    const report = rendered!.report;
    expect(report.jobId).toBe("job_7");
    expect(report.renderId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(report.editor).toBe("figma");
    expect(report.page).toBe("Architecture");
    expect(report.pageKey).toBe(fig.currentPage.id);
    expect(report.fileName).toBe("Test File");
    expect(report.fileKey).toBe("file-key-123");
    expect(report.counts).toEqual({ frames: 1, sections: 0, objects: 2, connectors: 1 });
    const api = report.nodes.find((n) => n.name === "api");
    expect(api).toMatchObject({ type: "RECTANGLE", x: 80, y: 80, w: 160, h: 64, fill: "#1e88e5" });
    expect(report.nodes.some((n) => n.name === "lambda" && n.type === "INSTANCE")).toBe(true);
  });

  it("renders a figjam spec into sections/stickies/connectors", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const figjam: FigjamSpec = {
      editor: "figjam",
      sections: [
        {
          name: "retro",
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          children: [
            { type: "sticky", name: "note", x: 10, y: 10, characters: "ship it" },
            { type: "shape", name: "card", x: 50, y: 50, width: 80, height: 40 },
          ],
        },
      ],
      connectors: [{ from: "note", to: "card" }],
    };
    await fig.__send({ type: "render", spec: figjam });
    const report = lastOfType(fig, "rendered")!.report;
    expect(report.editor).toBe("figjam");
    expect(report.counts).toEqual({ frames: 0, sections: 1, objects: 2, connectors: 1 });
    expect(report.nodes.some((n) => n.type === "STICKY" && n.characters === "ship it")).toBe(true);
  });

  it("applies only set props, skips a missing target, captures an inverse, posts the count", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    await fig.__send({
      type: "render",
      spec: {
        editor: "figma",
        frames: [
          {
            name: "f",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            children: [
              { type: "shape", name: "box", x: 10, y: 10, width: 20, height: 20, fill: "#000000" },
            ],
          },
        ],
        edits: [
          { name: "box", set: { x: 99, fill: "#43A047" } },
          { name: "ghost", set: { x: 1 } },
        ],
      } satisfies DesignSpec,
    });

    const report = lastOfType(fig, "rendered")!.report;
    const box = report.nodes.find((n) => n.name === "box")!;
    expect(box).toMatchObject({ x: 99, y: 10, w: 20, fill: "#43a047" }); // only x+fill changed
    expect(report.edits).toHaveLength(2);
    expect(report.edits!.some((e) => /skip/i.test(e.diff))).toBe(true); // ghost skipped
    expect(lastOfType(fig, "undo-count")!.count).toBe(1); // one inverse captured

    // undo restores the BEFORE value by id and decrements the count
    const boxId = box.id;
    await fig.__send({ type: "undo" });
    expect(fig.getNodeById(boxId)!.x).toBe(10);
    expect(lastOfType(fig, "undo-count")!.count).toBe(0);
  });

  it("forwards selectionchange as a selection message", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const node = fig.createRectangle();
    node.name = "picked";
    node.x = 5;
    node.y = 6;
    node.resize(7, 8);
    fig.currentPage.selection = [node];
    fig.__fireSelectionChange();

    const sel = lastOfType(fig, "selection")!.selection;
    expect(sel.fileName).toBe("Test File");
    expect(sel.nodes[0]).toMatchObject({ id: node.id, name: "picked", x: 5, y: 6, w: 7, h: 8 });
  });

  it("renders the same spec twice into equal reports (modulo node ids + renderId)", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    await fig.__send({ type: "render", spec: design });
    await fig.__send({ type: "render", spec: design });
    const posts = fig.ui.posted.filter((m) => m.type === "rendered");
    const strip = (r: MainToUi) => {
      const report = (r as Extract<MainToUi, { type: "rendered" }>).report;
      return { ...report, renderId: "X", nodes: report.nodes.map((n) => ({ ...n, id: "X" })) };
    };
    expect(strip(posts[0])).toEqual(strip(posts[1]));
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-plugin/test/code.test.ts`
Expected: FAIL — `code.ts` is still the Task-1 placeholder; no message handling.

- [ ] **Step 4: Implement the full main-thread orchestrator**

Replace `packages/uxfactory-plugin/src/code.ts` entirely:

```ts
import { validate } from "@uxfactory/spec";
import type { Spec, Edit, EditSet } from "@uxfactory/spec";
import type { ReportNode, ReportCounts, ReportEditDiff } from "@uxfactory/gate";
import type { MainToUi, UiToMain } from "./messages.js";
import { planRender, type PlannedChild } from "./planner.js";
import { planEdit, captureInverse } from "./edits.js";
import { UndoStack } from "./undo-stack.js";
import { assembleReport, newRenderId } from "./report.js";
import { mapSelection, type RawSelNode } from "./selection.js";

/** The narrow node surface the orchestrator uses (cast from the real figma node). */
interface EditableNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fills: unknown;
  strokes: unknown;
  strokeWeight: number | undefined;
  cornerRadius: number | undefined;
  opacity: number | undefined;
  rotation: number | undefined;
  visible: boolean | undefined;
  characters: string | undefined;
  connectorStart: unknown;
  connectorEnd: unknown;
  children?: readonly EditableNode[];
  resize(w: number, h: number): void;
  appendChild(child: EditableNode): void;
  remove(): void;
}

/** The narrow figma surface the orchestrator uses. */
interface FigmaApi {
  currentPage: {
    id: string;
    name: string;
    selection: readonly EditableNode[];
    children: readonly EditableNode[];
    appendChild(node: EditableNode): void;
  };
  root: { name: string };
  fileKey?: string;
  showUI(html: string, options: { width: number; height: number }): void;
  getNodeById(id: string): EditableNode | null;
  on(type: "selectionchange", cb: () => void): void;
  createFrame(): EditableNode;
  createRectangle(): EditableNode;
  createText(): EditableNode;
  createSection(): EditableNode;
  createSticky(): EditableNode;
  createConnector(): EditableNode;
  importComponentByKeyAsync(key: string): Promise<{ createInstance(): EditableNode }>;
  ui: {
    postMessage(msg: MainToUi): void;
    onmessage: ((msg: UiToMain) => void) | null;
    resize(width: number, height: number): void;
  };
}

const fig = figma as unknown as FigmaApi;
const undo = new UndoStack();
let renderCounter = 0;

fig.showUI(__html__, { width: 540, height: 220 });
fig.ui.onmessage = (msg) => handleMessage(msg);
fig.on("selectionchange", () => postSelection());

function post(msg: MainToUi): void {
  fig.ui.postMessage(msg);
}

async function handleMessage(msg: UiToMain): Promise<void> {
  if (msg.type === "render") await renderSpec(msg.spec, msg.jobId);
  else if (msg.type === "undo") applyUndo();
  else if (msg.type === "resize") fig.ui.resize(msg.width, msg.height);
}

// ---- color helpers (figma uses 0..1 RGB; the report uses 6-digit hex) ----

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const body = hex.replace("#", "");
  const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body;
  const num = parseInt(full, 16);
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 };
}

function channel(v: number): string {
  return Math.round(v * 255)
    .toString(16)
    .padStart(2, "0");
}

function solidPaint(hex: string): unknown {
  const { r, g, b } = hexToRgb(hex);
  return [{ type: "SOLID", color: { r, g, b } }];
}

function paintToHex(fills: unknown): string | undefined {
  if (!Array.isArray(fills) || fills.length === 0) return undefined;
  const first = fills[0] as { type?: string; color?: { r: number; g: number; b: number } };
  if (first.type !== "SOLID" || !first.color) return undefined;
  return `#${channel(first.color.r)}${channel(first.color.g)}${channel(first.color.b)}`;
}

// ---- node read/write ----

function toReportNode(node: EditableNode): ReportNode {
  const out: ReportNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    w: node.width,
    h: node.height,
  };
  if (node.rotation !== undefined) out.rotation = node.rotation;
  if (node.opacity !== undefined) out.opacity = node.opacity;
  if (node.visible !== undefined) out.visible = node.visible;
  if (node.cornerRadius !== undefined) out.cornerRadius = node.cornerRadius;
  const fill = paintToHex(node.fills);
  if (fill !== undefined) out.fill = fill;
  const stroke = paintToHex(node.strokes);
  if (stroke !== undefined) out.stroke = stroke;
  if (node.strokeWeight !== undefined) out.strokeWidth = node.strokeWeight;
  if (node.characters !== undefined) out.characters = node.characters;
  return out;
}

function applyProps(node: EditableNode, props: Partial<EditSet>): void {
  if (props.name !== undefined) node.name = props.name;
  if (props.x !== undefined) node.x = props.x;
  if (props.y !== undefined) node.y = props.y;
  if (props.width !== undefined || props.height !== undefined) {
    node.resize(props.width ?? node.width, props.height ?? node.height);
  }
  if (props.rotation !== undefined) node.rotation = props.rotation;
  if (props.opacity !== undefined) node.opacity = props.opacity;
  if (props.visible !== undefined) node.visible = props.visible;
  if (props.cornerRadius !== undefined) node.cornerRadius = props.cornerRadius;
  if (props.fill !== undefined) node.fills = solidPaint(props.fill);
  if (props.stroke !== undefined) node.strokes = solidPaint(props.stroke);
  if (props.strokeWidth !== undefined) node.strokeWeight = props.strokeWidth;
  if (props.characters !== undefined) node.characters = props.characters;
}

function readBefore(node: EditableNode, keys: string[]): Record<string, unknown> {
  const before: Record<string, unknown> = {};
  for (const key of keys) {
    switch (key) {
      case "name":
        before.name = node.name;
        break;
      case "x":
        before.x = node.x;
        break;
      case "y":
        before.y = node.y;
        break;
      case "width":
        before.width = node.width;
        break;
      case "height":
        before.height = node.height;
        break;
      case "rotation":
        before.rotation = node.rotation;
        break;
      case "opacity":
        before.opacity = node.opacity;
        break;
      case "visible":
        before.visible = node.visible;
        break;
      case "cornerRadius":
        before.cornerRadius = node.cornerRadius;
        break;
      case "fill":
        before.fill = paintToHex(node.fills);
        break;
      case "stroke":
        before.stroke = paintToHex(node.strokes);
        break;
      case "strokeWidth":
        before.strokeWidth = node.strokeWeight;
        break;
      case "characters":
        before.characters = node.characters;
        break;
    }
  }
  return before;
}

function describeDiff(before: Record<string, unknown>, props: Partial<EditSet>): string {
  const p = props as Record<string, unknown>;
  return Object.keys(props)
    .map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(p[k])}`)
    .join(", ");
}

// ---- node lookup ----

function findByName(
  node: { children?: readonly EditableNode[] },
  name: string,
): EditableNode | null {
  for (const child of node.children ?? []) {
    if (child.name === name) return child;
    const nested = findByName(child, name);
    if (nested) return nested;
  }
  return null;
}

function findTarget(edit: Edit, byName: Map<string, EditableNode>): EditableNode | null {
  if (edit.id) {
    const byId = fig.getNodeById(edit.id);
    if (byId) return byId;
  }
  if (edit.name) return byName.get(edit.name) ?? findByName(fig.currentPage, edit.name);
  return null;
}

// ---- rendering ----

async function renderChild(child: PlannedChild, parent: EditableNode): Promise<EditableNode> {
  let node: EditableNode;
  if (child.kind === "instance") {
    const component = await fig.importComponentByKeyAsync(child.asset ?? "");
    node = component.createInstance();
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
  if (child.cornerRadius !== undefined) node.cornerRadius = child.cornerRadius;
  if (child.rotation !== undefined) node.rotation = child.rotation;
  if (child.opacity !== undefined) node.opacity = child.opacity;
  if (child.characters !== undefined) node.characters = child.characters;
  parent.appendChild(node);
  return node;
}

async function renderSpec(raw: unknown, jobId?: string): Promise<void> {
  const result = validate(raw);
  if (!result.valid) {
    post({
      type: "render-error",
      message: result.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
    });
    return;
  }
  const plan = planRender(raw as Spec);
  const page = fig.currentPage;
  page.name = plan.page;

  const reportNodes = new Map<string, ReportNode>();
  const byName = new Map<string, EditableNode>();

  for (const frame of plan.frames) {
    const node = fig.createFrame();
    node.name = frame.name;
    node.x = frame.x;
    node.y = frame.y;
    node.resize(frame.width, frame.height);
    page.appendChild(node);
    byName.set(frame.name, node);
    for (const child of frame.children) {
      const childNode = await renderChild(child, node);
      byName.set(child.name, childNode);
      reportNodes.set(childNode.id, toReportNode(childNode));
    }
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
      const childNode = await renderChild(child, node);
      byName.set(child.name, childNode);
      reportNodes.set(childNode.id, toReportNode(childNode));
    }
  }

  for (const connector of plan.connectors) {
    const c = fig.createConnector();
    const from = byName.get(connector.from) ?? findByName(page, connector.from);
    const to = byName.get(connector.to) ?? findByName(page, connector.to);
    if (from) c.connectorStart = { endpointNodeId: from.id, magnet: "AUTO" };
    if (to) c.connectorEnd = { endpointNodeId: to.id, magnet: "AUTO" };
    if (connector.label !== undefined) c.characters = connector.label;
    page.appendChild(c);
  }

  const editDiffs: ReportEditDiff[] = [];
  for (const edit of plan.edits) {
    try {
      const target = findTarget(edit, byName);
      if (!target) {
        editDiffs.push({
          ...(edit.id ? { id: edit.id } : {}),
          ...(edit.name ? { name: edit.name } : {}),
          diff: "skipped (target not found)",
        });
        continue;
      }
      const resolved: Edit = { id: target.id, set: edit.set };
      const before = readBefore(target, Object.keys(edit.set));
      const planned = planEdit(resolved, true);
      applyProps(target, planned.props);
      undo.push(captureInverse(resolved, before));
      reportNodes.set(target.id, toReportNode(target));
      editDiffs.push({
        id: target.id,
        name: target.name,
        diff: describeDiff(before, planned.props),
      });
    } catch (err) {
      // One bad edit doesn't kill the batch.
      editDiffs.push({
        ...(edit.id ? { id: edit.id } : {}),
        ...(edit.name ? { name: edit.name } : {}),
        diff: `error: ${(err as Error).message}`,
      });
    }
  }

  const counts: ReportCounts = {
    frames: plan.frames.length,
    sections: plan.sections.length,
    objects:
      plan.frames.reduce((n, f) => n + f.children.length, 0) +
      plan.sections.reduce((n, s) => n + s.children.length, 0),
    connectors: plan.connectors.length,
  };

  const report = assembleReport({
    editor: plan.editor,
    page: page.name,
    pageKey: page.id,
    fileName: fig.root.name,
    fileKey: fig.fileKey ?? "",
    renderId: newRenderId((renderCounter += 1)),
    jobId,
    nodes: [...reportNodes.values()],
    counts,
    edits: editDiffs.length > 0 ? editDiffs : undefined,
  });

  post({ type: "rendered", report });
  post({ type: "undo-count", count: undo.size });
}

function applyUndo(): void {
  const inverse = undo.pop(); // popping is the only mutation — never re-push
  if (inverse && inverse.id) {
    const target = fig.getNodeById(inverse.id);
    if (target) applyProps(target, planEdit(inverse, true).props);
  }
  post({ type: "undo-count", count: undo.size });
}

function postSelection(): void {
  const page = fig.currentPage;
  const raw: RawSelNode[] = page.selection.map((n) => {
    const out: RawSelNode = {
      id: n.id,
      name: n.name,
      type: n.type,
      x: n.x,
      y: n.y,
      w: n.width,
      h: n.height,
    };
    if (n.opacity !== undefined) out.opacity = n.opacity;
    if (n.rotation !== undefined) out.rotation = n.rotation;
    if (n.visible !== undefined) out.visible = n.visible;
    if (n.cornerRadius !== undefined) out.cornerRadius = n.cornerRadius;
    if (n.characters !== undefined) out.characters = n.characters;
    return out;
  });
  post({
    type: "selection",
    selection: mapSelection(raw, {
      page: page.name,
      fileName: fig.root.name,
      fileKey: fig.fileKey ?? "",
    }),
  });
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm vitest run packages/uxfactory-plugin/test/code.test.ts`
Expected: PASS — design render (geometry + instances + jobId echo + all §7.4 fields), figjam render (sections/stickies/connectors), surgical edit (only-set props, skip-missing, inverse, count), selectionchange forwarding, undo-by-id, and determinism (equal reports modulo ids).

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-plugin
git commit -m "feat(plugin): add main-thread orchestrator (render/edit/undo/selection) + figma mock"
```

---

## Task 7: `src/ui.ts` + `src/ui.html` — iframe UI, then build + whole-monorepo green

**Files:**

- Modify: `packages/uxfactory-plugin/src/ui.ts` (replace the Task-1 placeholder with the full UI)
- (ui.html already created in Task 1 — no change)
- Test: `packages/uxfactory-plugin/test/ui.test.ts`
- Test: `packages/uxfactory-plugin/test/build-smoke.test.ts`

**Interfaces:**

- Consumes: `validate` (value) + types from `@uxfactory/spec`; `MainToUi`/`UiToMain` (type) from `./messages.js`; `nextPanel`/`PanelState`/`PanelView` from `./panel.js`.
- Produces: `interface UiOptions { doc?; fetchImpl?; postToMain? }`; `interface UiController`; `createUi(options?: UiOptions): UiController`. Auto-starts only when `#panel` exists in the document (so importing in tests does not self-start).

- [ ] **Step 1: Write the failing tests**

`packages/uxfactory-plugin/test/ui.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUi } from "../src/ui.js";
import type { UiToMain } from "../src/messages.js";

const DOM = `
  <div id="panel" data-state="COMPACT">
    <div id="status"></div>
    <div id="actions">
      <details id="details"><summary>m</summary><textarea id="spec"></textarea><button id="render-manual"></button></details>
      <button id="undo">Undo (0)</button>
      <div id="errors"></div>
    </div>
    <button id="expand"></button>
  </div>`;

const okFetch = (body: unknown, status = 200) =>
  vi.fn(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as unknown as Response,
  );

beforeEach(() => {
  document.body.innerHTML = DOM;
});

describe("ui poll", () => {
  it("posts a render message (with jobId) when GET /next returns a job", async () => {
    const postToMain = vi.fn();
    const fetchImpl = okFetch({ jobId: "job_9", spec: { edits: [] } });
    const ui = createUi({ postToMain, fetchImpl });
    await ui.pollOnce();
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:3779/next");
    expect(postToMain).toHaveBeenCalledWith({
      type: "render",
      spec: { edits: [] },
      jobId: "job_9",
    });
  });

  it("does nothing on a 204 (empty queue)", async () => {
    const postToMain = vi.fn();
    const ui = createUi({ postToMain, fetchImpl: okFetch(null, 204) });
    await ui.pollOnce();
    expect(postToMain).not.toHaveBeenCalled();
  });
});

describe("ui main-message handling", () => {
  it("POSTs a render report (with jobId) to /rendered", async () => {
    const fetchImpl = okFetch({});
    const ui = createUi({ fetchImpl, postToMain: vi.fn() });
    const report = {
      renderId: "r_1",
      editor: "figma",
      page: "P",
      pageKey: "0:1",
      fileName: "F",
      fileKey: "k",
      counts: { frames: 0, sections: 0, objects: 0, connectors: 0 },
      nodes: [],
      jobId: "job_9",
    };
    await ui.onMainMessage({ type: "rendered", report } as Extract<UiToMain, never> extends never
      ? never
      : never extends never
        ? { type: "rendered"; report: typeof report }
        : never);
    const [url, init] = fetchImpl.mock.calls.at(-1)!;
    expect(url).toBe("http://localhost:3779/rendered");
    expect(JSON.parse((init as RequestInit).body as string).jobId).toBe("job_9");
  });

  it("updates the Undo (n) label on undo-count", async () => {
    const ui = createUi({ fetchImpl: okFetch({}), postToMain: vi.fn() });
    await ui.onMainMessage({ type: "undo-count", count: 3 });
    expect(document.getElementById("undo")!.textContent).toBe("Undo (3)");
  });
});

describe("ui manual textarea", () => {
  it("renders a valid manual spec", () => {
    const postToMain = vi.fn();
    const ui = createUi({ fetchImpl: okFetch({}), postToMain });
    (document.getElementById("spec") as HTMLTextAreaElement).value = JSON.stringify({
      edits: [{ id: "1:2", set: { x: 1 } }],
    });
    ui.submitManual();
    expect(postToMain).toHaveBeenCalledWith({
      type: "render",
      spec: { edits: [{ id: "1:2", set: { x: 1 } }] },
    });
  });

  it("shows errors and does NOT render an invalid manual spec", () => {
    const postToMain = vi.fn();
    const ui = createUi({ fetchImpl: okFetch({}), postToMain });
    (document.getElementById("spec") as HTMLTextAreaElement).value = JSON.stringify({
      frames: "not-an-array",
    });
    ui.submitManual();
    expect(document.getElementById("errors")!.textContent!.length).toBeGreaterThan(0);
    expect(postToMain).not.toHaveBeenCalled();
  });
});

describe("ui health-driven panel", () => {
  it("connects then disconnects, driving the panel state + a resize message", async () => {
    const postToMain = vi.fn();
    const up = createUi({ postToMain, fetchImpl: okFetch({ ok: true }) });
    await up.checkHealth();
    expect(up.panel).toBe("CONNECTED_MIN");
    expect(postToMain).toHaveBeenCalledWith({ type: "resize", width: 156, height: 72 });

    const down = createUi({ postToMain: vi.fn(), fetchImpl: okFetch(null, 503) });
    await down.checkHealth(); // starts disconnected, ok=false → stays COMPACT
    expect(down.panel).toBe("COMPACT");
  });
});
```

`packages/uxfactory-plugin/test/build-smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPlugin } from "../scripts/build-plugin.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

describe("built bundles", () => {
  it("bundles code.ts and inlines the ui.ts bundle into ui.html", async () => {
    await buildPlugin();
    const code = await readFile(`${pkgRoot}dist/code.js`, "utf8");
    const html = await readFile(`${pkgRoot}dist/ui.html`, "utf8");
    expect(code).toContain("showUI"); // main thread bundled
    expect(html).toContain("http://localhost:3779"); // ui.ts bundle (BRIDGE const) inlined
    expect(html).toContain("<script>");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm vitest run packages/uxfactory-plugin/test/ui.test.ts packages/uxfactory-plugin/test/build-smoke.test.ts`
Expected: FAIL — `ui.ts` is the placeholder (`createUi` missing); the built `ui.html` does not yet contain the bridge URL.

- [ ] **Step 3: Implement the iframe UI**

Replace `packages/uxfactory-plugin/src/ui.ts` entirely:

```ts
import { validate } from "@uxfactory/spec";
import type { MainToUi, UiToMain } from "./messages.js";
import { nextPanel, type PanelState, type PanelView } from "./panel.js";

const BRIDGE = "http://localhost:3779";

export interface UiOptions {
  doc?: Document;
  fetchImpl?: typeof fetch;
  postToMain?: (msg: UiToMain) => void;
}

export interface UiController {
  pollOnce(): Promise<void>;
  checkHealth(): Promise<void>;
  onMainMessage(msg: MainToUi): Promise<void>;
  submitManual(): void;
  clickUndo(): void;
  start(): void;
  stop(): void;
  readonly panel: PanelState;
}

export function createUi(options: UiOptions = {}): UiController {
  const doc = options.doc ?? document;
  const doFetch = options.fetchImpl ?? fetch;
  const postToMain =
    options.postToMain ?? ((msg: UiToMain) => parent.postMessage({ pluginMessage: msg }, "*"));

  let panel: PanelState = "COMPACT";
  let connected = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const el = (id: string): HTMLElement | null => doc.getElementById(id);

  const postInit = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const showErrors = (messages: string[]): void => {
    const box = el("errors");
    if (box) box.textContent = messages.join("\n");
  };

  const setStatus = (text: string): void => {
    const status = el("status");
    if (status) status.textContent = text;
  };

  const applyPanel = (view: PanelView): void => {
    panel = view.state;
    postToMain({ type: "resize", width: view.width, height: view.height });
    const root = el("panel");
    if (root) root.dataset.state = view.state;
  };

  async function pollOnce(): Promise<void> {
    const res = await doFetch(`${BRIDGE}/next`);
    if (res.status === 204 || !res.ok) return;
    const job = (await res.json()) as { jobId?: string; spec: unknown };
    postToMain({ type: "render", spec: job.spec, jobId: job.jobId });
  }

  async function checkHealth(): Promise<void> {
    let ok = false;
    try {
      ok = (await doFetch(`${BRIDGE}/health`)).ok;
    } catch {
      ok = false;
    }
    if (ok && !connected) {
      connected = true;
      applyPanel(nextPanel(panel, "connect"));
      setStatus("Connected");
    } else if (!ok && connected) {
      connected = false;
      applyPanel(nextPanel(panel, "disconnect"));
      setStatus("Disconnected");
    }
  }

  async function onMainMessage(msg: MainToUi): Promise<void> {
    if (msg.type === "rendered") {
      await doFetch(`${BRIDGE}/rendered`, postInit(msg.report));
    } else if (msg.type === "selection") {
      await doFetch(`${BRIDGE}/selection`, postInit(msg.selection));
    } else if (msg.type === "undo-count") {
      const undo = el("undo");
      if (undo) undo.textContent = `Undo (${msg.count})`;
    } else if (msg.type === "render-error") {
      showErrors([msg.message]);
    }
  }

  function submitManual(): void {
    const textarea = el("spec") as HTMLTextAreaElement | null;
    if (!textarea) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(textarea.value);
    } catch (err) {
      showErrors([`Invalid JSON: ${(err as Error).message}`]);
      return;
    }
    const result = validate(parsed);
    if (!result.valid) {
      showErrors(result.errors.map((e) => `${e.path}: ${e.message}`));
      return;
    }
    showErrors([]);
    postToMain({ type: "render", spec: parsed });
  }

  function clickUndo(): void {
    postToMain({ type: "undo" });
  }

  function start(): void {
    void checkHealth();
    timer = setInterval(() => {
      void checkHealth();
      void pollOnce();
    }, 2000);
    el("undo")?.addEventListener("click", clickUndo);
    el("render-manual")?.addEventListener("click", submitManual);
    el("details")?.addEventListener("toggle", () => applyPanel(nextPanel(panel, "toggle-details")));
    el("expand")?.addEventListener("click", () => applyPanel(nextPanel(panel, "expand-click")));
    window.onmessage = (event: MessageEvent): void => {
      const data = event.data as { pluginMessage?: MainToUi };
      if (data && data.pluginMessage) void onMainMessage(data.pluginMessage);
    };
  }

  function stop(): void {
    if (timer) clearInterval(timer);
  }

  return {
    pollOnce,
    checkHealth,
    onMainMessage,
    submitManual,
    clickUndo,
    start,
    stop,
    get panel() {
      return panel;
    },
  };
}

// Auto-start only in the real iframe (the panel markup is present). Importing
// this module in jsdom tests before the DOM is built is therefore inert.
if (typeof document !== "undefined" && document.getElementById("panel")) {
  createUi().start();
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm vitest run packages/uxfactory-plugin/test/ui.test.ts packages/uxfactory-plugin/test/build-smoke.test.ts`
Expected: PASS — poll→render, 204 no-op, /rendered POST carrying jobId, undo label, manual valid/invalid, health-driven connect; and the built `ui.html` embeds the ui.ts bundle (contains the bridge URL).

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @uxfactory/plugin typecheck`
Expected: exit 0 — `tsc -p tsconfig.typecheck.json` resolves the `figma`/`__html__` globals (plugin-typings), DOM (ui.ts), Node (tests), and the `paths`-mapped spec/gate; `verbatimModuleSyntax` value/type splits hold.

- [ ] **Step 6: Whole-monorepo green check**

Run: `pnpm typecheck && pnpm test && pnpm format:check`
Expected: all exit 0 (run `pnpm format` first if `format:check` flags the new files). Confirms the plugin integrates without breaking spec / gate / bridge / cli, and the existing root `vitest.config.ts` aliases already resolve spec + gate from source for the plugin's tests (no root change needed).

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-plugin
git commit -m "feat(plugin): add iframe UI (poll/report/selection/manual/undo/panel) + build smoke"
```

---

## Self-Review

**1. Spec coverage** (against PRD §7, §19, §NF2/§NF4, the cross-phase contract notes, and the gate's `RenderReport` contract):

- §7.1 spec-driven rendering (design / figjam / edit-only; deterministic) → planner (Task 2) + code.ts render paths (Task 6); determinism proven at the plan level (Task 2) and at the report level (Task 6 "equal modulo ids"). ✅
- §7.2 surgical edits (target by id else first-match name; only `set` props; no-op missing) → `planEdit` + `findTarget`/`findByName` (Tasks 3, 6). ✅
- §7.3 reversibility (capture inverse by **id**, before-values only; stack cap 50 evict-oldest; undo never re-pushes; live count) → `captureInverse` (Task 3), `UndoStack` (Task 4), `applyUndo` + `undo-count` (Task 6). ✅
- §7.4 render report (editor/page/file name+key; counts frames/sections/objects/connectors; section-children geometry id/name/type/x/y/w/h; edit count + per-edit diff) → `assembleReport` + `toReportNode` + `editDiffs` (Tasks 4, 6); whole-page PNG is OPTIONAL (`pagePng?`), gate ignores pixels. ✅
- §7.5 selection forwarding (page/file meta + per-node §7.5 fields) → `mapSelection` (Task 4) + `postSelection` on `selectionchange` (Task 6). ✅
- §7.6 panel states + transitions (COMPACT 540×220 / EXPANDED 540×560 / CONNECTED_MIN 156×72) → `nextPanel` (Task 5), driven by health + `<details>`/expand in ui.ts (Task 7). ✅
- §19 acceptance (deterministic render via twice-and-diff; edits mutate only `set` + no-op missing; undo restores BEFORE by id with bounded stack + live count; report has every §7.4 field; selection fires; panel transitions; manifest truthful) → covered across Tasks 1–7. ✅
- §NF2/§NF4 manifest (`networkAccess` exactly `{allowedDomains:["http://localhost:3779"]}`, `editorType ["figma","figjam"]`, `api 1.0.0`, `main`/`ui`) → Task 1 manifest + truthfulness test. ✅
- Cross-phase notes: echo `jobId` in the report body (Tasks 4, 6, and the ui.ts `/rendered` POST test in Task 7); filename-safe `renderId` (`newRenderId` + assertions); every edit-target node in `report.nodes` with full post-edit props (`reportNodes.set(target.id, …)` after applying); 6-digit lowercase hex (`normalizeHex` + code.ts color round-trip); `ReportNode` optional fields populated (`toReportNode`). ✅
- §7.7 batch review + §7.8 conformance annotation → explicitly DEFERRED to Phase 6/7 (stated in Global Constraints). ✅

**2. Placeholder scan:** No "TODO"/"TBD"/"similar to"/"add X here". Every code step ships complete code. The two intentional transients — the Task-1 `code.ts` (`showUI` placeholder) and `ui.ts` (`export {}`) — are explicitly REPLACED in full in Tasks 6 and 7 respectively. The `/*__UI_BUNDLE__*/` token in `ui.html` is a build marker, replaced by esbuild output (asserted gone in the Task-1 build test). ✅

**3. Type consistency:** `PluginRenderReport`, `ReportInput`, `RawSelNode`, `SelectionNode`/`SelectionPayload`, `UiToMain`/`MainToUi`, `RenderPlan`/`PlannedChild`, `PanelState`/`PanelView` are defined once and consumed identically downstream. `validate` (spec) and the gate `RenderReport` family are imported across the value/type boundary correctly (`verbatimModuleSyntax`): `validate` is a value import in code.ts/ui.ts; all gate/spec types are `import type`; `report.ts` re-exports with `export type`. `code.ts` decouples from `@figma/plugin-typings` quirks via a local `FigmaApi`/`EditableNode` cast (`figma as unknown as FigmaApi`), and the mock satisfies that surface structurally at runtime. The mock types `ui.onmessage` as `(msg) => unknown` so `__send` can await the Promise that code.ts's handler returns, while code.ts assigns a Promise-returning function into the `(msg) => void` slot (legal — void return position).

**4. Judgment calls** (flagged where the design left a choice):

- **`PluginRenderReport = RenderReport & { jobId?; pagePng? }`.** The design's `MainToUi.rendered` said `report: RenderReport`, but the gate's `RenderReport` type has no `jobId`/`pagePng`, and the cross-phase note REQUIRES echoing `jobId` in the posted body. I introduced a superset type (the gate ignores extra fields) and used it in the message + `assembleReport` return. This is the only faithful way to satisfy both the message contract and the jobId obligation.
- **`captureInverse` is called with a resolved edit `{ id: target.id, set }`.** The pure signature is `(edit, before)`; code.ts resolves the target first (id or first-match name) and passes an edit carrying the concrete node id, so the inverse always targets by **id** even when the forward edit targeted by name — exactly the §7.3 requirement.
- **Page handling operates on `figma.currentPage` (sets its name).** The focused figma-mock surface specified in the design does not include `createPage`/`figma.root.children`, so I render into the current page rather than find/create one. Faithful to the given mock; real multi-page resolution is out of the Phase-2 core scope.
- **Shapes carrying `characters` set `characters` directly on the rectangle node**, and **instances pass `asset` straight to `importComponentByKeyAsync`** (no catalog lookup — the catalog is the CLI's `scan` concern). Both match the mock's node/figma surface and the build-to-spec constraint; pixel-faithful text-in-shape and friendly-name→key resolution are not Phase-2 gate concerns.
- **Colors round-trip through 0..1 RGB in code.ts, then `assembleReport.normalizeHex` lowercases/expands.** `Math.round(v*255)` is exact for the hex inputs used, and the gate normalizes both sides anyway, so case/length never causes a false mismatch.
- **`tsconfig.typecheck.json` uses `types: ["@figma/plugin-typings", "node"]`.** The constraint said to add plugin-typings and noted `@types/node` is a devDep; I included `"node"` so test files (Node APIs) typecheck alongside the figma global and the DOM lib. `skipLibCheck` (base) absorbs DOM↔node global overlaps (`fetch`, etc.).
- **esbuild aliases `@uxfactory/spec`/`@uxfactory/gate` to their `src/index.ts`.** This makes the plugin bundle self-contained (no prior `tsc` build of spec/gate required), so the build-smoke test runs standalone. The deps are still genuinely BUNDLED into the plugin, as the constraint requires.
- **`ui.ts` is structured as an injectable `createUi({ doc, fetchImpl, postToMain })` factory** and auto-starts only when `#panel` exists, so importing it in jsdom tests (before the DOM is built) is inert and no real timers/`window.onmessage` leak into the suite. The 2s poll interval (§NF1) lives in `start()`, exercised only in the real iframe.

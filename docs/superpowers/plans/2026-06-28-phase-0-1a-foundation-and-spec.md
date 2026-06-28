# Phase 0 + Phase 1a — Monorepo Foundation & `@uxfactory/spec` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm/TypeScript monorepo with CI and Vitest, then build the keystone `@uxfactory/spec` package — TypeScript types, the authoritative JSON Schema, and a `validate()` function that behaves identically in Node and the browser.

**Architecture:** A pnpm workspace of ESM TypeScript packages. `@uxfactory/spec` is the dependency root every other package imports. The spec's three shapes (design / figjam / edit-only) are expressed as TS types **and** as a hand-authored JSON Schema (draft-07). `validate()` wraps ajv over that committed schema; because ajv is environment-agnostic, the same function runs in the Figma plugin iframe (jsdom-proven) and in Node.

**Tech Stack:** TypeScript 6.0.3 (ESM, NodeNext), pnpm 11.9.0 workspaces, Vitest 4.1.9 (+ jsdom 29.1.1), ajv 8.20.0, prettier 3.9.1, shx (cross-platform copy), GitHub Actions CI.

## Global Constraints

- **Node:** runtime floor `>=20`; this machine runs Node 26 (fine).
- **TypeScript:** exact `6.0.3`. ESM only — every package is `"type": "module"`. `module`/`moduleResolution`: `NodeNext`. **Relative imports MUST carry the `.js` extension** (NodeNext requirement); Vitest resolves `.js`→`.ts` automatically.
- **Package manager:** pnpm `11.9.0`; declare `"packageManager": "pnpm@11.9.0"` at root.
- **Package names:** all workspace packages are scoped `@uxfactory/*` (directories keep the PRD's `uxfactory-*` names). The CLI package later also exposes the `uxfactory` bin.
- **Schema authority:** the JSON Schema file `packages/uxfactory-spec/schema/uxfactory.schema.json` is the authoritative contract, **hand-authored and committed** — no build-time codegen (PRD §3 decision 4).
- **Determinism (PRD §G1, §19):** `validate()` returns an identical verdict on identical input whether called from Node or the plugin UI (jsdom).
- **Privacy (PRD §NF2):** no network access, no telemetry anywhere in this code.
- **Edit alphabet (PRD §7.2):** the only properties a surgical edit may `set` are exactly: `name, x, y, width, height, rotation, opacity, visible, cornerRadius, fill, stroke, strokeWidth, characters`. Unknown properties MUST be rejected.

---

## Phase 0 — Monorepo Foundation

### Task 1: Workspace skeleton, toolchain & Vitest smoke test

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `tsconfig.json` (root, for editor/typecheck convenience)
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `.npmrc`
- Test: `test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working workspace where `pnpm install`, `pnpm test`, `pnpm format:check` run. Root scripts later packages rely on: `build` (`pnpm -r build`), `test` (`vitest run`), `typecheck` (`pnpm -r exec tsc --noEmit`).

- [ ] **Step 1: Write the failing test**

`test/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("workspace", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run`
Expected: FAIL — `vitest: command not found` / no `package.json` (toolchain not installed yet).

- [ ] **Step 3: Create the workspace config files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "clients/*"
```

`package.json` (root):
```json
{
  "name": "uxfactory",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "packageManager": "pnpm@11.9.0",
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r exec tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "@types/node": "26.0.1",
    "@vitest/coverage-v8": "4.1.9",
    "jsdom": "29.1.1",
    "prettier": "3.9.1",
    "shx": "0.4.0",
    "typescript": "6.0.3",
    "vitest": "4.1.9"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  }
}
```

`tsconfig.json` (root — convenience only; packages each have their own):
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["test"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "packages/**/test/**/*.test.ts", "clients/**/test/**/*.test.ts"],
    environment: "node",
  },
});
```

`.gitignore`:
```gitignore
node_modules/
dist/
coverage/
.uxfactory/
*.log
.DS_Store
.idea/
```

`.prettierrc.json`:
```json
{
  "printWidth": 100,
  "singleQuote": false,
  "trailingComma": "all"
}
```

`.prettierignore`:
```gitignore
dist
coverage
pnpm-lock.yaml
.uxfactory
```

`.npmrc`:
```ini
auto-install-peers=true
```

- [ ] **Step 4: Install and run the smoke test**

Run: `pnpm install && pnpm vitest run`
Expected: PASS — 1 test passes (`workspace > runs vitest`).

- [ ] **Step 5: Verify formatting passes**

Run: `pnpm format:check`
Expected: exit 0 (all files formatted). If it fails, run `pnpm format` then re-check.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm/TypeScript monorepo with Vitest"
```

---

### Task 2: Continuous integration workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts `format:check`, `build`, `test` from Task 1.
- Produces: a CI gate that runs on push to `main` and on every PR.

- [ ] **Step 1: Create the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.9.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm -r build
      - run: pnpm test
```

- [ ] **Step 2: Validate the YAML locally**

Run: `node --input-type=module -e "import('node:fs').then(fs=>{const s=fs.readFileSync('.github/workflows/ci.yml','utf8'); if(!s.includes('pnpm test')) throw new Error('missing test step'); console.log('ci workflow ok')})"`
Expected: prints `ci workflow ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add build + test + format workflow"
```

---

## Phase 1a — `@uxfactory/spec`

### Task 3: Package scaffold & TypeScript types

**Files:**
- Create: `packages/uxfactory-spec/package.json`
- Create: `packages/uxfactory-spec/tsconfig.json`
- Create: `packages/uxfactory-spec/src/types.ts`
- Create: `packages/uxfactory-spec/src/index.ts`
- Test: `packages/uxfactory-spec/test/types.test.ts`

**Interfaces:**
- Consumes: `tsconfig.base.json` (Task 1).
- Produces: exported types `Editor`, `Box`, `ShapeNode`, `TextNode`, `InstanceNode`, `StickyNode`, `FrameChild`, `SectionChild`, `Frame`, `Section`, `Connector`, `EditSet`, `Edit`, `DesignSpec`, `FigjamSpec`, `EditOnlySpec`, `Spec`. These are imported by every later package and by `validate.ts`.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-spec/test/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { DesignSpec, FigjamSpec, EditOnlySpec } from "../src/types.js";

describe("spec types", () => {
  it("models a design spec", () => {
    const spec: DesignSpec = {
      editor: "figma",
      page: "Architecture",
      frames: [
        {
          name: "prod-vpc",
          x: 0,
          y: 0,
          width: 1200,
          height: 800,
          children: [
            { type: "shape", name: "api-gateway", x: 80, y: 80, width: 160, height: 64, fill: "#1E88E5", characters: "API Gateway" },
            { type: "instance", name: "lambda-ingest", asset: "aws:lambda", x: 320, y: 80 },
          ],
        },
      ],
      connectors: [{ from: "api-gateway", to: "lambda-ingest" }],
    };
    expect(spec.frames[0]?.children?.length).toBe(2);
  });

  it("models a figjam spec", () => {
    const spec: FigjamSpec = {
      editor: "figjam",
      sections: [
        {
          name: "retro",
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          children: [{ type: "sticky", name: "went-well", x: 10, y: 10, characters: "shipping" }],
        },
      ],
    };
    expect(spec.sections.length).toBe(1);
  });

  it("models an edit-only spec", () => {
    const spec: EditOnlySpec = {
      edits: [
        { id: "12:34", set: { x: 120, fill: "#43A047" } },
        { name: "redis-cache", set: { characters: "Redis 7.2" } },
      ],
    };
    expect(spec.edits.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-spec`
Expected: FAIL — cannot find module `../src/types.js`.

- [ ] **Step 3: Create the package files**

`packages/uxfactory-spec/package.json`:
```json
{
  "name": "@uxfactory/spec",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": {
      "types": "./dist/src/index.d.ts",
      "import": "./dist/src/index.js"
    },
    "./schema": "./schema/uxfactory.schema.json"
  },
  "files": ["dist", "schema"],
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "ajv": "8.20.0"
  }
}
```

`packages/uxfactory-spec/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`packages/uxfactory-spec/src/types.ts`:
```ts
/** Target editor for a spec. */
export type Editor = "figma" | "figjam";

/** A solid color as a 3- or 6-digit hex string, e.g. "#1E88E5". */
export type HexColor = string;

/** Common geometry for a positioned, sized node. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle-like shape, optionally carrying text. */
export interface ShapeNode extends Box {
  type: "shape";
  name: string;
  fill?: HexColor;
  stroke?: HexColor;
  strokeWidth?: number;
  cornerRadius?: number;
  rotation?: number;
  opacity?: number;
  characters?: string;
}

/** A text node. */
export interface TextNode extends Box {
  type: "text";
  name: string;
  characters: string;
  fill?: HexColor;
  rotation?: number;
  opacity?: number;
}

/** A published-component instance resolved by friendly asset name (e.g. "aws:lambda"). */
export interface InstanceNode {
  type: "instance";
  name: string;
  asset: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
}

/** A FigJam sticky note. */
export interface StickyNode {
  type: "sticky";
  name: string;
  x: number;
  y: number;
  characters: string;
  fill?: HexColor;
}

/** Children allowed inside a Figma frame. */
export type FrameChild = ShapeNode | TextNode | InstanceNode;

/** Children allowed inside a FigJam section. */
export type SectionChild = ShapeNode | StickyNode | InstanceNode;

/** A Figma frame containing children. */
export interface Frame extends Box {
  name: string;
  children?: FrameChild[];
}

/** A FigJam section containing children. */
export interface Section extends Box {
  name: string;
  children?: SectionChild[];
}

/** A connector between two nodes, each referenced by name or id. */
export interface Connector {
  from: string;
  to: string;
  label?: string;
}

/** Properties a surgical edit may change — the v1 edit alphabet (PRD §7.2). */
export interface EditSet {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  cornerRadius?: number;
  fill?: HexColor;
  stroke?: HexColor;
  strokeWidth?: number;
  characters?: string;
}

/** A single surgical edit: target by `id` (preferred) or first-match `name`. */
export interface Edit {
  id?: string;
  name?: string;
  set: EditSet;
}

/** Design (Figma) spec: frames plus optional connectors and edits. */
export interface DesignSpec {
  editor?: "figma";
  page?: string;
  frames: Frame[];
  connectors?: Connector[];
  edits?: Edit[];
}

/** FigJam spec: sections plus optional connectors and edits. */
export interface FigjamSpec {
  editor: "figjam";
  page?: string;
  sections: Section[];
  connectors?: Connector[];
  edits?: Edit[];
}

/** Edit-only spec: surgical mutations, no frames or sections. */
export interface EditOnlySpec {
  editor?: Editor;
  edits: Edit[];
}

/** Any valid UXFactory spec. */
export type Spec = DesignSpec | FigjamSpec | EditOnlySpec;
```

`packages/uxfactory-spec/src/index.ts`:
```ts
export * from "./types.js";
```

- [ ] **Step 4: Install the new package and run the test**

Run: `pnpm install && pnpm vitest run packages/uxfactory-spec`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Verify the package builds**

Run: `pnpm --filter @uxfactory/spec build`
Expected: exit 0; `packages/uxfactory-spec/dist/src/index.js` and `dist/src/types.js` exist.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(spec): scaffold @uxfactory/spec with TypeScript types"
```

---

### Task 4: Authoritative JSON Schema (three shapes + edit rejection)

**Files:**
- Create: `packages/uxfactory-spec/schema/uxfactory.schema.json`
- Modify: `packages/uxfactory-spec/package.json` (build script — add schema copy)
- Test: `packages/uxfactory-spec/test/schema.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (the schema is standalone JSON validated directly via ajv in the test).
- Produces: `schema/uxfactory.schema.json`, a draft-07 schema with a root `oneOf` over `designSpec` / `figjamSpec` / `editOnlySpec` and reusable `definitions`. Consumed by `validate.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-spec/test/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import schema from "../schema/uxfactory.schema.json" with { type: "json" };

const ajv = new Ajv({ allErrors: true, strict: false });
const check = ajv.compile(schema);

const designSpec = {
  editor: "figma",
  page: "Architecture",
  frames: [
    {
      name: "prod-vpc",
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      children: [
        { type: "shape", name: "api-gateway", x: 80, y: 80, width: 160, height: 64, fill: "#1E88E5", characters: "API Gateway" },
        { type: "instance", name: "lambda-ingest", asset: "aws:lambda", x: 320, y: 80 },
      ],
    },
  ],
  connectors: [{ from: "api-gateway", to: "lambda-ingest" }],
};

const figjamSpec = {
  editor: "figjam",
  sections: [
    { name: "retro", x: 0, y: 0, width: 400, height: 300, children: [{ type: "sticky", name: "went-well", x: 10, y: 10, characters: "shipping" }] },
  ],
};

const editOnlySpec = {
  edits: [
    { id: "12:34", set: { x: 120, fill: "#43A047" } },
    { name: "redis-cache", set: { characters: "Redis 7.2" } },
  ],
};

describe("uxfactory.schema.json", () => {
  it("accepts a design spec", () => {
    expect(check(designSpec)).toBe(true);
  });

  it("accepts a figjam spec", () => {
    expect(check(figjamSpec)).toBe(true);
  });

  it("accepts an edit-only spec", () => {
    expect(check(editOnlySpec)).toBe(true);
  });

  it("rejects an unknown edit property", () => {
    const bad = { edits: [{ id: "1", set: { color: "#fff" } }] };
    expect(check(bad)).toBe(false);
    const msg = (check.errors ?? []).some((e) => e.keyword === "additionalProperties");
    expect(msg).toBe(true);
  });

  it("rejects an edit with neither id nor name", () => {
    expect(check({ edits: [{ set: { x: 1 } }] })).toBe(false);
  });

  it("rejects a shape missing a required dimension", () => {
    const bad = { frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10, children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10 }] }] };
    expect(check(bad)).toBe(false);
  });

  it("rejects a contradictory figjam-with-frames spec", () => {
    expect(check({ editor: "figjam", frames: [{ name: "f", x: 0, y: 0, width: 1, height: 1 }] })).toBe(false);
  });

  it("rejects an unknown top-level property", () => {
    expect(check({ frames: [], somethingElse: 1 })).toBe(false);
  });

  it("rejects opacity above 1", () => {
    expect(check({ edits: [{ id: "1", set: { opacity: 1.5 } }] })).toBe(false);
  });

  it("rejects an empty object", () => {
    expect(check({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-spec/test/schema.test.ts`
Expected: FAIL — cannot find module `../schema/uxfactory.schema.json`.

- [ ] **Step 3: Create the schema**

`packages/uxfactory-spec/schema/uxfactory.schema.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://uxfactory.dev/schema/uxfactory.schema.json",
  "title": "UXFactory Spec",
  "oneOf": [
    { "$ref": "#/definitions/designSpec" },
    { "$ref": "#/definitions/figjamSpec" },
    { "$ref": "#/definitions/editOnlySpec" }
  ],
  "definitions": {
    "hexColor": {
      "type": "string",
      "pattern": "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$"
    },
    "shapeNode": {
      "type": "object",
      "required": ["type", "name", "x", "y", "width", "height"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "shape" },
        "name": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number" },
        "height": { "type": "number" },
        "fill": { "$ref": "#/definitions/hexColor" },
        "stroke": { "$ref": "#/definitions/hexColor" },
        "strokeWidth": { "type": "number", "minimum": 0 },
        "cornerRadius": { "type": "number", "minimum": 0 },
        "rotation": { "type": "number" },
        "opacity": { "type": "number", "minimum": 0, "maximum": 1 },
        "characters": { "type": "string" }
      }
    },
    "textNode": {
      "type": "object",
      "required": ["type", "name", "x", "y", "width", "height", "characters"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "text" },
        "name": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number" },
        "height": { "type": "number" },
        "characters": { "type": "string" },
        "fill": { "$ref": "#/definitions/hexColor" },
        "rotation": { "type": "number" },
        "opacity": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "instanceNode": {
      "type": "object",
      "required": ["type", "name", "asset", "x", "y"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "instance" },
        "name": { "type": "string" },
        "asset": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number" },
        "height": { "type": "number" },
        "rotation": { "type": "number" },
        "opacity": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "stickyNode": {
      "type": "object",
      "required": ["type", "name", "x", "y", "characters"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "sticky" },
        "name": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "characters": { "type": "string" },
        "fill": { "$ref": "#/definitions/hexColor" }
      }
    },
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
        "children": {
          "type": "array",
          "items": {
            "oneOf": [
              { "$ref": "#/definitions/shapeNode" },
              { "$ref": "#/definitions/textNode" },
              { "$ref": "#/definitions/instanceNode" }
            ]
          }
        }
      }
    },
    "section": {
      "type": "object",
      "required": ["name", "x", "y", "width", "height"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number" },
        "height": { "type": "number" },
        "children": {
          "type": "array",
          "items": {
            "oneOf": [
              { "$ref": "#/definitions/shapeNode" },
              { "$ref": "#/definitions/stickyNode" },
              { "$ref": "#/definitions/instanceNode" }
            ]
          }
        }
      }
    },
    "connector": {
      "type": "object",
      "required": ["from", "to"],
      "additionalProperties": false,
      "properties": {
        "from": { "type": "string" },
        "to": { "type": "string" },
        "label": { "type": "string" }
      }
    },
    "editSet": {
      "type": "object",
      "additionalProperties": false,
      "minProperties": 1,
      "properties": {
        "name": { "type": "string" },
        "x": { "type": "number" },
        "y": { "type": "number" },
        "width": { "type": "number" },
        "height": { "type": "number" },
        "rotation": { "type": "number" },
        "opacity": { "type": "number", "minimum": 0, "maximum": 1 },
        "visible": { "type": "boolean" },
        "cornerRadius": { "type": "number", "minimum": 0 },
        "fill": { "$ref": "#/definitions/hexColor" },
        "stroke": { "$ref": "#/definitions/hexColor" },
        "strokeWidth": { "type": "number", "minimum": 0 },
        "characters": { "type": "string" }
      }
    },
    "edit": {
      "type": "object",
      "required": ["set"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "set": { "$ref": "#/definitions/editSet" }
      },
      "anyOf": [{ "required": ["id"] }, { "required": ["name"] }]
    },
    "designSpec": {
      "type": "object",
      "required": ["frames"],
      "additionalProperties": false,
      "properties": {
        "editor": { "const": "figma" },
        "page": { "type": "string" },
        "frames": { "type": "array", "items": { "$ref": "#/definitions/frame" } },
        "connectors": { "type": "array", "items": { "$ref": "#/definitions/connector" } },
        "edits": { "type": "array", "items": { "$ref": "#/definitions/edit" } }
      }
    },
    "figjamSpec": {
      "type": "object",
      "required": ["editor", "sections"],
      "additionalProperties": false,
      "properties": {
        "editor": { "const": "figjam" },
        "page": { "type": "string" },
        "sections": { "type": "array", "items": { "$ref": "#/definitions/section" } },
        "connectors": { "type": "array", "items": { "$ref": "#/definitions/connector" } },
        "edits": { "type": "array", "items": { "$ref": "#/definitions/edit" } }
      }
    },
    "editOnlySpec": {
      "type": "object",
      "required": ["edits"],
      "additionalProperties": false,
      "properties": {
        "editor": { "enum": ["figma", "figjam"] },
        "edits": { "type": "array", "minItems": 1, "items": { "$ref": "#/definitions/edit" } }
      }
    }
  }
}
```

- [ ] **Step 4: Run the schema test**

Run: `pnpm vitest run packages/uxfactory-spec/test/schema.test.ts`
Expected: PASS — all 10 tests pass.

- [ ] **Step 5: Update the build script to ship the schema next to the compiled output**

In `packages/uxfactory-spec/package.json`, change the `build` script to:
```json
    "build": "tsc -p tsconfig.json && shx mkdir -p dist/schema && shx cp schema/uxfactory.schema.json dist/schema/uxfactory.schema.json"
```

- [ ] **Step 6: Verify the build copies the schema**

Run: `pnpm --filter @uxfactory/spec build`
Expected: exit 0; `packages/uxfactory-spec/dist/schema/uxfactory.schema.json` exists.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(spec): add authoritative JSON Schema for the three spec shapes"
```

---

### Task 5: `validate()` over the committed schema (Node)

**Files:**
- Create: `packages/uxfactory-spec/src/validate.ts`
- Test: `packages/uxfactory-spec/test/cases.ts`
- Test: `packages/uxfactory-spec/test/validate.node.test.ts`

**Interfaces:**
- Consumes: `schema/uxfactory.schema.json`; types from `./types.js`.
- Produces:
  - `interface ValidationError { path: string; message: string }`
  - `interface ValidationResult { valid: boolean; errors: ValidationError[] }`
  - `function validate(input: unknown): ValidationResult`
  - `function isSpec(input: unknown): input is Spec`
  - `const cases: Case[]` (shared fixture, reused by the jsdom test in Task 6) where `interface Case { name: string; input: unknown; valid: boolean }`.

- [ ] **Step 1: Write the shared cases fixture**

`packages/uxfactory-spec/test/cases.ts`:
```ts
export interface Case {
  name: string;
  input: unknown;
  valid: boolean;
}

export const cases: Case[] = [
  {
    name: "minimal design spec",
    valid: true,
    input: { frames: [{ name: "f", x: 0, y: 0, width: 100, height: 100, children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10, height: 10 }] }] },
  },
  {
    name: "design spec with instance + connectors + editor",
    valid: true,
    input: {
      editor: "figma",
      page: "Architecture",
      frames: [{ name: "f", x: 0, y: 0, width: 100, height: 100, children: [{ type: "instance", name: "i", asset: "aws:lambda", x: 1, y: 2 }] }],
      connectors: [{ from: "s", to: "i", label: "calls" }],
    },
  },
  {
    name: "design spec carrying edits",
    valid: true,
    input: { frames: [{ name: "f", x: 0, y: 0, width: 1, height: 1 }], edits: [{ id: "1:2", set: { x: 5 } }] },
  },
  {
    name: "figjam spec with sticky + connectors",
    valid: true,
    input: {
      editor: "figjam",
      sections: [{ name: "retro", x: 0, y: 0, width: 400, height: 300, children: [{ type: "sticky", name: "w", x: 1, y: 1, characters: "ok" }] }],
      connectors: [{ from: "w", to: "w" }],
    },
  },
  {
    name: "edit-only spec by id and name",
    valid: true,
    input: { edits: [{ id: "12:34", set: { x: 120, fill: "#43A047" } }, { name: "redis-cache", set: { characters: "Redis 7.2" } }] },
  },
  { name: "unknown edit property", valid: false, input: { edits: [{ id: "1", set: { color: "#fff" } }] } },
  { name: "edit with neither id nor name", valid: false, input: { edits: [{ set: { x: 1 } }] } },
  { name: "empty object", valid: false, input: {} },
  { name: "design spec missing frames", valid: false, input: { page: "x" } },
  { name: "figjam missing editor", valid: false, input: { sections: [] } },
  { name: "shape missing height", valid: false, input: { frames: [{ name: "f", x: 0, y: 0, width: 1, height: 1, children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10 }] }] } },
  { name: "figjam with frames (contradiction)", valid: false, input: { editor: "figjam", frames: [{ name: "f", x: 0, y: 0, width: 1, height: 1 }] } },
  { name: "extra top-level property", valid: false, input: { frames: [], extra: 1 } },
  { name: "opacity above 1", valid: false, input: { edits: [{ id: "1", set: { opacity: 1.5 } }] } },
  { name: "bad hex color", valid: false, input: { edits: [{ id: "1", set: { fill: "red" } }] } },
];
```

- [ ] **Step 2: Write the failing test**

`packages/uxfactory-spec/test/validate.node.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validate, isSpec } from "../src/validate.js";
import { cases } from "./cases.js";

describe("validate (node)", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(validate(c.input).valid).toBe(c.valid);
    });
  }

  it("reports the offending property for an unknown edit key", () => {
    const result = validate({ edits: [{ id: "1", set: { color: "#fff" } }] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("color"))).toBe(true);
  });

  it("returns no errors for a valid spec", () => {
    const result = validate({ edits: [{ id: "1", set: { x: 1 } }] });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("isSpec narrows valid input", () => {
    expect(isSpec({ edits: [{ id: "1", set: { x: 1 } }] })).toBe(true);
    expect(isSpec({})).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-spec/test/validate.node.test.ts`
Expected: FAIL — cannot find module `../src/validate.js`.

- [ ] **Step 4: Implement `validate()`**

`packages/uxfactory-spec/src/validate.ts`:
```ts
import Ajv from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import schema from "../schema/uxfactory.schema.json" with { type: "json" };
import type { Spec } from "./types.js";

/** A single validation problem, with a JSON Pointer to where it occurred. */
export interface ValidationError {
  /** JSON Pointer to the offending location, e.g. "/frames/0/children/2". "/" for the root. */
  path: string;
  /** Human-readable description. */
  message: string;
}

/** The result of validating an unknown value against the spec schema. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateFn: ValidateFunction = ajv.compile(schema);

/** Validate an unknown value against the authoritative UXFactory spec schema. */
export function validate(input: unknown): ValidationResult {
  const valid = validateFn(input) === true;
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validateFn.errors ?? []).map(toValidationError);
  return { valid: false, errors };
}

/** Type guard: true when `input` is a structurally valid spec. */
export function isSpec(input: unknown): input is Spec {
  return validate(input).valid;
}

function toValidationError(err: ErrorObject): ValidationError {
  const path = err.instancePath === "" ? "/" : err.instancePath;
  if (err.keyword === "additionalProperties") {
    const extra = (err.params as { additionalProperty?: string }).additionalProperty ?? "";
    return { path, message: `unknown property "${extra}"` };
  }
  return { path, message: err.message ?? "invalid" };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-spec/test/validate.node.test.ts`
Expected: PASS — all cases + the three extra assertions pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(spec): add validate() and isSpec() over the JSON Schema"
```

---

### Task 6: Cross-environment parity (jsdom) & public exports

**Files:**
- Modify: `packages/uxfactory-spec/src/index.ts`
- Test: `packages/uxfactory-spec/test/validate.dom.test.ts`

**Interfaces:**
- Consumes: `validate`, `isSpec`, `ValidationError`, `ValidationResult` from `./validate.js`; `cases` from `./cases.js`.
- Produces: the package's public surface — `validate`, `isSpec`, `ValidationError`, `ValidationResult`, and all type exports — importable as `@uxfactory/spec`.

- [ ] **Step 1: Write the failing jsdom parity test**

`packages/uxfactory-spec/test/validate.dom.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { validate } from "../src/validate.js";
import { cases } from "./cases.js";

describe("validate (jsdom / browser parity)", () => {
  it("runs in a DOM environment", () => {
    expect(typeof window).toBe("object");
  });

  for (const c of cases) {
    it(`${c.name} — identical verdict to node`, () => {
      expect(validate(c.input).valid).toBe(c.valid);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it passes (parity already holds)**

Run: `pnpm vitest run packages/uxfactory-spec/test/validate.dom.test.ts`
Expected: PASS — the DOM env is active (`typeof window === "object"`) and every case yields the same verdict as the Node suite. (This is a parity *guard*; ajv is environment-agnostic so it passes immediately. If any case diverged, this would fail.)

- [ ] **Step 3: Extend the public exports**

Replace `packages/uxfactory-spec/src/index.ts` with:
```ts
export * from "./types.js";
export { validate, isSpec } from "./validate.js";
export type { ValidationError, ValidationResult } from "./validate.js";
```

- [ ] **Step 4: Run the full spec suite**

Run: `pnpm vitest run packages/uxfactory-spec`
Expected: PASS — types, schema, validate.node, validate.dom suites all green.

- [ ] **Step 5: Verify the built artifact resolves the schema at runtime**

Run:
```bash
pnpm --filter @uxfactory/spec build
node --input-type=module -e "import('./packages/uxfactory-spec/dist/src/index.js').then(m => { const r = m.validate({ edits: [{ id: '1', set: { x: 1 } }] }); if (!r.valid) { console.error(r.errors); process.exit(1); } console.log('built artifact ok:', r.valid); })"
```
Expected: prints `built artifact ok: true` — proving the compiled `dist/src/validate.js` loads `dist/schema/uxfactory.schema.json` correctly.

- [ ] **Step 6: Typecheck and format**

Run: `pnpm typecheck && pnpm format:check`
Expected: both exit 0. (Run `pnpm format` first if needed.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(spec): export public API and prove Node/jsdom validation parity"
```

---

## Self-Review

**1. Spec coverage** (against the design doc Phase 0 + Phase 1a and PRD §9, §19):
- Monorepo foundation (pnpm workspace, tsconfig base, Vitest, CI, `.gitignore` for `.uxfactory/`) → Tasks 1–2. ✅
- Types compile → Task 3 (type-construction test + `pnpm --filter build`). ✅
- JSON Schema validates the three shapes → Task 4 (schema.test.ts). ✅
- Rejects unknown edit properties → Task 4 + Task 5 cases. ✅
- `validate()` identical verdict in Node and plugin UI → Tasks 5 + 6 (shared `cases.ts` run under node and jsdom). ✅
- Authoritative schema committed, no codegen → Task 4 (hand-authored JSON). ✅
- Schema shipped with the built package → Task 4 build copy + Task 6 runtime verification. ✅

**2. Placeholder scan:** No "TBD"/"TODO"/"handle edge cases"/"similar to". All code blocks are complete. ✅

**3. Type consistency:** `validate` / `isSpec` / `ValidationResult` / `ValidationError` names are identical across Tasks 5, 6, and the interfaces block. `Case`/`cases` shape is shared between Tasks 5 and 6. Schema `definitions` names (`designSpec`, `figjamSpec`, `editOnlySpec`, `shapeNode`, …) match the root `oneOf` `$ref`s. Package name `@uxfactory/spec` is consistent across `package.json`, build/test commands, and the runtime verification. ✅

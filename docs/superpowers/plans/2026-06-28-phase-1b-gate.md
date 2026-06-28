# Phase 1b — `@uxfactory/gate` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@uxfactory/gate` — a pure, deterministic comparator `gate(spec, report) → GateResult` that asserts a rendered Figma canvas (described by a render report) matches its spec, across the five checks `editorType / counts / presence / geometry / edits`.

**Architecture:** A dependency-light package that **type-only-imports** `@uxfactory/spec` (so it has no runtime dependency on the spec package — types are erased). It defines the `RenderReport` contract it consumes (the plugin will conform to it later) and the `GateResult` it produces. The comparator is split into pure helpers (`internal.ts`), the five check functions (`checks.ts`), and a thin orchestrator (`gate.ts`) that applies options and assembles the result. No I/O, no clock, no randomness — identical inputs always produce an identical `GateResult` (PRD §19).

**Tech Stack:** TypeScript 6.0.3 (ESM, NodeNext), Vitest 4.1.9. Same monorepo toolchain as Phase 0/1a.

## Global Constraints

- **Node:** runtime floor `>=20.10` (matches the rest of the monorepo).
- **TypeScript:** exact `6.0.3`. ESM only — `"type": "module"`. `module`/`moduleResolution`: `NodeNext`. **Relative imports MUST carry the `.js` extension.** `verbatimModuleSyntax` is ON — value imports and type imports are separated; type-only imports use `import type`.
- **Package name:** `@uxfactory/gate`, directory `packages/uxfactory-gate/`.
- **Dependency on spec:** `@uxfactory/gate` declares `"@uxfactory/spec": "workspace:*"` and imports from it **type-only** (`import type { Spec, Edit, EditSet, Editor } from "@uxfactory/spec"`). It does NOT call `validate()` — the gate assumes an already-valid spec (validation is the bridge's/CLI's job).
- **Cross-package type resolution without build-order coupling:** the gate's tsconfigs map the spec package to its source via `paths` so `pnpm typecheck` resolves spec types without requiring spec to be built first (CI runs typecheck before build).
- **Purity / determinism (PRD §G1, §19):** `gate()` performs no I/O and uses no clock/RNG. Any time-based id (`verifyId`) is supplied by the caller via options, never generated inside the gate. Identical `(spec, report, options)` always yields a deeply-equal `GateResult`.
- **Geometry tolerance:** default `tolerancePx = 0.5` (PRD §10.1). Applies to geometry comparisons (`x/y/width/height`) only — not to colors, text, booleans, or opacity.
- **The five checks (PRD §10.2):**
  - `editorType` — report editor matches the spec's editor.
  - `counts` — frames / sections / objects / connectors counts match.
  - `presence` — every node named/identified in the spec appears in the report (by `id`, else first-match `name`).
  - `geometry` — each present node's `x/y/w/h` is within `tolerancePx` of the spec.
  - `edits` — for an edit-bearing spec, every edit's target shows the `set` properties reflected in the report.
- **Skip-and-declare:** a check that does not apply to a given spec shape (e.g. `counts`/`geometry` for an edit-only spec, `editorType` for an editor-less edit-only spec, `edits` for a spec with no edits) returns status `SKIP` — never a silent pass or fail (PRD §13.2 philosophy).
- **Overall verdict:** `GateResult.status` is `FAIL` if any check is `FAIL`, otherwise `PASS` (skips do not fail the gate).

---

## Task 1: Package scaffold, `RenderReport` & `GateResult` types

**Files:**

- Create: `packages/uxfactory-gate/package.json`
- Create: `packages/uxfactory-gate/tsconfig.json`
- Create: `packages/uxfactory-gate/tsconfig.typecheck.json`
- Create: `packages/uxfactory-gate/src/report.ts`
- Create: `packages/uxfactory-gate/src/result.ts`
- Create: `packages/uxfactory-gate/src/index.ts`
- Test: `packages/uxfactory-gate/test/types.test.ts`

**Interfaces:**

- Consumes: `@uxfactory/spec` types (`Editor`) — type-only.
- Produces:
  - `report.ts`: `ReportCounts`, `ReportNode`, `ReportEditDiff`, `RenderReport`.
  - `result.ts`: `CheckId` (`"editorType" | "counts" | "presence" | "geometry" | "edits"`), `CheckStatus` (`"PASS" | "FAIL" | "SKIP"`), `GateCheck`, `GateFailure`, `GateSummary`, `GateResult`, `GateOptions`.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-gate/test/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { RenderReport, ReportNode } from "../src/report.js";
import type { GateResult, GateOptions, CheckId } from "../src/result.js";

describe("gate types", () => {
  it("models a render report", () => {
    const node: ReportNode = {
      id: "1:2",
      name: "api-gateway",
      type: "shape",
      x: 80,
      y: 80,
      w: 160,
      h: 64,
      fill: "#1e88e5",
    };
    const report: RenderReport = {
      renderId: "r_1",
      editor: "figma",
      page: "Architecture",
      pageKey: "0:1",
      fileName: "Infra",
      fileKey: "abc",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
      nodes: [node],
    };
    expect(report.nodes[0]?.name).toBe("api-gateway");
  });

  it("models a gate result and options", () => {
    const opts: GateOptions = { tolerancePx: 0.5, checks: ["geometry"], verifyId: "v_1" };
    const result: GateResult = {
      status: "PASS",
      renderId: "r_1",
      editor: "figma",
      pageKey: "0:1",
      fileName: "Infra",
      summary: { checks: 1, passed: 1, failed: 0, skipped: 0 },
      checks: [{ id: "geometry", status: "PASS", tolerancePx: 0.5 }],
      failures: [],
    };
    const ids: CheckId[] = opts.checks ?? [];
    expect(result.status).toBe("PASS");
    expect(ids[0]).toBe("geometry");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-gate`
Expected: FAIL — cannot find module `../src/report.js`.

- [ ] **Step 3: Create the package files**

`packages/uxfactory-gate/package.json`:

```json
{
  "name": "@uxfactory/gate",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20.10" },
  "exports": {
    ".": {
      "types": "./dist/src/index.d.ts",
      "import": "./dist/src/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.typecheck.json"
  },
  "dependencies": {
    "@uxfactory/spec": "workspace:*"
  }
}
```

`packages/uxfactory-gate/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "paths": {
      "@uxfactory/spec": ["../uxfactory-spec/src/index.ts"]
    }
  },
  "include": ["src"]
}
```

`packages/uxfactory-gate/tsconfig.typecheck.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`packages/uxfactory-gate/src/report.ts`:

```ts
import type { Editor } from "@uxfactory/spec";

/** Counts of top-level structural elements in a render. */
export interface ReportCounts {
  frames: number;
  sections: number;
  objects: number;
  connectors: number;
}

/**
 * A rendered node as captured in the report. Geometry uses `w`/`h`
 * (the spec uses `width`/`height`); the optional properties mirror the
 * edit alphabet so the `edits` check can verify any set property.
 */
export interface ReportNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  cornerRadius?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  characters?: string;
}

/** A per-edit human-readable diff string plus the target it applied to. */
export interface ReportEditDiff {
  id?: string;
  name?: string;
  diff: string;
}

/**
 * The structured artifact the gate compares against a spec. The plugin
 * produces a superset of this (it also carries PNG previews, which the
 * gate ignores — gating does not need pixels, PRD §12).
 */
export interface RenderReport {
  renderId: string;
  editor: Editor;
  page: string;
  pageKey: string;
  fileName: string;
  fileKey: string;
  counts: ReportCounts;
  nodes: ReportNode[];
  edits?: ReportEditDiff[];
}
```

`packages/uxfactory-gate/src/result.ts`:

```ts
import type { Editor } from "@uxfactory/spec";

/** The five gate checks (PRD §10.2). */
export type CheckId = "editorType" | "counts" | "presence" | "geometry" | "edits";

/** A check passes, fails, or does not apply to this spec shape. */
export type CheckStatus = "PASS" | "FAIL" | "SKIP";

/** One check's outcome in the result's `checks` array. */
export interface GateCheck {
  id: CheckId;
  status: CheckStatus;
  expected?: unknown;
  actual?: unknown;
  tolerancePx?: number;
}

/** A single concrete mismatch (PRD §10.1 `failures[]`). */
export interface GateFailure {
  check: CheckId;
  nodeId?: string;
  name?: string;
  property?: string;
  expected: unknown;
  actual: unknown;
  tolerancePx?: number;
}

/** Roll-up counts across the checks that ran. */
export interface GateSummary {
  checks: number;
  passed: number;
  failed: number;
  skipped: number;
}

/** The full result of a gate run (PRD §10.1). */
export interface GateResult {
  status: "PASS" | "FAIL";
  renderId?: string;
  verifyId?: string;
  editor?: Editor;
  pageKey?: string;
  fileName?: string;
  summary: GateSummary;
  checks: GateCheck[];
  failures: GateFailure[];
}

/** Options controlling a gate run. */
export interface GateOptions {
  /** Geometry epsilon in px. Default 0.5. */
  tolerancePx?: number;
  /** Subset of checks to run. Default: all five. */
  checks?: CheckId[];
  /** Caller-supplied id echoed into the result (the gate never generates ids). */
  verifyId?: string;
}
```

`packages/uxfactory-gate/src/index.ts`:

```ts
export type { ReportCounts, ReportNode, ReportEditDiff, RenderReport } from "./report.js";
export type {
  CheckId,
  CheckStatus,
  GateCheck,
  GateFailure,
  GateSummary,
  GateResult,
  GateOptions,
} from "./result.js";
```

- [ ] **Step 4: Install and run the test**

Run: `pnpm install && pnpm vitest run packages/uxfactory-gate`
Expected: PASS — 2 tests pass. (`pnpm install` links `@uxfactory/spec` into the gate package and may update `pnpm-lock.yaml`.)

- [ ] **Step 5: Verify typecheck resolves spec types from source (no spec build needed)**

Run: `pnpm --filter @uxfactory/gate typecheck`
Expected: exit 0 — proving the `paths` mapping resolves `@uxfactory/spec` from source.

- [ ] **Step 6: Verify the package builds**

Run: `pnpm --filter @uxfactory/gate build`
Expected: exit 0; `packages/uxfactory-gate/dist/src/index.js` and `dist/src/report.js` exist.

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-gate pnpm-lock.yaml
git commit -m "feat(gate): scaffold @uxfactory/gate with report and result types"
```

---

## Task 2: Pure comparison helpers (`internal.ts`)

**Files:**

- Create: `packages/uxfactory-gate/src/internal.ts`
- Test: `packages/uxfactory-gate/test/internal.test.ts`

**Interfaces:**

- Consumes: `Spec`, `Edit` (type-only) from `@uxfactory/spec`; `ReportNode`, `ReportCounts`, `RenderReport` from `./report.js`.
- Produces (all pure functions):
  - `hasFrames(spec: Spec): boolean`
  - `hasSections(spec: Spec): boolean`
  - `expectedEditor(spec: Spec): Editor | undefined`
  - `expectedCounts(spec: Spec): ReportCounts`
  - `interface SpecChild { name: string; x: number; y: number; width?: number; height?: number }`
  - `collectChildren(spec: Spec): SpecChild[]`
  - `findNode(report: RenderReport, target: { id?: string; name?: string }): ReportNode | undefined`
  - `withinTolerance(a: number, b: number, tolerancePx: number): boolean`
  - `normalizeColor(c: string): string`
  - `numbersEqual(a: number, b: number): boolean`

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-gate/test/internal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  hasFrames,
  hasSections,
  expectedEditor,
  expectedCounts,
  collectChildren,
  findNode,
  withinTolerance,
  normalizeColor,
  numbersEqual,
} from "../src/internal.js";
import type { RenderReport } from "../src/report.js";

const designSpec = {
  editor: "figma" as const,
  frames: [
    {
      name: "f",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [
        { type: "shape" as const, name: "box", x: 10, y: 20, width: 30, height: 40 },
        { type: "instance" as const, name: "lambda", asset: "aws:lambda", x: 50, y: 60 },
      ],
    },
  ],
  connectors: [{ from: "box", to: "lambda" }],
};

const figjamSpec = {
  editor: "figjam" as const,
  sections: [
    {
      name: "s",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      children: [{ type: "sticky" as const, name: "note", x: 1, y: 2, characters: "hi" }],
    },
  ],
};

const editOnlySpec = {
  edits: [
    { id: "1:2", set: { x: 5 } },
    { name: "redis", set: { characters: "Redis" } },
  ],
};

const report: RenderReport = {
  renderId: "r",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "f",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 2, connectors: 1 },
  nodes: [
    { id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40 },
    { id: "3:4", name: "lambda", type: "instance", x: 50, y: 60, w: 48, h: 48 },
  ],
};

describe("spec-shape guards", () => {
  it("detects frames and sections", () => {
    expect(hasFrames(designSpec)).toBe(true);
    expect(hasSections(designSpec)).toBe(false);
    expect(hasSections(figjamSpec)).toBe(true);
    expect(hasFrames(editOnlySpec)).toBe(false);
  });
});

describe("expectedEditor", () => {
  it("is figma for design specs", () => expect(expectedEditor(designSpec)).toBe("figma"));
  it("is figjam for figjam specs", () => expect(expectedEditor(figjamSpec)).toBe("figjam"));
  it("is undefined for an editor-less edit-only spec", () =>
    expect(expectedEditor(editOnlySpec)).toBeUndefined());
  it("reads the explicit editor on an edit-only spec", () =>
    expect(expectedEditor({ editor: "figjam", edits: [{ id: "1", set: { x: 1 } }] })).toBe(
      "figjam",
    ));
});

describe("expectedCounts", () => {
  it("counts frames, objects, connectors for a design spec", () => {
    expect(expectedCounts(designSpec)).toEqual({
      frames: 1,
      sections: 0,
      objects: 2,
      connectors: 1,
    });
  });
  it("counts sections and objects for a figjam spec", () => {
    expect(expectedCounts(figjamSpec)).toEqual({
      frames: 0,
      sections: 1,
      objects: 1,
      connectors: 0,
    });
  });
});

describe("collectChildren", () => {
  it("flattens frame children with geometry", () => {
    const kids = collectChildren(designSpec);
    expect(kids.map((c) => c.name)).toEqual(["box", "lambda"]);
    expect(kids[0]).toEqual({ name: "box", x: 10, y: 20, width: 30, height: 40 });
    expect(kids[1]).toEqual({ name: "lambda", x: 50, y: 60, width: undefined, height: undefined });
  });
  it("returns [] for an edit-only spec", () => {
    expect(collectChildren(editOnlySpec)).toEqual([]);
  });
});

describe("findNode", () => {
  it("finds by id first", () => expect(findNode(report, { id: "3:4" })?.name).toBe("lambda"));
  it("falls back to first-match name", () =>
    expect(findNode(report, { name: "box" })?.id).toBe("1:2"));
  it("returns undefined when absent", () =>
    expect(findNode(report, { name: "ghost" })).toBeUndefined());
  it("prefers id over name when both given", () =>
    expect(findNode(report, { id: "1:2", name: "lambda" })?.name).toBe("box"));
});

describe("withinTolerance", () => {
  it("accepts a difference at the boundary", () =>
    expect(withinTolerance(120, 120.5, 0.5)).toBe(true));
  it("rejects a difference just past the boundary", () =>
    expect(withinTolerance(120, 120.6, 0.5)).toBe(false));
  it("accepts an exact match", () => expect(withinTolerance(10, 10, 0.5)).toBe(true));
});

describe("normalizeColor", () => {
  it("lowercases hex", () => expect(normalizeColor("#43A047")).toBe("#43a047"));
});

describe("numbersEqual", () => {
  it("treats tiny float drift as equal", () => expect(numbersEqual(0.1 + 0.2, 0.3)).toBe(true));
  it("treats real differences as unequal", () => expect(numbersEqual(0.5, 0.6)).toBe(false));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-gate/test/internal.test.ts`
Expected: FAIL — cannot find module `../src/internal.js`.

- [ ] **Step 3: Implement the helpers**

`packages/uxfactory-gate/src/internal.ts`:

```ts
import type { Spec, Editor } from "@uxfactory/spec";
import type { RenderReport, ReportNode, ReportCounts } from "./report.js";

/** True when the spec is a design spec (has `frames`). */
export function hasFrames(spec: Spec): boolean {
  return Object.prototype.hasOwnProperty.call(spec, "frames");
}

/** True when the spec is a figjam spec (has `sections`). */
export function hasSections(spec: Spec): boolean {
  return Object.prototype.hasOwnProperty.call(spec, "sections");
}

/** The editor a render of this spec should report, or undefined if unasserted. */
export function expectedEditor(spec: Spec): Editor | undefined {
  if (hasSections(spec)) return "figjam";
  if (hasFrames(spec)) return "figma";
  return spec.editor;
}

/** A child node flattened out of a frame/section, with the geometry the spec declares. */
export interface SpecChild {
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/** Flatten every child across a spec's frames or sections. Edit-only specs have none. */
export function collectChildren(spec: Spec): SpecChild[] {
  const children: SpecChild[] = [];
  const containers = hasFrames(spec)
    ? (spec as { frames: { children?: SpecChild[] }[] }).frames
    : hasSections(spec)
      ? (spec as { sections: { children?: SpecChild[] }[] }).sections
      : [];
  for (const container of containers) {
    for (const child of container.children ?? []) {
      children.push({
        name: child.name,
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
      });
    }
  }
  return children;
}

/** Structural counts a render of this spec should report. */
export function expectedCounts(spec: Spec): ReportCounts {
  const frames = hasFrames(spec) ? (spec as { frames: unknown[] }).frames.length : 0;
  const sections = hasSections(spec) ? (spec as { sections: unknown[] }).sections.length : 0;
  const objects = collectChildren(spec).length;
  const connectors =
    "connectors" in spec && Array.isArray((spec as { connectors?: unknown[] }).connectors)
      ? (spec as { connectors: unknown[] }).connectors.length
      : 0;
  return { frames, sections, objects, connectors };
}

/** Find a report node by id (preferred) or first-match name. */
export function findNode(
  report: RenderReport,
  target: { id?: string; name?: string },
): ReportNode | undefined {
  if (target.id !== undefined) {
    const byId = report.nodes.find((n) => n.id === target.id);
    if (byId) return byId;
  }
  if (target.name !== undefined) {
    return report.nodes.find((n) => n.name === target.name);
  }
  return undefined;
}

/** True when |a - b| <= tolerancePx (inclusive at the boundary). */
export function withinTolerance(a: number, b: number, tolerancePx: number): boolean {
  return Math.abs(a - b) <= tolerancePx;
}

/** Normalize a hex color for comparison (lowercased). */
export function normalizeColor(c: string): string {
  return c.toLowerCase();
}

/** Equality for non-geometry numbers, tolerant of IEEE-754 drift. */
export function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-gate/test/internal.test.ts`
Expected: PASS — all helper tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @uxfactory/gate typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-gate
git commit -m "feat(gate): add pure comparison helpers"
```

---

## Task 3: The five check functions (`checks.ts`)

**Files:**

- Create: `packages/uxfactory-gate/src/checks.ts`
- Test: `packages/uxfactory-gate/test/checks.test.ts`

**Interfaces:**

- Consumes: helpers from `./internal.js`; `Spec`, `Edit`, `EditSet` (type-only) from `@uxfactory/spec`; `RenderReport`, `ReportNode` from `./report.js`; `GateCheck`, `GateFailure`, `CheckId` from `./result.js`.
- Produces:
  - `interface CheckOutput { check: GateCheck; failures: GateFailure[] }`
  - `checkEditorType(spec: Spec, report: RenderReport): CheckOutput`
  - `checkCounts(spec: Spec, report: RenderReport): CheckOutput`
  - `checkPresence(spec: Spec, report: RenderReport): CheckOutput`
  - `checkGeometry(spec: Spec, report: RenderReport, tolerancePx: number): CheckOutput`
  - `checkEdits(spec: Spec, report: RenderReport, tolerancePx: number): CheckOutput`

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-gate/test/checks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  checkEditorType,
  checkCounts,
  checkPresence,
  checkGeometry,
  checkEdits,
} from "../src/checks.js";
import type { RenderReport } from "../src/report.js";

const baseReport = (over: Partial<RenderReport> = {}): RenderReport => ({
  renderId: "r",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "f",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40, fill: "#1e88e5" }],
  ...over,
});

const oneBoxDesign = {
  editor: "figma" as const,
  frames: [
    {
      name: "f",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [
        {
          type: "shape" as const,
          name: "box",
          x: 10,
          y: 20,
          width: 30,
          height: 40,
          fill: "#1E88E5",
        },
      ],
    },
  ],
};

describe("checkEditorType", () => {
  it("passes when editors match", () => {
    expect(checkEditorType(oneBoxDesign, baseReport()).check.status).toBe("PASS");
  });
  it("fails when editors differ", () => {
    const out = checkEditorType(oneBoxDesign, baseReport({ editor: "figjam" }));
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "editorType",
      property: "editor",
      expected: "figma",
      actual: "figjam",
    });
  });
  it("skips for an editor-less edit-only spec", () => {
    expect(
      checkEditorType({ edits: [{ id: "1", set: { x: 1 } }] }, baseReport()).check.status,
    ).toBe("SKIP");
  });
});

describe("checkCounts", () => {
  it("passes when all counts match", () => {
    expect(checkCounts(oneBoxDesign, baseReport()).check.status).toBe("PASS");
  });
  it("fails and lists the mismatched count", () => {
    const out = checkCounts(
      oneBoxDesign,
      baseReport({ counts: { frames: 2, sections: 0, objects: 1, connectors: 0 } }),
    );
    expect(out.check.status).toBe("FAIL");
    expect(out.failures).toContainEqual({
      check: "counts",
      property: "frames",
      expected: 1,
      actual: 2,
    });
  });
  it("skips for an edit-only spec", () => {
    expect(checkCounts({ edits: [{ id: "1", set: { x: 1 } }] }, baseReport()).check.status).toBe(
      "SKIP",
    );
  });
});

describe("checkPresence", () => {
  it("passes when every child is present", () => {
    expect(checkPresence(oneBoxDesign, baseReport()).check.status).toBe("PASS");
  });
  it("fails for a missing child", () => {
    const out = checkPresence(oneBoxDesign, baseReport({ nodes: [] }));
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "presence",
      name: "box",
      expected: "present",
      actual: "missing",
    });
  });
  it("checks edit targets for an edit-only spec", () => {
    const out = checkPresence({ edits: [{ id: "9:9", set: { x: 1 } }] }, baseReport());
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ check: "presence", nodeId: "9:9", actual: "missing" });
  });
});

describe("checkGeometry", () => {
  it("passes within tolerance", () => {
    const report = baseReport({
      nodes: [{ id: "1:2", name: "box", type: "shape", x: 10.4, y: 20, w: 30, h: 40 }],
    });
    expect(checkGeometry(oneBoxDesign, report, 0.5).check.status).toBe("PASS");
  });
  it("fails just past tolerance and names the property", () => {
    const report = baseReport({
      nodes: [{ id: "1:2", name: "box", type: "shape", x: 10.6, y: 20, w: 30, h: 40 }],
    });
    const out = checkGeometry(oneBoxDesign, report, 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "geometry",
      name: "box",
      property: "x",
      expected: 10,
      actual: 10.6,
      tolerancePx: 0.5,
    });
  });
  it("skips missing nodes (presence handles those)", () => {
    expect(checkGeometry(oneBoxDesign, baseReport({ nodes: [] }), 0.5).check.status).toBe("PASS");
  });
  it("skips for an edit-only spec", () => {
    expect(
      checkGeometry({ edits: [{ id: "1", set: { x: 1 } }] }, baseReport(), 0.5).check.status,
    ).toBe("SKIP");
  });
});

describe("checkEdits", () => {
  const editSpec = {
    edits: [{ id: "1:2", set: { x: 120, fill: "#43A047", characters: "Redis" } }],
  };
  it("passes when set properties are reflected", () => {
    const report = baseReport({
      nodes: [
        {
          id: "1:2",
          name: "box",
          type: "shape",
          x: 120,
          y: 20,
          w: 30,
          h: 40,
          fill: "#43a047",
          characters: "Redis",
        },
      ],
    });
    expect(checkEdits(editSpec, report, 0.5).check.status).toBe("PASS");
  });
  it("fails when a property is not reflected", () => {
    const report = baseReport({
      nodes: [
        {
          id: "1:2",
          name: "box",
          type: "shape",
          x: 999,
          y: 20,
          w: 30,
          h: 40,
          fill: "#43a047",
          characters: "Redis",
        },
      ],
    });
    const out = checkEdits(editSpec, report, 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({
      check: "edits",
      nodeId: "1:2",
      property: "x",
      expected: 120,
      actual: 999,
    });
  });
  it("fails when the edit target is missing", () => {
    const out = checkEdits({ edits: [{ id: "9:9", set: { x: 1 } }] }, baseReport(), 0.5);
    expect(out.check.status).toBe("FAIL");
    expect(out.failures[0]).toMatchObject({ check: "edits", nodeId: "9:9", actual: "missing" });
  });
  it("compares colors case-insensitively", () => {
    const report = baseReport({
      nodes: [
        {
          id: "1:2",
          name: "box",
          type: "shape",
          x: 120,
          y: 20,
          w: 30,
          h: 40,
          fill: "#43A047",
          characters: "Redis",
        },
      ],
    });
    expect(checkEdits(editSpec, report, 0.5).check.status).toBe("PASS");
  });
  it("skips a spec with no edits", () => {
    expect(checkEdits(oneBoxDesign, baseReport(), 0.5).check.status).toBe("SKIP");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-gate/test/checks.test.ts`
Expected: FAIL — cannot find module `../src/checks.js`.

- [ ] **Step 3: Implement the checks**

`packages/uxfactory-gate/src/checks.ts`:

```ts
import type { Spec, Edit, EditSet } from "@uxfactory/spec";
import type { RenderReport, ReportNode } from "./report.js";
import type { GateCheck, GateFailure } from "./result.js";
import {
  collectChildren,
  expectedCounts,
  expectedEditor,
  findNode,
  hasFrames,
  hasSections,
  normalizeColor,
  numbersEqual,
  withinTolerance,
} from "./internal.js";

/** A single check's outcome plus any concrete failures it produced. */
export interface CheckOutput {
  check: GateCheck;
  failures: GateFailure[];
}

const pass = (id: GateCheck["id"], extra: Partial<GateCheck> = {}): CheckOutput => ({
  check: { id, status: "PASS", ...extra },
  failures: [],
});
const skip = (id: GateCheck["id"]): CheckOutput => ({
  check: { id, status: "SKIP" },
  failures: [],
});
const fail = (
  id: GateCheck["id"],
  failures: GateFailure[],
  extra: Partial<GateCheck> = {},
): CheckOutput => ({ check: { id, status: "FAIL", ...extra }, failures });

/** True when the spec is edit-only (no frames, no sections). */
function isEditOnly(spec: Spec): boolean {
  return !hasFrames(spec) && !hasSections(spec);
}

/** Edits carried by any spec shape. */
function editsOf(spec: Spec): Edit[] {
  return "edits" in spec && Array.isArray((spec as { edits?: Edit[] }).edits)
    ? (spec as { edits: Edit[] }).edits
    : [];
}

export function checkEditorType(spec: Spec, report: RenderReport): CheckOutput {
  const expected = expectedEditor(spec);
  if (expected === undefined) return skip("editorType");
  if (report.editor === expected) return pass("editorType", { expected, actual: report.editor });
  return fail(
    "editorType",
    [{ check: "editorType", property: "editor", expected, actual: report.editor }],
    { expected, actual: report.editor },
  );
}

export function checkCounts(spec: Spec, report: RenderReport): CheckOutput {
  if (isEditOnly(spec)) return skip("counts");
  const expected = expectedCounts(spec);
  const actual = report.counts;
  const failures: GateFailure[] = [];
  for (const key of ["frames", "sections", "objects", "connectors"] as const) {
    if (expected[key] !== actual[key]) {
      failures.push({
        check: "counts",
        property: key,
        expected: expected[key],
        actual: actual[key],
      });
    }
  }
  return failures.length === 0
    ? pass("counts", { expected, actual })
    : fail("counts", failures, { expected, actual });
}

export function checkPresence(spec: Spec, report: RenderReport): CheckOutput {
  const failures: GateFailure[] = [];
  if (isEditOnly(spec)) {
    for (const edit of editsOf(spec)) {
      if (!findNode(report, { id: edit.id, name: edit.name })) {
        failures.push({
          check: "presence",
          nodeId: edit.id,
          name: edit.name,
          expected: "present",
          actual: "missing",
        });
      }
    }
  } else {
    for (const child of collectChildren(spec)) {
      if (!findNode(report, { name: child.name })) {
        failures.push({
          check: "presence",
          name: child.name,
          expected: "present",
          actual: "missing",
        });
      }
    }
  }
  return failures.length === 0 ? pass("presence") : fail("presence", failures);
}

export function checkGeometry(spec: Spec, report: RenderReport, tolerancePx: number): CheckOutput {
  if (isEditOnly(spec)) return skip("geometry");
  const failures: GateFailure[] = [];
  for (const child of collectChildren(spec)) {
    const node = findNode(report, { name: child.name });
    if (!node) continue; // presence handles missing nodes
    compareGeo(failures, node, "x", child.x, node.x, tolerancePx);
    compareGeo(failures, node, "y", child.y, node.y, tolerancePx);
    if (child.width !== undefined)
      compareGeo(failures, node, "width", child.width, node.w, tolerancePx);
    if (child.height !== undefined)
      compareGeo(failures, node, "height", child.height, node.h, tolerancePx);
  }
  return failures.length === 0
    ? pass("geometry", { tolerancePx })
    : fail("geometry", failures, { tolerancePx });
}

function compareGeo(
  out: GateFailure[],
  node: ReportNode,
  property: string,
  expected: number,
  actual: number,
  tolerancePx: number,
): void {
  if (!withinTolerance(expected, actual, tolerancePx)) {
    out.push({
      check: "geometry",
      nodeId: node.id,
      name: node.name,
      property,
      expected,
      actual,
      tolerancePx,
    });
  }
}

export function checkEdits(spec: Spec, report: RenderReport, tolerancePx: number): CheckOutput {
  const edits = editsOf(spec);
  if (edits.length === 0) return skip("edits");
  const failures: GateFailure[] = [];
  for (const edit of edits) {
    const node = findNode(report, { id: edit.id, name: edit.name });
    if (!node) {
      failures.push({
        check: "edits",
        nodeId: edit.id,
        name: edit.name,
        expected: "present",
        actual: "missing",
      });
      continue;
    }
    for (const [property, value] of Object.entries(edit.set) as [keyof EditSet, unknown][]) {
      compareEditProp(failures, node, property, value, tolerancePx);
    }
  }
  return failures.length === 0 ? pass("edits") : fail("edits", failures);
}

const GEOMETRY_PROPS = new Set<keyof EditSet>(["x", "y", "width", "height"]);
const COLOR_PROPS = new Set<keyof EditSet>(["fill", "stroke"]);

function compareEditProp(
  out: GateFailure[],
  node: ReportNode,
  property: keyof EditSet,
  value: unknown,
  tolerancePx: number,
): void {
  const actual = reportValueFor(node, property);
  const base = { check: "edits" as const, nodeId: node.id, name: node.name, property };

  if (GEOMETRY_PROPS.has(property)) {
    if (
      typeof value !== "number" ||
      typeof actual !== "number" ||
      !withinTolerance(value, actual, tolerancePx)
    ) {
      out.push({ ...base, expected: value, actual, tolerancePx });
    }
    return;
  }
  if (COLOR_PROPS.has(property)) {
    if (
      typeof value !== "string" ||
      typeof actual !== "string" ||
      normalizeColor(value) !== normalizeColor(actual)
    ) {
      out.push({ ...base, expected: value, actual });
    }
    return;
  }
  if (typeof value === "number" && typeof actual === "number") {
    if (!numbersEqual(value, actual)) out.push({ ...base, expected: value, actual });
    return;
  }
  if (value !== actual) out.push({ ...base, expected: value, actual });
}

/** Read the report-node property corresponding to an edit-set property (width→w, height→h). */
function reportValueFor(node: ReportNode, property: keyof EditSet): unknown {
  if (property === "width") return node.w;
  if (property === "height") return node.h;
  return (node as Record<string, unknown>)[property];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-gate/test/checks.test.ts`
Expected: PASS — all check tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @uxfactory/gate typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-gate
git commit -m "feat(gate): implement the five gate checks"
```

---

## Task 4: `gate()` orchestrator, public exports & determinism

**Files:**

- Create: `packages/uxfactory-gate/src/gate.ts`
- Modify: `packages/uxfactory-gate/src/index.ts`
- Test: `packages/uxfactory-gate/test/gate.test.ts`

**Interfaces:**

- Consumes: the five check functions from `./checks.js`; `Spec` (type-only); `RenderReport`; `GateResult`, `GateCheck`, `GateFailure`, `GateOptions`, `CheckId`.
- Produces: `function gate(spec: Spec, report: RenderReport, options?: GateOptions): GateResult`, re-exported from the package root alongside the types.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-gate/test/gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gate } from "../src/gate.js";
import type { RenderReport } from "../src/report.js";

const report: RenderReport = {
  renderId: "r_1",
  editor: "figma",
  page: "Architecture",
  pageKey: "0:1",
  fileName: "Infra",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 1 },
  nodes: [
    { id: "1:2", name: "api-gateway", type: "shape", x: 80, y: 80, w: 160, h: 64, fill: "#1e88e5" },
  ],
};

const matchingSpec = {
  editor: "figma" as const,
  frames: [
    {
      name: "vpc",
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      children: [
        {
          type: "shape" as const,
          name: "api-gateway",
          x: 80,
          y: 80,
          width: 160,
          height: 64,
          fill: "#1E88E5",
        },
      ],
    },
  ],
  connectors: [{ from: "api-gateway", to: "api-gateway" }],
};

describe("gate", () => {
  it("returns PASS with all five checks for a matching design spec", () => {
    const result = gate(matchingSpec, report);
    expect(result.status).toBe("PASS");
    expect(result.summary).toEqual({ checks: 5, passed: 4, failed: 0, skipped: 1 }); // edits skipped (no edits)
    expect(result.checks.map((c) => c.id)).toEqual([
      "editorType",
      "counts",
      "presence",
      "geometry",
      "edits",
    ]);
    expect(result.failures).toEqual([]);
    expect(result.renderId).toBe("r_1");
    expect(result.editor).toBe("figma");
    expect(result.pageKey).toBe("0:1");
    expect(result.fileName).toBe("Infra");
  });

  it("returns FAIL with the offending failures when geometry is off", () => {
    const moved: RenderReport = { ...report, nodes: [{ ...report.nodes[0]!, x: 180 }] };
    const result = gate(matchingSpec, moved);
    expect(result.status).toBe("FAIL");
    expect(result.failures).toContainEqual({
      check: "geometry",
      nodeId: "1:2",
      name: "api-gateway",
      property: "x",
      expected: 80,
      actual: 180,
      tolerancePx: 0.5,
    });
  });

  it("honors a checks subset", () => {
    const result = gate(matchingSpec, report, { checks: ["editorType"] });
    expect(result.summary.checks).toBe(1);
    expect(result.checks.map((c) => c.id)).toEqual(["editorType"]);
  });

  it("honors a custom tolerance", () => {
    const moved: RenderReport = { ...report, nodes: [{ ...report.nodes[0]!, x: 82 }] };
    expect(gate(matchingSpec, moved, { tolerancePx: 0.5 }).status).toBe("FAIL");
    expect(gate(matchingSpec, moved, { tolerancePx: 3 }).status).toBe("PASS");
  });

  it("echoes a caller-supplied verifyId and never invents one", () => {
    expect(gate(matchingSpec, report, { verifyId: "v_42" }).verifyId).toBe("v_42");
    expect(gate(matchingSpec, report).verifyId).toBeUndefined();
  });

  it("is deterministic: identical inputs yield deeply-equal results", () => {
    const a = gate(matchingSpec, report, { verifyId: "v_1" });
    const b = gate(matchingSpec, report, { verifyId: "v_1" });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-gate/test/gate.test.ts`
Expected: FAIL — cannot find module `../src/gate.js`.

- [ ] **Step 3: Implement the orchestrator**

`packages/uxfactory-gate/src/gate.ts`:

```ts
import type { Spec } from "@uxfactory/spec";
import type { RenderReport } from "./report.js";
import type { CheckId, GateCheck, GateFailure, GateOptions, GateResult } from "./result.js";
import {
  checkCounts,
  checkEdits,
  checkEditorType,
  checkGeometry,
  checkPresence,
  type CheckOutput,
} from "./checks.js";

/** Canonical order the checks run and appear in the result. */
const ALL_CHECKS: CheckId[] = ["editorType", "counts", "presence", "geometry", "edits"];

const DEFAULT_TOLERANCE_PX = 0.5;

function runCheck(id: CheckId, spec: Spec, report: RenderReport, tolerancePx: number): CheckOutput {
  switch (id) {
    case "editorType":
      return checkEditorType(spec, report);
    case "counts":
      return checkCounts(spec, report);
    case "presence":
      return checkPresence(spec, report);
    case "geometry":
      return checkGeometry(spec, report, tolerancePx);
    case "edits":
      return checkEdits(spec, report, tolerancePx);
  }
}

/**
 * Compare a spec against a render report and return a structured PASS/FAIL.
 * Pure and deterministic: no I/O, no clock — `verifyId` is supplied by the caller.
 */
export function gate(spec: Spec, report: RenderReport, options: GateOptions = {}): GateResult {
  const tolerancePx = options.tolerancePx ?? DEFAULT_TOLERANCE_PX;
  const requested = options.checks ?? ALL_CHECKS;

  const checks: GateCheck[] = [];
  const failures: GateFailure[] = [];
  for (const id of ALL_CHECKS) {
    if (!requested.includes(id)) continue;
    const output = runCheck(id, spec, report, tolerancePx);
    checks.push(output.check);
    failures.push(...output.failures);
  }

  const passed = checks.filter((c) => c.status === "PASS").length;
  const failed = checks.filter((c) => c.status === "FAIL").length;
  const skipped = checks.filter((c) => c.status === "SKIP").length;

  const result: GateResult = {
    status: failed === 0 ? "PASS" : "FAIL",
    renderId: report.renderId,
    editor: report.editor,
    pageKey: report.pageKey,
    fileName: report.fileName,
    summary: { checks: checks.length, passed, failed, skipped },
    checks,
    failures,
  };
  if (options.verifyId !== undefined) result.verifyId = options.verifyId;
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-gate/test/gate.test.ts`
Expected: PASS — all gate orchestration tests pass.

- [ ] **Step 5: Extend the public exports**

Replace `packages/uxfactory-gate/src/index.ts` with:

```ts
export { gate } from "./gate.js";
export type { ReportCounts, ReportNode, ReportEditDiff, RenderReport } from "./report.js";
export type {
  CheckId,
  CheckStatus,
  GateCheck,
  GateFailure,
  GateSummary,
  GateResult,
  GateOptions,
} from "./result.js";
```

- [ ] **Step 6: Run the full gate suite + typecheck**

Run: `pnpm vitest run packages/uxfactory-gate && pnpm --filter @uxfactory/gate typecheck`
Expected: PASS — all suites green; typecheck exit 0.

- [ ] **Step 7: Verify the built artifact runs standalone in real Node**

Run:

```bash
pnpm --filter @uxfactory/gate build
node --input-type=module -e "import('./packages/uxfactory-gate/dist/src/index.js').then(m => { const r = m.gate({ editor: 'figma', frames: [{ name: 'f', x: 0, y: 0, width: 100, height: 100, children: [{ type: 'shape', name: 'box', x: 10, y: 20, width: 30, height: 40 }] }] }, { renderId: 'r', editor: 'figma', page: 'p', pageKey: '0:1', fileName: 'f', fileKey: 'k', counts: { frames: 1, sections: 0, objects: 1, connectors: 0 }, nodes: [{ id: '1:2', name: 'box', type: 'shape', x: 10, y: 20, w: 30, h: 40 }] }); console.log('gate artifact ok:', r.status === 'PASS'); })"
```

Expected: prints `gate artifact ok: true` — proving the compiled gate runs in real Node ESM with no runtime dependency on `@uxfactory/spec` (types erased).

- [ ] **Step 8: Whole-monorepo green check**

Run: `pnpm typecheck && pnpm test && pnpm format:check`
Expected: all exit 0 (run `pnpm format` first if needed). Confirms the gate integrates without breaking the spec package.

- [ ] **Step 9: Commit**

```bash
git add packages/uxfactory-gate
git commit -m "feat(gate): add gate() orchestrator with options and determinism"
```

---

## Self-Review

**1. Spec coverage** (against PRD §10.1, §10.2, §7.4, §19 and the design doc Phase 1b):

- Pure `gate(spec, report) → GateResult`, no I/O → Task 4 (`gate.ts`, determinism test). ✅
- The five checks `editorType / counts / presence / geometry / edits` → Task 3. ✅
- `tolerancePx` default 0.5 + custom → Tasks 3 (boundary tests) + 4 (custom tolerance test). ✅
- `checks` subset option → Task 4. ✅
- GateResult shape per §10.1 (status, renderId, verifyId, editor, pageKey, fileName, summary, checks, failures) → Task 1 (types) + Task 4 (assembly/test). ✅
- RenderReport carries §7.4 fields the gate needs (editor, page/file + key, counts, node geometry incl. id/name/type/x/y/w/h, edit diffs) → Task 1. PNG previews intentionally omitted (gate needs no pixels, §12) — documented in `report.ts`. ✅
- presence by `id` else first-match `name` → Task 2 (`findNode`) + Task 3. ✅
- edits reflect `set` properties (geometry within tolerance, colors case-insensitive, others exact) → Task 3. ✅
- Determinism / no generated ids → Task 4 (verifyId from options; determinism test). ✅
- Skip-and-declare for non-applicable checks → Task 3 (SKIP statuses) + Task 4 (summary.skipped). ✅
- Type-only dependency on spec; builds & runs standalone → Task 1 (type imports) + Task 4 Step 7. ✅

**2. Placeholder scan:** No "TBD"/"TODO"/"handle edge cases"/"similar to". Every code step shows complete code. ✅

**3. Type consistency:** `CheckOutput`, `GateCheck`, `GateFailure`, `GateResult`, `GateOptions`, `CheckId`, `CheckStatus`, `RenderReport`, `ReportNode`, `ReportCounts`, and the helper names (`hasFrames`, `hasSections`, `expectedEditor`, `expectedCounts`, `collectChildren`, `findNode`, `withinTolerance`, `normalizeColor`, `numbersEqual`) are used identically across Tasks 1–4. Check function names (`checkEditorType/checkCounts/checkPresence/checkGeometry/checkEdits`) match between Task 3 (definition) and Task 4 (`runCheck` switch). The width→w / height→h mapping is centralized in `reportValueFor` (Task 3) and the geometry compare (Task 3). `gate` signature matches between Task 4 definition and the index re-export. ✅

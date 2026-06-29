# Phase 6 — Offline Batch Mode (`uxfactory batch` + batch-loop skill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PRD §13's self-contained offline batch mode — `uxfactory batch <dir>` runs ONE deterministic gate pass over a set of authored specs against registered guidance inputs (token conformance, requirement/state coverage, reuse, flow reachability), writes offline previews + a report, optionally stages a clean batch to the bridge for approval, and signals the agent's revise-and-re-run loop purely through its exit code — paired with a `skill/batch/SKILL.md` that teaches the agent that loop.

**Architecture:** The engine ships two things and no judge: (a) pure deterministic gates in `packages/uxfactory-cli/src/batch/` (registry parsing, four skip-and-declare checks, a `runBatch` aggregator) wired into a thin `batchCmd` whose exit code (`0` gates green / `1` a must-pass gate failed / `2` setup-or-transport) is the loop-termination contract; and (b) a `skill/batch/SKILL.md` that drives the loop — author/revise specs, run the gate, read findings on exit 1, revise, re-run, stop on exit 0 or `maxIterations`, then hand to the human. There is NO LLM, judge seam, or scoring inside the engine; the only "soft" check (flow) is a deterministic graph-reachability advisory. Everything runs offline against committed source; outputs land in the gitignored `.uxfactory/batch/`.

**Tech Stack:** Node `>=20.10`, TS 6.0.3, ESM/NodeNext with `.js` import extensions and `verbatimModuleSyntax`. Extends `@uxfactory/cli` (no new runtime deps — reuses `@uxfactory/spec` `validate`, `loadSpec`, `specToSvg`, `BridgeClient`, `EXIT`, `IO`). Tests are Vitest 4.1.9 (`.ts`) using per-test temp dirs and the existing in-process `startBridge` from `@uxfactory/bridge`. The batch-loop skill is a markdown file vendored into the Claude Code plugin by the existing Node vendor step.

## Global Constraints

- Node `>=20.10`; TS 6.0.3; ESM/NodeNext; `.js` import extensions; `verbatimModuleSyntax` on. WORK DIRECTLY ON `main` (no branch). NEVER touch `packages/uxfactory-agent`. NEVER reference any external cloud/runtime project.
- Extends `@uxfactory/cli`; batch logic in PURE modules under `packages/uxfactory-cli/src/batch/`. Plus a new canonical skill `skill/batch/SKILL.md` vendored into the cc plugin.
- Exit codes (the loop-termination contract): `uxfactory batch` → `0` all must-pass gates green (the loop STOPS), `1` a must-pass gate FAILED (the agent revises and re-runs), `2` setup/transport (bad/missing registry, unreadable inputs, --stage bridge error).
- Skip-and-declare (§13.2): a gate whose INPUT is absent is reported `skipped` with a reason — never silently passed/failed.
- Inputs are committed authored source (`design/` + `uxfactory.batch.json` at repo root); batch OUTPUTS (previews, report) go under `.uxfactory/batch/` (gitignored) — §13.6.
- Conventions: paths only in tsconfig.typecheck.json; @types/node devDep; built artifact verified; scoped commits (never `git add -A`).

### Layout added by this phase

```
packages/uxfactory-cli/
  src/
    batch/
      registry.ts      uxfactory.batch.json read/validate + input path resolution  (Task 1)
      checks.ts        pure deterministic gates (skip-and-declare, NO LLM)          (Tasks 2-3)
      run.ts           runBatch — aggregate the gates into a BatchReport            (Task 3)
    commands/
      batch.ts         batchCmd — replace the `batch` stub; previews + report + stage (Task 4)
    client.ts          add BridgeClient.postBatch (POST /batch)                      (Task 4)
    cli.ts             replace the `batch` stub row with the real command            (Task 4)
    index.ts           export the new public surface                                 (Tasks 1-4)
  test/
    registry.test.ts                                                                 (Task 1)
    checks-token-reuse.test.ts                                                        (Task 2)
    checks-coverage-flow.test.ts                                                      (Task 3)
    run.test.ts                                                                       (Task 3)
    batch.test.ts                                                                     (Task 4)
skill/batch/SKILL.md                  the loop skill (name: uxfactory-batch)          (Task 5)
clients/uxfactory-cc/
  scripts/vendor-skill.mjs            extended to also vendor the batch skill         (Task 5)
  skills/uxfactory-batch/SKILL.md     the committed vendored copy (byte-match)        (Task 5)
test/batch-skill.test.ts             skill frontmatter/sections/no-external/<500     (Task 5)
clients/uxfactory-cc/test/vendor-batch.test.ts   vendored byte-match + no .mcp.json   (Task 5)
```

> The existing `commands/stub.ts` and `stub.test.ts` stay: `review`/`snapshot` remain stubs. Only the `batch` row is removed from `cli.ts`'s `stubs` table; `stub.test.ts` calls `stubCmd(...)` directly (not through the program wiring), so it stays green. `.uxfactory/` is already in `.gitignore`, so `.uxfactory/batch/` outputs are ignored with no gitignore edit.

---

## Task 1: `src/batch/registry.ts` — the inputs registry (`uxfactory.batch.json`)

Parse, validate, and resolve `uxfactory.batch.json` (§13.1). `validateRegistry(raw)` is pure: requires `version: 1` and an `inputs` object whose optional `tokens`/`stories`/`flow` are strings and optional `reuse` is a string array; optional `maxIterations` is a positive integer (metadata the SKILL.md loop honors — the engine never loops). `resolveInputs(registry, registryDir)` resolves each registered input path relative to the registry's directory (absolute). `readRegistry(path)` reads + JSON-parses + validates + resolves, returning a discriminated result; it never throws on bad input (a bad/missing registry is a setup error the caller maps to exit 2).

**Files:**

- Create: `packages/uxfactory-cli/src/batch/registry.ts`
- Modify: `packages/uxfactory-cli/src/index.ts` (export the registry surface)
- Test: `packages/uxfactory-cli/test/registry.test.ts`

**Interfaces:**

```ts
export interface BatchInputs {
  tokens?: string;
  stories?: string;
  flow?: string;
  reuse?: string[];
}
export interface BatchRegistry {
  version: 1;
  inputs: BatchInputs;
  maxIterations?: number;
}
export interface ResolvedInputs {
  tokens: string | null; // absolute path, or null when not registered
  stories: string | null;
  flow: string | null;
  reuse: string[]; // absolute paths (empty when not registered)
}
export type ReadRegistryResult =
  { ok: true; registry: BatchRegistry; inputs: ResolvedInputs } | { ok: false; message: string };

export function validateRegistry(
  raw: unknown,
): { ok: true; registry: BatchRegistry } | { ok: false; message: string };
export function resolveInputs(registry: BatchRegistry, registryDir: string): ResolvedInputs;
export function readRegistry(registryPath: string): Promise<ReadRegistryResult>;
```

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-cli/test/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateRegistry, resolveInputs, readRegistry } from "../src/batch/registry.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uxf-registry-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("validateRegistry", () => {
  it("accepts a minimal valid registry", () => {
    const res = validateRegistry({ version: 1, inputs: {} });
    expect(res.ok).toBe(true);
  });

  it("accepts the full input set with maxIterations", () => {
    const res = validateRegistry({
      version: 1,
      inputs: {
        tokens: "design/tokens.ds.json",
        stories: "design/stories.json",
        flow: "design/flow.json",
        reuse: ["specs/a.uxfactory.json"],
      },
      maxIterations: 6,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a wrong version", () => {
    const res = validateRegistry({ version: 2, inputs: {} });
    expect(res.ok).toBe(false);
  });

  it("rejects a missing inputs object", () => {
    expect(validateRegistry({ version: 1 }).ok).toBe(false);
  });

  it("rejects a non-string tokens path and a non-array reuse", () => {
    expect(validateRegistry({ version: 1, inputs: { tokens: 5 } }).ok).toBe(false);
    expect(validateRegistry({ version: 1, inputs: { reuse: "x" } }).ok).toBe(false);
  });

  it("rejects a non-positive / non-integer maxIterations", () => {
    expect(validateRegistry({ version: 1, inputs: {}, maxIterations: 0 }).ok).toBe(false);
    expect(validateRegistry({ version: 1, inputs: {}, maxIterations: 1.5 }).ok).toBe(false);
  });
});

describe("resolveInputs", () => {
  it("resolves registered paths relative to the registry dir; null/empty when absent", () => {
    const out = resolveInputs(
      { version: 1, inputs: { tokens: "design/tokens.ds.json", reuse: ["a.json", "b.json"] } },
      "/repo",
    );
    expect(out.tokens).toBe(path.resolve("/repo", "design/tokens.ds.json"));
    expect(out.stories).toBeNull();
    expect(out.flow).toBeNull();
    expect(out.reuse).toEqual([path.resolve("/repo", "a.json"), path.resolve("/repo", "b.json")]);
  });
});

describe("readRegistry", () => {
  it("reads + validates + resolves a real file", async () => {
    await mkdir(path.join(dir, "design"), { recursive: true });
    const file = path.join(dir, "uxfactory.batch.json");
    await writeFile(
      file,
      JSON.stringify({ version: 1, inputs: { tokens: "design/tokens.ds.json" } }),
      "utf8",
    );
    const res = await readRegistry(file);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.registry.version).toBe(1);
      expect(res.inputs.tokens).toBe(path.join(dir, "design", "tokens.ds.json"));
    }
  });

  it("returns ok:false for a missing file", async () => {
    const res = await readRegistry(path.join(dir, "nope.json"));
    expect(res.ok).toBe(false);
  });

  it("returns ok:false for invalid JSON", async () => {
    const file = path.join(dir, "uxfactory.batch.json");
    await writeFile(file, "{ not json", "utf8");
    const res = await readRegistry(file);
    expect(res.ok).toBe(false);
  });

  it("returns ok:false for a schema-invalid registry", async () => {
    const file = path.join(dir, "uxfactory.batch.json");
    await writeFile(file, JSON.stringify({ version: 9, inputs: {} }), "utf8");
    const res = await readRegistry(file);
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/registry.test.ts`
Expected: FAIL — `../src/batch/registry.js` does not exist yet (cannot find module).

- [ ] **Step 3: Implement `src/batch/registry.ts` (complete)**

`packages/uxfactory-cli/src/batch/registry.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

/** The `inputs` block of `uxfactory.batch.json` — each entry is a path (relative to the manifest). */
export interface BatchInputs {
  /** Design-system token register (colors → hex). */
  tokens?: string;
  /** User stories + acceptance criteria. */
  stories?: string;
  /** A declared user-flow step sequence. */
  flow?: string;
  /** Existing spec files to compose/reuse against. */
  reuse?: string[];
}

/** The committed `uxfactory.batch.json` manifest (§13.1). */
export interface BatchRegistry {
  version: 1;
  inputs: BatchInputs;
  /** Loop budget honored by the batch SKILL.md — the engine itself never loops. */
  maxIterations?: number;
}

/** Registry input paths resolved to absolute filesystem paths (null = not registered). */
export interface ResolvedInputs {
  tokens: string | null;
  stories: string | null;
  flow: string | null;
  reuse: string[];
}

/** Outcome of reading a registry: resolved inputs on success, a setup message on failure. */
export type ReadRegistryResult =
  { ok: true; registry: BatchRegistry; inputs: ResolvedInputs } | { ok: false; message: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure structural validation of a parsed registry. Never throws. */
export function validateRegistry(
  raw: unknown,
): { ok: true; registry: BatchRegistry } | { ok: false; message: string } {
  if (!isPlainObject(raw)) return { ok: false, message: "registry must be a JSON object" };
  if (raw.version !== 1) return { ok: false, message: "registry version must be 1" };
  if (!isPlainObject(raw.inputs))
    return { ok: false, message: "registry.inputs must be an object" };

  const inputs = raw.inputs;
  for (const key of ["tokens", "stories", "flow"] as const) {
    const v = inputs[key];
    if (v !== undefined && typeof v !== "string") {
      return { ok: false, message: `registry.inputs.${key} must be a string path` };
    }
  }
  if (inputs.reuse !== undefined) {
    if (!Array.isArray(inputs.reuse) || inputs.reuse.some((e) => typeof e !== "string")) {
      return { ok: false, message: "registry.inputs.reuse must be an array of string paths" };
    }
  }
  if (raw.maxIterations !== undefined) {
    const n = raw.maxIterations;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
      return { ok: false, message: "registry.maxIterations must be a positive integer" };
    }
  }
  return { ok: true, registry: raw as unknown as BatchRegistry };
}

/** Resolve each registered input path relative to the manifest's directory. */
export function resolveInputs(registry: BatchRegistry, registryDir: string): ResolvedInputs {
  const abs = (p: string): string => path.resolve(registryDir, p);
  const { tokens, stories, flow, reuse } = registry.inputs;
  return {
    tokens: tokens !== undefined ? abs(tokens) : null,
    stories: stories !== undefined ? abs(stories) : null,
    flow: flow !== undefined ? abs(flow) : null,
    reuse: reuse !== undefined ? reuse.map(abs) : [],
  };
}

/** Read + JSON-parse + validate + resolve a registry file. Never throws on bad input. */
export async function readRegistry(registryPath: string): Promise<ReadRegistryResult> {
  let text: string;
  try {
    text = await readFile(registryPath, "utf8");
  } catch {
    return {
      ok: false,
      message: `cannot read ${registryPath} (run 'uxfactory batch' from the repo root)`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return { ok: false, message: `invalid JSON in ${registryPath}: ${(err as Error).message}` };
  }
  const result = validateRegistry(parsed);
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    registry: result.registry,
    inputs: resolveInputs(result.registry, path.dirname(registryPath)),
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm vitest run packages/uxfactory-cli/test/registry.test.ts`
Expected: PASS — valid/invalid validation (version, inputs object, field types, maxIterations), relative resolution (null/empty when absent), and readRegistry's missing-file / bad-JSON / schema-invalid setup failures.

- [ ] **Step 5: Export the registry surface from `index.ts`**

Append to `packages/uxfactory-cli/src/index.ts`:

```ts
export { readRegistry, validateRegistry, resolveInputs } from "./batch/registry.js";
export type {
  BatchRegistry,
  BatchInputs,
  ResolvedInputs,
  ReadRegistryResult,
} from "./batch/registry.js";
```

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @uxfactory/cli typecheck`
Expected: exit 0 — registry typechecks under strict / `noUncheckedIndexedAccess` / `verbatimModuleSyntax` (no type-only value imports; `path`/`readFile` are value imports).

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-cli
git commit -m "feat(cli): add uxfactory.batch.json registry parsing for offline batch (§13.1)"
```

---

## Task 2: `src/batch/checks.ts` — `tokenConformance` + `reuse` (pure, skip-and-declare)

Create the checks module with the shared result types, the v1 input-data types, the color/signature helpers, and the first two deterministic gates. `tokenConformance` (must): skip when no token register; else every spec fill/stroke must normalize to a registered color value (6-digit lowercase), ad-hoc → fail + findings. `reuse` (must): skip when no reuse specs; else a batch frame/section that duplicates one in a registered existing spec (same name + child shape) → fail + findings. Both are pure, return `CheckResult`, and NEVER call an LLM.

**Files:**

- Create: `packages/uxfactory-cli/src/batch/checks.ts`
- Modify: `packages/uxfactory-cli/src/index.ts` (export the checks surface)
- Test: `packages/uxfactory-cli/test/checks-token-reuse.test.ts`

**Interfaces:**

```ts
export type CheckStatus = "pass" | "fail" | "skip";
export type Severity = "must" | "advisory";
export interface BatchFinding {
  detail: string;
  ref?: string;
}
export interface CheckResult {
  id: string;
  status: CheckStatus;
  severity: Severity;
  findings: BatchFinding[];
  reason?: string; // why a check was skipped
}
export interface LoadedSpec {
  file: string;
  spec: Spec;
}
export interface TokenSet {
  colors: Record<string, string>;
}
export type ImpliedState = "empty" | "loading" | "error" | "success" | "edge";
export interface AcceptanceCriterion {
  statement: string;
  impliedState: ImpliedState;
}
export interface Story {
  id: string;
  role: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: AcceptanceCriterion[];
}
export interface StorySet {
  stories: Story[];
}
export interface Flow {
  steps: string[];
}

export function tokenConformance(specs: LoadedSpec[], tokens: TokenSet | null): CheckResult;
export function reuse(specs: LoadedSpec[], reuseSpecs: Spec[] | null): CheckResult;
```

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-cli/test/checks-token-reuse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tokenConformance, reuse } from "../src/batch/checks.js";
import type { LoadedSpec, TokenSet } from "../src/batch/checks.js";
import type { DesignSpec, Spec } from "@uxfactory/spec";

function loaded(spec: Spec, file = "a.uxfactory.json"): LoadedSpec {
  return { file, spec };
}

const tokens: TokenSet = { colors: { brand: "#1E88E5", ink: "#111111" } };

const conforming: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "home",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        {
          type: "shape",
          name: "card",
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          fill: "#1e88e5",
          stroke: "#111111",
        },
      ],
    },
  ],
};

const adhoc: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "home",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { type: "shape", name: "card", x: 0, y: 0, width: 50, height: 50, fill: "#abcdef" },
      ],
    },
  ],
};

describe("tokenConformance", () => {
  it("skips and declares when no token register is provided", () => {
    const r = tokenConformance([loaded(conforming)], null);
    expect(r.status).toBe("skip");
    expect(r.severity).toBe("must");
    expect(r.reason).toBeTruthy();
  });

  it("passes when every fill/stroke normalizes to a registered color", () => {
    const r = tokenConformance([loaded(conforming)], tokens);
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("fails with a finding for an ad-hoc color", () => {
    const r = tokenConformance([loaded(adhoc)], tokens);
    expect(r.status).toBe("fail");
    expect(r.findings.length).toBe(1);
    expect(r.findings[0]!.ref).toBe("#abcdef");
  });
});

describe("reuse", () => {
  it("skips and declares when no reuse specs are provided", () => {
    const r = reuse([loaded(conforming)], null);
    expect(r.status).toBe("skip");
    expect(r.severity).toBe("must");
  });

  it("passes when no batch container duplicates an existing spec", () => {
    const other: DesignSpec = {
      editor: "figma",
      frames: [{ name: "settings", x: 0, y: 0, width: 10, height: 10, children: [] }],
    };
    const r = reuse([loaded(conforming)], [other]);
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("fails when a batch frame duplicates one (same name + shape) in an existing spec", () => {
    const r = reuse([loaded(conforming)], [conforming]);
    expect(r.status).toBe("fail");
    expect(r.findings.length).toBe(1);
    expect(r.findings[0]!.ref).toBe("home");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/checks-token-reuse.test.ts`
Expected: FAIL — `../src/batch/checks.js` does not exist yet (cannot find module).

- [ ] **Step 3: Implement `src/batch/checks.ts` (complete — types, helpers, two gates)**

`packages/uxfactory-cli/src/batch/checks.ts`:

```ts
import type { Spec } from "@uxfactory/spec";

// --- result + input-data types ---------------------------------------------

/** Outcome of a single gate. */
export type CheckStatus = "pass" | "fail" | "skip";
/** Whether a gate blocks the loop (`must`) or only advises (`advisory`). */
export type Severity = "must" | "advisory";

/** One actionable problem a gate found, with reason and the thing it points at. */
export interface BatchFinding {
  detail: string;
  ref?: string;
}

/** The deterministic result of one gate over the batch (skip-and-declare via status:"skip"). */
export interface CheckResult {
  id: string;
  status: CheckStatus;
  severity: Severity;
  findings: BatchFinding[];
  reason?: string;
}

/** A validated batch spec paired with the file it came from. */
export interface LoadedSpec {
  file: string;
  spec: Spec;
}

/** tokens.ds.json (v1): a flat name → hex color register. */
export interface TokenSet {
  colors: Record<string, string>;
}

/** The view-state an acceptance criterion implies. */
export type ImpliedState = "empty" | "loading" | "error" | "success" | "edge";

/** One acceptance criterion: a statement plus the state it implies must exist. */
export interface AcceptanceCriterion {
  statement: string;
  impliedState: ImpliedState;
}

/** One user story with its acceptance criteria. */
export interface Story {
  id: string;
  role: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: AcceptanceCriterion[];
}

/** stories.json (v1). */
export interface StorySet {
  stories: Story[];
}

/** flow.json (v1): an ordered sequence of node/frame names. */
export interface Flow {
  steps: string[];
}

// --- shared spec walkers (pure) --------------------------------------------

/** A spec child reduced to the fields the checks read. */
interface AnyChild {
  type: string;
  name: string;
  fill?: unknown;
  stroke?: unknown;
}

/** Each container's (frame/section) children, regardless of editor. */
function containers(spec: Spec): { name: string; children: AnyChild[] }[] {
  if ("frames" in spec) {
    return spec.frames.map((f) => ({
      name: f.name,
      children: (f.children ?? []) as unknown as AnyChild[],
    }));
  }
  if ("sections" in spec) {
    return spec.sections.map((s) => ({
      name: s.name,
      children: (s.children ?? []) as unknown as AnyChild[],
    }));
  }
  return [];
}

/** Normalize a hex color to 6-digit lowercase (`#rrggbb`), or null if not a hex color. */
function normalizeColor(hex: string): string | null {
  const h = hex.trim().toLowerCase();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(h)) return null;
  const digits = h.slice(1);
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((c) => c + c)
          .join("")
      : digits;
  return `#${full}`;
}

/** Every fill/stroke color used in a spec, with a human-readable location. */
function specColors(loaded: LoadedSpec): { value: string; where: string }[] {
  const out: { value: string; where: string }[] = [];
  for (const c of containers(loaded.spec)) {
    for (const child of c.children) {
      if (typeof child.fill === "string")
        out.push({ value: child.fill, where: `${loaded.file}:${c.name}/${child.name}.fill` });
      if (typeof child.stroke === "string")
        out.push({ value: child.stroke, where: `${loaded.file}:${c.name}/${child.name}.stroke` });
    }
  }
  return out;
}

/** A name+shape signature for each container, used to detect duplicates against reuse specs. */
function containerSignatures(spec: Spec): { name: string; sig: string }[] {
  return containers(spec).map((c) => {
    const parts = c.children.map((ch) => `${ch.type}:${ch.name}`).sort();
    return { name: c.name, sig: `${c.name}::${parts.join(",")}` };
  });
}

// --- gates (Task 2) ---------------------------------------------------------

/**
 * token conformance (must) — every fill/stroke must reference a registered color.
 * Skip-and-declare when no token register is provided. A value that is ad-hoc
 * (or not even a hex color) becomes a finding. Pure + deterministic.
 */
export function tokenConformance(specs: LoadedSpec[], tokens: TokenSet | null): CheckResult {
  const id = "token-conformance";
  if (tokens === null) {
    return {
      id,
      status: "skip",
      severity: "must",
      findings: [],
      reason: "no token register registered",
    };
  }
  const registered = new Set<string>();
  for (const value of Object.values(tokens.colors ?? {})) {
    const n = normalizeColor(value);
    if (n !== null) registered.add(n);
  }
  const findings: BatchFinding[] = [];
  for (const loaded of specs) {
    for (const used of specColors(loaded)) {
      const n = normalizeColor(used.value);
      if (n === null || !registered.has(n)) {
        findings.push({
          detail: `ad-hoc color ${used.value} at ${used.where} is not a registered token`,
          ref: used.value,
        });
      }
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

/**
 * reuse (must) — a batch container that duplicates one already present in a
 * registered existing spec (same name + child shape) should be referenced, not
 * regenerated. Skip-and-declare when no reuse specs are provided. Pure + deterministic.
 */
export function reuse(specs: LoadedSpec[], reuseSpecs: Spec[] | null): CheckResult {
  const id = "reuse";
  if (reuseSpecs === null) {
    return {
      id,
      status: "skip",
      severity: "must",
      findings: [],
      reason: "no existing specs registered for reuse",
    };
  }
  const existing = new Map<string, string>(); // sig -> container name
  for (const spec of reuseSpecs) {
    for (const { name, sig } of containerSignatures(spec)) existing.set(sig, name);
  }
  const findings: BatchFinding[] = [];
  for (const loaded of specs) {
    for (const { name, sig } of containerSignatures(loaded.spec)) {
      if (existing.has(sig)) {
        findings.push({
          detail: `${loaded.file}:${name} duplicates an existing spec — reference it instead of regenerating`,
          ref: name,
        });
      }
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm vitest run packages/uxfactory-cli/test/checks-token-reuse.test.ts`
Expected: PASS — token skip-when-absent, pass on registered colors (incl. 6-digit normalization of `#1E88E5`→`#1e88e5`), fail on ad-hoc; reuse skip-when-absent, pass on no duplicate, fail on a same-name+shape duplicate.

- [ ] **Step 5: Export the checks surface from `index.ts`**

Append to `packages/uxfactory-cli/src/index.ts`:

```ts
export { tokenConformance, reuse } from "./batch/checks.js";
export type {
  CheckResult,
  CheckStatus,
  Severity,
  BatchFinding,
  LoadedSpec,
  TokenSet,
  StorySet,
  Story,
  AcceptanceCriterion,
  ImpliedState,
  Flow,
} from "./batch/checks.js";
```

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @uxfactory/cli typecheck`
Expected: exit 0 — `Spec` is `import type`; the `AnyChild` cast covers the optional `fill`/`stroke` across the child union; `noUncheckedIndexedAccess` is respected (no bare indexing; `Object.values` + `.split` only).

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-cli
git commit -m "feat(cli): add token-conformance + reuse batch gates (skip-and-declare) (§13.2)"
```

---

## Task 3: `src/batch/checks.ts` (cont.) `requirementCoverage` + `flowReachability` + `src/batch/run.ts`

Add the remaining two gates and the aggregator. `requirementCoverage` (must): skip when no stories; else NAME-BASED coverage — each `story.id` must map to ≥1 frame (a frame name containing the id), each AC's `impliedState` must map to some node (a node name containing the state keyword), and any frame containing NO story id is "story-less"; uncovered stories / uncovered AC-states / story-less frames → fail + findings. `flowReachability` (ADVISORY, deterministic): skip when no flow; else build a directed graph from the specs' connectors and verify each consecutive `flow.steps` pair is reachable; unreachable → advisory findings (status may be `fail` but severity `advisory`, so it NEVER trips the must-pass set). `runBatch` runs all four gates once and computes `mustPassFailed` / `clean`. FULLY DETERMINISTIC — no async, no judge, no LLM.

**Files:**

- Modify: `packages/uxfactory-cli/src/batch/checks.ts` (append two gates + their helpers)
- Create: `packages/uxfactory-cli/src/batch/run.ts`
- Modify: `packages/uxfactory-cli/src/index.ts` (export coverage/flow gates + runBatch)
- Test: `packages/uxfactory-cli/test/checks-coverage-flow.test.ts`
- Test: `packages/uxfactory-cli/test/run.test.ts`

**Interfaces:**

```ts
export function requirementCoverage(specs: LoadedSpec[], stories: StorySet | null): CheckResult;
export function flowReachability(specs: LoadedSpec[], flow: Flow | null): CheckResult;

export interface RunBatchInput {
  specs: LoadedSpec[];
  tokens: TokenSet | null;
  stories: StorySet | null;
  reuseSpecs: Spec[] | null;
  flow: Flow | null;
}
export interface BatchReport {
  checks: CheckResult[];
  mustPassFailed: boolean;
  clean: boolean;
}
export function runBatch(input: RunBatchInput): BatchReport;
```

- [ ] **Step 1: Write the failing tests**

`packages/uxfactory-cli/test/checks-coverage-flow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { requirementCoverage, flowReachability } from "../src/batch/checks.js";
import type { LoadedSpec, StorySet, Flow } from "../src/batch/checks.js";
import type { DesignSpec, Spec } from "@uxfactory/spec";

function loaded(spec: Spec, file = "a.uxfactory.json"): LoadedSpec {
  return { file, spec };
}

const stories: StorySet = {
  stories: [
    {
      id: "story-1",
      role: "user",
      goal: "see home",
      benefit: "fast",
      acceptanceCriteria: [
        { statement: "no data yet", impliedState: "empty" },
        { statement: "loaded", impliedState: "success" },
      ],
    },
  ],
};

const covered: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "story-1-home",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { type: "shape", name: "home-empty-state", x: 0, y: 0, width: 10, height: 10 },
        { type: "shape", name: "home-success-view", x: 0, y: 20, width: 10, height: 10 },
      ],
    },
  ],
};

describe("requirementCoverage", () => {
  it("skips and declares when no stories are provided", () => {
    expect(requirementCoverage([loaded(covered)], null).status).toBe("skip");
  });

  it("passes when every story + AC-state is covered and no frame is story-less", () => {
    const r = requirementCoverage([loaded(covered)], stories);
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("flags an uncovered story (no frame names the id)", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [{ name: "story-1-home", x: 0, y: 0, width: 1, height: 1, children: [] }],
    };
    const twoStories: StorySet = {
      stories: [
        ...stories.stories,
        { id: "story-2", role: "u", goal: "g", benefit: "b", acceptanceCriteria: [] },
      ],
    };
    const r = requirementCoverage([loaded(spec)], twoStories);
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.ref === "story-2")).toBe(true);
  });

  it("flags an uncovered AC-state (no node names the state keyword)", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "story-1-home",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          children: [{ type: "shape", name: "home-empty-state", x: 0, y: 0, width: 1, height: 1 }],
        },
      ],
    };
    const r = requirementCoverage([loaded(spec)], stories); // "success" state missing
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.detail.includes("success"))).toBe(true);
  });

  it("flags a story-less frame (its name contains no story id)", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "story-1-home",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          children: [
            { type: "shape", name: "home-empty-state", x: 0, y: 0, width: 1, height: 1 },
            { type: "shape", name: "home-success-view", x: 0, y: 10, width: 1, height: 1 },
          ],
        },
        { name: "orphan-frame", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
    };
    const r = requirementCoverage([loaded(spec)], stories);
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.ref === "orphan-frame")).toBe(true);
  });
});

describe("flowReachability (advisory)", () => {
  it("skips and declares when no flow is provided", () => {
    expect(flowReachability([loaded(covered)], null).status).toBe("skip");
  });

  it("is advisory and passes when each consecutive step is reachable via connectors", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "a", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "b", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "c", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
      connectors: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };
    const flow: Flow = { steps: ["a", "b", "c"] };
    const r = flowReachability([loaded(spec)], flow);
    expect(r.severity).toBe("advisory");
    expect(r.status).toBe("pass");
  });

  it("reports an advisory finding when a step pair is unreachable", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "a", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "b", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
      connectors: [],
    };
    const flow: Flow = { steps: ["a", "b"] };
    const r = flowReachability([loaded(spec)], flow);
    expect(r.severity).toBe("advisory");
    expect(r.status).toBe("fail");
    expect(r.findings.length).toBe(1);
  });
});
```

`packages/uxfactory-cli/test/run.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runBatch } from "../src/batch/run.js";
import type { LoadedSpec, TokenSet, Flow } from "../src/batch/checks.js";
import type { DesignSpec } from "@uxfactory/spec";

const tokens: TokenSet = { colors: { brand: "#1E88E5" } };

const adhoc: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "home",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      children: [{ type: "shape", name: "card", x: 0, y: 0, width: 1, height: 1, fill: "#abcdef" }],
    },
  ],
};

describe("runBatch", () => {
  it("skips every gate (all inputs absent) and is clean", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({ specs, tokens: null, stories: null, reuseSpecs: null, flow: null });
    expect(report.checks.length).toBe(4);
    expect(report.checks.every((c) => c.status === "skip")).toBe(true);
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });

  it("mustPassFailed when a must gate fails (ad-hoc color with a token register)", () => {
    const specs: LoadedSpec[] = [{ file: "a.uxfactory.json", spec: adhoc }];
    const report = runBatch({ specs, tokens, stories: null, reuseSpecs: null, flow: null });
    expect(report.mustPassFailed).toBe(true);
    expect(report.clean).toBe(false);
  });

  it("an advisory (flow) failure NEVER trips the must-pass set", () => {
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        { name: "a", x: 0, y: 0, width: 1, height: 1, children: [] },
        { name: "b", x: 0, y: 0, width: 1, height: 1, children: [] },
      ],
      connectors: [],
    };
    const flow: Flow = { steps: ["a", "b"] };
    const report = runBatch({
      specs: [{ file: "a.uxfactory.json", spec }],
      tokens: null,
      stories: null,
      reuseSpecs: null,
      flow,
    });
    const flowCheck = report.checks.find((c) => c.id === "flow-reachability")!;
    expect(flowCheck.status).toBe("fail");
    expect(flowCheck.severity).toBe("advisory");
    expect(report.mustPassFailed).toBe(false);
    expect(report.clean).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm vitest run packages/uxfactory-cli/test/checks-coverage-flow.test.ts packages/uxfactory-cli/test/run.test.ts`
Expected: FAIL — `requirementCoverage`/`flowReachability` are not exported yet, and `../src/batch/run.js` does not exist.

- [ ] **Step 3: Append the two gates + helpers to `src/batch/checks.ts`**

Add to the end of `packages/uxfactory-cli/src/batch/checks.ts`:

```ts
// --- gates (Task 3) ---------------------------------------------------------

/** Every container (frame/section) name across the batch. */
function frameNames(specs: LoadedSpec[]): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const loaded of specs)
    for (const c of containers(loaded.spec)) out.push({ file: loaded.file, name: c.name });
  return out;
}

/** Every node name across the batch (containers + children) for keyword search. */
function allNodeNames(specs: LoadedSpec[]): string[] {
  const names: string[] = [];
  for (const loaded of specs) {
    for (const c of containers(loaded.spec)) {
      names.push(c.name);
      for (const child of c.children) names.push(child.name);
    }
  }
  return names;
}

/** Build a directed name→names graph from every spec's connectors. */
function buildGraph(specs: LoadedSpec[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const loaded of specs) {
    const conns =
      "connectors" in loaded.spec && loaded.spec.connectors ? loaded.spec.connectors : [];
    for (const c of conns) {
      const set = adj.get(c.from) ?? new Set<string>();
      set.add(c.to);
      adj.set(c.from, set);
    }
  }
  return adj;
}

/** Is `to` reachable from `from` in the directed graph (trivially true if equal). */
function reachable(adj: Map<string, Set<string>>, from: string, to: string): boolean {
  if (from === to) return true;
  const seen = new Set<string>([from]);
  const stack: string[] = [from];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const next of adj.get(cur) ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/**
 * requirement & state coverage (must) — name-based traceability between stories
 * and the batch. Each story.id must be named by ≥1 frame; each AC.impliedState
 * keyword must appear in some node name; any frame naming no story id is story-less.
 * Skip-and-declare when no stories. Pure + deterministic (no LLM, no judge).
 */
export function requirementCoverage(specs: LoadedSpec[], stories: StorySet | null): CheckResult {
  const id = "requirement-coverage";
  if (stories === null) {
    return { id, status: "skip", severity: "must", findings: [], reason: "no stories registered" };
  }
  const storyList = stories.stories ?? [];
  const frames = frameNames(specs);
  const lowerFrames = frames.map((f) => ({ ...f, lname: f.name.toLowerCase() }));
  const lowerNodes = allNodeNames(specs).map((n) => n.toLowerCase());
  const findings: BatchFinding[] = [];

  for (const story of storyList) {
    const idl = story.id.toLowerCase();
    if (!lowerFrames.some((f) => f.lname.includes(idl))) {
      findings.push({
        detail: `story ${story.id} is not covered by any frame (no frame name contains "${story.id}")`,
        ref: story.id,
      });
    }
    for (const ac of story.acceptanceCriteria ?? []) {
      const kw = ac.impliedState.toLowerCase();
      if (!lowerNodes.some((n) => n.includes(kw))) {
        findings.push({
          detail: `story ${story.id} AC "${ac.statement}" implies a ${ac.impliedState} state with no matching node`,
          ref: story.id,
        });
      }
    }
  }

  const storyIds = storyList.map((s) => s.id.toLowerCase());
  for (const f of lowerFrames) {
    if (!storyIds.some((sid) => f.lname.includes(sid))) {
      findings.push({
        detail: `frame ${f.name} (${f.file}) has no story basis (its name contains no registered story id)`,
        ref: f.name,
      });
    }
  }

  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

/**
 * flow reachability (ADVISORY) — when a flow declares a step order, verify each
 * consecutive pair is reachable along the specs' connectors. Skip-and-declare when
 * no flow. Pure deterministic graph reachability — NO LLM. Always severity:"advisory",
 * so an unreachable finding never trips the must-pass set.
 */
export function flowReachability(specs: LoadedSpec[], flow: Flow | null): CheckResult {
  const id = "flow-reachability";
  if (flow === null) {
    return { id, status: "skip", severity: "advisory", findings: [], reason: "no flow registered" };
  }
  const steps = flow.steps ?? [];
  const adj = buildGraph(specs);
  const findings: BatchFinding[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i] as string;
    const to = steps[i + 1] as string;
    if (!reachable(adj, from, to)) {
      findings.push({
        detail: `flow step "${from}" → "${to}" is not reachable along any connector path`,
        ref: `${from}->${to}`,
      });
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "advisory", findings };
}
```

- [ ] **Step 4: Implement `src/batch/run.ts` (complete)**

`packages/uxfactory-cli/src/batch/run.ts`:

```ts
import { tokenConformance, requirementCoverage, reuse, flowReachability } from "./checks.js";
import type { CheckResult, LoadedSpec, TokenSet, StorySet, Flow } from "./checks.js";
import type { Spec } from "@uxfactory/spec";

/** Everything a single deterministic batch pass needs (inputs already loaded; null = absent). */
export interface RunBatchInput {
  specs: LoadedSpec[];
  tokens: TokenSet | null;
  stories: StorySet | null;
  reuseSpecs: Spec[] | null;
  flow: Flow | null;
}

/** The result of one deterministic pass — the artifact the report.json and exit code derive from. */
export interface BatchReport {
  checks: CheckResult[];
  mustPassFailed: boolean;
  clean: boolean;
}

/**
 * Run all four gates ONCE over the batch and aggregate. FULLY DETERMINISTIC:
 * no async, no clock, no randomness, no judge/LLM. `mustPassFailed` is true iff any
 * `severity:"must"` gate is `"fail"` (advisory gates never count); `clean = !mustPassFailed`.
 * This single pass IS the loop-termination signal — the SKILL.md loop, not the engine, iterates.
 */
export function runBatch(input: RunBatchInput): BatchReport {
  const checks: CheckResult[] = [
    tokenConformance(input.specs, input.tokens),
    requirementCoverage(input.specs, input.stories),
    reuse(input.specs, input.reuseSpecs),
    flowReachability(input.specs, input.flow),
  ];
  const mustPassFailed = checks.some((c) => c.severity === "must" && c.status === "fail");
  return { checks, mustPassFailed, clean: !mustPassFailed };
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm vitest run packages/uxfactory-cli/test/checks-coverage-flow.test.ts packages/uxfactory-cli/test/run.test.ts`
Expected: PASS — coverage skip/uncovered-story/uncovered-state/story-less/pass; flow skip/reachable-pass/unreachable-advisory-fail; runBatch all-skip-clean, must-fail, and advisory-never-trips-must-pass.

- [ ] **Step 6: Export coverage/flow gates + runBatch from `index.ts`**

Append to `packages/uxfactory-cli/src/index.ts`:

```ts
export { requirementCoverage, flowReachability } from "./batch/checks.js";
export { runBatch } from "./batch/run.js";
export type { RunBatchInput, BatchReport } from "./batch/run.js";
```

- [ ] **Step 7: Typecheck the package**

Run: `pnpm --filter @uxfactory/cli typecheck`
Expected: exit 0 — `Spec`/`CheckResult`/data types are `import type`; loop indices guarded against `noUncheckedIndexedAccess` via the `as string` at the two `steps[i]` reads; `stack.pop() as string` after the `length > 0` guard.

- [ ] **Step 8: Commit**

```bash
git add packages/uxfactory-cli
git commit -m "feat(cli): add coverage + flow-reachability gates and runBatch aggregator (§13.2-13.3)"
```

---

## Task 4: `src/commands/batch.ts` (replace the stub) + `BridgeClient.postBatch` + cli/index wiring

Implement `batchCmd` and wire it. It reads `uxfactory.batch.json` (absent/invalid → 2), loads every `*.uxfactory.json` under `<dir>` and validates each (invalid → 2), loads the registered inputs that EXIST (skip-and-declare absent; a registered-but-unreadable input → 2), runs `runBatch`, writes one `specToSvg` preview per spec under `.uxfactory/batch/previews/` and the report under `.uxfactory/batch/report.json`, prints a summary (or `--json`), and — with `--stage` on a clean batch — POSTs the spec items + SVG preview refs to the bridge (`POST /batch`; bridge error → 2). Exit: clean → 0, must-pass failed → 1, setup/transport → 2. Add `BridgeClient.postBatch`. Replace the `batch` stub in `cli.ts` and wire `--json`/`--stage`/`--data-dir`/`--bridge`.

**Files:**

- Create: `packages/uxfactory-cli/src/commands/batch.ts`
- Modify: `packages/uxfactory-cli/src/client.ts` (add `postBatch`)
- Modify: `packages/uxfactory-cli/src/cli.ts` (remove the `batch` stub row; add the real command)
- Modify: `packages/uxfactory-cli/src/index.ts` (export `batchCmd` + `BatchFlags`)
- Test: `packages/uxfactory-cli/test/batch.test.ts`

**Interfaces:**

```ts
// client.ts
async postBatch(items: { spec: unknown; preview?: string }[]): Promise<{ batchId: string }>;

// commands/batch.ts
export interface BatchFlags {
  json?: boolean;
  stage?: boolean;
  dataDir: string; // resolved <cwd>/.uxfactory
  cwd?: string; // where uxfactory.batch.json lives (default process.cwd())
}
export function batchCmd(
  specsDir: string,
  flags: BatchFlags,
  io: IO,
  client: BridgeClient,
): Promise<number>;
```

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-cli/test/batch.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import { BridgeClient } from "../src/client.js";
import { batchCmd } from "../src/commands/batch.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

let root: string;
let dataDir: string;
let specsDir: string;
let handle: { url: string; close: () => Promise<void> };
let client: BridgeClient;

const cleanSpec = {
  editor: "figma",
  frames: [
    {
      name: "story-1-home",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        {
          type: "shape",
          name: "home-empty-state",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          fill: "#1E88E5",
        },
        {
          type: "shape",
          name: "home-success-view",
          x: 0,
          y: 20,
          width: 10,
          height: 10,
          fill: "#111111",
        },
      ],
    },
  ],
};

const tokens = { colors: { brand: "#1E88E5", ink: "#111111" } };
const stories = {
  stories: [
    {
      id: "story-1",
      role: "user",
      goal: "see home",
      benefit: "fast",
      acceptanceCriteria: [
        { statement: "no data", impliedState: "empty" },
        { statement: "ok", impliedState: "success" },
      ],
    },
  ],
};

async function writeRegistry(inputs: Record<string, unknown>): Promise<void> {
  await writeFile(
    path.join(root, "uxfactory.batch.json"),
    JSON.stringify({ version: 1, inputs, maxIterations: 6 }),
    "utf8",
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-batch-"));
  dataDir = path.join(root, ".uxfactory");
  specsDir = path.join(root, "specs");
  await mkdir(specsDir, { recursive: true });
  await mkdir(path.join(root, "design"), { recursive: true });
  await writeFile(path.join(specsDir, "home.uxfactory.json"), JSON.stringify(cleanSpec), "utf8");
  handle = await startBridge({ dataDir: path.join(root, ".bridge"), port: 0 });
  client = new BridgeClient(handle.url);
});

afterEach(async () => {
  await handle.close();
  await rm(root, { recursive: true, force: true });
});

describe("batchCmd", () => {
  it("returns 2 when uxfactory.batch.json is missing", async () => {
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.TRANSPORT);
  });

  it("clean batch → 0, writes a report and a preview per spec", async () => {
    await writeFile(path.join(root, "design", "tokens.ds.json"), JSON.stringify(tokens), "utf8");
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ tokens: "design/tokens.ds.json", stories: "design/stories.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.OK);
    const report = JSON.parse(await readFile(path.join(dataDir, "batch", "report.json"), "utf8"));
    expect(report.clean).toBe(true);
    const previews = await readdir(path.join(dataDir, "batch", "previews"));
    expect(previews).toContain("home.uxfactory.svg");
  });

  it("a must-pass gate failure → 1 (ad-hoc color)", async () => {
    await writeFile(
      path.join(specsDir, "home.uxfactory.json"),
      JSON.stringify({
        editor: "figma",
        frames: [
          {
            name: "story-1-home",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            children: [
              {
                type: "shape",
                name: "home-empty-state",
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                fill: "#abcdef",
              },
              { type: "shape", name: "home-success-view", x: 0, y: 1, width: 1, height: 1 },
            ],
          },
        ],
      }),
      "utf8",
    );
    await writeFile(path.join(root, "design", "tokens.ds.json"), JSON.stringify(tokens), "utf8");
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ tokens: "design/tokens.ds.json", stories: "design/stories.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.GATE_FAIL);
    const report = JSON.parse(await readFile(path.join(dataDir, "batch", "report.json"), "utf8"));
    expect(report.mustPassFailed).toBe(true);
  });

  it("skip-and-declare: absent inputs are reported as skipped, batch still clean → 0", async () => {
    await writeRegistry({}); // no inputs registered
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, json: true, cwd: root }, io, client)).toBe(EXIT.OK);
    const printed = JSON.parse(io.outText());
    expect(printed.checks.every((c: { status: string }) => c.status === "skip")).toBe(true);
  });

  it("returns 2 when a registered input file is unreadable", async () => {
    await writeRegistry({ tokens: "design/missing.ds.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.TRANSPORT);
  });

  it("--stage on a clean batch posts the specs + previews to the bridge", async () => {
    await writeFile(path.join(root, "design", "tokens.ds.json"), JSON.stringify(tokens), "utf8");
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ tokens: "design/tokens.ds.json", stories: "design/stories.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, stage: true, cwd: root }, io, client)).toBe(EXIT.OK);
    const res = await fetch(`${handle.url}/batch`);
    expect(res.status).toBe(200);
    const batch = (await res.json()) as { items: { spec: unknown; preview?: string }[] };
    expect(batch.items.length).toBe(1);
    expect(typeof batch.items[0]!.preview).toBe("string");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/batch.test.ts`
Expected: FAIL — `../src/commands/batch.js` does not exist yet (cannot find module).

- [ ] **Step 3: Add `postBatch` to `BridgeClient` (`src/client.ts`)**

Add this method to the `BridgeClient` class in `packages/uxfactory-cli/src/client.ts` (place it after the `verify` method, before the private `request`):

```ts
  /** POST /batch → stage a pre-validated batch (specs + preview refs) for approval. Throws on a non-200. */
  async postBatch(items: { spec: unknown; preview?: string }[]): Promise<{ batchId: string }> {
    const res = await this.request("/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const body = await this.json(res);
    if (res.status !== 200) {
      throw new TransportError(`bridge rejected the batch (HTTP ${res.status})`);
    }
    return body as { batchId: string };
  }
```

Add the `TransportError` value import at the top of `client.ts` (it currently imports it only as part of the existing `import { TransportError } from "./exit.js";` — confirm that line is present; it is used by `request`/`json`, so no new import line is needed).

- [ ] **Step 4: Implement `src/commands/batch.ts` (complete)**

`packages/uxfactory-cli/src/commands/batch.ts`:

```ts
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { EXIT, TransportError } from "../exit.js";
import { loadSpec, printSpecProblem } from "../spec-file.js";
import { readRegistry } from "../batch/registry.js";
import { runBatch } from "../batch/run.js";
import { specToSvg } from "../render/svg.js";
import type { LoadedSpec, TokenSet, StorySet, Flow } from "../batch/checks.js";
import type { BatchReport } from "../batch/run.js";
import type { Spec } from "@uxfactory/spec";
import type { IO } from "../io.js";
import type { BridgeClient } from "../client.js";

/** Flags for `uxfactory batch`. */
export interface BatchFlags {
  json?: boolean;
  stage?: boolean;
  dataDir: string;
  /** Repo root where uxfactory.batch.json + the design/ inputs live (default process.cwd()). */
  cwd?: string;
}

/** Read + JSON-parse a registered input; throws on any failure (→ setup error). */
async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

/**
 * `uxfactory batch <dir>` — ONE deterministic, self-contained offline pass (§13).
 * Reads the registry, loads + validates the batch specs, loads the registered inputs
 * that exist (skip-and-declare absent), runs the gates, writes offline previews + a
 * report under `.uxfactory/batch/`, optionally stages a clean batch to the bridge, and
 * returns the loop-termination exit code: 0 clean / 1 must-pass failed / 2 setup or transport.
 */
export async function batchCmd(
  specsDir: string,
  flags: BatchFlags,
  io: IO,
  client: BridgeClient,
): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();

  // 1. registry (absent/invalid → 2)
  const reg = await readRegistry(path.join(cwd, "uxfactory.batch.json"));
  if (!reg.ok) {
    io.err(reg.message);
    return EXIT.TRANSPORT;
  }

  // 2. load + validate the batch specs (invalid/unreadable → 2)
  let entries: string[];
  try {
    entries = (await readdir(specsDir)).filter((f) => f.endsWith(".uxfactory.json")).sort();
  } catch {
    io.err(`cannot read specs directory ${specsDir}`);
    return EXIT.TRANSPORT;
  }
  if (entries.length === 0) {
    io.err(`no *.uxfactory.json specs found in ${specsDir}`);
    return EXIT.TRANSPORT;
  }
  const specs: LoadedSpec[] = [];
  for (const name of entries) {
    const full = path.join(specsDir, name);
    const result = await loadSpec(full);
    if (!result.ok) return printSpecProblem(io, result, flags.json);
    specs.push({ file: name, spec: result.spec as Spec });
  }

  // 3. load the registered inputs that EXIST (absent → null = skip; registered-but-unreadable → 2)
  let tokens: TokenSet | null = null;
  let stories: StorySet | null = null;
  let flow: Flow | null = null;
  let reuseSpecs: Spec[] | null = null;
  try {
    if (reg.inputs.tokens !== null) tokens = await readJson<TokenSet>(reg.inputs.tokens);
    if (reg.inputs.stories !== null) stories = await readJson<StorySet>(reg.inputs.stories);
    if (reg.inputs.flow !== null) flow = await readJson<Flow>(reg.inputs.flow);
    if (reg.inputs.reuse.length > 0) {
      reuseSpecs = [];
      for (const file of reg.inputs.reuse) {
        const result = await loadSpec(file);
        if (!result.ok) {
          io.err(`unreadable/invalid reuse spec: ${file}`);
          return EXIT.TRANSPORT;
        }
        reuseSpecs.push(result.spec as Spec);
      }
    }
  } catch (err) {
    io.err(`cannot read a registered input: ${(err as Error).message}`);
    return EXIT.TRANSPORT;
  }

  // 4. ONE deterministic pass
  const report: BatchReport = runBatch({ specs, tokens, stories, reuseSpecs, flow });

  // 5. offline previews per spec (§13.6)
  const batchDir = path.join(flags.dataDir, "batch");
  const previewDir = path.join(batchDir, "previews");
  await mkdir(previewDir, { recursive: true });
  const previews = new Map<string, string>();
  for (const s of specs) {
    const svg = specToSvg(s.spec);
    previews.set(s.file, svg);
    const out = s.file.replace(/\.[^.]+$/, "") + ".svg";
    await writeFile(path.join(previewDir, out), svg, "utf8");
  }

  // 6. report.json + summary
  const reportDoc = { specs: specs.map((s) => s.file), ...report };
  await writeFile(path.join(batchDir, "report.json"), JSON.stringify(reportDoc, null, 2), "utf8");
  if (flags.json) {
    io.out(JSON.stringify(reportDoc));
  } else {
    io.out(`batch: ${report.clean ? "clean" : "FAILED"} — ${specs.length} spec(s)`);
    for (const c of report.checks) {
      const tag = `[${c.severity}] ${c.id}: ${c.status}`;
      io.out(c.status === "skip" ? `  ${tag} (${c.reason ?? "no input"})` : `  ${tag}`);
      for (const f of c.findings) io.out(`    - ${f.detail}`);
    }
  }

  // 7. stage a clean batch to the bridge (bridge error → 2)
  if (flags.stage === true && report.clean) {
    try {
      const { batchId } = await client.postBatch(
        specs.map((s) => ({ spec: s.spec, preview: previews.get(s.file) })),
      );
      io.out(`staged batch ${batchId} for approval`);
    } catch (err) {
      if (err instanceof TransportError) {
        io.err(err.message);
        return EXIT.TRANSPORT;
      }
      throw err;
    }
  }

  // 8. loop-termination exit code
  return report.mustPassFailed ? EXIT.GATE_FAIL : EXIT.OK;
}
```

- [ ] **Step 5: Wire the `batch` command into `cli.ts` (remove the stub row)**

In `packages/uxfactory-cli/src/cli.ts`, add the import alongside the other command imports (after the `driftCmd` import, ~line 15):

```ts
import { batchCmd } from "./commands/batch.js";
```

Add the real command immediately before the `const stubs` declaration:

```ts
program
  .command("batch <dir>")
  .description(
    "Offline batch mode: gate a set of specs against registered inputs, then stage (§13)",
  )
  .option("--json", "machine-readable output")
  .option("--stage", "on a clean batch, stage it to the bridge for approval")
  .option("--data-dir <path>", "data directory (default <cwd>/.uxfactory)")
  .option("--bridge <url>", "bridge base URL")
  .action(
    async (
      dir: string,
      opts: { json?: boolean; stage?: boolean; dataDir?: string; bridge?: string },
    ) => {
      const client = new BridgeClient(resolveBridgeUrl(opts.bridge));
      lastCode = await batchCmd(
        dir,
        {
          json: opts.json,
          stage: opts.stage,
          dataDir: resolveDataDir(opts.dataDir),
          cwd: process.cwd(),
        },
        consoleIO,
        client,
      );
    },
  );
```

Remove the `["batch", "6", "Offline batch mode"]` row from the `stubs` table so it reads:

```ts
const stubs: ReadonlyArray<readonly [name: string, phase: string, desc: string]> = [
  ["review", "7", "Conformance review"],
  ["snapshot", "roadmap", "Pull current canvas state back into a spec"],
];
```

(Leave `commands/stub.ts` and `test/stub.test.ts` untouched — `review`/`snapshot` remain stubs; `stub.test.ts` exercises `stubCmd` directly.)

- [ ] **Step 6: Export the command surface from `index.ts`**

Append to `packages/uxfactory-cli/src/index.ts`:

```ts
export { batchCmd } from "./commands/batch.js";
export type { BatchFlags } from "./commands/batch.js";
```

- [ ] **Step 7: Run the new test + full CLI suite + typecheck**

Run: `pnpm vitest run packages/uxfactory-cli/test/batch.test.ts packages/uxfactory-cli/test/cli.test.ts packages/uxfactory-cli/test/stub.test.ts packages/uxfactory-cli/test/client.test.ts && pnpm --filter @uxfactory/cli typecheck`
Expected: PASS — missing-registry→2, clean→0+report+preview, must-fail→1, skip-and-declare→0 (all `skip`), unreadable-input→2, `--stage` posts to the in-process bridge; bin-wiring + stub + client suites still green; typecheck exit 0.

- [ ] **Step 8: Verify the built bin runs the deterministic pass + exit contract in real Node**

Run:

```bash
pnpm -r build

TMP="$(mktemp -d)"
mkdir -p "$TMP/specs" "$TMP/design"
cat > "$TMP/uxfactory.batch.json" <<'JSON'
{ "version": 1, "inputs": { "tokens": "design/tokens.ds.json", "stories": "design/stories.json" }, "maxIterations": 6 }
JSON
cat > "$TMP/design/tokens.ds.json" <<'JSON'
{ "colors": { "brand": "#1E88E5", "ink": "#111111" } }
JSON
cat > "$TMP/design/stories.json" <<'JSON'
{ "stories": [ { "id": "story-1", "role": "user", "goal": "see home", "benefit": "fast",
  "acceptanceCriteria": [ { "statement": "no data", "impliedState": "empty" }, { "statement": "ok", "impliedState": "success" } ] } ] }
JSON
cat > "$TMP/specs/home.uxfactory.json" <<'JSON'
{ "editor": "figma", "frames": [ { "name": "story-1-home", "x": 0, "y": 0, "width": 200, "height": 200, "children": [
  { "type": "shape", "name": "home-empty-state", "x": 0, "y": 0, "width": 10, "height": 10, "fill": "#1E88E5" },
  { "type": "shape", "name": "home-success-view", "x": 0, "y": 20, "width": 10, "height": 10, "fill": "#111111" } ] } ] }
JSON

CLI="$PWD/packages/uxfactory-cli/dist/src/cli.js"

( cd "$TMP" && node "$CLI" batch specs ); test $? -eq 0 && echo "batch-clean -> 0 OK"
test -f "$TMP/.uxfactory/batch/report.json" && echo "report.json OK"
test -f "$TMP/.uxfactory/batch/previews/home.uxfactory.svg" && echo "preview OK"

# ad-hoc color → must-pass fail → exit 1
cat > "$TMP/specs/home.uxfactory.json" <<'JSON'
{ "editor": "figma", "frames": [ { "name": "story-1-home", "x": 0, "y": 0, "width": 200, "height": 200, "children": [
  { "type": "shape", "name": "home-empty-state", "x": 0, "y": 0, "width": 10, "height": 10, "fill": "#abcdef" },
  { "type": "shape", "name": "home-success-view", "x": 0, "y": 20, "width": 10, "height": 10 } ] } ] }
JSON
( cd "$TMP" && node "$CLI" batch specs ); test $? -eq 1 && echo "batch-fail -> 1 OK"

# missing registry → exit 2
rm "$TMP/uxfactory.batch.json"
( cd "$TMP" && node "$CLI" batch specs ); test $? -eq 2 && echo "batch-no-registry -> 2 OK"

rm -rf "$TMP"
```

Expected: prints `batch-clean -> 0 OK`, `report.json OK`, `preview OK`, `batch-fail -> 1 OK`, `batch-no-registry -> 2 OK`. Proves the compiled bin resolves `@uxfactory/spec` + `specToSvg` from `dist`, reads the manifest from cwd, and honors the §13 exit contract end-to-end.

- [ ] **Step 9: Whole-monorepo green check**

Run: `pnpm typecheck && pnpm test && pnpm format:check`
Expected: all exit 0 (run `pnpm format` first if `format:check` flags the new files). Confirms the batch modules integrate without breaking spec/gate/bridge/plugin/cli or any existing suite.

- [ ] **Step 10: Commit**

```bash
git add packages/uxfactory-cli
git commit -m "feat(cli): implement 'uxfactory batch' offline pass + staging (§13)"
```

---

## Task 5: `skill/batch/SKILL.md` (the loop skill) + vendor it into the cc plugin

Author the focused batch-loop skill that drives the agent's offline creation loop, then extend the existing Node vendor step to ALSO copy it into the Claude Code plugin, run it, and commit the vendored copy. The skill carries YAML frontmatter (`name: uxfactory-batch` + a triggering description), documents the loop, the four gates, skip-and-declare, the exit-code termination, and the max-iterations stop, stays under 500 lines, and contains NO external-project mentions. The vendored copy must byte-match the canonical source, and the cc plugin still ships NO `.mcp.json`.

**Files:**

- Create: `skill/batch/SKILL.md`
- Modify: `clients/uxfactory-cc/scripts/vendor-skill.mjs` (vendor the batch skill too)
- Create (via the vendor step, then commit): `clients/uxfactory-cc/skills/uxfactory-batch/SKILL.md`
- Test: `test/batch-skill.test.ts`
- Test: `clients/uxfactory-cc/test/vendor-batch.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/batch-skill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const skillPath = fileURLToPath(new URL("../skill/batch/SKILL.md", import.meta.url));

describe("skill/batch/SKILL.md (the batch-loop skill)", () => {
  it("carries the triggering frontmatter and stays under 500 lines", async () => {
    const content = await readFile(skillPath, "utf8");
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fm, "must open with YAML frontmatter").not.toBeNull();
    const front = fm![1]!;
    expect(front).toMatch(/^name:\s*uxfactory-batch\s*$/m);
    expect(front).toMatch(/^description:\s*\S+/m);
    expect(content.split("\n").length).toBeLessThan(500);
  });

  it("documents the loop, the gates, skip-and-declare, exit-code termination, and the max-iterations stop", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain("## The loop");
    expect(content).toContain("## The gates");
    expect(content.toLowerCase()).toContain("skip-and-declare");
    expect(content).toContain("Exit codes");
    expect(content).toContain("`0`");
    expect(content).toContain("`1`");
    expect(content).toContain("`2`");
    expect(content).toContain("maxIterations");
    // the four gates named
    expect(content.toLowerCase()).toContain("token conformance");
    expect(content.toLowerCase()).toContain("coverage");
    expect(content.toLowerCase()).toContain("reuse");
    expect(content.toLowerCase()).toContain("reachability");
  });

  it("makes no external-project mentions", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).not.toMatch(/agentcore/i);
    expect(content).not.toMatch(/runpod/i);
    expect(content).not.toMatch(/uxfactory\.io/i);
    expect(content).not.toMatch(/\bcloud\b/i);
  });
});
```

`clients/uxfactory-cc/test/vendor-batch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vendorSkill } from "../scripts/vendor-skill.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url)); // clients/uxfactory-cc/
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)); // repo root

describe("vendored batch skill", () => {
  it("byte-matches the canonical batch skill after vendoring", async () => {
    await vendorSkill();
    const canonical = await readFile(`${repoRoot}skill/batch/SKILL.md`);
    const vendored = await readFile(`${pkgRoot}skills/uxfactory-batch/SKILL.md`);
    expect(vendored.equals(canonical)).toBe(true);
  });

  it("still ships no .mcp.json", () => {
    expect(existsSync(`${pkgRoot}.mcp.json`)).toBe(false);
    expect(existsSync(`${pkgRoot}.claude-plugin/.mcp.json`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm vitest run test/batch-skill.test.ts clients/uxfactory-cc/test/vendor-batch.test.ts`
Expected: FAIL — `skill/batch/SKILL.md` does not exist; the vendored copy isn't produced yet (the vendor step only copies the main skill).

- [ ] **Step 3: Write `skill/batch/SKILL.md` (complete)**

`skill/batch/SKILL.md`:

````markdown
---
name: uxfactory-batch
description: "Create one or more UI components, a screen, or a set of pages OFFLINE as UXFactory specs — no Figma required — using only the uxfactory CLI and this loop. Use this skill WHENEVER the user wants to generate a batch of screens/components/pages as structured specs and have them mechanically gated for token conformance, requirement/state coverage, reuse, and flow reachability before a human reviews them. Run the deterministic gate, read its findings, revise the specs, and re-run until the gate is green or the iteration budget is spent, then hand the batch to the human. Do NOT use it for the online single-spec render→verify loop (that is the main uxfactory skill) or for pixel-faithful sign-off."
compatibility: "Requires the uxfactory-cli (Node 20+). Gating and previews run fully offline — no bridge or Figma needed until the optional --stage hand-off."
---

# UXFactory — offline batch loop

This skill teaches you to author **one or more UI components / a screen / a set of pages** entirely offline as UXFactory specs, and to drive them to a clean mechanical bar before a human ever looks. There is no judge and no scoring engine here: the CLI runs **one deterministic gate pass** and its **exit code** tells you whether to stop or revise. The subjective judgment — is the flow sensible, is the labeling clear — is **yours**, guided by the gate's findings. You are the loop; `uxfactory batch` is the gate.

## When to use this skill

Use it when the user wants to **generate a batch of UI** — components, a page, or several pages / a screen-flow — as UXFactory specs, offline, and have it mechanically checked before review. Lead with this when there is no Figma session and the goal is to assemble and self-check a set of specs.

Do **not** use it for: the online single-spec render→verify loop (use the main `uxfactory` skill), pixel-faithful sign-off (the previews here are approximate), or freeform black-box UI with no structured spec.

## The inputs

Two committed, authored things drive the gate (you do not invent these — the user owns them):

- **`uxfactory.batch.json`** at the repo root — the registry. It points at the guidance inputs and carries an optional `maxIterations` budget:

```jsonc
{
  "version": 1,
  "inputs": {
    "tokens": "design/tokens.ds.json", // name → hex color register
    "stories": "design/stories.json", // stories + acceptance criteria
    "flow": "design/flow.json", // a declared step order
    "reuse": ["specs/existing.uxfactory.json"], // specs to compose against, not duplicate
  },
  "maxIterations": 6,
}
```

- The **`design/`** folder it points at — the actual tokens, stories, and flow files.

The specs you author live in their own directory (e.g. `specs/`), one `*.uxfactory.json` per component/screen/page.

### Minimal input shapes (v1)

- **tokens** (`tokens.ds.json`): `{ "colors": { "brand": "#1E88E5" } }`
- **stories** (`stories.json`): `{ "stories": [ { "id": "story-1", "role": "...", "goal": "...", "benefit": "...", "acceptanceCriteria": [ { "statement": "...", "impliedState": "empty|loading|error|success|edge" } ] } ] }`
- **flow** (`flow.json`): `{ "steps": ["<node-or-frame-name>", "..."] }` — an ordered sequence

## The loop

1. **Author / revise the spec(s)** under a directory (e.g. `specs/`). Name things so the gate can trace them:
   - put each story's id in the **frame name** it satisfies (e.g. `story-1-home`),
   - put each acceptance-criterion **state keyword** in a node name (e.g. `home-empty-state`, `home-success-view`),
   - use **registered token colors** for every fill/stroke,
   - **reference** an existing spec's screen instead of redrawing it.
2. **Run the deterministic gate** and write offline previews:
   ```bash
   uxfactory batch specs            # the single deterministic pass; writes .uxfactory/batch/report.json + previews/
   uxfactory render specs/home.uxfactory.json --out home.svg   # optional: an offline preview of one spec
   ```
3. **On exit `1`**, read the findings in `.uxfactory/batch/report.json` (uncovered stories/states, ad-hoc colors, duplicates) and **revise the spec(s)** to address each one — then re-run step 2.
4. **Stop** when `uxfactory batch` exits `0` (every must-pass gate is green) **or** you have spent `maxIterations` revisions. If the budget runs out with findings still open, surface the **best-effort** batch with the unmet findings listed — do **not** spin.
5. **Hand to the human.** Once it is clean and the human approves, stage it:
   ```bash
   uxfactory batch specs --stage    # posts the specs + previews to the bridge for review/approval
   ```

The gate's **exit code is the termination condition** — you never decide "good enough" from a score; you decide from the binary gate plus your own read of the findings.

## The gates

`uxfactory batch` runs four gates in one pass. Three are **must-pass** (they set the exit code); one is **advisory** (it never fails the batch):

- **token conformance** (must) — every fill/stroke must be a registered token color; ad-hoc values are findings.
- **requirement & state coverage** (must) — every story id maps to ≥1 frame, every acceptance-criterion state maps to a node, and no frame is story-less.
- **reuse** (must) — a screen/component that already exists in a registered spec must be referenced, not regenerated.
- **flow reachability** (advisory) — if a flow declares a step order, each consecutive pair must be reachable along your connectors; unreachable pairs are advisory findings only.

## Skip-and-declare

A gate whose **input is not registered** is reported as `skipped` with a reason — never silently passed and never failed. "No stories registered" is honestly distinct from "coverage passed." If you need a check to run, make sure its input is registered in `uxfactory.batch.json`.

## Exit codes — the loop-termination contract

| Code | Meaning                                                                        | What to do                                               |
| ---- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `0`  | Every must-pass gate is green                                                  | **Stop the loop.** Hand off for human approval.          |
| `1`  | A must-pass gate failed                                                        | Read `report.json` findings, revise the spec(s), re-run. |
| `2`  | Setup/transport (bad/missing registry, unreadable input, --stage bridge error) | Fix the environment; not a quality signal.               |

## Outputs

Everything the pass produces is ephemeral and lives under **`.uxfactory/batch/`** (gitignored): `report.json` (the gates + findings) and `previews/<spec>.svg` (one approximate offline preview per spec). The committed inputs (`uxfactory.batch.json`, `design/`) are never written to.

## Gotchas worth internalizing

- **The engine does not loop or score.** One call = one deterministic pass. You iterate; the exit code stops you.
- **Name for traceability.** Coverage and flow gates match on **names** — story ids in frame names, state keywords in node names, flow steps as node/frame names.
- **Previews are approximate** (offline raster) — good for review, not for pixel sign-off.
- **`exit 2` is never a quality signal** — it means a registry/input/bridge problem; fix the setup, do not "revise the spec."
- **Don't spin.** Respect `maxIterations`; surface best-effort with the open findings when the budget is spent.
````

- [ ] **Step 4: Extend the vendor step to copy the batch skill (`scripts/vendor-skill.mjs`)**

Replace the body of `clients/uxfactory-cc/scripts/vendor-skill.mjs` with:

```js
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // clients/uxfactory-cc/scripts
const pkgRoot = path.join(scriptDir, ".."); // clients/uxfactory-cc
const repoRoot = path.join(pkgRoot, "..", ".."); // repo root

// Canonical skill → vendored copy. Claude Code copies a plugin's directory into a
// cache on install and cannot resolve paths outside it (`../`), so each skill must be
// VENDORED here, not symlinked or referenced.
const SKILLS = [
  {
    src: path.join(repoRoot, "skill", "SKILL.md"),
    dest: path.join(pkgRoot, "skills", "uxfactory", "SKILL.md"),
  },
  {
    src: path.join(repoRoot, "skill", "batch", "SKILL.md"),
    dest: path.join(pkgRoot, "skills", "uxfactory-batch", "SKILL.md"),
  },
];

export async function vendorSkill() {
  for (const { src, dest } of SKILLS) {
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    console.log(`vendored skill: ${src} -> ${dest}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  vendorSkill().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Run the vendor step to materialize the committed copy**

Run: `node clients/uxfactory-cc/scripts/vendor-skill.mjs`
Expected: prints two `vendored skill:` lines and writes `clients/uxfactory-cc/skills/uxfactory-batch/SKILL.md` (a byte copy of `skill/batch/SKILL.md`).

- [ ] **Step 6: Run the new tests + the existing cc suite**

Run: `pnpm vitest run test/batch-skill.test.ts clients/uxfactory-cc/test/vendor-batch.test.ts clients/uxfactory-cc/test/scaffold.test.ts`
Expected: PASS — batch skill frontmatter (`name: uxfactory-batch`), the loop/gates/skip-and-declare/exit-codes/maxIterations sections, the four named gates, no external mentions, <500 lines; the vendored batch copy byte-matches; no `.mcp.json`; the existing `scaffold.test.ts` (which vendors + byte-matches the MAIN skill) still green.

- [ ] **Step 7: Typecheck the cc plugin + whole-monorepo green**

Run: `pnpm --filter uxfactory-cc typecheck && pnpm typecheck && pnpm test && pnpm format:check`
Expected: all exit 0 (run `pnpm format` first if `format:check` flags the new markdown/JS/TS). The cc typecheck imports `vendorSkill` via the existing `scripts/vendor-skill.d.mts` declaration (unchanged signature), so it stays green.

- [ ] **Step 8: Commit (canonical skill + vendor step + vendored copy + tests)**

```bash
git add skill/batch/SKILL.md clients/uxfactory-cc/scripts/vendor-skill.mjs clients/uxfactory-cc/skills/uxfactory-batch/SKILL.md test/batch-skill.test.ts clients/uxfactory-cc/test/vendor-batch.test.ts
git commit -m "feat(cc): add uxfactory-batch loop skill and vendor it into the plugin (§13.3)"
```

---

## Self-Review

**1. Spec coverage** (against THE DESIGN and PRD §13):

- **Inputs registry (`src/batch/registry.ts`, §13.1)** — `BatchRegistry`/`BatchInputs`/`ResolvedInputs`; `validateRegistry` (version 1, inputs object, string token/stories/flow, string[] reuse, positive-integer maxIterations); `resolveInputs` (relative to registry dir; null/empty when absent); `readRegistry` (missing/bad-JSON/invalid → ok:false). `maxIterations` is carried as metadata only — the engine never loops → Task 1. ✅
- **Minimal input formats (v1)** — `TokenSet {colors}`, `StorySet/Story/AcceptanceCriterion/ImpliedState`, `Flow {steps}` defined and consumed by the gates; the command parses each input file into these → Tasks 2–4. ✅
- **`tokenConformance` (must, skip-and-declare)** — skip when null; 6-digit-lowercase normalization (`#1E88E5`→`#1e88e5`, 3-digit expanded); ad-hoc / non-hex → fail+findings → Task 2. ✅
- **`reuse` (must, skip-and-declare)** — skip when null; container name+child-shape signature; duplicate of a registered spec → fail+findings → Task 2. ✅
- **`requirementCoverage` (must, skip-and-declare)** — name-based: story id→frame, AC state keyword→node, story-less frames; uncovered story / uncovered AC-state / story-less frame → fail+findings → Task 3. ✅
- **`flowReachability` (ADVISORY, deterministic, NO LLM)** — skip when null; graph from connectors; each consecutive step pair checked by pure DFS reachability; unreachable → advisory findings; `severity:"advisory"` always → Task 3. ✅
- **`runBatch` → `BatchReport` (deterministic, no async, no judge)** — runs all four gates once; `mustPassFailed` = any must-gate fail; `clean = !mustPassFailed`; advisory failures never count → Task 3. ✅
- **`batchCmd` (replace stub)** — (1) registry absent/invalid→2; (2) load+validate `*.uxfactory.json` from `<dir>`, invalid→2; (3) load existing inputs (skip-and-declare absent; registered-but-unreadable→2); (4) `runBatch`; (5) `specToSvg` previews under `.uxfactory/batch/previews/`; (6) `.uxfactory/batch/report.json` + summary/`--json`; (7) `--stage` && clean → `POST /batch`, bridge error→2; (8) exit 0/1/2 → Task 4. ✅
- **`BridgeClient.postBatch`** — `POST /batch` with `{ items: [{ spec, preview }] }`, non-200→TransportError; reuses private `request`/`json` → Task 4. ✅
- **cli/index wiring** — `batch <dir>` command with `--json`/`--stage`/`--data-dir`/`--bridge`; `batch` row removed from `stubs`; full public surface exported → Tasks 1–4. ✅
- **Exit codes (loop contract)** — 0 clean / 1 must-pass failed / 2 setup-or-transport, proven at unit level and via the built bin → Task 4. ✅
- **Batch-loop skill (`skill/batch/SKILL.md`)** — `name: uxfactory-batch` + triggering description; WHEN; the loop (author→gate→read findings→revise→stop on exit 0 or maxIterations→human approve→`--stage`); the four gates; skip-and-declare; exit-code termination; max-iterations stop; <500 lines; no external mentions → Task 5. ✅
- **Vendor step** — `vendor-skill.mjs` extended to also copy `skill/batch/SKILL.md` → `clients/uxfactory-cc/skills/uxfactory-batch/SKILL.md`; run + committed; byte-match + no-`.mcp.json` tested; existing main-skill vendoring untouched → Task 5. ✅
- **Folders (§13.6)** — committed inputs (`uxfactory.batch.json`, `design/`) read-only; outputs under the already-gitignored `.uxfactory/batch/`; no gitignore edit → Task 4. ✅

**2. Placeholder scan:** No "TODO"/"TBD"/"similar to"/"add X here". Every implement step ships complete, compilable code; the skill ships full text. Comments restate the §13 contract (documentation, not placeholders). ✅

**3. Type consistency:** `Spec`, `CheckResult`, `LoadedSpec`, input-data types, `BatchReport`, `IO`, `BridgeClient` are `import type` (verbatimModuleSyntax); `readRegistry`/`runBatch`/`loadSpec`/`specToSvg`/`EXIT`/`TransportError`/`path`/fs functions are value imports. `noUncheckedIndexedAccess` handled: regex via `.test`+`.slice` (no capture indexing), `stack.pop() as string` after a `length>0` guard, `steps[i] as string` in the bounded for-loop, `fm![1]!` only in tests. `loadSpec` yields `spec: unknown`, narrowed via `as Spec` after validation (consistent with `renderCmd`). The `AnyChild` cast covers optional `fill`/`stroke` uniformly across the child union. `postBatch` reuses the class's private `request`/`json`. The cc vendor `.mjs` keeps the `vendorSkill(): Promise<void>` signature its existing `.d.mts` declares. ✅

**4. Judgment calls** (where the design left a choice or required a small extension):

- **`reuse` entries are explicit file paths, not globs (v1).** The PRD §13.1 example shows a glob (`specs/**/*.uxfactory.json`), but THE DESIGN's minimal `reuse?: string[]` plus the "no new runtime deps" constraint argue for explicit paths now; glob expansion is a clean post-v1 extension (resolve to file lists before `loadSpec`). A registered reuse path that doesn't resolve is a setup error (exit 2), consistent with other registered-but-unreadable inputs.
- **Zero matching specs in `<dir>` → exit 2.** Gating an empty set would "pass" vacuously, which is misleading; a missing/empty spec set is treated as a setup mistake with a clear message rather than a silent clean pass. (An unreadable dir is also 2.)
- **Coverage matching is case-insensitive substring on names.** "name contains the id" / "name includes the state keyword" is implemented as lowercased `includes`, the most forgiving deterministic reading; it keeps the gate name-based and LLM-free as specified.
- **`reuse` signature = container name + sorted `type:name` of children.** "same name+shape" is interpreted structurally (name plus child composition) rather than pixel geometry, so it's deterministic and order-independent; geometry-sensitive matching can tighten it later if needed.
- **Preview format is SVG (the §12 approximate raster's vector form), passed as the bridge `preview` string.** `specToSvg` is pure and dependency-light (no `@resvg` native call needed for a preview ref), and the bridge's `BatchItem.preview` is a free-form string — keeping previews as SVG avoids invoking the rasterizer in the batch path while still shipping a real visual.
- **`report.json` adds a `specs: string[]` field** alongside the `BatchReport` shape, so a reader knows which files the gates ran over; it carries no clock/timestamp, preserving determinism.
- **No top-level `uxfactory.batch.json` is committed by this phase.** The manifest and `design/` inputs are user-authored source (PRD §18 lists them as repo artifacts, not engine code); tests/fixtures use temp dirs, so committing a real one would be empty scaffolding or interfere with a user's own.
- **Embedded commit messages follow the existing phase-plan style** (Conventional-Commits subject, scoped `git add`, no trailer) to stay consistent with the seven prior plans in `docs/superpowers/plans/`; the implementing agent should apply the repo's own commit conventions at execution time.
- **"No external-project mentions" is enforced in the skill test** by asserting the absence of `agentcore`/`runpod`/`uxfactory.io`/the standalone word `cloud`; the skill text is written to avoid all of them (it says "offline," never "cloud"/"runtime project").

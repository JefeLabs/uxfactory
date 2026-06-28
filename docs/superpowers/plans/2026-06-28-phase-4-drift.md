# Phase 4 — Drift Detection (`uxfactory map` / `uxfactory drift`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@uxfactory/cli` with spec-vs-reality drift detection (PRD §11): the committed `uxfactory.map.json` join table, the pure `map`/`drift`/auto-fill engine under `src/drift/`, and the `uxfactory map scaffold`/`uxfactory map check`/`uxfactory drift` commands (replacing the table-driven stubs), plus auto-filling `figmaId`/`lastSynced` on render via `publish` — never touching the maintained map fields.

**Architecture:** Drift logic lives in PURE, unit-tested modules under `packages/uxfactory-cli/src/drift/` (`map-schema`, `map-io`, `sources`, `drift-core`) that take CONTENT and pre-resolved inputs, never paths — so they are deterministic and side-effect-free. The command layer (`commands/map.ts`, `commands/drift.ts`, `commands/discover.ts`) does all I/O: it reads the map, reads the referenced specs, resolves each `source.ref` from disk, fetches the latest render report over the existing `BridgeClient.getRendered()`, computes git-staleness via an injectable `gitLastCommit`, discovers components from source files, then hands a fully-resolved input object to the pure `computeDrift`. `cli.ts` wires `map scaffold`/`map check`/`drift` to these actions; `publishCmd` calls the pure `syncMapFromReport` after a successful render to auto-fill the volatile Figma identifiers.

**Tech Stack:** TypeScript 6.0.3 (ESM, NodeNext, `.js` import extensions, `verbatimModuleSyntax`), `commander@14.0.1`, `yaml@2.9.0` (new `@uxfactory/cli` dep for k8s/compose parsing), the global `fetch` (Node 20+), `node:child_process` (`execFileSync` for the default git lookup), Vitest 4.1.9 driving pure modules directly and command actions against temp-dir fixtures (and a real in-process `@uxfactory/bridge` for the publish auto-fill test). Same monorepo toolchain as Phases 0–3.

## Global Constraints

- Node `>=20.10`; TS 6.0.3; ESM/NodeNext; `.js` import extensions; `verbatimModuleSyntax` on. WORK DIRECTLY ON `main` (no feature branch) — the user wants sequential main-based work; each task commits to main.
- This phase EXTENDS `@uxfactory/cli` (it does NOT add a new package). Drift logic lives in PURE modules under `packages/uxfactory-cli/src/drift/`, unit-tested; the CLI commands wire them. Add `yaml@2.9.0` as a `@uxfactory/cli` dependency (for k8s/compose parsing).
- Exit codes (PRD §11.2, §5.3): `uxfactory drift` → `0` clean, `1` drift found, `2` transport/setup. `uxfactory map check` → `1` on a dangling entry. (Mirrors the verify 1-vs-2 contract: `1` = a real drift/dangling signal, `2` = the tooling couldn't run.)
- `uxfactory.map.json` is COMMITTED at the repo root (NOT in `.uxfactory/`). You MAINTAIN `component`/`spec`/`node`/`source`; UXFactory auto-fills ONLY `figmaId`/`lastSynced` — and MUST NEVER edit the maintained fields.
- Per the established conventions: cross-package `paths` only in tsconfig.typecheck.json; `@types/node` devDep; built artifact verified; commit scoped per task (`git add packages/uxfactory-cli`, plus uxfactory.map.json fixtures/design files where a task adds them) — never `git add -A`.

### Module map (built across the 5 tasks)

```
packages/uxfactory-cli/
  package.json                      + yaml@2.9.0 dependency                       (Task 2)
  src/
    drift/
      map-schema.ts   ComponentMap/MapEntry/MapSource types + validateMap + MAINTAINED_FIELDS  (Task 1)
      map-io.ts       readMap/writeMap/serializeMap/setAutoFilled                 (Task 1)
      sources.ts      resolveSource (terraform/k8s/compose) + getByPath + parseRef + extractBraceBody (Task 2)
      drift-core.ts   computeDrift + syncMapFromReport + findSpecNode             (Task 3)
    commands/
      discover.ts     discoverComponents + readSpecNodes (file I/O)               (Task 4)
      map.ts          mapScaffoldCmd + mapCheckCmd                                (Task 4)
      drift.ts        driftCmd + defaultGitLastCommit                            (Task 5)
      publish.ts      + autoSyncMap wiring (syncMapFromReport on render)          (Task 5)
    cli.ts            replace map/drift stubs with real wiring                    (Tasks 4 & 5)
    index.ts          re-export the new public surface                           (Tasks 1–5)
  test/
    map-io.test.ts                                                               (Task 1)
    sources.test.ts                                                              (Task 2)
    drift-core.test.ts                                                           (Task 3)
    map.test.ts                                                                  (Task 4)
    drift.test.ts   (+ publish auto-fill case in publish.test.ts)                (Task 5)
```

> The existing `commands/stub.ts` and `stub.test.ts` stay: `render`/`batch`/`review`/`snapshot` remain stubs. Only the `map` and `drift` rows are removed from `cli.ts`'s `stubs` table; `stub.test.ts` calls `stubCmd("map", "4", …)` directly (not through the program wiring), so it stays green.

---

## Task 1: `map-schema.ts` + `map-io.ts` (types, `validateMap`, `readMap`/`writeMap`, `setAutoFilled`)

**Files:**

- Create: `packages/uxfactory-cli/src/drift/map-schema.ts`
- Create: `packages/uxfactory-cli/src/drift/map-io.ts`
- Modify: `packages/uxfactory-cli/src/index.ts`
- Test: `packages/uxfactory-cli/test/map-io.test.ts`

**Interfaces:**

- Produces:
  - `interface MapSource { kind: "terraform" | "k8s" | "compose"; ref: string; compare?: Record<string, string> }`
  - `interface MapLastSynced { render: string; commit: string }`
  - `interface MapEntry { component: string; spec: string; node: string; source: MapSource; figmaId?: string; lastSynced?: MapLastSynced }`
  - `interface ComponentMap { version: 1; components: MapEntry[] }`
  - `const MAINTAINED_FIELDS = ["component", "spec", "node", "source"] as const`
  - `function validateMap(input: unknown): { valid: boolean; errors: string[] }`
  - `function readMap(file: string): Promise<ComponentMap | null>` (null when absent; throws on parse/invalid)
  - `function writeMap(file: string, map: ComponentMap): Promise<void>`; `function serializeMap(map: ComponentMap): string`
  - `function setAutoFilled(map: ComponentMap, component: string, patch: { figmaId?: string; lastSynced?: MapLastSynced }): ComponentMap` (pure; maintained fields keep their references)

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-cli/test/map-io.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateMap, MAINTAINED_FIELDS } from "../src/drift/map-schema.js";
import type { ComponentMap } from "../src/drift/map-schema.js";
import { readMap, writeMap, serializeMap, setAutoFilled } from "../src/drift/map-io.js";

let dir: string;
let mapPath: string;

const sampleMap: ComponentMap = {
  version: 1,
  components: [
    {
      component: "api-gateway",
      spec: "deployment.uxfactory.json",
      node: "api-gateway",
      source: {
        kind: "terraform",
        ref: "infra/main.tf#aws_apigatewayv2_api.main",
        compare: { name: "name" },
      },
    },
  ],
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uxf-map-"));
  mapPath = path.join(dir, "uxfactory.map.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("validateMap", () => {
  it("accepts a well-formed map", () => {
    expect(validateMap(sampleMap)).toEqual({ valid: true, errors: [] });
  });

  it("exposes the maintained-field allowlist", () => {
    expect(MAINTAINED_FIELDS).toEqual(["component", "spec", "node", "source"]);
  });

  it("rejects a wrong version", () => {
    const r = validateMap({ version: 2, components: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/version/);
  });

  it("rejects a non-array components", () => {
    expect(validateMap({ version: 1, components: {} }).valid).toBe(false);
  });

  it("rejects an entry missing source.ref", () => {
    const r = validateMap({
      version: 1,
      components: [{ component: "a", spec: "s.json", node: "a", source: { kind: "k8s" } }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/source\.ref/);
  });

  it("rejects an unknown source.kind", () => {
    const r = validateMap({
      version: 1,
      components: [
        { component: "a", spec: "s.json", node: "a", source: { kind: "helm", ref: "x#y" } },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/kind/);
  });

  it("rejects a non-string compare value", () => {
    const r = validateMap({
      version: 1,
      components: [
        {
          component: "a",
          spec: "s.json",
          node: "a",
          source: { kind: "k8s", ref: "x#y", compare: { port: 8080 } },
        },
      ],
    });
    expect(r.valid).toBe(false);
  });
});

describe("readMap", () => {
  it("returns null when the file is absent", async () => {
    expect(await readMap(mapPath)).toBeNull();
  });

  it("round-trips a valid map", async () => {
    await writeMap(mapPath, sampleMap);
    expect(await readMap(mapPath)).toEqual(sampleMap);
  });

  it("throws on malformed JSON", async () => {
    await writeFile(mapPath, "{ not json", "utf8");
    await expect(readMap(mapPath)).rejects.toThrow(/parse/);
  });

  it("throws on a structurally invalid map", async () => {
    await writeFile(mapPath, JSON.stringify({ version: 9, components: [] }), "utf8");
    await expect(readMap(mapPath)).rejects.toThrow(/invalid/);
  });
});

describe("writeMap / serializeMap", () => {
  it("emits a stable key order, 2-space indent, and a trailing newline", () => {
    const text = serializeMap(sampleMap);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('  "version": 1');
    // maintained keys appear in canonical order before the auto-filled ones
    const compIdx = text.indexOf('"component"');
    const specIdx = text.indexOf('"spec"');
    const nodeIdx = text.indexOf('"node"');
    const sourceIdx = text.indexOf('"source"');
    expect(compIdx).toBeLessThan(specIdx);
    expect(specIdx).toBeLessThan(nodeIdx);
    expect(nodeIdx).toBeLessThan(sourceIdx);
  });

  it("is deterministic regardless of input key order", () => {
    const shuffled: ComponentMap = {
      version: 1,
      components: [
        {
          // intentionally out of canonical order
          node: "api-gateway",
          source: { ref: "infra/main.tf#aws_apigatewayv2_api.main", kind: "terraform", compare: { name: "name" } },
          spec: "deployment.uxfactory.json",
          component: "api-gateway",
        } as unknown as ComponentMap["components"][number],
      ],
    };
    expect(serializeMap(shuffled)).toBe(serializeMap(sampleMap));
  });
});

describe("setAutoFilled", () => {
  it("fills figmaId/lastSynced on the named component", () => {
    const next = setAutoFilled(sampleMap, "api-gateway", {
      figmaId: "12:34",
      lastSynced: { render: "r_1", commit: "abc123" },
    });
    expect(next.components[0]?.figmaId).toBe("12:34");
    expect(next.components[0]?.lastSynced).toEqual({ render: "r_1", commit: "abc123" });
  });

  it("never mutates the input and never touches maintained fields (byte-identical)", () => {
    const before = JSON.stringify(sampleMap.components[0]);
    const next = setAutoFilled(sampleMap, "api-gateway", { figmaId: "12:34" });
    // input untouched
    expect(JSON.stringify(sampleMap.components[0])).toBe(before);
    // maintained fields are the SAME references on the new entry
    const a = sampleMap.components[0]!;
    const b = next.components[0]!;
    expect(b.source).toBe(a.source);
    expect(b.component).toBe(a.component);
    expect(b.spec).toBe(a.spec);
    expect(b.node).toBe(a.node);
    // and serialize byte-identically for the maintained subset
    const maintained = (e: typeof a) => JSON.stringify({ component: e.component, spec: e.spec, node: e.node, source: e.source });
    expect(maintained(b)).toBe(maintained(a));
  });

  it("leaves other components alone (same reference)", () => {
    const two: ComponentMap = {
      version: 1,
      components: [
        sampleMap.components[0]!,
        { component: "db", spec: "deployment.uxfactory.json", node: "db", source: { kind: "compose", ref: "compose.yaml#db" } },
      ],
    };
    const next = setAutoFilled(two, "api-gateway", { figmaId: "9:9" });
    expect(next.components[1]).toBe(two.components[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/map-io.test.ts`
Expected: FAIL — cannot find module `../src/drift/map-schema.js` / `../src/drift/map-io.js`.

- [ ] **Step 3: Create `src/drift/map-schema.ts`**

`packages/uxfactory-cli/src/drift/map-schema.ts`:

```ts
/**
 * The committed component map (`uxfactory.map.json`) — the join between code, spec, and
 * canvas (PRD §11.1). You maintain `component`/`spec`/`node`/`source`; UXFactory
 * auto-fills `figmaId`/`lastSynced` on render and never edits the maintained fields.
 */

/** The maintained code/infra binding for a component. */
export interface MapSource {
  /** Which source kind the `ref` points into. */
  kind: "terraform" | "k8s" | "compose";
  /** `file#identifier`, e.g. `infra/main.tf#aws_apigatewayv2_api.main`. */
  ref: string;
  /** Optional logical-field → source-attribute bindings enabling the precise field diff. */
  compare?: Record<string, string>;
}

/** What UXFactory auto-fills on every render. */
export interface MapLastSynced {
  render: string;
  commit: string;
}

/** One row of the map: implemented component ↔ spec node ↔ Figma node. */
export interface MapEntry {
  /** Logical id — the stable join key (MAINTAINED). */
  component: string;
  /** Which spec file renders it (MAINTAINED). */
  spec: string;
  /** Which node within that spec (MAINTAINED). */
  node: string;
  /** The code/infra binding (MAINTAINED). */
  source: MapSource;
  /** Auto-filled from the render report — NEVER hand-maintained. */
  figmaId?: string;
  /** Auto-filled on render — NEVER hand-maintained. */
  lastSynced?: MapLastSynced;
}

/** The whole committed map. */
export interface ComponentMap {
  version: 1;
  components: MapEntry[];
}

/** The fields UXFactory must NEVER edit (only a human/agent maintains these). */
export const MAINTAINED_FIELDS = ["component", "spec", "node", "source"] as const;

/** The outcome of validating an unknown value as a ComponentMap. */
export interface MapValidation {
  valid: boolean;
  errors: string[];
}

/** Hand-rolled structural validation of an unknown value as a ComponentMap. Never throws. */
export function validateMap(input: unknown): MapValidation {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["map must be a JSON object"] };
  }
  const obj = input as Record<string, unknown>;
  if (obj.version !== 1) {
    errors.push(`version must be 1 (got ${JSON.stringify(obj.version)})`);
  }
  if (!Array.isArray(obj.components)) {
    errors.push("components must be an array");
    return { valid: errors.length === 0, errors };
  }
  obj.components.forEach((raw, i) => {
    const where = `components[${i}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    const e = raw as Record<string, unknown>;
    for (const f of ["component", "spec", "node"] as const) {
      if (typeof e[f] !== "string" || (e[f] as string).length === 0) {
        errors.push(`${where}.${f} must be a non-empty string`);
      }
    }
    const src = e.source;
    if (typeof src !== "object" || src === null || Array.isArray(src)) {
      errors.push(`${where}.source must be an object`);
      return;
    }
    const s = src as Record<string, unknown>;
    if (s.kind !== "terraform" && s.kind !== "k8s" && s.kind !== "compose") {
      errors.push(`${where}.source.kind must be terraform | k8s | compose`);
    }
    if (typeof s.ref !== "string" || (s.ref as string).length === 0) {
      errors.push(`${where}.source.ref must be a non-empty string`);
    }
    if (s.compare !== undefined) {
      if (typeof s.compare !== "object" || s.compare === null || Array.isArray(s.compare)) {
        errors.push(`${where}.source.compare must be an object of string → string`);
      } else if (
        !Object.values(s.compare as Record<string, unknown>).every((v) => typeof v === "string")
      ) {
        errors.push(`${where}.source.compare values must all be strings`);
      }
    }
  });
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Create `src/drift/map-io.ts`**

`packages/uxfactory-cli/src/drift/map-io.ts`:

```ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { validateMap } from "./map-schema.js";
import type { ComponentMap, MapEntry, MapLastSynced } from "./map-schema.js";

/**
 * Read + parse + validate `uxfactory.map.json`. Returns `null` when the file is absent
 * (ENOENT). Throws a clear Error on a parse failure or a structurally invalid map.
 */
export async function readMap(file: string): Promise<ComponentMap | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(
      `cannot parse ${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const v = validateMap(parsed);
  if (!v.valid) {
    throw new Error(`invalid ${path.basename(file)}: ${v.errors.join("; ")}`);
  }
  return parsed as ComponentMap;
}

/** Serialize with a STABLE key order, 2-space indent, and a trailing newline, then write. */
export async function writeMap(file: string, map: ComponentMap): Promise<void> {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, serializeMap(map), "utf8");
}

/** Deterministic serializer: fixed key order so committed diffs stay minimal. */
export function serializeMap(map: ComponentMap): string {
  const ordered = {
    version: map.version,
    components: map.components.map(orderEntry),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function orderEntry(e: MapEntry): Record<string, unknown> {
  const source: Record<string, unknown> = { kind: e.source.kind, ref: e.source.ref };
  if (e.source.compare !== undefined) source.compare = e.source.compare;
  const out: Record<string, unknown> = {
    component: e.component,
    spec: e.spec,
    node: e.node,
    source,
  };
  if (e.figmaId !== undefined) out.figmaId = e.figmaId;
  if (e.lastSynced !== undefined) out.lastSynced = e.lastSynced;
  return out;
}

/** The ONLY fields UXFactory may auto-fill. */
export interface AutoFill {
  figmaId?: string;
  lastSynced?: MapLastSynced;
}

/**
 * Return a NEW map with only `figmaId`/`lastSynced` changed on the named component;
 * every maintained field (`component`/`spec`/`node`/`source`) keeps its original
 * reference, so it is provably untouched. Pure — does not mutate `map`.
 */
export function setAutoFilled(map: ComponentMap, component: string, patch: AutoFill): ComponentMap {
  return {
    version: map.version,
    components: map.components.map((e) => {
      if (e.component !== component) return e;
      const next: MapEntry = {
        // maintained fields: original references, never rebuilt
        component: e.component,
        spec: e.spec,
        node: e.node,
        source: e.source,
        // auto-filled fields: overridden when present in the patch, else preserved
        figmaId: patch.figmaId !== undefined ? patch.figmaId : e.figmaId,
        lastSynced: patch.lastSynced !== undefined ? patch.lastSynced : e.lastSynced,
      };
      return next;
    }),
  };
}
```

- [ ] **Step 5: Re-export the new surface from `src/index.ts`**

Append to `packages/uxfactory-cli/src/index.ts`:

```ts
export * from "./drift/map-schema.js";
export { readMap, writeMap, serializeMap, setAutoFilled } from "./drift/map-io.js";
export type { AutoFill } from "./drift/map-io.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-cli/test/map-io.test.ts`
Expected: PASS — validateMap accept/reject cases, readMap null/round-trip/throws, serializeMap stable order + trailing newline, setAutoFilled fills + maintained-byte-identical + no-mutation.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @uxfactory/cli typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/uxfactory-cli
git commit -m "feat(cli): add component map schema + IO (validateMap, readMap/writeMap, setAutoFilled)"
```

---

## Task 2: `sources.ts` — terraform / k8s / compose resolvers (+ `yaml` dep)

**Files:**

- Modify: `packages/uxfactory-cli/package.json` (add `yaml@2.9.0`)
- Create: `packages/uxfactory-cli/src/drift/sources.ts`
- Modify: `packages/uxfactory-cli/src/index.ts`
- Test: `packages/uxfactory-cli/test/sources.test.ts`

**Interfaces:**

- Consumes: `parse`, `parseAllDocuments` (value) from `yaml`; `MapSource` (type-only) from `./map-schema.js`.
- Produces:
  - `interface ResolvedSource { resolved: boolean; values: Record<string, string> }`
  - `function resolveSource(kind: MapSource["kind"], fileContent: string, ident: string, compare?: Record<string, string>): ResolvedSource` (PURE — takes content, not a path)
  - `function getByPath(obj: unknown, dotted: string): unknown` (dotted path with array indices, e.g. `spec.ports[0].targetPort`)
  - `function parseRef(ref: string): { file: string; ident: string }`
  - `function extractBraceBody(content: string, openIndex: number): string | null` (shared brace scanner)

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-cli/test/sources.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveSource, getByPath, parseRef } from "../src/drift/sources.js";

const tf = `
resource "aws_apigatewayv2_api" "main" {
  name        = "api-gateway"
  target_port = "8080"
  # a comment
}

resource "aws_lambda_function" "worker" {
  function_name = "worker"
}
`;

const k8s = `
apiVersion: v1
kind: Service
metadata:
  name: api-gateway
spec:
  ports:
    - targetPort: 8080
      port: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
`;

const compose = `
services:
  api-gateway:
    image: nginx:1.27
    ports:
      - "8080:80"
  db:
    image: postgres:16
`;

describe("getByPath", () => {
  it("reads nested keys and array indices", () => {
    const o = { spec: { ports: [{ targetPort: 8080 }] } };
    expect(getByPath(o, "spec.ports[0].targetPort")).toBe(8080);
  });

  it("returns undefined for a missing path", () => {
    expect(getByPath({ a: 1 }, "a.b.c")).toBeUndefined();
  });
});

describe("parseRef", () => {
  it("splits file#ident", () => {
    expect(parseRef("infra/main.tf#aws_apigatewayv2_api.main")).toEqual({
      file: "infra/main.tf",
      ident: "aws_apigatewayv2_api.main",
    });
  });
});

describe("resolveSource — terraform", () => {
  it("resolves a block and extracts the compare attributes (quotes stripped)", () => {
    const r = resolveSource("terraform", tf, "aws_apigatewayv2_api.main", {
      label: "name",
      port: "target_port",
    });
    expect(r.resolved).toBe(true);
    expect(r.values).toEqual({ name: "api-gateway", target_port: "8080" });
  });

  it("returns resolved:false when the block is absent", () => {
    const r = resolveSource("terraform", tf, "aws_apigatewayv2_api.gone", { label: "name" });
    expect(r.resolved).toBe(false);
    expect(r.values).toEqual({});
  });
});

describe("resolveSource — k8s", () => {
  it("matches a document by kind/name and reads a dotted path", () => {
    const r = resolveSource("k8s", k8s, "Service/api-gateway", { port: "spec.ports[0].targetPort" });
    expect(r.resolved).toBe(true);
    expect(r.values).toEqual({ "spec.ports[0].targetPort": "8080" });
  });

  it("matches by bare name when no kind is given", () => {
    expect(resolveSource("k8s", k8s, "worker", {}).resolved).toBe(true);
  });

  it("returns resolved:false for an unknown document", () => {
    expect(resolveSource("k8s", k8s, "Service/missing", {}).resolved).toBe(false);
  });
});

describe("resolveSource — compose", () => {
  it("resolves a service and reads its attributes", () => {
    const r = resolveSource("compose", compose, "api-gateway", { image: "image" });
    expect(r.resolved).toBe(true);
    expect(r.values).toEqual({ image: "nginx:1.27" });
  });

  it("returns resolved:false for an unknown service", () => {
    expect(resolveSource("compose", compose, "cache", {}).resolved).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/sources.test.ts`
Expected: FAIL — cannot find module `../src/drift/sources.js` (and `yaml` not yet installed).

- [ ] **Step 3: Add the `yaml` dependency**

Edit `packages/uxfactory-cli/package.json` `dependencies` to add `yaml`:

```json
  "dependencies": {
    "@uxfactory/bridge": "workspace:*",
    "@uxfactory/spec": "workspace:*",
    "commander": "14.0.1",
    "yaml": "2.9.0"
  },
```

- [ ] **Step 4: Create `src/drift/sources.ts`**

`packages/uxfactory-cli/src/drift/sources.ts`:

```ts
import { parse as parseYaml, parseAllDocuments } from "yaml";
import type { MapSource } from "./map-schema.js";

/** The outcome of resolving a source ref: did the target exist, and the extracted values. */
export interface ResolvedSource {
  resolved: boolean;
  /** Source-attribute name → string value (keyed by the `compare` VALUES). */
  values: Record<string, string>;
}

/**
 * Resolve a source binding from file CONTENT (PURE — no disk access). Finds the target
 * identified by `ident` inside `fileContent` for the given `kind`, then extracts every
 * attribute named in `compare`'s values. `resolved:false` when the target is absent.
 */
export function resolveSource(
  kind: MapSource["kind"],
  fileContent: string,
  ident: string,
  compare?: Record<string, string>,
): ResolvedSource {
  const attrs = compare !== undefined ? Object.values(compare) : [];
  switch (kind) {
    case "terraform":
      return resolveTerraform(fileContent, ident, attrs);
    case "k8s":
      return resolveK8s(fileContent, ident, attrs);
    case "compose":
      return resolveCompose(fileContent, ident, attrs);
  }
}

/** Split a `file#ident` ref into its two halves. */
export function parseRef(ref: string): { file: string; ident: string } {
  const hash = ref.indexOf("#");
  return hash >= 0
    ? { file: ref.slice(0, hash), ident: ref.slice(hash + 1) }
    : { file: ref, ident: "" };
}

/** Read a value by a dotted path with optional array indices, e.g. `spec.ports[0].targetPort`. */
export function getByPath(obj: unknown, dotted: string): unknown {
  const keys = dotted
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((k) => k.length > 0);
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Return the substring inside the braces starting at `openIndex` (the `{`), or null if unbalanced. */
export function extractBraceBody(content: string, openIndex: number): string | null {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return content.slice(openIndex + 1, i);
    }
  }
  return null;
}

function resolveTerraform(content: string, ident: string, attrs: string[]): ResolvedSource {
  const dot = ident.indexOf(".");
  const type = dot >= 0 ? ident.slice(0, dot) : ident;
  const name = dot >= 0 ? ident.slice(dot + 1) : "";
  const header = new RegExp(`resource\\s+"${escapeRe(type)}"\\s+"${escapeRe(name)}"\\s*\\{`);
  const m = header.exec(content);
  if (m === null) return { resolved: false, values: {} };
  const body = extractBraceBody(content, m.index + m[0].length - 1);
  if (body === null) return { resolved: false, values: {} };
  const values: Record<string, string> = {};
  for (const attr of attrs) {
    const re = new RegExp(`(?:^|\\n)\\s*${escapeRe(attr)}\\s*=\\s*(.+)`);
    const am = re.exec(body);
    if (am !== null && am[1] !== undefined) values[attr] = stripQuotes(am[1]);
  }
  return { resolved: true, values };
}

function resolveK8s(content: string, ident: string, attrs: string[]): ResolvedSource {
  const slash = ident.indexOf("/");
  const kind = slash >= 0 ? ident.slice(0, slash) : null;
  const name = slash >= 0 ? ident.slice(slash + 1) : ident;
  let docs: unknown[];
  try {
    docs = parseAllDocuments(content).map((d) => d.toJS() as unknown);
  } catch {
    return { resolved: false, values: {} };
  }
  const doc = docs.find((d) => {
    const o = d as { kind?: unknown; metadata?: { name?: unknown } };
    const nameMatch = o.metadata?.name === name;
    const kindMatch = kind === null || o.kind === kind;
    return nameMatch && kindMatch;
  });
  if (doc === undefined) return { resolved: false, values: {} };
  return { resolved: true, values: collectAttrs(doc, attrs) };
}

function resolveCompose(content: string, ident: string, attrs: string[]): ResolvedSource {
  let root: unknown;
  try {
    root = parseYaml(content) as unknown;
  } catch {
    return { resolved: false, values: {} };
  }
  const services = (root as { services?: Record<string, unknown> }).services;
  const svc = services?.[ident];
  if (svc === undefined || svc === null) return { resolved: false, values: {} };
  return { resolved: true, values: collectAttrs(svc, attrs) };
}

function collectAttrs(obj: unknown, attrs: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const attr of attrs) {
    const v = getByPath(obj, attr);
    if (v !== undefined && v !== null) values[attr] = String(v);
  }
  return values;
}

/** Strip a leading quoted string, or take the leading bare token (up to whitespace/comment). */
function stripQuotes(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    return end > 0 ? s.slice(1, end) : s.slice(1);
  }
  return s.split(/\s|#|\/\//)[0] ?? s;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 5: Re-export from `src/index.ts`**

Append to `packages/uxfactory-cli/src/index.ts`:

```ts
export { resolveSource, getByPath, parseRef, extractBraceBody } from "./drift/sources.js";
export type { ResolvedSource } from "./drift/sources.js";
```

- [ ] **Step 6: Install and run the test**

Run: `pnpm install && pnpm vitest run packages/uxfactory-cli/test/sources.test.ts`
Expected: PASS — terraform/k8s/compose resolved + not-resolved cases, dotted-path extraction, `getByPath`, `parseRef`. (`pnpm install` adds `yaml@2.9.0` and updates `pnpm-lock.yaml`.)

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @uxfactory/cli typecheck`
Expected: exit 0 (`yaml` ships its own types, resolved from `node_modules`; no `paths` entry needed).

- [ ] **Step 8: Commit**

```bash
git add packages/uxfactory-cli pnpm-lock.yaml
git commit -m "feat(cli): add source resolvers (terraform/k8s/compose) with yaml dependency"
```

---

## Task 3: `drift-core.ts` — `computeDrift` + `syncMapFromReport` (pure comparator)

**Files:**

- Create: `packages/uxfactory-cli/src/drift/drift-core.ts`
- Modify: `packages/uxfactory-cli/src/index.ts`
- Test: `packages/uxfactory-cli/test/drift-core.test.ts`

**Interfaces:**

- Consumes: `getByPath` (value) from `./sources.js`; `setAutoFilled` (value) from `./map-io.js`; `ComponentMap`/`MapEntry` (type-only) from `./map-schema.js`; `ResolvedSource` (type-only) from `./sources.js`; `Spec` (type-only) from `@uxfactory/spec`; `RenderReport` (type-only) from `@uxfactory/bridge`.
- Produces:
  - `type DriftKind = "field" | "deleted-orphan" | "undiagrammed-orphan" | "stale"`
  - `interface DriftFinding { kind: DriftKind; component?: string; property?: string; expected?: unknown; actual?: unknown; detail: string }`
  - `interface DriftReport { findings: DriftFinding[]; clean: boolean }`
  - `interface DriftInput { map: ComponentMap; specs: Record<string, Spec>; report: RenderReport | null; sources: Record<string, ResolvedSource>; discoveredComponents: string[]; staleness: Record<string, boolean> }`
  - `function computeDrift(input: DriftInput): DriftReport`
  - `function syncMapFromReport(map: ComponentMap, report: RenderReport, commit: string): ComponentMap`
  - `function findSpecNode(spec: Spec | undefined, name: string): Record<string, unknown> | null`

> **Compare semantics (judgment call — see Self-Review).** `source.compare` maps `logicalField → sourceAttribute`. The resolver keys `values` by the source attribute, so `expected` (reality) is `sources[ref].values[sourceAttribute]`. `actual` (the diagram) is read from the spec node by the SAME dotted-path getter using the logical-field key, falling back to the matching render node. Both coerce to string for the comparison; a mismatch is a `field` finding whose `property` is the logical key. Fixtures therefore use logical keys that are real spec-node property names (`name`, `characters`).

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-cli/test/drift-core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDrift, syncMapFromReport, findSpecNode } from "../src/drift/drift-core.js";
import type { DriftInput } from "../src/drift/drift-core.js";
import type { ComponentMap } from "../src/drift/map-schema.js";
import type { Spec } from "@uxfactory/spec";
import type { RenderReport } from "@uxfactory/bridge";

const spec: Spec = {
  editor: "figma",
  frames: [
    {
      name: "deployment",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      children: [
        { type: "shape", name: "api-gateway", x: 0, y: 0, width: 100, height: 40, characters: "8080" },
      ],
    },
  ],
} as Spec;

const map: ComponentMap = {
  version: 1,
  components: [
    {
      component: "api-gateway",
      spec: "deployment.uxfactory.json",
      node: "api-gateway",
      source: {
        kind: "terraform",
        ref: "main.tf#aws_apigatewayv2_api.main",
        compare: { name: "name", characters: "target_port" },
      },
    },
  ],
};

const baseInput = (over: Partial<DriftInput> = {}): DriftInput => ({
  map,
  specs: { "deployment.uxfactory.json": spec },
  report: null,
  sources: {
    "main.tf#aws_apigatewayv2_api.main": {
      resolved: true,
      values: { name: "api-gateway", target_port: "8080" },
    },
  },
  discoveredComponents: ["api-gateway"],
  staleness: {},
  ...over,
});

describe("computeDrift", () => {
  it("is clean when source matches spec", () => {
    const r = computeDrift(baseInput());
    expect(r.clean).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("emits a field finding when a compare attribute differs", () => {
    const r = computeDrift(
      baseInput({
        sources: {
          "main.tf#aws_apigatewayv2_api.main": {
            resolved: true,
            values: { name: "api-gateway", target_port: "9090" },
          },
        },
      }),
    );
    expect(r.clean).toBe(false);
    const field = r.findings.find((f) => f.kind === "field");
    expect(field).toMatchObject({ component: "api-gateway", property: "characters", expected: "9090", actual: "8080" });
  });

  it("emits a deleted-orphan when the source ref does not resolve", () => {
    const r = computeDrift(
      baseInput({
        sources: { "main.tf#aws_apigatewayv2_api.main": { resolved: false, values: {} } },
      }),
    );
    expect(r.findings.map((f) => f.kind)).toContain("deleted-orphan");
  });

  it("emits an undiagrammed-orphan for a discovered component with no map entry", () => {
    const r = computeDrift(baseInput({ discoveredComponents: ["api-gateway", "worker"] }));
    const orphan = r.findings.find((f) => f.kind === "undiagrammed-orphan");
    expect(orphan).toMatchObject({ component: "worker" });
  });

  it("emits a stale finding for a compare-less entry flagged by git-staleness", () => {
    const compareLess: ComponentMap = {
      version: 1,
      components: [
        { component: "db", spec: "deployment.uxfactory.json", node: "db", source: { kind: "compose", ref: "compose.yaml#db" } },
      ],
    };
    const r = computeDrift({
      map: compareLess,
      specs: { "deployment.uxfactory.json": spec },
      report: null,
      sources: { "compose.yaml#db": { resolved: true, values: {} } },
      discoveredComponents: ["db"],
      staleness: { db: true },
    });
    expect(r.findings.map((f) => f.kind)).toContain("stale");
  });

  it("falls back to the render node when the spec node lacks the property", () => {
    const specNoChars: Spec = {
      editor: "figma",
      frames: [
        { name: "deployment", x: 0, y: 0, width: 400, height: 400, children: [{ type: "shape", name: "api-gateway", x: 0, y: 0, width: 100, height: 40 }] },
      ],
    } as Spec;
    const report: RenderReport = {
      renderId: "r_1",
      editor: "figma",
      page: "p",
      pageKey: "0:1",
      fileName: "F",
      fileKey: "k",
      counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
      nodes: [{ id: "1:2", name: "api-gateway", type: "shape", x: 0, y: 0, w: 100, h: 40, characters: "8080" }],
    };
    const r = computeDrift(baseInput({ specs: { "deployment.uxfactory.json": specNoChars }, report }));
    expect(r.clean).toBe(true); // render node's characters "8080" matches source "8080"
  });
});

describe("findSpecNode", () => {
  it("finds a named child inside a frame", () => {
    expect(findSpecNode(spec, "api-gateway")?.name).toBe("api-gateway");
  });
  it("returns null for an unknown node", () => {
    expect(findSpecNode(spec, "nope")).toBeNull();
  });
});

describe("syncMapFromReport", () => {
  const report: RenderReport = {
    renderId: "r_42",
    editor: "figma",
    page: "p",
    pageKey: "0:1",
    fileName: "F",
    fileKey: "k",
    counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
    nodes: [{ id: "12:34", name: "api-gateway", type: "shape", x: 0, y: 0, w: 100, h: 40 }],
  };

  it("fills figmaId/lastSynced by node-name match and never touches maintained fields", () => {
    const before = JSON.stringify(map.components[0]);
    const next = syncMapFromReport(map, report, "abc123");
    expect(next.components[0]?.figmaId).toBe("12:34");
    expect(next.components[0]?.lastSynced).toEqual({ render: "r_42", commit: "abc123" });
    // input untouched; maintained fields preserved by reference
    expect(JSON.stringify(map.components[0])).toBe(before);
    expect(next.components[0]?.source).toBe(map.components[0]?.source);
  });

  it("leaves entries with no matching report node unchanged (same reference)", () => {
    const two: ComponentMap = {
      version: 1,
      components: [
        map.components[0]!,
        { component: "db", spec: "deployment.uxfactory.json", node: "db", source: { kind: "compose", ref: "compose.yaml#db" } },
      ],
    };
    const next = syncMapFromReport(two, report, "abc123");
    expect(next.components[1]).toBe(two.components[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/drift-core.test.ts`
Expected: FAIL — cannot find module `../src/drift/drift-core.js`.

- [ ] **Step 3: Create `src/drift/drift-core.ts`**

`packages/uxfactory-cli/src/drift/drift-core.ts`:

```ts
import { getByPath } from "./sources.js";
import { setAutoFilled } from "./map-io.js";
import type { ComponentMap, MapEntry } from "./map-schema.js";
import type { ResolvedSource } from "./sources.js";
import type { Spec } from "@uxfactory/spec";
import type { RenderReport } from "@uxfactory/bridge";

/** The four ways design and code drift apart (PRD §11.2–§11.3). */
export type DriftKind = "field" | "deleted-orphan" | "undiagrammed-orphan" | "stale";

/** A single drift signal. `expected` is reality (code/infra); `actual` is the diagram. */
export interface DriftFinding {
  kind: DriftKind;
  component?: string;
  property?: string;
  expected?: unknown;
  actual?: unknown;
  detail: string;
}

/** The structured drift verdict. */
export interface DriftReport {
  findings: DriftFinding[];
  clean: boolean;
}

/** Fully pre-resolved input — the command layer does all I/O so this core stays pure. */
export interface DriftInput {
  map: ComponentMap;
  /** Spec file name → parsed spec. */
  specs: Record<string, Spec>;
  /** The latest render report, or null (drift still runs source-vs-spec). */
  report: RenderReport | null;
  /** `source.ref` → its resolution. */
  sources: Record<string, ResolvedSource>;
  /** Component ids discovered in the source files. */
  discoveredComponents: string[];
  /** component → "git says the source changed since last render" (for compare-less entries). */
  staleness: Record<string, boolean>;
}

/** Pure comparator: map/spec/source/report in, structured drift report out. Deterministic. */
export function computeDrift(input: DriftInput): DriftReport {
  const findings: DriftFinding[] = [];
  const mapped = new Set(input.map.components.map((e) => e.component));

  for (const entry of input.map.components) {
    const src = input.sources[entry.source.ref];
    // deleted-but-diagrammed: the source ref no longer resolves
    if (src === undefined || !src.resolved) {
      findings.push({
        kind: "deleted-orphan",
        component: entry.component,
        detail: `source ${entry.source.ref} no longer resolves ("${entry.component}" documents a deleted resource)`,
      });
      continue;
    }
    const compare = entry.source.compare;
    if (compare !== undefined && Object.keys(compare).length > 0) {
      findings.push(...fieldDiffs(entry, src, input.specs, input.report));
    } else if (input.staleness[entry.component] === true) {
      findings.push({
        kind: "stale",
        component: entry.component,
        detail: `source for "${entry.component}" changed since the diagram last rendered (git-staleness; no compare bindings)`,
      });
    }
  }

  // implemented-but-undiagrammed: a discovered component with no map entry
  for (const name of input.discoveredComponents) {
    if (!mapped.has(name)) {
      findings.push({
        kind: "undiagrammed-orphan",
        component: name,
        detail: `component "${name}" exists in source but has no map entry (implemented but undiagrammed)`,
      });
    }
  }

  return { findings, clean: findings.length === 0 };
}

function fieldDiffs(
  entry: MapEntry,
  src: ResolvedSource,
  specs: Record<string, Spec>,
  report: RenderReport | null,
): DriftFinding[] {
  const out: DriftFinding[] = [];
  const specNode = findSpecNode(specs[entry.spec], entry.node);
  const reportNode = report?.nodes.find((n) => n.name === entry.node) ?? null;
  for (const [logical, attr] of Object.entries(entry.source.compare ?? {})) {
    const expected = src.values[attr]; // reality (code/infra)
    if (expected === undefined) continue; // attribute not present in source → nothing to diff
    const fromSpec = specNode !== null ? getByPath(specNode, logical) : undefined;
    const actualRaw =
      fromSpec !== undefined ? fromSpec : reportNode !== null ? getByPath(reportNode, logical) : undefined;
    const actual = actualRaw === undefined || actualRaw === null ? undefined : String(actualRaw);
    if (actual !== expected) {
      out.push({
        kind: "field",
        component: entry.component,
        property: logical,
        expected,
        actual: actual,
        detail: `"${entry.component}".${logical}: source says ${JSON.stringify(expected)}, diagram says ${JSON.stringify(actual)}`,
      });
    }
  }
  return out;
}

/** Find a named node anywhere in a spec (a frame/section or one of their children). Pure. */
export function findSpecNode(spec: Spec | undefined, name: string): Record<string, unknown> | null {
  if (spec === undefined) return null;
  const s = spec as { frames?: unknown[]; sections?: unknown[] };
  for (const group of [s.frames, s.sections]) {
    if (!Array.isArray(group)) continue;
    for (const raw of group) {
      const c = raw as Record<string, unknown>;
      if (c.name === name) return c;
      const children = c.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          const ch = child as Record<string, unknown>;
          if (ch.name === name) return ch;
        }
      }
    }
  }
  return null;
}

/**
 * Auto-fill `figmaId` + `lastSynced` for every entry whose `node` matches a render-report
 * node by name. Pure — returns a new map; maintained fields are never touched (via setAutoFilled).
 */
export function syncMapFromReport(
  map: ComponentMap,
  report: RenderReport,
  commit: string,
): ComponentMap {
  let next = map;
  for (const entry of map.components) {
    const node = report.nodes.find((n) => n.name === entry.node);
    if (node === undefined) continue;
    next = setAutoFilled(next, entry.component, {
      figmaId: node.id,
      lastSynced: { render: report.renderId, commit },
    });
  }
  return next;
}
```

- [ ] **Step 4: Re-export from `src/index.ts`**

Append to `packages/uxfactory-cli/src/index.ts`:

```ts
export { computeDrift, syncMapFromReport, findSpecNode } from "./drift/drift-core.js";
export type { DriftFinding, DriftReport, DriftInput, DriftKind } from "./drift/drift-core.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-cli/test/drift-core.test.ts`
Expected: PASS — clean, field, deleted-orphan, undiagrammed-orphan, stale, render-node fallback, findSpecNode, syncMapFromReport (fill + maintained-untouched + non-matching-unchanged).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @uxfactory/cli typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-cli
git commit -m "feat(cli): add pure drift comparator (computeDrift) and syncMapFromReport"
```

---

## Task 4: `uxfactory map scaffold` + `uxfactory map check` (+ source/spec discovery, cli wiring)

**Files:**

- Create: `packages/uxfactory-cli/src/commands/discover.ts`
- Create: `packages/uxfactory-cli/src/commands/map.ts`
- Modify: `packages/uxfactory-cli/src/cli.ts` (remove `map` stub; wire `map scaffold`/`map check`)
- Modify: `packages/uxfactory-cli/src/index.ts`
- Test: `packages/uxfactory-cli/test/map.test.ts`

**Interfaces:**

- Consumes: `readMap`/`writeMap` (Task 1); `resolveSource`/`parseRef`/`extractBraceBody` (Task 2); `findSpecNode` (Task 3); `parse`/`parseAllDocuments` from `yaml`; `EXIT`; `IO`; `Spec` (type-only).
- Produces:
  - `interface DiscoveredComponent { component: string; source: MapSource }`; `interface SpecNodes { spec: string; nodes: string[] }`
  - `function discoverComponents(cwd: string): Promise<DiscoveredComponent[]>`
  - `function readSpecNodes(cwd: string): Promise<SpecNodes[]>`
  - `function mapScaffoldCmd(flags: { cwd?: string; json?: boolean }, io: IO): Promise<number>` (exit 0)
  - `function mapCheckCmd(flags: { cwd?: string; json?: boolean }, io: IO): Promise<number>` (exit 1 on dangling, 2 on missing/unreadable map, else 0)

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-cli/test/map.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mapScaffoldCmd, mapCheckCmd } from "../src/commands/map.js";
import { readMap } from "../src/drift/map-io.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

let cwd: string;

const spec = {
  editor: "figma",
  frames: [
    {
      name: "deployment",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      children: [
        { type: "shape", name: "api-gateway", x: 0, y: 0, width: 100, height: 40, characters: "8080" },
      ],
    },
  ],
};

const tf = `
resource "aws_apigatewayv2_api" "main" {
  name        = "api-gateway"
  target_port = "8080"
}
`;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "uxf-mapcmd-"));
  await writeFile(path.join(cwd, "deployment.uxfactory.json"), JSON.stringify(spec), "utf8");
  await writeFile(path.join(cwd, "main.tf"), tf, "utf8");
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const validMap = {
  version: 1,
  components: [
    {
      component: "api-gateway",
      spec: "deployment.uxfactory.json",
      node: "api-gateway",
      source: { kind: "terraform", ref: "main.tf#aws_apigatewayv2_api.main", compare: { name: "name" } },
    },
  ],
};

describe("map scaffold", () => {
  it("proposes component↔node links by name match and writes the map", async () => {
    const io = makeIO();
    expect(await mapScaffoldCmd({ cwd }, io)).toBe(EXIT.OK);
    const written = await readMap(path.join(cwd, "uxfactory.map.json"));
    expect(written?.components).toHaveLength(1);
    expect(written?.components[0]).toMatchObject({
      component: "api-gateway",
      spec: "deployment.uxfactory.json",
      node: "api-gateway",
      source: { kind: "terraform", ref: "main.tf#aws_apigatewayv2_api.main" },
    });
    expect(io.outText()).toMatch(/api-gateway/);
  });

  it("merges without overwriting an existing maintained entry", async () => {
    const existing = {
      version: 1,
      components: [
        { component: "api-gateway", spec: "deployment.uxfactory.json", node: "api-gateway", source: { kind: "terraform", ref: "main.tf#aws_apigatewayv2_api.main", compare: { name: "name" } } },
      ],
    };
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(existing), "utf8");
    const io = makeIO();
    expect(await mapScaffoldCmd({ cwd }, io)).toBe(EXIT.OK);
    const written = await readMap(path.join(cwd, "uxfactory.map.json"));
    expect(written?.components).toHaveLength(1); // not duplicated
    expect(written?.components[0]?.source.compare).toEqual({ name: "name" }); // preserved
  });

  it("--json reports the proposed component ids", async () => {
    const io = makeIO();
    expect(await mapScaffoldCmd({ cwd, json: true }, io)).toBe(EXIT.OK);
    expect(JSON.parse(io.outText())).toMatchObject({ proposed: ["api-gateway"] });
  });
});

describe("map check", () => {
  it("returns 0 when every entry resolves on both sides", async () => {
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(validMap), "utf8");
    const io = makeIO();
    expect(await mapCheckCmd({ cwd }, io)).toBe(EXIT.OK);
  });

  it("returns 1 on a dangling source ref", async () => {
    const bad = { version: 1, components: [{ ...validMap.components[0], source: { kind: "terraform", ref: "main.tf#aws_apigatewayv2_api.gone", compare: { name: "name" } } }] };
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(bad), "utf8");
    const io = makeIO();
    expect(await mapCheckCmd({ cwd }, io)).toBe(EXIT.GATE_FAIL);
    expect(io.errText()).toMatch(/source/);
  });

  it("returns 1 on a dangling spec node", async () => {
    const bad = { version: 1, components: [{ ...validMap.components[0], node: "missing-node" }] };
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(bad), "utf8");
    const io = makeIO();
    expect(await mapCheckCmd({ cwd }, io)).toBe(EXIT.GATE_FAIL);
    expect(io.errText()).toMatch(/spec node/);
  });

  it("--json reports the dangling list", async () => {
    const bad = { version: 1, components: [{ ...validMap.components[0], node: "missing-node" }] };
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(bad), "utf8");
    const io = makeIO();
    expect(await mapCheckCmd({ cwd, json: true }, io)).toBe(EXIT.GATE_FAIL);
    const parsed = JSON.parse(io.outText()) as { ok: boolean; dangling: unknown[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.dangling).toHaveLength(1);
  });

  it("returns 2 when the map is absent", async () => {
    const io = makeIO();
    expect(await mapCheckCmd({ cwd }, io)).toBe(EXIT.TRANSPORT);
  });

  it("returns 2 when the map is invalid", async () => {
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify({ version: 9, components: [] }), "utf8");
    const io = makeIO();
    expect(await mapCheckCmd({ cwd }, io)).toBe(EXIT.TRANSPORT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/map.test.ts`
Expected: FAIL — cannot find module `../src/commands/map.js`.

- [ ] **Step 3: Create `src/commands/discover.ts`**

`packages/uxfactory-cli/src/commands/discover.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, parseAllDocuments } from "yaml";
import { extractBraceBody } from "../drift/sources.js";
import type { MapSource } from "../drift/map-schema.js";

/** A component found in a source file, with its synthesized binding. */
export interface DiscoveredComponent {
  component: string;
  source: MapSource;
}

/** The node names declared by a single spec file. */
export interface SpecNodes {
  spec: string;
  nodes: string[];
}

/** Classify a top-level file name into a source kind, or null if it is not one we read. */
function classify(file: string): MapSource["kind"] | null {
  if (file.endsWith(".tf")) return "terraform";
  if (file.endsWith(".k8s.yaml") || file.endsWith(".k8s.yml")) return "k8s";
  if (["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"].includes(file)) {
    return "compose";
  }
  return null;
}

/** Walk known source files at the top level of `cwd`; return one entry per discovered component. */
export async function discoverComponents(cwd: string): Promise<DiscoveredComponent[]> {
  let names: string[];
  try {
    names = await readdir(cwd);
  } catch {
    return [];
  }
  const out: DiscoveredComponent[] = [];
  for (const file of names.sort()) {
    const kind = classify(file);
    if (kind === null) continue;
    let content: string;
    try {
      content = await readFile(path.join(cwd, file), "utf8");
    } catch {
      continue;
    }
    if (kind === "terraform") out.push(...discoverTerraform(file, content));
    else if (kind === "k8s") out.push(...discoverK8s(file, content));
    else out.push(...discoverCompose(file, content));
  }
  return out;
}

function discoverTerraform(file: string, content: string): DiscoveredComponent[] {
  const out: DiscoveredComponent[] = [];
  const re = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const type = m[1] ?? "";
    const local = m[2] ?? "";
    const body = extractBraceBody(content, m.index + m[0].length - 1);
    const nameAttr = body !== null ? /(?:^|\n)\s*name\s*=\s*"([^"]+)"/.exec(body)?.[1] : undefined;
    const component = nameAttr ?? local;
    out.push({ component, source: { kind: "terraform", ref: `${file}#${type}.${local}` } });
  }
  return out;
}

function discoverK8s(file: string, content: string): DiscoveredComponent[] {
  let docs: unknown[];
  try {
    docs = parseAllDocuments(content).map((d) => d.toJS() as unknown);
  } catch {
    return [];
  }
  const out: DiscoveredComponent[] = [];
  for (const d of docs) {
    const o = d as { kind?: unknown; metadata?: { name?: unknown } };
    const name = o.metadata?.name;
    if (typeof name !== "string") continue;
    const kindLabel = typeof o.kind === "string" ? o.kind : "Resource";
    out.push({ component: name, source: { kind: "k8s", ref: `${file}#${kindLabel}/${name}` } });
  }
  return out;
}

function discoverCompose(file: string, content: string): DiscoveredComponent[] {
  let root: unknown;
  try {
    root = parseYaml(content) as unknown;
  } catch {
    return [];
  }
  const services = (root as { services?: Record<string, unknown> }).services;
  if (typeof services !== "object" || services === null) return [];
  return Object.keys(services).map((name) => ({
    component: name,
    source: { kind: "compose" as const, ref: `${file}#${name}` },
  }));
}

/** Read `*.uxfactory.json` spec files at the top level of `cwd`; return each file's node names. */
export async function readSpecNodes(cwd: string): Promise<SpecNodes[]> {
  let names: string[];
  try {
    names = await readdir(cwd);
  } catch {
    return [];
  }
  const out: SpecNodes[] = [];
  for (const file of names.sort()) {
    if (!file.endsWith(".uxfactory.json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(cwd, file), "utf8")) as unknown;
    } catch {
      continue;
    }
    out.push({ spec: file, nodes: collectNodeNames(parsed) });
  }
  return out;
}

function collectNodeNames(spec: unknown): string[] {
  const names: string[] = [];
  const s = spec as { frames?: unknown[]; sections?: unknown[] };
  for (const group of [s.frames, s.sections]) {
    if (!Array.isArray(group)) continue;
    for (const raw of group) {
      const c = raw as { name?: unknown; children?: unknown[] };
      if (typeof c.name === "string") names.push(c.name);
      if (Array.isArray(c.children)) {
        for (const child of c.children) {
          const ch = child as { name?: unknown };
          if (typeof ch.name === "string") names.push(ch.name);
        }
      }
    }
  }
  return names;
}
```

- [ ] **Step 4: Create `src/commands/map.ts`**

`packages/uxfactory-cli/src/commands/map.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../exit.js";
import { readMap, writeMap } from "../drift/map-io.js";
import { resolveSource, parseRef } from "../drift/sources.js";
import { findSpecNode } from "../drift/drift-core.js";
import { discoverComponents, readSpecNodes } from "./discover.js";
import type { ComponentMap, MapEntry } from "../drift/map-schema.js";
import type { Spec } from "@uxfactory/spec";
import type { IO } from "../io.js";

/** `uxfactory map scaffold` — propose component↔node links by name match into uxfactory.map.json. */
export async function mapScaffoldCmd(
  flags: { cwd?: string; json?: boolean },
  io: IO,
): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const mapPath = path.join(cwd, "uxfactory.map.json");

  let existing: ComponentMap | null;
  try {
    existing = await readMap(mapPath);
  } catch (err) {
    io.err((err as Error).message);
    return EXIT.TRANSPORT;
  }
  const map: ComponentMap = existing ?? { version: 1, components: [] };
  const present = new Set(map.components.map((e) => e.component));

  const discovered = await discoverComponents(cwd);
  const specNodes = await readSpecNodes(cwd);

  const proposals: MapEntry[] = [];
  for (const d of discovered) {
    if (present.has(d.component)) continue; // never overwrite a maintained entry
    const hit = specNodes.find((s) => s.nodes.includes(d.component));
    if (hit === undefined) continue; // no name-matching spec node → cannot propose a link
    proposals.push({ component: d.component, spec: hit.spec, node: d.component, source: d.source });
    present.add(d.component);
  }

  const merged: ComponentMap = { version: 1, components: [...map.components, ...proposals] };
  await writeMap(mapPath, merged);

  if (flags.json) {
    io.out(JSON.stringify({ proposed: proposals.map((p) => p.component), total: merged.components.length }));
  } else if (proposals.length === 0) {
    io.out("scaffold: no new component↔node links to propose");
  } else {
    io.out(`scaffold: proposed ${proposals.length} draft link(s):`);
    for (const p of proposals) io.out(`  ${p.component} → ${p.spec}#${p.node} (${p.source.kind})`);
  }
  return EXIT.OK;
}

/** `uxfactory map check` — verify every entry resolves on BOTH sides; exit 1 on a dangling entry. */
export async function mapCheckCmd(
  flags: { cwd?: string; json?: boolean },
  io: IO,
): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const mapPath = path.join(cwd, "uxfactory.map.json");

  let map: ComponentMap | null;
  try {
    map = await readMap(mapPath);
  } catch (err) {
    io.err((err as Error).message);
    return EXIT.TRANSPORT;
  }
  if (map === null) {
    io.err("no uxfactory.map.json found");
    return EXIT.TRANSPORT;
  }

  const dangling: Array<{ component: string; reason: string }> = [];
  for (const entry of map.components) {
    if (!(await sourceResolves(cwd, entry))) {
      dangling.push({ component: entry.component, reason: `source ${entry.source.ref} does not resolve` });
    } else if (!(await specNodeExists(cwd, entry))) {
      dangling.push({ component: entry.component, reason: `spec node ${entry.spec}#${entry.node} not found` });
    }
  }

  if (flags.json) {
    io.out(JSON.stringify({ ok: dangling.length === 0, dangling }));
  } else if (dangling.length === 0) {
    io.out(`map check: ${map.components.length} entr${map.components.length === 1 ? "y" : "ies"} OK`);
  } else {
    io.err(`map check: ${dangling.length} dangling entr${dangling.length === 1 ? "y" : "ies"}:`);
    for (const d of dangling) io.err(`  ${d.component}: ${d.reason}`);
  }
  return dangling.length === 0 ? EXIT.OK : EXIT.GATE_FAIL;
}

async function sourceResolves(cwd: string, entry: MapEntry): Promise<boolean> {
  const { file, ident } = parseRef(entry.source.ref);
  let content: string;
  try {
    content = await readFile(path.join(cwd, file), "utf8");
  } catch {
    return false;
  }
  return resolveSource(entry.source.kind, content, ident, entry.source.compare).resolved;
}

async function specNodeExists(cwd: string, entry: MapEntry): Promise<boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(cwd, entry.spec), "utf8")) as unknown;
  } catch {
    return false;
  }
  return findSpecNode(parsed as Spec, entry.node) !== null;
}
```

- [ ] **Step 5: Wire `map scaffold`/`map check` into `cli.ts` (remove the `map` stub)**

In `packages/uxfactory-cli/src/cli.ts`, add the imports after the existing command imports:

```ts
import { mapScaffoldCmd, mapCheckCmd } from "./commands/map.js";
```

Remove the `["map", "4", …]` row from the `stubs` table so it reads:

```ts
  const stubs: ReadonlyArray<readonly [name: string, phase: string, desc: string]> = [
    ["drift", "4", "Detect spec-vs-reality drift"],
    ["render", "5", "Render a spec to an image offline"],
    ["batch", "6", "Offline batch mode"],
    ["review", "7", "Conformance review"],
    ["snapshot", "roadmap", "Pull current canvas state back into a spec"],
  ];
```

> The `drift` row stays a stub for now — Task 5 removes it. Keeping it stubbed between tasks means `cli.ts` compiles and the bin behaves predictably after this commit.

Add the `map` command with its two subcommands immediately before the `for (const [name, phase, desc] of stubs)` loop:

```ts
  const map = program
    .command("map")
    .description("Maintain the component map (scaffold/check)");
  map
    .command("scaffold")
    .description("Propose component↔node links by name match into uxfactory.map.json")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      lastCode = await mapScaffoldCmd({ json: opts.json }, consoleIO);
    });
  map
    .command("check")
    .description("Verify every map entry resolves on both sides; exit 1 on a dangling entry")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      lastCode = await mapCheckCmd({ json: opts.json }, consoleIO);
    });
```

- [ ] **Step 6: Re-export from `src/index.ts`**

Append to `packages/uxfactory-cli/src/index.ts`:

```ts
export { mapScaffoldCmd, mapCheckCmd } from "./commands/map.js";
export { discoverComponents, readSpecNodes } from "./commands/discover.js";
export type { DiscoveredComponent, SpecNodes } from "./commands/discover.js";
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-cli/test/map.test.ts`
Expected: PASS — scaffold proposes + merges + `--json`; check 0/1/1/`--json`/absent→2/invalid→2.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @uxfactory/cli typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/uxfactory-cli
git commit -m "feat(cli): add 'map scaffold' and 'map check' commands with source/spec discovery"
```

---

## Task 5: `uxfactory drift` command + `publish` auto-fill wiring (+ built-artifact & monorepo green)

**Files:**

- Create: `packages/uxfactory-cli/src/commands/drift.ts`
- Modify: `packages/uxfactory-cli/src/commands/publish.ts` (auto-fill map after a successful render)
- Modify: `packages/uxfactory-cli/src/cli.ts` (remove `drift` stub; wire `drift`)
- Modify: `packages/uxfactory-cli/src/index.ts`
- Test: `packages/uxfactory-cli/test/drift.test.ts`
- Test: `packages/uxfactory-cli/test/publish.test.ts` (append the auto-fill case)

**Interfaces:**

- Consumes: `readMap` (Task 1); `resolveSource`/`parseRef` (Task 2); `computeDrift`/`syncMapFromReport` (Task 3); `discoverComponents` (Task 4); `BridgeClient.getRendered` (existing); `execFileSync` from `node:child_process`; `EXIT`/`TransportError`; `IO`; `Spec`/`RenderReport`/`ComponentMap`/`ResolvedSource` (type-only).
- Produces:
  - `type GitLastCommit = (file: string) => string | null`
  - `function defaultGitLastCommit(cwd: string): GitLastCommit`
  - `interface DriftFlags { cwd?: string; json?: boolean; gitLastCommit?: GitLastCommit }`
  - `function driftCmd(flags: DriftFlags, io: IO, client: BridgeClient): Promise<number>` (0 clean / 1 drift / 2 setup)
  - `PublishFlags` gains `cwd?: string; gitHead?: () => string | null`; `publishCmd` auto-fills the map after a successful render.

- [ ] **Step 1: Write the failing tests**

`packages/uxfactory-cli/test/drift.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { driftCmd } from "../src/commands/drift.js";
import { BridgeClient } from "../src/client.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

let cwd: string;
// A bridge that is never up — driftCmd must tolerate this (report=null) and still run.
const deadClient = new BridgeClient("http://127.0.0.1:1");

const spec = {
  editor: "figma",
  frames: [
    {
      name: "deployment",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      children: [
        { type: "shape", name: "api-gateway", x: 0, y: 0, width: 100, height: 40, characters: "8080" },
      ],
    },
  ],
};

const cleanTf = `
resource "aws_apigatewayv2_api" "main" {
  name        = "api-gateway"
  target_port = "8080"
}
`;

const map = {
  version: 1,
  components: [
    {
      component: "api-gateway",
      spec: "deployment.uxfactory.json",
      node: "api-gateway",
      source: { kind: "terraform", ref: "main.tf#aws_apigatewayv2_api.main", compare: { name: "name", characters: "target_port" } },
    },
  ],
};

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "uxf-drift-"));
  await writeFile(path.join(cwd, "deployment.uxfactory.json"), JSON.stringify(spec), "utf8");
  await writeFile(path.join(cwd, "main.tf"), cleanTf, "utf8");
  await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(map), "utf8");
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("drift", () => {
  it("returns 0 when the diagram matches reality", async () => {
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.OK);
    expect(io.outText()).toMatch(/clean/);
  });

  it("returns 1 on a field change", async () => {
    await writeFile(
      path.join(cwd, "main.tf"),
      cleanTf.replace('target_port = "8080"', 'target_port = "9090"'),
      "utf8",
    );
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.GATE_FAIL);
    expect(io.outText()).toMatch(/field/);
  });

  it("returns 1 on a deleted-but-diagrammed orphan", async () => {
    await writeFile(path.join(cwd, "main.tf"), "# resource removed\n", "utf8");
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.GATE_FAIL);
    expect(io.outText()).toMatch(/deleted-orphan/);
  });

  it("returns 1 on an implemented-but-undiagrammed orphan", async () => {
    await writeFile(
      path.join(cwd, "main.tf"),
      `${cleanTf}\nresource "aws_lambda_function" "worker" {\n  name = "worker"\n}\n`,
      "utf8",
    );
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.GATE_FAIL);
    expect(io.outText()).toMatch(/undiagrammed-orphan/);
  });

  it("flags git-staleness for a compare-less entry via the injected lookup", async () => {
    const compareLess = {
      version: 1,
      components: [
        { component: "api-gateway", spec: "deployment.uxfactory.json", node: "api-gateway", source: { kind: "terraform", ref: "main.tf#aws_apigatewayv2_api.main" }, lastSynced: { render: "r_old", commit: "old111" } },
      ],
    };
    await writeFile(path.join(cwd, "uxfactory.map.json"), JSON.stringify(compareLess), "utf8");
    const io = makeIO();
    const code = await driftCmd({ cwd, gitLastCommit: () => "new999" }, io, deadClient);
    expect(code).toBe(EXIT.GATE_FAIL);
    expect(io.outText()).toMatch(/stale/);
  });

  it("--json emits the structured report", async () => {
    await writeFile(
      path.join(cwd, "main.tf"),
      cleanTf.replace('target_port = "8080"', 'target_port = "9090"'),
      "utf8",
    );
    const io = makeIO();
    expect(await driftCmd({ cwd, json: true }, io, deadClient)).toBe(EXIT.GATE_FAIL);
    const parsed = JSON.parse(io.outText()) as { clean: boolean; findings: unknown[] };
    expect(parsed.clean).toBe(false);
    expect(parsed.findings.length).toBeGreaterThan(0);
  });

  it("returns 2 when the map is absent", async () => {
    await rm(path.join(cwd, "uxfactory.map.json"));
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.TRANSPORT);
  });

  it("returns 2 when the map is unreadable/invalid", async () => {
    await writeFile(path.join(cwd, "uxfactory.map.json"), "{ not json", "utf8");
    const io = makeIO();
    expect(await driftCmd({ cwd }, io, deadClient)).toBe(EXIT.TRANSPORT);
  });
});
```

Append to `packages/uxfactory-cli/test/publish.test.ts` (inside the existing `describe("publish", …)` block, reusing its `root`/`dataDir`/`handle`/`client`/`delay` fixtures):

```ts
  it("auto-fills figmaId/lastSynced after a successful render without touching maintained fields", async () => {
    // a node-name-matching map committed at the publish cwd (the temp root)
    const map = {
      version: 1,
      components: [
        {
          component: "box",
          spec: "spec.json",
          node: "box",
          source: { kind: "terraform", ref: "main.tf#aws_x.box", compare: { name: "name" } },
        },
      ],
    };
    const mapPath = path.join(root, "uxfactory.map.json");
    await writeFile(mapPath, JSON.stringify(map), "utf8");
    const maintainedBefore = JSON.stringify(map.components[0]);

    const io = makeIO();
    const p = publishCmd(
      specFile,
      { wait: true, dataDir, cwd: root, gitHead: () => "deadbeef", timeoutMs: 3000, pollMs: 30 },
      io,
      client,
    );
    await delay(150);
    await postReport(handle.url, makeReport()); // makeReport()'s node is named "box"
    expect(await p).toBe(EXIT.OK);

    const updated = JSON.parse(await readFile(mapPath, "utf8")) as {
      components: Array<{ component: string; spec: string; node: string; source: unknown; figmaId?: string; lastSynced?: { render: string; commit: string } }>;
    };
    const entry = updated.components[0]!;
    expect(entry.figmaId).toBe("1:2"); // makeReport()'s node id
    expect(entry.lastSynced).toEqual({ render: expect.any(String), commit: "deadbeef" });
    // maintained fields unchanged
    expect(JSON.stringify({ component: entry.component, spec: entry.spec, node: entry.node, source: entry.source })).toBe(maintainedBefore);
  });
```

Add `readFile` to the `node:fs/promises` import at the top of `publish.test.ts`:

```ts
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/uxfactory-cli/test/drift.test.ts packages/uxfactory-cli/test/publish.test.ts`
Expected: FAIL — `../src/commands/drift.js` missing; `publishCmd` does not yet accept `cwd`/`gitHead` nor write the map.

- [ ] **Step 3: Create `src/commands/drift.ts`**

`packages/uxfactory-cli/src/commands/drift.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { EXIT, TransportError } from "../exit.js";
import { readMap } from "../drift/map-io.js";
import { resolveSource, parseRef } from "../drift/sources.js";
import { computeDrift } from "../drift/drift-core.js";
import { discoverComponents } from "./discover.js";
import type { ComponentMap } from "../drift/map-schema.js";
import type { ResolvedSource } from "../drift/sources.js";
import type { Spec } from "@uxfactory/spec";
import type { RenderReport } from "@uxfactory/bridge";
import type { BridgeClient } from "../client.js";
import type { IO } from "../io.js";

/** Injectable git lookup so drift is testable without a real repo. */
export type GitLastCommit = (file: string) => string | null;

/** The default lookup: `git log -1 --format=%H -- <file>` in `cwd`; null when git fails. */
export function defaultGitLastCommit(cwd: string): GitLastCommit {
  return (file: string) => {
    try {
      const out = execFileSync("git", ["log", "-1", "--format=%H", "--", file], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const hash = out.trim();
      return hash.length > 0 ? hash : null;
    } catch {
      return null;
    }
  };
}

export interface DriftFlags {
  cwd?: string;
  json?: boolean;
  gitLastCommit?: GitLastCommit;
}

/** `uxfactory drift` — detect spec-vs-reality drift via the component map. */
export async function driftCmd(flags: DriftFlags, io: IO, client: BridgeClient): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const mapPath = path.join(cwd, "uxfactory.map.json");

  let map: ComponentMap | null;
  try {
    map = await readMap(mapPath);
  } catch (err) {
    io.err((err as Error).message); // unreadable/invalid map → a setup problem
    return EXIT.TRANSPORT;
  }
  if (map === null) {
    io.err("no uxfactory.map.json found — run 'uxfactory map scaffold' first");
    return EXIT.TRANSPORT;
  }

  // referenced specs (missing ones simply won't field-diff; 'map check' flags those)
  const specs: Record<string, Spec> = {};
  for (const file of new Set(map.components.map((e) => e.spec))) {
    try {
      specs[file] = JSON.parse(await readFile(path.join(cwd, file), "utf8")) as Spec;
    } catch {
      /* missing/unparseable spec → skip; drift still runs source-vs-source */
    }
  }

  // latest render report (optional — the bridge being down is fine)
  let report: RenderReport | null = null;
  try {
    report = await client.getRendered();
  } catch (err) {
    if (!(err instanceof TransportError)) throw err;
    report = null;
  }

  // resolve each source from disk (missing file → unresolved → deleted-orphan)
  const sources: Record<string, ResolvedSource> = {};
  for (const entry of map.components) {
    const { file, ident } = parseRef(entry.source.ref);
    let content: string | null = null;
    try {
      content = await readFile(path.join(cwd, file), "utf8");
    } catch {
      content = null;
    }
    sources[entry.source.ref] =
      content === null
        ? { resolved: false, values: {} }
        : resolveSource(entry.source.kind, content, ident, entry.source.compare);
  }

  // git-staleness for compare-less entries
  const git = flags.gitLastCommit ?? defaultGitLastCommit(cwd);
  const staleness: Record<string, boolean> = {};
  for (const entry of map.components) {
    const hasCompare =
      entry.source.compare !== undefined && Object.keys(entry.source.compare).length > 0;
    if (hasCompare) continue;
    const head = git(parseRef(entry.source.ref).file);
    staleness[entry.component] = head !== null && head !== entry.lastSynced?.commit;
  }

  const discovered = (await discoverComponents(cwd)).map((d) => d.component);

  const drift = computeDrift({
    map,
    specs,
    report,
    sources,
    discoveredComponents: discovered,
    staleness,
  });

  if (flags.json) {
    io.out(JSON.stringify({ clean: drift.clean, findings: drift.findings }));
  } else if (drift.clean) {
    io.out("drift: clean — no spec drift detected");
  } else {
    io.out(`drift: ${drift.findings.length} finding(s)`);
    for (const f of drift.findings) io.out(`  [${f.kind}] ${f.detail}`);
  }
  return drift.clean ? EXIT.OK : EXIT.GATE_FAIL;
}
```

- [ ] **Step 4: Wire the auto-fill into `src/commands/publish.ts`**

Add these imports to the top of `packages/uxfactory-cli/src/commands/publish.ts`:

```ts
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readMap, writeMap } from "../drift/map-io.js";
import { syncMapFromReport } from "../drift/drift-core.js";
import type { ComponentMap } from "../drift/map-schema.js";
```

Add `cwd`/`gitHead` to `PublishFlags`:

```ts
export interface PublishFlags {
  wait?: boolean;
  verify?: boolean;
  tolerance?: string;
  dryRun?: boolean;
  json?: boolean;
  dataDir: string;
  /** Where uxfactory.map.json lives for auto-fill (default process.cwd()). */
  cwd?: string;
  /** Injectable HEAD-commit lookup for lastSynced.commit (default `git rev-parse HEAD`). */
  gitHead?: () => string | null;
  timeoutMs?: number;
  pollMs?: number;
}
```

In `publishCmd`, immediately after the `if (report === null) { … return EXIT.TRANSPORT; }` block (so a render has definitively landed), insert the auto-fill before the `--verify`/`--wait` branches:

```ts
  // Auto-fill the committed map (if any) with the render's figmaId/lastSynced.
  const cwd = flags.cwd ?? process.cwd();
  await autoSyncMap(cwd, report, flags.gitHead ?? defaultGitHead(cwd), io);
```

Add these helpers at the bottom of the file:

```ts
/** The default HEAD lookup: `git rev-parse HEAD` in `cwd`; null when git fails. */
function defaultGitHead(cwd: string): () => string | null {
  return () => {
    try {
      const out = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const h = out.trim();
      return h.length > 0 ? h : null;
    } catch {
      return null;
    }
  };
}

/**
 * After a successful render, auto-fill figmaId/lastSynced in uxfactory.map.json if it exists.
 * Uses the pure syncMapFromReport, so the maintained fields are never edited. A broken/absent
 * map must never fail an otherwise-successful publish.
 */
async function autoSyncMap(
  cwd: string,
  report: RenderReport,
  gitHead: () => string | null,
  io: IO,
): Promise<void> {
  const mapPath = path.join(cwd, "uxfactory.map.json");
  let map: ComponentMap | null;
  try {
    map = await readMap(mapPath);
  } catch {
    return; // a malformed map should not break a good publish
  }
  if (map === null) return;
  const updated = syncMapFromReport(map, report, gitHead() ?? "");
  await writeMap(mapPath, updated);
  io.out(`map: synced figmaId/lastSynced for ${updated.components.length} component(s)`);
}
```

> The existing publish tests pass no `cwd`, so `autoSyncMap` runs against the repo root, finds no `uxfactory.map.json` (`readMap` → null), and no-ops — leaving those tests green.

- [ ] **Step 5: Wire `drift` into `cli.ts` (remove the `drift` stub)**

In `packages/uxfactory-cli/src/cli.ts`, add the import:

```ts
import { driftCmd } from "./commands/drift.js";
```

Remove the `["drift", "4", …]` row from the `stubs` table so it reads:

```ts
  const stubs: ReadonlyArray<readonly [name: string, phase: string, desc: string]> = [
    ["render", "5", "Render a spec to an image offline"],
    ["batch", "6", "Offline batch mode"],
    ["review", "7", "Conformance review"],
    ["snapshot", "roadmap", "Pull current canvas state back into a spec"],
  ];
```

Add the `drift` command immediately after the `map` command wiring (before the stubs loop):

```ts
  program
    .command("drift")
    .description("Detect spec-vs-reality drift via the component map")
    .option("--json", "machine-readable output")
    .option("--bridge <url>", "bridge base URL")
    .action(async (opts: { json?: boolean; bridge?: string }) => {
      const client = new BridgeClient(resolveBridgeUrl(opts.bridge));
      lastCode = await driftCmd({ json: opts.json }, consoleIO, client);
    });
```

- [ ] **Step 6: Re-export from `src/index.ts`**

Append to `packages/uxfactory-cli/src/index.ts`:

```ts
export { driftCmd, defaultGitLastCommit } from "./commands/drift.js";
export type { DriftFlags, GitLastCommit } from "./commands/drift.js";
```

- [ ] **Step 7: Run the new tests + full CLI suite + typecheck**

Run: `pnpm vitest run packages/uxfactory-cli && pnpm --filter @uxfactory/cli typecheck`
Expected: PASS — drift 0/1(field)/1(deleted)/1(undiagrammed)/stale/`--json`/absent→2/invalid→2; publish auto-fill case fills figmaId/lastSynced with maintained fields unchanged; all prior CLI suites still green; typecheck exit 0.

- [ ] **Step 8: Verify the built bin honors the §11.2 exit contract in real Node**

Run:

```bash
pnpm -r build

TMP="$(mktemp -d)"
cat > "$TMP/deployment.uxfactory.json" <<'JSON'
{ "editor": "figma", "frames": [ { "name": "deployment", "x": 0, "y": 0, "width": 400, "height": 400, "children": [ { "type": "shape", "name": "api-gateway", "x": 0, "y": 0, "width": 100, "height": 40, "characters": "8080" } ] } ] }
JSON
cat > "$TMP/main.tf" <<'HCL'
resource "aws_apigatewayv2_api" "main" {
  name        = "api-gateway"
  target_port = "8080"
}
HCL
cat > "$TMP/uxfactory.map.json" <<'JSON'
{ "version": 1, "components": [ { "component": "api-gateway", "spec": "deployment.uxfactory.json", "node": "api-gateway", "source": { "kind": "terraform", "ref": "main.tf#aws_apigatewayv2_api.main", "compare": { "name": "name", "characters": "target_port" } } } ] }
JSON

CLI="$PWD/packages/uxfactory-cli/dist/src/cli.js"

( cd "$TMP" && node "$CLI" drift ); test $? -eq 0 && echo "drift-clean -> 0 OK"

# introduce a field drift
sed -i.bak 's/8080/9090/' "$TMP/main.tf"
( cd "$TMP" && node "$CLI" drift ); test $? -eq 1 && echo "drift-found -> 1 OK"

# map check on the (still valid) map resolves both sides
( cd "$TMP" && node "$CLI" map check ); test $? -eq 0 && echo "map-check-ok -> 0 OK"

# no map at all -> setup error
rm "$TMP/uxfactory.map.json"
( cd "$TMP" && node "$CLI" drift ); test $? -eq 2 && echo "drift-no-map -> 2 OK"

rm -rf "$TMP"
```

Expected: prints `drift-clean -> 0 OK`, `drift-found -> 1 OK`, `map-check-ok -> 0 OK`, `drift-no-map -> 2 OK`. This proves the compiled bin loads in real Node ESM, `yaml` resolves from `node_modules`, the drift modules resolve `@uxfactory/spec`/`@uxfactory/bridge` from their built `dist`, the bridge being down is tolerated (report=null), and the §11.2 exit contract holds end-to-end.

- [ ] **Step 9: Whole-monorepo green check**

Run: `pnpm typecheck && pnpm test && pnpm format:check`
Expected: all exit 0 (run `pnpm format` first if `format:check` flags the new files). Confirms drift integrates without breaking spec/gate/bridge/plugin, and the new `yaml` dependency resolves across the suite.

- [ ] **Step 10: Commit**

```bash
git add packages/uxfactory-cli
git commit -m "feat(cli): add 'drift' command and auto-fill the map on publish render"
```

---

## Self-Review

**1. Spec coverage** (against THE DESIGN, PRD §11, §5.1, and the §19 Drift-detection DoD):

- **`uxfactory.map.json` shape** — `version:1` + `components[]` with maintained `component`/`spec`/`node`/`source{kind,ref,compare?}` and auto-filled `figmaId`/`lastSynced{render,commit}`; committed at repo root (commands default `cwd` to `process.cwd()` and read `<cwd>/uxfactory.map.json`, NOT `.uxfactory/`) → Task 1 types + map-io. ✅
- **`map-schema.ts`** — `ComponentMap`/`MapEntry`/`MapSource` + `validateMap` (asserts version, components[] shape, required maintained fields, kind enum, compare string→string) + `MAINTAINED_FIELDS` → Task 1. ✅
- **`map-io.ts`** — `readMap` (null if absent, throws on parse/invalid), `writeMap`/`serializeMap` (stable key order, 2-space, trailing newline), `setAutoFilled` (NEW map; only figmaId/lastSynced change; maintained fields kept by reference — test asserts byte-identical + reference equality + no input mutation) → Task 1. ✅
- **`sources.ts`** — `resolveSource(kind, fileContent, ident, compare)` PURE (content not path): terraform lightweight HCL block match `type.name` + per-attribute `key = value` (quotes stripped), k8s `parseAllDocuments` matched by `kind/name` or bare `name` with dotted-path attrs, compose `services.<name>` attrs; `resolved:false` when absent; dotted-path getter with array indices; `parseRef`; `extractBraceBody` → Task 2. ✅
- **`drift-core.ts`** — `DriftFinding`/`DriftReport`/`computeDrift(input)` with `field` (compare vs spec node / render-node fallback), `deleted-orphan` (ref unresolved), `undiagrammed-orphan` (discovered ∖ mapped), `stale` (compare-less + injected staleness); `clean = findings.length === 0`; `syncMapFromReport` (figmaId from report node matched by `node` name + lastSynced{render,commit}, via setAutoFilled); `findSpecNode` → Task 3. ✅
- **`uxfactory map scaffold`** — scans known source files + `*.uxfactory.json` specs, proposes `component↔node` by name match, merges as draft entries without overwriting maintained ones, prints proposals, exit 0; `--json` → Task 4. ✅
- **`uxfactory map check`** — both-sides resolution (source ref resolves AND spec node exists), flags dangling, exit 1 on any dangling else 0, absent/invalid map → 2; `--json` → Task 4. ✅
- **`uxfactory drift`** — builds the computeDrift input (read map; read referenced specs; `getRendered()` with TransportError tolerated as null; resolve sources from disk; git-staleness via injectable `gitLastCommit` vs `lastSynced.commit`; discover components), runs computeDrift, prints report or `--json`, exit 0/1/2 (unreadable/absent map → 2) → Task 5. ✅
- **Auto-fill on render** — `syncMapFromReport` wired into `publishCmd` after a successful render; reads the map at `cwd`, fills figmaId/lastSynced, writes back; absent/broken map no-ops; publish test asserts maintained fields untouched + figmaId/lastSynced filled → Task 5. ✅
- **drift-notify hook** — already runs `uxfactory drift --json` (Phase 3); now functional because `drift` is implemented and emits `{clean, findings}` JSON → Task 5 (no hook code change needed). ✅
- **§19 DoD** — `map check` flags a dangling entry (Task 4 tests); `drift` detects a field change + deleted-but-diagrammed + implemented-but-undiagrammed, exiting 1 (Task 5 tests + built-artifact check); auto-fills figmaId/lastSynced on render and never edits the maintained fields (Task 1 setAutoFilled test + Task 5 publish test). ✅
- **Constraints** — extends `@uxfactory/cli` (no new package); pure modules under `src/drift/`; `yaml@2.9.0` added (Task 2); exit codes per §11.2/§5.3; map at repo root, maintained fields never edited; `paths` untouched (yaml self-typed, spec/bridge/gate already mapped); built artifact + monorepo green (Task 5 Steps 8–9); commits scoped to `packages/uxfactory-cli` (+ `pnpm-lock.yaml` in Task 2). ✅

**2. Placeholder scan:** No "TODO"/"TBD"/"similar to"/"add error handling". Every implement step shows complete code. The "missing spec → skip" / "broken map → no-op publish" comments are deliberate robustness decisions, not placeholders. ✅

**3. Type consistency:** `ComponentMap`/`MapEntry`/`MapSource`/`MapLastSynced` flow Task 1 → all later tasks. `ResolvedSource` (Task 2) is the value bag consumed by `computeDrift` (Task 3) and produced by `driftCmd` (Task 5). `DriftInput` is assembled entirely by `driftCmd`, keeping `drift-core` pure. `getByPath`/`parseRef`/`extractBraceBody` live once in `sources.ts` and are reused by `drift-core`, `map`, `drift`, and `discover`. Value vs `import type` honored (`verbatimModuleSyntax`): `resolveSource`/`computeDrift`/`setAutoFilled`/`readMap`/`writeMap`/`syncMapFromReport`/`discoverComponents`/`parseYaml`/`parseAllDocuments`/`execFileSync` are value imports; `Spec`/`RenderReport`/`ComponentMap`/`MapEntry`/`ResolvedSource`/`IO`/`BridgeClient` (as a param type) are `import type`. `setAutoFilled` returns `figmaId: undefined` when neither patch nor entry sets it, but `orderEntry`/`JSON.stringify` drop undefined keys, so serialization is clean and the maintained-byte-identical assertion holds. `exactOptionalPropertyTypes:false` (base) keeps the optional-undefined assignments legal. ✅

**4. Judgment calls** (where the design left a choice or required a small, necessary extension):

- **`compare` resolution direction & key meaning.** `compare` is `logicalField → sourceAttribute`. The resolver keys `values` by the source attribute, so `expected` (reality) = `values[sourceAttribute]` and `actual` (diagram) = the spec node read by the SAME dotted-path getter using the logical key, falling back to the matching render node. The PRD's illustrative `{ label: "name", port: "target_port" }` uses logical names with no spec-node analogue; the implementation resolves the logical key as a spec-node/report-node path, so fixtures use logical keys that are real node properties (`name`, `characters`). This is the one genuinely under-specified point in §11.1, resolved to keep `drift-core` pure and the getter single-sourced.
- **`drift` tolerates a down bridge (report=null).** §11.2 says drift "diffs against the spec node and latest render," and THE DESIGN says "null is fine, drift still runs on source-vs-spec." So `driftCmd` catches `TransportError` from `getRendered()` and proceeds with `report=null` rather than returning 2 — a missing canvas is not a drift-tooling failure. Only an unreadable/absent **map** returns 2 (that is the actual setup prerequisite).
- **Injectable `gitLastCommit` / `gitHead`.** Per THE DESIGN, the git lookups are injected (default shells out via `execFileSync`) so the pure core never touches git and tests inject deterministic fakes. `cli.ts` never sets them, so the bin uses the real `git log`/`git rev-parse`.
- **Discovery scope is the top level of `cwd`.** `discoverComponents`/`readSpecNodes` read top-level files only, matching by extension/known filename (`*.tf`, `*.k8s.{yaml,yml}`, `compose|docker-compose.{yaml,yml}`, `*.uxfactory.json`). The terraform-discovered component id is the resource's `name` attribute (falling back to the local resource name), so it lines up with `scaffold`'s name-match and `compare:{name:"name"}` bindings. Recursive walking and a configurable source registry are a natural follow-up, not required by §19.
- **`map`/`drift` stubs removed incrementally.** Task 4 removes only the `map` stub (leaving `drift` stubbed so `cli.ts` compiles and behaves predictably mid-phase); Task 5 removes the `drift` stub. `commands/stub.ts` and `stub.test.ts` stay valid because the test calls `stubCmd("map", "4", …)` directly, not through the program wiring, and `render`/`batch`/`review`/`snapshot` remain stubbed.
- **No committed repo-root `uxfactory.map.json`.** All fixtures are created in per-test temp dirs; the plan never writes a map into this engine repo's root, so the existing publish tests (which use `process.cwd()`) keep no-opping through `autoSyncMap`.
- **`PublishFlags` gains `cwd`/`gitHead`.** Minimal, non-user-facing additions (the bin sets neither) so the auto-fill is testable and located deterministically; the single insertion point sits right after the render-landed check, covering both `--wait` and `--verify`.

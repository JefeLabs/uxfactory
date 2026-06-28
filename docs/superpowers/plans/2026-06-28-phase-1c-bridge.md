# Phase 1c — `@uxfactory/bridge` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@uxfactory/bridge` — a localhost-only Fastify relay that queues specs for the Figma plugin, stores render reports / selections / verify results / batches as files under a configurable `dataDir`, and wires `@uxfactory/spec`'s `validate()` and `@uxfactory/gate`'s `gate()` into a `POST /verify` endpoint.

**Architecture:** A file-backed `BridgeStore` (pure I/O over `dataDir`, restart-safe because the queue is files on disk) plus a `createBridge()` Fastify factory that registers ~13 routes closing over one store instance. The bridge is the first package that **value-imports** both `@uxfactory/spec` (`validate`) and `@uxfactory/gate` (`gate`), so the root `vitest.config.ts` gains `resolve.alias` entries pointing at their `src` so tests run against source without a build. `POST /edits` is a synchronous channel: it enqueues an edit spec, registers an in-memory waiter keyed by jobId, and resolves it when a matching `POST /rendered` arrives (or 504s on timeout).

**Tech Stack:** TypeScript 6.0.3 (ESM, NodeNext), Fastify 5.9.0 + @fastify/cors 11.2.0, Vitest 4.1.9 (`app.inject()` — no real sockets), `node:fs/promises` for persistence. Same monorepo toolchain as Phase 0/1a/1b.

## Global Constraints

- Node `>=20.10`; TypeScript exact `6.0.3`; ESM only (`"type":"module"`), `module`/`moduleResolution` NodeNext; relative imports carry `.js` extension; `verbatimModuleSyntax` ON (split value vs `import type`).
- Package `@uxfactory/bridge`, dir `packages/uxfactory-bridge/`. pnpm workspace.
- Runtime deps: `fastify@5.9.0`, `@fastify/cors@11.2.0`, `@uxfactory/spec: workspace:*`, `@uxfactory/gate: workspace:*`. The bridge VALUE-imports `validate` from @uxfactory/spec and `gate` from @uxfactory/gate.
- The bridge is I/O — it MAY use `Date`/timestamps/counters for ids and filenames (unlike the pure gate).
- ALL writes go under a configurable `dataDir` (default `path.resolve(process.cwd(), ".uxfactory")`). NOTHING is ever written outside dataDir (PRD §19, NF2). Tests pass a temp dataDir.
- CORS open for the Figma iframe origin (`@fastify/cors` with `origin: true`). Localhost-only; no telemetry.
- A bridge restart MUST NOT corrupt the queue (queue is files on disk).
- Tests use Fastify's `app.inject()` (no real sockets). Per-package `typecheck` script (`tsc -p tsconfig.typecheck.json`, includes src+test). Commit scoped per task (`git add packages/uxfactory-bridge`, plus root config files when a task changes them); never `git add -A`.

### Monorepo conventions (already established — follow exactly)

- Cross-package type resolution: put a `paths` map in `tsconfig.typecheck.json` ONLY (with `rootDir: ".."`, `noEmit: true`), NOT in the build `tsconfig.json` (build `rootDir: "."` → TS6059). Build resolves workspace deps from their published dist via pnpm topological order. Map BOTH `@uxfactory/spec` → `../uxfactory-spec/src/index.ts` and `@uxfactory/gate` → `../uxfactory-gate/src/index.ts`.
- Because the bridge VALUE-imports spec and gate, the ROOT `vitest.config.ts` must gain `resolve.alias` mapping `@uxfactory/spec` and `@uxfactory/gate` to their `src/index.ts` (via `fileURLToPath(new URL("./packages/uxfactory-spec/src/index.ts", import.meta.url))` etc.) so vitest runs against source without a build (Task 1 change).
- Build `tsconfig.json`: `extends ../../tsconfig.base.json`, `rootDir: "."`, `outDir: "dist"`, `include: ["src"]`. `package.json` `exports` → `./dist/src/index.js` (+ types), `files: ["dist"]`, scripts `build`/`typecheck`, `engines.node >=20.10`.
- Default import works for `fastify` and `@fastify/cors` (both ship a default export); use `import type` for `FastifyInstance`.

### Data dir layout (under dataDir)

```
.uxfactory/
  queue/                      # pending jobs: <jobId>.json containing the RAW spec JSON
    processed/                # picked-up jobs moved here, renamed <jobId>-<pickupTs>.json
  renders/                    # render reports: <renderId>.json
    verify/                   # verify results: <verifyId>.json (keep last 50)
  batch/                      # batches: <batchId>.json
  selection.json              # latest selection (single file)
```

---

## Task 1: Scaffold, root vitest alias & `BridgeStore`

**Files:**

- Create: `packages/uxfactory-bridge/package.json`
- Create: `packages/uxfactory-bridge/tsconfig.json`
- Create: `packages/uxfactory-bridge/tsconfig.typecheck.json`
- Create: `packages/uxfactory-bridge/src/index.ts`
- Create: `packages/uxfactory-bridge/src/store.ts`
- Modify: `vitest.config.ts` (root)
- Test: `packages/uxfactory-bridge/test/store.test.ts`

**Interfaces:**

- Consumes: `RenderReport`, `GateResult` (type-only) from `@uxfactory/gate`.
- Produces:
  - `interface BatchItem { itemId: string; spec: unknown; preview?: string; status: "pending" | "approved" | "rejected" }`
  - `interface Batch { batchId: string; status: "pending" | "approved"; items: BatchItem[] }`
  - `class BridgeStore` — constructor `new BridgeStore(dataDir: string)`; `get pluginSeen(): boolean`; methods `init()`, `markPluginSeen()`, `enqueue(spec, jobId?)`, `pending()`, `dequeueNext()`, `saveReport(report)`, `getReport(renderId?)`, `hasAnyReport()`, `saveSelection(sel)`, `getSelection()`, `saveVerify(result)`, `getVerify(verifyId)`, `saveBatch(batch)`, `getBatch(batchId?)`, `approveBatch(batchId, approvedItemIds)`.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-bridge/test/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BridgeStore } from "../src/store.js";
import type { RenderReport, GateResult } from "@uxfactory/gate";

const makeReport = (over: Partial<RenderReport> = {}): RenderReport => ({
  renderId: "",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "F",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40 }],
  ...over,
});

const makeResult = (verifyId: string): GateResult & { verifyId: string } => ({
  status: "PASS",
  verifyId,
  renderId: "r_1",
  editor: "figma",
  pageKey: "0:1",
  fileName: "F",
  summary: { checks: 5, passed: 4, failed: 0, skipped: 1 },
  checks: [],
  failures: [],
});

let root: string;
let dataDir: string;
let store: BridgeStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
  dataDir = path.join(root, ".uxfactory");
  store = new BridgeStore(dataDir);
  await store.init();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("queue", () => {
  it("enqueue generates a jobId when none is given", async () => {
    const id = await store.enqueue({ x: 1 });
    expect(id).toMatch(/^job_/);
    expect(await store.pending()).toBe(1);
  });

  it("returns null from dequeueNext when the queue is empty", async () => {
    expect(await store.dequeueNext()).toBeNull();
  });

  it("dequeues oldest-first by mtime (tiebreak by name) and moves to processed/", async () => {
    await store.enqueue({ k: "c" }, "job_c");
    await store.enqueue({ k: "b" }, "job_b");
    await store.enqueue({ k: "a" }, "job_a");
    const q = (n: string) => path.join(dataDir, "queue", `${n}.json`);
    await utimes(q("job_a"), new Date(1000), new Date(1000));
    await utimes(q("job_b"), new Date(2000), new Date(2000));
    await utimes(q("job_c"), new Date(3000), new Date(3000));
    expect(await store.pending()).toBe(3);
    const first = await store.dequeueNext();
    expect(first?.jobId).toBe("job_a");
    expect(first?.spec).toEqual({ k: "a" });
    const second = await store.dequeueNext();
    expect(second?.jobId).toBe("job_b");
    expect(await store.pending()).toBe(1);
    const processed = await readdir(path.join(dataDir, "queue", "processed"));
    expect(processed.some((n) => n.startsWith("job_a-"))).toBe(true);
  });

  it("survives a restart (queue is files on disk)", async () => {
    await store.enqueue({ a: 1 }, "job_1");
    await store.enqueue({ b: 2 }, "job_2");
    const reopened = new BridgeStore(dataDir);
    await reopened.init();
    expect(await reopened.pending()).toBe(2);
    expect(await reopened.dequeueNext()).not.toBeNull();
  });
});

describe("reports", () => {
  it("saves a report, assigning a renderId, and reads it back by id and as latest", async () => {
    const stored = await store.saveReport(makeReport());
    expect(stored.renderId).toMatch(/^r_/);
    expect((await store.getReport(stored.renderId))?.renderId).toBe(stored.renderId);
    expect((await store.getReport())?.renderId).toBe(stored.renderId);
    expect(await store.hasAnyReport()).toBe(true);
  });

  it("keeps an explicit renderId", async () => {
    const stored = await store.saveReport(makeReport({ renderId: "r_explicit" }));
    expect(stored.renderId).toBe("r_explicit");
    expect((await store.getReport("r_explicit"))?.fileName).toBe("F");
  });

  it("returns null for a missing report and reads latest on a cold start", async () => {
    expect(await store.getReport()).toBeNull();
    expect(await store.hasAnyReport()).toBe(false);
    await store.saveReport(makeReport({ renderId: "r_cold" }));
    const reopened = new BridgeStore(dataDir);
    await reopened.init();
    expect((await reopened.getReport())?.renderId).toBe("r_cold");
  });
});

describe("selection", () => {
  it("stores and returns the latest selection", async () => {
    expect(await store.getSelection()).toBeNull();
    await store.saveSelection({ ids: ["1:2"] });
    expect(await store.getSelection()).toEqual({ ids: ["1:2"] });
  });
});

describe("verify", () => {
  it("saves and reads a verify result", async () => {
    await store.saveVerify(makeResult("v_1"));
    expect((await store.getVerify("v_1"))?.status).toBe("PASS");
    expect(await store.getVerify("nope")).toBeNull();
  });

  it("prunes verify results to the newest 50", async () => {
    for (let i = 0; i < 51; i++) {
      const id = `v_${String(i).padStart(2, "0")}`;
      await store.saveVerify(makeResult(id));
      await utimes(
        path.join(dataDir, "renders", "verify", `${id}.json`),
        new Date(1000 * (i + 1)),
        new Date(1000 * (i + 1)),
      );
    }
    const files = await readdir(path.join(dataDir, "renders", "verify"));
    expect(files.length).toBe(50);
    expect(await store.getVerify("v_00")).toBeNull();
    expect(await store.getVerify("v_50")).not.toBeNull();
  });
});

describe("batch", () => {
  it("approves a batch, enqueuing the approved specs", async () => {
    const batchId = await store.saveBatch({
      items: [
        { spec: { edits: [{ id: "1", set: { x: 1 } }] } },
        { spec: { edits: [{ id: "2", set: { y: 2 } }] } },
      ],
    });
    const batch = await store.getBatch(batchId);
    expect(batch?.items).toHaveLength(2);
    expect(batch?.status).toBe("pending");
    const firstItemId = batch!.items[0]!.itemId;
    expect(await store.pending()).toBe(0);
    const updated = await store.approveBatch(batchId, [firstItemId]);
    expect(updated.status).toBe("approved");
    expect(updated.items[0]?.status).toBe("approved");
    expect(updated.items[1]?.status).toBe("rejected");
    expect(await store.pending()).toBe(1);
  });

  it("getBatch() returns the latest pending batch, null when none/unknown", async () => {
    expect(await store.getBatch()).toBeNull();
    await store.saveBatch({ items: [{ spec: { edits: [{ id: "1", set: { x: 1 } }] } }] });
    expect((await store.getBatch())?.status).toBe("pending");
    expect(await store.getBatch("missing")).toBeNull();
  });
});

describe("connection state & isolation", () => {
  it("tracks pluginSeen", () => {
    expect(store.pluginSeen).toBe(false);
    store.markPluginSeen();
    expect(store.pluginSeen).toBe(true);
  });

  it("never writes outside dataDir", async () => {
    await store.enqueue({ a: 1 }, "job_1");
    await store.dequeueNext();
    await store.saveReport(makeReport());
    await store.saveVerify(makeResult("v_1"));
    await store.saveSelection({ ids: ["1:2"] });
    const batchId = await store.saveBatch({
      items: [{ spec: { edits: [{ id: "1", set: { x: 1 } }] } }],
    });
    const b = await store.getBatch(batchId);
    await store.approveBatch(batchId, [b!.items[0]!.itemId]);
    expect((await readdir(root)).sort()).toEqual([".uxfactory"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge`
Expected: FAIL — cannot find module `../src/store.js` (and `@uxfactory/bridge` not yet linked).

- [ ] **Step 3: Create the package files**

`packages/uxfactory-bridge/package.json`:

```json
{
  "name": "@uxfactory/bridge",
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
    "@fastify/cors": "11.2.0",
    "@uxfactory/gate": "workspace:*",
    "@uxfactory/spec": "workspace:*",
    "fastify": "5.9.0"
  }
}
```

`packages/uxfactory-bridge/tsconfig.json`:

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

`packages/uxfactory-bridge/tsconfig.typecheck.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "..",
    "paths": {
      "@uxfactory/spec": ["../uxfactory-spec/src/index.ts"],
      "@uxfactory/gate": ["../uxfactory-gate/src/index.ts"]
    }
  },
  "include": ["src", "test"]
}
```

`packages/uxfactory-bridge/src/index.ts` (placeholder — exports the store now; server exports added in Task 7):

```ts
export { BridgeStore } from "./store.js";
export type { Batch, BatchItem } from "./store.js";
```

`packages/uxfactory-bridge/src/store.ts`:

```ts
import { mkdir, readFile, writeFile, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { RenderReport, GateResult } from "@uxfactory/gate";

/** One item inside a staged batch (PRD §7.7). */
export interface BatchItem {
  itemId: string;
  spec: unknown;
  preview?: string;
  status: "pending" | "approved" | "rejected";
}

/** A staged batch of specs awaiting approval. */
export interface Batch {
  batchId: string;
  status: "pending" | "approved";
  items: BatchItem[];
}

/**
 * File-backed persistence for the bridge. Everything lives under `dataDir`
 * (PRD §19/NF2: nothing is ever written outside it). All ids are generated
 * from a clock plus an internal monotonic counter so concurrent calls in the
 * same millisecond never collide. A restart re-reads the queue from disk.
 */
export class BridgeStore {
  readonly dataDir: string;
  private readonly queueDir: string;
  private readonly processedDir: string;
  private readonly rendersDir: string;
  private readonly verifyDir: string;
  private readonly batchDir: string;
  private readonly selectionFile: string;
  private counter = 0;
  private latestRenderId: string | null = null;
  private _pluginSeen = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.queueDir = path.join(dataDir, "queue");
    this.processedDir = path.join(this.queueDir, "processed");
    this.rendersDir = path.join(dataDir, "renders");
    this.verifyDir = path.join(this.rendersDir, "verify");
    this.batchDir = path.join(dataDir, "batch");
    this.selectionFile = path.join(dataDir, "selection.json");
  }

  /** Create every subdirectory (idempotent — recursive mkdir makes parents too). */
  async init(): Promise<void> {
    await mkdir(this.processedDir, { recursive: true });
    await mkdir(this.verifyDir, { recursive: true });
    await mkdir(this.batchDir, { recursive: true });
  }

  /** True once a plugin has hit one of the plugin-facing routes this process. */
  get pluginSeen(): boolean {
    return this._pluginSeen;
  }

  /** Mark that the plugin has connected (called by the routes, not the store). */
  markPluginSeen(): void {
    this._pluginSeen = true;
  }

  // --- id helpers (private) ---

  private nextCount(): number {
    this.counter += 1;
    return this.counter;
  }

  /** ISO timestamp with filename-hostile characters replaced. */
  private stamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  private newJobId(): string {
    return `job_${Date.now()}_${this.nextCount()}`;
  }

  private newBatchId(): string {
    return `b_${Date.now()}_${this.nextCount()}`;
  }

  private newRenderId(): string {
    return `r_${this.stamp()}_${this.nextCount()}`;
  }

  // --- queue ---

  /** Write the raw spec to `queue/<jobId>.json`; generate a jobId if none given. */
  async enqueue(spec: unknown, jobId?: string): Promise<string> {
    const id = jobId ?? this.newJobId();
    await writeFile(path.join(this.queueDir, `${id}.json`), JSON.stringify(spec, null, 2), "utf8");
    return id;
  }

  /** Count pending queue files (excludes the processed/ subdirectory). */
  async pending(): Promise<number> {
    const entries = await readdir(this.queueDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).length;
  }

  /** Pick the oldest queue file (mtime, tiebreak name), parse it, move it to processed/. */
  async dequeueNext(): Promise<{ jobId: string; spec: unknown } | null> {
    const entries = await readdir(this.queueDir, { withFileTypes: true });
    const names = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
    if (names.length === 0) return null;
    const ranked = await Promise.all(
      names.map(async (name) => ({
        name,
        mtimeMs: (await stat(path.join(this.queueDir, name))).mtimeMs,
      })),
    );
    ranked.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
    const chosen = ranked[0]!.name;
    const jobId = chosen.replace(/\.json$/, "");
    const raw = await readFile(path.join(this.queueDir, chosen), "utf8");
    const spec = JSON.parse(raw) as unknown;
    await rename(
      path.join(this.queueDir, chosen),
      path.join(this.processedDir, `${jobId}-${this.stamp()}.json`),
    );
    return { jobId, spec };
  }

  // --- render reports ---

  /** Persist a report; assign a renderId if missing/empty. Tracks the latest in memory. */
  async saveReport(report: RenderReport): Promise<RenderReport> {
    const renderId =
      report.renderId && report.renderId.length > 0 ? report.renderId : this.newRenderId();
    const stored: RenderReport = { ...report, renderId };
    await writeFile(
      path.join(this.rendersDir, `${renderId}.json`),
      JSON.stringify(stored, null, 2),
      "utf8",
    );
    this.latestRenderId = renderId;
    return stored;
  }

  /** Read a report by id, or the latest (in-memory, else newest file by mtime). null if none. */
  async getReport(renderId?: string): Promise<RenderReport | null> {
    const id = renderId ?? this.latestRenderId ?? (await this.newestReportId());
    if (id === null) return null;
    try {
      const raw = await readFile(path.join(this.rendersDir, `${id}.json`), "utf8");
      return JSON.parse(raw) as RenderReport;
    } catch {
      return null;
    }
  }

  /** True when at least one render report exists (excludes the verify/ subdir). */
  async hasAnyReport(): Promise<boolean> {
    const entries = await readdir(this.rendersDir, { withFileTypes: true });
    return entries.some((e) => e.isFile() && e.name.endsWith(".json"));
  }

  private async newestReportId(): Promise<string | null> {
    const entries = await readdir(this.rendersDir, { withFileTypes: true });
    const names = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
    if (names.length === 0) return null;
    const ranked = await Promise.all(
      names.map(async (name) => ({
        name,
        mtimeMs: (await stat(path.join(this.rendersDir, name))).mtimeMs,
      })),
    );
    ranked.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
    return ranked[0]!.name.replace(/\.json$/, "");
  }

  // --- selection ---

  async saveSelection(sel: unknown): Promise<void> {
    await writeFile(this.selectionFile, JSON.stringify(sel, null, 2), "utf8");
  }

  async getSelection(): Promise<unknown | null> {
    try {
      const raw = await readFile(this.selectionFile, "utf8");
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  // --- verify results (keep newest 50) ---

  async saveVerify(result: GateResult & { verifyId: string }): Promise<void> {
    await writeFile(
      path.join(this.verifyDir, `${result.verifyId}.json`),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    await this.pruneVerify(50);
  }

  async getVerify(verifyId: string): Promise<(GateResult & { verifyId: string }) | null> {
    try {
      const raw = await readFile(path.join(this.verifyDir, `${verifyId}.json`), "utf8");
      return JSON.parse(raw) as GateResult & { verifyId: string };
    } catch {
      return null;
    }
  }

  private async pruneVerify(keep: number): Promise<void> {
    const entries = await readdir(this.verifyDir, { withFileTypes: true });
    const names = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
    if (names.length <= keep) return;
    const ranked = await Promise.all(
      names.map(async (name) => ({
        name,
        mtimeMs: (await stat(path.join(this.verifyDir, name))).mtimeMs,
      })),
    );
    ranked.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
    for (const { name } of ranked.slice(keep)) {
      await unlink(path.join(this.verifyDir, name));
    }
  }

  // --- batches ---

  async saveBatch(batch: { items: { spec: unknown; preview?: string }[] }): Promise<string> {
    const batchId = this.newBatchId();
    const items: BatchItem[] = batch.items.map((it, i) => ({
      itemId: `${batchId}_item_${i + 1}`,
      spec: it.spec,
      ...(it.preview !== undefined ? { preview: it.preview } : {}),
      status: "pending" as const,
    }));
    const stored: Batch = { batchId, status: "pending", items };
    await writeFile(
      path.join(this.batchDir, `${batchId}.json`),
      JSON.stringify(stored, null, 2),
      "utf8",
    );
    return batchId;
  }

  async getBatch(batchId?: string): Promise<Batch | null> {
    if (batchId !== undefined) {
      try {
        const raw = await readFile(path.join(this.batchDir, `${batchId}.json`), "utf8");
        return JSON.parse(raw) as Batch;
      } catch {
        return null;
      }
    }
    const entries = await readdir(this.batchDir, { withFileTypes: true });
    const names = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
    if (names.length === 0) return null;
    const ranked = await Promise.all(
      names.map(async (name) => ({
        name,
        mtimeMs: (await stat(path.join(this.batchDir, name))).mtimeMs,
      })),
    );
    ranked.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
    for (const { name } of ranked) {
      const raw = await readFile(path.join(this.batchDir, name), "utf8");
      const batch = JSON.parse(raw) as Batch;
      if (batch.status === "pending") return batch;
    }
    return null;
  }

  async approveBatch(batchId: string, approvedItemIds: string[]): Promise<Batch> {
    const batch = await this.getBatch(batchId);
    if (batch === null) throw new Error(`unknown batch: ${batchId}`);
    const approved = new Set(approvedItemIds);
    for (const item of batch.items) {
      item.status = approved.has(item.itemId) ? "approved" : "rejected";
    }
    batch.status = "approved";
    for (const item of batch.items) {
      if (item.status === "approved") await this.enqueue(item.spec);
    }
    await writeFile(
      path.join(this.batchDir, `${batchId}.json`),
      JSON.stringify(batch, null, 2),
      "utf8",
    );
    return batch;
  }
}
```

- [ ] **Step 4: Add the root vitest alias for spec + gate**

Replace `vitest.config.ts` (root) with:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "packages/**/test/**/*.test.ts", "clients/**/test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@uxfactory/spec": fileURLToPath(
        new URL("./packages/uxfactory-spec/src/index.ts", import.meta.url),
      ),
      "@uxfactory/gate": fileURLToPath(
        new URL("./packages/uxfactory-gate/src/index.ts", import.meta.url),
      ),
    },
  },
});
```

- [ ] **Step 5: Install and run the test**

Run: `pnpm install && pnpm vitest run packages/uxfactory-bridge`
Expected: PASS — all store tests pass. (`pnpm install` links `@uxfactory/spec`/`@uxfactory/gate` and adds `fastify`/`@fastify/cors`, updating `pnpm-lock.yaml`.)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @uxfactory/bridge typecheck`
Expected: exit 0 — the `paths` map resolves both spec and gate types from source.

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-bridge vitest.config.ts pnpm-lock.yaml
git commit -m "feat(bridge): scaffold @uxfactory/bridge with file-backed BridgeStore"
```

---

## Task 2: `createBridge`, `GET /health` & `GET /next`

**Files:**

- Create: `packages/uxfactory-bridge/src/server.ts`
- Test: `packages/uxfactory-bridge/test/health-next.test.ts`

**Interfaces:**

- Consumes: `BridgeStore` from `./store.js`; `Fastify` (default) + `FastifyInstance` (type-only) from `fastify`; `cors` (default) from `@fastify/cors`.
- Produces:
  - `interface BridgeOptions { dataDir?: string; editTimeoutMs?: number }`
  - `function createBridge(options?: BridgeOptions): Promise<FastifyInstance>`
  - Routes: `GET /health` → `{ ok: true, pending: number }`; `GET /next` → `200 { jobId, spec }` or `204`.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-bridge/test/health-next.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";
import { BridgeStore } from "../src/store.js";

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
  app = await createBridge({ dataDir });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("GET /health", () => {
  it("reports ok and the pending count", async () => {
    const empty = await app.inject({ method: "GET", url: "/health" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ ok: true, pending: 0 });

    const seed = new BridgeStore(dataDir);
    await seed.init();
    await seed.enqueue({ edits: [{ id: "1:2", set: { x: 1 } }] }, "job_x");
    const one = await app.inject({ method: "GET", url: "/health" });
    expect(one.json()).toEqual({ ok: true, pending: 1 });
  });
});

describe("GET /next", () => {
  it("dequeues the oldest job, then 204 when empty", async () => {
    const seed = new BridgeStore(dataDir);
    await seed.init();
    await seed.enqueue({ editor: "figma", edits: [{ id: "1:2", set: { x: 1 } }] }, "job_1");

    const res = await app.inject({ method: "GET", url: "/next" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      jobId: "job_1",
      spec: { editor: "figma", edits: [{ id: "1:2", set: { x: 1 } }] },
    });

    expect((await app.inject({ method: "GET", url: "/health" })).json().pending).toBe(0);

    const empty = await app.inject({ method: "GET", url: "/next" });
    expect(empty.statusCode).toBe(204);
    expect(empty.body).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/health-next.test.ts`
Expected: FAIL — cannot find module `../src/server.js`.

- [ ] **Step 3: Create the server with `createBridge` + health/next**

`packages/uxfactory-bridge/src/server.ts`:

```ts
import path from "node:path";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { BridgeStore } from "./store.js";

/** Options for building a bridge. */
export interface BridgeOptions {
  /** Root for all on-disk state. Default: <cwd>/.uxfactory */
  dataDir?: string;
  /** How long POST /edits waits for the matching render before 504. Default 4000ms. */
  editTimeoutMs?: number;
}

const DEFAULT_EDIT_TIMEOUT_MS = 4000;

/** Build a configured (but not-yet-listening) Fastify bridge. */
export async function createBridge(options: BridgeOptions = {}): Promise<FastifyInstance> {
  const dataDir = options.dataDir ?? path.resolve(process.cwd(), ".uxfactory");
  // editTimeoutMs is consumed by POST /edits (Task 5).
  const editTimeoutMs = options.editTimeoutMs ?? DEFAULT_EDIT_TIMEOUT_MS;

  const store = new BridgeStore(dataDir);
  await store.init();

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // --- health & queue ---

  app.get("/health", async () => {
    return { ok: true, pending: await store.pending() };
  });

  app.get("/next", async (_req, reply) => {
    store.markPluginSeen();
    const job = await store.dequeueNext();
    if (job === null) return reply.code(204).send();
    return { jobId: job.jobId, spec: job.spec };
  });

  void editTimeoutMs;
  return app;
}
```

> Note: `void editTimeoutMs;` is a temporary no-op so the unused binding reads cleanly until Task 5 wires `POST /edits`; delete it in Task 5.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-bridge/test/health-next.test.ts`
Expected: PASS — health + next tests pass. (`GET /next` calls `store.markPluginSeen()`; its behavioral effect is verified in Task 4's 503/409 tests.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @uxfactory/bridge typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-bridge
git commit -m "feat(bridge): add createBridge with GET /health and GET /next"
```

---

## Task 3: `POST/GET /rendered` & `POST/GET /selection`

**Files:**

- Modify: `packages/uxfactory-bridge/src/server.ts`
- Test: `packages/uxfactory-bridge/test/rendered-selection.test.ts`

**Interfaces:**

- Consumes: `RenderReport` (type-only) from `@uxfactory/gate`.
- Produces (routes): `POST /rendered` → `200 { renderId }` (resolves any matching `/edits` waiter); `GET /rendered` → `200 report` or `404`; `POST /selection` → `200 { ok: true }`; `GET /selection` → `200 selection` or `404`. Introduces the in-memory `waiters` map + `EditWaiter` interface used by Task 5.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-bridge/test/rendered-selection.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { RenderReport } from "@uxfactory/gate";
import { createBridge } from "../src/server.js";

const makeReport = (over: Partial<RenderReport> = {}): RenderReport => ({
  renderId: "",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "F",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40 }],
  ...over,
});

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
  app = await createBridge({ dataDir });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("rendered", () => {
  it("saves a report (assigning a renderId) and returns the latest", async () => {
    const res = await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
    expect(res.statusCode).toBe(200);
    const renderId = res.json().renderId as string;
    expect(renderId).toMatch(/^r_/);

    const got = await app.inject({ method: "GET", url: "/rendered" });
    expect(got.statusCode).toBe(200);
    expect(got.json().renderId).toBe(renderId);
  });

  it("GET /rendered is 404 before any render", async () => {
    const res = await app.inject({ method: "GET", url: "/rendered" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "no render report yet" });
  });
});

describe("selection", () => {
  it("round-trips the latest selection", async () => {
    const ok = await app.inject({ method: "POST", url: "/selection", payload: { ids: ["1:2"] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });

    const got = await app.inject({ method: "GET", url: "/selection" });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({ ids: ["1:2"] });
  });

  it("GET /selection is 404 before any selection", async () => {
    const res = await app.inject({ method: "GET", url: "/selection" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "no selection yet" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/rendered-selection.test.ts`
Expected: FAIL — `/rendered` and `/selection` routes return 404 (not registered).

- [ ] **Step 3: Add the import, the waiter map, and the handlers**

In `packages/uxfactory-bridge/src/server.ts`, add this import below the `@fastify/cors` import:

```ts
import type { RenderReport } from "@uxfactory/gate";
```

Add the `EditWaiter` interface just below the `DEFAULT_EDIT_TIMEOUT_MS` constant:

```ts
/** A POST /edits caller awaiting the render keyed by the enqueued jobId. */
interface EditWaiter {
  resolve: (report: RenderReport) => void;
  timer: ReturnType<typeof setTimeout>;
}
```

Inside `createBridge`, add the waiter map immediately after `await app.register(cors, { origin: true });`:

```ts
  const waiters = new Map<string, EditWaiter>();
```

Insert these handlers inside `createBridge`, immediately before `void editTimeoutMs;`:

```ts
  // --- render reports ---

  app.post("/rendered", async (req) => {
    store.markPluginSeen();
    const body = req.body as RenderReport & { jobId?: string };
    const stored = await store.saveReport(body);
    if (typeof body.jobId === "string") {
      const waiter = waiters.get(body.jobId);
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        waiters.delete(body.jobId);
        waiter.resolve(stored);
      }
    }
    return { renderId: stored.renderId };
  });

  app.get("/rendered", async (_req, reply) => {
    const report = await store.getReport();
    if (report === null) return reply.code(404).send({ error: "no render report yet" });
    return report;
  });

  // --- selection ---

  app.post("/selection", async (req) => {
    store.markPluginSeen();
    await store.saveSelection(req.body);
    return { ok: true };
  });

  app.get("/selection", async (_req, reply) => {
    const sel = await store.getSelection();
    if (sel === null) return reply.code(404).send({ error: "no selection yet" });
    return sel;
  });
```

> The `waiters` map is referenced by `/rendered` now (a harmless no-op until a waiter is registered) and populated by `POST /edits` in Task 5.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-bridge/test/rendered-selection.test.ts`
Expected: PASS — rendered + selection tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @uxfactory/bridge typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-bridge
git commit -m "feat(bridge): add /rendered and /selection routes with edit-waiter plumbing"
```

---

## Task 4: `POST /verify` & `GET /verify/:id`

**Files:**

- Modify: `packages/uxfactory-bridge/src/server.ts`
- Test: `packages/uxfactory-bridge/test/verify.test.ts`

**Interfaces:**

- Consumes: `validate` (value) + `Spec` (type-only) from `@uxfactory/spec`; `gate` (value) + `GateResult`, `CheckId` (type-only) from `@uxfactory/gate`.
- Produces (routes): `POST /verify` with logic order (1) validate → 400; (2) explicit `renderId` not found → 404; (3) no report at all → 503 (plugin never seen) / 409 (seen, none yet); (4) run `gate(spec, report, { tolerancePx, checks?, verifyId })`, `store.saveVerify`, return the `GateResult` (HTTP 200 for both PASS and FAIL). `GET /verify/:id` → `200 result` or `404`. The bridge generates `verifyId` (`v_<ts>_<n>`).

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-bridge/test/verify.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { RenderReport } from "@uxfactory/gate";
import { createBridge } from "../src/server.js";

const matchingSpec = {
  editor: "figma",
  frames: [
    {
      name: "f",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { type: "shape", name: "box", x: 10, y: 20, width: 30, height: 40, fill: "#1E88E5" },
      ],
    },
  ],
};

const makeReport = (over: Partial<RenderReport> = {}): RenderReport => ({
  renderId: "",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "F",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40, fill: "#1e88e5" }],
  ...over,
});

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
  app = await createBridge({ dataDir });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /verify transport codes", () => {
  it("400 on an invalid spec", async () => {
    const res = await app.inject({ method: "POST", url: "/verify", payload: { spec: { bogus: 1 } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid spec");
    expect(Array.isArray(res.json().details)).toBe(true);
  });

  it("404 when an explicit renderId is unknown", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec, renderId: "nope" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown renderId" });
  });

  it("503 when no report exists and the plugin has never connected", async () => {
    const res = await app.inject({ method: "POST", url: "/verify", payload: { spec: matchingSpec } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "plugin has never connected" });
  });

  it("409 when the plugin has connected but no report exists yet", async () => {
    await app.inject({ method: "GET", url: "/next" }); // marks pluginSeen (204)
    const res = await app.inject({ method: "POST", url: "/verify", payload: { spec: matchingSpec } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no render report yet" });
  });
});

describe("POST /verify gate outcomes (always HTTP 200)", () => {
  it("PASS for a matching spec, including verifyId and summary.skipped", async () => {
    await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
    const res = await app.inject({ method: "POST", url: "/verify", payload: { spec: matchingSpec } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("PASS");
    expect(body.verifyId).toMatch(/^v_/);
    expect(body.renderId).toMatch(/^r_/);
    expect(body.summary).toHaveProperty("skipped");
  });

  it("FAIL (HTTP 200) when geometry is off, then PASS when tolerance is widened", async () => {
    await app.inject({
      method: "POST",
      url: "/rendered",
      payload: makeReport({
        nodes: [{ id: "1:2", name: "box", type: "shape", x: 13, y: 20, w: 30, h: 40, fill: "#1e88e5" }],
      }),
    });
    const strict = await app.inject({ method: "POST", url: "/verify", payload: { spec: matchingSpec } });
    expect(strict.statusCode).toBe(200);
    expect(strict.json().status).toBe("FAIL");

    const loose = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec, tolerance: { geometryPx: 5 } },
    });
    expect(loose.statusCode).toBe(200);
    expect(loose.json().status).toBe("PASS");
  });

  it("honors a checks subset", async () => {
    await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: { spec: matchingSpec, checks: ["editorType"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.checks).toBe(1);
  });
});

describe("GET /verify/:id", () => {
  it("returns a stored result by id, 404 otherwise", async () => {
    await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
    const verifyId = (
      await app.inject({ method: "POST", url: "/verify", payload: { spec: matchingSpec } })
    ).json().verifyId as string;

    const got = await app.inject({ method: "GET", url: `/verify/${verifyId}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().verifyId).toBe(verifyId);

    expect((await app.inject({ method: "GET", url: "/verify/nope" })).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/verify.test.ts`
Expected: FAIL — `/verify` routes not registered.

- [ ] **Step 3: Add imports, the verifyId generator, and the handlers**

In `packages/uxfactory-bridge/src/server.ts`, add these imports below the existing `@uxfactory/gate` type import:

```ts
import { validate } from "@uxfactory/spec";
import type { Spec } from "@uxfactory/spec";
import { gate } from "@uxfactory/gate";
import type { GateResult, CheckId } from "@uxfactory/gate";
```

Add this module-level constant beside `DEFAULT_EDIT_TIMEOUT_MS`:

```ts
const DEFAULT_TOLERANCE_PX = 0.5;
```

Inside `createBridge`, add the verifyId generator immediately after the `waiters` map (the bridge generates verifyId here — the gate never invents ids):

```ts
  let verifyCounter = 0;
  const nextVerifyId = (): string => {
    verifyCounter += 1;
    return `v_${Date.now()}_${verifyCounter}`;
  };
```

Insert these handlers inside `createBridge`, immediately before `void editTimeoutMs;`:

```ts
  // --- verify ---

  app.post("/verify", async (req, reply) => {
    const body = req.body as {
      spec?: unknown;
      renderId?: string;
      tolerance?: { geometryPx?: number };
      checks?: CheckId[];
    };

    const result = validate(body.spec);
    if (!result.valid) {
      return reply.code(400).send({ error: "invalid spec", details: result.errors });
    }

    let report: RenderReport | null;
    if (body.renderId !== undefined) {
      report = await store.getReport(body.renderId);
      if (report === null) return reply.code(404).send({ error: "unknown renderId" });
    } else {
      report = await store.getReport();
    }
    if (report === null) {
      if (!store.pluginSeen) return reply.code(503).send({ error: "plugin has never connected" });
      return reply.code(409).send({ error: "no render report yet" });
    }

    const verifyId = nextVerifyId();
    const gateResult: GateResult = gate(body.spec as Spec, report, {
      tolerancePx: body.tolerance?.geometryPx ?? DEFAULT_TOLERANCE_PX,
      ...(body.checks !== undefined ? { checks: body.checks } : {}),
      verifyId,
    });
    const stored: GateResult & { verifyId: string } = { ...gateResult, verifyId };
    await store.saveVerify(stored);
    return stored;
  });

  app.get<{ Params: { id: string } }>("/verify/:id", async (req, reply) => {
    const found = await store.getVerify(req.params.id);
    if (found === null) return reply.code(404).send({ error: "unknown verifyId" });
    return found;
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-bridge/test/verify.test.ts`
Expected: PASS — all transport-code, gate-outcome, and `:id` tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @uxfactory/bridge typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-bridge
git commit -m "feat(bridge): wire gate() into POST /verify and GET /verify/:id"
```

---

## Task 5: `POST /edits` (synchronous edit channel)

**Files:**

- Modify: `packages/uxfactory-bridge/src/server.ts`
- Test: `packages/uxfactory-bridge/test/edits.test.ts`

**Interfaces:**

- Consumes: `validate` (already imported in Task 4); the `waiters` map (Task 3); `editTimeoutMs` (Task 2).
- Produces (route): `POST /edits` — validate (400 on invalid), `store.enqueue`, register a waiter keyed by jobId, await it with `editTimeoutMs`. On resolve → `200` the render report; on timeout → `504 { error: "render timed out" }` (waiter cleaned up; job stays on the queue). NF3: never hang.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-bridge/test/edits.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { RenderReport } from "@uxfactory/gate";
import { createBridge } from "../src/server.js";

const makeReport = (over: Partial<RenderReport> = {}): RenderReport => ({
  renderId: "",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "F",
  fileKey: "k",
  counts: { frames: 0, sections: 0, objects: 0, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 120, y: 20, w: 30, h: 40 }],
  ...over,
});

/** Poll GET /next until a job appears (robust against enqueue/dequeue interleaving). */
async function nextJob(app: FastifyInstance): Promise<{ jobId: string; spec: unknown }> {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: "GET", url: "/next" });
    if (res.statusCode === 200) return res.json() as { jobId: string; spec: unknown };
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("no job appeared on /next");
}

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
  app = await createBridge({ dataDir, editTimeoutMs: 2000 });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /edits", () => {
  it("correlates a render back to the waiting caller", async () => {
    const editSpec = { edits: [{ id: "1:2", set: { x: 120 } }] };
    const editsP = app.inject({ method: "POST", url: "/edits", payload: editSpec });

    const job = await nextJob(app);
    expect(job.spec).toEqual(editSpec);

    await app.inject({
      method: "POST",
      url: "/rendered",
      payload: { ...makeReport(), jobId: job.jobId },
    });

    const res = await editsP;
    expect(res.statusCode).toBe(200);
    expect(res.json().renderId).toMatch(/^r_/);
  });

  it("rejects an invalid edit spec with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/edits", payload: { bogus: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid spec");
  });

  it("returns 504 when no render arrives within editTimeoutMs (job stays queued)", async () => {
    const shortDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
    const shortApp = await createBridge({ dataDir: shortDir, editTimeoutMs: 30 });
    try {
      const res = await shortApp.inject({
        method: "POST",
        url: "/edits",
        payload: { edits: [{ id: "1:2", set: { x: 1 } }] },
      });
      expect(res.statusCode).toBe(504);
      expect(res.json()).toEqual({ error: "render timed out" });
      expect((await shortApp.inject({ method: "GET", url: "/health" })).json().pending).toBe(1);
    } finally {
      await shortApp.close();
      await rm(shortDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/edits.test.ts`
Expected: FAIL — `/edits` route not registered.

- [ ] **Step 3: Add the `/edits` handler and remove the temporary no-op**

In `packages/uxfactory-bridge/src/server.ts`, delete the line `  void editTimeoutMs;` and insert this handler in its place (before `return app;`):

```ts
  // --- synchronous edit channel ---

  app.post("/edits", async (req, reply) => {
    const result = validate(req.body);
    if (!result.valid) {
      return reply.code(400).send({ error: "invalid spec", details: result.errors });
    }
    const jobId = await store.enqueue(req.body);
    const report = await new Promise<RenderReport | null>((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(jobId);
        resolve(null);
      }, editTimeoutMs);
      waiters.set(jobId, { resolve, timer });
    });
    if (report === null) return reply.code(504).send({ error: "render timed out" });
    return report;
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-bridge/test/edits.test.ts`
Expected: PASS — correlation, 400, and 504 tests pass.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @uxfactory/bridge typecheck`
Expected: exit 0 — `editTimeoutMs` is now consumed (the `void` line is gone).

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-bridge
git commit -m "feat(bridge): add synchronous POST /edits channel with 504 timeout"
```

---

## Task 6: `POST /batch`, `GET /batch` & `POST /batch/:id/approve`

**Files:**

- Modify: `packages/uxfactory-bridge/src/server.ts`
- Test: `packages/uxfactory-bridge/test/batch.test.ts`

**Interfaces:**

- Consumes: `validate` (Task 4); `store.saveBatch`/`getBatch`/`approveBatch` (Task 1).
- Produces (routes): `POST /batch` — validate each item spec (any invalid → 400), `store.saveBatch` (status "pending", generated itemIds) → `200 { batchId, items }`. `GET /batch` — latest pending batch → `200` or `404`. `POST /batch/:id/approve` — `404` if unknown, else `store.approveBatch` (marks items, enqueues approved specs) → `200` updated batch.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-bridge/test/batch.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

const specA = { edits: [{ id: "1:2", set: { x: 10 } }] };
const specB = { edits: [{ id: "3:4", set: { y: 20 } }] };

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
  app = await createBridge({ dataDir });
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /batch", () => {
  it("creates a batch with generated itemIds (status pending)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/batch",
      payload: { items: [{ spec: specA }, { spec: specB, preview: "data:img" }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.batchId).toMatch(/^b_/);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].status).toBe("pending");
    expect(body.items[0].itemId).toMatch(/_item_1$/);
    expect(body.items[1].preview).toBe("data:img");
  });

  it("rejects a batch with any invalid item spec (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/batch",
      payload: { items: [{ spec: specA }, { spec: { bogus: true } }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid spec");
  });
});

describe("GET /batch", () => {
  it("returns the latest pending batch, 404 when none", async () => {
    expect((await app.inject({ method: "GET", url: "/batch" })).statusCode).toBe(404);
    await app.inject({ method: "POST", url: "/batch", payload: { items: [{ spec: specA }] } });
    const res = await app.inject({ method: "GET", url: "/batch" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
  });
});

describe("POST /batch/:id/approve", () => {
  it("enqueues approved specs and marks item statuses", async () => {
    const created = (
      await app.inject({
        method: "POST",
        url: "/batch",
        payload: { items: [{ spec: specA }, { spec: specB }] },
      })
    ).json();
    const before = (await app.inject({ method: "GET", url: "/health" })).json().pending;

    const res = await app.inject({
      method: "POST",
      url: `/batch/${created.batchId}/approve`,
      payload: { approvedItemIds: [created.items[0].itemId] },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.status).toBe("approved");
    expect(updated.items[0].status).toBe("approved");
    expect(updated.items[1].status).toBe("rejected");

    const after = (await app.inject({ method: "GET", url: "/health" })).json().pending;
    expect(after).toBe(before + 1);
  });

  it("404 on approving an unknown batch", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/batch/nope/approve",
      payload: { approvedItemIds: [] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown batch" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/batch.test.ts`
Expected: FAIL — `/batch` routes not registered.

- [ ] **Step 3: Add the batch handlers**

Insert these handlers inside `createBridge` in `packages/uxfactory-bridge/src/server.ts`, immediately before `return app;`:

```ts
  // --- batch ---

  app.post("/batch", async (req, reply) => {
    const body = req.body as { items?: { spec?: unknown; preview?: string }[] };
    const items = body.items ?? [];
    for (const item of items) {
      const result = validate(item.spec);
      if (!result.valid) {
        return reply.code(400).send({ error: "invalid spec", details: result.errors });
      }
    }
    const batchId = await store.saveBatch({
      items: items.map((it) => ({
        spec: it.spec,
        ...(it.preview !== undefined ? { preview: it.preview } : {}),
      })),
    });
    const batch = await store.getBatch(batchId);
    return { batchId, items: batch ? batch.items : [] };
  });

  app.get("/batch", async (_req, reply) => {
    const batch = await store.getBatch();
    if (batch === null) return reply.code(404).send({ error: "no batch yet" });
    return batch;
  });

  app.post<{ Params: { id: string }; Body: { approvedItemIds?: string[] } }>(
    "/batch/:id/approve",
    async (req, reply) => {
      const existing = await store.getBatch(req.params.id);
      if (existing === null) return reply.code(404).send({ error: "unknown batch" });
      return store.approveBatch(req.params.id, req.body?.approvedItemIds ?? []);
    },
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-bridge/test/batch.test.ts`
Expected: PASS — create/validate/get/approve/404 tests pass (approve increases the queue by the approved count).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @uxfactory/bridge typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-bridge
git commit -m "feat(bridge): add batch create/get/approve routes (approve enqueues approved specs)"
```

---

## Task 7: `startBridge`, CORS, public exports & cross-cutting verification

**Files:**

- Modify: `packages/uxfactory-bridge/src/server.ts`
- Modify: `packages/uxfactory-bridge/src/index.ts`
- Test: `packages/uxfactory-bridge/test/server.test.ts`

**Interfaces:**

- Produces: `function startBridge(options?: BridgeOptions & { port?: number }): Promise<{ url: string; close: () => Promise<void> }>` (listens on `127.0.0.1`; default port `process.env.UXFACTORY_PORT ?? 3779`; port `0` picks an ephemeral port). Public exports: `createBridge`, `startBridge`, `BridgeStore`, `BridgeOptions`, `Batch`, `BatchItem`.

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-bridge/test/server.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { RenderReport } from "@uxfactory/gate";
import { createBridge, startBridge } from "../src/server.js";
import * as pkg from "../src/index.js";

const matchingSpec = {
  editor: "figma",
  frames: [
    {
      name: "f",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        { type: "shape", name: "box", x: 10, y: 20, width: 30, height: 40, fill: "#1E88E5" },
      ],
    },
  ],
};

const makeReport = (over: Partial<RenderReport> = {}): RenderReport => ({
  renderId: "",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "F",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40, fill: "#1e88e5" }],
  ...over,
});

describe("CORS", () => {
  let app: FastifyInstance;
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
    app = await createBridge({ dataDir });
  });
  afterEach(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("reflects the request origin (open for the plugin iframe)", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "https://www.figma.com",
        "access-control-request-method": "GET",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("https://www.figma.com");
  });
});

describe("public exports", () => {
  it("exposes the documented surface", () => {
    expect(typeof pkg.createBridge).toBe("function");
    expect(typeof pkg.startBridge).toBe("function");
    expect(typeof pkg.BridgeStore).toBe("function");
  });
});

describe("startBridge", () => {
  it("listens on 127.0.0.1 and serves /health", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
    const handle = await startBridge({ dataDir: path.join(root, ".uxfactory"), port: 0 });
    try {
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const res = await fetch(`${handle.url}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; pending: number };
      expect(body.ok).toBe(true);
    } finally {
      await handle.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("REST surface round-trip", () => {
  let app: FastifyInstance;
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
    app = await createBridge({ dataDir });
  });
  afterEach(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("round-trips render, selection, verify and batch", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({
      ok: true,
      pending: 0,
    });

    const rendered = await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
    expect(rendered.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/rendered" })).statusCode).toBe(200);

    await app.inject({ method: "POST", url: "/selection", payload: { ids: ["1:2"] } });
    expect((await app.inject({ method: "GET", url: "/selection" })).json()).toEqual({
      ids: ["1:2"],
    });

    const verify = await app.inject({ method: "POST", url: "/verify", payload: { spec: matchingSpec } });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().status).toBe("PASS");
    const verifyId = verify.json().verifyId as string;
    expect((await app.inject({ method: "GET", url: `/verify/${verifyId}` })).statusCode).toBe(200);

    const created = (
      await app.inject({
        method: "POST",
        url: "/batch",
        payload: { items: [{ spec: { edits: [{ id: "1:2", set: { x: 1 } }] } }] },
      })
    ).json();
    expect((await app.inject({ method: "GET", url: "/batch" })).json().batchId).toBe(created.batchId);
    const approved = await app.inject({
      method: "POST",
      url: `/batch/${created.batchId}/approve`,
      payload: { approvedItemIds: [created.items[0].itemId] },
    });
    expect(approved.json().status).toBe("approved");
    expect((await app.inject({ method: "GET", url: "/health" })).json().pending).toBe(1);
  });
});

describe("isolation", () => {
  it("never writes outside dataDir", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
    const dataDir = path.join(root, ".uxfactory");
    const app = await createBridge({ dataDir });
    try {
      await app.inject({ method: "POST", url: "/selection", payload: { ids: ["1:2"] } });
      await app.inject({ method: "POST", url: "/rendered", payload: makeReport() });
      await app.inject({ method: "POST", url: "/verify", payload: { spec: matchingSpec } });
      await app.inject({
        method: "POST",
        url: "/batch",
        payload: { items: [{ spec: { edits: [{ id: "1:2", set: { x: 1 } }] } }] },
      });
      expect((await readdir(root)).sort()).toEqual([".uxfactory"]);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/server.test.ts`
Expected: FAIL — `startBridge` is not exported; `pkg.createBridge`/`pkg.startBridge` are undefined.

- [ ] **Step 3: Add `startBridge` to the server**

Append this function to `packages/uxfactory-bridge/src/server.ts`, after `createBridge` (add `const DEFAULT_PORT = 3779;` beside the other module-level constants):

```ts
const DEFAULT_PORT = 3779;

/** Build and start a bridge listening on 127.0.0.1. */
export async function startBridge(
  options: BridgeOptions & { port?: number } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = await createBridge(options);
  const port =
    options.port ??
    (process.env.UXFACTORY_PORT !== undefined ? Number(process.env.UXFACTORY_PORT) : DEFAULT_PORT);
  await app.listen({ host: "127.0.0.1", port });
  const address = app.server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    close: () => app.close(),
  };
}
```

- [ ] **Step 4: Finalize the public exports**

Replace `packages/uxfactory-bridge/src/index.ts` with:

```ts
export { createBridge, startBridge } from "./server.js";
export type { BridgeOptions } from "./server.js";
export { BridgeStore } from "./store.js";
export type { Batch, BatchItem } from "./store.js";
```

- [ ] **Step 5: Run the bridge suite + typecheck**

Run: `pnpm vitest run packages/uxfactory-bridge && pnpm --filter @uxfactory/bridge typecheck`
Expected: PASS — all bridge suites green; typecheck exit 0.

- [ ] **Step 6: Verify the built artifact runs standalone in real Node**

Run:

```bash
pnpm -r build
node --input-type=module -e "
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
const { createBridge } = await import('./packages/uxfactory-bridge/dist/src/index.js');
const dir = await mkdtemp(path.join(os.tmpdir(), 'uxf-artifact-'));
const app = await createBridge({ dataDir: dir });
const res = await app.inject({ method: 'GET', url: '/health' });
console.log('bridge artifact ok:', res.statusCode === 200 && res.json().ok === true);
await app.close();
await rm(dir, { recursive: true, force: true });
"
```

Expected: prints `bridge artifact ok: true` — the compiled bridge loads in real Node ESM and resolves `@uxfactory/spec` + `@uxfactory/gate` from their built `dist`. (`pnpm -r build` builds spec → gate → bridge in topological order.)

- [ ] **Step 7: Whole-monorepo green check**

Run: `pnpm typecheck && pnpm test && pnpm format:check`
Expected: all exit 0 (run `pnpm format` first if `format:check` flags the new files). Confirms the bridge integrates without breaking spec or gate, and that the new root `vitest.config.ts` alias resolves spec+gate from source for the whole suite.

- [ ] **Step 8: Commit**

```bash
git add packages/uxfactory-bridge
git commit -m "feat(bridge): add startBridge, finalize public exports, CORS + round-trip coverage"
```

---

## Self-Review

**1. Spec coverage** (against the design's route table, store contract, Global Constraints, and the cross-phase contract notes for §6.1/§6.2/§10.1):

- Data-dir layout (`queue/` + `processed/`, `renders/` + `verify/`, `batch/`, `selection.json`) → Task 1 (`BridgeStore` dirs + `init`). ✅
- `BridgeStore` methods `enqueue/pending/dequeueNext` (oldest-by-mtime, tiebreak name, move-to-processed) → Task 1 + tests. ✅
- `saveReport`/`getReport` (assign renderId, by-id, in-memory latest, cold-start newest-by-mtime), `hasAnyReport` → Task 1. ✅
- `saveSelection`/`getSelection`, `saveVerify`/`getVerify` (+ prune to newest 50), `saveBatch`/`getBatch` (latest pending)/`approveBatch` (mark + enqueue approved) → Task 1 + tests. ✅
- Restart survival + isolation (nothing outside dataDir) → Task 1 store tests + Task 7 server-level isolation test. ✅
- `createBridge` (cors `origin: true`, store init, routes, not listening) → Tasks 2-6; `startBridge` (127.0.0.1, `UXFACTORY_PORT ?? 3779`, ephemeral via port 0, `{url, close}`) → Task 7. ✅
- `GET /health` `{ok,pending}`; `GET /next` 200/204 + pluginSeen → Task 2. ✅
- `POST/GET /rendered`, `POST/GET /selection` (pluginSeen on plugin routes) → Task 3. ✅
- `POST /verify` ordered logic 400→404→503/409→200 (PASS/FAIL both 200), tolerance `geometryPx → tolerancePx` (default 0.5), checks passthrough, bridge-generated `verifyId`, `summary.skipped` present, `saveVerify`; `GET /verify/:id` 200/404 → Task 4 + tests. ✅
- `POST /edits` synchronous waiter, 400 invalid, 200 on correlated render, clean 504 on timeout (NF3, job stays queued) → Task 5 + tests. ✅
- `POST /batch` (validate each, generated itemIds, pending), `GET /batch` (latest pending/404), `POST /batch/:id/approve` (404 unknown, mark + enqueue approved) → Task 6 + tests. ✅
- Value-import of `validate` (spec) + `gate` (gate); root vitest `resolve.alias` for both; `paths` only in `tsconfig.typecheck.json` (both spec+gate) → Task 1 (config) + Task 4 (imports). ✅
- Built artifact loads in real Node + whole-monorepo green → Task 7 Steps 6-7. ✅

**2. Placeholder scan:** No "TODO"/"TBD"/"similar to"/"add error handling". Every code step shows complete code. The one transient line (`void editTimeoutMs;` in Task 2) is explicitly created and explicitly deleted in Task 5 Step 3, with `editTimeoutMs` then consumed by `POST /edits`. ✅

**3. Type consistency:** `BridgeStore`, `Batch`, `BatchItem`, `BridgeOptions`, `EditWaiter` are used identically across tasks. Store method signatures (`enqueue`, `pending`, `dequeueNext`, `saveReport`, `getReport`, `hasAnyReport`, `saveSelection`, `getSelection`, `saveVerify`, `getVerify`, `saveBatch`, `getBatch`, `approveBatch`, `markPluginSeen`, `pluginSeen`) match between Task 1 (definition) and the route handlers (Tasks 2-6). `RenderReport`/`GateResult`/`CheckId` are type-only imports from `@uxfactory/gate`; `Spec` is type-only and `validate`/`gate` are value imports (`verbatimModuleSyntax` split honored). `saveVerify` consumes exactly `GateResult & { verifyId: string }`, which the `/verify` handler constructs (`{ ...gateResult, verifyId }`). The `/edits` `resolve` (typed `(RenderReport | null) => void`) is assignable to `EditWaiter.resolve` (`(RenderReport) => void`) by parameter contravariance. `startBridge`'s `close` returns `app.close()` (`Promise<undefined>`, assignable to `Promise<void>`). ✅

**4. Judgment calls** (flagged where the design left a choice):

- **verifyId is generated in `createBridge` (server), not `BridgeStore`** — the route needs the id before gating (it is both the `gate` option and the storage key), and the store's id helpers are private per the design. The store still owns `r_`/`job_`/`b_` ids; the server's `nextVerifyId` uses the same `v_<ts>_<n>` format with a per-instance counter.
- **`pluginSeen` lives on the store (in-memory)**; `createBridge` closes over the store rather than decorating the app (the design allowed either). It resets on restart, so a fresh process correctly answers 503 until a plugin reconnects.
- **`getReportExists` was omitted** (the design marked it "if helpful"); `getReport(renderId)` already returns the report the `/verify` handler needs, so a separate existence check would be dead code.
- **Tests set file mtimes via `utimes`** (queue ordering, verify pruning) to make mtime-based ordering deterministic without `sleep`, and `POST /edits` correlation polls `GET /next` to stay robust against enqueue/dequeue interleaving.

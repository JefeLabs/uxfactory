# Worker Liveness (Tagged-SSE Presence + Panel Surface) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bridge learns which workers are live per project root from their tagged SSE subscriptions, exposes that on the project snapshot and as `worker-status` broadcast frames, and the panel surfaces "no worker is serving this project" as banners (Artifacts, Prompt) and a ContextBar dot.

**Architecture:** The worker already keeps a persistent, auto-reconnecting SSE connection to `GET /pipeline/events`; it now tags that URL with `?client=worker&root=<cwd>&kinds=<csv>`. The bridge tracks tagged sockets in a pure `WorkerPresenceRegistry` (add on connect, remove on socket close — presence is structural, no thresholds), enriches `GET /project/snapshot` with a `workers` array, and broadcasts a full-list `worker-status` frame on every transition. The panel holds the slice in Zustand (`null` = unknown, `[]` = known-none), seeded by snapshot arrivals and updated by frames.

**Tech Stack:** Fastify (bridge), plain `fetch` SSE (worker), React + Zustand + @tanstack/react-query (panel), vitest everywhere.

**Spec:** `docs/superpowers/specs/2026-07-09-worker-liveness-design.md` — read it first.

## Global Constraints

- Node ≥ 20.10, pnpm workspace. Run all commands from the repo root (`/…/jefelabs/uxfactory`) unless a step says otherwise.
- `@uxfactory/bridge` is published → the bridge change needs a `.changeset/*.md` entry (Task 3 adds it). Plugin and worker are private — no changeset.
- Wire shapes (verbatim from spec):
  - Worker SSE URL: `GET /pipeline/events?client=worker&root=<projectRoot>&kinds=<csv>` (`kinds` omitted when the worker claims all kinds).
  - Snapshot field: `workers: { kinds?: string[]; connectedAt: number }[]` for the resolved root.
  - Broadcast frame: `{ "type": "worker-status", "root": "<root>", "workers": [...] }` riding `appendPipelineEvent` with synthetic requestId `"worker-status"` (full current list — idempotent).
- Panel semantics: `workers: null` = unknown (show nothing), `[]` = known-none. Coverage is **per job kind**; `ENQUEUEABLE_KINDS = ["generate-artifact", "generate-design"]`.
- Banner copy (verbatim, decision 2 — buttons stay ENABLED):
  - Line 1: `No worker is serving this project — jobs will queue until one connects.`
  - Line 2: `Start a worker from this project's root (see the quick-start's worker section).`
  - No copyable command in step 1 (the CLI verb ships later).
- Dismiss rule: ✕ hides the banner until panel reload OR coverage transitions covered→uncovered again.
- TDD every task: failing test → run → minimal code → pass → commit. Commit to `main` (project convention: no per-phase branches).

---

### Task 1: Bridge — `WorkerPresenceRegistry` (pure module)

**Files:**
- Create: `packages/uxfactory-bridge/src/worker-presence.ts`
- Test: `packages/uxfactory-bridge/test/worker-presence.test.ts`

**Interfaces:**
- Consumes: nothing (pure; sockets are opaque `object` keys).
- Produces (used by Tasks 2–3):
  - `interface WorkerPresenceEntry { kinds?: string[]; connectedAt: number }`
  - `class WorkerPresenceRegistry` with methods
    `add(socket: object, root: string, connectedAt: number, kinds?: string[]): void`,
    `addPending(socket: object, root: string, connectedAt: number, kinds?: string[]): void`,
    `remove(socket: object): string | null` (returns the root if the socket was ACTIVE — caller broadcasts; null for pending/untracked),
    `promoteFor(root: string): boolean` (pending→active for that root; true if anything promoted),
    `listFor(root: string): WorkerPresenceEntry[]` (active only, ascending `connectedAt`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-bridge/test/worker-presence.test.ts
import { describe, it, expect } from "vitest";
import { WorkerPresenceRegistry } from "../src/worker-presence.js";

describe("WorkerPresenceRegistry", () => {
  it("add → listFor returns the entry; remove returns the root and empties the list", () => {
    const reg = new WorkerPresenceRegistry();
    const sock = {};
    reg.add(sock, "/repo/a", 1000, ["generate-artifact"]);
    expect(reg.listFor("/repo/a")).toEqual([{ kinds: ["generate-artifact"], connectedAt: 1000 }]);
    expect(reg.listFor("/repo/b")).toEqual([]);
    expect(reg.remove(sock)).toBe("/repo/a");
    expect(reg.listFor("/repo/a")).toEqual([]);
  });

  it("kinds is omitted (not null) for an all-kinds worker", () => {
    const reg = new WorkerPresenceRegistry();
    reg.add({}, "/repo/a", 5);
    expect(reg.listFor("/repo/a")).toEqual([{ connectedAt: 5 }]);
    expect("kinds" in reg.listFor("/repo/a")[0]!).toBe(false);
  });

  it("listFor sorts by connectedAt ascending and supports multiple workers per root", () => {
    const reg = new WorkerPresenceRegistry();
    reg.add({}, "/repo/a", 20);
    reg.add({}, "/repo/a", 10);
    expect(reg.listFor("/repo/a").map((w) => w.connectedAt)).toEqual([10, 20]);
  });

  it("pending workers are invisible until promoted; promoteFor reports change", () => {
    const reg = new WorkerPresenceRegistry();
    const sock = {};
    reg.addPending(sock, "/repo/a", 7, ["generate-design"]);
    expect(reg.listFor("/repo/a")).toEqual([]);
    expect(reg.promoteFor("/repo/b")).toBe(false);
    expect(reg.promoteFor("/repo/a")).toBe(true);
    expect(reg.listFor("/repo/a")).toEqual([{ kinds: ["generate-design"], connectedAt: 7 }]);
    expect(reg.promoteFor("/repo/a")).toBe(false); // idempotent
  });

  it("remove on a PENDING socket returns null (no broadcast owed)", () => {
    const reg = new WorkerPresenceRegistry();
    const sock = {};
    reg.addPending(sock, "/repo/a", 7);
    expect(reg.remove(sock)).toBeNull();
    expect(reg.promoteFor("/repo/a")).toBe(false); // gone from pending too
  });

  it("remove on an unknown socket returns null", () => {
    expect(new WorkerPresenceRegistry().remove({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/worker-presence.test.ts`
Expected: FAIL — `Cannot find module '../src/worker-presence.js'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/uxfactory-bridge/src/worker-presence.ts
/**
 * WorkerPresenceRegistry — which workers are live, per project root.
 *
 * Presence is STRUCTURAL: a worker is "live" exactly while its tagged SSE
 * socket to /pipeline/events is open (spec 2026-07-09-worker-liveness).
 * Sockets are opaque map keys; this module never touches HTTP. A socket whose
 * announced root was not served at subscribe time is held PENDING and promoted
 * when the root becomes served (POST /project/connect → promoteFor).
 */

/** One live worker as exposed on the snapshot / worker-status frames. */
export interface WorkerPresenceEntry {
  /** Kinds this worker claims; absent = all kinds. */
  kinds?: string[];
  connectedAt: number;
}

interface Tracked {
  root: string;
  kinds?: string[];
  connectedAt: number;
  /** false while the announced root is not yet served. */
  active: boolean;
}

export class WorkerPresenceRegistry {
  private readonly bySocket = new Map<object, Tracked>();

  /** Register an ACTIVE worker (its root resolved as served). */
  add(socket: object, root: string, connectedAt: number, kinds?: string[]): void {
    this.bySocket.set(socket, {
      root,
      connectedAt,
      active: true,
      ...(kinds !== undefined ? { kinds } : {}),
    });
  }

  /** Register a worker whose root is not served yet (counted after promoteFor). */
  addPending(socket: object, root: string, connectedAt: number, kinds?: string[]): void {
    this.bySocket.set(socket, {
      root,
      connectedAt,
      active: false,
      ...(kinds !== undefined ? { kinds } : {}),
    });
  }

  /**
   * Forget a socket. Returns the root it was ACTIVELY serving (the caller owes
   * a worker-status broadcast), or null for pending/unknown sockets.
   */
  remove(socket: object): string | null {
    const tracked = this.bySocket.get(socket);
    this.bySocket.delete(socket);
    return tracked !== undefined && tracked.active ? tracked.root : null;
  }

  /** Activate pending workers for a root that just became served. */
  promoteFor(root: string): boolean {
    let promoted = false;
    for (const tracked of this.bySocket.values()) {
      if (!tracked.active && tracked.root === root) {
        tracked.active = true;
        promoted = true;
      }
    }
    return promoted;
  }

  /** Live workers for a root, ascending connectedAt. */
  listFor(root: string): WorkerPresenceEntry[] {
    const out: WorkerPresenceEntry[] = [];
    for (const t of this.bySocket.values()) {
      if (t.active && t.root === root) {
        out.push({ connectedAt: t.connectedAt, ...(t.kinds !== undefined ? { kinds: t.kinds } : {}) });
      }
    }
    return out.sort((a, b) => a.connectedAt - b.connectedAt);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-bridge/test/worker-presence.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-bridge/src/worker-presence.ts packages/uxfactory-bridge/test/worker-presence.test.ts
git commit -m "feat(bridge): WorkerPresenceRegistry — structural worker liveness per root"
```

---

### Task 2: Bridge — tag `/pipeline/events`, presence lifecycle, `worker-status` frames

**Files:**
- Modify: `packages/uxfactory-bridge/src/server.ts` (pipeline-relay state block ~lines 115–136; `/pipeline/events` handler ~lines 503–536)
- Test: `packages/uxfactory-bridge/test/worker-status-relay.test.ts` (new file)

**Interfaces:**
- Consumes: `WorkerPresenceRegistry`, `WorkerPresenceEntry` from Task 1; existing `registry.resolveRequestRoot`, `store.appendPipelineEvent`, `broadcastPipelineFrame`.
- Produces (used by Task 3): a `presence` instance and `broadcastWorkerStatus(root: string): void`, both in scope before the `projectPlugin` registration.

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-bridge/test/worker-status-relay.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

/** Read SSE frames from a fetch stream into an array of parsed `data:` payloads. */
function collectFrames(res: Response, sink: unknown[]): void {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
        if (dataLine !== undefined) sink.push(JSON.parse(dataLine.slice(6)));
      }
    }
  })();
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("worker presence over /pipeline/events", () => {
  let app: FastifyInstance;
  let base: string;
  let launchRoot: string;

  beforeEach(async () => {
    launchRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-worker-status-"));
    await mkdir(path.join(launchRoot, ".git"), { recursive: true });
    app = await createBridge({
      dataDir: path.join(launchRoot, ".uxfactory"),
      reposRegistryPath: path.join(launchRoot, "repos-registry.json"),
    });
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await app.close();
    await rm(launchRoot, { recursive: true, force: true });
  });

  it("tagged worker connect + disconnect broadcast worker-status frames with the full list", async () => {
    // A plain (panel-like) subscriber observes the frames.
    const observerCtl = new AbortController();
    const observed: Array<{ requestId: string; event: { type?: string; root?: string; workers?: unknown[] } }> = [];
    const observer = await fetch(`${base}/pipeline/events`, { signal: observerCtl.signal });
    collectFrames(observer, observed);

    // Worker-tagged subscription for the launch root.
    const workerCtl = new AbortController();
    const workerUrl =
      `${base}/pipeline/events?client=worker&root=${encodeURIComponent(launchRoot)}&kinds=generate-artifact`;
    await fetch(workerUrl, { signal: workerCtl.signal });

    await waitFor(() =>
      observed.some((f) => f.requestId === "worker-status" && f.event.workers?.length === 1),
    );
    const connectFrame = observed.find((f) => f.requestId === "worker-status")!;
    expect(connectFrame.event.type).toBe("worker-status");
    expect(connectFrame.event.root).toBe(launchRoot);
    expect(connectFrame.event.workers).toEqual([
      { kinds: ["generate-artifact"], connectedAt: expect.any(Number) },
    ]);

    // Drop the worker socket → an empty-list frame follows.
    workerCtl.abort();
    await waitFor(() =>
      observed.some((f) => f.requestId === "worker-status" && f.event.workers?.length === 0),
    );
    observerCtl.abort();
  });

  it("an untagged subscription broadcasts no worker-status frame", async () => {
    const observed: Array<{ requestId: string }> = [];
    const ctl = new AbortController();
    const res = await fetch(`${base}/pipeline/events`, { signal: ctl.signal });
    collectFrames(res, observed);

    const plainCtl = new AbortController();
    await fetch(`${base}/pipeline/events`, { signal: plainCtl.signal });
    await new Promise((r) => setTimeout(r, 200));
    expect(observed.filter((f) => f.requestId === "worker-status")).toHaveLength(0);
    plainCtl.abort();
    ctl.abort();
  });

  it("a worker announcing an UNSERVED root is not counted (pending, no frame)", async () => {
    const observed: Array<{ requestId: string }> = [];
    const ctl = new AbortController();
    const res = await fetch(`${base}/pipeline/events`, { signal: ctl.signal });
    collectFrames(res, observed);

    const otherRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-other-root-"));
    await mkdir(path.join(otherRoot, ".git"), { recursive: true });
    const workerCtl = new AbortController();
    await fetch(
      `${base}/pipeline/events?client=worker&root=${encodeURIComponent(otherRoot)}`,
      { signal: workerCtl.signal },
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(observed.filter((f) => f.requestId === "worker-status")).toHaveLength(0);
    workerCtl.abort();
    ctl.abort();
    await rm(otherRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/worker-status-relay.test.ts`
Expected: FAIL — first test times out in `waitFor` (no worker-status frames exist yet). The other two may pass vacuously; that's fine.

- [ ] **Step 3: Implement in `server.ts`**

3a. Import the registry at the top (near the other src imports):

```ts
import { WorkerPresenceRegistry } from "./worker-presence.js";
```

3b. **Move** the pipeline-relay state block (currently ~lines 115–136: the `pipelineRequestIds` set, `sseClients` map, `writePipelineFrame`, `broadcastPipelineFrame`) to ABOVE the `projectPlugin` registration (`await app.register(projectPlugin, …)`, currently ~line 105). This is a verbatim move — Task 3 needs these in scope when registering the plugin. Immediately after the moved block, add:

```ts
  // --- worker presence (spec 2026-07-09-worker-liveness) ---
  const presence = new WorkerPresenceRegistry();

  /** Broadcast the full current worker list for a root (ring + fan-out). */
  const broadcastWorkerStatus = (root: string): void => {
    const frame = store.appendPipelineEvent("worker-status", {
      type: "worker-status",
      root,
      workers: presence.listFor(root),
    });
    broadcastPipelineFrame(frame);
  };
```

3c. Replace the `/pipeline/events` route registration with a typed-querystring version that tags workers and cleans up presence on close:

```ts
  app.get<{ Querystring: { client?: string; root?: string; kinds?: string } }>(
    "/pipeline/events",
    (req, reply) => {
      const raw = reply.raw;
      reply.hijack();
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      raw.flushHeaders();

      const header = req.headers["last-event-id"];
      const lastSeqRaw = Number(Array.isArray(header) ? header[0] : (header ?? 0));
      const afterSeq = Number.isFinite(lastSeqRaw) ? lastSeqRaw : 0;
      for (const event of store.recentPipelineEvents(afterSeq)) writePipelineFrame(raw, event);

      const keepAlive = setInterval(() => {
        try {
          raw.write(": keep-alive\n\n");
        } catch {
          /* socket gone; the close handler will clean up */
        }
      }, SSE_KEEPALIVE_MS);
      keepAlive.unref?.();

      sseClients.set(raw, keepAlive);

      // Worker presence: a worker tags its subscription with ?client=worker&root=…
      // A served root registers as ACTIVE (+broadcast); an unserved one is held
      // PENDING and promoted when POST /project/connect serves it (Task 3).
      if (req.query.client === "worker" && typeof req.query.root === "string" && req.query.root !== "") {
        const announcedRoot = req.query.root;
        const kinds =
          typeof req.query.kinds === "string" && req.query.kinds.trim() !== ""
            ? req.query.kinds.split(",").map((k) => k.trim()).filter((k) => k !== "")
            : undefined;
        void registry.resolveRequestRoot(announcedRoot).then((resolution) => {
          if (!sseClients.has(raw)) return; // closed before resolution finished
          if (resolution.ok) {
            presence.add(raw, resolution.root, Date.now(), kinds);
            broadcastWorkerStatus(resolution.root);
          } else {
            presence.addPending(raw, path.resolve(announcedRoot), Date.now(), kinds);
          }
        });
      }

      raw.on("close", () => {
        clearInterval(keepAlive);
        sseClients.delete(raw);
        const servedRootOfWorker = presence.remove(raw);
        if (servedRootOfWorker !== null) broadcastWorkerStatus(servedRootOfWorker);
      });
    },
  );
```

(The handler body is the existing one plus the tagged-worker block and the two presence lines in the close handler — keep everything else byte-identical, including the `onClose` shutdown hook below it.)

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/uxfactory-bridge/test/worker-status-relay.test.ts packages/uxfactory-bridge/test/pipeline-relay.test.ts`
Expected: all PASS (new file 3 tests; existing relay suite unaffected)

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-bridge/src/server.ts packages/uxfactory-bridge/test/worker-status-relay.test.ts
git commit -m "feat(bridge): tagged worker SSE subscriptions -> presence + worker-status frames"
```

---

### Task 3: Bridge — snapshot `workers` field + connect-rescan + changeset

**Files:**
- Modify: `packages/uxfactory-bridge/src/project.ts` (`ProjectSnapshot` interface ~line 66; `ProjectPluginOptions`; `/project/connect` handler ~line 868; `/project/snapshot` route ~line 910)
- Modify: `packages/uxfactory-bridge/src/server.ts` (the `app.register(projectPlugin, …)` call)
- Create: `.changeset/worker-liveness-presence.md`
- Test: extend `packages/uxfactory-bridge/test/worker-status-relay.test.ts`

**Interfaces:**
- Consumes: `presence` + `broadcastWorkerStatus` from Task 2; `WorkerPresenceEntry` from Task 1.
- Produces (used by Tasks 5–6): snapshot wire field `workers: WorkerPresenceEntry[]` (always present when served by this bridge version); `ProjectPluginOptions.workersFor?: (root: string) => WorkerPresenceEntry[]` and `onRootServed?: (root: string) => void`.

- [ ] **Step 1: Write the failing tests** (append to `worker-status-relay.test.ts`)

```ts
describe("snapshot workers field + connect-rescan", () => {
  // reuse the beforeEach/afterEach harness from the first describe (copy it verbatim)

  it("GET /project/snapshot includes workers for the resolved root", async () => {
    const before = await (await fetch(`${base}/project/snapshot`)).json() as { workers?: unknown[] };
    expect(before.workers).toEqual([]);

    const workerCtl = new AbortController();
    await fetch(
      `${base}/pipeline/events?client=worker&root=${encodeURIComponent(launchRoot)}`,
      { signal: workerCtl.signal },
    );
    await waitFor(async () => {
      const s = await (await fetch(`${base}/project/snapshot`)).json() as { workers?: unknown[] };
      return (s.workers?.length ?? 0) === 1;
    });
    workerCtl.abort();
  });

  it("POST /project/connect promotes a pre-connected pending worker and broadcasts", async () => {
    const otherRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-rescan-root-"));
    await mkdir(path.join(otherRoot, ".git"), { recursive: true });

    // 1. Worker subscribes for a root nobody serves yet → pending.
    const workerCtl = new AbortController();
    await fetch(
      `${base}/pipeline/events?client=worker&root=${encodeURIComponent(otherRoot)}&kinds=generate-artifact`,
      { signal: workerCtl.signal },
    );
    await new Promise((r) => setTimeout(r, 200)); // let the (non-)registration settle

    // 2. Panel connects the root → pending worker promoted; snapshot shows it.
    const connect = await fetch(`${base}/project/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoPath: otherRoot }),
    });
    const body = await connect.json() as { ok: boolean; snapshot: { workers?: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.snapshot.workers).toEqual([
      { kinds: ["generate-artifact"], connectedAt: expect.any(Number) },
    ]);

    workerCtl.abort();
    await rm(otherRoot, { recursive: true, force: true });
  });
});
```

Note: `waitFor` above is called with an async predicate in the first test — generalize the helper to `async (cond: () => boolean | Promise<boolean>)` and `if (await cond()) …` when appending these tests.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/uxfactory-bridge/test/worker-status-relay.test.ts`
Expected: FAIL — `before.workers` is `undefined` (snapshot has no field yet)

- [ ] **Step 3: Implement**

3a. `project.ts` — extend the snapshot interface (~line 66) and the plugin options:

```ts
import type { WorkerPresenceEntry } from "./worker-presence.js";

export interface ProjectSnapshot {
  // …existing fields unchanged…
  /** Live workers serving this root (spec 2026-07-09-worker-liveness). */
  workers?: WorkerPresenceEntry[];
}
```

In `ProjectPluginOptions` (the interface holding `servedRoot`, `dataDir`, `version`, `shared`, `logRing`, `registry`) add:

```ts
  /** Live-worker list for a root; provided by server.ts (absent in bare tests). */
  workersFor?: (root: string) => WorkerPresenceEntry[];
  /** Called after a root becomes served (connect) — promotes pending workers. */
  onRootServed?: (root: string) => void;
```

3b. `/project/connect` handler — after `await registry.register(resolved);` (~line 904) insert:

```ts
    opts.onRootServed?.(resolved);
```

and change the return to enrich the snapshot:

```ts
    const snapshot = await buildSnapshot(resolved, registry.dataDirFor(resolved));
    return { ok: true, snapshot: { ...snapshot, workers: opts.workersFor?.(resolved) ?? [] } };
```

3c. `/project/snapshot` route — replace the return:

```ts
    const snapshot = await buildSnapshot(ctx.root, ctx.dataDir);
    return { ...snapshot, workers: opts.workersFor?.(ctx.root) ?? [] };
```

(`buildSnapshot` itself stays pure/unchanged.)

3d. `server.ts` — extend the registration (now BELOW the presence block from Task 2):

```ts
  await app.register(projectPlugin, {
    servedRoot,
    dataDir,
    version: bridgeVersion,
    shared,
    logRing,
    registry,
    workersFor: (root) => presence.listFor(root),
    onRootServed: (root) => {
      if (presence.promoteFor(root)) broadcastWorkerStatus(root);
    },
  });
```

3e. Create `.changeset/worker-liveness-presence.md`:

```md
---
"@uxfactory/bridge": minor
---

Worker liveness: workers tag their /pipeline/events subscription with
?client=worker&root=&kinds=; the bridge tracks presence per root, exposes it
as a `workers` array on GET /project/snapshot and POST /project/connect, and
broadcasts `worker-status` frames on every transition. POST /project/connect
promotes workers that subscribed before their root was served.
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/uxfactory-bridge/test/worker-status-relay.test.ts packages/uxfactory-bridge/test/pipeline-relay.test.ts packages/uxfactory-bridge/test/roots.test.ts`
Expected: all PASS

- [ ] **Step 5: Typecheck the package, then commit**

Run: `pnpm --filter @uxfactory/bridge typecheck` — expected: clean.

```bash
git add packages/uxfactory-bridge/src/project.ts packages/uxfactory-bridge/src/server.ts packages/uxfactory-bridge/test/worker-status-relay.test.ts .changeset/worker-liveness-presence.md
git commit -m "feat(bridge): snapshot workers field + connect-time promotion of pending workers"
```

---

### Task 4: Worker — tag the SSE subscription URL

**Files:**
- Modify: `clients/uxfactory-worker/src/bridge-client.ts` (`subscribeEvents`, ~line 103)
- Test: `clients/uxfactory-worker/test/worker.test.ts` (append to the `WorkerBridgeClient (http)` describe, ~line 2100)

**Interfaces:**
- Consumes: nothing new.
- Produces: the tagged URL consumed by Task 2's bridge handler — `GET /pipeline/events?client=worker&root=<projectRoot>&kinds=<csv>`.

- [ ] **Step 1: Write the failing test** (mirrors the existing `pullRequest appends ?root=` pattern at ~line 2143)

```ts
  it('subscribeEvents tags the URL with client=worker, root, and kinds', async () => {
    const seenUrls: string[] = [];
    const server = http.createServer((req, res) => {
      seenUrls.push(req.url ?? '');
      if (req.url?.startsWith('/pipeline/events')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return; // keep the stream open
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const client = new WorkerBridgeClient(
        `http://127.0.0.1:${port}`,
        '/repo/alpha',
        ['generate-artifact', 'validate'],
      );
      const unsub = client.subscribeEvents(() => {});
      await waitFor(() => seenUrls.some((u) => u.startsWith('/pipeline/events')));
      unsub();
      const url = new URL(seenUrls.find((u) => u.startsWith('/pipeline/events'))!, 'http://x');
      expect(url.searchParams.get('client')).toBe('worker');
      expect(url.searchParams.get('root')).toBe('/repo/alpha');
      expect(url.searchParams.get('kinds')).toBe('generate-artifact,validate');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('subscribeEvents omits root and kinds when unset (legacy compat)', async () => {
    const seenUrls: string[] = [];
    const server = http.createServer((req, res) => {
      seenUrls.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const client = new WorkerBridgeClient(`http://127.0.0.1:${port}`);
      const unsub = client.subscribeEvents(() => {});
      await waitFor(() => seenUrls.length >= 1);
      unsub();
      const url = new URL(seenUrls[0]!, 'http://x');
      expect(url.searchParams.get('client')).toBe('worker');
      expect(url.searchParams.has('root')).toBe(false);
      expect(url.searchParams.has('kinds')).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
```

(`http`, `AddressInfo`, and `waitFor` are already imported/defined in this test file — reuse them.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter uxfactory-worker test`
Expected: the two new tests FAIL (`client` param is null); everything else PASS

- [ ] **Step 3: Implement** — in `subscribeEvents`, replace the fetch line:

```ts
      // Tag the subscription so the bridge can track worker presence
      // (spec 2026-07-09-worker-liveness): client=worker always; root/kinds
      // only when configured, so a bare client stays legacy-shaped.
      const params = new URLSearchParams({ client: 'worker' });
      if (this.projectRoot !== null) params.set('root', this.projectRoot);
      if (this.kinds !== null) params.set('kinds', this.kinds.join(','));
      const res = await fetch(`${this.base}/pipeline/events?${params.toString()}`, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      });
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter uxfactory-worker test` — expected: all PASS.
Run: `pnpm --filter uxfactory-worker typecheck` — expected: clean.

- [ ] **Step 5: Commit**

```bash
git add clients/uxfactory-worker/src/bridge-client.ts clients/uxfactory-worker/test/worker.test.ts
git commit -m "feat(worker): tag SSE subscription with client/root/kinds for bridge presence"
```

---

### Task 5: Panel — snapshot type, Zustand slice, coverage helper

**Files:**
- Modify: `packages/uxfactory-plugin/ui/lib/bridge.ts` (`ProjectSnapshot`, ~line 33)
- Create: `packages/uxfactory-plugin/ui/lib/worker-coverage.ts`
- Modify: `packages/uxfactory-plugin/ui/stores/app.ts` (state ~line 48, actions ~line 63, store body)
- Test: `packages/uxfactory-plugin/test/worker-coverage.test.ts` (new)

**Interfaces:**
- Consumes: snapshot wire field from Task 3.
- Produces (used by Tasks 6–7):
  - `bridge.ts`: `export interface WorkerPresenceEntry { kinds?: string[]; connectedAt: number }`; `ProjectSnapshot.workers?: WorkerPresenceEntry[]`.
  - `worker-coverage.ts`: `type WorkerCoverage = "covered" | "uncovered" | "unknown"`; `const ENQUEUEABLE_KINDS: readonly string[]`; `coverageFor(workers: WorkerPresenceEntry[] | null, kind: string): WorkerCoverage`; `anyUncovered(workers: WorkerPresenceEntry[] | null): boolean`.
  - `stores/app.ts`: state `workers: WorkerPresenceEntry[] | null`, `workerBannerDismissed: boolean`; actions `workersChanged(workers: WorkerPresenceEntry[] | null): void`, `dismissWorkerBanner(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-plugin/test/worker-coverage.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { coverageFor, anyUncovered, ENQUEUEABLE_KINDS } from "../ui/lib/worker-coverage.js";
import { useAppStore } from "../ui/stores/app.js";

describe("coverageFor", () => {
  it("null workers → unknown (older bridge / no snapshot yet)", () => {
    expect(coverageFor(null, "generate-artifact")).toBe("unknown");
  });
  it("empty list → uncovered", () => {
    expect(coverageFor([], "generate-artifact")).toBe("uncovered");
  });
  it("an all-kinds worker (kinds absent) covers every kind", () => {
    expect(coverageFor([{ connectedAt: 1 }], "generate-design")).toBe("covered");
  });
  it("a kind-filtered worker covers only its kinds", () => {
    const workers = [{ kinds: ["generate-artifact"], connectedAt: 1 }];
    expect(coverageFor(workers, "generate-artifact")).toBe("covered");
    expect(coverageFor(workers, "generate-design")).toBe("uncovered");
  });
  it("ENQUEUEABLE_KINDS names the two panel job kinds", () => {
    expect([...ENQUEUEABLE_KINDS]).toEqual(["generate-artifact", "generate-design"]);
  });
  it("anyUncovered: null → false; partial pool → true; all-kinds worker → false", () => {
    expect(anyUncovered(null)).toBe(false);
    expect(anyUncovered([{ kinds: ["generate-artifact"], connectedAt: 1 }])).toBe(true);
    expect(anyUncovered([{ connectedAt: 1 }])).toBe(false);
  });
});

describe("app store workers slice", () => {
  beforeEach(() => {
    useAppStore.setState({ workers: null, workerBannerDismissed: false });
  });

  it("workersChanged stores the list; dismissWorkerBanner sticks while state is unchanged", () => {
    useAppStore.getState().workersChanged([]);
    expect(useAppStore.getState().workers).toEqual([]);
    useAppStore.getState().dismissWorkerBanner();
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);
    useAppStore.getState().workersChanged([]); // still uncovered — no fresh outage
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);
  });

  it("a fresh covered→uncovered transition re-arms a dismissed banner", () => {
    useAppStore.getState().workersChanged([]);
    useAppStore.getState().dismissWorkerBanner();
    useAppStore.getState().workersChanged([{ connectedAt: 1 }]); // worker arrives → covered
    useAppStore.getState().workersChanged([]);                    // worker drops → fresh outage
    expect(useAppStore.getState().workerBannerDismissed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/uxfactory-plugin/test/worker-coverage.test.ts`
Expected: FAIL — `Cannot find module '../ui/lib/worker-coverage.js'`

- [ ] **Step 3: Implement**

3a. `bridge.ts` — add above `ProjectSnapshot`:

```ts
/** One live worker serving the connected root (bridge worker-presence wire). */
export interface WorkerPresenceEntry {
  /** Kinds this worker claims; absent = all kinds. */
  kinds?: string[];
  connectedAt: number;
}
```

and inside `ProjectSnapshot`:

```ts
  /** Live workers for this root; absent on older bridges (treat as unknown). */
  workers?: WorkerPresenceEntry[];
```

3b. Create `ui/lib/worker-coverage.ts`:

```ts
/**
 * worker-coverage — pure truth table for "is a live worker claiming this job
 * kind?" (spec 2026-07-09-worker-liveness). `null` means UNKNOWN (no snapshot
 * yet, or a bridge older than the workers field) and must never warn.
 */
import type { WorkerPresenceEntry } from "./bridge.js";

export type WorkerCoverage = "covered" | "uncovered" | "unknown";

/** The job kinds this panel can enqueue. Extend when the panel gains new kinds. */
export const ENQUEUEABLE_KINDS = ["generate-artifact", "generate-design"] as const;

export function coverageFor(
  workers: WorkerPresenceEntry[] | null,
  kind: string,
): WorkerCoverage {
  if (workers === null) return "unknown";
  const covered = workers.some((w) => w.kinds === undefined || w.kinds.includes(kind));
  return covered ? "covered" : "uncovered";
}

/** True when ANY enqueueable kind is uncovered (drives the ContextBar dot + banner re-arm). */
export function anyUncovered(workers: WorkerPresenceEntry[] | null): boolean {
  return ENQUEUEABLE_KINDS.some((k) => coverageFor(workers, k) === "uncovered");
}
```

3c. `stores/app.ts` — extend `AppState`:

```ts
  /** Live workers for the connected root; null = unknown (never warn on null). */
  workers: WorkerPresenceEntry[] | null;
  /** Session dismiss for the WorkerBanner; re-armed by a fresh covered→uncovered transition. */
  workerBannerDismissed: boolean;
```

Extend `AppActions`:

```ts
  workersChanged(workers: WorkerPresenceEntry[] | null): void;
  dismissWorkerBanner(): void;
```

Add the import `import { anyUncovered } from "../lib/worker-coverage.js";` and `import type { WorkerPresenceEntry } from "../lib/bridge.js";` (the file already imports `ProjectSnapshot` from there). Initial state: `workers: null, workerBannerDismissed: false`. Implement the actions in the store body:

```ts
  workersChanged(workers) {
    set((s) => {
      const freshOutage = anyUncovered(workers) && !anyUncovered(s.workers);
      return {
        workers,
        workerBannerDismissed: freshOutage ? false : s.workerBannerDismissed,
      };
    });
  },
  dismissWorkerBanner() {
    set({ workerBannerDismissed: true });
  },
```

In `connectSucceeded(snapshot, repoPath, persist?)`, add to the object passed to its `set(…)` call:

```ts
      workers: snapshot.workers ?? null,
      workerBannerDismissed: false,
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/uxfactory-plugin/test/worker-coverage.test.ts packages/uxfactory-plugin/test/stores.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-plugin/ui/lib/bridge.ts packages/uxfactory-plugin/ui/lib/worker-coverage.ts packages/uxfactory-plugin/ui/stores/app.ts packages/uxfactory-plugin/test/worker-coverage.test.ts
git commit -m "feat(panel): workers slice + per-kind coverage helper (null=unknown, []=none)"
```

---

### Task 6: Panel — `useWorkerStatus` subscription hook

**Files:**
- Create: `packages/uxfactory-plugin/ui/lib/use-worker-status.ts`
- Test: `packages/uxfactory-plugin/test/use-worker-status.test.tsx` (new)

**Interfaces:**
- Consumes: `snapshotQuery`, `activeRoot` from `../queries.js`; `workersChanged` from Task 5; `bridge.events` (`BridgeEvent { requestId, event, seq }`).
- Produces (mounted in Task 8): `useWorkerStatus(bridge: Bridge): void`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/uxfactory-plugin/test/use-worker-status.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Bridge, BridgeEvent } from "../ui/lib/bridge.js";
import { useWorkerStatus } from "../ui/lib/use-worker-status.js";
import { useAppStore } from "../ui/stores/app.js";

const ROOT = "/repo/demo";

function makeBridge(overrides: Partial<Bridge> = {}): Bridge {
  return {
    health: async () => ({ ok: true }),
    connectProject: async () => ({ ok: false, reason: "not-found" as const }),
    snapshot: async () => ({
      name: "demo", root: ROOT, hasClassification: false, hasProfile: false,
      classification: null, profile: null, artifacts: [], requirements: [],
      workers: [],
    }),
    putClassification: async () => ({ ok: true }),
    putProfile: async () => ({ ok: true }),
    getLinks: async () => ({ links: [] }),
    putLinks: async () => ({ ok: true }),
    openPath: async () => ({ ok: true }),
    stats: async () => ({ version: "0", uptimeMs: 0, runsRelayed: 0, tokenCount: null }),
    logs: async () => ({ lines: [] }),
    skills: async () => ({ skills: [] }),
    enqueue: async () => ({ id: "pr_1" }),
    result: async () => null,
    events: () => () => {},
    latestRender: async () => null,
    verify: async () => null,
    getProjectRoot: () => ROOT,
    ...overrides,
  } as Bridge;
}

function Harness({ bridge }: { bridge: Bridge }): React.JSX.Element {
  useWorkerStatus(bridge);
  return <></>;
}

describe("useWorkerStatus", () => {
  beforeEach(() => {
    useAppStore.setState({ workers: null, workerBannerDismissed: false });
  });

  it("seeds the store from the snapshot's workers field", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness bridge={makeBridge()} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(useAppStore.getState().workers).toEqual([]));
  });

  it("applies worker-status frames for the active root and ignores other roots", async () => {
    let emit: ((ev: BridgeEvent) => void) | null = null;
    const bridge = makeBridge({
      events: (onEvent) => {
        emit = onEvent;
        return () => {};
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness bridge={bridge} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(emit).not.toBeNull());

    emit!({
      requestId: "worker-status", seq: 1,
      event: { type: "worker-status", root: "/repo/other", workers: [{ connectedAt: 5 }] },
    });
    expect(useAppStore.getState().workers).not.toEqual([{ connectedAt: 5 }]);

    emit!({
      requestId: "worker-status", seq: 2,
      event: { type: "worker-status", root: ROOT, workers: [{ connectedAt: 9 }] },
    });
    await waitFor(() =>
      expect(useAppStore.getState().workers).toEqual([{ connectedAt: 9 }]),
    );
  });
});
```

Check the top of an existing test (`packages/uxfactory-plugin/test/stores.test.ts` / `screen-artifacts.test.tsx`) for the jsdom/environment pragma these tests use (e.g. a `// @vitest-environment jsdom` comment or global config) and match it; also mirror the `Bridge` fixture fields from `screen-artifacts.test.tsx:270` if the interface requires more members than listed here.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/uxfactory-plugin/test/use-worker-status.test.tsx`
Expected: FAIL — `Cannot find module '../ui/lib/use-worker-status.js'`

- [ ] **Step 3: Implement**

```ts
// packages/uxfactory-plugin/ui/lib/use-worker-status.ts
/**
 * useWorkerStatus — keep the app-store `workers` slice in sync with the bridge.
 * Two writers, one shape (spec 2026-07-09-worker-liveness):
 *   1. snapshot arrivals seed it (pull-truth; `workers` absent → null = unknown);
 *   2. `worker-status` SSE frames for the ACTIVE root update it (push-nudge).
 * Mount ONCE in the connected shell (router).
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bridge, BridgeEvent, WorkerPresenceEntry } from "./bridge.js";
import { snapshotQuery, activeRoot } from "../queries.js";
import { useAppStore } from "../stores/app.js";

interface WorkerStatusEvent {
  type: "worker-status";
  root: string;
  workers: WorkerPresenceEntry[];
}

function isWorkerStatusEvent(v: unknown): v is WorkerStatusEvent {
  return (
    v !== null &&
    typeof v === "object" &&
    (v as { type?: unknown }).type === "worker-status" &&
    typeof (v as { root?: unknown }).root === "string" &&
    Array.isArray((v as { workers?: unknown }).workers)
  );
}

export function useWorkerStatus(bridge: Bridge): void {
  const workersChanged = useAppStore((s) => s.workersChanged);
  const { data } = useQuery(snapshotQuery(bridge));

  useEffect(() => {
    if (data !== undefined) workersChanged(data.workers ?? null);
  }, [data, workersChanged]);

  useEffect(() => {
    const teardown = bridge.events((ev: BridgeEvent) => {
      if (ev.requestId !== "worker-status" || !isWorkerStatusEvent(ev.event)) return;
      if (ev.event.root === activeRoot(bridge)) workersChanged(ev.event.workers);
    });
    return teardown;
  }, [bridge, workersChanged]);
}
```

(If `activeRoot` is not exported from `../queries.js`, export it there — it already exists for the query keys.)

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/uxfactory-plugin/test/use-worker-status.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-plugin/ui/lib/use-worker-status.ts packages/uxfactory-plugin/test/use-worker-status.test.tsx
git commit -m "feat(panel): useWorkerStatus hook — snapshot seed + worker-status frame sync"
```

---

### Task 7: Panel — `WorkerBanner` on Artifacts + Prompt

**Files:**
- Create: `packages/uxfactory-plugin/ui/components/WorkerBanner.tsx`
- Modify: `packages/uxfactory-plugin/ui/components/index.ts` (re-export, matching the file's existing pattern)
- Modify: `packages/uxfactory-plugin/ui/screens/Artifacts.tsx` (render above the artifact table/groups)
- Modify: `packages/uxfactory-plugin/ui/screens/Prompt.tsx` (render above the composer)
- Test: `packages/uxfactory-plugin/test/worker-banner.test.tsx` (new)

**Interfaces:**
- Consumes: store slice + `coverageFor` from Task 5.
- Produces: `<WorkerBanner kind="generate-artifact" />` / `<WorkerBanner kind="generate-design" />`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/uxfactory-plugin/test/worker-banner.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkerBanner } from "../ui/components/WorkerBanner.js";
import { useAppStore } from "../ui/stores/app.js";

describe("WorkerBanner", () => {
  beforeEach(() => {
    useAppStore.setState({ workers: null, workerBannerDismissed: false });
  });

  it("renders nothing while liveness is unknown (workers: null)", () => {
    render(<WorkerBanner kind="generate-artifact" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns with the spec copy when no worker covers the kind", () => {
    useAppStore.setState({ workers: [] });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(
      screen.getByText("No worker is serving this project — jobs will queue until one connects."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Start a worker from this project's root (see the quick-start's worker section)."),
    ).toBeInTheDocument();
  });

  it("renders nothing when a live worker covers the kind", () => {
    useAppStore.setState({ workers: [{ connectedAt: 1 }] });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns when the live pool does not claim this kind", () => {
    useAppStore.setState({ workers: [{ kinds: ["generate-design"], connectedAt: 1 }] });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("✕ dismisses via the store", () => {
    useAppStore.setState({ workers: [] });
    render(<WorkerBanner kind="generate-artifact" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss worker warning" }));
    expect(useAppStore.getState().workerBannerDismissed).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/uxfactory-plugin/test/worker-banner.test.tsx`
Expected: FAIL — `Cannot find module '../ui/components/WorkerBanner.js'`

- [ ] **Step 3: Implement the component**

```tsx
// packages/uxfactory-plugin/ui/components/WorkerBanner.tsx
/**
 * WorkerBanner — "no worker is serving this project" warning (spec
 * 2026-07-09-worker-liveness, decision 2: enqueue-anyway, so this only warns —
 * it never disables anything). Renders ONLY when coverage for `kind` is
 * "uncovered"; unknown (null) shows nothing.
 */
import React from "react";
import { useAppStore } from "../stores/app.js";
import { coverageFor } from "../lib/worker-coverage.js";

export function WorkerBanner({ kind }: { kind: string }): React.JSX.Element | null {
  const workers = useAppStore((s) => s.workers);
  const dismissed = useAppStore((s) => s.workerBannerDismissed);
  const dismissWorkerBanner = useAppStore((s) => s.dismissWorkerBanner);

  if (dismissed || coverageFor(workers, kind) !== "uncovered") return null;

  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
    >
      <span aria-hidden="true">⚠</span>
      <div className="flex-1">
        <p>No worker is serving this project — jobs will queue until one connects.</p>
        <p className="opacity-75">
          Start a worker from this project's root (see the quick-start's worker section).
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss worker warning"
        onClick={dismissWorkerBanner}
        className="opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
```

Match the amber/warning tokens to the panel's existing Toast/Card styling if they differ (read `Toast.tsx` for the established warning classes; keep the `role="status"` and `aria-label` exactly as tested). Add the re-export to `components/index.ts` following its existing lines.

- [ ] **Step 4: Place it in the two screens**

In `screens/Artifacts.tsx`: import `{ WorkerBanner }` from `../components/index.js` and render `<WorkerBanner kind="generate-artifact" />` as the FIRST child of the screen's top-level content container (immediately above the artifact group list/table).

In `screens/Prompt.tsx`: import the same and render `<WorkerBanner kind="generate-design" />` immediately above the composer form.

- [ ] **Step 5: Run the tests (new + both screens' suites)**

Run: `pnpm vitest run packages/uxfactory-plugin/test/worker-banner.test.tsx packages/uxfactory-plugin/test/screen-artifacts.test.tsx packages/uxfactory-plugin/test/screen-prompt.test.tsx`
Expected: all PASS. If a screen test fails on an unexpected `role="status"` element, scope that assertion — the banner is absent in those tests anyway because the store default is `workers: null`.

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-plugin/ui/components/WorkerBanner.tsx packages/uxfactory-plugin/ui/components/index.ts packages/uxfactory-plugin/ui/screens/Artifacts.tsx packages/uxfactory-plugin/ui/screens/Prompt.tsx packages/uxfactory-plugin/test/worker-banner.test.tsx
git commit -m "feat(panel): WorkerBanner on Artifacts + Prompt (enqueue-anyway warning)"
```

---

### Task 8: Panel — ContextBar dot + mount the hook

**Files:**
- Modify: `packages/uxfactory-plugin/ui/router.tsx` (`ContextBar` at ~line 179; the connected-shell component that has `bridge` in scope)
- Test: `packages/uxfactory-plugin/test/worker-dot.test.tsx` (new)

**Interfaces:**
- Consumes: `anyUncovered` + store slice (Task 5), `useWorkerStatus` (Task 6).
- Produces: a `WorkerDot` element inside ContextBar (`aria-label` below is the test contract).

- [ ] **Step 1: Write the failing test**

```tsx
// packages/uxfactory-plugin/test/worker-dot.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { WorkerDot } from "../ui/router.js";
import { useAppStore } from "../ui/stores/app.js";

describe("WorkerDot", () => {
  beforeEach(() => {
    useAppStore.setState({ workers: null, workerBannerDismissed: false });
  });

  it("grey when unknown", () => {
    render(<WorkerDot />);
    expect(screen.getByLabelText("Worker status: unknown")).toBeInTheDocument();
  });
  it("amber when any enqueueable kind is uncovered", () => {
    useAppStore.setState({ workers: [] });
    render(<WorkerDot />);
    expect(screen.getByLabelText("Worker status: no worker for this project")).toBeInTheDocument();
  });
  it("green when every enqueueable kind is covered", () => {
    useAppStore.setState({ workers: [{ connectedAt: 1 }] });
    render(<WorkerDot />);
    expect(screen.getByLabelText("Worker status: live")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/uxfactory-plugin/test/worker-dot.test.tsx`
Expected: FAIL — `WorkerDot` is not exported from `../ui/router.js`

- [ ] **Step 3: Implement in `router.tsx`**

Add near `ContextBar` (~line 134 section) and export it (export needed for the test):

```tsx
/** ContextBar worker-liveness dot: green covered / amber uncovered / grey unknown. */
export function WorkerDot(): React.JSX.Element {
  const workers = useAppStore((s) => s.workers);
  const state =
    workers === null ? "unknown" : anyUncovered(workers) ? "uncovered" : "covered";
  const { cls, label } = {
    unknown: { cls: "bg-neutral-500", label: "Worker status: unknown" },
    uncovered: { cls: "bg-amber-500", label: "Worker status: no worker for this project" },
    covered: { cls: "bg-emerald-500", label: "Worker status: live" },
  }[state];
  return (
    <span
      aria-label={label}
      title={label}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`}
    />
  );
}
```

Imports to add in `router.tsx`: `anyUncovered` from `./lib/worker-coverage.js` (the file already imports `useAppStore`). Render `<WorkerDot />` inside `ContextBar`'s JSX next to the existing connection/status element (read `ContextBar` at router.tsx:179 first and place it beside the repo name / status chip).

In the connected shell component (the one in `router.tsx` that has the `bridge` instance in scope and renders the tabs — find it by locating where screens receive their `bridge` prop), add:

```tsx
  useWorkerStatus(bridge);
```

with `import { useWorkerStatus } from "./lib/use-worker-status.js";`.

- [ ] **Step 4: Run the panel test suite**

Run: `pnpm vitest run packages/uxfactory-plugin/test/worker-dot.test.tsx packages/uxfactory-plugin/test/routing.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-plugin/ui/router.tsx packages/uxfactory-plugin/test/worker-dot.test.tsx
git commit -m "feat(panel): ContextBar worker dot + mount useWorkerStatus in the shell"
```

---

### Task 9: Full verification + live smoke

**Files:** none new.

- [ ] **Step 1: Full build, typecheck, tests**

```bash
pnpm -r build && pnpm typecheck && pnpm test
```
Expected: all green.

- [ ] **Step 2: Live smoke (the incident scenario, inverted)**

```bash
# terminal A — bridge from the engine repo root
node packages/uxfactory-cli/dist/src/cli.js bridge
# terminal B — snapshot before: workers []
curl -s "http://127.0.0.1:3779/project/snapshot" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).workers))"
# terminal C — worker from the engine repo root
clients/uxfactory-worker/node_modules/.bin/tsx clients/uxfactory-worker/src/main.ts
# terminal B — snapshot after: one worker entry
curl -s "http://127.0.0.1:3779/project/snapshot" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).workers))"
```
Expected: `[]` before, `[ { connectedAt: <number> } ]` after; killing the worker returns it to `[]` within a second. Also verify the pre-connect promotion: start a worker with cwd in a second repo BEFORE any panel connect, then `curl -s -X POST http://127.0.0.1:3779/project/connect -H 'content-type: application/json' -d '{"repoPath":"<that repo>"}'` and confirm the returned snapshot's `workers` includes it.

- [ ] **Step 3: Rebuild the plugin bundle for Figma**

```bash
pnpm --filter @uxfactory/plugin build
```
Expected: `dist/code.js` + `dist/ui.html` regenerate; reconnect the panel in Figma and confirm the dot appears (amber with no worker, green after starting one) and the Artifacts banner shows/hides accordingly.

- [ ] **Step 4: Commit anything the smoke shook out; otherwise done**

---

## Self-review notes (kept for the implementer)

- **Spec coverage:** worker URL tagging (T4), presence registry (T1), tagged handler + frames (T2), snapshot field + connect-rescan + changeset (T3), Zustand slice + null/[] semantics + coverage (T5), snapshot-seed + frame-sync (T6), banners with exact copy + enqueue-anyway (T7), ContextBar dot + ENQUEUEABLE_KINDS (T8). Replay-convergence needs no code (any transition emits a frame; T2's design note).
- **Known anchors that may have drifted:** line numbers are from 2026-07-09 `main` (`6d52fc7`). Re-grep before editing: `sseClients` (server.ts), `ProjectPluginOptions`/`buildSnapshot` (project.ts), `ContextBar` (router.tsx:179), `makeBridge` (screen-artifacts.test.tsx:270).
- **Panel test env:** copy the jsdom pragma/setup from `screen-artifacts.test.tsx` for the new `.tsx` tests; the `Bridge` fixture in `use-worker-status.test.tsx` should mirror the existing `makeBridge` if the interface has more required members.

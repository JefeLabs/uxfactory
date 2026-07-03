import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { BridgeStore } from "../src/store.js";
import { createBridge, startBridge } from "../src/server.js";

// --- store unit: queue + result + event ring ---

describe("BridgeStore pipeline queue/result (unit)", () => {
  let store: BridgeStore;
  let storeDir: string;

  beforeEach(async () => {
    storeDir = await mkdtemp(path.join(os.tmpdir(), "uxf-store-pipeline-"));
    store = new BridgeStore(storeDir);
    await store.init();
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  it("enqueue→dequeue is FIFO and returns the full request", async () => {
    const a = await store.enqueuePipelineRequest("classify", { n: 1 }, 1000, "/proj");
    const b = await store.enqueuePipelineRequest("batch", { n: 2 }, 1001, "/proj");
    expect(a.id).toMatch(/^pr_/);
    expect(a.kind).toBe("classify");
    expect(a.payload).toEqual({ n: 1 });
    expect(a.createdAt).toBe(1000);
    expect(a.id).not.toBe(b.id);

    const first = await store.dequeuePipelineRequest("/proj");
    expect(first?.id).toBe(a.id);
    expect(first?.kind).toBe("classify");
    const second = await store.dequeuePipelineRequest("/proj");
    expect(second?.id).toBe(b.id);
    expect(await store.dequeuePipelineRequest("/proj")).toBeNull();
  });

  it("result roundtrip: save then get, null when unknown", async () => {
    expect(await store.getPipelineResult("missing")).toBeNull();
    const saved = await store.savePipelineResult("pr_x", 0, { ok: "yes", extra: "opaque" });
    expect(saved).toEqual({ id: "pr_x", status: 0, result: { ok: "yes", extra: "opaque" } });
    const back = await store.getPipelineResult("pr_x");
    expect(back).toEqual({ id: "pr_x", status: 0, result: { ok: "yes", extra: "opaque" } });
  });

  it("appendPipelineEvent assigns increasing seq; recentPipelineEvents filters by afterSeq", () => {
    const e1 = store.appendPipelineEvent("pr_1", { type: "text-delta", value: "a" });
    const e2 = store.appendPipelineEvent("pr_1", { type: "text-delta", value: "b" });
    const e3 = store.appendPipelineEvent("pr_2", { type: "message-stop" });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);

    expect(store.recentPipelineEvents(0)).toHaveLength(3);
    const after1 = store.recentPipelineEvents(1);
    expect(after1.map((e) => e.seq)).toEqual([2, 3]);
    expect(store.recentPipelineEvents(3)).toHaveLength(0);
  });
});

// --- server: REST relay surface ---

describe("pipeline REST relay (inject)", () => {
  let app: FastifyInstance;
  let dataDir: string;
  let launchRoot: string;
  let registryPath: string;

  beforeEach(async () => {
    launchRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-pipeline-"));
    await mkdir(path.join(launchRoot, ".git"), { recursive: true });
    dataDir = path.join(launchRoot, ".uxfactory");
    registryPath = path.join(launchRoot, "repos-registry.json");
    app = await createBridge({ dataDir, reposRegistryPath: registryPath });
  });

  afterEach(async () => {
    await app.close();
    await rm(launchRoot, { recursive: true, force: true });
  });

  it("POST /pipeline/request enqueues and returns an id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "classify", payload: { project: "demo" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toMatch(/^pr_/);
  });

  it("POST /pipeline/request rejects an empty/missing kind with 400", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "", payload: {} },
    });
    expect(empty.statusCode).toBe(400);
    const missing = await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { payload: {} },
    });
    expect(missing.statusCode).toBe(400);
  });

  it("GET /pipeline/request/next returns 204 when empty, then drains FIFO", async () => {
    expect((await app.inject({ method: "GET", url: "/pipeline/request/next" })).statusCode).toBe(
      204,
    );

    const a = (
      await app.inject({
        method: "POST",
        url: "/pipeline/request",
        payload: { kind: "classify", payload: { n: 1 } },
      })
    ).json();
    const b = (
      await app.inject({
        method: "POST",
        url: "/pipeline/request",
        payload: { kind: "batch", payload: { n: 2 } },
      })
    ).json();

    const first = await app.inject({ method: "GET", url: "/pipeline/request/next" });
    expect(first.statusCode).toBe(200);
    expect(first.json().id).toBe(a.id);
    expect(first.json().kind).toBe("classify");
    expect(first.json().payload).toEqual({ n: 1 });

    const second = await app.inject({ method: "GET", url: "/pipeline/request/next" });
    expect(second.json().id).toBe(b.id);

    expect((await app.inject({ method: "GET", url: "/pipeline/request/next" })).statusCode).toBe(
      204,
    );
  });

  it("GET /pipeline/result/:id is 404 unknown → 202 pending → 200 result", async () => {
    // unknown id
    expect((await app.inject({ method: "GET", url: "/pipeline/result/pr_nope" })).statusCode).toBe(
      404,
    );

    // enqueue → known but no result yet → 202 pending
    const id = (
      await app.inject({
        method: "POST",
        url: "/pipeline/request",
        payload: { kind: "classify", payload: {} },
      })
    ).json().id as string;
    const pending = await app.inject({ method: "GET", url: `/pipeline/result/${id}` });
    expect(pending.statusCode).toBe(202);
    expect(pending.json()).toEqual({ pending: true });

    // save a result → 200 with the stored result
    const posted = await app.inject({
      method: "POST",
      url: "/pipeline/result",
      payload: { id, status: 0, result: { ok: true, opaque: "x" } },
    });
    expect(posted.statusCode).toBe(200);
    expect(posted.json()).toEqual({ ok: true });

    const done = await app.inject({ method: "GET", url: `/pipeline/result/${id}` });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ id, status: 0, result: { ok: true, opaque: "x" } });
  });

  it("POST /pipeline/result rejects a missing/invalid id with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pipeline/result",
      payload: { status: 0, result: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /pipeline/event rejects a missing requestId with 400, accepts a valid one", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/pipeline/event",
      payload: { event: { type: "text-delta" } },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST",
      url: "/pipeline/event",
      payload: { requestId: "pr_1", event: { type: "text-delta", value: "hi" } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
  });

  describe("pipeline root-tagging", () => {
    it("enqueue with no ?root= stamps the launch root; next with no ?root= claims it", async () => {
      const enq = await app.inject({
        method: "POST",
        url: "/pipeline/request",
        payload: { kind: "generate-artifact", payload: { artifact: "brief" } },
      });
      expect(enq.statusCode).toBe(200);
      const next = await app.inject({ method: "GET", url: "/pipeline/request/next" });
      expect(next.statusCode).toBe(200);
      const req = next.json() as { id: string; root: string };
      expect(req.root).toBe(path.resolve(launchRoot));
    });

    it("a poll for a foreign root never claims a launch-root job", async () => {
      const other = await mkdtemp(path.join(os.tmpdir(), "uxf-pipe-other-"));
      await mkdir(path.join(other, ".git"), { recursive: true });
      try {
        await app.inject({ method: "POST", url: "/project/connect", payload: { repoPath: other } });

        // Enqueue a launch-root job (no ?root=).
        await app.inject({
          method: "POST",
          url: "/pipeline/request",
          payload: { kind: "generate-artifact", payload: {} },
        });

        // Worker for `other` polls: 204 (launch job is not its work).
        const foreign = await app.inject({
          method: "GET",
          url: `/pipeline/request/next?root=${encodeURIComponent(other)}`,
        });
        expect(foreign.statusCode).toBe(204);

        // Launch-root poll still gets it.
        const own = await app.inject({ method: "GET", url: "/pipeline/request/next" });
        expect(own.statusCode).toBe(200);
        expect((own.json() as { root: string }).root).toBe(path.resolve(launchRoot));
      } finally {
        await rm(other, { recursive: true, force: true });
      }
    });

    it("per-root FIFO: A and B jobs interleave without cross-claiming", async () => {
      const other = await mkdtemp(path.join(os.tmpdir(), "uxf-pipe-B-"));
      await mkdir(path.join(other, ".git"), { recursive: true });
      try {
        await app.inject({ method: "POST", url: "/project/connect", payload: { repoPath: other } });
        const enc = (p: string) => encodeURIComponent(p);

        // launch, other, launch — enqueued in that order.
        await app.inject({ method: "POST", url: "/pipeline/request", payload: { kind: "k", payload: { n: 1 } } });
        await app.inject({ method: "POST", url: `/pipeline/request?root=${enc(other)}`, payload: { kind: "k", payload: { n: 2 } } });
        await app.inject({ method: "POST", url: "/pipeline/request", payload: { kind: "k", payload: { n: 3 } } });

        // `other` poll gets only n:2.
        const b1 = (await app.inject({ method: "GET", url: `/pipeline/request/next?root=${enc(other)}` })).json() as { payload: { n: number }; root: string };
        expect(b1.payload.n).toBe(2);
        expect(b1.root).toBe(path.resolve(other));
        const b2 = await app.inject({ method: "GET", url: `/pipeline/request/next?root=${enc(other)}` });
        expect(b2.statusCode).toBe(204);

        // launch poll drains n:1 then n:3 (FIFO).
        const a1 = (await app.inject({ method: "GET", url: "/pipeline/request/next" })).json() as { payload: { n: number } };
        expect(a1.payload.n).toBe(1);
        const a2 = (await app.inject({ method: "GET", url: "/pipeline/request/next" })).json() as { payload: { n: number } };
        expect(a2.payload.n).toBe(3);
      } finally {
        await rm(other, { recursive: true, force: true });
      }
    });
  });
});

// --- SSE: live broadcast + replay over a real socket ---

/** Read SSE `data:` frames from a fetch body stream until `predicate` returns a value. */
async function readUntil<T>(
  res: Response,
  predicate: (data: unknown) => T | null,
  timeoutMs = 4000,
): Promise<T> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (dataLine === undefined) continue;
        const parsed = JSON.parse(dataLine.slice("data:".length).trim()) as unknown;
        const hit = predicate(parsed);
        if (hit !== null) return hit;
      }
    }
    throw new Error("SSE frame did not arrive before timeout");
  } finally {
    await reader.cancel().catch(() => {});
  }
}

describe("GET /pipeline/events SSE stream", () => {
  let handle: { url: string; close: () => Promise<void> };
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-sse-"));
    await mkdir(path.join(root, ".git"), { recursive: true });
    handle = await startBridge({ dataDir: path.join(root, ".uxfactory"), port: 0 });
  });

  afterEach(async () => {
    await handle.close();
    await rm(root, { recursive: true, force: true });
  });

  it("delivers a posted event to a connected client", async () => {
    const res = await fetch(`${handle.url}/pipeline/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    await fetch(`${handle.url}/pipeline/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "pr_live", event: { type: "text-delta", value: "hi" } }),
    });

    const frame = await readUntil(res, (d) => {
      const e = d as { requestId?: string; event?: { value?: string }; seq?: number };
      return e.requestId === "pr_live" ? e : null;
    });
    expect(frame.event?.value).toBe("hi");
    expect(frame.seq).toBe(1);
  });

  it("delivers a wake frame to a connected client after POST /pipeline/request", async () => {
    // A request enqueued while a worker is IDLE has no other wake signal
    // (deterministic dispatch emits no events), so POST /pipeline/request must
    // broadcast a lightweight wake frame to every connected SSE client.
    const res = await fetch(`${handle.url}/pipeline/events`);
    expect(res.status).toBe(200);

    const enqueued = await fetch(`${handle.url}/pipeline/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "classify", payload: { project: "demo" } }),
    });
    const { id } = (await enqueued.json()) as { id: string };

    const frame = await readUntil(res, (d) => {
      const e = d as { requestId?: string; event?: { type?: string; id?: string }; seq?: number };
      return e.event?.type === "pipeline-request" ? e : null;
    });
    expect(frame.requestId).toBe(id);
    expect(frame.event?.id).toBe(id);
    expect(frame.seq).toBe(1);
  });

  it("replays missed events via Last-Event-ID", async () => {
    // Post two events with no client connected.
    for (const n of [1, 2]) {
      await fetch(`${handle.url}/pipeline/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: "pr_replay", event: { n } }),
      });
    }

    // Reconnect from seq 1 → should replay only seq 2.
    const res = await fetch(`${handle.url}/pipeline/events`, {
      headers: { "Last-Event-ID": "1" },
    });
    expect(res.status).toBe(200);
    const frame = await readUntil(res, (d) => {
      const e = d as { requestId?: string; seq?: number; event?: { n?: number } };
      return e.requestId === "pr_replay" ? e : null;
    });
    expect(frame.seq).toBe(2);
    expect(frame.event?.n).toBe(2);
  });
});

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
    try {
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
    } catch {
      // AbortController.abort() rejects the pending read() — expected teardown,
      // not a test failure. Swallow so vitest sees no unhandled rejection.
    }
  })();
}

async function waitFor(cond: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
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

describe("snapshot workers field + connect-rescan", () => {
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

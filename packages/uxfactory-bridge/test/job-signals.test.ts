import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

describe("BridgeOptions job-signal callbacks", () => {
  let app: FastifyInstance;
  let launchRoot: string;
  const enqueued: Array<{ root: string; kind: string }> = [];
  const settled: string[] = [];
  const claimed: Array<{ root: string; kind: string }> = [];

  beforeEach(async () => {
    enqueued.length = 0;
    settled.length = 0;
    claimed.length = 0;
    launchRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-job-signals-"));
    await mkdir(path.join(launchRoot, ".git"), { recursive: true });
    app = await createBridge({
      dataDir: path.join(launchRoot, ".uxfactory"),
      reposRegistryPath: path.join(launchRoot, "repos-registry.json"),
      onRequestEnqueued: (root, kind) => enqueued.push({ root, kind }),
      onRequestSettled: (root) => settled.push(root),
      onRequestClaimed: (root, kind) => claimed.push({ root, kind }),
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(launchRoot, { recursive: true, force: true });
  });

  it("fires onRequestEnqueued with the resolved root and kind on every enqueue", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "generate-artifact", payload: { artifact: "brief" } },
    });
    expect(res.statusCode).toBe(200);
    expect(enqueued).toEqual([{ root: launchRoot, kind: "generate-artifact" }]);
  });

  it("does not fire onRequestEnqueued on a rejected enqueue (bad kind)", async () => {
    await app.inject({ method: "POST", url: "/pipeline/request", payload: { kind: "" } });
    expect(enqueued).toHaveLength(0);
  });

  it("fires onRequestSettled with the request's root after the result saves", async () => {
    const enq = await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "generate-artifact", payload: {} },
    });
    const { id } = enq.json() as { id: string };
    await app.inject({
      method: "POST",
      url: "/pipeline/result",
      payload: { id, status: 0, result: { ok: true } },
    });
    expect(settled).toEqual([launchRoot]);
  });

  it("does not fire onRequestSettled for an unknown request id", async () => {
    await app.inject({
      method: "POST",
      url: "/pipeline/result",
      payload: { id: "pr_never_enqueued", status: 0, result: null },
    });
    expect(settled).toHaveLength(0);
  });

  it("fires onRequestClaimed on a successful dequeue with root and kind; silent on 204", async () => {
    await app.inject({
      method: "POST",
      url: "/pipeline/request",
      payload: { kind: "generate-artifact", payload: {} },
    });
    expect(claimed).toHaveLength(0); // enqueue alone is not a claim

    const res = await app.inject({ method: "GET", url: "/pipeline/request/next" });
    expect(res.statusCode).toBe(200);
    expect(claimed).toEqual([{ root: launchRoot, kind: "generate-artifact" }]);

    const empty = await app.inject({ method: "GET", url: "/pipeline/request/next" });
    expect(empty.statusCode).toBe(204);
    expect(claimed).toHaveLength(1); // no claim signal for an empty queue
  });
});

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

describe("managed flag on snapshot and worker-status frames", () => {
  let app: FastifyInstance;
  let launchRoot: string;
  const managed: Array<{ root: string; kinds?: string[] }> = [];

  beforeEach(async () => {
    managed.length = 0;
    launchRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-job-signals-"));
    await mkdir(path.join(launchRoot, ".git"), { recursive: true });
    app = await createBridge({
      dataDir: path.join(launchRoot, ".uxfactory"),
      reposRegistryPath: path.join(launchRoot, "repos-registry.json"),
      managedRoots: () => managed,
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(launchRoot, { recursive: true, force: true });
  });

  it("snapshot carries managed for a managed root and omits it otherwise", async () => {
    const before = (await app.inject({ method: "GET", url: "/project/snapshot" })).json() as {
      managed?: unknown;
    };
    expect(before.managed).toBeUndefined();

    managed.push({ root: launchRoot, kinds: ["generate-artifact"] });
    const after = (await app.inject({ method: "GET", url: "/project/snapshot" })).json() as {
      managed?: { kinds?: string[] };
    };
    expect(after.managed).toEqual({ kinds: ["generate-artifact"] });
  });

  it("POST /project/connect response carries managed for the connected root", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "uxf-managed-conn-"));
    await mkdir(path.join(other, ".git"), { recursive: true });
    managed.push({ root: path.resolve(other) });
    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: other },
    });
    const body = res.json() as { ok: boolean; snapshot: { managed?: { kinds?: string[] } } };
    expect(body.ok).toBe(true);
    expect(body.snapshot.managed).toEqual({});
    await rm(other, { recursive: true, force: true });
  });

  it("E8: POST /project/connect response has NO managed key for a root NOT in managedRoots", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "uxf-unmanaged-conn-"));
    await mkdir(path.join(other, ".git"), { recursive: true });
    // Deliberately NOT pushed to `managed` — this root is unmanaged.
    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: other },
    });
    const body = res.json() as { ok: boolean; snapshot: { managed?: unknown } };
    expect(body.ok).toBe(true);
    expect("managed" in body.snapshot).toBe(false);
    await rm(other, { recursive: true, force: true });
  });

  it("worker-status frames carry managed (SSE, real socket)", async () => {
    managed.push({ root: launchRoot });
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    const observed: Array<{ requestId: string; event: { managed?: unknown; workers?: unknown[] } }> = [];
    const ctl = new AbortController();
    const res = await fetch(`${base}/pipeline/events`, { signal: ctl.signal });
    collectFrames(res, observed);

    const workerCtl = new AbortController();
    await fetch(
      `${base}/pipeline/events?client=worker&root=${encodeURIComponent(launchRoot)}`,
      { signal: workerCtl.signal },
    );
    await waitFor(() =>
      observed.some((f) => f.requestId === "worker-status" && f.event.workers?.length === 1),
    );
    const frame = observed.find((f) => f.requestId === "worker-status")!;
    expect(frame.event.managed).toEqual({});
    workerCtl.abort();
    ctl.abort();
  });
});

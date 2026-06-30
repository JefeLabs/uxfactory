/**
 * Worker subscribe-loop + deterministic dispatch (Phase 11B, Task 3).
 *
 * No real LLM and no real bridge package: deterministic dispatch is exercised
 * against a STUB `uxfactory` CLI (an executable .cjs that echoes JSON + a chosen
 * exit code), and the bridge surface is exercised against either a FAKE in-memory
 * `BridgeLike` (drain/dispatch tests) or a tiny in-process `node:http` server that
 * mirrors the real `/pipeline/*` shapes (WorkerBridgeClient + runWorker tests).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, chmod, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { WorkerBridgeClient } from "../src/bridge-client.js";
import type { BridgeLike, PipelineRequest } from "../src/bridge-client.js";
import { runCli, resolveCliBin } from "../src/run-cli.js";
import { DETERMINISTIC, isDeterministic, runGenerative } from "../src/dispatch.js";
import type { DispatchCtx } from "../src/dispatch.js";
import { drain, handleRequest, runWorker } from "../src/main.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Write an executable stub `uxfactory` that records its cwd+argv, prints JSON, exits `code`. */
async function writeStubCli(file: string, code: number, stdout: string): Promise<void> {
  const body =
    `#!/usr/bin/env node\n` +
    `const fs=require('node:fs'),path=require('node:path');\n` +
    `try{fs.writeFileSync(path.join(process.cwd(),'.stub-call.json'),` +
    `JSON.stringify({cwd:process.cwd(),argv:process.argv.slice(2)}));}catch(e){}\n` +
    `process.stdout.write(${JSON.stringify(stdout)});\n` +
    `process.exit(${code});\n`;
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor: condition not met before timeout");
}

/** A minimal in-memory BridgeLike for drain/dispatch tests. */
class FakeBridge implements BridgeLike {
  queue: PipelineRequest[] = [];
  results: { id: string; status: number; result: unknown }[] = [];
  events: { requestId: string; event: unknown }[] = [];
  wake: (() => void) | null = null;

  async pullRequest(): Promise<PipelineRequest | null> {
    return this.queue.shift() ?? null;
  }
  async postResult(id: string, status: number, result: unknown): Promise<void> {
    this.results.push({ id, status, result });
  }
  async postEvent(requestId: string, event: unknown): Promise<void> {
    this.events.push({ requestId, event });
  }
  subscribeEvents(onWake: () => void): () => void {
    this.wake = onWake;
    return () => {
      this.wake = null;
    };
  }
}

interface FakeServer {
  url: string;
  close: () => Promise<void>;
  state: {
    queue: PipelineRequest[];
    results: { id: string; status: number; result: unknown }[];
    events: { requestId: string; event: unknown }[];
    sse: http.ServerResponse[];
    seq: number;
  };
}

/** Spin up a node:http server mirroring the real bridge `/pipeline/*` REST + SSE shapes. */
async function startFakeBridge(): Promise<FakeServer> {
  const state: FakeServer["state"] = { queue: [], results: [], events: [], sse: [], seq: 0 };

  const readBody = (req: http.IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(raw === "" ? {} : (JSON.parse(raw) as unknown)));
    });

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/pipeline/request/next") {
      const next = state.queue.shift();
      if (next === undefined) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(next));
      return;
    }
    if (req.method === "POST" && url === "/pipeline/result") {
      void readBody(req).then((b) => {
        const body = b as { id: string; status: number; result: unknown };
        state.results.push({ id: body.id, status: body.status, result: body.result });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === "POST" && url === "/pipeline/event") {
      void readBody(req).then((b) => {
        const body = b as { requestId: string; event: unknown };
        state.events.push(body);
        state.seq += 1;
        const frame = `id: ${state.seq}\ndata: ${JSON.stringify({ ...body, seq: state.seq })}\n\n`;
        for (const client of state.sse) client.write(frame);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === "GET" && url === "/pipeline/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      state.sse.push(res);
      req.on("close", () => {
        const i = state.sse.indexOf(res);
        if (i >= 0) state.sse.splice(i, 1);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of state.sse) c.end();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// runCli
// ---------------------------------------------------------------------------

describe("runCli", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "uxf-worker-runcli-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps exit 0 → status 0 and parses stdout JSON", async () => {
    const bin = path.join(dir, "uxfactory.cjs");
    await writeStubCli(bin, 0, JSON.stringify({ ok: true, n: 1 }));
    const res = await runCli(bin, ["classify", "--json"], dir);
    expect(res.status).toBe(0);
    expect(res.json).toEqual({ ok: true, n: 1 });
  });

  it("maps exit 1 → status 1 (json still parsed)", async () => {
    const bin = path.join(dir, "uxfactory.cjs");
    await writeStubCli(bin, 1, JSON.stringify({ clean: false }));
    const res = await runCli(bin, ["batch", "design", "--json"], dir);
    expect(res.status).toBe(1);
    expect(res.json).toEqual({ clean: false });
  });

  it("maps a spawn failure (ENOENT) → status 2, json null", async () => {
    const res = await runCli(path.join(dir, "does-not-exist"), ["classify"], dir);
    expect(res.status).toBe(2);
    expect(res.json).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveCliBin
// ---------------------------------------------------------------------------

describe("resolveCliBin", () => {
  it("prefers an explicit config cliBin", () => {
    expect(resolveCliBin({ projectRoot: "/x", cliBin: "/custom/uxfactory" })).toBe(
      "/custom/uxfactory",
    );
  });
  it("falls back to PATH 'uxfactory' when no local bin exists", () => {
    expect(resolveCliBin({ projectRoot: "/definitely/not/a/repo" })).toBe("uxfactory");
  });
});

// ---------------------------------------------------------------------------
// deterministic dispatch via drain
// ---------------------------------------------------------------------------

describe("deterministic dispatch", () => {
  let projectRoot: string;
  let binDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-worker-proj-"));
    binDir = await mkdtemp(path.join(os.tmpdir(), "uxf-worker-bin-"));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  const deps = (bridge: FakeBridge, cliBin: string): Parameters<typeof drain>[0] => ({
    bridge,
    ctx: { projectRoot, cliBin } satisfies DispatchCtx,
    generative: async () => ({ status: 2, result: { error: "no generative in this test" } }),
  });

  it("classify: writes the payload classification, runs the CLI in projectRoot, posts status 0 + JSON", async () => {
    const bin = path.join(binDir, "uxfactory.cjs");
    await writeStubCli(
      bin,
      0,
      JSON.stringify({ confirm_status: "draft", scope: { visual: "low" } }),
    );

    const bridge = new FakeBridge();
    bridge.queue.push({
      id: "pr_1",
      kind: "classify",
      payload: { classification: { product_type: "saas", surfaces: ["web"] } },
      createdAt: 1,
    });

    await drain(deps(bridge, bin));

    // posted the parsed CLI JSON with status 0
    expect(bridge.results).toHaveLength(1);
    expect(bridge.results[0]).toMatchObject({ id: "pr_1", status: 0 });
    expect(bridge.results[0]!.result).toEqual({
      confirm_status: "draft",
      scope: { visual: "low" },
    });

    // wrote the payload-provided classification to projectRoot BEFORE the CLI read it
    const written = JSON.parse(
      await readFile(path.join(projectRoot, "uxfactory.classification.json"), "utf8"),
    ) as unknown;
    expect(written).toEqual({ product_type: "saas", surfaces: ["web"] });

    // the CLI ran in projectRoot with the expected args
    const call = JSON.parse(await readFile(path.join(projectRoot, ".stub-call.json"), "utf8")) as {
      cwd: string;
      argv: string[];
    };
    // macOS symlinks /var → /private/var, so compare resolved realpaths.
    expect(call.cwd).toBe(await realpath(projectRoot));
    expect(call.argv).toEqual(["classify", "--json"]);
  });

  it("batch: a CLI that exits 1 yields result status 1", async () => {
    const bin = path.join(binDir, "uxfactory.cjs");
    await writeStubCli(bin, 1, JSON.stringify({ clean: false, mustPassFailed: true }));

    const bridge = new FakeBridge();
    bridge.queue.push({ id: "pr_b", kind: "batch", payload: { dir: "design" }, createdAt: 1 });

    await drain(deps(bridge, bin));

    expect(bridge.results).toHaveLength(1);
    expect(bridge.results[0]).toMatchObject({ id: "pr_b", status: 1 });
    expect(bridge.results[0]!.result).toEqual({ clean: false, mustPassFailed: true });
  });

  it("a spawn failure inside a handler yields result status 2 and keeps the loop alive", async () => {
    const bridge = new FakeBridge();
    bridge.queue.push({ id: "pr_s", kind: "batch", payload: { dir: "design" }, createdAt: 1 });
    bridge.queue.push({ id: "pr_t", kind: "batch", payload: { dir: "design" }, createdAt: 2 });

    await drain(deps(bridge, path.join(binDir, "no-such-uxfactory")));

    expect(bridge.results).toHaveLength(2);
    expect(bridge.results[0]).toMatchObject({ id: "pr_s", status: 2 });
    expect(bridge.results[1]).toMatchObject({ id: "pr_t", status: 2 });
  });

  it("drains the queue until pullRequest returns null (204)", async () => {
    const bin = path.join(binDir, "uxfactory.cjs");
    await writeStubCli(bin, 0, JSON.stringify({ ok: true }));

    const bridge = new FakeBridge();
    for (let i = 0; i < 3; i++) {
      bridge.queue.push({ id: `pr_${i}`, kind: "classify", payload: {}, createdAt: i });
    }

    await drain(deps(bridge, bin));

    expect(bridge.results.map((r) => r.id)).toEqual(["pr_0", "pr_1", "pr_2"]);
    expect(bridge.queue).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generative branch (Task 4 stub)
// ---------------------------------------------------------------------------

describe("generative branch", () => {
  it("isDeterministic recognizes the five deterministic kinds and rejects generative ones", () => {
    for (const k of ["classify", "gate", "batch", "review", "render"]) {
      expect(isDeterministic(k)).toBe(true);
    }
    expect(isDeterministic("generate-artifact")).toBe(false);
    expect(isDeterministic("canvas-review")).toBe(false);
  });

  it("a throwing generative handler is caught → result status 2 (loop stays alive)", async () => {
    const bridge = new FakeBridge();
    await handleRequest(
      { id: "pr_g", kind: "generate-artifact", payload: {}, createdAt: 1 },
      {
        bridge,
        ctx: { projectRoot: "/x", cliBin: "uxfactory" },
        generative: async () => {
          throw new Error("boom");
        },
      },
    );
    expect(bridge.results).toHaveLength(1);
    expect(bridge.results[0]).toMatchObject({ id: "pr_g", status: 2 });
  });

  it("the runGenerative stub throws 'not implemented (Task 4)'", async () => {
    await expect(
      runGenerative(
        { id: "pr_g", kind: "generate-artifact", payload: {}, createdAt: 1 },
        // adapter/bridge are unused by the stub; pass minimal shims.
        {} as never,
        {} as never,
        { projectRoot: "/x", cliBin: "uxfactory" },
      ),
    ).rejects.toThrow(/Task 4/);
  });
});

// ---------------------------------------------------------------------------
// WorkerBridgeClient against an in-process http bridge
// ---------------------------------------------------------------------------

describe("WorkerBridgeClient (http)", () => {
  let fake: FakeServer;
  beforeEach(async () => {
    fake = await startFakeBridge();
  });
  afterEach(async () => {
    await fake.close();
  });

  it("pullRequest: 204 → null, 200 → the request", async () => {
    const client = new WorkerBridgeClient(fake.url);
    expect(await client.pullRequest()).toBeNull();

    fake.state.queue.push({ id: "pr_1", kind: "classify", payload: { a: 1 }, createdAt: 9 });
    const req = await client.pullRequest();
    expect(req).toEqual({ id: "pr_1", kind: "classify", payload: { a: 1 }, createdAt: 9 });
  });

  it("postResult + postEvent send the documented body shapes", async () => {
    const client = new WorkerBridgeClient(fake.url);
    await client.postResult("pr_1", 0, { ok: true });
    await client.postEvent("pr_1", { type: "text-delta", text: "hi" });
    expect(fake.state.results[0]).toEqual({ id: "pr_1", status: 0, result: { ok: true } });
    expect(fake.state.events[0]).toEqual({
      requestId: "pr_1",
      event: { type: "text-delta", text: "hi" },
    });
  });

  it("subscribeEvents: fires onWake on a broadcast data frame; unsubscribe stops it", async () => {
    const client = new WorkerBridgeClient(fake.url);
    let wakes = 0;
    const unsub = client.subscribeEvents(() => {
      wakes += 1;
    });
    // wait until the SSE client is registered server-side
    await waitFor(() => fake.state.sse.length >= 1);
    await client.postEvent("pr_live", { type: "message-stop" });
    await waitFor(() => wakes >= 1);
    expect(wakes).toBeGreaterThanOrEqual(1);
    unsub();
  });
});

// ---------------------------------------------------------------------------
// runWorker end-to-end (http bridge + stub CLI)
// ---------------------------------------------------------------------------

describe("runWorker (end-to-end)", () => {
  let fake: FakeServer;
  let projectRoot: string;
  let binDir: string;

  beforeEach(async () => {
    fake = await startFakeBridge();
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-worker-e2e-"));
    binDir = await mkdtemp(path.join(os.tmpdir(), "uxf-worker-e2ebin-"));
  });
  afterEach(async () => {
    await fake.close();
    await rm(projectRoot, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  it("drains a queued classify request on start and posts the result", async () => {
    const bin = path.join(binDir, "uxfactory.cjs");
    await writeStubCli(bin, 0, JSON.stringify({ confirm_status: "draft" }));
    fake.state.queue.push({ id: "pr_e2e", kind: "classify", payload: {}, createdAt: 1 });

    const bridge = new WorkerBridgeClient(fake.url);
    const stop = runWorker({
      bridge,
      ctx: { projectRoot, cliBin: bin },
      generative: async () => ({ status: 2, result: {} }),
    });

    await waitFor(() => fake.state.results.length >= 1);
    stop();

    expect(fake.state.results[0]).toMatchObject({ id: "pr_e2e", status: 0 });
    expect(fake.state.results[0]!.result).toEqual({ confirm_status: "draft" });
  });
});

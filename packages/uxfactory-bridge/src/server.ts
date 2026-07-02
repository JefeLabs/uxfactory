import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { RenderReport, GateResult, CheckId } from "@uxfactory/gate";
import { gate } from "@uxfactory/gate";
import type { Spec } from "@uxfactory/spec";
import { validate } from "@uxfactory/spec";
import { BridgeStore } from "./store.js";
import type { ReviewReportPayload, CanvasRequest, PipelineEvent } from "./store.js";
import { projectPlugin } from "./project.js";

/** Options for building a bridge. */
export interface BridgeOptions {
  /** Root for all on-disk state. Default: <cwd>/.uxfactory */
  dataDir?: string;
  /** How long POST /edits waits for the matching render before 504. Default 4000ms. */
  editTimeoutMs?: number;
}

const DEFAULT_EDIT_TIMEOUT_MS = 4000;
const DEFAULT_TOLERANCE_PX = 0.5;
const DEFAULT_PORT = 3779;
/** SSE keep-alive comment cadence — keeps idle proxies/sockets from dropping the stream. */
const SSE_KEEPALIVE_MS = 25_000;
/** Maximum lines retained in the request log ring buffer. */
const LOG_RING_CAP = 500;

/**
 * Read the bridge package.json version string.
 * Tries source-relative path first (src/server.ts → ../package.json), then
 * compiled-relative (dist/src/server.js → ../../package.json) so the same code
 * works both in vitest (source) and in production builds (compiled).
 */
async function readBridgeVersion(): Promise<string> {
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      const url = new URL(rel, import.meta.url);
      const pkg = JSON.parse(
        await readFile(fileURLToPath(url), "utf8"),
      ) as { version?: string };
      if (typeof pkg.version === "string") return pkg.version;
    } catch { /* try next */ }
  }
  return "0.0.0";
}

/** A POST /edits caller awaiting the render keyed by the enqueued jobId. */
interface EditWaiter {
  resolve: (report: RenderReport) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Build a configured (but not-yet-listening) Fastify bridge. */
export async function createBridge(options: BridgeOptions = {}): Promise<FastifyInstance> {
  const dataDir = options.dataDir ?? path.resolve(process.cwd(), ".uxfactory");
  // The served project root is the parent of the .uxfactory data directory.
  const servedRoot = path.dirname(dataDir);
  // editTimeoutMs is consumed by POST /edits (Task 5).
  const editTimeoutMs = options.editTimeoutMs ?? DEFAULT_EDIT_TIMEOUT_MS;

  // --- boot-time state for /stats and /logs ---
  const bridgeVersion = await readBridgeVersion();
  const shared = { startedAt: Date.now(), runsRelayed: 0 };
  const logRing: string[] = [];

  const store = new BridgeStore(dataDir);
  await store.init();

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // --- per-request log ring (500-line cap, "<METHOD> <url> <status>") ---
  app.addHook("onResponse", async (req, reply) => {
    const line = `${req.method} ${req.url} ${reply.statusCode}`;
    logRing.push(line);
    if (logRing.length > LOG_RING_CAP) logRing.splice(0, logRing.length - LOG_RING_CAP);
  });

  // --- project / panel routes (Task 3) ---
  await app.register(projectPlugin, { servedRoot, dataDir, version: bridgeVersion, shared, logRing });

  const waiters = new Map<string, EditWaiter>();

  let verifyCounter = 0;
  const nextVerifyId = (): string => {
    verifyCounter += 1;
    return `v_${Date.now()}_${verifyCounter}`;
  };

  // --- pipeline relay state (Phase 11B) ---
  // Every enqueued request id, kept so GET /pipeline/result/:id can tell a
  // known-but-pending id (202) from an entirely unknown one (404).
  const pipelineRequestIds = new Set<string>();
  // Connected SSE clients → their keep-alive interval (cleared when the socket closes).
  const sseClients = new Map<ServerResponse, ReturnType<typeof setInterval>>();

  /** Write one event frame to a raw SSE socket; drop the client if the write fails. */
  const writePipelineFrame = (res: ServerResponse, frame: PipelineEvent): void => {
    try {
      res.write(`id: ${frame.seq}\ndata: ${JSON.stringify(frame)}\n\n`);
    } catch {
      const timer = sseClients.get(res);
      if (timer !== undefined) clearInterval(timer);
      sseClients.delete(res);
    }
  };

  /** Fan one event frame out to every connected SSE client. */
  const broadcastPipelineFrame = (frame: PipelineEvent): void => {
    for (const client of sseClients.keys()) writePipelineFrame(client, frame);
  };

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

  // --- review report relay ---

  app.post("/review", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "body must be an object with conformant and findings" });
    }
    if (typeof body["conformant"] !== "boolean") {
      return reply.code(400).send({ error: "conformant must be a boolean" });
    }
    if (!Array.isArray(body["findings"])) {
      return reply.code(400).send({ error: "findings must be an array" });
    }
    const stored = await store.saveReviewReport(body as ReviewReportPayload);
    return stored;
  });

  app.get("/review", async (_req, reply) => {
    const report = await store.getReviewReport();
    if (report === null) return reply.code(404).send({ error: "no review report yet" });
    return report;
  });

  // --- canvas request relay (§14.2) ---

  app.post("/canvas", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "body must be an object with a snapshot" });
    }
    const snapshot = body["snapshot"];
    if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return reply.code(400).send({ error: "snapshot must be an object" });
    }
    const snap = snapshot as Record<string, unknown>;
    if (snap["source"] !== "canvas-inferred") {
      return reply.code(400).send({ error: 'snapshot.source must be "canvas-inferred"' });
    }
    if (!Array.isArray(snap["frames"])) {
      return reply.code(400).send({ error: "snapshot.frames must be an array" });
    }
    const stored = await store.saveCanvasRequest(body as CanvasRequest);
    return stored;
  });

  app.get("/canvas", async (_req, reply) => {
    const request = await store.getCanvasRequest();
    if (request === null) return reply.code(404).send({ error: "no canvas request yet" });
    return request;
  });

  // --- pipeline relay (Phase 11B): a pure plugin↔worker broker ---
  // No @uxfactory/cli import; kind/payload/result/event are all opaque to the bridge.

  // Plugin enqueues a request for the worker to fulfil.
  app.post("/pipeline/request", async (req, reply) => {
    const body = req.body as { kind?: unknown; payload?: unknown };
    if (typeof body?.kind !== "string" || body.kind.trim() === "") {
      return reply.code(400).send({ error: "kind must be a non-empty string" });
    }
    // Date.now() lives here (the server), not in the store.
    const request = await store.enqueuePipelineRequest(body.kind, body.payload, Date.now());
    pipelineRequestIds.add(request.id);
    // Wake any idle worker. A request enqueued while the worker is IDLE has no
    // other wake signal (deterministic dispatch emits no events), so broadcast a
    // lightweight wake frame — seq'd and landed in the replay ring like any event.
    // The worker just needs a `data:` frame; it then FIFO-drains via
    // GET /pipeline/request/next. Payload stays opaque (no @uxfactory/cli import).
    const wake = store.appendPipelineEvent(request.id, { type: "pipeline-request", id: request.id });
    broadcastPipelineFrame(wake);
    return { id: request.id };
  });

  // Worker pulls the next queued request (FIFO); 204 when the queue is empty.
  app.get("/pipeline/request/next", async (_req, reply) => {
    const request = await store.dequeuePipelineRequest();
    if (request === null) return reply.code(204).send();
    return request;
  });

  // Worker posts the terminal result (CLI/adapter exit code as `status`).
  app.post("/pipeline/result", async (req, reply) => {
    const body = req.body as { id?: unknown; status?: unknown; result?: unknown };
    if (typeof body?.id !== "string" || body.id === "") {
      return reply.code(400).send({ error: "id must be a non-empty string" });
    }
    if (typeof body.status !== "number") {
      return reply.code(400).send({ error: "status must be a number" });
    }
    await store.savePipelineResult(body.id, body.status, body.result);
    // Increment the relayed-run counter surfaced via GET /stats.
    shared.runsRelayed += 1;
    return { ok: true };
  });

  // Plugin polls for a result. 404 unknown id / 202 known-but-pending / 200 the result.
  // (202 lets the panel distinguish "still running" from "never existed" without a body schema.)
  app.get<{ Params: { id: string } }>("/pipeline/result/:id", async (req, reply) => {
    const result = await store.getPipelineResult(req.params.id);
    if (result !== null) return result;
    if (pipelineRequestIds.has(req.params.id)) return reply.code(202).send({ pending: true });
    return reply.code(404).send({ error: "unknown pipeline request" });
  });

  // Worker streams events; we persist to the ring and fan out to every SSE client.
  app.post("/pipeline/event", async (req, reply) => {
    const body = req.body as { requestId?: unknown; event?: unknown };
    if (typeof body?.requestId !== "string" || body.requestId === "") {
      return reply.code(400).send({ error: "requestId must be a non-empty string" });
    }
    const pe = store.appendPipelineEvent(body.requestId, body.event);
    broadcastPipelineFrame(pe);
    return { ok: true };
  });

  // Panel subscribes to the live event stream (SSE). Raw socket via reply.hijack().
  app.get("/pipeline/events", (req, reply) => {
    const raw = reply.raw;
    reply.hijack();
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // Push headers out now — without a body write a client (e.g. fetch) would otherwise
    // block waiting for the response to begin.
    raw.flushHeaders();

    // Replay anything the client missed since its Last-Event-ID.
    const header = req.headers["last-event-id"];
    const lastSeqRaw = Number(Array.isArray(header) ? header[0] : (header ?? 0));
    const afterSeq = Number.isFinite(lastSeqRaw) ? lastSeqRaw : 0;
    for (const event of store.recentPipelineEvents(afterSeq)) writePipelineFrame(raw, event);

    // Keep-alive comments so idle connections survive; unref so tests/process can exit.
    const keepAlive = setInterval(() => {
      try {
        raw.write(": keep-alive\n\n");
      } catch {
        /* socket gone; the close handler will clean up */
      }
    }, SSE_KEEPALIVE_MS);
    keepAlive.unref?.();

    sseClients.set(raw, keepAlive);
    raw.on("close", () => {
      clearInterval(keepAlive);
      sseClients.delete(raw);
    });
  });

  // On shutdown, end every open SSE socket so Fastify.close() doesn't hang.
  app.addHook("onClose", async () => {
    for (const [client, timer] of sseClients) {
      clearInterval(timer);
      client.end();
    }
    sseClients.clear();
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
      const updated = await store.approveBatch(req.params.id, req.body?.approvedItemIds ?? []);
      if (updated === null) return reply.code(404).send({ error: "unknown batch" });
      return updated;
    },
  );

  return app;
}

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

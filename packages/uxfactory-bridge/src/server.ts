import path from "node:path";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { RenderReport, GateResult, CheckId } from "@uxfactory/gate";
import { gate } from "@uxfactory/gate";
import type { Spec } from "@uxfactory/spec";
import { validate } from "@uxfactory/spec";
import { BridgeStore } from "./store.js";
import type { ReviewReportPayload } from "./store.js";

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

/** A POST /edits caller awaiting the render keyed by the enqueued jobId. */
interface EditWaiter {
  resolve: (report: RenderReport) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Build a configured (but not-yet-listening) Fastify bridge. */
export async function createBridge(options: BridgeOptions = {}): Promise<FastifyInstance> {
  const dataDir = options.dataDir ?? path.resolve(process.cwd(), ".uxfactory");
  // editTimeoutMs is consumed by POST /edits (Task 5).
  const editTimeoutMs = options.editTimeoutMs ?? DEFAULT_EDIT_TIMEOUT_MS;

  const store = new BridgeStore(dataDir);
  await store.init();

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  const waiters = new Map<string, EditWaiter>();

  let verifyCounter = 0;
  const nextVerifyId = (): string => {
    verifyCounter += 1;
    return `v_${Date.now()}_${verifyCounter}`;
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

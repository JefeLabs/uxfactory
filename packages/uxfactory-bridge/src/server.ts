import path from "node:path";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { RenderReport, GateResult, CheckId } from "@uxfactory/gate";
import { gate } from "@uxfactory/gate";
import type { Spec } from "@uxfactory/spec";
import { validate } from "@uxfactory/spec";
import { BridgeStore } from "./store.js";

/** Options for building a bridge. */
export interface BridgeOptions {
  /** Root for all on-disk state. Default: <cwd>/.uxfactory */
  dataDir?: string;
  /** How long POST /edits waits for the matching render before 504. Default 4000ms. */
  editTimeoutMs?: number;
}

const DEFAULT_EDIT_TIMEOUT_MS = 4000;
const DEFAULT_TOLERANCE_PX = 0.5;

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

  return app;
}

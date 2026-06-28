import path from "node:path";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { RenderReport } from "@uxfactory/gate";
import { BridgeStore } from "./store.js";

/** Options for building a bridge. */
export interface BridgeOptions {
  /** Root for all on-disk state. Default: <cwd>/.uxfactory */
  dataDir?: string;
  /** How long POST /edits waits for the matching render before 504. Default 4000ms. */
  editTimeoutMs?: number;
}

const DEFAULT_EDIT_TIMEOUT_MS = 4000;

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

  void editTimeoutMs;
  return app;
}

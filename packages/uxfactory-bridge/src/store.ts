import { mkdir, readFile, writeFile, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { RenderReport, GateResult } from "@uxfactory/gate";

/** Reject ids that could escape dataDir via path traversal. Only safe chars allowed. */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

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
 * Opaque relayed payload from `uxfactory review --annotate`.
 * The bridge does NOT import @uxfactory/cli — this is a local structural type.
 */
export interface ReviewReportPayload {
  conformant: boolean;
  findings: unknown[];
  [k: string]: unknown;
}

/**
 * Opaque canvas review request posted by the plugin (§14.2).
 * The bridge does NOT import @uxfactory/cli — treat payload as opaque.
 */
export interface CanvasRequest {
  snapshot: { source: string; frames: unknown[]; [k: string]: unknown };
  screenshot?: string;
  [k: string]: unknown;
}

/**
 * One queued pipeline request relayed from the plugin to the worker (Phase 11B).
 * `payload` is OPAQUE — the bridge never imports @uxfactory/cli nor inspects it.
 */
export interface PipelineRequest {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: number;
  /** Resolved project root this job is scoped to (spec §2: workers claim only matching roots). */
  root: string;
}

/** A worker-posted result for a pipeline request. `result` is opaque. */
export interface PipelineResult {
  id: string;
  status: number;
  result: unknown;
}

/** A relayed pipeline event (a worker AgentChunk). `event` is opaque; `seq` is monotonic. */
export interface PipelineEvent {
  requestId: string;
  event: unknown;
  seq: number;
}

/** How many recent pipeline events the in-memory ring retains for SSE replay. */
const PIPELINE_EVENT_RING = 1000;

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
  private readonly failedDir: string;
  private readonly discardedDir: string;
  private readonly rendersDir: string;
  private readonly verifyDir: string;
  private readonly batchDir: string;
  private readonly reviewDir: string;
  private readonly canvasDir: string;
  private readonly selectionFile: string;
  private counter = 0;
  private latestRenderId: string | null = null;
  private _pluginSeen = false;

  // --- pipeline relay (Phase 11B): a live broker, kept in memory ---
  // The pipeline is a transient plugin↔worker channel (no restart-survival is
  // required, unlike the file-backed edit queue), so the queue, result store and
  // event ring all live in memory. Payloads stay opaque.
  private readonly pipelineQueue: PipelineRequest[] = [];
  private readonly pipelineResults = new Map<string, PipelineResult>();
  /** id → project root, retained past dequeue so a result's writes resolve their target. */
  private readonly pipelineRequestRoots = new Map<string, string>();
  private readonly pipelineEvents: PipelineEvent[] = [];
  private pipelineSeq = 0;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.queueDir = path.join(dataDir, "queue");
    this.processedDir = path.join(this.queueDir, "processed");
    this.failedDir = path.join(this.queueDir, "failed");
    this.discardedDir = path.join(this.queueDir, "discarded");
    this.rendersDir = path.join(dataDir, "renders");
    this.verifyDir = path.join(this.rendersDir, "verify");
    this.batchDir = path.join(dataDir, "batch");
    this.reviewDir = path.join(dataDir, "review");
    this.canvasDir = path.join(dataDir, "canvas");
    this.selectionFile = path.join(dataDir, "selection.json");
  }

  /** Create every subdirectory (idempotent — recursive mkdir makes parents too). */
  async init(): Promise<void> {
    await mkdir(this.processedDir, { recursive: true });
    await mkdir(this.failedDir, { recursive: true });
    await mkdir(this.discardedDir, { recursive: true });
    await mkdir(this.verifyDir, { recursive: true });
    await mkdir(this.batchDir, { recursive: true });
    await mkdir(this.reviewDir, { recursive: true });
    await mkdir(this.canvasDir, { recursive: true });
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

  // `createdAt` is supplied by the server (Date.now() lives there, not the store).
  private newPipelineRequestId(createdAt: number): string {
    return `pr_${createdAt}_${this.nextCount()}`;
  }

  // --- queue ---

  /** Write the raw spec to `queue/<jobId>.json`; generate a jobId if none given. */
  async enqueue(spec: unknown, jobId?: string): Promise<string> {
    if (jobId !== undefined && !isSafeId(jobId)) {
      throw new Error(`unsafe jobId: ${jobId}`);
    }
    const id = jobId ?? this.newJobId();
    await writeFile(path.join(this.queueDir, `${id}.json`), JSON.stringify(spec, null, 2), "utf8");
    return id;
  }

  /** Count pending queue files (excludes the processed/ subdirectory). */
  async pending(): Promise<number> {
    const entries = await readdir(this.queueDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).length;
  }

  /**
   * Pick the oldest queue file (mtime, tiebreak name), parse it, move it to processed/.
   * Assumes a single sequential consumer (the polling plugin) — concurrent callers could race,
   * which is out of scope for the localhost single-plugin model.
   * Malformed files are quarantined to failed/ and skipped so they never block the queue.
   */
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
    for (const { name } of ranked) {
      const jobId = name.replace(/\.json$/, "");
      const src = path.join(this.queueDir, name);
      let spec: unknown;
      try {
        const raw = await readFile(src, "utf8");
        spec = JSON.parse(raw) as unknown;
      } catch {
        // Malformed or unreadable — quarantine so it never blocks the queue.
        await rename(src, path.join(this.failedDir, `${jobId}-${this.stamp()}.json`));
        continue;
      }
      await rename(src, path.join(this.processedDir, `${jobId}-${this.stamp()}.json`));
      return { jobId, spec };
    }
    return null;
  }

  /**
   * Non-destructive queue listing, oldest first — the approval UI renders this.
   * Malformed files are skipped here (dequeueNext owns quarantining them).
   */
  async listQueue(): Promise<Array<{ jobId: string; spec: unknown; mtimeMs: number }>> {
    const entries = await readdir(this.queueDir, { withFileTypes: true });
    const names = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
    const out: Array<{ jobId: string; spec: unknown; mtimeMs: number }> = [];
    for (const name of names) {
      const p = path.join(this.queueDir, name);
      try {
        const raw = await readFile(p, "utf8");
        out.push({
          jobId: name.replace(/\.json$/, ""),
          spec: JSON.parse(raw) as unknown,
          mtimeMs: (await stat(p)).mtimeMs,
        });
      } catch {
        // Unreadable/malformed — leave for dequeueNext's quarantine path.
      }
    }
    out.sort((a, b) => a.mtimeMs - b.mtimeMs || a.jobId.localeCompare(b.jobId));
    return out;
  }

  /** Dequeue a SPECIFIC job (approval flow): parse it, move it to processed/. */
  async dequeueById(jobId: string): Promise<{ jobId: string; spec: unknown } | null> {
    if (!isSafeId(jobId)) return null;
    const src = path.join(this.queueDir, `${jobId}.json`);
    let spec: unknown;
    try {
      spec = JSON.parse(await readFile(src, "utf8")) as unknown;
    } catch {
      return null;
    }
    await rename(src, path.join(this.processedDir, `${jobId}-${this.stamp()}.json`));
    return { jobId, spec };
  }

  /** Discard a job without rendering (approval flow reject). False when absent. */
  async discardById(jobId: string): Promise<boolean> {
    if (!isSafeId(jobId)) return false;
    const src = path.join(this.queueDir, `${jobId}.json`);
    try {
      await rename(src, path.join(this.discardedDir, `${jobId}-${this.stamp()}.json`));
      return true;
    } catch {
      return false;
    }
  }

  // --- render reports ---

  /** Persist a report; assign a renderId if missing/empty/unsafe. Tracks the latest in memory. */
  async saveReport(report: RenderReport): Promise<RenderReport> {
    const renderId =
      report.renderId && report.renderId.length > 0 && isSafeId(report.renderId)
        ? report.renderId
        : this.newRenderId();
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
    if (renderId !== undefined && !isSafeId(renderId)) return null;
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

  // --- review report relay ---

  /** Persist the latest review report to <reviewDir>/latest.json (atomic overwrite). */
  async saveReviewReport(report: ReviewReportPayload): Promise<ReviewReportPayload> {
    await writeFile(
      path.join(this.reviewDir, "latest.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
    return report;
  }

  /** Read the latest review report, or null if none has been stored. */
  async getReviewReport(): Promise<ReviewReportPayload | null> {
    try {
      const raw = await readFile(path.join(this.reviewDir, "latest.json"), "utf8");
      return JSON.parse(raw) as ReviewReportPayload;
    } catch {
      return null;
    }
  }

  // --- canvas request relay (§14.2) ---

  /** Persist the latest canvas review request to <canvasDir>/latest.json (atomic overwrite). */
  async saveCanvasRequest(r: CanvasRequest): Promise<CanvasRequest> {
    await writeFile(path.join(this.canvasDir, "latest.json"), JSON.stringify(r, null, 2), "utf8");
    return r;
  }

  /** Read the latest canvas review request, or null if none has been stored. */
  async getCanvasRequest(): Promise<CanvasRequest | null> {
    try {
      const raw = await readFile(path.join(this.canvasDir, "latest.json"), "utf8");
      return JSON.parse(raw) as CanvasRequest;
    } catch {
      return null;
    }
  }

  // --- verify results (keep newest 50) ---

  async saveVerify(result: GateResult & { verifyId: string }): Promise<void> {
    if (!isSafeId(result.verifyId)) throw new Error(`unsafe verifyId`);
    await writeFile(
      path.join(this.verifyDir, `${result.verifyId}.json`),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    await this.pruneVerify(50);
  }

  async getVerify(verifyId: string): Promise<(GateResult & { verifyId: string }) | null> {
    if (!isSafeId(verifyId)) return null;
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
    if (batchId !== undefined && !isSafeId(batchId)) return null;
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

  async approveBatch(batchId: string, approvedItemIds: string[]): Promise<Batch | null> {
    if (!isSafeId(batchId)) return null;
    const batch = await this.getBatch(batchId);
    if (batch === null) return null;
    // Idempotent: if already approved, return the persisted batch without re-enqueuing.
    if (batch.status === "approved") return batch;
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

  // --- pipeline relay (Phase 11B) ---

  /** Append a request to the FIFO pipeline queue; the store assigns the id. */
  async enqueuePipelineRequest(
    kind: string,
    payload: unknown,
    createdAt: number,
    root: string,
  ): Promise<PipelineRequest> {
    const request: PipelineRequest = {
      id: this.newPipelineRequestId(createdAt),
      kind,
      payload,
      createdAt,
      root,
    };
    this.pipelineQueue.push(request);
    this.pipelineRequestRoots.set(request.id, root);
    return request;
  }

  /** The project root a pipeline request was scoped to (null once forgotten). */
  rootForRequest(id: string): string | null {
    return this.pipelineRequestRoots.get(id) ?? null;
  }

  /**
   * Pop the oldest queued request whose root matches (and, when `allowedKinds`
   * is given, whose kind is in that set). The kind filter lets a typed worker
   * pool claim only its kinds — a producer pool takes `generate-artifact`, the
   * design worker takes `generate-design` — so they never steal each other's
   * work. null when none match. Atomic (sync find+splice, no await between).
   */
  async dequeuePipelineRequest(
    root: string,
    allowedKinds?: readonly string[],
  ): Promise<PipelineRequest | null> {
    const idx = this.pipelineQueue.findIndex(
      (r) => r.root === root && (allowedKinds === undefined || allowedKinds.includes(r.kind)),
    );
    if (idx === -1) return null;
    const [request] = this.pipelineQueue.splice(idx, 1);
    return request ?? null;
  }

  /** Store the worker's result for a request id (latest write wins). */
  async savePipelineResult(id: string, status: number, result: unknown): Promise<PipelineResult> {
    const stored: PipelineResult = { id, status, result };
    this.pipelineResults.set(id, stored);
    this.pipelineRequestRoots.delete(id);
    return stored;
  }

  /** Read a stored result by id, or null if the worker has not posted one yet. */
  async getPipelineResult(id: string): Promise<PipelineResult | null> {
    return this.pipelineResults.get(id) ?? null;
  }

  /** Append an event to the in-memory ring, assigning the next monotonic seq. */
  appendPipelineEvent(requestId: string, event: unknown): PipelineEvent {
    this.pipelineSeq += 1;
    const pe: PipelineEvent = { requestId, event, seq: this.pipelineSeq };
    this.pipelineEvents.push(pe);
    if (this.pipelineEvents.length > PIPELINE_EVENT_RING) {
      this.pipelineEvents.splice(0, this.pipelineEvents.length - PIPELINE_EVENT_RING);
    }
    return pe;
  }

  /** Events with `seq > afterSeq`, in order — used to replay an SSE reconnect. */
  recentPipelineEvents(afterSeq: number): PipelineEvent[] {
    return this.pipelineEvents.filter((e) => e.seq > afterSeq);
  }
}

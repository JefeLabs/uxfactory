import { mkdir, readFile, writeFile, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { RenderReport, GateResult } from "@uxfactory/gate";

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
 * File-backed persistence for the bridge. Everything lives under `dataDir`
 * (PRD §19/NF2: nothing is ever written outside it). All ids are generated
 * from a clock plus an internal monotonic counter so concurrent calls in the
 * same millisecond never collide. A restart re-reads the queue from disk.
 */
export class BridgeStore {
  readonly dataDir: string;
  private readonly queueDir: string;
  private readonly processedDir: string;
  private readonly rendersDir: string;
  private readonly verifyDir: string;
  private readonly batchDir: string;
  private readonly selectionFile: string;
  private counter = 0;
  private latestRenderId: string | null = null;
  private _pluginSeen = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.queueDir = path.join(dataDir, "queue");
    this.processedDir = path.join(this.queueDir, "processed");
    this.rendersDir = path.join(dataDir, "renders");
    this.verifyDir = path.join(this.rendersDir, "verify");
    this.batchDir = path.join(dataDir, "batch");
    this.selectionFile = path.join(dataDir, "selection.json");
  }

  /** Create every subdirectory (idempotent — recursive mkdir makes parents too). */
  async init(): Promise<void> {
    await mkdir(this.processedDir, { recursive: true });
    await mkdir(this.verifyDir, { recursive: true });
    await mkdir(this.batchDir, { recursive: true });
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

  // --- queue ---

  /** Write the raw spec to `queue/<jobId>.json`; generate a jobId if none given. */
  async enqueue(spec: unknown, jobId?: string): Promise<string> {
    const id = jobId ?? this.newJobId();
    await writeFile(path.join(this.queueDir, `${id}.json`), JSON.stringify(spec, null, 2), "utf8");
    return id;
  }

  /** Count pending queue files (excludes the processed/ subdirectory). */
  async pending(): Promise<number> {
    const entries = await readdir(this.queueDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).length;
  }

  /** Pick the oldest queue file (mtime, tiebreak name), parse it, move it to processed/. */
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
    const chosen = ranked[0]!.name;
    const jobId = chosen.replace(/\.json$/, "");
    const raw = await readFile(path.join(this.queueDir, chosen), "utf8");
    const spec = JSON.parse(raw) as unknown;
    await rename(
      path.join(this.queueDir, chosen),
      path.join(this.processedDir, `${jobId}-${this.stamp()}.json`),
    );
    return { jobId, spec };
  }

  // --- render reports ---

  /** Persist a report; assign a renderId if missing/empty. Tracks the latest in memory. */
  async saveReport(report: RenderReport): Promise<RenderReport> {
    const renderId =
      report.renderId && report.renderId.length > 0 ? report.renderId : this.newRenderId();
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

  // --- verify results (keep newest 50) ---

  async saveVerify(result: GateResult & { verifyId: string }): Promise<void> {
    await writeFile(
      path.join(this.verifyDir, `${result.verifyId}.json`),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    await this.pruneVerify(50);
  }

  async getVerify(verifyId: string): Promise<(GateResult & { verifyId: string }) | null> {
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

  async approveBatch(batchId: string, approvedItemIds: string[]): Promise<Batch> {
    const batch = await this.getBatch(batchId);
    if (batch === null) throw new Error(`unknown batch: ${batchId}`);
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
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BridgeStore } from "../src/store.js";
import type { RenderReport, GateResult } from "@uxfactory/gate";

const makeReport = (over: Partial<RenderReport> = {}): RenderReport => ({
  renderId: "",
  editor: "figma",
  page: "p",
  pageKey: "0:1",
  fileName: "F",
  fileKey: "k",
  counts: { frames: 1, sections: 0, objects: 1, connectors: 0 },
  nodes: [{ id: "1:2", name: "box", type: "shape", x: 10, y: 20, w: 30, h: 40 }],
  ...over,
});

const makeResult = (verifyId: string): GateResult & { verifyId: string } => ({
  status: "PASS",
  verifyId,
  renderId: "r_1",
  editor: "figma",
  pageKey: "0:1",
  fileName: "F",
  summary: { checks: 5, passed: 4, failed: 0, skipped: 1 },
  checks: [],
  failures: [],
});

let root: string;
let dataDir: string;
let store: BridgeStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-bridge-"));
  dataDir = path.join(root, ".uxfactory");
  store = new BridgeStore(dataDir);
  await store.init();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("queue", () => {
  it("enqueue generates a jobId when none is given", async () => {
    const id = await store.enqueue({ x: 1 });
    expect(id).toMatch(/^job_/);
    expect(await store.pending()).toBe(1);
  });

  it("returns null from dequeueNext when the queue is empty", async () => {
    expect(await store.dequeueNext()).toBeNull();
  });

  it("dequeues oldest-first by mtime (tiebreak by name) and moves to processed/", async () => {
    await store.enqueue({ k: "c" }, "job_c");
    await store.enqueue({ k: "b" }, "job_b");
    await store.enqueue({ k: "a" }, "job_a");
    const q = (n: string) => path.join(dataDir, "queue", `${n}.json`);
    await utimes(q("job_a"), new Date(1000), new Date(1000));
    await utimes(q("job_b"), new Date(2000), new Date(2000));
    await utimes(q("job_c"), new Date(3000), new Date(3000));
    expect(await store.pending()).toBe(3);
    const first = await store.dequeueNext();
    expect(first?.jobId).toBe("job_a");
    expect(first?.spec).toEqual({ k: "a" });
    const second = await store.dequeueNext();
    expect(second?.jobId).toBe("job_b");
    expect(await store.pending()).toBe(1);
    const processed = await readdir(path.join(dataDir, "queue", "processed"));
    expect(processed.some((n) => n.startsWith("job_a-"))).toBe(true);
  });

  it("survives a restart (queue is files on disk)", async () => {
    await store.enqueue({ a: 1 }, "job_1");
    await store.enqueue({ b: 2 }, "job_2");
    const reopened = new BridgeStore(dataDir);
    await reopened.init();
    expect(await reopened.pending()).toBe(2);
    expect(await reopened.dequeueNext()).not.toBeNull();
  });
});

describe("reports", () => {
  it("saves a report, assigning a renderId, and reads it back by id and as latest", async () => {
    const stored = await store.saveReport(makeReport());
    expect(stored.renderId).toMatch(/^r_/);
    expect((await store.getReport(stored.renderId))?.renderId).toBe(stored.renderId);
    expect((await store.getReport())?.renderId).toBe(stored.renderId);
    expect(await store.hasAnyReport()).toBe(true);
  });

  it("keeps an explicit renderId", async () => {
    const stored = await store.saveReport(makeReport({ renderId: "r_explicit" }));
    expect(stored.renderId).toBe("r_explicit");
    expect((await store.getReport("r_explicit"))?.fileName).toBe("F");
  });

  it("returns null for a missing report and reads latest on a cold start", async () => {
    expect(await store.getReport()).toBeNull();
    expect(await store.hasAnyReport()).toBe(false);
    await store.saveReport(makeReport({ renderId: "r_cold" }));
    const reopened = new BridgeStore(dataDir);
    await reopened.init();
    expect((await reopened.getReport())?.renderId).toBe("r_cold");
  });
});

describe("selection", () => {
  it("stores and returns the latest selection", async () => {
    expect(await store.getSelection()).toBeNull();
    await store.saveSelection({ ids: ["1:2"] });
    expect(await store.getSelection()).toEqual({ ids: ["1:2"] });
  });
});

describe("verify", () => {
  it("saves and reads a verify result", async () => {
    await store.saveVerify(makeResult("v_1"));
    expect((await store.getVerify("v_1"))?.status).toBe("PASS");
    expect(await store.getVerify("nope")).toBeNull();
  });

  it("prunes verify results to the newest 50", async () => {
    for (let i = 0; i < 51; i++) {
      const id = `v_${String(i).padStart(2, "0")}`;
      await store.saveVerify(makeResult(id));
      await utimes(
        path.join(dataDir, "renders", "verify", `${id}.json`),
        new Date(1000 * (i + 1)),
        new Date(1000 * (i + 1)),
      );
    }
    const files = await readdir(path.join(dataDir, "renders", "verify"));
    expect(files.length).toBe(50);
    expect(await store.getVerify("v_00")).toBeNull();
    expect(await store.getVerify("v_50")).not.toBeNull();
  });
});

describe("batch", () => {
  it("approves a batch, enqueuing the approved specs", async () => {
    const batchId = await store.saveBatch({
      items: [
        { spec: { edits: [{ id: "1", set: { x: 1 } }] } },
        { spec: { edits: [{ id: "2", set: { y: 2 } }] } },
      ],
    });
    const batch = await store.getBatch(batchId);
    expect(batch?.items).toHaveLength(2);
    expect(batch?.status).toBe("pending");
    const firstItemId = batch!.items[0]!.itemId;
    expect(await store.pending()).toBe(0);
    const updated = await store.approveBatch(batchId, [firstItemId]);
    expect(updated.status).toBe("approved");
    expect(updated.items[0]?.status).toBe("approved");
    expect(updated.items[1]?.status).toBe("rejected");
    expect(await store.pending()).toBe(1);
  });

  it("getBatch() returns the latest pending batch, null when none/unknown", async () => {
    expect(await store.getBatch()).toBeNull();
    await store.saveBatch({ items: [{ spec: { edits: [{ id: "1", set: { x: 1 } }] } }] });
    expect((await store.getBatch())?.status).toBe("pending");
    expect(await store.getBatch("missing")).toBeNull();
  });
});

describe("connection state & isolation", () => {
  it("tracks pluginSeen", () => {
    expect(store.pluginSeen).toBe(false);
    store.markPluginSeen();
    expect(store.pluginSeen).toBe(true);
  });

  it("never writes outside dataDir", async () => {
    await store.enqueue({ a: 1 }, "job_1");
    await store.dequeueNext();
    await store.saveReport(makeReport());
    await store.saveVerify(makeResult("v_1"));
    await store.saveSelection({ ids: ["1:2"] });
    const batchId = await store.saveBatch({
      items: [{ spec: { edits: [{ id: "1", set: { x: 1 } }] } }],
    });
    const b = await store.getBatch(batchId);
    await store.approveBatch(batchId, [b!.items[0]!.itemId]);
    expect((await readdir(root)).sort()).toEqual([".uxfactory"]);
  });
});

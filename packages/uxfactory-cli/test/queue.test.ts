import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import { writeQueueFile } from "../src/queue.js";

let root: string;
let dataDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-cli-"));
  dataDir = path.join(root, ".uxfactory");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("writeQueueFile", () => {
  it("writes the raw spec JSON to queue/<jobId>.json and returns a charset-valid jobId", async () => {
    const spec = { editor: "figma", frames: [] };
    const jobId = await writeQueueFile(dataDir, spec);
    expect(jobId).toMatch(/^pub_/);
    expect(jobId).toMatch(/^[A-Za-z0-9_-]+$/);
    const onDisk = JSON.parse(await readFile(path.join(dataDir, "queue", `${jobId}.json`), "utf8"));
    expect(onDisk).toEqual(spec);
  });

  it("leaves no temp file behind (atomic rename)", async () => {
    const jobId = await writeQueueFile(dataDir, { a: 1 });
    const files = await readdir(path.join(dataDir, "queue"));
    expect(files).toEqual([`${jobId}.json`]);
  });

  it("uses an explicit jobId when given", async () => {
    const jobId = await writeQueueFile(dataDir, { a: 1 }, "pub_custom_1");
    expect(jobId).toBe("pub_custom_1");
    expect(await readdir(path.join(dataDir, "queue"))).toContain("pub_custom_1.json");
  });

  it("rejects a jobId with path-traversal characters", async () => {
    await expect(writeQueueFile(dataDir, { edits: [] }, "../../evil")).rejects.toThrow(
      /unsafe jobId/,
    );
  });

  it("produces a file the bridge's GET /next serves (queue contract)", async () => {
    const handle = await startBridge({ dataDir, port: 0 });
    try {
      const spec = { editor: "figma", edits: [{ id: "1:2", set: { x: 7 } }] };
      const jobId = await writeQueueFile(dataDir, spec);
      const res = await fetch(`${handle.url}/next`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { jobId: string; spec: unknown };
      expect(body.jobId).toBe(jobId);
      expect(body.spec).toEqual(spec);
    } finally {
      await handle.close();
    }
  });
});

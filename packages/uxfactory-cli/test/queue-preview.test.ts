/**
 * queue-preview.test.ts — publish snapshots the job's batch preview alongside
 * the queue file, so approval UIs show the screenshot of THIS spec even after
 * later runs overwrite the shared previews directory.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeQueueFile } from "../src/queue.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "uxf-queue-prev-"));
});
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const SPEC = {
  editor: "figma",
  frames: [{ name: "screens/home.html/success@desktop", x: 0, y: 0, width: 10, height: 10, children: [] }],
};

describe("writeQueueFile preview snapshot", () => {
  it("copies the matching batch preview to queue/previews/<jobId>.png", async () => {
    const previewDir = path.join(dataDir, "batch", "previews", "desktop");
    await mkdir(previewDir, { recursive: true });
    await writeFile(path.join(previewDir, "home-success.png"), "PNGBYTES");

    const jobId = await writeQueueFile(dataDir, SPEC);

    const snapshot = await readFile(path.join(dataDir, "queue", "previews", `${jobId}.png`), "utf8");
    expect(snapshot).toBe("PNGBYTES");
  });

  it("enqueues cleanly when no preview matches (snapshot is best-effort)", async () => {
    const jobId = await writeQueueFile(dataDir, SPEC);
    expect(jobId).toMatch(/^pub_/);
    const queued = await readdir(path.join(dataDir, "queue"));
    expect(queued).toContain(`${jobId}.json`);
  });
});

describe("writeQueueFile provenance snapshot", () => {
  it("snapshots the report's ungoverned flag + storyRefs to queue/meta/<jobId>.json", async () => {
    await mkdir(path.join(dataDir, "batch"), { recursive: true });
    await writeFile(
      path.join(dataDir, "batch", "report.json"),
      JSON.stringify({ clean: true, ungoverned: true, storyRefs: ["browse-faq"] }),
    );
    const jobId = await writeQueueFile(dataDir, SPEC);
    const meta = JSON.parse(
      await readFile(path.join(dataDir, "queue", "meta", `${jobId}.json`), "utf8"),
    ) as Record<string, unknown>;
    expect(meta).toEqual({ ungoverned: true, storyRefs: ["browse-faq"] });
  });

  it("writes no meta for a governed run without a story contract", async () => {
    await mkdir(path.join(dataDir, "batch"), { recursive: true });
    await writeFile(path.join(dataDir, "batch", "report.json"), JSON.stringify({ clean: true }));
    const jobId = await writeQueueFile(dataDir, SPEC);
    await expect(
      readFile(path.join(dataDir, "queue", "meta", `${jobId}.json`), "utf8"),
    ).rejects.toThrow();
  });

  it("enqueues cleanly with no report at all (provenance is best-effort)", async () => {
    const jobId = await writeQueueFile(dataDir, SPEC);
    expect(jobId).toMatch(/^pub_/);
  });
});

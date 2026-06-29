/**
 * Tests for Fix C1 — `uxfactory canvas fetch` and `uxfactory canvas post`.
 *
 * Tests use an in-process bridge (startBridge({ port: 0 })) so no real HTTP
 * port needs to be specified; BridgeClient sends requests to the bridge URL.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import { BridgeClient } from "../src/client.js";
import { EXIT } from "../src/exit.js";
import { canvasFetchCmd, canvasPostCmd } from "../src/commands/canvas.js";
import { makeIO } from "./helpers.js";

// ---------------------------------------------------------------------------
// A minimal valid canvas request (matches what the plugin POSTs to /canvas).
// ---------------------------------------------------------------------------

/** Raw PNG bytes for a 1×1 solid red pixel (minimal valid PNG). */
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009001" +
    "2e00000000c4944415478016360f8cfc000000200016a3fd0d0000000049454e44ae426082",
  "hex",
);

const validSnapshot = {
  source: "canvas-inferred",
  frames: [
    {
      name: "HomeScreen",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        {
          type: "shape",
          name: "story-1-empty-state",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Lifecycle helpers
// ---------------------------------------------------------------------------

let root: string;
let bridgeHandle: { url: string; close: () => Promise<void> };
let client: BridgeClient;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-canvas-cmd-"));
  bridgeHandle = await startBridge({ port: 0, dataDir: path.join(root, ".uxfactory") });
  client = new BridgeClient(bridgeHandle.url);
});

afterEach(async () => {
  await bridgeHandle.close();
  await rm(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// canvas fetch — exit 2 when no pending request
// ---------------------------------------------------------------------------

describe("canvasFetchCmd — no pending request → exit 2", () => {
  it("exits 2 (TRANSPORT) when bridge has no canvas request", async () => {
    const io = makeIO();
    const code = await canvasFetchCmd({ out: root }, io, client);
    expect(code).toBe(EXIT.TRANSPORT);
  });

  it("prints a clear message when no pending request", async () => {
    const io = makeIO();
    await canvasFetchCmd({ out: root }, io, client);
    expect(io.outText()).toMatch(/no pending canvas review request/i);
  });
});

// ---------------------------------------------------------------------------
// canvas fetch — writes snapshot.json + screenshot.png from a live bridge
// ---------------------------------------------------------------------------

describe("canvasFetchCmd — with pending request", () => {
  beforeEach(async () => {
    // POST a canvas request to the bridge before each test in this suite.
    await fetch(`${bridgeHandle.url}/canvas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        snapshot: validSnapshot,
        screenshot: Array.from(TINY_PNG),
      }),
    });
  });

  it("exits 0 when a canvas request is pending", async () => {
    const io = makeIO();
    const code = await canvasFetchCmd({ out: root }, io, client);
    expect(code).toBe(EXIT.OK);
  });

  it("writes snapshot.json to the output dir", async () => {
    const io = makeIO();
    await canvasFetchCmd({ out: root }, io, client);
    const snapshotPath = path.join(root, "snapshot.json");
    expect(existsSync(snapshotPath)).toBe(true);
    const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as Record<string, unknown>;
    expect(parsed["source"]).toBe("canvas-inferred");
    expect(Array.isArray(parsed["frames"])).toBe(true);
  });

  it("writes screenshot.png to the output dir (decoded from number[] bytes)", async () => {
    const io = makeIO();
    await canvasFetchCmd({ out: root }, io, client);
    const screenshotPath = path.join(root, "screenshot.png");
    expect(existsSync(screenshotPath)).toBe(true);
    const contents = await readFile(screenshotPath);
    // A real PNG starts with the PNG magic bytes: 0x89 0x50 0x4E 0x47
    expect(contents[0]).toBe(0x89);
    expect(contents[1]).toBe(0x50);
    expect(contents[2]).toBe(0x4e);
    expect(contents[3]).toBe(0x47);
  });

  it("also handles a base64 string screenshot (test fixture format)", async () => {
    // Second POST overwrites with a base64-encoded screenshot.
    const b64 = TINY_PNG.toString("base64");
    await fetch(`${bridgeHandle.url}/canvas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot: validSnapshot, screenshot: b64 }),
    });

    const io = makeIO();
    const outDir = path.join(root, "b64out");
    const code = await canvasFetchCmd({ out: outDir }, io, client);
    expect(code).toBe(EXIT.OK);

    const screenshotPath = path.join(outDir, "screenshot.png");
    expect(existsSync(screenshotPath)).toBe(true);
    const contents = await readFile(screenshotPath);
    expect(contents[0]).toBe(0x89); // PNG magic
  });

  it("snapshot.json is the CanvasSnapshot (not the full request envelope)", async () => {
    const io = makeIO();
    await canvasFetchCmd({ out: root }, io, client);
    const parsed = JSON.parse(await readFile(path.join(root, "snapshot.json"), "utf8")) as Record<
      string,
      unknown
    >;
    // Should be the snapshot object itself, not { snapshot: ..., screenshot: ... }
    expect(parsed).toHaveProperty("source", "canvas-inferred");
    expect(parsed).toHaveProperty("frames");
    expect(parsed).not.toHaveProperty("screenshot");
  });
});

// ---------------------------------------------------------------------------
// canvas post — posts the file's report to the bridge
// ---------------------------------------------------------------------------

const validReport = {
  conformant: true,
  reliability: "best-effort",
  findings: [
    {
      status: "unmet",
      requirement: "story-1",
      detail: "Vision inferred: no loading spinner visible on canvas",
    },
  ],
  skipped: [],
  advisory: "Best-effort review — canvas-inferred snapshot.",
};

describe("canvasPostCmd — success path", () => {
  it("exits 0 when the report is valid and bridge accepts it", async () => {
    const reportFile = path.join(root, "review-report.json");
    await writeFile(reportFile, JSON.stringify(validReport), "utf8");

    const io = makeIO();
    const code = await canvasPostCmd(reportFile, io, client);
    expect(code).toBe(EXIT.OK);
  });

  it("the bridge returns the POSTED report from GET /review", async () => {
    const reportFile = path.join(root, "review-report.json");
    await writeFile(reportFile, JSON.stringify(validReport), "utf8");

    const io = makeIO();
    await canvasPostCmd(reportFile, io, client);

    // The bridge should relay the report via GET /review.
    const res = await fetch(`${bridgeHandle.url}/review`);
    expect(res.status).toBe(200);
    const posted = (await res.json()) as typeof validReport;
    expect(posted.conformant).toBe(true);
    expect(posted.reliability).toBe("best-effort");
    // Assert vision finding is present (not just the baseline).
    const visionFinding = posted.findings.find(
      (f) => f.detail === "Vision inferred: no loading spinner visible on canvas",
    );
    expect(visionFinding).toBeDefined();
    expect(visionFinding?.requirement).toBe("story-1");
    expect(visionFinding?.status).toBe("unmet");
  });

  it("prints a confirmation message on success", async () => {
    const reportFile = path.join(root, "review-report.json");
    await writeFile(reportFile, JSON.stringify(validReport), "utf8");

    const io = makeIO();
    await canvasPostCmd(reportFile, io, client);
    expect(io.outText()).toMatch(/posted to bridge/i);
  });
});

describe("canvasPostCmd — error paths", () => {
  it("exits 2 when the report file does not exist", async () => {
    const io = makeIO();
    const code = await canvasPostCmd(path.join(root, "no-such-file.json"), io, client);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/cannot read report file/i);
  });

  it("exits 2 when the file is not valid JSON", async () => {
    const reportFile = path.join(root, "bad.json");
    await writeFile(reportFile, "{ not valid json }", "utf8");
    const io = makeIO();
    const code = await canvasPostCmd(reportFile, io, client);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/not valid JSON/i);
  });

  it("exits 2 when the file is valid JSON but missing conformant", async () => {
    const reportFile = path.join(root, "bad-shape.json");
    await writeFile(reportFile, JSON.stringify({ findings: [] }), "utf8");
    const io = makeIO();
    const code = await canvasPostCmd(reportFile, io, client);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/conformant/i);
  });

  it("exits 2 when findings is not an array", async () => {
    const reportFile = path.join(root, "bad-findings.json");
    await writeFile(reportFile, JSON.stringify({ conformant: true, findings: "oops" }), "utf8");
    const io = makeIO();
    const code = await canvasPostCmd(reportFile, io, client);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/findings/i);
  });

  it("exits 2 when bridge is unreachable", async () => {
    const deadClient = new BridgeClient("http://127.0.0.1:19998");
    const reportFile = path.join(root, "review-report.json");
    await writeFile(reportFile, JSON.stringify(validReport), "utf8");
    const io = makeIO();
    const code = await canvasPostCmd(reportFile, io, deadClient);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/bridge/i);
  });
});

// ---------------------------------------------------------------------------
// canvas fetch + post — end-to-end via the real CLI run()
// ---------------------------------------------------------------------------

describe("canvas fetch + post — CLI integration via run()", () => {
  it("run(['canvas', 'fetch', '--bridge', url]) exits 2 when no request pending", async () => {
    const { run } = await import("../src/cli.js");
    const code = await run([
      "node",
      "uxfactory",
      "canvas",
      "fetch",
      "--bridge",
      bridgeHandle.url,
      "--out",
      root,
    ]);
    expect(code).toBe(EXIT.TRANSPORT);
  });

  it("run(['canvas', 'post', file, '--bridge', url]) exits 0 on a valid report", async () => {
    const reportFile = path.join(root, "report.json");
    await writeFile(reportFile, JSON.stringify(validReport), "utf8");

    const { run } = await import("../src/cli.js");
    const code = await run([
      "node",
      "uxfactory",
      "canvas",
      "post",
      reportFile,
      "--bridge",
      bridgeHandle.url,
    ]);
    expect(code).toBe(EXIT.OK);
  });
});

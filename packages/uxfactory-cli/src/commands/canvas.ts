import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { EXIT, TransportError } from "../exit.js";
import type { IO } from "../io.js";
import type { BridgeClient } from "../client.js";

// ---------------------------------------------------------------------------
// canvas fetch
// ---------------------------------------------------------------------------

/** Flags for `uxfactory canvas fetch`. */
export interface CanvasFetchFlags {
  /** Directory to write snapshot.json + screenshot.png (default: cwd). */
  out?: string;
}

/**
 * `uxfactory canvas fetch [--out <dir>]`
 *
 * Pulls the pending canvas review request from the bridge (GET /canvas) and writes:
 *   - snapshot.json  — the CanvasSnapshot (pass to `uxfactory review snapshot.json`)
 *   - screenshot.png — the PNG file decoded from the bridge payload
 *
 * The screenshot field from the plugin is a number[] (raw PNG bytes). Some test
 * fixtures send a base64 string or a data-URL; both are handled.
 *
 * Exit codes:
 *   0 — request fetched and both files written
 *   2 — no pending request (bridge returned 404), transport error, or missing snapshot
 */
export async function canvasFetchCmd(
  flags: CanvasFetchFlags,
  io: IO,
  client: BridgeClient,
): Promise<number> {
  const outDir = flags.out !== undefined ? path.resolve(flags.out) : path.resolve(process.cwd());

  let req: Awaited<ReturnType<BridgeClient["getCanvasRequest"]>>;
  try {
    req = await client.getCanvasRequest();
  } catch (err) {
    if (err instanceof TransportError) {
      io.err(`canvas fetch: bridge unreachable — ${err.message}`);
      return EXIT.TRANSPORT;
    }
    throw err;
  }

  if (req === null) {
    io.out(
      "canvas fetch: no pending canvas review request (bridge returned 404). " +
        "Select a frame in Figma and click «Review selection».",
    );
    return EXIT.TRANSPORT;
  }

  await mkdir(outDir, { recursive: true });

  // Write snapshot.json (the CanvasSnapshot object, for `uxfactory review`).
  const snapshotPath = path.join(outDir, "snapshot.json");
  await writeFile(snapshotPath, JSON.stringify(req.snapshot, null, 2), "utf8");
  io.out(`canvas fetch: wrote ${snapshotPath}`);

  // Decode and write screenshot.png.
  // The plugin sends screenshot as number[] (raw PNG bytes via Array.from(Uint8Array)).
  // Some test data may use a base64 string or a data-URL (data:image/png;base64,...).
  const screenshotPath = path.join(outDir, "screenshot.png");
  const raw = (req as Record<string, unknown>)["screenshot"];
  if (Array.isArray(raw)) {
    // number[] path: the plugin's exportAsync bytes come through as-is.
    await writeFile(screenshotPath, Buffer.from(raw as number[]));
    io.out(`canvas fetch: wrote ${screenshotPath}`);
  } else if (typeof raw === "string" && raw.length > 0) {
    // base64 or data-URL path (e.g. test fixtures).
    const b64 = raw.replace(/^data:[^;]+;base64,/, "");
    await writeFile(screenshotPath, Buffer.from(b64, "base64"));
    io.out(`canvas fetch: wrote ${screenshotPath}`);
  } else {
    io.out(`canvas fetch: no screenshot in request — ${screenshotPath} not written`);
  }

  return EXIT.OK;
}

// ---------------------------------------------------------------------------
// canvas post
// ---------------------------------------------------------------------------

/**
 * `uxfactory canvas post <report.json>`
 *
 * Reads a ReviewReport JSON file (produced by `uxfactory review --json`) and
 * posts it to the bridge POST /review endpoint so the plugin can annotate the
 * canvas (Phase 9).
 *
 * Validation: the file must be valid JSON with `conformant` (boolean) and
 * `findings` (array). Any structural mismatch → exit 2 with a clear message.
 *
 * Exit codes:
 *   0 — report accepted by the bridge
 *   2 — file unreadable, invalid JSON, missing required fields, or bridge error
 */
export async function canvasPostCmd(
  reportFile: string,
  io: IO,
  client: BridgeClient,
): Promise<number> {
  // Read the file.
  let rawText: string;
  try {
    rawText = await readFile(reportFile, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.err(`canvas post: cannot read report file: ${msg}`);
    return EXIT.TRANSPORT;
  }

  // Parse JSON.
  let report: unknown;
  try {
    report = JSON.parse(rawText) as unknown;
  } catch {
    io.err(`canvas post: ${reportFile} is not valid JSON`);
    return EXIT.TRANSPORT;
  }

  // Validate required shape: conformant (boolean) + findings (array).
  if (
    typeof report !== "object" ||
    report === null ||
    typeof (report as Record<string, unknown>)["conformant"] !== "boolean" ||
    !Array.isArray((report as Record<string, unknown>)["findings"])
  ) {
    io.err(
      "canvas post: report must have `conformant` (boolean) and `findings` (array). " +
        "Run `uxfactory review <design> --json > report.json` to produce a valid report.",
    );
    return EXIT.TRANSPORT;
  }

  // Post to bridge.
  try {
    await client.postReview(report);
  } catch (err) {
    if (err instanceof TransportError) {
      io.err(`canvas post: bridge rejected the report — ${err.message}`);
      return EXIT.TRANSPORT;
    }
    throw err;
  }

  io.out("canvas post: review report posted to bridge — the plugin will annotate the canvas");
  return EXIT.OK;
}

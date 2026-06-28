import path from "node:path";
import { execFileSync } from "node:child_process";
import { EXIT, TransportError } from "../exit.js";
import { loadSpec, printSpecProblem } from "../spec-file.js";
import { writeQueueFile, newJobId } from "../queue.js";
import { reportVerify } from "./verify.js";
import { readMap, writeMap } from "../drift/map-io.js";
import { syncMapFromReport } from "../drift/drift-core.js";
import type { ComponentMap } from "../drift/map-schema.js";
import type { IO } from "../io.js";
import type { BridgeClient } from "../client.js";
import type { RenderReport } from "@uxfactory/bridge";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_POLL_MS = 300;

/** Flags for `publish`. `timeoutMs`/`pollMs` are automation/test overrides (not user CLI flags). */
export interface PublishFlags {
  wait?: boolean;
  verify?: boolean;
  tolerance?: string;
  dryRun?: boolean;
  json?: boolean;
  dataDir: string;
  /** Where uxfactory.map.json lives for auto-fill (default process.cwd()). */
  cwd?: string;
  /** Injectable HEAD-commit lookup for lastSynced.commit (default `git rev-parse HEAD`). */
  gitHead?: () => string | null;
  timeoutMs?: number;
  pollMs?: number;
}

/** `uxfactory publish <spec>` — validate, enqueue, and optionally wait for / verify the render. */
export async function publishCmd(
  file: string,
  flags: PublishFlags,
  io: IO,
  client: BridgeClient,
): Promise<number> {
  if (flags.tolerance !== undefined && Number.isNaN(Number(flags.tolerance))) {
    io.err(`invalid --tolerance: ${flags.tolerance}`);
    return EXIT.TRANSPORT;
  }
  const loaded = await loadSpec(file);
  if (!loaded.ok) return printSpecProblem(io, loaded, flags.json);

  const summary = summarize(loaded.spec);

  if (flags.dryRun) {
    const jobId = newJobId();
    if (flags.json) {
      io.out(JSON.stringify({ dryRun: true, jobId, ...summary }));
    } else {
      io.out(
        `dry-run: would queue ${jobId} ` +
          `(frames=${summary.frames}, sections=${summary.sections}, ` +
          `objects=${summary.objects}, connectors=${summary.connectors}, edits=${summary.edits})`,
      );
    }
    return EXIT.OK;
  }

  const willWait = flags.wait === true || flags.verify === true;

  // Record the current latest renderId BEFORE enqueueing, so a new render is
  // detectable. Only contact the bridge when we intend to wait — the plain fast
  // path writes the queue file and returns without any network call.
  let baselineRenderId: string | null = null;
  if (willWait) {
    try {
      const baseline = await client.getRendered();
      baselineRenderId = baseline?.renderId ?? null;
    } catch (err) {
      if (err instanceof TransportError) {
        io.err(err.message);
        return EXIT.TRANSPORT;
      }
      throw err;
    }
  }

  const jobId = await writeQueueFile(flags.dataDir, loaded.spec);
  io.out(`queued ${jobId}`);

  if (!willWait) return EXIT.OK;

  let report: RenderReport | null;
  try {
    report = await pollForRender(
      client,
      baselineRenderId,
      flags.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      flags.pollMs ?? DEFAULT_POLL_MS,
    );
  } catch (err) {
    if (err instanceof TransportError) {
      io.err(err.message);
      return EXIT.TRANSPORT;
    }
    throw err;
  }

  if (report === null) {
    io.err("render timed out (is the plugin open?)");
    return EXIT.TRANSPORT;
  }

  // Auto-fill the committed map (if any) with the render's figmaId/lastSynced.
  const cwd = flags.cwd ?? process.cwd();
  await autoSyncMap(cwd, report, flags.gitHead ?? defaultGitHead(cwd), io);

  if (flags.verify === true) {
    try {
      const { status, body } = await client.verify({
        spec: loaded.spec,
        renderId: report.renderId,
        tolerance:
          flags.tolerance !== undefined ? { geometryPx: Number(flags.tolerance) } : undefined,
      });
      return reportVerify(io, status, body, flags.json);
    } catch (err) {
      if (err instanceof TransportError) {
        io.err(err.message);
        return EXIT.TRANSPORT;
      }
      throw err;
    }
  }

  // --wait only (no --verify): report the render summary.
  if (flags.json) {
    io.out(JSON.stringify({ rendered: report.renderId, counts: report.counts }));
  } else {
    io.out(
      `rendered ${report.renderId} ` +
        `(frames=${report.counts.frames}, objects=${report.counts.objects}, ` +
        `connectors=${report.counts.connectors})`,
    );
  }
  return EXIT.OK;
}

/** Poll GET /rendered until a report with a renderId different from the baseline appears. */
async function pollForRender(
  client: BridgeClient,
  baselineRenderId: string | null,
  timeoutMs: number,
  pollMs: number,
): Promise<RenderReport | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const report = await client.getRendered();
    if (report !== null && report.renderId !== baselineRenderId) return report;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** Count the spec's top-level structure for the dry-run / wait summaries. */
function summarize(spec: unknown): {
  frames: number;
  sections: number;
  objects: number;
  connectors: number;
  edits: number;
} {
  const s = spec as {
    frames?: unknown[];
    sections?: unknown[];
    connectors?: unknown[];
    edits?: unknown[];
  };
  const frames = Array.isArray(s.frames) ? s.frames : [];
  const sections = Array.isArray(s.sections) ? s.sections : [];
  const countChildren = (containers: unknown[]): number =>
    containers.reduce<number>((sum, c) => {
      const ch = (c as { children?: unknown[] }).children;
      return sum + (Array.isArray(ch) ? ch.length : 0);
    }, 0);
  return {
    frames: frames.length,
    sections: sections.length,
    objects: countChildren(frames) + countChildren(sections),
    connectors: Array.isArray(s.connectors) ? s.connectors.length : 0,
    edits: Array.isArray(s.edits) ? s.edits.length : 0,
  };
}

/** The default HEAD lookup: `git rev-parse HEAD` in `cwd`; null when git fails. */
function defaultGitHead(cwd: string): () => string | null {
  return () => {
    try {
      const out = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const h = out.trim();
      return h.length > 0 ? h : null;
    } catch {
      return null;
    }
  };
}

/**
 * After a successful render, auto-fill figmaId/lastSynced in uxfactory.map.json if it exists.
 * Uses the pure syncMapFromReport, so the maintained fields are never edited. A broken/absent
 * map must never fail an otherwise-successful publish.
 */
async function autoSyncMap(
  cwd: string,
  report: RenderReport,
  gitHead: () => string | null,
  io: IO,
): Promise<void> {
  const mapPath = path.join(cwd, "uxfactory.map.json");
  let map: ComponentMap | null;
  try {
    map = await readMap(mapPath);
  } catch {
    return; // a malformed map should not break a good publish
  }
  if (map === null) return;
  const updated = syncMapFromReport(map, report, gitHead() ?? "");
  await writeMap(mapPath, updated);
  io.out(`map: synced figmaId/lastSynced for ${updated.components.length} component(s)`);
}

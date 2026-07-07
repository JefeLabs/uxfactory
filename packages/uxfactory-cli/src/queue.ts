import { mkdir, writeFile, rename, copyFile, readFile } from "node:fs/promises";
import path from "node:path";

let counter = 0;

/** Generate a queue jobId in the bridge-accepted charset [A-Za-z0-9_-]+. */
export function newJobId(): string {
  counter += 1;
  return `pub_${Date.now()}_${counter}`;
}

/**
 * Write a spec into `<dataDir>/queue/<jobId>.json` atomically: the raw spec JSON is
 * written to a temp file in the same directory, then renamed into place so the
 * bridge's `dequeueNext` never observes a half-written file (which it would quarantine).
 * Returns the jobId (generated when not supplied).
 */
export async function writeQueueFile(
  dataDir: string,
  spec: unknown,
  jobId?: string,
): Promise<string> {
  const id = jobId ?? newJobId();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`unsafe jobId: ${id}`);
  const queueDir = path.join(dataDir, "queue");
  await mkdir(queueDir, { recursive: true });
  const finalPath = path.join(queueDir, `${id}.json`);
  const tmpPath = path.join(queueDir, `.${id}.tmp`);
  await writeFile(tmpPath, JSON.stringify(spec, null, 2), "utf8");
  await rename(tmpPath, finalPath);
  await snapshotPreview(dataDir, queueDir, id, spec);
  await snapshotProvenance(dataDir, queueDir, id);
  return id;
}

/**
 * Snapshot the latest report's run provenance (ungoverned flag, story-scoped
 * contract) to `queue/meta/<jobId>.json` at publish time — the report is
 * overwritten by every later run, so without a per-job copy an approval UI
 * would attribute a NEWER run's provenance to an older job (the same
 * cross-run aliasing the preview snapshot exists for). Governed, uncontracted
 * runs write nothing. Best-effort: never blocks the enqueue.
 */
async function snapshotProvenance(
  dataDir: string,
  queueDir: string,
  jobId: string,
): Promise<void> {
  try {
    const report = JSON.parse(
      await readFile(path.join(dataDir, "batch", "report.json"), "utf8"),
    ) as { ungoverned?: unknown; storyRefs?: unknown };
    const meta: Record<string, unknown> = {
      ...(report.ungoverned === true ? { ungoverned: true } : {}),
      ...(Array.isArray(report.storyRefs) && report.storyRefs.length > 0
        ? { storyRefs: report.storyRefs }
        : {}),
    };
    if (Object.keys(meta).length === 0) return;
    const metaDir = path.join(queueDir, "meta");
    await mkdir(metaDir, { recursive: true });
    await writeFile(path.join(metaDir, `${jobId}.json`), JSON.stringify(meta, null, 2), "utf8");
  } catch {
    // No report / unreadable — provenance is best-effort.
  }
}

/**
 * Snapshot the job's batch preview to `queue/previews/<jobId>.png` at publish
 * time. Shared previews are overwritten by every later run — without a per-job
 * copy, approval UIs would show a NEWER run's screenshot on an older job (the
 * cross-run aliasing that misleads approvals). Best-effort: absence of a
 * matching preview never blocks the enqueue.
 */
async function snapshotPreview(
  dataDir: string,
  queueDir: string,
  jobId: string,
  spec: unknown,
): Promise<void> {
  try {
    const frames = (spec as { frames?: Array<{ name?: unknown }> }).frames;
    const name = typeof frames?.[0]?.name === "string" ? frames[0].name : null;
    if (name === null) return;
    // Reverse the extract naming: "screens/<page>.html/<view>@<vp>".
    const lastSlash = name.lastIndexOf("/");
    const rest = name.slice(lastSlash + 1);
    const at = rest.lastIndexOf("@");
    const view = at === -1 ? rest : rest.slice(0, at);
    const vp = at === -1 ? null : rest.slice(at + 1);
    const base = path.basename(name.slice(0, lastSlash), ".html");
    const previews = path.join(dataDir, "batch", "previews");
    const candidates = [
      ...(vp !== null ? [path.join(previews, vp, `${base}-${view}.png`)] : []),
      path.join(previews, `${base}-${view}.png`),
    ];
    for (const candidate of candidates) {
      try {
        const snapDir = path.join(queueDir, "previews");
        await mkdir(snapDir, { recursive: true });
        await copyFile(candidate, path.join(snapDir, `${jobId}.png`));
        return;
      } catch {
        // try the next candidate
      }
    }
  } catch {
    // best-effort — the frame summary still carries the decision data
  }
}

import { mkdir, writeFile, rename } from "node:fs/promises";
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
  const queueDir = path.join(dataDir, "queue");
  await mkdir(queueDir, { recursive: true });
  const finalPath = path.join(queueDir, `${id}.json`);
  const tmpPath = path.join(queueDir, `.${id}.tmp`);
  await writeFile(tmpPath, JSON.stringify(spec, null, 2), "utf8");
  await rename(tmpPath, finalPath);
  return id;
}

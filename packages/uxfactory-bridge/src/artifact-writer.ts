/**
 * artifact-writer.ts — the bridge's SINGLE WRITER for artifact drafts.
 *
 * Generation is parallelizable but writing must serialize. In the single-writer
 * model, many specialized producer agents draft artifacts concurrently and
 * return write-intents; the bridge (one process) applies them here. Because a
 * section-merge is read→modify→write with awaits, two concurrent merges into
 * the same file would interleave and lose a section even in one process — so
 * every apply runs under a PER-PATH async lock: same file serializes, distinct
 * files run concurrently. That is what makes "many producers, one writer" both
 * safe and fast.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/** A producer's request to write one artifact. Applied by the bridge. */
export interface ArtifactWrite {
  /** Root-relative path of the target file, or the set directory for instances. */
  path: string;
  /** Content to apply: a JSON-serializable value, or a string for `.md`/text targets. */
  body: unknown;
  /** When set, merge `body` under this key into the JSON file (design-system sections). */
  sectionKey?: string;
  /** When set, write `body` as `<path>/<instanceFile>` (set artifacts — one file per instance). */
  instanceFile?: string;
}

// ─── per-path async lock ──────────────────────────────────────────────────────
// A promise chain keyed by absolute path. Each apply awaits the previous apply
// to the SAME path before running; distinct paths never block each other.

const locks = new Map<string, Promise<void>>();

async function withPathLock<T>(absPath: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(absPath) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => (release = resolve));
  locks.set(absPath, prior.then(() => next));
  await prior;
  try {
    return await fn();
  } finally {
    release();
    // Drop the entry once this was the tail, so the map doesn't grow unbounded.
    if (locks.get(absPath) === next) locks.delete(absPath);
  }
}

/** Resolve a root-relative path and refuse anything that escapes the root. */
function resolveWithin(rootDir: string, rel: string): string {
  const abs = path.resolve(rootDir, rel);
  const base = path.resolve(rootDir);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error(`refusing to write outside the project root: ${rel}`);
  }
  return abs;
}

function serialize(body: unknown): string {
  return typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * Apply one artifact write, serialized per target path. Returns the absolute
 * path written.
 *
 * - `sectionKey` → merge `body` under that key into the JSON file (create it as
 *   `{version:1}` if absent), preserving every other section.
 * - `instanceFile` → write `body` as `<path>/<instanceFile>` (set artifact).
 * - neither → write `body` as the whole file (JSON stringified, or a raw string).
 */
export async function applyArtifactWrite(rootDir: string, w: ArtifactWrite): Promise<string> {
  if (w.instanceFile !== undefined) {
    const dir = resolveWithin(rootDir, w.path);
    const abs = resolveWithin(rootDir, path.join(w.path, w.instanceFile));
    return withPathLock(abs, async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(abs, serialize(w.body), "utf8");
      return abs;
    });
  }

  const abs = resolveWithin(rootDir, w.path);
  return withPathLock(abs, async () => {
    await mkdir(path.dirname(abs), { recursive: true });
    if (w.sectionKey !== undefined) {
      let doc: Record<string, unknown> = { version: 1 };
      try {
        const parsed = JSON.parse(await readFile(abs, "utf8")) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          doc = parsed as Record<string, unknown>;
        }
      } catch {
        // Absent or unparseable — start from the fresh {version:1} default.
      }
      doc[w.sectionKey] = w.body;
      await writeFile(abs, serialize(doc), "utf8");
      return abs;
    }
    await writeFile(abs, serialize(w.body), "utf8");
    return abs;
  });
}

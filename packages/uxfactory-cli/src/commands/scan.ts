import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../exit.js";
import type { IO } from "../io.js";

/**
 * `uxfactory scan` — materialize `<dataDir>/catalog.json` from a committed
 * `uxfactory.assets.json` (a flat { "aws:lambda": "componentKey", ... } map) at `cwd`.
 * Writes `{}` when the manifest is absent. (Live Figma component scanning is a documented
 * follow-up; v1 materializes the catalog from the committed manifest.)
 */
export async function scanCmd(
  flags: { dataDir: string; json?: boolean; cwd?: string },
  io: IO,
): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const manifestPath = path.join(cwd, "uxfactory.assets.json");

  let raw: string | null = null;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    raw = null;
  }

  let catalog: Record<string, string> = {};
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err) {
      io.err(
        `cannot parse uxfactory.assets.json: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT.TRANSPORT;
    }
    if (!isStringMap(parsed)) {
      io.err("uxfactory.assets.json must be an object of string → string");
      return EXIT.TRANSPORT;
    }
    catalog = parsed;
  }

  await mkdir(flags.dataDir, { recursive: true });
  await writeFile(
    path.join(flags.dataDir, "catalog.json"),
    JSON.stringify(catalog, null, 2),
    "utf8",
  );

  const entries = Object.keys(catalog).length;
  io.out(
    flags.json
      ? JSON.stringify({ entries })
      : `catalog: ${entries} entr${entries === 1 ? "y" : "ies"}`,
  );
  return EXIT.OK;
}

/** True when `value` is a plain object whose every value is a string. */
function isStringMap(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

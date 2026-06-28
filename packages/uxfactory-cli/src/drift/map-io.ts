import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { validateMap } from "./map-schema.js";
import type { ComponentMap, MapEntry, MapLastSynced } from "./map-schema.js";

/**
 * Read + parse + validate `uxfactory.map.json`. Returns `null` when the file is absent
 * (ENOENT). Throws a clear Error on a parse failure or a structurally invalid map.
 */
export async function readMap(file: string): Promise<ComponentMap | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(
      `cannot parse ${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const v = validateMap(parsed);
  if (!v.valid) {
    throw new Error(`invalid ${path.basename(file)}: ${v.errors.join("; ")}`);
  }
  return parsed as ComponentMap;
}

/** Serialize with a STABLE key order, 2-space indent, and a trailing newline, then write. */
export async function writeMap(file: string, map: ComponentMap): Promise<void> {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, serializeMap(map), "utf8");
}

/** Deterministic serializer: fixed key order so committed diffs stay minimal. */
export function serializeMap(map: ComponentMap): string {
  const ordered = {
    version: map.version,
    components: map.components.map(orderEntry),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function orderEntry(e: MapEntry): Record<string, unknown> {
  const source: Record<string, unknown> = { kind: e.source.kind, ref: e.source.ref };
  if (e.source.compare !== undefined) source.compare = e.source.compare;
  const out: Record<string, unknown> = {
    component: e.component,
    spec: e.spec,
    node: e.node,
    source,
  };
  if (e.figmaId !== undefined) out.figmaId = e.figmaId;
  if (e.lastSynced !== undefined) out.lastSynced = e.lastSynced;
  return out;
}

/** The ONLY fields UXFactory may auto-fill. */
export interface AutoFill {
  figmaId?: string;
  lastSynced?: MapLastSynced;
}

/**
 * Return a NEW map with only `figmaId`/`lastSynced` changed on the named component;
 * every maintained field (`component`/`spec`/`node`/`source`) keeps its original
 * reference, so it is provably untouched. Pure — does not mutate `map`.
 */
export function setAutoFilled(map: ComponentMap, component: string, patch: AutoFill): ComponentMap {
  return {
    version: map.version,
    components: map.components.map((e) => {
      if (e.component !== component) return e;
      const next: MapEntry = {
        // maintained fields: original references, never rebuilt
        component: e.component,
        spec: e.spec,
        node: e.node,
        source: e.source,
        // auto-filled fields: overridden when present in the patch, else preserved
        figmaId: patch.figmaId !== undefined ? patch.figmaId : e.figmaId,
        lastSynced: patch.lastSynced !== undefined ? patch.lastSynced : e.lastSynced,
      };
      return next;
    }),
  };
}

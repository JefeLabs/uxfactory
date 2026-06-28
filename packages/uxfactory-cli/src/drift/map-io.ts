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
  // Extract known fields so any unknown extras (e.g. a maintainer's `note`) are captured in `rest`.
  const { component, spec, node, source, figmaId, lastSynced, ...entryRest } =
    e as unknown as Record<string, unknown>;
  const { kind, ref, compare, ...sourceRest } = (source ?? {}) as Record<string, unknown>;

  // Known source keys first (kind → ref → compare), then any unknown source keys.
  const orderedSource: Record<string, unknown> = { kind, ref };
  if (compare !== undefined) orderedSource.compare = compare;
  Object.assign(orderedSource, sourceRest);

  // Known entry keys first (component → spec → node → source → figmaId → lastSynced), then unknowns.
  const out: Record<string, unknown> = { component, spec, node, source: orderedSource };
  if (figmaId !== undefined) out.figmaId = figmaId;
  if (lastSynced !== undefined) out.lastSynced = lastSynced;
  Object.assign(out, entryRest);
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
 * reference, so it is provably untouched. Unknown extra fields on the entry are
 * preserved (spread first so known auto-filled keys take precedence). Pure — does not mutate `map`.
 */
export function setAutoFilled(map: ComponentMap, component: string, patch: AutoFill): ComponentMap {
  return {
    version: map.version,
    components: map.components.map((e) => {
      if (e.component !== component) return e;
      // Spread e to carry through any unknown keys a maintainer may have added,
      // then re-assert the maintained fields by original reference (never rebuilt),
      // then apply auto-filled overrides.
      const next: MapEntry = {
        ...e,
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

import { readFile } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../exit.js";
import { readMap, writeMap } from "../drift/map-io.js";
import { resolveSource, parseRef } from "../drift/sources.js";
import { findSpecNode } from "../drift/drift-core.js";
import { discoverComponents, readSpecNodes } from "./discover.js";
import type { ComponentMap, MapEntry } from "../drift/map-schema.js";
import type { Spec } from "@uxfactory/spec";
import type { IO } from "../io.js";

/** `uxfactory map scaffold` — propose component↔node links by name match into uxfactory.map.json. */
export async function mapScaffoldCmd(
  flags: { cwd?: string; json?: boolean },
  io: IO,
): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const mapPath = path.join(cwd, "uxfactory.map.json");

  let existing: ComponentMap | null;
  try {
    existing = await readMap(mapPath);
  } catch (err) {
    io.err((err as Error).message);
    return EXIT.TRANSPORT;
  }
  const map: ComponentMap = existing ?? { version: 1, components: [] };
  const present = new Set(map.components.map((e) => e.component));

  const discovered = await discoverComponents(cwd);
  const specNodes = await readSpecNodes(cwd);

  const proposals: MapEntry[] = [];
  for (const d of discovered) {
    if (present.has(d.component)) continue; // never overwrite a maintained entry
    const hit = specNodes.find((s) => s.nodes.includes(d.component));
    if (hit === undefined) continue; // no name-matching spec node → cannot propose a link
    proposals.push({ component: d.component, spec: hit.spec, node: d.component, source: d.source });
    present.add(d.component);
  }

  const merged: ComponentMap = { version: 1, components: [...map.components, ...proposals] };
  await writeMap(mapPath, merged);

  if (flags.json) {
    io.out(
      JSON.stringify({
        proposed: proposals.map((p) => p.component),
        total: merged.components.length,
      }),
    );
  } else if (proposals.length === 0) {
    io.out("scaffold: no new component↔node links to propose");
  } else {
    io.out(`scaffold: proposed ${proposals.length} draft link(s):`);
    for (const p of proposals) io.out(`  ${p.component} → ${p.spec}#${p.node} (${p.source.kind})`);
  }
  return EXIT.OK;
}

/** `uxfactory map check` — verify every entry resolves on BOTH sides; exit 1 on a dangling entry. */
export async function mapCheckCmd(
  flags: { cwd?: string; json?: boolean },
  io: IO,
): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const mapPath = path.join(cwd, "uxfactory.map.json");

  let map: ComponentMap | null;
  try {
    map = await readMap(mapPath);
  } catch (err) {
    io.err((err as Error).message);
    return EXIT.TRANSPORT;
  }
  if (map === null) {
    io.err("no uxfactory.map.json found");
    return EXIT.TRANSPORT;
  }

  const dangling: Array<{ component: string; reason: string }> = [];
  for (const entry of map.components) {
    if (!(await sourceResolves(cwd, entry))) {
      dangling.push({
        component: entry.component,
        reason: `source ${entry.source.ref} does not resolve`,
      });
    } else if (!(await specNodeExists(cwd, entry))) {
      dangling.push({
        component: entry.component,
        reason: `spec node ${entry.spec}#${entry.node} not found`,
      });
    }
  }

  if (flags.json) {
    io.out(JSON.stringify({ ok: dangling.length === 0, dangling }));
  } else if (dangling.length === 0) {
    io.out(
      `map check: ${map.components.length} entr${map.components.length === 1 ? "y" : "ies"} OK`,
    );
  } else {
    io.err(`map check: ${dangling.length} dangling entr${dangling.length === 1 ? "y" : "ies"}:`);
    for (const d of dangling) io.err(`  ${d.component}: ${d.reason}`);
  }
  return dangling.length === 0 ? EXIT.OK : EXIT.GATE_FAIL;
}

async function sourceResolves(cwd: string, entry: MapEntry): Promise<boolean> {
  const { file, ident } = parseRef(entry.source.ref);
  let content: string;
  try {
    content = await readFile(path.join(cwd, file), "utf8");
  } catch {
    return false;
  }
  return resolveSource(entry.source.kind, content, ident, entry.source.compare).resolved;
}

async function specNodeExists(cwd: string, entry: MapEntry): Promise<boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(cwd, entry.spec), "utf8")) as unknown;
  } catch {
    return false;
  }
  return findSpecNode(parsed as Spec, entry.node) !== null;
}

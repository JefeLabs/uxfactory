import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { EXIT, TransportError } from "../exit.js";
import { readMap } from "../drift/map-io.js";
import { resolveSource, parseRef } from "../drift/sources.js";
import { computeDrift } from "../drift/drift-core.js";
import { discoverComponents } from "./discover.js";
import type { ComponentMap } from "../drift/map-schema.js";
import type { ResolvedSource } from "../drift/sources.js";
import type { Spec } from "@uxfactory/spec";
import type { RenderReport } from "@uxfactory/bridge";
import type { BridgeClient } from "../client.js";
import type { IO } from "../io.js";

/** Injectable git lookup so drift is testable without a real repo. */
export type GitLastCommit = (file: string) => string | null;

/** The default lookup: `git log -1 --format=%H -- <file>` in `cwd`; null when git fails. */
export function defaultGitLastCommit(cwd: string): GitLastCommit {
  return (file: string) => {
    try {
      const out = execFileSync("git", ["log", "-1", "--format=%H", "--", file], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const hash = out.trim();
      return hash.length > 0 ? hash : null;
    } catch {
      return null;
    }
  };
}

export interface DriftFlags {
  cwd?: string;
  json?: boolean;
  gitLastCommit?: GitLastCommit;
}

/** `uxfactory drift` — detect spec-vs-reality drift via the component map. */
export async function driftCmd(flags: DriftFlags, io: IO, client: BridgeClient): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const mapPath = path.join(cwd, "uxfactory.map.json");

  let map: ComponentMap | null;
  try {
    map = await readMap(mapPath);
  } catch (err) {
    io.err((err as Error).message); // unreadable/invalid map → a setup problem
    return EXIT.TRANSPORT;
  }
  if (map === null) {
    io.err("no uxfactory.map.json found — run 'uxfactory map scaffold' first");
    return EXIT.TRANSPORT;
  }

  // referenced specs (missing ones simply won't field-diff; 'map check' flags those)
  const specs: Record<string, Spec> = {};
  for (const file of new Set(map.components.map((e) => e.spec))) {
    try {
      specs[file] = JSON.parse(await readFile(path.join(cwd, file), "utf8")) as Spec;
    } catch {
      /* missing/unparseable spec → skip; drift still runs source-vs-source */
    }
  }

  // latest render report (optional — the bridge being down is fine)
  let report: RenderReport | null = null;
  try {
    report = await client.getRendered();
  } catch (err) {
    if (!(err instanceof TransportError)) throw err;
    report = null;
  }

  // resolve each source from disk (missing file → unresolved → deleted-orphan)
  const sources: Record<string, ResolvedSource> = {};
  for (const entry of map.components) {
    const { file, ident } = parseRef(entry.source.ref);
    let content: string | null = null;
    try {
      content = await readFile(path.join(cwd, file), "utf8");
    } catch {
      content = null;
    }
    sources[entry.source.ref] =
      content === null
        ? { resolved: false, values: {} }
        : resolveSource(entry.source.kind, content, ident, entry.source.compare);
  }

  // git-staleness for compare-less entries
  const git = flags.gitLastCommit ?? defaultGitLastCommit(cwd);
  const staleness: Record<string, boolean> = {};
  for (const entry of map.components) {
    const hasCompare =
      entry.source.compare !== undefined && Object.keys(entry.source.compare).length > 0;
    if (hasCompare) continue;
    const head = git(parseRef(entry.source.ref).file);
    staleness[entry.component] = head !== null && head !== entry.lastSynced?.commit;
  }

  const discovered = (await discoverComponents(cwd)).map((d) => ({
    component: d.component,
    ref: d.source.ref,
  }));

  const drift = computeDrift({
    map,
    specs,
    report,
    sources,
    discoveredComponents: discovered,
    staleness,
  });

  if (flags.json) {
    io.out(JSON.stringify({ clean: drift.clean, findings: drift.findings }));
  } else if (drift.clean) {
    io.out("drift: clean — no spec drift detected");
  } else {
    io.out(`drift: ${drift.findings.length} finding(s)`);
    for (const f of drift.findings) io.out(`  [${f.kind}] ${f.detail}`);
  }
  return drift.clean ? EXIT.OK : EXIT.GATE_FAIL;
}

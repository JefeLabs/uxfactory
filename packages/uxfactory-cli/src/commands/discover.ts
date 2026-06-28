import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, parseAllDocuments } from "yaml";
import { extractBraceBody } from "../drift/sources.js";
import type { MapSource } from "../drift/map-schema.js";

/** A component found in a source file, with its synthesized binding. */
export interface DiscoveredComponent {
  component: string;
  source: MapSource;
}

/** The node names declared by a single spec file. */
export interface SpecNodes {
  spec: string;
  nodes: string[];
}

/** Directory names to skip entirely during recursive walk. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".uxfactory"]);

/** Maximum depth to recurse from cwd (depth 0 = cwd entries, 1 = first level subdirs, …). */
const MAX_DEPTH = 4;

/**
 * Recursively collect all files under `dir`, up to MAX_DEPTH levels deep from `cwd`.
 * Returns objects with the file's absolute path and its path relative to `cwd`.
 * Skips SKIP_DIRS directory names at any level.
 */
async function walkFiles(
  cwd: string,
  dir: string,
  depth: number,
): Promise<Array<{ relPath: string; absPath: string }>> {
  if (depth > MAX_DEPTH) return [];
  const results: Array<{ relPath: string; absPath: string }> = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...(await walkFiles(cwd, absPath, depth + 1)));
    } else if (entry.isFile()) {
      results.push({ relPath: path.relative(cwd, absPath), absPath });
    }
  }
  return results;
}

/**
 * Classify a file by name/extension alone.
 * - "terraform"   : *.tf
 * - "compose"     : explicit compose filenames (docker-compose.yml, compose.yaml, …)
 * - "k8s"         : *.k8s.yaml / *.k8s.yml (explicit k8s marker)
 * - "yaml-content": *.yaml / *.yml — must inspect content to distinguish compose vs k8s
 * - null          : not a candidate source file
 */
function classifyByName(relPath: string): MapSource["kind"] | "yaml-content" | null {
  if (relPath.endsWith(".tf")) return "terraform";
  const base = path.basename(relPath);
  if (
    base === "compose.yaml" ||
    base === "compose.yml" ||
    base === "docker-compose.yaml" ||
    base === "docker-compose.yml"
  ) {
    return "compose";
  }
  if (relPath.endsWith(".k8s.yaml") || relPath.endsWith(".k8s.yml")) return "k8s";
  if (relPath.endsWith(".yaml") || relPath.endsWith(".yml")) return "yaml-content";
  return null;
}

/**
 * Disambiguate a YAML file by content:
 * - "compose" : first document has a top-level `services:` object
 * - "k8s"     : any document has both `apiVersion` and `kind` string fields
 * - null      : neither → skip
 */
function classifyYamlContent(content: string): "k8s" | "compose" | null {
  let docs: unknown[];
  try {
    docs = parseAllDocuments(content).map((d) => d.toJS() as unknown);
  } catch {
    return null;
  }
  if (docs.length === 0) return null;

  // Compose: top-level `services:` object in the first document
  const first = docs[0];
  if (typeof first === "object" && first !== null) {
    const f = first as Record<string, unknown>;
    if (typeof f.services === "object" && f.services !== null) return "compose";
  }

  // k8s: any document declares apiVersion + kind
  for (const d of docs) {
    const o = d as { apiVersion?: unknown; kind?: unknown };
    if (typeof o.apiVersion === "string" && typeof o.kind === "string") return "k8s";
  }
  return null;
}

/**
 * Walk source files recursively under `cwd` (bounded to MAX_DEPTH, skipping SKIP_DIRS);
 * return one entry per discovered component.
 * Supports: *.tf (terraform), explicit compose filenames, *.k8s.yaml/yml, and generic
 * *.yaml/yml that parse as either a Compose file (has `services:`) or a k8s manifest
 * (has `apiVersion` + `kind`).
 */
export async function discoverComponents(cwd: string): Promise<DiscoveredComponent[]> {
  const allFiles = await walkFiles(cwd, cwd, 0);
  // Sort for deterministic, alphabetical output
  allFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const out: DiscoveredComponent[] = [];
  for (const { relPath, absPath } of allFiles) {
    const byName = classifyByName(relPath);
    if (byName === null) continue;

    let content: string;
    try {
      content = await readFile(absPath, "utf8");
    } catch {
      continue;
    }

    let kind: MapSource["kind"];
    if (byName === "yaml-content") {
      const detected = classifyYamlContent(content);
      if (detected === null) continue;
      kind = detected;
    } else {
      kind = byName;
    }

    if (kind === "terraform") out.push(...discoverTerraform(relPath, content));
    else if (kind === "k8s") out.push(...discoverK8s(relPath, content));
    else out.push(...discoverCompose(relPath, content));
  }
  return out;
}

function discoverTerraform(file: string, content: string): DiscoveredComponent[] {
  const out: DiscoveredComponent[] = [];
  const re = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const type = m[1] ?? "";
    const local = m[2] ?? "";
    const body = extractBraceBody(content, m.index + m[0].length - 1);
    const nameAttr = body !== null ? /(?:^|\n)\s*name\s*=\s*"([^"]+)"/.exec(body)?.[1] : undefined;
    const component = nameAttr ?? local;
    out.push({ component, source: { kind: "terraform", ref: `${file}#${type}.${local}` } });
  }
  return out;
}

function discoverK8s(file: string, content: string): DiscoveredComponent[] {
  let docs: unknown[];
  try {
    docs = parseAllDocuments(content).map((d) => d.toJS() as unknown);
  } catch {
    return [];
  }
  const out: DiscoveredComponent[] = [];
  for (const d of docs) {
    const o = d as { kind?: unknown; metadata?: { name?: unknown } };
    const name = o.metadata?.name;
    if (typeof name !== "string") continue;
    const kindLabel = typeof o.kind === "string" ? o.kind : "Resource";
    out.push({ component: name, source: { kind: "k8s", ref: `${file}#${kindLabel}/${name}` } });
  }
  return out;
}

function discoverCompose(file: string, content: string): DiscoveredComponent[] {
  let root: unknown;
  try {
    root = parseYaml(content) as unknown;
  } catch {
    return [];
  }
  const services = (root as { services?: Record<string, unknown> }).services;
  if (typeof services !== "object" || services === null) return [];
  return Object.keys(services).map((name) => ({
    component: name,
    source: { kind: "compose" as const, ref: `${file}#${name}` },
  }));
}

/** Read `*.uxfactory.json` spec files at the top level of `cwd`; return each file's node names. */
export async function readSpecNodes(cwd: string): Promise<SpecNodes[]> {
  let names: string[];
  try {
    names = await readdir(cwd);
  } catch {
    return [];
  }
  const out: SpecNodes[] = [];
  for (const file of names.sort()) {
    if (!file.endsWith(".uxfactory.json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(cwd, file), "utf8")) as unknown;
    } catch {
      continue;
    }
    out.push({ spec: file, nodes: collectNodeNames(parsed) });
  }
  return out;
}

function collectNodeNames(spec: unknown): string[] {
  const names: string[] = [];
  const s = spec as { frames?: unknown[]; sections?: unknown[] };
  for (const group of [s.frames, s.sections]) {
    if (!Array.isArray(group)) continue;
    for (const raw of group) {
      const c = raw as { name?: unknown; children?: unknown[] };
      if (typeof c.name === "string") names.push(c.name);
      if (Array.isArray(c.children)) {
        for (const child of c.children) {
          const ch = child as { name?: unknown };
          if (typeof ch.name === "string") names.push(ch.name);
        }
      }
    }
  }
  return names;
}

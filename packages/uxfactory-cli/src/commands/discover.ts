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

/** Classify a top-level file name into a source kind, or null if it is not one we read. */
function classify(file: string): MapSource["kind"] | null {
  if (file.endsWith(".tf")) return "terraform";
  if (file.endsWith(".k8s.yaml") || file.endsWith(".k8s.yml")) return "k8s";
  if (["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"].includes(file)) {
    return "compose";
  }
  return null;
}

/** Walk known source files at the top level of `cwd`; return one entry per discovered component. */
export async function discoverComponents(cwd: string): Promise<DiscoveredComponent[]> {
  let names: string[];
  try {
    names = await readdir(cwd);
  } catch {
    return [];
  }
  const out: DiscoveredComponent[] = [];
  for (const file of names.sort()) {
    const kind = classify(file);
    if (kind === null) continue;
    let content: string;
    try {
      content = await readFile(path.join(cwd, file), "utf8");
    } catch {
      continue;
    }
    if (kind === "terraform") out.push(...discoverTerraform(file, content));
    else if (kind === "k8s") out.push(...discoverK8s(file, content));
    else out.push(...discoverCompose(file, content));
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

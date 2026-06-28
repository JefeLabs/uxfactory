import { parse as parseYaml, parseAllDocuments } from "yaml";
import type { MapSource } from "./map-schema.js";

/** The outcome of resolving a source ref: did the target exist, and the extracted values. */
export interface ResolvedSource {
  resolved: boolean;
  /** Source-attribute name → string value (keyed by the `compare` VALUES). */
  values: Record<string, string>;
}

/**
 * Resolve a source binding from file CONTENT (PURE — no disk access). Finds the target
 * identified by `ident` inside `fileContent` for the given `kind`, then extracts every
 * attribute named in `compare`'s values. `resolved:false` when the target is absent.
 */
export function resolveSource(
  kind: MapSource["kind"],
  fileContent: string,
  ident: string,
  compare?: Record<string, string>,
): ResolvedSource {
  const attrs = compare !== undefined ? Object.values(compare) : [];
  switch (kind) {
    case "terraform":
      return resolveTerraform(fileContent, ident, attrs);
    case "k8s":
      return resolveK8s(fileContent, ident, attrs);
    case "compose":
      return resolveCompose(fileContent, ident, attrs);
  }
}

/** Split a `file#ident` ref into its two halves. */
export function parseRef(ref: string): { file: string; ident: string } {
  const hash = ref.indexOf("#");
  return hash >= 0
    ? { file: ref.slice(0, hash), ident: ref.slice(hash + 1) }
    : { file: ref, ident: "" };
}

/** Read a value by a dotted path with optional array indices, e.g. `spec.ports[0].targetPort`. */
export function getByPath(obj: unknown, dotted: string): unknown {
  const keys = dotted
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((k) => k.length > 0);
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Return the substring inside the braces starting at `openIndex` (the `{`), or null if unbalanced. */
export function extractBraceBody(content: string, openIndex: number): string | null {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return content.slice(openIndex + 1, i);
    }
  }
  return null;
}

function resolveTerraform(content: string, ident: string, attrs: string[]): ResolvedSource {
  const dot = ident.indexOf(".");
  const type = dot >= 0 ? ident.slice(0, dot) : ident;
  const name = dot >= 0 ? ident.slice(dot + 1) : "";
  const header = new RegExp(`resource\\s+"${escapeRe(type)}"\\s+"${escapeRe(name)}"\\s*\\{`);
  const m = header.exec(content);
  if (m === null) return { resolved: false, values: {} };
  const body = extractBraceBody(content, m.index + m[0].length - 1);
  if (body === null) return { resolved: false, values: {} };
  const values: Record<string, string> = {};
  for (const attr of attrs) {
    const re = new RegExp(`(?:^|\\n)\\s*${escapeRe(attr)}\\s*=\\s*(.+)`);
    const am = re.exec(body);
    if (am !== null && am[1] !== undefined) values[attr] = stripQuotes(am[1]);
  }
  return { resolved: true, values };
}

function resolveK8s(content: string, ident: string, attrs: string[]): ResolvedSource {
  const slash = ident.indexOf("/");
  const kind = slash >= 0 ? ident.slice(0, slash) : null;
  const name = slash >= 0 ? ident.slice(slash + 1) : ident;
  let docs: unknown[];
  try {
    docs = parseAllDocuments(content).map((d) => d.toJS() as unknown);
  } catch {
    return { resolved: false, values: {} };
  }
  const doc = docs.find((d) => {
    const o = d as { kind?: unknown; metadata?: { name?: unknown } };
    const nameMatch = o.metadata?.name === name;
    const kindMatch = kind === null || o.kind === kind;
    return nameMatch && kindMatch;
  });
  if (doc === undefined) return { resolved: false, values: {} };
  return { resolved: true, values: collectAttrs(doc, attrs) };
}

function resolveCompose(content: string, ident: string, attrs: string[]): ResolvedSource {
  let root: unknown;
  try {
    root = parseYaml(content) as unknown;
  } catch {
    return { resolved: false, values: {} };
  }
  const services = (root as { services?: Record<string, unknown> }).services;
  const svc = services?.[ident];
  if (svc === undefined || svc === null) return { resolved: false, values: {} };
  return { resolved: true, values: collectAttrs(svc, attrs) };
}

function collectAttrs(obj: unknown, attrs: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const attr of attrs) {
    const v = getByPath(obj, attr);
    if (v !== undefined && v !== null) values[attr] = String(v);
  }
  return values;
}

/** Strip a leading quoted string, or take the leading bare token (up to whitespace/comment). */
function stripQuotes(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    return end > 0 ? s.slice(1, end) : s.slice(1);
  }
  return s.split(/\s|#|\/\//)[0] ?? s;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

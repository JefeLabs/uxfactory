import { readFile } from "node:fs/promises";
import type { ImpliedState } from "./checks.js";

/** How the render stage drives a page into a view. Exactly one form, all eval-free. */
export type Activation =
  | { hash: string }
  | { query: string }
  | { click: string[] };

/** One (story, impliedState) claim, resolved by a CSS selector against the activated DOM. */
export interface TraceCover {
  story: string;
  impliedState: ImpliedState;
  selector: string;
}

/** A render-state of a page: activated, screenshotted, and coverage-checked on its own. */
export interface TraceView {
  id: string;
  activate?: Activation;
  covers: TraceCover[];
}

/** One HTML document; hosts ≥1 view. `viewports` is reserved (validated, unused in SP1). */
export interface TracePage {
  file: string;
  views: TraceView[];
  viewports?: string[];
}

/** The AI-emitted coverage manifest (design/trace.json). */
export interface TraceManifest {
  version: 1;
  pages: TracePage[];
}

const IMPLIED_STATES = new Set<string>(["empty", "loading", "error", "success", "edge"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateActivation(a: unknown): string | null {
  if (a === undefined) return null;
  if (!isObject(a)) return "activate must be an object";
  const keys = Object.keys(a);
  if (keys.length !== 1) return `activate must have exactly one form, got: ${keys.join(", ") || "none"}`;
  if ("hash" in a) return typeof a["hash"] === "string" ? null : "activate.hash must be a string";
  if ("query" in a) return typeof a["query"] === "string" ? null : "activate.query must be a string";
  if ("click" in a)
    return Array.isArray(a["click"]) && a["click"].every((s) => typeof s === "string")
      ? null
      : "activate.click must be an array of selector strings";
  return `unknown activation form: ${keys[0]}`;
}

/** Pure structural validation of a parsed trace manifest. Never throws. */
export function validateTrace(
  raw: unknown,
): { ok: true; trace: TraceManifest } | { ok: false; message: string } {
  if (!isObject(raw)) return { ok: false, message: "trace must be a JSON object" };
  if (raw["version"] !== 1) return { ok: false, message: "trace version must be 1" };
  if (!Array.isArray(raw["pages"]) || raw["pages"].length === 0)
    return { ok: false, message: "trace.pages must be a non-empty array" };

  for (const [pi, page] of raw["pages"].entries()) {
    if (!isObject(page)) return { ok: false, message: `trace.pages[${pi}] must be an object` };
    if (typeof page["file"] !== "string" || !page["file"].endsWith(".html"))
      return { ok: false, message: `trace.pages[${pi}].file must be a string path ending in .html` };
    if (page["viewports"] !== undefined &&
        (!Array.isArray(page["viewports"]) || page["viewports"].some((v) => typeof v !== "string")))
      return { ok: false, message: `trace.pages[${pi}].viewports must be an array of strings` };
    if (!Array.isArray(page["views"]) || page["views"].length === 0)
      return { ok: false, message: `trace.pages[${pi}].views must be a non-empty array` };

    const ids = new Set<string>();
    for (const [vi, view] of page["views"].entries()) {
      const at = `trace.pages[${pi}].views[${vi}]`;
      if (!isObject(view)) return { ok: false, message: `${at} must be an object` };
      if (typeof view["id"] !== "string" || view["id"].length === 0)
        return { ok: false, message: `${at}.id must be a non-empty string` };
      if (ids.has(view["id"])) return { ok: false, message: `${at}.id "${view["id"]}" is duplicated within the page` };
      ids.add(view["id"]);
      const actErr = validateActivation(view["activate"]);
      if (actErr !== null) return { ok: false, message: `${at}.${actErr}` };
      if (!Array.isArray(view["covers"]) || view["covers"].length === 0)
        return { ok: false, message: `${at}.covers must be a non-empty array` };
      for (const [ci, cover] of view["covers"].entries()) {
        const cat = `${at}.covers[${ci}]`;
        if (!isObject(cover)) return { ok: false, message: `${cat} must be an object` };
        if (typeof cover["story"] !== "string") return { ok: false, message: `${cat}.story must be a string` };
        if (typeof cover["impliedState"] !== "string" || !IMPLIED_STATES.has(cover["impliedState"]))
          return { ok: false, message: `${cat}.impliedState must be one of empty|loading|error|success|edge` };
        if (typeof cover["selector"] !== "string" || cover["selector"].length === 0)
          return { ok: false, message: `${cat}.selector must be a non-empty string` };
      }
    }
  }
  return { ok: true, trace: raw as unknown as TraceManifest };
}

/** Read + JSON-parse + validate a trace file. Never throws on bad input. */
export async function readTrace(
  absPath: string,
): Promise<{ ok: true; trace: TraceManifest } | { ok: false; message: string }> {
  let text: string;
  try {
    text = await readFile(absPath, "utf8");
  } catch {
    return { ok: false, message: `cannot read trace manifest ${absPath}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return { ok: false, message: `invalid JSON in ${absPath}: ${(err as Error).message}` };
  }
  return validateTrace(parsed);
}

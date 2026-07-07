/**
 * Shared registered-input loader used by both `batch` and `review` commands.
 *
 * Distinguishes three states so callers can treat them differently:
 *   - absent:  null path (not registered in the registry) → skip-and-declare is appropriate
 *   - ok:      registered, file readable, JSON valid, shape passes → use the value
 *   - broken:  registered but file unreadable, JSON invalid, or wrong shape → setup error (exit 2)
 *
 * Single source of truth for shape checks; batch and review cannot drift from each other.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseStoryFile, storyToEngine } from "@uxfactory/spec";
import type { TokenSet, StorySet, Flow, FeatureSet } from "./checks.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InputLoadResult<T> =
  { state: "absent" } | { state: "ok"; value: T } | { state: "broken"; message: string };

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function loadRawJson(
  absPath: string,
  kind: string,
): Promise<{ ok: true; raw: unknown } | { ok: false; message: string }> {
  try {
    const raw = JSON.parse(await readFile(absPath, "utf8")) as unknown;
    return { ok: true, raw };
  } catch (err) {
    return {
      ok: false,
      message: `cannot read registered ${kind} input '${absPath}': ${(err as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Load and shape-validate a registered tokens input (tokens.ds.json).
 *
 * Absent (null path) → { state:"absent" }.
 * Unreadable / invalid JSON → { state:"broken", message }.
 * `colors` not a plain object → { state:"broken", message } (shape error).
 */
export async function loadTokensInput(absPath: string | null): Promise<InputLoadResult<TokenSet>> {
  if (absPath === null) return { state: "absent" };
  const result = await loadRawJson(absPath, "tokens");
  if (!result.ok) return { state: "broken", message: result.message };
  const raw = result.raw;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { state: "broken", message: `malformed tokens file: expected a JSON object` };
  }
  const colors = (raw as Record<string, unknown>)["colors"];
  if (colors === null || typeof colors !== "object" || Array.isArray(colors)) {
    return {
      state: "broken",
      message: `malformed tokens file: "colors" must be an object (got ${JSON.stringify(typeof colors)})`,
    };
  }
  return { state: "ok", value: raw as unknown as TokenSet };
}

/**
 * Load a directory of canonical per-story files (`.uxfactory/artifacts/
 * stories/*.json`, nested-ACs migration) into one engine StorySet. Members
 * normalize through @uxfactory/spec's story schema — canonical or legacy
 * member shape both accepted — sorted by filename for determinism. Any
 * malformed member breaks the whole input (setup error), naming the file.
 */
async function loadStoriesDir(dirAbs: string): Promise<InputLoadResult<StorySet>> {
  let entries: string[];
  try {
    entries = (await readdir(dirAbs)).filter((e) => e.endsWith(".json")).sort();
  } catch (err) {
    return {
      state: "broken",
      message: `cannot read registered stories input '${dirAbs}': ${(err as Error).message}`,
    };
  }
  const stories: StorySet["stories"] = [];
  for (const entry of entries) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path.join(dirAbs, entry), "utf8")) as unknown;
    } catch (err) {
      return {
        state: "broken",
        message: `malformed story file '${entry}': ${(err as Error).message}`,
      };
    }
    const parsed = parseStoryFile(raw);
    if (!parsed.ok) {
      return { state: "broken", message: `malformed story file '${entry}': ${parsed.message}` };
    }
    stories.push(storyToEngine(parsed.story));
  }
  return { state: "ok", value: { stories } };
}

/**
 * Load and shape-validate a registered stories input.
 *
 * Absent (null path) → { state:"absent" }.
 * Directory → canonical per-story set (see {@link loadStoriesDir}).
 * File → the legacy `{stories:[…]}` shape, byte-identical behavior.
 * Unreadable / invalid JSON / `stories` not an array → { state:"broken", message }.
 */
export async function loadStoriesInput(absPath: string | null): Promise<InputLoadResult<StorySet>> {
  if (absPath === null) return { state: "absent" };
  try {
    if ((await stat(absPath)).isDirectory()) return loadStoriesDir(absPath);
  } catch {
    // Unreadable path: fall through so the file loader reports its usual message.
  }
  const result = await loadRawJson(absPath, "stories");
  if (!result.ok) return { state: "broken", message: result.message };
  const raw = result.raw;
  if (typeof raw !== "object" || raw === null) {
    return { state: "broken", message: `malformed stories file: expected a JSON object` };
  }
  const stories = (raw as Record<string, unknown>)["stories"];
  if (!Array.isArray(stories)) {
    return {
      state: "broken",
      message: `malformed stories file: "stories" must be an array (got ${JSON.stringify(typeof stories)})`,
    };
  }
  return { state: "ok", value: raw as unknown as StorySet };
}

/**
 * Load and shape-validate a registered features input (features.json).
 * Feeds the Coverage METRIC only (decision 12) — never a gate.
 */
export async function loadFeaturesInput(
  absPath: string | null,
): Promise<InputLoadResult<FeatureSet>> {
  if (absPath === null) return { state: "absent" };
  const result = await loadRawJson(absPath, "features");
  if (!result.ok) return { state: "broken", message: result.message };
  const raw = result.raw;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { state: "broken", message: `malformed features file: expected a JSON object` };
  }
  const features = (raw as Record<string, unknown>)["features"];
  if (!Array.isArray(features)) {
    return {
      state: "broken",
      message: `malformed features file: "features" must be an array (got ${JSON.stringify(typeof features)})`,
    };
  }
  return { state: "ok", value: raw as unknown as FeatureSet };
}

/**
 * Load a registered flow input (flow.json).
 *
 * Absent (null path) → { state:"absent" }.
 * Unreadable / invalid JSON / not an object → { state:"broken", message }.
 */
export async function loadFlowInput(absPath: string | null): Promise<InputLoadResult<Flow>> {
  if (absPath === null) return { state: "absent" };
  const result = await loadRawJson(absPath, "flow");
  if (!result.ok) return { state: "broken", message: result.message };
  if (typeof result.raw !== "object" || result.raw === null) {
    return { state: "broken", message: `malformed flow file: expected a JSON object` };
  }
  const refs = (result.raw as Record<string, unknown>)["storyRefs"];
  if (refs !== undefined && (!Array.isArray(refs) || refs.some((r) => typeof r !== "string" || r === ""))) {
    return { state: "broken", message: `malformed flow file: "storyRefs" must be an array of non-empty story ids` };
  }
  return { state: "ok", value: result.raw as Flow };
}

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
import { readFile } from "node:fs/promises";
import type { TokenSet, StorySet, Flow } from "./checks.js";

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
 * Load and shape-validate a registered stories input (stories.json).
 *
 * Absent (null path) → { state:"absent" }.
 * Unreadable / invalid JSON / `stories` not an array → { state:"broken", message }.
 */
export async function loadStoriesInput(absPath: string | null): Promise<InputLoadResult<StorySet>> {
  if (absPath === null) return { state: "absent" };
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
  return { state: "ok", value: result.raw as Flow };
}

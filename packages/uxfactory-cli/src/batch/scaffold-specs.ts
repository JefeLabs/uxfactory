/**
 * Deterministic spec scaffolder — the "render path".
 *
 * Pure, NO LLM: derive a schema-valid `*.uxfactory.json` DesignSpec from a single
 * user Story so the deterministic `batch`/`gate` requirement-coverage check passes
 * GREEN. The naming contract is load-bearing and mirrors `batch/checks.ts`:
 *
 *   - A frame named `<story.id>-<state>` token-boundary-matches `story.id`
 *     (checks split names on `/[-_/\s]+/`; `story.id`'s segments appear as a
 *     contiguous run in the frame's segments) → the story is COVERED by a frame.
 *   - Each unique acceptance-criterion `impliedState` becomes its own frame whose
 *     name (and a child TextNode named `<story.id>-<state>-label`) contains the
 *     state keyword as a substring → the AC-implied state has a matching node.
 *
 * Frame/node NAMES embed `story.id` VERBATIM (never sanitized) so the
 * token-boundary match against the raw `story.id` is guaranteed regardless of the
 * id's characters. Only the FILE name is sanitized (a file name has stricter
 * constraints than a Figma node name, which the schema allows to be any string).
 */

import type { DesignSpec, Frame, TextNode } from "@uxfactory/spec";
import type { ImpliedState, Story } from "./checks.js";

/** A scaffolded spec paired with its target file name. */
export interface ScaffoldedSpec {
  /** The originating story id (verbatim). */
  id: string;
  /** `<sanitized-id>.uxfactory.json`. */
  fileName: string;
  /** The schema-valid DesignSpec covering the story's states. */
  spec: DesignSpec;
}

// Geometry — frames are laid out left-to-right at a non-overlapping x offset.
const FRAME_WIDTH = 375;
const FRAME_HEIGHT = 812;
const FRAME_GAP = 25;
const FRAME_STRIDE = FRAME_WIDTH + FRAME_GAP;

// Label node geometry inside each frame.
const LABEL_X = 24;
const LABEL_Y = 48;
const LABEL_WIDTH = 327;
const LABEL_HEIGHT = 32;
/** A literal ink color — tokens are not required at low visual scope. */
const LABEL_FILL = "#1F2937";

/** Fallback state when a story declares no acceptance criteria. */
const DEFAULT_STATE: ImpliedState = "success";

/**
 * The UNIQUE `impliedState`s across a story's acceptance criteria, in first-seen
 * order. Falls back to a single `"success"` state when there are none.
 */
function uniqueStates(story: Story): ImpliedState[] {
  const seen = new Set<ImpliedState>();
  const out: ImpliedState[] = [];
  for (const ac of story.acceptanceCriteria ?? []) {
    if (!seen.has(ac.impliedState)) {
      seen.add(ac.impliedState);
      out.push(ac.impliedState);
    }
  }
  if (out.length === 0) out.push(DEFAULT_STATE);
  return out;
}

/** A human, non-empty label for a state frame. */
function humanLabel(story: Story, state: ImpliedState): string {
  const title = state.charAt(0).toUpperCase() + state.slice(1);
  const subject = story.goal?.trim() !== "" ? story.goal : story.id;
  return `${title} — ${subject}`;
}

/**
 * Make a file name safe: keep `[A-Za-z0-9._-]`, replace every other run with a
 * single `-`, trim leading/trailing separators, and fall back to `spec` when the
 * result is empty. NEVER used for node names (those keep the raw id).
 */
export function sanitizeFileName(id: string): string {
  const cleaned = id
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned === "" ? "spec" : cleaned;
}

/**
 * Scaffold one schema-valid `DesignSpec` for a story: one frame per unique
 * acceptance-criterion `impliedState` (default `success`), each at a
 * non-overlapping x offset, each carrying a labelled TextNode whose name contains
 * the state keyword. Frame/node names embed `story.id` verbatim for token-boundary
 * coverage.
 */
export function scaffoldSpec(story: Story): DesignSpec {
  const frames: Frame[] = uniqueStates(story).map((state, i) => {
    const frameName = `${story.id}-${state}`;
    const label: TextNode = {
      type: "text",
      name: `${frameName}-label`,
      x: LABEL_X,
      y: LABEL_Y,
      width: LABEL_WIDTH,
      height: LABEL_HEIGHT,
      characters: humanLabel(story, state),
      fill: LABEL_FILL,
    };
    const frame: Frame = {
      name: frameName,
      x: i * FRAME_STRIDE,
      y: 0,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      children: [label],
    };
    return frame;
  });
  return { editor: "figma", frames };
}

/**
 * Scaffold one spec per story. `fileName` = `<sanitized-id>.uxfactory.json`.
 */
export function scaffoldSpecs(stories: Story[]): ScaffoldedSpec[] {
  return stories.map((story) => ({
    id: story.id,
    fileName: `${sanitizeFileName(story.id)}.uxfactory.json`,
    spec: scaffoldSpec(story),
  }));
}

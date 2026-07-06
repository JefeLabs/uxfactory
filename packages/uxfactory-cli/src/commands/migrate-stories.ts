/**
 * migrate-stories.ts — `uxfactory migrate-stories` (nested-ACs migration).
 *
 * Splits the legacy stories input (`design/acceptance-criteria.json` — already
 * story-shaped, decision 6) into one canonical file per story under
 * `.uxfactory/artifacts/stories/`, stubs a persona per distinct legacy role
 * (so the actor hard-dependency stays satisfiable and the trace graph whole),
 * and flips `inputs.stories` in `uxfactory.batch.json` to the directory.
 *
 * The legacy file is the migration source, not waste — it stays in place;
 * registry-aware path resolution is what switches the gate feed. Idempotent:
 * a directory-valued `inputs.stories` means already migrated (exit 0, no-op).
 */

import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseStoryFile } from "@uxfactory/spec";
import type { CanonicalStory } from "@uxfactory/spec";
import { EXIT } from "../exit.js";
import { readRegistry } from "../batch/registry.js";
import type { IO } from "../io.js";

export interface MigrateStoriesFlags {
  /** Project root — where uxfactory.batch.json lives (default process.cwd()). */
  cwd?: string;
}

const STORIES_DIR = ".uxfactory/artifacts/stories";
const PERSONAS_DIR = ".uxfactory/artifacts/personas";
const LEGACY_STORIES = "design/acceptance-criteria.json";

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const writeJson = (p: string, body: unknown): Promise<void> =>
  writeFile(p, JSON.stringify(body, null, 2) + "\n");

/**
 * Exit codes:
 *   0 — migrated (or already migrated — idempotent no-op)
 *   2 — setup error (registry unreadable/invalid, stories input missing or malformed)
 */
export async function migrateStoriesCmd(flags: MigrateStoriesFlags, io: IO): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const regPath = path.join(cwd, "uxfactory.batch.json");
  const reg = await readRegistry(regPath);
  if (!reg.ok) {
    io.err(`migrate-stories: ${reg.message}`);
    return EXIT.TRANSPORT;
  }
  const sourcePath = reg.inputs.stories ?? path.resolve(cwd, LEGACY_STORIES);

  try {
    if ((await stat(sourcePath)).isDirectory()) {
      io.out(
        "migrate-stories: already migrated — inputs.stories points at a story directory",
      );
      return EXIT.OK;
    }
  } catch {
    io.err(`migrate-stories: cannot read stories input '${sourcePath}'`);
    return EXIT.TRANSPORT;
  }

  // 1. Read + normalize the legacy set (each member through the shared schema).
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  } catch (err) {
    io.err(`migrate-stories: cannot read stories input '${sourcePath}': ${(err as Error).message}`);
    return EXIT.TRANSPORT;
  }
  const members =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)["stories"]
      : undefined;
  if (!Array.isArray(members)) {
    io.err('migrate-stories: malformed stories file: "stories" must be an array');
    return EXIT.TRANSPORT;
  }
  const stories: CanonicalStory[] = [];
  for (const [i, member] of members.entries()) {
    const parsed = parseStoryFile(member);
    if (!parsed.ok) {
      io.err(`migrate-stories: story ${i}: ${parsed.message}`);
      return EXIT.TRANSPORT;
    }
    stories.push(parsed.story);
  }

  // 2. Stub a persona per distinct legacy role — never clobbering existing members.
  const storiesDir = path.join(cwd, STORIES_DIR);
  const personasDir = path.join(cwd, PERSONAS_DIR);
  await mkdir(storiesDir, { recursive: true });
  await mkdir(personasDir, { recursive: true });
  const roles = new Map<string, string>();
  for (const story of stories) {
    if (story.actor !== "" && slug(story.actor) !== "") roles.set(slug(story.actor), story.actor);
  }
  let stubbed = 0;
  for (const [personaId, name] of roles) {
    const personaPath = path.join(personasDir, `${personaId}.json`);
    try {
      await access(personaPath);
      continue; // hand-authored (or previously stubbed) persona wins
    } catch {
      await writeJson(personaPath, {
        personaId,
        name,
        archetype: `migrated from legacy story role "${name}"`,
      });
      stubbed += 1;
    }
  }

  // 3. One canonical file per story; the actor becomes its persona's id.
  for (const story of stories) {
    const actor = slug(story.actor);
    await writeJson(path.join(storiesDir, `${slug(story.storyId)}.json`), { ...story, actor });
  }

  // 4. Flip the registry pointer — raw read/write to preserve unknown fields.
  const regRaw = JSON.parse(await readFile(regPath, "utf8")) as Record<string, unknown>;
  regRaw["inputs"] = {
    ...(regRaw["inputs"] as Record<string, unknown>),
    stories: STORIES_DIR,
  };
  await writeJson(regPath, regRaw);

  io.out(
    `migrate-stories: ${stories.length} stories → ${STORIES_DIR} ` +
      `(${stubbed} persona stub${stubbed === 1 ? "" : "s"} created); legacy file left in place`,
  );
  return EXIT.OK;
}

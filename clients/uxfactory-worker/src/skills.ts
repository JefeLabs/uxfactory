/**
 * loadSkill — read a SKILL.md and return its markdown body as a systemPrompt.
 *
 * The SKILLs ship with the ENGINE (the uxfactory repo's `skill/` dir), NOT with
 * the target project the worker operates on. They are the verbatim instructions a
 * skill-runner agent follows — the worker reuses them unchanged as the adapter's
 * `systemPrompt` (the engine itself stays LLM-free). The YAML frontmatter
 * (name/description/compatibility) is metadata for the host, not instruction, so
 * it is stripped — only the markdown body becomes the prompt.
 *
 * RESOLUTION: `skill/<name>/SKILL.md` is resolved relative to THIS source file,
 * which lives at `clients/uxfactory-worker/src/skills.ts` — so the repo root is
 * three levels up (`../../../`). The worker runs source-first under `tsx`, so
 * `import.meta.url` always points at this real source path; there is no compiled
 * layout to account for. Resolving against the project root would be WRONG: the
 * target project does not carry the engine's skills.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The skills the worker may run as a systemPrompt. */
export type SkillName = 'generate' | 'vision-review' | 'intake' | 'batch' | 'design' | 'craft-review';

/** Resolve `<repo>/skill/<name>/SKILL.md` from this module's location. */
function skillPath(name: SkillName): string {
  return fileURLToPath(new URL(`../../../skill/${name}/SKILL.md`, import.meta.url));
}

/** Read a SKILL.md and return its body (frontmatter stripped) as the systemPrompt. */
export function loadSkill(name: SkillName): string {
  return stripFrontmatter(readFileSync(skillPath(name), 'utf8'));
}

/**
 * Resolve the skill for drafting a SPECIFIC artifact: the specialist skill at
 * `skill/artifacts/<key>/SKILL.md` when it exists, else the generic `generate`
 * skill. Lets each producer be an expert at its one artifact (the single-writer
 * model) while unauthored artifacts keep working through the generalist. The
 * key is sanitized to `[a-z0-9-]+` so an untrusted payload can never traverse.
 */
export function loadArtifactSkill(artifactKey: string): string {
  if (/^[a-z0-9-]+$/.test(artifactKey)) {
    const specialist = fileURLToPath(
      new URL(`../../../skill/artifacts/${artifactKey}/SKILL.md`, import.meta.url),
    );
    if (existsSync(specialist)) return stripFrontmatter(readFileSync(specialist, 'utf8'));
  }
  return loadSkill('generate');
}

/** Drop a leading `---\n…\n---` YAML frontmatter block, if present. */
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? md.slice(m[0].length).replace(/^\s+/, '') : md;
}

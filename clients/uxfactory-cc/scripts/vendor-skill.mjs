import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // clients/uxfactory-cc/scripts
const pkgRoot = path.join(scriptDir, ".."); // clients/uxfactory-cc
const repoRoot = path.join(pkgRoot, "..", ".."); // repo root

// Canonical skill → vendored copy. Claude Code copies a plugin's directory into a
// cache on install and cannot resolve paths outside it (`../`), so each skill must be
// VENDORED here, not symlinked or referenced.
const SKILLS = [
  {
    src: path.join(repoRoot, "skill", "SKILL.md"),
    dest: path.join(pkgRoot, "skills", "uxfactory", "SKILL.md"),
  },
  {
    src: path.join(repoRoot, "skill", "batch", "SKILL.md"),
    dest: path.join(pkgRoot, "skills", "uxfactory-batch", "SKILL.md"),
  },
];

export async function vendorSkill() {
  for (const { src, dest } of SKILLS) {
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    console.log(`vendored skill: ${src} -> ${dest}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  vendorSkill().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

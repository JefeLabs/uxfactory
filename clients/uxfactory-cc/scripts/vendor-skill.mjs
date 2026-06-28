import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // clients/uxfactory-cc/scripts
const pkgRoot = path.join(scriptDir, ".."); // clients/uxfactory-cc
const repoRoot = path.join(pkgRoot, "..", ".."); // repo root
const SRC = path.join(repoRoot, "skill", "SKILL.md");
const DEST = path.join(pkgRoot, "skills", "uxfactory", "SKILL.md");

// Physically copy the canonical skill into the plugin dir. Claude Code copies a
// plugin's directory into a cache on install and cannot resolve paths outside it
// (`../`), so the skill must be VENDORED here, not symlinked or referenced.
export async function vendorSkill() {
  await mkdir(path.dirname(DEST), { recursive: true });
  await copyFile(SRC, DEST);
  console.log(`vendored skill: ${SRC} -> ${DEST}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  vendorSkill().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

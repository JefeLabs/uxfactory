/**
 * select-publish-bumps.mjs — decide which public packages the weekly npm
 * publish releases, and bump their patch versions in place.
 *
 * Selection: a package publishes when its directory changed since the last
 * `npm-publish/*` tag, OR when a workspace dependency of it was selected
 * (cascade — pnpm rewrites `workspace:*` to exact versions at publish time,
 * so dependents must republish to pin the new release). No prior tag (first
 * run) or FORCE_ALL=1 selects every public package.
 *
 * Effects: edits each selected package.json's `version` (patch bump).
 * Output: writes `selected=<space-separated names>` to $GITHUB_OUTPUT when
 * set, and prints a human plan to stdout. Exits 0 always; empty selection
 * is a normal outcome the workflow reacts to.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

// ── Discover public workspace packages ───────────────────────────────────────
const pkgs = [];
for (const dir of readdirSync(join(ROOT, "packages"))) {
  const manifestPath = join(ROOT, "packages", dir, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    continue;
  }
  if (manifest.private === true) continue;
  const workspaceDeps = Object.entries({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  })
    .filter(([, v]) => typeof v === "string" && v.startsWith("workspace:"))
    .map(([k]) => k);
  pkgs.push({ name: manifest.name, dir: `packages/${dir}`, manifestPath, manifest, workspaceDeps });
}

// ── Find the last publish tag ────────────────────────────────────────────────
let lastTag = null;
try {
  const tags = git("tag", "--list", "npm-publish/*", "--sort=-creatordate");
  lastTag = tags.split("\n").filter(Boolean)[0] ?? null;
} catch {
  lastTag = null;
}

// ── Select: changed since tag, then cascade to dependents ────────────────────
const forceAll = process.env.FORCE_ALL === "1";
const selected = new Set();

if (forceAll || lastTag === null) {
  for (const p of pkgs) selected.add(p.name);
  console.log(forceAll ? "FORCE_ALL: selecting every public package" : "No npm-publish/* tag found (first run): selecting every public package");
} else {
  console.log(`Comparing against last publish tag: ${lastTag}`);
  for (const p of pkgs) {
    try {
      execFileSync("git", ["diff", "--quiet", `${lastTag}..HEAD`, "--", p.dir], { cwd: ROOT });
    } catch {
      selected.add(p.name); // non-zero exit = changes present
    }
  }
  // Cascade: dependents of selected packages republish so exact pins stay fresh.
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pkgs) {
      if (selected.has(p.name)) continue;
      if (p.workspaceDeps.some((d) => selected.has(d))) {
        selected.add(p.name);
        grew = true;
      }
    }
  }
}

// ── Bump patch versions in place ─────────────────────────────────────────────
const plan = [];
for (const p of pkgs) {
  if (!selected.has(p.name)) continue;
  const [maj, min, pat] = p.manifest.version.split(".").map(Number);
  const next = `${maj}.${min}.${pat + 1}`;
  plan.push(`${p.name}  ${p.manifest.version} → ${next}`);
  p.manifest.version = next;
  writeFileSync(p.manifestPath, JSON.stringify(p.manifest, null, 2) + "\n", "utf8");
}

console.log(plan.length ? `Publishing:\n  ${plan.join("\n  ")}` : "No public package changed since the last publish — nothing to do.");

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `selected=${[...selected].join(" ")}\n`);
}

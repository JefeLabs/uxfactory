# Phase 3 — `SKILL.md` + `uxfactory-cc` (Claude Code plugin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Component 1 — the canonical agent skill at `skill/SKILL.md` — and Component 5 — `uxfactory-cc`, an MCP-free Claude Code plugin (manifest + marketplace entry + vendored skill + slash commands + sync/drift hooks) that drives the `uxfactory` CLI over Bash.

**Architecture:** The canonical skill is a single CLI-first `skill/SKILL.md` at the repo root (copied from the already-accurate `.plans/SKILL.md` with one path fix). `uxfactory-cc` is a Claude Code plugin under `clients/uxfactory-cc/` that auto-discovers its components from convention dirs (`skills/`, `commands/`, `hooks/`) and ships NO `.mcp.json` — the CLI is its entire tool surface. The skill is **vendored** (physically copied, never symlinked) into `skills/uxfactory/SKILL.md` by `scripts/vendor-skill.mjs`, because Claude Code copies a plugin's directory into a cache on install and cannot reach outside it. Hook automation lives in two `.mjs` scripts whose pure decision logic is exported and unit-tested directly, with an import-guarded `main()` so importing a script in a test never spawns the CLI.

**Tech Stack:** Node `>=20.10`, ESM only; the plugin is `"private": true` (distributed via the Claude Code marketplace, not npm). Build/automation are plain `.mjs` Node scripts with hand-written `.d.mts` declarations (the established monorepo convention). Tests are Vitest 4.1.9 `.ts` files run from the root config (which already globs `clients/**/test`), reading files from disk and importing the `.mjs` scripts. Typecheck via a per-package `tsconfig.typecheck.json` + `typecheck` script; `@types/node@26.0.1` is the only devDep.

## Global Constraints

- Node `>=20.10`; ESM; the cc package is `"private": true` (not published to npm; distributed via the Claude Code marketplace). Tests are Vitest (`.ts`), reading files from disk; `@types/node` devDep; a `tsconfig.typecheck.json` (include test) + `typecheck` script per convention.
- The canonical skill lives at `skill/SKILL.md`. It is VENDORED (physically copied) into `clients/uxfactory-cc/skills/uxfactory/SKILL.md` by a build step (`scripts/vendor-skill.mjs`) — NOT symlinked/referenced (installed Claude Code plugins are copied to a cache and cannot reach outside their own dir). The vendored copy MUST byte-match the canonical after the vendor step.
- `uxfactory-cc` is MCP-FREE: there is NO `.mcp.json`. The CLI is the tool surface; commands/hooks shell out to the `uxfactory` CLI.
- SKILL.md: YAML frontmatter `name: uxfactory` + a triggering `description`; under ~500 lines; documents the spec format (3 shapes w/ examples), the publish→verify loop, surgical edits, selection, exit codes (0/1/2), and the gotchas (deterministic, localhost-only, one bad edit ≠ failed batch, undo bounded). (The existing `.plans/SKILL.md` already satisfies this.)

### Monorepo conventions (established — follow exactly)

- `clients/*` is already in `pnpm-workspace.yaml`; the root `vitest.config.ts` already globs `clients/**/test/**/*.test.ts`. **No root config edits are needed** for `uxfactory-cc`.
- Automation scripts are `.mjs` with a sibling hand-written `.d.mts` declaration (see `packages/uxfactory-plugin/scripts/build-plugin.mjs` + `.d.mts`). The test imports the `.mjs` and TS resolves the adjacent `.d.mts` for types — the `scripts/` dir is NOT in `include`; resolution pulls the `.d.mts` in via the test's import.
- `main()` (the directly-executed entrypoint of each `.mjs`) MUST be import-guarded so importing the module in a test does not run it. The plugin uses `if (import.meta.url === \`file://${process.argv[1]}\`)`; this plan uses the more robust `if (import.meta.url === pathToFileURL(process.argv[1]).href) main()`.
- Vitest is a ROOT devDep; tests `import { describe, it, expect } from "vitest"` and it resolves via NodeNext walk-up to root `node_modules` (same as every existing package). No per-package vitest dep.
- Commit scoped per task (`git add skill test/skill.test.ts` for Task 1; `git add clients/uxfactory-cc` for Tasks 2–4); never `git add -A`. End commit messages with the Co-Authored-By trailer.
- Run a single test file with `pnpm vitest run <path>` and the whole suite with `pnpm test`.

### CONFIRMED Claude Code plugin format (use these EXACT shapes)

- **`.claude-plugin/plugin.json`** — manifest. Components (skills/commands/hooks) auto-discover from convention dirs; no declarations needed.
- **`.claude-plugin/marketplace.json`** — catalog entry; `plugins[].source` is `"./"` (the plugin lives at the marketplace root).
- **`commands/<name>.md`** — slash command; YAML frontmatter with `description`, `argument-hint` (where args apply), `allowed-tools: Bash(uxfactory:*)`; body uses `$ARGUMENTS`. Invocation is `/uxfactory:<name>`.
- **`hooks/hooks.json`** — the matcher matches TOOL NAMES only (`Write|Edit`); file-path filtering (`*.uxfactory.json`) happens IN the script, which reads the hook JSON from STDIN (`tool_input.file_path`). Hook scripts emit hook output JSON on stdout (`{ "systemMessage": "…" }` or `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "…" } }`) or exit `2` to surface a blocking message. Commands use `${CLAUDE_PLUGIN_ROOT}` to locate the scripts inside the installed cache copy.

---

## Task 1: `skill/SKILL.md` — canonical agent skill (Component 1)

Copy the already-accurate, CLI-first `.plans/SKILL.md` to `skill/SKILL.md` and apply the single accuracy fix: the schema path is `packages/uxfactory-spec/schema/uxfactory.schema.json` (not the bare `uxfactory-spec/schema/…`). The skill already documents the working CLI set (bridge / publish / verify / selection / scan / lint) and does not reference the roadmap stubs (map/drift/render/batch/review) — leave it that way. Preserve all frontmatter (`name: uxfactory`, the triggering `description`, the `compatibility` line).

**Files:**

- Create: `skill/SKILL.md` (copy of `.plans/SKILL.md` + one edit)
- Test: `test/skill.test.ts` (root `test/` dir; the root `vitest.config.ts` globs `test/**/*.test.ts`)

**Interfaces:** none (a static deliverable). The skill's frontmatter `name`/`description` and section headings are the contract the test asserts.

- [ ] **Step 1: Write the failing test**

`test/skill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const skillPath = fileURLToPath(new URL("../skill/SKILL.md", import.meta.url));

describe("skill/SKILL.md (canonical agent skill)", () => {
  it("carries the triggering frontmatter and stays under 500 lines", async () => {
    const content = await readFile(skillPath, "utf8");
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fm, "must open with YAML frontmatter").not.toBeNull();
    const front = fm![1];
    expect(front).toMatch(/^name:\s*uxfactory\s*$/m);
    expect(front).toMatch(/^description:\s*\S+/m); // non-empty triggering description
    expect(content.split("\n").length).toBeLessThan(500);
  });

  it("documents the spec format, publish/verify loop, exit codes, and gotchas", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain("## The spec format");
    expect(content).toContain("## Surgical edits");
    expect(content).toContain("uxfactory selection");
    expect(content).toContain("## Publishing");
    expect(content).toContain("## Verifying");
    expect(content).toContain("Exit codes");
    expect(content).toContain("`0`");
    expect(content).toContain("`1`");
    expect(content).toContain("`2`");
    expect(content).toContain("## Gotchas worth internalizing");
  });

  it("references the schema at its real package path (no stale path)", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain("packages/uxfactory-spec/schema/uxfactory.schema.json");
    // The stale form is `uxfactory-spec/schema` NOT preceded by a slash
    // (the corrected `packages/uxfactory-spec/schema` always is).
    expect(content).not.toMatch(/(^|[^/])uxfactory-spec\/schema/);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run test/skill.test.ts`
Expected: FAIL — `skill/SKILL.md` does not exist yet (`ENOENT`).

- [ ] **Step 3: Vendor the canonical skill from `.plans/SKILL.md`**

Do NOT re-author the 157-line skill. Copy it verbatim, then apply the one accuracy edit. From the repo root:

```bash
mkdir -p skill
cp .plans/SKILL.md skill/SKILL.md
```

- [ ] **Step 4: Apply the schema-path accuracy fix**

In `skill/SKILL.md`, the one line that needs correcting is line 30 (the "## The spec format" intro). Replace exactly:

- OLD: `A spec is one of three shapes. The authoritative contract is the JSON Schema (\`uxfactory-spec/schema/uxfactory.schema.json\`); run \`uxfactory lint <spec.json>\` to validate before publishing.`
- NEW: `A spec is one of three shapes. The authoritative contract is the JSON Schema (\`packages/uxfactory-spec/schema/uxfactory.schema.json\`); run \`uxfactory lint <spec.json>\` to validate before publishing.`

(Only `uxfactory-spec/schema/…` → `packages/uxfactory-spec/schema/…` changes. Make no other edits — the file already documents exactly the working CLI command set and omits the roadmap stubs, which is correct.)

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm vitest run test/skill.test.ts`
Expected: PASS — frontmatter present, < 500 lines (the file is ~157), all sections present, schema path corrected, no stale path.

- [ ] **Step 6: Commit**

```bash
git add skill/SKILL.md test/skill.test.ts
git commit
```

(Commit message: `feat(skill): add canonical uxfactory SKILL.md with schema-path fix`. End with the Co-Authored-By trailer.)

---

## Task 2: `clients/uxfactory-cc/` scaffold — manifest, marketplace, vendor step, README (Component 5 base)

Create the plugin package: `package.json` (private), a single `tsconfig.typecheck.json`, the two `.claude-plugin/*.json` manifests, the README, and `scripts/vendor-skill.mjs` (+ `.d.mts`). Run the vendor step to produce the committed `skills/uxfactory/SKILL.md`. Prove the manifests are well-formed, that NO `.mcp.json` exists, and that the vendored skill byte-matches the canonical after vendoring.

**Files:**

- Create: `clients/uxfactory-cc/package.json`
- Create: `clients/uxfactory-cc/tsconfig.typecheck.json`
- Create: `clients/uxfactory-cc/.claude-plugin/plugin.json`
- Create: `clients/uxfactory-cc/.claude-plugin/marketplace.json`
- Create: `clients/uxfactory-cc/README.md`
- Create: `clients/uxfactory-cc/scripts/vendor-skill.mjs`
- Create: `clients/uxfactory-cc/scripts/vendor-skill.d.mts`
- Produce (by running the vendor step): `clients/uxfactory-cc/skills/uxfactory/SKILL.md`
- Test: `clients/uxfactory-cc/test/scaffold.test.ts`

**Interfaces:**

- Produces (`scripts/vendor-skill.mjs`): `vendorSkill(): Promise<void>` — copies repo-root `skill/SKILL.md` → `clients/uxfactory-cc/skills/uxfactory/SKILL.md`; also runs when executed directly (`node scripts/vendor-skill.mjs`).

- [ ] **Step 1: Write the failing test**

`clients/uxfactory-cc/test/scaffold.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vendorSkill } from "../scripts/vendor-skill.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url)); // clients/uxfactory-cc/
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)); // repo root

describe("plugin manifest", () => {
  it("plugin.json has the required Claude Code plugin fields", async () => {
    const m = JSON.parse(await readFile(`${pkgRoot}.claude-plugin/plugin.json`, "utf8"));
    expect(m.name).toBe("uxfactory");
    expect(typeof m.version).toBe("string");
    expect(m.description).toBeTruthy();
    expect(m.author).toMatchObject({ name: "JefeLabs" });
    expect(m.license).toBe("MIT");
    expect(Array.isArray(m.keywords)).toBe(true);
  });

  it("marketplace.json lists the uxfactory plugin with a local source", async () => {
    const mk = JSON.parse(await readFile(`${pkgRoot}.claude-plugin/marketplace.json`, "utf8"));
    expect(mk.name).toBe("uxfactory");
    expect(mk.owner).toMatchObject({ name: "JefeLabs" });
    expect(Array.isArray(mk.plugins)).toBe(true);
    const entry = mk.plugins.find((p: { name: string }) => p.name === "uxfactory");
    expect(entry).toBeTruthy();
    expect(entry.source).toBe("./");
  });
});

describe("MCP-free", () => {
  it("ships no .mcp.json", () => {
    expect(existsSync(`${pkgRoot}.mcp.json`)).toBe(false);
    expect(existsSync(`${pkgRoot}.claude-plugin/.mcp.json`)).toBe(false);
  });
});

describe("vendored skill", () => {
  it("byte-matches the canonical skill after vendoring", async () => {
    await vendorSkill();
    const canonical = await readFile(`${repoRoot}skill/SKILL.md`);
    const vendored = await readFile(`${pkgRoot}skills/uxfactory/SKILL.md`);
    expect(vendored.equals(canonical)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run clients/uxfactory-cc/test/scaffold.test.ts`
Expected: FAIL — the package, manifests, and `vendor-skill.mjs` do not exist yet.

- [ ] **Step 3: Create `package.json`**

`clients/uxfactory-cc/package.json`:

```json
{
  "name": "uxfactory-cc",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "engines": {
    "node": ">=20.10"
  },
  "scripts": {
    "build": "node scripts/vendor-skill.mjs",
    "typecheck": "tsc -p tsconfig.typecheck.json"
  },
  "devDependencies": {
    "@types/node": "26.0.1"
  }
}
```

- [ ] **Step 4: Create `tsconfig.typecheck.json`**

There is no compilable TS source in this package (only `.mjs` scripts with hand-written `.d.mts`, plus tests), so a single typecheck config that extends the base directly is sufficient.

`clients/uxfactory-cc/tsconfig.typecheck.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "..",
    "types": ["node"]
  },
  "include": ["test"]
}
```

- [ ] **Step 5: Create the two `.claude-plugin` manifests**

`clients/uxfactory-cc/.claude-plugin/plugin.json`:

```json
{
  "name": "uxfactory",
  "version": "0.1.0",
  "description": "Design-as-code for Figma: render and verify structured diagrams (architecture, deployment, retro boards, release flows) from JSON specs by driving the uxfactory CLI.",
  "author": { "name": "JefeLabs", "url": "https://github.com/uxfactory" },
  "homepage": "https://uxfactory.dev",
  "repository": "https://github.com/uxfactory/uxfactory",
  "license": "MIT",
  "keywords": ["figma", "design-as-code", "diagrams", "architecture", "verification"]
}
```

`clients/uxfactory-cc/.claude-plugin/marketplace.json`:

```json
{
  "name": "uxfactory",
  "owner": { "name": "JefeLabs", "url": "https://github.com/uxfactory" },
  "description": "UXFactory — design-as-code rendering and verification for Figma, driven from Claude Code.",
  "plugins": [
    {
      "name": "uxfactory",
      "source": "./",
      "description": "Render and verify structured Figma diagrams from JSON specs via the uxfactory CLI; bundles the skill, slash commands, and sync/drift hooks.",
      "version": "0.1.0"
    }
  ]
}
```

- [ ] **Step 6: Create `scripts/vendor-skill.mjs` (+ `.d.mts`)**

`clients/uxfactory-cc/scripts/vendor-skill.mjs`:

```js
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
```

`clients/uxfactory-cc/scripts/vendor-skill.d.mts`:

```ts
export declare function vendorSkill(): Promise<void>;
```

- [ ] **Step 7: Run the vendor step to produce the committed copy**

```bash
node clients/uxfactory-cc/scripts/vendor-skill.mjs
```

Expected output: `vendored skill: …/skill/SKILL.md -> …/clients/uxfactory-cc/skills/uxfactory/SKILL.md`. This produces `clients/uxfactory-cc/skills/uxfactory/SKILL.md`, which IS committed (the marketplace install ships it).

- [ ] **Step 8: Create `README.md`**

`clients/uxfactory-cc/README.md`:

````md
# uxfactory-cc — UXFactory for Claude Code

The Claude Code plugin for [UXFactory](https://uxfactory.dev): render and verify
structured Figma/FigJam diagrams (architecture, deployment topologies, retro
boards, release flows) from JSON specs — design-as-code, gated PASS/FAIL.

It is **MCP-free**: it ships no tool server. Instead it teaches Claude Code to
drive the `uxfactory` CLI over Bash, bundling the UXFactory skill, slash
commands, and two hooks (sync-on-edit + drift-notify).

## Install

```bash
# 1. Add the marketplace (this repo)
/plugin marketplace add uxfactory/uxfactory

# 2. Install the plugin
/plugin install uxfactory@uxfactory
```

## Prerequisites

This plugin orchestrates the local UXFactory loop — it does not replace it.

1. **The CLI.** The plugin shells out to the published CLI; install it or use
   `npx`: `npm i -g uxfactory` (or rely on `npx uxfactory`).
2. **The bridge.** Start the localhost relay with `/uxfactory:bridge` (it runs
   `uxfactory bridge` on `localhost:3779`).
3. **The Figma plugin.** Open the `uxfactory-plugin` in the target Figma/FigJam
   file so it polls the bridge. Without it, publishes time out (CLI exit `2`).

## Bash permission (the trade for dropping MCP)

The slash commands declare `allowed-tools: Bash(uxfactory:*)` so they run without
a generic shell prompt. So the skill-driven calls and **both hooks** run
unprompted, allowlist the binary in your Claude Code settings:

```json
{ "permissions": { "allow": ["Bash(uxfactory:*)"] } }
```

## What it bundles

- `skills/uxfactory/SKILL.md` — the UXFactory skill (vendored from the
  monorepo's canonical `skill/SKILL.md`).
- `commands/` — `/uxfactory:bridge`, `:publish`, `:verify`, `:scan`, `:status`.
- `hooks/hooks.json` — `PostToolUse(Write|Edit)` re-renders `*.uxfactory.json`
  edits; `SessionStart` surfaces spec-vs-reality drift.
````

- [ ] **Step 9: Run the test to confirm it passes**

Run: `pnpm vitest run clients/uxfactory-cc/test/scaffold.test.ts`
Expected: PASS — manifests parse and carry the required fields, no `.mcp.json` exists, the vendored skill byte-matches the canonical.

- [ ] **Step 10: Typecheck and commit**

```bash
pnpm --filter uxfactory-cc typecheck
git add clients/uxfactory-cc
git commit
```

(Typecheck should pass — `vendor-skill.d.mts` types the imported `.mjs`; the test uses only `@types/node` + vitest. Commit message: `feat(cc): scaffold uxfactory-cc plugin (manifest, marketplace, vendored skill)`.)

---

## Task 3: `commands/*.md` — the five slash commands

Add the five thin CLI-wrapper slash commands. Each is a markdown file with YAML frontmatter (`description`, `argument-hint` where args apply, `allowed-tools: Bash(uxfactory:*)`) and a body that instructs Claude to run the exact `uxfactory …` invocation (using `$ARGUMENTS` where applicable). Bodies use inline-code invocations (single backticks), not fenced blocks, to keep them unambiguous.

**Files:**

- Create: `clients/uxfactory-cc/commands/bridge.md`
- Create: `clients/uxfactory-cc/commands/publish.md`
- Create: `clients/uxfactory-cc/commands/verify.md`
- Create: `clients/uxfactory-cc/commands/scan.md`
- Create: `clients/uxfactory-cc/commands/status.md`
- Test: `clients/uxfactory-cc/test/commands.test.ts`

**Interfaces:** each command file is `/uxfactory:<name>`. Mapping: `bridge`→`uxfactory bridge`; `publish`→`uxfactory publish $ARGUMENTS --wait`; `verify`→`uxfactory verify $ARGUMENTS`; `scan`→`uxfactory scan`; `status`→a liveness/connection probe (`uxfactory selection`) + the raw `GET /health` check.

- [ ] **Step 1: Write the failing test**

`clients/uxfactory-cc/test/commands.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const cmdDir = fileURLToPath(new URL("../commands/", import.meta.url));

function split(src: string): { fm: string; body: string } | null {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : null;
}

const cases = [
  { file: "bridge.md", argHint: false, body: ["uxfactory bridge"] },
  { file: "publish.md", argHint: true, body: ["uxfactory publish", "$ARGUMENTS", "--wait"] },
  { file: "verify.md", argHint: true, body: ["uxfactory verify", "$ARGUMENTS"] },
  { file: "scan.md", argHint: false, body: ["uxfactory scan"] },
  { file: "status.md", argHint: false, body: ["/health", "uxfactory"] },
];

describe("slash commands", () => {
  for (const c of cases) {
    it(`${c.file} is a well-formed uxfactory command`, async () => {
      const parsed = split(await readFile(`${cmdDir}${c.file}`, "utf8"));
      expect(parsed, `${c.file} must have YAML frontmatter`).not.toBeNull();
      const { fm, body } = parsed!;
      expect(fm).toContain("allowed-tools: Bash(uxfactory:*)");
      expect(fm).toMatch(/description:\s*\S+/);
      if (c.argHint) expect(fm).toMatch(/argument-hint:\s*\S+/);
      for (const needle of c.body) expect(body).toContain(needle);
    });
  }
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run clients/uxfactory-cc/test/commands.test.ts`
Expected: FAIL — none of the command files exist yet.

- [ ] **Step 3: Create `commands/bridge.md`**

```md
---
description: Start the local UXFactory bridge relay on localhost:3779
allowed-tools: Bash(uxfactory:*)
---

Start the UXFactory bridge — the localhost relay the Figma plugin polls. Run `uxfactory bridge` (override the port with `--port` or `UXFACTORY_PORT`).

The bridge foregrounds the relay, so keep it running in its own terminal. Once it is up, confirm `GET http://localhost:3779/health` returns `{ ok: true }`, then open the UXFactory Figma plugin in the target file so it connects.
```

- [ ] **Step 4: Create `commands/publish.md`**

```md
---
description: Publish a UXFactory spec to the connected Figma file and wait for the render report
argument-hint: <spec.json>
allowed-tools: Bash(uxfactory:*)
---

Render the given UXFactory spec to the connected Figma/FigJam canvas and block until the render report lands. Run `uxfactory publish $ARGUMENTS --wait`.

Rendering is deterministic and idempotent — re-publishing the same spec is safe. If the call exits `2`, the bridge is down (`/uxfactory:bridge`) or the Figma plugin is not open; surface that to the user rather than retrying blindly. To gate the result PASS/FAIL after rendering, follow with `/uxfactory:verify $ARGUMENTS`.
```

- [ ] **Step 5: Create `commands/verify.md`**

```md
---
description: Gate the latest render against a UXFactory spec, PASS/FAIL
argument-hint: <spec.json>
allowed-tools: Bash(uxfactory:*)
---

Gate the most recent render against the given spec via the bridge's `POST /verify`. Run `uxfactory verify $ARGUMENTS`.

Interpret the exit code: `0` = PASS (done); `1` = FAIL — read the `failures[]`, correct the spec to match intent, and re-publish; `2` = transport/setup error (bridge down or plugin not open) — fix the environment, do NOT treat it as drift. Add `--json` for structured output.
```

- [ ] **Step 6: Create `commands/scan.md`**

```md
---
description: Rebuild the UXFactory asset catalog (friendly name → component key)
allowed-tools: Bash(uxfactory:*)
---

Rebuild the asset catalog that resolves friendly asset names (e.g. `aws:lambda`, `k8s:pod`, `gcp:pubsub`) to Figma component keys. Run `uxfactory scan`.

It writes `.uxfactory/catalog.json`. Run this whenever an `asset` name in a spec fails to resolve, or after the published asset library changes.
```

- [ ] **Step 7: Create `commands/status.md`**

```md
---
description: Confirm the UXFactory loop is live (bridge up + Figma plugin connected)
allowed-tools: Bash(uxfactory:*)
---

Confirm the UXFactory loop is live before publishing. Run `uxfactory selection` — it reads the current Figma selection over the bridge's REST API, so it doubles as a health + plugin-connection probe:

- exit `0` (a selection result) → the bridge is up AND the Figma plugin is connected to the target file;
- exit `2` → the bridge is not running (start it with `/uxfactory:bridge`) or the Figma plugin is not open.

For a raw liveness check independent of the plugin, the bridge also serves `GET http://localhost:3779/health`, which returns `{ ok: true, pending }` when the relay is running.
```

- [ ] **Step 8: Run the test to confirm it passes**

Run: `pnpm vitest run clients/uxfactory-cc/test/commands.test.ts`
Expected: PASS — all five files parse, declare the scoped Bash permission and a description, carry `argument-hint` where args apply, and reference the right invocation in the body.

- [ ] **Step 9: Commit**

```bash
git add clients/uxfactory-cc/commands clients/uxfactory-cc/test/commands.test.ts
git commit
```

(Commit message: `feat(cc): add bridge/publish/verify/scan/status slash commands`.)

---

## Task 4: `hooks/hooks.json` + hook scripts (sync-on-edit, drift-notify)

Wire the two hooks and their scripts. `hooks.json` matches on TOOL NAMES (`Write|Edit` for PostToolUse; SessionStart needs no matcher); the file-path filter (`*.uxfactory.json`) lives in `sync-on-edit.mjs`. Each script exports its pure decision logic for direct unit testing and keeps `main()` import-guarded so importing the module never spawns the CLI. NOTE: `uxfactory drift` is a STUB until Phase 4 — the drift-notify hook is wired now and becomes functional when `drift` lands; the hook stays silent (emits nothing) when the CLI errors or is unavailable.

**Files:**

- Create: `clients/uxfactory-cc/hooks/hooks.json`
- Create: `clients/uxfactory-cc/scripts/sync-on-edit.mjs`
- Create: `clients/uxfactory-cc/scripts/sync-on-edit.d.mts`
- Create: `clients/uxfactory-cc/scripts/drift-notify.mjs`
- Create: `clients/uxfactory-cc/scripts/drift-notify.d.mts`
- Test: `clients/uxfactory-cc/test/hooks.test.ts`

**Interfaces:**

- Produces (`sync-on-edit.mjs`): `shouldSync(filePath: string): boolean` (true iff `endsWith(".uxfactory.json")`); `buildSyncCommand(filePath: string): string[]` → `["uxfactory","publish","--verify", filePath]`; `main(): Promise<void>` (reads stdin, filters, spawns, emits hook output).
- Produces (`drift-notify.mjs`): `buildDriftCommand(): string[]` → `["uxfactory","drift","--json"]`; `formatDriftContext(result): string`; `main(): Promise<void>` (runs the CLI, emits `additionalContext`).

- [ ] **Step 1: Write the failing test**

`clients/uxfactory-cc/test/hooks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { shouldSync, buildSyncCommand, main as syncMain } from "../scripts/sync-on-edit.mjs";
import {
  buildDriftCommand,
  formatDriftContext,
  main as driftMain,
} from "../scripts/drift-notify.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

describe("hooks.json", () => {
  it("wires PostToolUse(Write|Edit) → sync-on-edit and SessionStart → drift-notify", async () => {
    const hooks = JSON.parse(await readFile(`${pkgRoot}hooks/hooks.json`, "utf8"));
    const post = hooks.hooks.PostToolUse[0];
    expect(post.matcher).toBe("Write|Edit");
    expect(post.hooks[0].type).toBe("command");
    expect(post.hooks[0].command).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(post.hooks[0].command).toContain("scripts/sync-on-edit.mjs");
    const start = hooks.hooks.SessionStart[0];
    expect(start.hooks[0].type).toBe("command");
    expect(start.hooks[0].command).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(start.hooks[0].command).toContain("scripts/drift-notify.mjs");
  });
});

describe("shouldSync", () => {
  it("matches only *.uxfactory.json", () => {
    expect(shouldSync("deployment.uxfactory.json")).toBe(true);
    expect(shouldSync("/abs/path/x.uxfactory.json")).toBe(true);
    expect(shouldSync("x.json")).toBe(false);
    expect(shouldSync("x.uxfactoryXjson")).toBe(false);
    expect(shouldSync("uxfactory.json")).toBe(false);
  });
});

describe("command builders", () => {
  it("buildSyncCommand returns the publish --verify invocation", () => {
    expect(buildSyncCommand("a.uxfactory.json")).toEqual([
      "uxfactory",
      "publish",
      "--verify",
      "a.uxfactory.json",
    ]);
  });
  it("buildDriftCommand returns the drift --json invocation", () => {
    expect(buildDriftCommand()).toEqual(["uxfactory", "drift", "--json"]);
  });
});

describe("formatDriftContext", () => {
  it("reports clean when there are no findings", () => {
    expect(formatDriftContext({ findings: [] })).toContain("no drift");
    expect(formatDriftContext(null)).toContain("no drift report");
  });
  it("lists findings when present", () => {
    const ctx = formatDriftContext({
      findings: [{ component: "api-gateway", kind: "deleted-but-diagrammed" }],
    });
    expect(ctx).toContain("api-gateway");
    expect(ctx).toContain("deleted-but-diagrammed");
  });
});

describe("import guard", () => {
  it("importing the hook modules does not execute main()", () => {
    // If main() ran on import, sync's readStdin() would attach to process.stdin
    // and hang the worker, and both would spawn the CLI. Reaching this assertion
    // (the suite did not hang) proves the modules imported inertly.
    expect(typeof syncMain).toBe("function");
    expect(typeof driftMain).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run clients/uxfactory-cc/test/hooks.test.ts`
Expected: FAIL — `hooks/hooks.json` and the two scripts do not exist yet (import resolution fails).

- [ ] **Step 3: Create `hooks/hooks.json`**

`clients/uxfactory-cc/hooks/hooks.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/sync-on-edit.mjs\"",
            "timeout": 120
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/drift-notify.mjs\"",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Create `scripts/sync-on-edit.mjs` (+ `.d.mts`)**

`clients/uxfactory-cc/scripts/sync-on-edit.mjs`:

```js
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SPEC_SUFFIX = ".uxfactory.json";

/** True iff the edited path is a UXFactory spec file (the sync-on-edit filter). */
export function shouldSync(filePath) {
  return typeof filePath === "string" && filePath.endsWith(SPEC_SUFFIX);
}

/** The CLI invocation that re-renders and gates a spec: publish --verify <file>. */
export function buildSyncCommand(filePath) {
  return ["uxfactory", "publish", "--verify", filePath];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function emit(systemMessage) {
  process.stdout.write(JSON.stringify({ systemMessage }));
}

export async function main() {
  let input;
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    input = {};
  }
  const filePath = input?.tool_input?.file_path;
  if (!shouldSync(filePath)) return; // not a spec edit — stay silent

  const [cmd, ...args] = buildSyncCommand(filePath);
  const res = spawnSync(cmd, args, { encoding: "utf8" });

  if (res.error || res.status === 2) {
    emit(
      `UXFactory: could not sync ${filePath} — the bridge is down or the Figma plugin is not open (run /uxfactory:bridge and open the plugin). ${
        res.stderr ?? res.error?.message ?? ""
      }`.trim(),
    );
    return;
  }
  if (res.status === 1) {
    emit(
      `UXFactory: gate FAIL after publishing ${filePath}. Review the failures and correct the spec, then re-edit.\n${res.stdout ?? ""}`.trim(),
    );
    return;
  }
  emit(`UXFactory: ${filePath} published and verified (PASS).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(String(err?.stack ?? err));
    process.exit(1);
  });
}
```

`clients/uxfactory-cc/scripts/sync-on-edit.d.mts`:

```ts
export declare function shouldSync(filePath: string): boolean;
export declare function buildSyncCommand(filePath: string): string[];
export declare function main(): Promise<void>;
```

- [ ] **Step 5: Create `scripts/drift-notify.mjs` (+ `.d.mts`)**

`clients/uxfactory-cc/scripts/drift-notify.mjs`:

```js
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** The CLI invocation that reports spec-vs-reality drift as JSON. */
export function buildDriftCommand() {
  return ["uxfactory", "drift", "--json"];
}

/** Turn a `uxfactory drift --json` result into SessionStart additionalContext. */
export function formatDriftContext(result) {
  if (!result || typeof result !== "object") {
    return "UXFactory drift check: no drift report available.";
  }
  const findings = Array.isArray(result.findings) ? result.findings : [];
  if (findings.length === 0) {
    return "UXFactory drift check: no drift detected — diagrams match their sources.";
  }
  const lines = findings.map(
    (f) =>
      `- ${f.component ?? f.node ?? "(unknown)"}: ${f.kind ?? "drift"}${f.detail ? ` — ${f.detail}` : ""}`,
  );
  return [
    `UXFactory drift check: ${findings.length} finding(s) — diagrams may be stale:`,
    ...lines,
    "Ask the user whether to re-render and verify the affected specs.",
  ].join("\n");
}

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
    }),
  );
}

export async function main() {
  const [cmd, ...args] = buildDriftCommand();
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  // `uxfactory drift` is a stub until Phase 4; stay silent if the CLI is
  // unavailable (exit/spawn error) or reports a transport/setup error (exit 2).
  if (res.error || res.status === 2) return;
  let result = null;
  try {
    result = JSON.parse(res.stdout || "null");
  } catch {
    result = null;
  }
  emit(formatDriftContext(result));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(String(err?.stack ?? err));
    process.exit(1);
  });
}
```

`clients/uxfactory-cc/scripts/drift-notify.d.mts`:

```ts
export interface DriftFinding {
  component?: string;
  node?: string;
  kind?: string;
  detail?: string;
}
export interface DriftResult {
  findings?: DriftFinding[];
}
export declare function buildDriftCommand(): string[];
export declare function formatDriftContext(result: DriftResult | null | undefined): string;
export declare function main(): Promise<void>;
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `pnpm vitest run clients/uxfactory-cc/test/hooks.test.ts`
Expected: PASS — `hooks.json` carries both entries with the `${CLAUDE_PLUGIN_ROOT}` node commands; `shouldSync` discriminates `.uxfactory.json` correctly; both command builders return the exact arg arrays; `formatDriftContext` handles clean/empty/null and findings; importing the modules does not run `main()` (the suite completes without hanging).

- [ ] **Step 7: Typecheck the whole package and run the full suite**

```bash
pnpm --filter uxfactory-cc typecheck
pnpm vitest run clients/uxfactory-cc/test test/skill.test.ts
```

Expected: typecheck clean (the `.d.mts` declarations type the imported `.mjs`; tests use only `@types/node` + vitest); all cc tests + the skill test pass.

- [ ] **Step 8: Commit**

```bash
git add clients/uxfactory-cc/hooks clients/uxfactory-cc/scripts clients/uxfactory-cc/test/hooks.test.ts
git commit
```

(Commit message: `feat(cc): add sync-on-edit + drift-notify hooks with testable pure logic`.)

---

## Self-Review

**1. Spec coverage** (against PRD §4 SKILL.md requirements, §8 uxfactory-cc, §18 repo layout, §19 DoD, and the CONFIRMED plugin format):

- §4 / §19 SKILL.md — frontmatter (`name: uxfactory` + triggering `description`), < 500 lines, spec format (3 shapes w/ examples), publish→verify loop, surgical edits + selection, exit codes 0/1/2, gotchas → Task 1 vendors the already-compliant `.plans/SKILL.md` and the test asserts each of these. The one accuracy fix (schema path → `packages/uxfactory-spec/schema/…`) matches the real on-disk schema (`packages/uxfactory-spec/schema/uxfactory.schema.json`). ✅
- §8 structure (`.claude-plugin/{plugin,marketplace}.json`, `skills/uxfactory/SKILL.md`, `commands/`, `hooks/hooks.json`, README) → Tasks 2–4 create exactly that tree under `clients/uxfactory-cc/`. ✅
- §8.1 MCP-free — NO `.mcp.json` → Task 2 test asserts its absence at both plausible locations. ✅
- §8.1 vendored (copied, not referenced) skill that byte-matches the canonical → `scripts/vendor-skill.mjs` + Task 2 byte-equality test (`Buffer.equals`). ✅
- §8.2 slash commands (bridge/publish/verify/scan/status, scoped `allowed-tools: Bash(uxfactory:*)`, `argument-hint`, `$ARGUMENTS`) → Task 3 + data-driven test. ✅
- §8.3 hooks — `PostToolUse(Write|Edit)` sync-on-edit (path filter in the script, `publish --verify`, exit-1 vs exit-2 handling) + `SessionStart` drift-notify (`drift --json`, additionalContext, detect-only) → Task 4. Matcher-matches-tool-names + script-side path filter is honored (`shouldSync` reads `tool_input.file_path` from STDIN). ✅
- §8.4 Bash permission trade → README documents the `Bash(uxfactory:*)` allowlist; every command declares it. ✅
- §8.5 distribution — depends on the PUBLISHED CLI (`npx uxfactory`, never a relative monorepo path), vendors (not symlinks) the skill, relay still local → README + vendor design. ✅
- §18 repo layout — `skill/SKILL.md` (canonical, vendored into cc) and the full `clients/uxfactory-cc/` subtree match the §18 diagram. ✅

**2. Placeholder scan:** No "TODO"/"TBD"/"similar to"/"add X here". Every file ships complete content. The one file not pasted in full — `skill/SKILL.md` — is `cp`'d verbatim from `.plans/SKILL.md` (157 lines, already reviewed) with one exact-string edit shown; this is explicitly permitted by the task and avoids re-pasting an unchanged 157-line file. `skills/uxfactory/SKILL.md` is generated by the vendor step (Task 2 Step 7), not hand-written. The `drift` stub is called out, not hidden.

**3. Type / contract consistency:** `vendorSkill`, `shouldSync`, `buildSyncCommand`, `buildDriftCommand`, `formatDriftContext`, and `main` are each declared once in a `.d.mts` and consumed identically by the tests. The `.mjs` scripts are plain ESM (no TS syntax) so they run under bare `node`; their `.d.mts` siblings supply types under typecheck — matching the established `build-plugin.mjs`/`.d.mts` convention. `formatDriftContext` accepts `DriftResult | null | undefined` and the test exercises `{findings:[]}`, `null`, and a populated finding. Hook output shapes (`{systemMessage}` / `{hookSpecificOutput:{hookEventName,additionalContext}}`) match the CONFIRMED format. The import guard uses `pathToFileURL(process.argv[1]).href`, robust across platforms.

**4. Judgment calls** (flagged where the design left a choice):

- **Skill test location: root `test/skill.test.ts`.** The canonical skill is a repo-root deliverable (`skill/SKILL.md`, Component 1, distinct from the cc package). The root `vitest.config.ts` already globs `test/**/*.test.ts`, and a root `test/` dir already exists (`smoke.test.ts`). Placing it there keeps Component 1's test with Component 1, run by vitest. (It is not covered by the recursive `typecheck` script, which is per-package — acceptable, as it is a plain file-reading test.)
- **Single `tsconfig.typecheck.json` (no separate `tsconfig.json`).** Unlike the buildable packages, `uxfactory-cc` has no compilable TS source — only `.mjs` scripts (with `.d.mts`) and `.ts` tests. A lone typecheck config extending the base directly (with `include: ["test"]`, which has real inputs) is the minimal faithful setup; a second `tsconfig.json` would either be empty (tsc "No inputs") or redundant. The task's Global Constraints require a `tsconfig.typecheck.json` (present) but not a `tsconfig.json`.
- **`package.json` version `0.1.0` (vs siblings' `0.0.0`).** This package _is_ the plugin, and the CONFIRMED `plugin.json`/`marketplace.json` pin `0.1.0`; aligning the (private, unpublished) `package.json` to the release version avoids a confusing split. The version is never consumed by npm (private), so the choice is cosmetic.
- **`status` command probe = `uxfactory selection` (within `Bash(uxfactory:*)`).** The design says status is a "`uxfactory bridge` health + plugin-connection check" but `uxfactory bridge` foregrounds the relay (it doesn't return health). `uxfactory selection` hits the bridge's REST API and exercises the live plugin link — exit 0 = both up, exit 2 = bridge/plugin down — so it is the truest _connection_ probe that stays inside the scoped `Bash(uxfactory:*)` permission (a raw `curl /health` would need a broader allowlist). The body also documents the raw `GET /health` endpoint, satisfying "explains how to check `GET /health`".
- **Command bodies use inline-code invocations, not fenced `bash` blocks.** Keeps each command file unambiguous for the test's `body.toContain(...)` checks and sidesteps nested-fence rendering in this plan. The exact `uxfactory …` strings (incl. `$ARGUMENTS`, `--wait`) are present verbatim.
- **Hooks stay silent on CLI error / exit 2 (drift) and only `systemMessage` on exit 2 (sync).** drift-notify emits nothing when `uxfactory drift` is unavailable (it is a Phase-4 stub) so a fresh install never errors at SessionStart; sync-on-edit reports environment failures (exit 2) as a `systemMessage` rather than blocking (no `exit 2`), since a missing bridge is a setup nudge, not a hard gate. Both are faithful to §8.3's "exit 2 = environment problem, not drift" rule.
- **Import-guard test asserts via export shape + non-hang.** Spying on the module-internal `spawnSync` would require mocking; instead the test relies on the structural guarantee (guard false under vitest, where `process.argv[1]` is the runner) plus the observable fact that the suite does not hang (sync's `readStdin` would block the worker if `main()` ran on import). This is the strongest assertion available without restructuring the scripts for DI.

/**
 * classify.ts — `uxfactory classify` command (Phase 8, Task 3).
 *
 * Reads `uxfactory.classification.json`, runs `condition()` to derive a `GateProfile`,
 * then writes `uxfactory.profile.json`:
 *   - Without `--confirm` → `confirm_status: "draft"` (the proposed plan).
 *   - With `--confirm`    → `confirm_status: "approved"` (PINNED — the compute-commit boundary).
 *
 * `--json` emits the GateProfile to stdout.
 * Absent/invalid classification → EXIT.TRANSPORT(2).
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../exit.js";
import { readClassification } from "../classify/classification.js";
import { condition } from "../classify/condition.js";
import type { GateProfile } from "../classify/condition.js";
import type { IO } from "../io.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ClassifyFlags {
  /** Pin the profile as approved (the compute-commit boundary). */
  confirm?: boolean;
  /** Emit the GateProfile as JSON to stdout (instead of human summary). */
  json?: boolean;
  /** Data directory (kept for CLI flag parity; classify uses cwd for both files). */
  dataDir?: string;
  /** Project root — where uxfactory.classification.json lives (default process.cwd()). */
  cwd?: string;
}

// ---------------------------------------------------------------------------
// classifyCmd
// ---------------------------------------------------------------------------

/**
 * `uxfactory classify` — derive a GateProfile and write `uxfactory.profile.json`.
 *
 * Exit codes:
 *   0 — success (draft or approved profile written)
 *   2 — setup error (classification absent, invalid JSON, or invalid fields)
 */
export async function classifyCmd(flags: ClassifyFlags, io: IO): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();

  // 1. Read uxfactory.classification.json (ASYNC — readClassification is async, always awaited)
  const classPath = path.join(cwd, "uxfactory.classification.json");
  const result = await readClassification(classPath);
  if (!result.ok) {
    io.err(result.message);
    return EXIT.TRANSPORT;
  }

  // 2. condition(classification) → GateProfile (pure, deterministic, NO LLM)
  const profile: GateProfile = condition(result.value);

  // 3. Apply --confirm: pin the profile (the compute-commit boundary)
  if (flags.confirm === true) {
    profile.confirm_status = "approved";
  }
  // else stays "draft" (the default from condition())

  // 4. Write uxfactory.profile.json — stable 2-space JSON + trailing newline
  const profilePath = path.join(cwd, "uxfactory.profile.json");
  await writeFile(profilePath, JSON.stringify(profile, null, 2) + "\n", "utf8");

  // 5. Output: --json emits GateProfile to stdout; otherwise print human summary
  if (flags.json === true) {
    io.out(JSON.stringify(profile));
    return EXIT.OK;
  }

  const requested = profile.manifest.filter((e) => e.requirement === "requested").length;
  const generatable = profile.manifest.filter((e) => e.requirement === "generatable").length;
  const suppressed = profile.manifest.filter((e) => e.requirement === "suppressed").length;
  const status = flags.confirm === true ? "approved (PINNED)" : "draft";

  io.out(`classify: ${status}`);
  io.out(
    `scope: visual=${profile.scope.visual} editorial=${profile.scope.editorial} coverage=${profile.scope.coverage} flow=${profile.scope.flow}`,
  );
  io.out(`manifest: ${requested} requested, ${generatable} generatable, ${suppressed} suppressed`);
  if (profile.constraints.length > 0) {
    io.out(`constraints: ${profile.constraints.join(", ")}`);
  }

  return EXIT.OK;
}

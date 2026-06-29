import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../exit.js";
import { loadSpec, printSpecProblem } from "../spec-file.js";
import { readRegistry } from "../batch/registry.js";
import { resolveScope, parseScope } from "../batch/scope.js";
import { loadTokensInput, loadStoriesInput, loadFlowInput } from "../batch/inputs.js";
import { reviewDesign } from "../review/review.js";
import type { ReviewReport } from "../review/review.js";
import type { Dial, DialLevel } from "../batch/scope.js";
import type { LoadedSpec } from "../batch/checks.js";
import type { Spec } from "@uxfactory/spec";
import type { IO } from "../io.js";

/** Flags for `uxfactory review`. */
export interface ReviewFlags {
  json?: boolean;
  /** `--scope <preset>` — runtime override of the registry scope base. */
  scope?: string;
  /** Per-dial runtime overrides — each must be low|medium|high. */
  visual?: string;
  editorial?: string;
  coverage?: string;
  flow?: string;
  /** Data directory (unused in review — kept for flag parity with batch). */
  dataDir?: string;
  /** Repo root where uxfactory.batch.json lives (default process.cwd()). */
  cwd?: string;
}

/** Valid values for a dial flag (not `none` — that is threshold-only). */
const VALID_DIAL_LEVELS = new Set(["low", "medium", "high"]);

/**
 * `uxfactory review <design>` — offline conformance review (§14).
 *
 * Reads the shared registry, loads + validates the design spec(s), resolves the
 * render scope (default: `interactive`), loads registered inputs that exist
 * (skip-and-declares absent ones), runs `reviewDesign`, and prints a
 * human-readable or `--json` review report.
 *
 * Exit codes (§14.4 conformance contract):
 *   0 — conformant (all binding must-gates passed)
 *   1 — non-conformant (at least one binding must-gate failed)
 *   2 — setup/transport (bad/missing registry, unreadable/invalid design)
 *
 * Lenient on missing inputs: an absent registered input is skip-and-declared,
 * never a setup error. Only an absent/invalid registry or design returns 2.
 */
export async function reviewCmd(design: string, flags: ReviewFlags, io: IO): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();

  // 1. Registry (absent/unreadable/invalid → EXIT.TRANSPORT(2))
  const reg = await readRegistry(path.join(cwd, "uxfactory.batch.json"));
  if (!reg.ok) {
    io.err(reg.message);
    return EXIT.TRANSPORT;
  }

  // 2. Load <design>: single *.uxfactory.json file OR a directory of them
  let specFilePaths: string[];
  try {
    const info = await stat(design);
    if (info.isDirectory()) {
      const entries = await readdir(design);
      specFilePaths = entries
        .filter((f) => f.endsWith(".uxfactory.json"))
        .sort()
        .map((f) => path.join(design, f));
    } else {
      specFilePaths = [design];
    }
  } catch {
    io.err(`cannot read design path: ${design}`);
    return EXIT.TRANSPORT;
  }
  if (specFilePaths.length === 0) {
    io.err(`no *.uxfactory.json specs found in ${design}`);
    return EXIT.TRANSPORT;
  }
  const specs: LoadedSpec[] = [];
  for (const file of specFilePaths) {
    const result = await loadSpec(file);
    if (!result.ok) return printSpecProblem(io, result, flags.json);
    specs.push({ file: path.basename(file), spec: result.spec as Spec });
  }

  // 3. Validate per-dial flag values (must be low|medium|high)
  const dialEntries: [string, string | undefined][] = [
    ["visual", flags.visual],
    ["editorial", flags.editorial],
    ["coverage", flags.coverage],
    ["flow", flags.flow],
  ];
  for (const [name, val] of dialEntries) {
    if (val !== undefined && !VALID_DIAL_LEVELS.has(val)) {
      io.err(`invalid --${name} value: "${val}". Must be one of: low, medium, high.`);
      return EXIT.TRANSPORT;
    }
  }

  // 3a. Validate --scope flag before resolveScope
  if (flags.scope !== undefined) {
    const scopeCheck = parseScope(flags.scope);
    if (!scopeCheck.ok) {
      io.err(scopeCheck.message);
      return EXIT.TRANSPORT;
    }
  }

  // 3b. Resolve scope: CLI --scope (runtime) → registry.scope (committed) → "interactive" (default)
  //     Unlike batch, review defaults to `interactive` (broadest conformance picture).
  const overrides: Partial<Record<Dial, DialLevel>> = {};
  if (flags.visual !== undefined) overrides.visual = flags.visual as DialLevel;
  if (flags.editorial !== undefined) overrides.editorial = flags.editorial as DialLevel;
  if (flags.coverage !== undefined) overrides.coverage = flags.coverage as DialLevel;
  if (flags.flow !== undefined) overrides.flow = flags.flow as DialLevel;

  const rawBase: string | Record<string, unknown> =
    flags.scope !== undefined ? flags.scope : (reg.registry.scope ?? "interactive");

  const scope = resolveScope(rawBase, overrides);
  if (scope === null) {
    io.err("review: could not resolve render scope.");
    return EXIT.TRANSPORT;
  }

  // 4. Load registered inputs.
  //    Fix 1/2: distinguish "not registered" (absent → null, skip-and-declare is valid)
  //    from "registered-but-broken" (unreadable / invalid JSON / wrong shape → exit 2 with
  //    a clear message).  The shared loader in batch/inputs.ts enforces the same shape
  //    checks as batch, so the two commands cannot drift.
  const tokensResult = await loadTokensInput(reg.inputs.tokens);
  if (tokensResult.state === "broken") {
    io.err(`review: ${tokensResult.message}`);
    return EXIT.TRANSPORT;
  }
  const tokens = tokensResult.state === "ok" ? tokensResult.value : null;

  const storiesResult = await loadStoriesInput(reg.inputs.stories);
  if (storiesResult.state === "broken") {
    io.err(`review: ${storiesResult.message}`);
    return EXIT.TRANSPORT;
  }
  const stories = storiesResult.state === "ok" ? storiesResult.value : null;

  const flowResult = await loadFlowInput(reg.inputs.flow);
  if (flowResult.state === "broken") {
    io.err(`review: ${flowResult.message}`);
    return EXIT.TRANSPORT;
  }
  const flowData = flowResult.state === "ok" ? flowResult.value : null;

  let reuseSpecs: { file: string; spec: unknown }[] | null = null;
  if (reg.inputs.reuse.length > 0) {
    reuseSpecs = [];
    for (const file of reg.inputs.reuse) {
      const result = await loadSpec(file);
      if (result.ok) reuseSpecs.push({ file: path.basename(file), spec: result.spec });
      // unreadable/invalid reuse spec → silently skip (review is lenient for reuse)
    }
    if (reuseSpecs.length === 0) reuseSpecs = null;
  }

  // 5. Run the conformance review (pure; reuses runBatch via reviewDesign)
  const report: ReviewReport = reviewDesign({
    specs,
    stories,
    flow: flowData,
    tokens,
    reuseSpecs,
    scope,
  });

  // 6. Output: --json (machine-readable) or human-readable review
  if (flags.json === true) {
    io.out(JSON.stringify(report));
  } else {
    // Fix 5: qualify CONFORMANT when gates were skipped so a vacuous/partial pass is
    // not mistaken for a fully-checked one.  NON-CONFORMANT is always unambiguous.
    let verdict: string;
    if (report.conformant) {
      if (report.skipped.length > 0) {
        verdict = `CONFORMANT (${report.skipped.length} check(s) skipped — see below)`;
      } else {
        verdict = "CONFORMANT";
      }
    } else {
      verdict = "NON-CONFORMANT";
    }
    io.out(
      `review: ${verdict} — ${specs.length} spec(s) ` +
        `at visual:${scope.visual}/editorial:${scope.editorial}/coverage:${scope.coverage}/flow:${scope.flow}`,
    );
    for (const f of report.findings) {
      if (f.status === "unmet") {
        const ref =
          f.requirement !== undefined
            ? ` [${f.requirement}${f.property !== undefined ? `:${f.property}` : ""}]`
            : "";
        io.out(`  UNMET${ref}: ${f.detail}`);
      } else if (f.status === "advisory") {
        io.out(`  advisory: ${f.detail}`);
      }
    }
    for (const s of report.skipped) {
      io.out(`  skipped: ${s.check} (${s.reason})`);
    }
    if (report.notOwed.length > 0) {
      io.out(`  not-owed at this scope: ${report.notOwed.join(", ")}`);
    }
    io.out(`  note: ${report.advisory}`);
  }

  // 7. Exit: conformant → 0; non-conformant → 1; setup → 2 (already returned above)
  return report.conformant ? EXIT.OK : EXIT.GATE_FAIL;
}

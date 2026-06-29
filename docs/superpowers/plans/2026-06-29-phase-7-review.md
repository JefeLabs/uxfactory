# Phase 7 — Conformance Review (`uxfactory review`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `uxfactory review <design>` — assess whether a design satisfies its registered requirements (design↔intent), reusing the render-scope rubric engine in reverse and returning a structured review report with a clean conformance exit-code contract.

**Architecture:** Conformance review (§14) is "the §13 rubric run in reverse": generation goes stories→design; review goes design→checked-against→stories. It **reuses** the existing gates + render scope (`runBatch`/`scope.ts`) — it does NOT re-implement them. A pure `src/review/review.ts` runs the scope-bound conformance gates over the given design and **re-frames** the results into a `ReviewReport` (per-story/AC conformance, journey reachability, a declared heuristic-UX-advisory note that LLM/vision checks are the agent/plugin layer). `reviewCmd` reads the shared inputs registry (`uxfactory.batch.json` — §15 inputs/knowledge store) + the design (a spec file or dir), resolves the scope (`--scope`/per-dial flags, reused from Phase 6.5), runs the review, prints a human/`--json` report, and exits `0` conformant / `1` non-conformant / `2` setup. Self-contained; no in-engine LLM. The plugin canvas-annotation surface (§7.8) and arbitrary-canvas inference are deferred.

**Tech Stack:** Node `>=20.10`, TS 6.0.3, ESM/NodeNext, `.js` imports, `verbatimModuleSyntax`. Extends `@uxfactory/cli` — reuses `runBatch` + `scope.ts` (RenderScope, parseScope/resolveScope) + the four gates + `loadSpec`/`readRegistry`/`EXIT`/`IO`. Vitest 4.1.9.

## Global Constraints

- WORK ON `main`. Engine SELF-CONTAINED — no external cloud/runtime refs, no in-engine LLM. `--json` for machine output.
- **REUSE, don't duplicate:** the conformance gates, the render-scope binding, and `runBatch` already exist (Phase 6 + 6.5). `review` builds its input, calls the existing machinery, and re-shapes the output. Adding a parallel gate/binding implementation is a defect.
- **Exit codes (§14.4, the conformance contract):** `0` conformant, `1` non-conformant (a binding must-conformance check failed), `2` transport/setup (bad/missing registry → reuse the existing message, unreadable/invalid design). Mirrors `verify`/`drift` (1 = a real signal, 2 = couldn't run).
- **Lenient on inputs (§14.2 best-effort):** unlike batch's readiness precondition, review does NOT exit 2 for a missing registered input — a gate whose input is absent is **skipped and declared** in the report; review reports what it _can_ check. (Only an absent/unreadable registry/design is a `2`.)
- **Reliability boundary (§14.2):** v1 reviews a UXFactory **spec** (the exact case). Reviewing an arbitrary hand-made Figma canvas (structure inferred via vision) is out of scope — note it as best-effort/deferred.
- Per conventions: `paths` only in tsconfig.typecheck.json; built artifact verified; scoped commits (never `git add -A`).

---

## Task 1: `src/review/review.ts` — `reviewDesign` (pure, reuses the rubric engine)

**Files:**

- Create: `packages/uxfactory-cli/src/review/review.ts`
- Test: `packages/uxfactory-cli/test/review.test.ts`

**Interfaces:**

```ts
import type { RenderScope } from "../batch/scope.js";
// reuse runBatch's CheckResult/BatchReport from ../batch/run.js + the gate inputs

export interface ReviewFinding {
  requirement?: string; // story id (when the finding is requirement/AC conformance)
  property?: string; // e.g. the implied state / node
  status: "met" | "unmet" | "advisory";
  detail: string;
}
export interface ReviewReport {
  scope: RenderScope;
  conformant: boolean; // no binding must-conformance check failed
  rubric: string[]; // the binding conformance gate ids (from the run)
  findings: ReviewFinding[]; // re-framed from the gate results (design↔intent)
  skipped: { check: string; reason: string }[]; // skip-and-declared (input absent)
  notOwed: string[]; // gates not owed at this scope
  advisory: string; // the heuristic-UX note (LLM/vision = agent/plugin layer, not run here)
}

export function reviewDesign(input: {
  specs: { file: string; spec: unknown }[];
  stories: unknown | null;
  flow: unknown | null;
  tokens: unknown | null;
  reuseSpecs: { file: string; spec: unknown }[] | null;
  scope: RenderScope;
}): ReviewReport;
```

**Behavior:** call `runBatch({...input})` (the existing scope-scoped gate runner) to get the `CheckResult[]` + `rubric`. Re-shape into `ReviewReport`: map `requirement-coverage`/`flow-reachability`/`token-conformance` results into `findings` framed as conformance (a `fail` finding → `status:"unmet"` with its detail; a `pass` binding gate contributes no negative finding or an informational `met`); `skip` results → `skipped[]`; `not-owed` → `notOwed[]`; advisory gates (flow-reachability, coverage-orphans) → `status:"advisory"`. `conformant = !runBatch(...).mustPassFailed`. `advisory` = a fixed note that heuristic-UX (visual hierarchy, contrast, cognitive load) is the agent/plugin judgment layer, not run by the engine. PURE (reuses runBatch which is pure).

**Steps (TDD):**

- [ ] Write `test/review.test.ts` failing tests: a design that COVERS its stories at a given scope → `conformant:true`, no `unmet` findings; a design MISSING an AC-implied state → `conformant:false` + an `unmet` finding naming the story/state; no stories registered → the coverage check appears in `skipped[]` (not a crash, not a false `unmet`), `conformant:true`; `rubric` lists the binding gate ids for the scope; `advisory` note present; gates above the scope appear in `notOwed`.
- [ ] Run → confirm RED.
- [ ] Implement `review.ts` (reusing `runBatch`).
- [ ] `pnpm vitest run packages/uxfactory-cli` + `pnpm --filter @uxfactory/cli typecheck` → GREEN, exit 0.
- [ ] Commit `packages/uxfactory-cli`.

## Task 2: `uxfactory review <design>` command + cli wiring + skill mention

**Files:**

- Create: `packages/uxfactory-cli/src/commands/review.ts`
- Modify: `packages/uxfactory-cli/src/cli.ts` (replace the `review` stub with a real command + options), `src/index.ts` (export `reviewCmd`/`reviewDesign`), `skill/SKILL.md` (add a one-line `uxfactory review` mention), and re-vendor if the main skill is vendored.
- Test: `packages/uxfactory-cli/test/review-cmd.test.ts`

**Interfaces:**

```ts
export interface ReviewFlags {
  json?: boolean;
  scope?: string;
  visual?: string;
  editorial?: string;
  coverage?: string;
  flow?: string;
  dataDir?: string;
  cwd?: string;
}
export function reviewCmd(design: string, flags: ReviewFlags, io: IO): Promise<number>;
```

**Behavior:**

1. Read `uxfactory.batch.json` for the registered inputs (stories/flow/tokens/reuse). Absent/unreadable/invalid registry → `EXIT.TRANSPORT` (2) with a clear message. (A registry with _no_ stories is allowed — review will skip-and-declare; only an unreadable/invalid registry is a 2.)
2. Load the `<design>` — a single `*.uxfactory.json` file OR a directory of them; validate each via `@uxfactory/spec`. Unreadable / invalid spec / zero specs → `EXIT.TRANSPORT` (2).
3. Resolve the scope: `--scope <preset>` + per-dial flags (`--visual`/`--editorial`/`--coverage`/`--flow <low|medium|high>`) over the registry `scope`, via `resolveScope`. **Default when unset: `interactive`** (review wants the broadest conformance picture by default; document this — unlike batch, review does not require an explicit scope). Validate flag values (reuse Phase 6.5's validation) → bad value → 2.
4. Load the registered inputs that exist (skip-and-declare absent ones).
5. `reviewDesign({...})`.
6. Print a human-readable review (or `--json` carrying the full `ReviewReport`).
7. Exit: `conformant` → `EXIT.OK` (0); not conformant → `EXIT.GATE_FAIL` (1); setup/transport → `EXIT.TRANSPORT` (2).

- Replace the `review` stub in `cli.ts`; wire `--json`/`--scope`/per-dial flags/`--data-dir`.

**Steps (TDD):**

- [ ] Write `test/review-cmd.test.ts` failing tests (temp dirs): a conformant design → exit 0; a non-conformant design (missing AC state) → exit 1 + the unmet finding (human + `--json`); missing/invalid registry → 2; unreadable/zero-spec design → 2; invalid `--visual bogus` → 2; no stories registered → exit 0 with the coverage check in `skipped` (best-effort); `--json` shape carries scope+conformant+findings+skipped+rubric+advisory.
- [ ] Run → confirm RED.
- [ ] Implement `review.ts` command + cli wiring + index exports + the `skill/SKILL.md` one-liner (+ re-vendor if applicable).
- [ ] BUILT ARTIFACT: `pnpm -r build`, then `node packages/uxfactory-cli/dist/src/cli.js review <fixture>` — a conformant fixture → 0; a non-conformant fixture → 1; no registry → 2. Print results.
- [ ] `pnpm test && pnpm typecheck && pnpm format:check` (format first if needed) → all exit 0 (live playwright test stays skipped). Commit.

## Self-Review

- Review REUSES `runBatch` + `scope.ts` + the gates — no parallel gate/binding implementation. ✓
- Exit `0`/`1`/`2` = conformant / non-conformant / setup (mirrors verify/drift). ✓
- Lenient on inputs: missing registered input → skip-and-declare (not 2); only bad registry/design → 2. ✓
- `--scope`/per-dial flags reused; default scope `interactive`; flag values validated. ✓
- Heuristic-UX is a declared agent/plugin-layer note, not an in-engine LLM check. ✓ §14.1
- Arbitrary-canvas inference + the plugin annotation surface (§7.8) are deferred (spec-only, the exact case). ✓ §14.2

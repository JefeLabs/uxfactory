# Phase 8 — Project Classification Intake (`uxfactory classify` + intake skill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the §5.8/§6.6 intake layer — an enumerated `ProjectClassification` vector + a pure conditioning function that derives a pinned `GateProfile` (render scope + requested/generatable/suppressed artifact manifest + compliance constraints), gated by a human Confirm step, that `uxfactory batch` then renders against.

**Architecture:** A committed `uxfactory.classification.json` (the intake answer) feeds a pure `condition()` (`src/classify/condition.ts`) — a fixed per-dimension effect map, strictest-wins — that emits a `GateProfile`. `uxfactory classify` derives a DRAFT `uxfactory.profile.json` and `--confirm` PINS it (the compute-commit boundary). `uxfactory batch` reads the pinned profile (scope + REQUESTED-enforced artifacts → readiness) and refuses a draft. The conversation (Intake → Scoping → Confirm; assert-needed + provide-or-build prompting; drafting generatables) lives in `skill/intake/SKILL.md`. Engine is pure/deterministic — no in-engine LLM. Reuses Phase 6.5 `scope.ts` (RenderScope) and batch readiness.

**Tech Stack:** Node `>=20.10`, TS 6.0.3, ESM/NodeNext, `.js` imports, `verbatimModuleSyntax`. Extends `@uxfactory/cli`. Vitest 4.1.9.

## Global Constraints

- **Authoritative spec:** `docs/superpowers/specs/2026-06-29-project-classification-intake-design.md` (implement its §3 effect map + §3.2 manifest tables VERBATIM) + companion PRD §5.8/§6.6.
- WORK ON `main`. Engine SELF-CONTAINED — no external cloud/runtime refs, **no in-engine LLM** (conditioning is a pure deterministic map; drafting generatable artifacts is the agent's job in the skill).
- **REUSE:** `src/batch/scope.ts` (`RenderScope`/`Level`/`resolveScope`/`parseScope`) for the scope dials; batch readiness (`scope.ts` `requiredInputs`/the shared `inputs.ts` loader) for the enforced REQUESTED artifacts. Do NOT duplicate scope or gate logic.
- **Decisions (locked):** full §4-catalog manifest with an `enforced` flag (enforce checkable: AcceptanceCriterion→stories, TokenSet→tokens, UserFlow→flow, reuse; declare the rest with provenance); the pinned `uxfactory.profile.json` is the plan batch reads; `confirm_status` draft→approved is the compute-commit boundary (batch refuses a draft).
- Conflicting effects → **strictest-wins** (compliance dominates). Every manifest entry carries `derived_from` (provenance).
- Conventions: `paths` only in tsconfig.typecheck.json; built artifact verified; scoped commits (never `git add -A`).

---

## Task 1: `src/classify/classification.ts` — the enumerated vector (pure)

**Files:** Create `packages/uxfactory-cli/src/classify/classification.ts`; Test `packages/uxfactory-cli/test/classification.test.ts`.

**Interfaces:**

```ts
export type Category = "marketing" | "ecommerce" | "web_app" | "news";
export type Industry = "education" | "corporate" | "healthcare" | "finance" | "consumer";
export type AgeDemographic = "children" | "teens" | "18-25" | "26-35" | "36-50" | "50+";
export type Style = "informal" | "mix" | "formal";
export interface ProjectClassification {
  version: 1;
  category: Category;
  industry: Industry;
  age_demographic: AgeDemographic;
  style: Style;
  scope: {
    visual: "low" | "medium" | "high";
    editorial: "low" | "medium" | "high";
    coverage: "low" | "medium" | "high";
    flow: "low" | "medium" | "high";
  };
  flow_refs: string[];
}
export function validateClassification(
  raw: unknown,
): { ok: true; value: ProjectClassification } | { ok: false; message: string };
export function readClassification(
  path: string,
): { ok: true; value: ProjectClassification } | { ok: false; message: string }; // null-file → ok:false with a clear "not found"
```

Validate every enum (controlled vocabulary); `scope` dials must be low|medium|high (reuse scope.ts's level validation); `flow_refs` a string[].

**Steps (TDD):** failing tests (valid vector; each bad enum rejected; bad scope dial rejected; non-array flow_refs rejected; absent file → ok:false) → RED → implement → GREEN + typecheck → commit `packages/uxfactory-cli`.

## Task 2: `src/classify/condition.ts` — the conditioning function (pure, the heart)

**Files:** Create `packages/uxfactory-cli/src/classify/condition.ts`; Test `packages/uxfactory-cli/test/condition.test.ts`.

**Interfaces:**

```ts
import type { RenderScope } from "../batch/scope.js";
export type Requirement = "requested" | "generatable" | "suppressed";
export type GateEffect = "hard" | "soft" | "suppressed";
export interface ManifestEntry {
  artifact_kind: string; // a §4 catalog kind
  requirement: Requirement;
  gate_effect: GateEffect;
  enforced: boolean; // true only for engine-checkable artifacts (stories/tokens/flow/reuse)
  derived_from: string[]; // dimensions that forced it (provenance)
}
export interface GateProfile {
  scope: RenderScope;
  manifest: ManifestEntry[];
  constraints: string[]; // FERPA, COPPA, HIPAA, disclosure (strictest-wins, deduped)
  notes: string[]; // tier-weighting / archetype notes (recorded; engine doesn't weight yet)
  confirm_status: "draft" | "approved";
}
export function condition(c: ProjectClassification): GateProfile; // confirm_status defaults "draft"
```

Implement the design §3.1 effect map + §3.2 manifest dispositions VERBATIM. Scope: start from the **category defaults** (marketing→coverage:low,flow:low; web_app→coverage:high,flow:high; ecommerce/news→from the classification dials), apply the classification's **explicit scope dials** as overrides, then apply **compliance floors** (a raised floor can't be lowered — strictest-wins). `constraints` from industry (education→FERPA,COPPA; healthcare→HIPAA; finance→disclosure) deduped. `enforced` true only for AcceptanceCriterion/TokenSet/UserFlow/reuse per §3.2. PURE — no I/O, no LLM.

**Steps (TDD):** failing tests covering each design-table row: category archetypes (ecommerce→payment-failure AC entry + Tier-2 note; news→DiscoverabilityStrategy requested; web_app→DiscoverabilityStrategy suppressed + coverage/flow high; marketing→coverage/flow low); industry compliance (education→FERPA+COPPA constraints + A11yProfile requested; healthcare→HIPAA); age=children→A11yProfile requested + dark-pattern note; style=formal→EditorialStyle voice; scope dials → the RenderScope; strictest-wins (a relaxing dial can't lower a compliance floor); `enforced` flags correct; provenance `derived_from` populated. → RED → implement → GREEN + typecheck → commit.

## Task 3: `uxfactory classify` command + batch integration + built artifact

**Files:** Create `packages/uxfactory-cli/src/commands/classify.ts`; Modify `src/cli.ts` (add the `classify` command + options), `src/commands/batch.ts` (read the pinned profile), `src/index.ts` (exports); Test `test/classify-cmd.test.ts` + extend `test/batch.test.ts`.

**Interfaces:** `classifyCmd(flags: { confirm?: boolean; json?: boolean; dataDir?: boolean; cwd?: string }, io): Promise<number>`.

**Behavior:**

1. Read `uxfactory.classification.json` (absent/invalid → EXIT.TRANSPORT 2 with a clear message).
2. `condition(classification)` → GateProfile.
3. Write `uxfactory.profile.json`: without `--confirm` → `confirm_status: "draft"` (proposed plan); with `--confirm` → `confirm_status: "approved"` (PINNED). `--json` emits the GateProfile. Exit 0.
4. **Batch integration** (`batch.ts`): if `uxfactory.profile.json` exists, `batchCmd` reads it: (a) if `confirm_status !== "approved"` → EXIT.TRANSPORT 2 ("profile not confirmed — run `uxfactory classify --confirm`"); (b) the profile's `scope` becomes the batch scope (a `--scope`/flag still overrides; document precedence); (c) the profile's REQUESTED + enforced artifacts are folded into readiness (a missing one → the existing exit-2 missing list). When no profile exists, batch behaves exactly as today (back-compat — existing batch tests stay green).

**Steps (TDD):** failing tests: classify (no `--confirm`) → writes a draft profile.json, exit 0; `--confirm` → approved; `--json` shape (scope+manifest+constraints+confirm_status); absent classification → 2; batch with a DRAFT profile → 2 ("not confirmed"); batch with an APPROVED profile → uses its scope + REQUESTED readiness; batch with NO profile → unchanged behavior (existing tests green). Built artifact: `pnpm -r build`, then `node dist/src/cli.js classify` (draft) then `classify --confirm` (approved) then `batch <dir>` reads it — print exit codes. `pnpm test && pnpm typecheck && pnpm format:check` green. Commit.

## Task 4: `skill/intake/SKILL.md` (the intake conversation) + vendor

**Files:** Create `skill/intake/SKILL.md`; Modify `clients/uxfactory-cc/scripts/vendor-skill.mjs` (vendor the new skill → `clients/uxfactory-cc/skills/uxfactory-intake/SKILL.md`); run the vendor step + commit the byte-identical copy. Test: a cc test asserting the intake skill's content + vendor byte-match.

**Content (Intake → Scoping → Confirm):** frontmatter `name: uxfactory-intake` + a triggering description. Teach the agent:

1. **Intake** — ask the 7 dimensions ONE AT A TIME (category, industry, age, style, the four scope dials, flow_refs), progressive disclosure (each answer narrows the next) → write `uxfactory.classification.json`.
2. **Scoping** — run `uxfactory classify` → read the proposed manifest (requested/generatable/suppressed + provenance).
3. **Confirm** — **assert the needed (REQUESTED) artifacts; for each not already provided, PROMPT the user: provide it, or confirm the agent should build it.** Draft the agent-build / GENERATABLE artifacts. Apply **asymmetric friction**: adding is easy; removing a REQUESTED artifact requires justification (cite its `derived_from`). On sign-off → `uxfactory classify --confirm` (pin) → `uxfactory batch` (reads the pinned profile). Document the compute-commit boundary (batch refuses a draft profile) and that conditioning is deterministic (no LLM). NO external-project references (agentcore/runpod/cloud).

**Steps (TDD):** failing tests (skill teaches the 7 dimensions + the three phases + assert-needed/provide-or-build + classify/--confirm + the compute-commit boundary; asserts NO `/agentcore/i`,`/runpod/i`,`/\bcloud\b/i`; vendored copy byte-matches after re-vendoring; cc has no `.mcp.json`) → RED → write SKILL.md + extend vendor-skill.mjs + re-vendor → GREEN → `pnpm test && pnpm format:check` → commit `skill clients/uxfactory-cc`.

## Self-Review

- Conditioning is a PURE deterministic effect map (no LLM); strictest-wins; provenance on every entry. ✓ §3
- Full §4-catalog manifest; `enforced` only for stories/tokens/flow/reuse; rest declared. ✓ decision
- Pinned `uxfactory.profile.json` is the plan batch reads; batch refuses a draft (compute-commit boundary); no profile → batch unchanged (back-compat). ✓ decision
- Reuses scope.ts (RenderScope) + batch readiness; no duplication. ✓
- The intake SKILL.md asserts needed artifacts + prompts provide-or-build; drafting is the agent's; no external refs. ✓ user refinement

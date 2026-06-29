# Phase 9 — Plugin Conformance-Review Annotations (§7.8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the §7.8 interactive conformance-review surface — the Figma plugin annotates the canvas with per-element flags + coverage-gap notes from a `ReviewReport`, conformance (gate) and advisory (heuristic-UX) visually distinguished — fed by `uxfactory review --annotate` → the bridge relay.

**Architecture:** No package cycle: `cli` already depends on `bridge`, so the bridge cannot import the CLI's review core. Therefore **the CLI computes the review (Phase 7, untouched) and POSTs the `ReviewReport` to the bridge; the bridge RELAYS it** (a `/review` store + GET/POST mirroring the existing `/rendered` relay + `saveReport`/`getReport`); **the plugin GETs it and draws annotations**. The bridge treats the report as an opaque relayed payload (light structural validation). The plugin maps findings → canvas nodes BY NAME (the §14.2 exact case: a UXFactory-rendered design's node names match the canvas — like the gate's `findNode`); a pure `annotation-plan.ts` turns the report into an `AnnotationPlan`, and the plugin draws it (build-to-spec: pure plan tested fully; the `figma.*` drawing verified via the figma mock structurally, live-visual items noted in the contract notes). Arbitrary hand-made-canvas inference (vision) is out of scope (best-effort, deferred).

**Tech Stack:** Node `>=20.10`, TS 6.0.3, ESM/NodeNext, `.js` imports, `verbatimModuleSyntax`. Bridge = Fastify 5; plugin = @figma/plugin-typings + esbuild, tested via a focused figma mock + Vitest 4.1.9. Reuses Phase 7 `reviewDesign` (cli), the bridge relay/store pattern, and the plugin's `code.ts`/`ui.ts`/`panel.ts` infra.

## Global Constraints

- WORK ON `main`. Engine SELF-CONTAINED — no external cloud/runtime refs, no in-engine LLM. `--json` machine output where relevant.
- **No package cycle:** the bridge stores/serves the `ReviewReport` as an OPAQUE relayed payload (a local structural type with `conformant`/`findings`/`skipped`); it does NOT import `@uxfactory/cli`. The plugin types the SUBSET of the report it consumes (findings → annotations); it does NOT import the CLI's full `ReviewReport`.
- **Reuse:** `reviewDesign`/`reviewCmd` (Phase 7) compute the report unchanged; mirror the bridge's `saveReport`/`getReport` + `/rendered`; mirror the plugin's existing message-handling/figma-mock patterns. Do NOT duplicate review logic.
- **§7.8 visual contract:** per-element flags are numbered badges at the flagged node — **conformance = red, advisory = amber**; coverage gaps go in a "Review notes" panel listing severity + reason; a **legend**; ALL annotations grouped under ONE removable layer/frame so a re-review or clear is clean. §14.2: v1 annotates UXFactory-rendered designs (node-name match); arbitrary canvas is deferred.
- Build-to-spec for the plugin: the pure `annotation-plan` is fully unit-tested; the `figma.*` drawing is verified via the focused figma mock (nodes created, colors, grouping, find-by-name); record live-only items (real-Figma visual placement) in `docs/superpowers/notes/cross-phase-contract-notes.md`.
- Conventions: `paths` only in tsconfig.typecheck.json; built artifact verified; scoped commits (never `git add -A`).

---

## Task 1: Bridge `/review` relay (store + endpoints)

**Files:** Modify `packages/uxfactory-bridge/src/store.ts` (add review-report save/get) + `src/server.ts` (POST/GET `/review`); Test the bridge tests.

**Interfaces:**

```ts
// store.ts — mirror saveReport/getReport. The report is an opaque relayed payload:
export interface ReviewReportPayload {
  conformant: boolean;
  findings: unknown[];
  [k: string]: unknown;
}
class BridgeStore {
  saveReviewReport(report: ReviewReportPayload): Promise<ReviewReportPayload>; // writes <dataDir>/review/latest.json (or reviewId)
  getReviewReport(): Promise<ReviewReportPayload | null>; // latest, null if none
}
```

**Behavior:** `POST /review` validates the body is an object with `conformant:boolean` + `findings:array` (else 400), stores it, returns it. `GET /review` returns the latest review report (or 404/null if none). Mirror the `/rendered` handlers + the store's file-write (atomic). The bridge does NOT import @uxfactory/cli.

**Steps (TDD):** failing tests (POST /review stores + GET /review returns it; malformed body → 400; GET with none → 404/null) → RED → implement → GREEN + typecheck → commit `packages/uxfactory-bridge`.

## Task 2: `uxfactory review --annotate` (post the report to the bridge)

**Files:** Modify `packages/uxfactory-cli/src/commands/review.ts` (add `--annotate`) + `src/client.ts` (`BridgeClient.postReview`) + `src/cli.ts` (the `--annotate`/`--bridge` options); Test `test/review-cmd.test.ts`.

**Behavior:** `reviewCmd` gains `annotate?: boolean` + `bridge?: string`. After computing the `ReviewReport`, if `--annotate` is set, POST it to the bridge via `client.postReview(report)` (a TransportError → EXIT.TRANSPORT 2, like other bridge calls — but only when --annotate; without it, review is unchanged). The exit code is still the conformance verdict (0/1) on success of the post; a post failure is 2. Add `--annotate` + `--bridge` to the `review` command in cli.ts.

**Steps (TDD):** failing tests (review --annotate posts the report to an in-process bridge — assert the bridge received it; bridge down + --annotate → 2; without --annotate → unchanged, no network) → RED → implement → GREEN + typecheck → commit `packages/uxfactory-cli`.

## Task 3: Plugin `annotation-plan.ts` (pure)

**Files:** Create `packages/uxfactory-plugin/src/annotation-plan.ts`; Test `packages/uxfactory-plugin/test/annotation-plan.test.ts`.

**Interfaces:**

```ts
export type AnnotationKind = "conformance" | "advisory";
export interface ElementFlag {
  index: number;
  nodeName: string;
  kind: AnnotationKind;
  severity: string;
  reason: string;
}
export interface CoverageGap {
  index: number;
  kind: AnnotationKind;
  severity: string;
  reason: string;
  requirement?: string;
}
export interface AnnotationPlan {
  elementFlags: ElementFlag[];
  coverageGaps: CoverageGap[];
  conformant: boolean;
}
// structural subset of the relayed ReviewReport
export interface ReviewReportLike {
  conformant: boolean;
  findings: { requirement?: string; property?: string; status: string; detail: string }[];
  skipped?: unknown[];
}
export function planAnnotations(report: ReviewReportLike): AnnotationPlan;
```

**Behavior:** walk `findings`: a finding with `status:"unmet"` AND a `property` that names a node → an `ElementFlag{ kind:"conformance", nodeName: property, ... }`; a `status:"advisory"` finding with a `property` → an `ElementFlag{ kind:"advisory" }`; an `unmet`/`advisory` finding WITHOUT a node target (a coverage gap — unmet story/state, dead-end) → a `CoverageGap`. Number flags+gaps sequentially (the badge numbers). `severity` from the finding (conformance unmet = "violation"; advisory = "suggestion"). PURE.

**Steps (TDD):** failing tests (an unmet finding with a node → conformance ElementFlag; an advisory finding with a node → advisory flag; an unmet finding with no node → CoverageGap; numbering is sequential + stable; conformant passthrough) → RED → implement → GREEN + typecheck → commit `packages/uxfactory-plugin`.

## Task 4: Plugin review-mode drawing + wiring (build-to-spec)

**Files:** Modify `packages/uxfactory-plugin/src/code.ts` (a `review` message → fetch is in ui; code draws), `src/messages.ts` (the message types), `src/ui.ts` (a "Review" button → GET /review from the bridge → postMessage the report to code), `src/panel.ts` (the Review action + a §7.6-style state), and the figma mock (extend with what the drawing needs); Test `packages/uxfactory-plugin/test/` (review-draw tests against the mock).

**Behavior:** UI "Review" → `ui.ts` GETs `/review` from the bridge → posts `{ type:"review", report }` to `code.ts` → `code.ts` builds `planAnnotations(report)` → draws:

- A single removable group/frame `"UXFactory Review"` on the page (clear any prior one first — re-review is idempotent, mirroring the §7.1 clear-by-name concern).
- For each `ElementFlag`: find the node by `nodeName` (the gate-style find-by-name; skip + note if absent); create a small numbered badge (a node) positioned at the node's corner, filled **red** (conformance) or **amber** (advisory).
- A "Review notes" panel (a frame/section) listing the `coverageGaps` (number, severity, reason) + a **legend** (red = requirement violation, amber = advisory suggestion) + the conformant verdict.
- Group all annotation nodes under the removable group.
  Verify via the figma mock: the group is created (and a prior one cleared); badges created with the right fills + counts; missing node handled gracefully; the notes panel + legend present.

**Steps (TDD):** failing tests (a report with 1 conformance + 1 advisory element flag + 1 coverage gap → the mock shows: a "UXFactory Review" group, 2 badges with red/amber fills, a notes panel listing the gap + legend; a re-review clears the prior group first; a flag whose node is absent is skipped without crashing) → RED → implement (annotation drawing + ui/panel/message wiring + mock extension) → GREEN + typecheck. Built artifact: `pnpm --filter @uxfactory/plugin build` succeeds (the plugin bundle builds). `pnpm test && pnpm typecheck && pnpm format:check` green. Record live-only items (real-Figma badge placement/visual, comment-vs-shape) in the contract notes. Commit `packages/uxfactory-plugin docs/superpowers/notes`.

## Self-Review

- No package cycle: bridge relays opaquely (no cli import); plugin types the report subset (no cli import). ✓
- CLI computes review unchanged (--annotate just posts); bridge mirrors /rendered; plugin mirrors its infra. No review-logic duplication. ✓
- §7.8 visual contract: numbered badges (red conformance / amber advisory) + coverage-gap notes panel + legend, grouped under one removable layer; re-review clears prior. ✓
- §14.2: v1 = UXFactory-rendered (node-name match); arbitrary canvas deferred. ✓
- Build-to-spec: annotation-plan fully tested; drawing mock-verified; live-only items in the contract notes. ✓

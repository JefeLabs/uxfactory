# Phase 10 — Arbitrary-Canvas Vision Review (§14.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire §14.2 best-effort review of an arbitrary (non-UXFactory-rendered) Figma design: the plugin extracts a spec-shaped CanvasSnapshot + screenshot and requests a review via the bridge relay; `uxfactory review` reviews it labeled `reliability:"best-effort"`; a vision SKILL.md has the agent do the semantic mapping. No vision model in the engine.

**Architecture:** Two steps — reading the canvas tree is DETERMINISTIC (the plugin reads `figma.*` → a `DesignSpec`-shaped `CanvasSnapshot`); the semantic mapping ("which node satisfies story-X") is the AGENT's vision step (a SKILL.md, using a screenshot). The bridge is a pure relay: `POST /canvas` (the plugin's review request: snapshot + screenshot) → `GET /canvas` (any agent — terminal default OR a backend worker — fetches it) → the agent runs `uxfactory review <snapshot> --annotate` (deterministic name-match, `reliability:"best-effort"`, reuses Phase 7 `reviewDesign`) → `POST /review` (Phase 9 relay) → the plugin annotates (Phase 9). The bridge never embeds an LLM; the fulfilling agent is pluggable.

**Tech Stack:** Node `>=20.10`, TS 6.0.3, ESM/NodeNext, `.js` imports, `verbatimModuleSyntax`. Plugin (@figma/plugin-typings + esbuild, figma mock), bridge (Fastify 5), cli. Vitest 4.1.9. Reuses Phase 7 `reviewDesign`, Phase 9 `/review` relay + plugin annotation infra.

## Global Constraints

- **Authoritative spec:** `docs/superpowers/specs/2026-06-29-arbitrary-canvas-vision-review-design.md` + PRD §14.2/§14.3/§7.8.
- WORK ON `main`. Engine SELF-CONTAINED — **no vision/LLM in the engine** (the vision/semantic mapping is the agent's, via the SKILL.md); no external cloud/runtime refs. No package cycle: the bridge relays opaquely (no `@uxfactory/cli` import); the plugin does not import the cli.
- **Reuse:** Phase 7 `reviewDesign` reviews the snapshot unchanged (it's `DesignSpec`-shaped); mirror Phase 9's `/review` relay for `/canvas`; reuse the plugin's render/snapshot/figma-mock patterns. No duplication.
- **Reliability label:** a canvas-inferred review → `reliability:"best-effort"`; a UXFactory-rendered spec → `reliability:"exact"`. End-to-end honest.
- Plugin is build-to-spec (pure serializer fully tested; `exportAsync`/POST verified via the figma mock; live-only items → contract notes).
- Conventions: `paths` only in tsconfig.typecheck.json; built artifact verified; scoped commits (never `git add -A`).

---

## Task 1: Plugin `canvas-snapshot.ts` (pure) + the "Review selection" export

**Files:** Create `packages/uxfactory-plugin/src/canvas-snapshot.ts`; Modify `src/code.ts` (a "snapshot/review-selection" message → build snapshot + exportAsync + post the request), `src/messages.ts`, `src/ui.ts` (a "Review selection" action → trigger + POST /canvas), the figma mock (extend with `exportAsync` + node-tree read); Test `packages/uxfactory-plugin/test/canvas-snapshot.test.ts` + a code.ts review-selection test.

**Interfaces:**

```ts
// canvas-snapshot.ts — PURE: a figma-node-tree-like input → a DesignSpec-shaped snapshot
export interface CanvasSnapshot {
  source: "canvas-inferred";
  page?: string;
  frames: SnapshotFrame[];
}
export interface SnapshotFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: SnapshotChild[];
}
export interface SnapshotChild {
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  characters?: string;
}
export function snapshotNode(node: FrameLike): CanvasSnapshot; // reads a selected frame's tree (names/types/text/geometry)
```

**Behavior:** `snapshotNode` walks the selected frame(s) and emits a `DesignSpec`-shaped object with `source:"canvas-inferred"` (frames + children: name, type mapped to the spec vocabulary [shape/text/instance], geometry, characters). PURE (takes a node-tree-like structure, not figma globals — testable). `code.ts` "review-selection": read `figma.currentPage.selection` → `snapshotNode` → `figma.…exportAsync` (PNG) → post `{ type:"review-selection-ready", snapshot, screenshot }` to the UI, which POSTs to the bridge `/canvas` (Task 2). Error boundary like the render path.

**Steps (TDD):** failing tests (snapshotNode: a frame with shape/text children → the right CanvasSnapshot incl. characters + source marker; an empty selection handled; type mapping correct) → RED → implement (pure serializer + code.ts wiring + mock exportAsync) → GREEN + typecheck + `pnpm --filter @uxfactory/plugin build` → commit `packages/uxfactory-plugin`.

## Task 2: Bridge `/canvas` request relay

**Files:** Modify `packages/uxfactory-bridge/src/store.ts` (save/get canvas request) + `src/server.ts` (POST/GET `/canvas`); Test the bridge tests.

**Interfaces:**

```ts
export interface CanvasRequest {
  snapshot: { source: string; frames: unknown[]; [k: string]: unknown };
  screenshot?: string;
  [k: string]: unknown;
}
class BridgeStore {
  saveCanvasRequest(r: CanvasRequest): Promise<CanvasRequest>;
  getCanvasRequest(): Promise<CanvasRequest | null>;
}
```

**Behavior:** `POST /canvas` validates the body has a `snapshot` object with `source:"canvas-inferred"` + `frames:array` (else 400); stores it; returns it. `GET /canvas` returns the latest pending request (or 404). Mirror the `/review` relay (Phase 9). The bridge does NOT import @uxfactory/cli — opaque payload.

**Steps (TDD):** failing tests (POST /canvas stores + GET returns; malformed → 400; none → 404) → RED → implement → GREEN + typecheck → commit `packages/uxfactory-bridge`.

## Task 3: CLI — review a CanvasSnapshot best-effort (+ fetch the pending request)

**Files:** Modify `packages/uxfactory-cli/src/commands/review.ts` (accept a snapshot; reliability label) + `src/review/review.ts` (add `reliability` to ReviewReport) + `src/client.ts` (`BridgeClient.getCanvasRequest`) + `src/cli.ts`; Test `test/review-cmd.test.ts` + `test/review.test.ts`.

**Behavior:**

- `ReviewReport` gains `reliability: "exact" | "best-effort"`. `reviewDesign` sets `"exact"` by default; the command sets `"best-effort"` when the design is a CanvasSnapshot (`source:"canvas-inferred"`) — detect on load — or when a `--best-effort` flag is passed. The human + `--json` output surfaces the reliability.
- `reviewCmd` loads `<design>`: a normal spec/dir (exact) OR a CanvasSnapshot JSON (best-effort). A snapshot is `DesignSpec`-shaped so `reviewDesign` reviews it unchanged; only the label differs.
- `BridgeClient.getCanvasRequest()` (GET /canvas) so the terminal agent can pull the pending request; (optional) a small affordance to review the pending canvas request directly (or the skill orchestrates: GET /canvas → write snapshot → review --annotate).

**Steps (TDD):** failing tests (a CanvasSnapshot design → review runs, report `reliability:"best-effort"`; a normal spec → `"exact"`; `--json` carries reliability; getCanvasRequest fetches a posted request from an in-process bridge) → RED → implement → GREEN + typecheck. Built artifact: `node dist/src/cli.js review <canvas-snapshot.json>` → runs + reports best-effort. `pnpm test && pnpm typecheck && pnpm format:check` green. Commit `packages/uxfactory-cli`.

## Task 4: `skill/vision-review/SKILL.md` (the agent's vision step) + vendor

**Files:** Create `skill/vision-review/SKILL.md`; extend `clients/uxfactory-cc/scripts/vendor-skill.mjs` to vendor it → `clients/uxfactory-cc/skills/uxfactory-vision-review/SKILL.md`; run the vendor step + commit. Test: a cc test (content + vendor byte-match + no external refs).

**Content (the vision flow — terminal AND backend-worker):** frontmatter `name: uxfactory-vision-review` + a triggering description (when reviewing an arbitrary/hand-made Figma design — no UXFactory spec). Teach the agent:

1. Obtain the pending canvas review request: `GET /canvas` (BridgeClient / `uxfactory` affordance) → the CanvasSnapshot (structure) + the screenshot.
2. **The vision step (the agent's judgment):** using the SCREENSHOT + the structure + the registered stories (the inputs store), infer the semantic mapping — which canvas elements satisfy which story ACs / which view-states are present / which are missing (the "which node is the checkout button" inference). This is best-effort.
3. Produce/refine a ReviewReport (best-effort): run `uxfactory review <snapshot> --annotate` for the deterministic name-match baseline, then the agent ADDS the vision-derived findings it can see that name-match missed (mapping to canvas node names where possible). Post it (review --annotate / POST /review).
4. The plugin annotates the canvas (Phase 9). State the reliability is BEST-EFFORT (vs exact for a rendered design) and say so to the user.
5. Document BOTH topologies: (a) the terminal/Claude-Code agent (default — you, reading this); (b) a backend agent worker that polls `GET /canvas` and posts `/review` (same contract; the bridge relays, doesn't embed the worker).
   Keep it focused. NO external cloud/runtime refs (agentcore/runpod/standalone "cloud").

**Steps (TDD):** failing tests (skill teaches the GET /canvas → vision-map → review --annotate → annotate flow; the best-effort labeling; both topologies; uses the screenshot for the vision step; NO external refs; vendored byte-match; cc no .mcp.json) → RED → write SKILL.md + extend vendor step + re-vendor → GREEN → `pnpm test && pnpm format:check` → commit `skill clients/uxfactory-cc`.

## Self-Review

- Vision is the AGENT's (SKILL.md) — NO vision/LLM in the engine. ✓
- Bridge `/canvas` is a pure relay (no cli import); supports terminal AND backend-worker agents (same contract). ✓
- Plugin reads the canvas tree deterministically → CanvasSnapshot (DesignSpec-shaped) + screenshot (exportAsync). ✓
- `reviewDesign` reviews the snapshot unchanged; only the `reliability:"best-effort"` label differs (vs "exact"). ✓
- §7.8 plugin annotation (Phase 9) consumes the resulting `/review` report. ✓

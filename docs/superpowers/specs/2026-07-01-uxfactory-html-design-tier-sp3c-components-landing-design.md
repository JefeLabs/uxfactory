# UXFactory HTML Design Tier — SP3c: Components, Loop Landing & Verification (Design)

**Date:** 2026-07-01
**Status:** Design — awaiting user review before plan
**Parent:** SP3 (Figma landing), final sub-project. Builds on SP3a (semantic `DesignSpec` + plugin render, shipped) and SP3b (DOM→DesignSpec extractor, shipped + live-proven: the extracted Meridian checkout landed in Figma as editable auto-layout nodes).

---

## 1. Context & goal

The chain **AI HTML → deterministic gate → craft judge → extracted semantic DesignSpec → editable Figma nodes** is live-proven, but three gaps remain to complete SP3's v1 vision:

1. Extracted specs are **component-less** — a button used on four screens lands as four unrelated frames.
2. The landing is **manual** — extract and publish were run by hand; the worker's `generate-design` loop stops at gate+craft green.
3. The landing is **unverified** — the plugin renders and posts a report, but nothing gates that report against the published spec for semantic specs (the existing `@uxfactory/gate` predates nesting/components).

**Decisions (user):** full-package scope (all three + the accumulated carry-forwards incl. typography), and component detection = **lossless + cross-view, min 2 instances**.

**Non-goals:** per-descendant geometry overrides (consequence: repeats whose descendants differ in size — e.g. buttons whose labels change their width — stay plain frames in v1; see §2); component variants/properties; componentizing bare leaves (only `Frame` subtrees); landing as a hard gate on job success (it is downstream, best-effort); responsive variants; multi-page Figma organization.

## 2. Component detection (engine, pure) — `extract/componentize.ts`

A **spec→spec post-pass**: `componentize(spec: DesignSpec): { spec: DesignSpec; stats: ComponentizeStats }`. Operates on the assembled semantic spec (not the capture tree), so it composes with any producer. Runs inside `uxfactory extract` by default (`--no-components` disables).

**Candidates:** every nested `Frame` subtree (depth ≥ 1 below a view root; view roots themselves are never candidates), across **all views** in the batch.

**Fingerprint** (deterministic structural hash, computed bottom-up): covers node kind, `width`/`height`, `layout`, `sizing`, `cornerRadius`, `effects`, `stroke`/`strokeWidth`, `opacity`, child count and ordered child fingerprints. **Excludes** `name`, `x`/`y` (instance position is free), and the override alphabet: `characters`, `fill`, `visible`.

**Grouping:** subtrees with equal fingerprints form a group; groups with **≥ 2** members become one `ComponentDef` + N `component-instance` nodes. Overlapping candidates resolve **outermost-wins** (a subtree inside an already-componentized subtree is not separately componentized); deterministic order = first occurrence in view/traversal order. Component ids `comp-1`, `comp-2`, … by that order; def `name` = the first occurrence's node name.

**Two hard gates before any rewrite (skip-not-fail, like the layout self-check):**
1. **Addressability** — overrides are keyed by descendant name, so every group member must have (a) identical descendant name sequences and (b) names unique *within* the subtree wherever an override targets them. Ambiguity → group skipped.
2. **Losslessness** — for each member, compute the per-instance overrides (the `characters`/`fill` diffs vs the def), **re-expand** the def + overrides at the instance position, and deep-compare against the original subtree (exact, post-`r2`). ANY residue → group skipped, frames stay plain.

**Rewrite:** matched subtrees are replaced by `component-instance` nodes (`component`, `name` from the original, `x`/`y`, `overrides` only where they differ); `spec.components` gains the defs. Per-view output files carry the subset of `components` their frame references; the combined file carries the full map. The componentized spec is validated (`validate()`) before writing — same self-gate as SP3b.

**Stats** (in `extract --json`): `components`, `instances`, `rejectedAmbiguous`, `rejectedLossy`.

## 3. Typography fidelity (model → extractor → plugin)

- **Model (`@uxfactory/spec`, lockstep types+schema, additive):** `TextNode` gains `fontSize?: number`, `fontWeight?: number`, `fontFamily?: string`, `lineHeight?: number` (px).
- **Extractor:** `CapturedStyles`/`EXTRACT_FN` gain the four computed props (`fontSize`, `fontWeight`, `fontFamily`, `lineHeight`); the assembler emits them on every `TextNode` (and `#text` runs, from the parent's styles): sizes/lineHeight as `px()` numbers, weight as number, family = first comma-token, quotes stripped.
- **Planner:** `PlannedChild` carries them through (friendly values; no Figma mapping).
- **Plugin:** text rendering maps weight→style name (`300:Light, 400:Regular, 500:Medium, 600:Semi Bold, 700:Bold, 800:Extra Bold`, nearest-down fallback) and tries `loadFontAsync` down a **fail-soft chain**: `(family, style)` → `(family, "Regular")` → `("Inter", "Regular")`; then sets `fontSize` and `lineHeight` (`{value, unit:"PIXELS"}`). `EditableNode`/`FakeNode` gain `fontSize`/`lineHeight` props; the mock records `loadFontAsync` attempts (it already tracks calls) so the fallback chain is testable.

## 4. Semantic landing gate (`@uxfactory/gate` + plugin counts fix)

`gate(spec, report)` internals upgrade from flat to **recursive** (flat specs are the degenerate case — no mode flag, no behavior change for existing diagram specs):
- `expectedCounts`: `objects` counts ALL descendants via recursive walk — a nested frame counts itself and recurses; a `component-instance` counts as **one** object (its internals are the component's, not the page's); component **masters** are excluded (off-flow furniture).
- `checkPresence`/`checkGeometry`: expected nodes gathered recursively with **absolute coordinates** (parent-relative accumulated down the tree); instances checked as single nodes (name/geometry). Auto-layout children keep their extracted coordinates — verified by SP3b's self-check to match, so geometry tolerance still applies cleanly.
- **Plugin coordinated fix** (closes the SP3a "shallow counts" carry-forward): `report.counts.objects` counts recursively — i.e. everything registered in `reportNodes` (nested-frame descendants are already registered; instance = one node; masters and their internals are NOT registered). Frames count = top-level frames, unchanged.

## 5. Loop integration (skill + worker)

- **`skill/design` Step 5.5 (after gate-green + craft-pass):** run `uxfactory extract --json design` (offline; the sandbox already has browsers + the CLI shim via `provisionAgentSandboxEnv`). Emit `UXF::PROGRESS {"phase":"extract", ...}` with the stats line (views, nodes, containers, components). Extraction failure does NOT retract the design deliverable — on `exit 1/2` the agent reports the failure in its final summary and completes the job normally without a landing step; the screens remain the deliverable.
- **Worker (`generative.ts`), on job success with designspec outputs present:** publish each per-view designspec through the **existing CLI publish fast-path** (shell-out via the same provisioned `uxfactory` shim — one implementation of queue semantics, no new protocol code), forwarding a `phase:"landing"` progress line per publish. Then **best-effort bounded verification**: if the bridge shows the plugin connected/rendering, wait (bounded, **60 s per view** default) for each render report and gate it with `@uxfactory/gate`, attaching per-view verdicts to the job result; otherwise the job result records `landing: "published — verification pending"` (the queue holds; whenever Figma opens, the specs land, and `uxfactory verify` can gate retroactively). **Landing never blocks or fails the design job.**
- **Job result** gains a `landing` block: `{ published: [files], verified: [{view, pass, findings}] | "pending" }`, surfaced through the existing progress→panel routing.

## 6. Masters off-flow placement (plugin)

In `renderSpec`'s component loop, masters are placed on a **negative-X strip**: cursor starts at −100 and walks left (`master.x = cursor − width; cursor = master.x − 100`), `master.y = 0`, deterministic in `components` insertion order. Masters stop landing at (0,0) over page content.

## 7. Cleanups folded in

- **`extract/layout-utils.ts`**: move `px`, `r2`, `contentBox` there; `dom-to-designspec.ts` and `layout-infer.ts` both import it — breaks the circular import.
- **Stats doc:** JSDoc on `ExtractStats` stating `containers.absolute` includes `selfCheckFallbacks` (subset, not disjoint).
- **Mock note:** comment in `figma-mock.ts` that real Figma hugs on `layoutMode` enable (the SP3b review's blind spot) — the FIXED-pinning test guards it.

## 8. Data flow (the completed tier)

```
agent: author HTML → uxfactory batch (green) → craft judge (pass) → uxfactory extract (+componentize, validate-gated)
worker: publish per-view designspecs → [plugin connected?] bounded wait → gate(spec, report) verdicts → job result
figma:  plugin renders queue → components as masters+instances (off-flow strip) → editable, typographic, auto-layout design
```

## 9. Error handling

- Componentization: skip-not-fail at group granularity (ambiguous names, lossy expansion → plain frames; never aborts extract).
- Fonts: fail-soft chain ending at Inter Regular; a missing family never aborts a render.
- Landing: publish failures reported per view (job still succeeds as a design job); verification timeout → `pending`, retriable via `uxfactory verify`.
- Gate: unchanged exit semantics; semantic specs simply produce correct expected values now.

## 10. Testing

- **`componentize` fixtures (pure):** 2× identical cards across views → 1 def + 2 instances with character/fill overrides; 3-member group; ambiguous names → `rejectedAmbiguous`; size-differing "repeat" → distinct fingerprints (no group); lossy residue (non-overridable style diff) → `rejectedLossy`; nested repeat inside a componentized subtree → outermost-wins; determinism (deep-equal across calls); output validates.
- **Typography:** spec/schema fixtures (valid + rejects); extractor emits font fields from captured styles; plugin maps weight→style, falls back down the chain (mock records attempts), sets `fontSize`/`lineHeight`; backward-compat (font-less text unchanged, Inter default).
- **Gate semantic:** recursive counts/presence/geometry fixtures (nested frames, instances-as-one, masters excluded); flat diagram specs byte-identical verdicts (regression).
- **Plugin:** recursive `report.counts`; masters strip placement (negative-X, ordered); existing 197-test suite stays green.
- **Worker:** publish + verdict attachment against a fake bridge/CLI; pending path when plugin absent; job success independent of landing.
- **Skill:** `skill/design` Step 5.5 content assertions (repo + cc parity tests).
- **Live E2E (final task):** the Meridian project — extract+componentize → publish → user opens Figma → verify green; proof artifacts to `docs/proofs/`.

## 11. File structure

- **Create** `packages/uxfactory-cli/src/extract/componentize.ts` (+ tests `extract-componentize.test.ts`).
- **Create** `packages/uxfactory-cli/src/extract/layout-utils.ts`; modify `dom-to-designspec.ts`/`layout-infer.ts` imports.
- **Modify** `packages/uxfactory-cli/src/commands/extract.ts` (componentize wiring, `--no-components`, stats), `render/dom-capture.ts` (font props).
- **Modify** `packages/uxfactory-spec/src/types.ts` + `schema/uxfactory.schema.json` (TextNode font fields; lockstep).
- **Modify** `packages/uxfactory-plugin/src/{planner.ts, code.ts}` + `test/figma-mock.ts` (fonts, masters strip, recursive counts).
- **Modify** `packages/uxfactory-gate/src/{internal.ts, checks.ts}` (recursive expected values; instance-aware).
- **Modify** `skill/design/SKILL.md` (Step 5.5) + `clients/uxfactory-worker/src/generative.ts` (publish + verify + landing block).
- **Boundaries:** engine stays pure/LLM-free (componentize is spec→spec); the worker only orchestrates (shell-out + bridge client); the plugin only renders.

## 12. Locked decisions

- **Lossless + cross-view, min 2** (user): fingerprint excludes position + override alphabet; includes geometry — so size-varying repeats do NOT componentize in v1 (documented limitation; future: geometry overrides or hug-based text sizing).
- **Outermost-wins** for overlapping candidates; ids `comp-<n>` by first occurrence; def name from first occurrence.
- **Componentize by default** in `extract`; `--no-components` opt-out.
- **Landing is downstream & best-effort** — never blocks job success; verification bounded-wait when the plugin is connected, else pending.
- **No gate mode flag** — recursive internals subsume the flat case.
- **Fonts fail-soft to Inter Regular**; weight map with nearest-down fallback.

## 13. What this completes

With SP3c, SP3 v1 is done: the worker's `generate-design` loop produces gated, craft-judged HTML **and** lands it in Figma as a componentized, typographic, auto-layout, verified design — autonomously, deterministically, LLM-free outside the authoring/judging steps. Remaining future phases tracked elsewhere: design-unit granularity + N variations ([[uxfactory-design-unit-scope]]), geometry overrides / component variants, richer fills (gradients/images).

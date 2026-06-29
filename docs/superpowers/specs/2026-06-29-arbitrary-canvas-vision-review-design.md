# UXFactory — Arbitrary-Canvas Vision Review (§14.2 best-effort) design

**Date:** 2026-06-29
**Status:** approved (decisions locked)
**Grounds in:** Implementation PRD §14.2 (reliability boundary), §14.3/§7.8 (review surfaces + annotation). Builds on Phase 7 (`reviewDesign`), Phase 9 (plugin annotations + `/review` relay).
**The last deferred item: reviewing a design UXFactory did NOT render.**

## 1. Problem

§14.2: a UXFactory-rendered design is reviewed against its known spec (exact). An **arbitrary hand-made Figma design has no spec — its structure must be inferred from the canvas, and mapping nodes to a story's required elements is a vision/semantic step.** We wire this WITHOUT putting a vision model in the engine — consistent with the whole self-contained, deterministic, no-in-engine-LLM build.

## 2. The two steps (only the second is "vision")

1. **Read the structure (deterministic).** The plugin reads the selected frame's `figma.*` node tree (names/types/text/geometry) into a spec-shaped **CanvasSnapshot**. No vision — it's a tree read.
2. **Semantic mapping (vision — the AGENT's job).** "Which canvas node satisfies story-X's checkout-button AC?" — for arbitrary node names the deterministic name-match can't resolve. The **agent** does this, using a screenshot + the structure + the registered stories, guided by a SKILL.md. Labeled best-effort.

## 3. Data flow (the bridge relays; the agent does vision; engine stays LLM-free)

```
Figma plugin                         bridge (relay)              agent (terminal OR backend worker)
────────────                         ──────────────              ──────────────────────────────────
select arbitrary frame → "Review"
read figma.* tree → CanvasSnapshot
exportAsync → screenshot PNG
POST /canvas {snapshot, screenshot}  ─►  store review REQUEST
                                         GET /canvas  ◄─────────  fetch pending request
                                                                  VISION (SKILL.md): screenshot+structure+stories
                                                                    → semantic mapping → best-effort ReviewReport
                                         POST /review  ◄─────────  uxfactory review <snapshot> --annotate
                                                                    (deterministic name-match, reliability:"best-effort")
GET /review → annotate canvas (Phase 9) ◄ relay
```

- **The bridge is a pure relay** (request in via `/canvas`, response out via the Phase-9 `/review`). It does NOT run an LLM. This makes the fulfilling agent **pluggable**: the default is the terminal/Claude-Code agent; a **backend agent worker** (the user's noted use case — designer changes a frame, the plugin requests a review, a backend worker fulfills it) is the SAME contract (consume `GET /canvas` → produce `POST /review`), so it drops in without engine changes. The engine never embeds the worker.
- **Reliability label.** A canvas-inferred review is marked `reliability: "best-effort"` in the report (vs `"exact"` for a UXFactory-rendered spec), so the verdict's fuzziness is honest end-to-end (and the plugin's annotations can say so).

## 4. CanvasSnapshot = a spec + provenance

The plugin serializes the selected frame into a `DesignSpec`-shaped object (frames + children: name/type/characters/geometry, read from `figma.*`) plus a marker `source: "canvas-inferred"`. Because it's spec-shaped, `reviewDesign` reviews it unchanged (name-match coverage); the marker (or a `--best-effort` flag) sets `reliability: "best-effort"`. The screenshot (`exportAsync` PNG — wiring the deferred §7.4 export) rides alongside for the agent's vision step.

## 5. Engine vs. agent split (self-contained; vision is the agent's)

| Concern                                                                                             | Owner                                                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Plugin: read the canvas tree → CanvasSnapshot; `exportAsync` → screenshot; POST the review request  | Engine (plugin, deterministic)                                                                   |
| Bridge: `/canvas` request relay (store/serve snapshot+screenshot); reuse `/review` for the response | Engine (bridge, pure relay — no LLM)                                                             |
| `uxfactory review <snapshot>` — deterministic name-match review, `reliability:"best-effort"`        | Engine (cli, reuses `reviewDesign`)                                                              |
| The **vision/semantic mapping** (screenshot+structure+stories → which node satisfies which AC)      | **Agent**, via `skill/vision-review/SKILL.md` (terminal default; backend worker = same contract) |

## 6. Build order (tasks)

1. **Plugin: canvas export** — `src/canvas-snapshot.ts` (pure: a `figma`-node tree → `DesignSpec` + `source:"canvas-inferred"`) + wire a "Review selection" action that builds the snapshot, `exportAsync` → screenshot, and POSTs the review request to the bridge. (pure serializer tested; `exportAsync`/POST via the mock + ui.ts.)
2. **Bridge: `/canvas` request relay** — `saveCanvasRequest`/`getCanvasRequest` + `POST /canvas` (store {snapshot, screenshot?}) + `GET /canvas` (serve the pending request). Mirror the `/review` relay; no cli import.
3. **CLI: `uxfactory review` best-effort on a snapshot** — accept a CanvasSnapshot (a spec with `source:"canvas-inferred"`) as `<design>`; mark the ReviewReport `reliability:"best-effort"` (vs `"exact"`); reuse `reviewDesign`. Also a way to fetch the pending `/canvas` request (so the terminal agent can: pull request → review --annotate).
4. **`skill/vision-review/SKILL.md`** (vendored into uxfactory-cc) — the agent's flow (terminal AND backend-worker): fetch the pending canvas request (snapshot + screenshot) → do the vision/semantic mapping against the registered stories → produce a best-effort ReviewReport → post it (`review --annotate` / POST /review) → the plugin annotates (Phase 9). Documents both topologies + the best-effort honesty.

## 7. Decisions (locked)

- **Vision is the agent's (SKILL.md), never in the engine.** Primary = terminal/Claude-Code agent; a **backend agent worker** is a supported, pluggable consumer of the same `/canvas`→`/review` relay (the bridge dispatches/relays; it does not embed the worker).
- **The plugin exports structure (CanvasSnapshot) + a screenshot** (wiring the deferred §7.4 `exportAsync`).
- Canvas-inferred reviews are labeled `reliability:"best-effort"` end-to-end (vs `"exact"`).
- CanvasSnapshot is `DesignSpec`-shaped so `reviewDesign` reviews it unchanged; the engine adds no vision.

---
name: uxfactory-vision-review
description: "Review an arbitrary (hand-made) Figma design that UXFactory did NOT render — no spec exists. The plugin extracts a CanvasSnapshot (node tree) + screenshot and posts a review request to the bridge. This skill has you fetch that request, do the semantic vision mapping (screenshot + structure + stories → which nodes satisfy which story acceptance-criteria), run the deterministic name-match baseline, then post a best-effort ReviewReport so the plugin can annotate the canvas. Use ONLY for designs not rendered by UXFactory; for UXFactory-rendered designs use the main uxfactory skill (exact review)."
compatibility: "Requires uxfactory-cli (Node 20+) and a running bridge. The vision/semantic step is yours (the agent); the engine stays LLM-free."
---

# UXFactory — Arbitrary-Canvas Vision Review (best-effort)

This skill guides you through reviewing a **hand-made Figma design that UXFactory did not render** — no spec exists, so the canvas structure must be inferred and the semantic mapping is your judgment. The engine handles the deterministic name-match; you handle the vision step.

> **Reliability:** canvas-inferred reviews are labeled `reliability: "best-effort"` in the report and annotations — not `"exact"`. Be honest with the user about this distinction.

---

## Step 1 — Fetch the pending canvas review request

The plugin has already posted the review request to the bridge via `POST /canvas` (a CanvasSnapshot + screenshot). Pull it:

```bash
uxfactory canvas fetch          # writes snapshot.json + screenshot.png to cwd
# — OR — use the bridge directly:
# GET <bridge-url>/canvas  → { snapshot: CanvasSnapshot, screenshot: "<base64 PNG>" }
```

You now have two inputs:

| Input                     | What it is                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **CanvasSnapshot** (JSON) | A `DesignSpec`-shaped tree: frames + children with `name`, `type`, `characters`, geometry. `source: "canvas-inferred"`. |
| **screenshot** (PNG)      | A pixel-accurate render of the selected frame (`exportAsync`).                                                          |

Also load the registered stories (acceptance criteria) from the inputs store:

```bash
uxfactory stories list --json   # or read uxfactory.batch.json → inputs.stories
```

---

## Step 2 — The vision step (your judgment — best-effort)

This is the semantic mapping the deterministic name-match cannot do for arbitrary node names. Using the **screenshot** as your primary signal (with the structure + stories as context):

1. **Map nodes to story ACs.** For each story and each acceptance criterion, identify which canvas node (by name from the snapshot's `children`) best satisfies it — or note that no node satisfies it.
2. **Identify view-states.** Which view-states (success, empty, loading, error) are present on the canvas? Which are missing?
3. **Identify journey dead-ends.** Follow the primary user flow through the canvas; note where the journey has no onward path.
4. **Surface vision-only findings.** Note elements that name-match will miss: e.g. a button labeled "Buy now" satisfying a "checkout-button" AC; a spinner node satisfying a "loading-state" AC; a frame labeled "Screen 3" that is visually the empty state.

Record your findings as a list of `{ nodeId?, nodeName, storyId?, ac?, verdict, note }` objects.

**Do not fabricate.** If the screenshot is ambiguous, say so in the note. Best-effort means honest inference, not confident guessing.

---

## Step 3 — Run the deterministic name-match baseline

```bash
uxfactory review snapshot.json --annotate --json > review-report.json
```

This runs `reviewDesign` on the CanvasSnapshot; because `source: "canvas-inferred"` is present, it labels the report `reliability: "best-effort"`. The `--annotate` flag writes annotation data for the plugin. The output is the **baseline** — name-match coverage only.

Read `review-report.json`. Its `findings` array lists what name-match resolved and what it missed.

---

## Step 4 — Merge vision findings into the report

Augment `review-report.json` with the vision-derived findings from Step 2:

- For each vision finding that **fills a gap** in the name-match report (a missed AC that you can visually resolve), add it to `findings` with `source: "vision"` and your `nodeName` reference.
- For each **missing view-state or dead-end** you identified, add a finding with `verdict: "missing"` and a plain-language note.
- Do **not** override name-match verdicts with vision guesses; append them.

The combined report stays `reliability: "best-effort"` end-to-end.

---

## Step 5 — Post the combined report

```bash
uxfactory review snapshot.json --annotate --post   # posts directly to the bridge /review
# — OR — pipe manually:
# POST <bridge-url>/review  body: review-report.json
```

The bridge relays the report to the plugin. The plugin's Phase-9 annotation surface reads it and annotates the canvas frames with pass/fail/missing overlays and the `reliability: "best-effort"` label.

---

## Step 6 — Tell the user

After posting, summarize:

- Which stories/ACs were resolved by name-match vs. vision inference.
- Which ACs or view-states are missing.
- **Explicitly state:** "This review is **best-effort** — the canvas structure was inferred from node names and a screenshot, not from a UXFactory spec. Mappings may be wrong; verify any vision-inferred finding against the actual design intent. For an exact review, render the design with UXFactory first."

---

## Two topologies — same bridge contract

**Topology A — Terminal / Claude Code agent (default)**

You are reading this skill. You are the agent. Steps 1–6 run in your session.

```
Figma plugin  →  POST /canvas  →  bridge  →  GET /canvas (you)
                                             vision step (you)
                                             uxfactory review --annotate (cli, local)
                                  POST /review ←  you
bridge  →  plugin annotates canvas
```

**Topology B — Backend agent worker**

A separate agent process (running this same skill) polls `GET /canvas`, fulfills the review, and posts to `POST /review`. The bridge relays both directions; it does not embed the worker. The fulfilling agent is pluggable — any agent running this skill against the same bridge URL is a valid worker.

```
Figma plugin  →  POST /canvas  →  bridge  ←─ GET /canvas  (backend agent worker)
                                                vision step (backend agent worker)
                                                uxfactory review --annotate (cli)
                                  POST /review ←─ backend agent worker
bridge  →  plugin annotates canvas
```

The bridge contract is identical for both topologies. To switch from the terminal to a backend worker, point the worker at the same bridge URL and run this skill there. No engine changes required.

---

## Quick reference

| Command                                         | Effect                                                       |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `uxfactory canvas fetch`                        | Pull pending canvas request (snapshot + screenshot)          |
| `uxfactory stories list --json`                 | List registered stories + ACs                                |
| `uxfactory review <snapshot> --annotate --json` | Deterministic name-match review, `reliability:"best-effort"` |
| `uxfactory review <snapshot> --annotate --post` | Review + post to bridge `/review`                            |
| `GET <bridge>/canvas`                           | Fetch the pending canvas review request                      |
| `POST <bridge>/review`                          | Post the ReviewReport (plugin reads + annotates)             |

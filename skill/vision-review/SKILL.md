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

The plugin has already posted the review request to the bridge via `POST /canvas` (a CanvasSnapshot + screenshot). Pull it with the real CLI command:

```bash
uxfactory canvas fetch          # writes snapshot.json + screenshot.png to cwd
# — OR, with a custom output dir —
uxfactory canvas fetch --out ./review-work
# — OR — use the bridge directly:
# GET <bridge-url>/canvas  → { snapshot: CanvasSnapshot, screenshot: <number[]> }
```

`canvas fetch` exits 0 and writes two files:

| File               | What it is                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **snapshot.json**  | A `DesignSpec`-shaped tree: frames + children with `name`, `type`, `characters`, geometry. `source: "canvas-inferred"`. |
| **screenshot.png** | A pixel-accurate render of the selected frame (`exportAsync`), decoded to a real PNG file.                              |

Also load the registered stories (acceptance criteria) from the inputs store. The canonical source is `uxfactory.batch.json → inputs.stories`:

```bash
# Read uxfactory.batch.json → inputs.stories path, then read that file directly.
# Example: if inputs.stories is "stories.json", read it:
cat stories.json   # or use the Read tool
```

If `canvas fetch` exits 2 (no pending request), tell the user to select a frame in Figma and click «Review selection» in the UXFactory plugin before running this skill.

---

## Step 2 — The vision step (your judgment — best-effort)

This is the semantic mapping the deterministic name-match cannot do for arbitrary node names. Using the **screenshot.png** as your primary signal (with snapshot.json structure + stories as context):

1. **Map nodes to story ACs.** For each story and each acceptance criterion, identify which canvas node (by name from the snapshot's `children`) best satisfies it — or note that no node satisfies it.
2. **Identify view-states.** Which view-states (success, empty, loading, error) are present on the canvas? Which are missing?
3. **Identify journey dead-ends.** Follow the primary user flow through the canvas; note where the journey has no onward path.
4. **Surface vision-only findings.** Note elements that name-match will miss: e.g. a button labeled "Buy now" satisfying a "checkout-button" AC; a spinner node satisfying a "loading-state" AC; a frame labeled "Screen 3" that is visually the empty state.

Record your findings as a list (internal to this step only — you will merge them into the report in Step 4).

**Do not fabricate.** If the screenshot is ambiguous, say so. Best-effort means honest inference, not confident guessing.

---

## Step 3 — Run the deterministic name-match baseline

```bash
uxfactory review snapshot.json --json > review-report.json
```

This runs `reviewDesign` on the CanvasSnapshot; because `source: "canvas-inferred"` is present, it labels the report `reliability: "best-effort"`. The `--json` flag emits the machine-readable ReviewReport. Do **not** use `--annotate` here — that would post the baseline (without your vision findings) prematurely.

Read `review-report.json`. Its `findings` array lists what name-match resolved and what it missed.

---

## Step 4 — Merge vision findings into the report

Augment `review-report.json`'s `findings[]` with the vision-derived findings from Step 2. Each vision finding must use the **real ReviewReport finding shape**:

```json
{
  "status": "unmet",
  "requirement": "<story id, when this fills a gap for a specific story AC>",
  "property": "<canvas node name, when the finding is tied to a specific node>",
  "detail": "<plain-language reason — what is missing or wrong>"
}
```

- `status` must be `"unmet"` or `"advisory"` (never `"met"`; never fabricate new keys like `verdict`, `note`, or `nodeId`).
- `requirement` is optional — set it when the finding is tied to a specific story ID.
- `property` is optional — set it when you can name the exact canvas node.
- `detail` is required — always a plain-language explanation.

Rules:

- For each vision finding that **fills a gap** in the name-match report (a missed AC you can visually resolve), append it with `status: "unmet"` and the relevant `requirement`.
- For each **missing view-state or dead-end** you identified, append it with `status: "unmet"` and a plain-language `detail`.
- For **advisory observations** (present but potentially problematic), use `status: "advisory"`.
- Do **not** override name-match verdicts with vision guesses; append them.
- The combined report stays `reliability: "best-effort"` end-to-end.

---

## Step 5 — Post the combined report

```bash
uxfactory canvas post review-report.json
```

`canvas post` reads the JSON file, validates it has `conformant` + `findings`, and posts it to the bridge `POST /review`. Exit 0 = success. Exit 2 = bridge error or invalid file.

The bridge relays the report to the plugin. The plugin's Phase-9 annotation surface reads it from `GET /review` and annotates the canvas frames with badges and notes. The notes panel will show `Reliability: best-effort (inferred from canvas)` when the report carries `reliability:"best-effort"`.

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
                                             uxfactory review snapshot.json --json
                                             merge vision findings into review-report.json
                                  POST /review ←  uxfactory canvas post review-report.json
bridge  →  plugin annotates canvas
```

**Topology B — Backend agent worker**

A separate agent process (running this same skill) polls `GET /canvas`, fulfills the review, and posts to `POST /review`. The bridge relays both directions; it does not embed the worker. The fulfilling agent is pluggable — any agent running this skill against the same bridge URL is a valid worker.

```
Figma plugin  →  POST /canvas  →  bridge  ←─ GET /canvas  (backend agent worker)
                                                vision step (backend agent worker)
                                                uxfactory review snapshot.json --json
                                                merge vision findings
                                  POST /review ←─ uxfactory canvas post review-report.json
bridge  →  plugin annotates canvas
```

The bridge contract is identical for both topologies. To switch from the terminal to a backend worker, point the worker at the same bridge URL and run this skill there. No engine changes required.

---

## Quick reference

| Command                               | Effect                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `uxfactory canvas fetch`              | Pull pending canvas request → snapshot.json + screenshot.png                   |
| `uxfactory canvas fetch --out <dir>`  | Same, writing to a custom directory                                            |
| `uxfactory review <snapshot> --json`  | Deterministic name-match review, `reliability:"best-effort"`, JSON output      |
| `uxfactory canvas post <report.json>` | Post the augmented ReviewReport to bridge `/review` (plugin reads + annotates) |
| `GET <bridge>/canvas`                 | Fetch the pending canvas review request                                        |
| `POST <bridge>/review`                | Post the ReviewReport (plugin reads + annotates)                               |

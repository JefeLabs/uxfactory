# SP3b live-extraction proof — 2026-07-01

End-to-end proof of the HTML design tier's Figma-landing chain on **real, agent-authored, gate-verified HTML** — not fixtures.

## Provenance

- **Source:** the SP2 craft-convergence paid run's project ("Meridian Health" cart/checkout, 2 pages × 2 views). Deterministic gate clean (exit 0, all four checks) and independently craft-judged **4/5, pass: true** (no dimension below 3).
- **Command:** `uxfactory extract --json design` at `main` (SP3b complete, incl. the whole-branch-review fixes) — real headless Chromium render → in-page `EXTRACT_FN` DOM capture → pure assembler → `@uxfactory/spec` `validate()` self-gate → these files.

## Result

```json
{"ok":true,"views":4,"excluded":[],"nodes":187,
 "containers":{"flex":41,"grid":4,"flow":8,"absolute":21},
 "selfCheckFallbacks":6}
```

- **4/4 views** extracted, exit 0, validate-gated.
- **53 of 74 containers (72%) landed as verified Figma auto-layout** — 41 from computed flex, 4 from 1-D grid, 8 inferred from block flow.
- **The 1px geometric self-check fired 6 times** on real HTML, demoting unfaithful candidates to absolute positioning — the guardrail that makes aggressive inference safe is load-bearing, not vacuous.
- Structure highlights (see `checkout-success.designspec.json`): site header + nav + button row as `horizontal` auto-layout with real gaps; the confirmation card carries its two drop-shadow `effects` and white fill; all text fills on-token; wrapper `div` chains pruned away.

## Files

- `design.designspec.json` — the combined 4-frame spec (frames side-by-side).
- `<page>-<view>.designspec.json` — per-view single-frame specs (re-positioned to x:0), as published to the plugin.
- `<page>-<view>.png` — the source screenshots of the same render pass the DOM was captured from.

The `checkout-success` spec was published to the bridge queue (`uxfactory publish`) for the plugin's DesignSpec→Figma render — the SP3a landing path.

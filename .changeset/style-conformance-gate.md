---
"@uxfactory/cli": minor
---

Advisory style-conformance gate check. The registry gains an optional
`designStyle` slug (stamped by the worker from classification or the
per-request override); the Playwright render captures style stats
(shadow count, font families, visible-element count, rounded-block
count) and the gate runs deterministic advisory rules for supported
styles — flat forbids shadows, terminal demands monospace, minimalism
caps element density, bento requires rounded-block composition.
Advisory findings inform the design loop but never fail the gate;
styles without rules skip, and report.json echoes the style.

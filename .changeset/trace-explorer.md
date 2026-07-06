---
"@uxfactory/bridge": minor
"@uxfactory/plugin": minor
---

Trace explorer. GET /project/trace joins five existing sources into one
traceability tree — features.json (storyRefs), the stories set (canonical or
legacy via the shared schema), trace.json (covering pages/views), the canvas
links registry (per-AC linked nodes), and the latest report's Coverage metric
(per-feature conformance). Stories no feature references land in an
"unassigned" bucket; every source is optional and degrades to empty lists.
The Components tab renders the tree: Feature (conformance dot) → Story
(actor · want, covering-page chips) → ACs with linked components.

---
"@uxfactory/plugin": minor
"@uxfactory/worker": patch
---

Generate status visibility + a convergence guard. The design loop already
emits rich `UXF::PROGRESS {"iter","phase","gate","status","findings",...}`
and the worker forwards every field — but the panel discarded all but
phase/note, so a run showed only "generating…". RunProgress now carries
iter/gate/status/findings, the SSE handler forwards them, and the RECENT
badge renders "iter N · phase · note" with an amber "· K failing" when a
gate step is failing — so a loop's progress (and whether it's converging) is
visible per job. Plus: the worker stamps a default `maxIterations` (8,
non-clobbering) when provisioning generate-design, so an unsatisfiable gate
(e.g. a page scoped to stories that need other pages) can't loop unbounded
and burn tokens.

---
"@uxfactory/cli": minor
---

story-regression is now state-granular: a neighbor story that loses one
covered state (e.g. its error view) fails the story-unit gate even when
another state's cover survives. Pre-existing per-state gaps are still
carried; strict mode now demands full state coverage for neighbors.

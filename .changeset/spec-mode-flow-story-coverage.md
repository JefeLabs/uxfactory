---
"@uxfactory/cli": patch
---

Spec-mode flow-story-coverage (advisory, mirroring flow-reachability's
posture): when a flow declares the stories it realizes, every frame covering
a bound story (token-boundary match — the spec-mode coverage convention)
must appear among the declared steps; unknown refs and uncovered bound
stories are findings. Binds at flow ≥ medium. The journey contract now holds
in both gate modes.

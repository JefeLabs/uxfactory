---
"@uxfactory/cli": minor
"@uxfactory/plugin": minor
---

Story-scoped generation contract. The composer gains a story scope picker
(fed by the trace endpoint): a strict subset rides the wire as
`payload.storyRefs`; the full set sends nothing. The worker stamps
`registry.storyRefs` (set-or-clear) and instructs the agent to cover EXACTLY
the declared stories. Both gate runners scope the coverage denominator to the
contract — out-of-scope stories never gate, a declared ref naming no
registered story is a must finding, the report carries `storyRefs`
provenance, and the Coverage metric counts only features fully inside the
scope (a run cannot attest features it didn't render).

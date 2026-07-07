---
"@uxfactory/spec": patch
"@uxfactory/plugin": patch
---

Flows story-binding elicitation. The flows interview gains a [D]-grade
"Which registered stories does this flow realize?" question — the create
dialog prefills it with the project's registered story ids (derived from the
story-namespaced requirement ids), the user edits down to the subset, and
the answer rides the guidance. The worker's flows instruction now tells the
agent to mirror the realized story ids into design/user-flow.json as
`storyRefs`, closing the loop with the flow-story-coverage gate.

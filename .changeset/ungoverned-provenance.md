---
"@uxfactory/cli": patch
---

Escape-hatch provenance flows end to end. The worker reads the panel's
ungoverned annotation: the design agent is told the run is an
ungoverned draft (state assumptions prominently; never present invented
brand values as registered), and the batch registry stamps
ungoverned:true with set-or-clear semantics — governed runs clear the
stale flag. The CLI validates the registry field and passes it through
to report.json, so every gate report records whether its run generated
with or without its required grounding.

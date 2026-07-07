---
"@uxfactory/spec": minor
"@uxfactory/cli": minor
"@uxfactory/bridge": minor
"@uxfactory/plugin": minor
---

Page components → specific acceptance criteria (page-tier, advisory). Trace
cover claims gain an optional `acId` (validated when present); the engine AC
now carries its id end to end. A new advisory `ac-binding-coverage` check
reports every auto-checkable AC not claimed by a visible element carrying its
`data-ac="<story>/<acId>"` — nudging the agent to bind every AC to a
component without breaking legacy trace files. The bridge trace join adds
per-AC `coveredBy` (which page elements realize each AC), and the trace
explorer shows the covering-page chip on each AC row beside its linked canvas
nodes. Component-tier units stay claims-only (reuse). Worker instruction
updated to emit acId + data-ac bindings on page-tier runs.

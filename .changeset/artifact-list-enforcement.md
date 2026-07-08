---
"@uxfactory/spec": minor
"@uxfactory/cli": patch
"@uxfactory/worker": patch
---

Enforce list-shaped enumerations in intent artifacts. Two levers, so listed
items render as bullets in the artifact viewer instead of comma-prose: (1) the
brief/artifact producer instruction now mandates markdown lists (one "- item"
per line) for any enumeration (scope, outcomes, risks, constraints); (2) a
`brief` validator rule warns when an enumerable line is authored as a
comma/semicolon run of 3+ short standalone items rather than a markdown list —
advisory, and tightened to skip parenthetical enumerations and comma clauses
inside prose. `validate-artifact brief` reads the markdown and runs it.

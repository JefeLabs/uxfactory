---
"@uxfactory/spec": minor
"@uxfactory/cli": minor
"@uxfactory/bridge": minor
"@uxfactory/plugin": minor
---

Copy-deck shipped end-to-end — the anti-lorem-ipsum artifact. Registered at
`.uxfactory/artifacts/content/copy-deck.json` (19 registered; new `content`
snapshot group). Slots + exact text: generated HTML claims deck entries via
`data-copy="<key>"`, the renderer captures every claim, and the
copy-conformance must-check binds whenever a deck is registered — entry keys
bind to pages by first segment, every bound entry needs a visible text-EQUAL
claim (paraphrase is a finding), unknown keys and drift fail loudly, and
satisfaction unions across a page's views. Elicitation approves generated
candidates per slot; the worker's design loop renders deck entries verbatim
and claims them. copy-deck now blocks page-tier generation when missing
(escape hatch: ungoverned drafts). Decisions 15 and 16 recorded as confirmed.

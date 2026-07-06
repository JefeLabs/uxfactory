---
"@uxfactory/spec": minor
"@uxfactory/cli": minor
"@uxfactory/bridge": minor
"@uxfactory/plugin": minor
---

Stories with nested ACs (mapping decision 6). `stories` is now the registered
intent artifact — a set at `.uxfactory/artifacts/stories/*.json`, one canonical
story per file (actor/want/soThat + Given/When/Then ACs); `acceptance-criteria`
is superseded and appears in no requires block. The spec ships the shared
story schema (`parseStoryFile`, `storyToEngine`, `deriveImpliedState`) — GWT
triples render into engine statements, impliedState derives from a keyword
table unless explicit, and manual-checkable ACs never gate. The CLI stories
input accepts the set directory (legacy single file byte-identical) and gains
`uxfactory migrate-stories`. The bridge reports a set-aware `stories` row
(renaming the `requirements` snapshot key) with story-namespaced requirement
ids. The panel maps the stories artifact end-to-end: grounding chip, set row,
per-story interview chaining transitively from personas.

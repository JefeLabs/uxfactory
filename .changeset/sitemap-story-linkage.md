---
"@uxfactory/spec": patch
"@uxfactory/bridge": patch
"@uxfactory/plugin": patch
---

Sitemap↔story linkage — the last trace-graph edge. The sitemap interview
gains the [D]-grade "Which features does each page serve?" question, and the
worker's sitemap instruction tells the agent to give each node a
`featureRefs` array derived from the stories the page realizes. The trace
endpoint joins those links into per-feature `plannedPages`, and the trace
explorer renders them as a "planned:" chip — planned IA homes (sitemap) now
sit beside realized coverage (trace.json) in one view.

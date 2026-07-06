---
"@uxfactory/cli": minor
"@uxfactory/plugin": minor
---

The Coverage METRIC (mapping decision 12): conformed features / total, with
`features` as the denominator. Both gate runners stamp `featureCoverage` into
report.json when a features input is registered — derived from the coverage
gate's story-prefixed finding refs, mode-agnostic, advisory only (it can never
flip `clean`). A feature is conformed when every storyRef names an existing
story that contributes no coverage finding. The Checks T1 row renders
"N of M features conformed", and the generation dial renames to **Breadth**
(display only; the scope wire key stays `coverage`) now that the metric owns
the Coverage name.

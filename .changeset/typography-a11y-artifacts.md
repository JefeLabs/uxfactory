---
"@uxfactory/spec": minor
"@uxfactory/bridge": patch
"@uxfactory/plugin": patch
---

Typography and A11y spec ship as real artifact types — the mapping
PRD's rank-1 build items. Registry status flips to registered, which
activates their requirement slots everywhere at once: composer chips
become required-missing create affordances, Artifacts-tab rows gain
Create, and their required levels start counting toward the ungoverned
annotation. Typography lives as design-system.json#typography (section
concern, migrate-on-touch like its siblings) with prerequisites on
fonts and a place in the tokens materialization chain; A11y spec lives
at .uxfactory/artifacts/accessibility.json — deliberately the shortest
interview in the registry (target defaults to WCAG 2.2 AA; only
exceptions are elicited). The worker's generate-artifact map covers
both keys.

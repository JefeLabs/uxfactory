---
"@uxfactory/spec": minor
"@uxfactory/plugin": minor
---

Project quadrant config field. `@uxfactory/spec` exports `PROJECT_QUADRANTS`
(greenfield / re-skin / extend / redesign with descriptions) and
`normalizeQuadrant` (anything unknown → greenfield). The panel's ContextBar
gains an always-visible Quadrant chip with a Segmented editor + description
caption; saves are set-or-clear (greenfield omits the key from
classification). The composer threads the project quadrant into
`resolveRequirements`, so grounding chips and the missing-blocking count now
honor quadrant relaxation — e.g. re-skin demotes stories/ACs/sitemap to
recommended and no longer flips the run ungoverned.

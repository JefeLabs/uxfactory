---
"@uxfactory/cli": minor
---

The HTML batch gate is design-unit aware. `uxfactory.batch.json` gains an
optional validated `unit` field (user-flow, home-page, secondary-page,
tertiary-page, page, template, organism, molecule, atom, plus the channel
units email, instagram-post, instagram-story, youtube-thumbnail,
facebook-post, x-post). Component-tier units (organism/molecule/atom and all
channel units) are gated claims-only — render failures and dead/invisible
trace claims still fail, but full story×state coverage is not owed. The
user-flow unit owes a new `flow-steps` must-check (≥2 distinct rendered
screens). report.json echoes the unit and the rubric reflects the
unit-adjusted binding set.

The renderer honors viewports: `uxfactory.batch.json` also gains an optional
validated `viewports` array ({name, width, height}); the HTML batch renders
every trace view once per viewport into per-viewport preview subdirectories,
and the gate runs over the union of snapshots. Absent → the legacy single
390×844 render.

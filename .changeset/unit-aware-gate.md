---
"@uxfactory/cli": minor
---

The HTML batch gate is design-unit aware. `uxfactory.batch.json` gains an
optional validated `unit` field (user-flow, home-page, secondary-page,
tertiary-page, page, template, organism, molecule, atom). Component units
(organism/molecule/atom) are gated claims-only — render failures and
dead/invisible trace claims still fail, but full story×state coverage is not
owed. The user-flow unit owes a new `flow-steps` must-check (≥2 distinct
rendered screens). report.json echoes the unit and the rubric reflects the
unit-adjusted binding set.

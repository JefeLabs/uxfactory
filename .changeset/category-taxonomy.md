---
"@uxfactory/spec": minor
"@uxfactory/plugin": patch
---

Project category graduates from four pills to the 34-category taxonomy
(8 groups) from the category-taxonomy PRD. @uxfactory/spec ships
CATEGORY_TAXONOMY (per-category profile: orientation, sparse dial
defaults, IA seed, component emphasis, activations, compliance
posture), legacy aliases + normalizeCategory (marketing/ecommerce/
webapp/news keep working; the next save upgrades them), categoryLabel,
and categoryConsequences. The panel replaces the category ChipGroup in
setup and the ContextBar chip editor with a grouped droplist whose
caption previews the selection's consequences before commit; the
ContextBar chip shows the taxonomy label; category dial defaults
overlay the wizard's dial suggestions; style suggestions key off
taxonomy groups.

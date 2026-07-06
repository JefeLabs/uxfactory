---
"@uxfactory/spec": minor
"@uxfactory/plugin": patch
---

Project industry graduates to the 76-industry taxonomy (13 sectors)
from the industry-taxonomy PRD. @uxfactory/spec ships INDUSTRY_TAXONOMY
(per-industry drivers caption + compliance flags: regulated,
age-sensitive, age-gated, jurisdiction-sensitive), legacy aliases +
normalizeIndustry ("Corporate" is retired as a business-model axis and
aliases to Consulting; finance/healthcare/etc. map to their nearest
profiles), and industryLabel/industryDrivers. The panel replaces the
flat industry select in setup and the ContextBar chip editor with a
sector-grouped droplist whose caption shows the selection's drivers and
flags; saves upgrade legacy values; the ContextBar chip shows the
taxonomy label. Deferred per the doc: the Audience-model field,
free-text Other profiles, multi-select, and flag consumers
(policy/elicitation nudges).

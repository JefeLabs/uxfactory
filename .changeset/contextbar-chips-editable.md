---
"@uxfactory/plugin": patch
---

Every ContextBar chip is now clickable and edits inline under the bar,
and the generative defaults set in project setup finally appear as
chips. Classification facts (category, layout, industry, locale, age
group, platforms) open the same controls as the setup wizard — shared
vocabularies extracted to lib/classification-options.ts — and persist
through PUT /project/classification. Generative dials (Tone, Visual,
Editorial, Flows, Coverage, Coherence) render as label·value chips from
profile.scope / experimental.coherence / classification.style and save
single-key bodies through PUT /project/profile. Dial chips gained a
proper accessible name (label + value). One editor opens at a time;
Save/Cancel buttons are named per field ("Save category", "Save tone").

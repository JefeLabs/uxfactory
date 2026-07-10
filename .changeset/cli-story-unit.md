---
"@uxfactory/cli": minor
---

New `story` design unit: revise one story's coverage in place. The gate keeps
the full story denominator, enforces the named story to full coverage, and the
new `story-regression` check blocks any co-located story from losing coverage
relative to the last full-denominator report (strict when no baseline exists).

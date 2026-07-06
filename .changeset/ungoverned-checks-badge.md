---
"@uxfactory/plugin": patch
---

Ungoverned provenance badge in Checks. When report.json carries
`ungoverned: true` (the run was submitted with required grounding artifacts
missing), the tier model surfaces it and the Checks header shows an amber
"Ungoverned draft" badge with an explanatory tooltip. A queue-job badge is
deferred: queue files are bare designspecs today, so per-job provenance needs
publish-time capture first.

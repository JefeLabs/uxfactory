---
"@uxfactory/cli": minor
---

`uxfactory up` reconciles job counters across mid-job worker crashes (the
root is reaped again after the respawn instead of idling forever) and
validates `--idle` input instead of treating a typo as reap-immediately.

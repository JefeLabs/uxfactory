---
"@uxfactory/cli": patch
"@uxfactory/bridge": patch
"@uxfactory/plugin": patch
---

Queue-job ungoverned provenance. `writeQueueFile` snapshots the latest
report's provenance (`ungoverned`, `storyRefs`) to `queue/meta/<jobId>.json`
at publish time — per-job, never inferred from current project state, the
same cross-run-aliasing defense the preview snapshot uses. The bridge's
/queue surfaces `ungoverned: true` per job from the sidecar, and the Queue
tab shows an amber "Ungoverned draft" badge with an explanatory tooltip so
approval decisions see the run's grounding status.

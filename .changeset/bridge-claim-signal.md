---
"@uxfactory/bridge": minor
---

BridgeOptions gains `onRequestClaimed(root, kind)`, fired when a worker
dequeues a job — the signal the up supervisor uses to split queued vs
in-flight counts so a mid-job worker crash can be reconciled.

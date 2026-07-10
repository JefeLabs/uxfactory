---
"@uxfactory/bridge": minor
---

Job-signal callbacks (`onRequestEnqueued`, `onRequestSettled`) and a
`managedRoots` accessor on BridgeOptions; snapshots, connect responses, and
worker-status frames now carry a `managed` flag so panels can tell
reaped-but-respawnable (on-demand) roots from genuinely unserved ones.

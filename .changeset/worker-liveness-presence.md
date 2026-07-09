---
"@uxfactory/bridge": minor
---

Worker liveness: workers tag their /pipeline/events subscription with
?client=worker&root=&kinds=; the bridge tracks presence per root, exposes it
as a `workers` array on GET /project/snapshot and POST /project/connect, and
broadcasts `worker-status` frames on every transition. POST /project/connect
promotes workers that subscribed before their root was served.

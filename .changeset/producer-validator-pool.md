---
"@uxfactory/bridge": minor
"@uxfactory/worker": minor
---

Producer/validator pool. Now that producers are pool-safe (they write only
isolated scratch; the bridge is the single canonical writer), the worker can
run a POOL: `runPool(deps, concurrency)` runs N independent drain lanes
sharing one bridge, so up to N jobs are in flight at once while each lane
still serializes its own. The bridge's claim endpoint gains a kind filter —
`GET /pipeline/request/next?kinds=generate-artifact` — and the store's
dequeue honors it, so a producer pool claims only its kinds and never steals
the design worker's generate-design jobs (and vice versa). Configured via
UXFACTORY_WORKER_POOL (lane count) and UXFACTORY_WORKER_KINDS (claimed kinds);
runWorker is now runPool(deps, 1). Deploy: run a producer pool
(POOL=4 KINDS=generate-artifact) alongside a single design worker
(KINDS=generate-design).

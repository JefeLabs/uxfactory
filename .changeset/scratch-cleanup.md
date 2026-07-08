---
"@uxfactory/worker": patch
---

Producer scratch cleanup. After a producer's write-intent is built from its
isolated scratch file, the worker removes the per-job scratch directory
(.uxfactory/scratch/<id>/) — the bridge owns the canonical write, so the
scratch is disposable. Debug mode (UXFACTORY_WORKER_DEBUG=1, or ctx.debug)
RETAINS scratch for inspection. Best-effort: a failed cleanup never fails the
run. The startup log shows `debug` when enabled.

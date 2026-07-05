---
"@uxfactory/gate": patch
"@uxfactory/bridge": patch
"@uxfactory/cli": patch
---

Three fixes from live multi-run testing. Queue previews are snapshotted
per-job at publish time (queue/previews/<jobId>.png) and served
preferentially, so later runs overwriting the shared previews directory
can no longer alias screenshots onto older jobs. extract clears stale
*.designspec.json before writing, so the landing step only publishes the
current run's specs. The gate's geometry check is auto-layout aware:
x/y are skipped for children of auto-layout containers and width/height
on fill/hug axes, since Figma re-flows those — static geometry in plain
containers still verifies exactly.

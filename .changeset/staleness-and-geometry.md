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
inside an auto-layout subtree Figma owns re-flow (hug/fill cascades down
through descendants), so geometry is skipped for the whole subtree, and
width/height on declared fill/hug axes are skipped everywhere — static
geometry in plain containers still verifies exactly.

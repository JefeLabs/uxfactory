---
"@uxfactory/bridge": patch
---

Panel artifacts now live in the `.uxfactory/artifacts/` work directory (brief, sitemap, flows, design-system, asset registries). Reads fall back to legacy locations (repo-root `brief.md`, `design/*`); writes always land canonical and migrate-on-touch (the legacy copy is removed after a successful canonical write). Engine gate inputs — `design/acceptance-criteria.json` and `design/token-set.json` — keep their engine-conventional paths and remain registry-overridable.

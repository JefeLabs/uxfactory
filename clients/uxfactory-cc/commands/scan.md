---
description: Rebuild the UXFactory asset catalog (friendly name → component key)
allowed-tools: Bash(uxfactory:*)
---

Rebuild the asset catalog that resolves friendly asset names (e.g. `aws:lambda`, `k8s:pod`, `gcp:pubsub`) to Figma component keys. Run `uxfactory scan`.

It writes `.uxfactory/catalog.json`. Run this whenever an `asset` name in a spec fails to resolve, or after the published asset library changes.

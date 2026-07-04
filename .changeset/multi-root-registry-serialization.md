---
"@uxfactory/bridge": patch
---

Serialize repo-registry writes through a per-instance promise chain so two
panels connecting different roots at once can no longer lose each other's
persisted entry (interleaved read-modify-write on ~/.uxfactory/repos.json).
Duplicate `?root=` query params now resolve to a clean 400 `root-invalid`
instead of crashing the route to a 500.

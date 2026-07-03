---
"@uxfactory/bridge": minor
---

POST /project/connect now registers and serves any valid project root (deduped
in the user-level registry) and returns that root's snapshot, instead of
refusing non-launch roots. The bridge-serves-different-root error is removed;
remaining connect errors are not-found and not-a-root.

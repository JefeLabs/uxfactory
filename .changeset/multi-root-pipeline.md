---
"@uxfactory/bridge": minor
---

Root-tag the pipeline relay. POST /pipeline/request stamps every job with its
resolved root (from ?root= or the launch-root fallback); GET
/pipeline/request/next?root= claims only jobs for that root. A legacy poll
without ?root= claims launch-root jobs only, so a worker never steals another
repo's work.

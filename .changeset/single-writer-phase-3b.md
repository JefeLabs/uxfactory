---
"@uxfactory/worker": minor
---

Single-writer phase 3b: artifact producers emit write-intents instead of
writing canonical files. A non-set generate-artifact producer now writes its
draft to an ISOLATED per-job scratch path (.uxfactory/scratch/<id>/<key>);
the worker reads it back and returns a write-intent in the result, which the
bridge's single writer applies to the canonical file (deterministic section
merge for design-system.json, plain write otherwise). The agent never touches
a shared file, so producers are safe to run on a parallel pool. Section
producers now output just their section's content (the merge moved to the
bridge). Set artifacts (personas/stories directories) keep the direct-write
path for now. REQUIRES the phase-2 bridge — new worker + old bridge would
drop the write; deploy them together.

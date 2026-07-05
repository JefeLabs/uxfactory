---
"@uxfactory/plugin": patch
---

Design style is now a generative default with an explicit exploring
state, not a classification fact. The picker moved from setup step 1 to
Generation defaults (step 2), defaulting to "Exploring — no default
yet" — the industry suggestion is a marker, never auto-committed. The
ContextBar gains a clickable "Style:" chip that deploys an inline
editor under the bar; saving merges designStyle into the classification
file with set-or-clear semantics (exploring removes the key, so the
advisory style gate is not owed and the composer's per-request override
is the only style input). Storage stays in
uxfactory.classification.json — the worker and gate read it unchanged.

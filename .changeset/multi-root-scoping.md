---
"@uxfactory/bridge": minor
---

Root-scope every /project/* route via a ?root= query param (all verbs). Each
request re-resolves through the served-root registry: 403 root-not-served for
an unregistered root, 410 root-gone for a served root whose markers vanished,
and a launch-root fallback when ?root= is absent. Path containment is enforced
per resolved root, guaranteeing every write lands inside the connected repo.

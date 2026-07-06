---
"@uxfactory/spec": minor
"@uxfactory/bridge": patch
"@uxfactory/plugin": patch
---

Personas ship as the registry's first SET artifact (one JSON file per
instance under .uxfactory/artifacts/personas/). The bridge gains
set-concern status (missing / draft on any unparseable member /
up-to-date with an "N personas" count) while single-file artifact
GET/PUT correctly rejects set keys; the worker's generate-artifact
writes one file per persona (2–4 unless guided otherwise); the panel
maps the key, adds the interview (archetypes, goals, frustrations,
context — quote stays cosmetic), and set rows offer external open only
(no single-file editor). This is the upstream half of the gate hinge:
stories chain onto personas the day they ship. Mapping decisions 1, 2,
12, 13, 14 are recorded as resolved in the PRD.

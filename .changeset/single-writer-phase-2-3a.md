---
"@uxfactory/bridge": minor
"@uxfactory/worker": minor
---

Single-writer phases 2–3a. The bridge now applies producer write-intents:
POST /pipeline/result reads `result.writes` and applies each via
applyArtifactWrite (serialized per path), resolving the target root from a
retained id→root map. Backward compatible — results without writes are
unchanged. The worker gains `loadArtifactSkill(key)`: a generate-artifact
producer loads its specialist skill at skill/artifacts/<key>/SKILL.md when
present, else the generic generate skill (key sanitized against traversal).
Ships the first specialist — skill/artifacts/brand-colors/SKILL.md — which
encodes role-based palette structure, AA/AAA contrast constraints, and a
"have a point of view, not corporate-blue-default" rule with a self-eval
checklist. Together these make the producer a specialist and the bridge the
single writer — the mechanism a parallel producer pool needs to be safe.

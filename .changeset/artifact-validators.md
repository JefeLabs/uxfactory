---
"@uxfactory/spec": minor
"@uxfactory/cli": minor
---

Per-artifact validators/evals — the deterministic quality gate for intent
artifacts. UXFactory verifies designs against registered intent; these verify
the INTENT itself before anything downstream consumes it. `validateArtifact(
key, body, ctx)` in @uxfactory/spec runs pure, LLM-free rules — schema,
cross-artifact referential integrity (features→stories, sitemap→features,
stories→personas), and computed quality (WCAG contrast via `contrastRatio`) —
returning error/warn findings. Rules ship for brand-colors, features,
audience, personas, stories, sitemap, and copy-deck; error fails, warn
advises. `uxfactory validate-artifact <key>` reads the artifact + its
referential context and runs them (exit 0 clean / 1 findings / 2 setup).
This is the fast inner loop a producer iterates against, and the "validator"
half of the producer/validator pool.

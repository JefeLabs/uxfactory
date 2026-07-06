---
"@uxfactory/spec": minor
"@uxfactory/plugin": patch
---

The Create-artifact dialog becomes the elicitation interview. The spec
package ships ARTIFACT_ELICITATION — the [E]/[F] question scripts from
the elicitation doc for every registered artifact (requirements and
tokens stay guidance-only by design), with tests enforcing the doc's
discipline (≤5 [E] questions, [F] always carries a default). The dialog
renders the interview above the free guidance prompt: required [E]
questions gate Generate, [F] answers arrive prefilled (silence accepts
the default), and answers + guidance compose into the existing
guidance wire — worker and bridge untouched.

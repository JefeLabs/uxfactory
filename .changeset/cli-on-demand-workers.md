---
"@uxfactory/cli": minor
---

`uxfactory up` workers are now on-demand: jobs spawn them, a 10-minute idle
timeout reaps them (`--idle <minutes>`, 0 disables), and connected roots stay
advertised as managed so panels don't warn about reaped workers.

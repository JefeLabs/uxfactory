---
"@uxfactory/cli": minor
---

Two new commands: `uxfactory worker` runs a generation worker for one project
root (foreground, spawned from the checkout's worker package), and
`uxfactory up` runs the supervised stack — bridge in-process plus one
auto-restarted worker per connected project root.

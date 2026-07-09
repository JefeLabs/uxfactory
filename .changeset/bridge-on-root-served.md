---
"@uxfactory/bridge": minor
---

BridgeOptions gains an optional `onRootServed(root)` callback, fired with the
resolved root after every successful POST /project/connect — the hook
`uxfactory up` uses to ensure a worker per connected root.

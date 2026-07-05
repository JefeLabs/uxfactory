---
"@uxfactory/bridge": patch
"@uxfactory/plugin": patch
---

Settings gains a Danger zone with "Reset repo". POST /project/reset
(root-scoped, 403 on unserved roots) wipes the repo's Figma-file
associations — node links, render reports incl. verify history, and
canvas snapshots — while pipeline state (queue, batch previews)
survives; emptied directories keep their scaffold so the live store
stays writable. The panel confirms with an explicit destructive dialog,
then forgets the file's stored connection and histories, disconnects,
and returns to the Connect screen. A failed bridge call changes
nothing and leaves the connection intact.

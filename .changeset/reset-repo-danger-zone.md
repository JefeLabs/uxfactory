---
"@uxfactory/bridge": patch
"@uxfactory/plugin": patch
---

Settings gains a Danger zone with "Reset repo" — a soft reset. POST
/project/reset (root-scoped, 403 on unserved roots) MOVES the repo's
Figma-file associations (node links, render reports incl. verify
history, canvas snapshots) and the panel-authored project definition
(artifacts like the brief, classification, quality profile) into a
timestamped .uxfactory/archive/reset-<stamp>/ folder — nothing is
deleted and everything is manually restorable. Pipeline state (queue,
batch previews) stays live and emptied directories keep their scaffold
so the running store stays writable. The panel confirms with an
explicit dialog, then forgets the file's stored connection and
histories, disconnects, and returns to the Connect screen. A failed
bridge call changes nothing and leaves the connection intact.

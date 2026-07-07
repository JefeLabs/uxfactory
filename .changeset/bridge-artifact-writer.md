---
"@uxfactory/bridge": minor
---

Single-writer foundation: `applyArtifactWrite` — the bridge's deterministic
artifact writer. Generation is parallelizable but writing must serialize; in
the single-writer model many specialized producer agents draft artifacts
concurrently and return write-intents, and the bridge applies them here. A
per-path async lock makes concurrent applies safe: merges into the same file
(design-system.json sections) serialize behind the lock so none is lost to an
interleaved read-modify-write, while distinct files run concurrently. Handles
section merge (preserving other sections), set-artifact instance files, and
whole-file/markdown writes, with a path-traversal guard. Not yet wired into
POST /pipeline/result — that + the producer side land next.

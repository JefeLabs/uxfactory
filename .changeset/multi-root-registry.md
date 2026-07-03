---
"@uxfactory/bridge": minor
---

Add a user-level repo registry (~/.uxfactory/repos.json) and an in-memory
served-root set seeded with the launch root, plus GET /fs/repos (cwd + repo
listing, launch root pinned first, dead entries flagged). Foundation for one
bridge serving multiple project roots concurrently.

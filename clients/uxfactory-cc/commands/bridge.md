---
description: Start the local UXFactory bridge relay on localhost:3779
allowed-tools: Bash(uxfactory:*)
---

Start the UXFactory bridge — the localhost relay the Figma plugin polls. Run `uxfactory bridge` (override the port with `--port` or `UXFACTORY_PORT`).

The bridge foregrounds the relay, so keep it running in its own terminal. Once it is up, confirm `GET http://localhost:3779/health` returns `{ ok: true }`, then open the UXFactory Figma plugin in the target file so it connects.

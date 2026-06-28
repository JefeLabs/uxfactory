---
description: Confirm the UXFactory loop is live (bridge up + Figma plugin connected)
allowed-tools: Bash(uxfactory:*)
---

Confirm the UXFactory loop is live before publishing. Run `uxfactory selection` — it reads the current Figma selection over the bridge's REST API, so it doubles as a health + plugin-connection probe:

- exit `0` (a selection result) → the bridge is up AND the Figma plugin is connected to the target file;
- exit `2` → the bridge is not running (start it with `/uxfactory:bridge`) or the Figma plugin is not open.

For a raw liveness check independent of the plugin, the bridge also serves `GET http://localhost:3779/health`, which returns `{ ok: true, pending }` when the relay is running.

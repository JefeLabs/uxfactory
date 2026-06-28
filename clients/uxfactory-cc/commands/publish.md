---
description: Publish a UXFactory spec to the connected Figma file and wait for the render report
argument-hint: <spec.json>
allowed-tools: Bash(uxfactory:*)
---

Render the given UXFactory spec to the connected Figma/FigJam canvas and block until the render report lands. Run `uxfactory publish $ARGUMENTS --wait`.

Rendering is deterministic and idempotent — re-publishing the same spec is safe. If the call exits `2`, the bridge is down (`/uxfactory:bridge`) or the Figma plugin is not open; surface that to the user rather than retrying blindly. To gate the result PASS/FAIL after rendering, follow with `/uxfactory:verify $ARGUMENTS`.

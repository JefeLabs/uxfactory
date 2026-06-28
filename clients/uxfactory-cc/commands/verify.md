---
description: Gate the latest render against a UXFactory spec, PASS/FAIL
argument-hint: <spec.json>
allowed-tools: Bash(uxfactory:*)
---

Gate the most recent render against the given spec via the bridge's `POST /verify`. Run `uxfactory verify $ARGUMENTS`.

Interpret the exit code: `0` = PASS (done); `1` = FAIL — read the `failures[]`, correct the spec to match intent, and re-publish; `2` = transport/setup error (bridge down or plugin not open) — fix the environment, do NOT treat it as drift. Add `--json` for structured output.

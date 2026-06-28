# uxfactory-cc — UXFactory for Claude Code

The Claude Code plugin for [UXFactory](https://uxfactory.dev): render and verify
structured Figma/FigJam diagrams (architecture, deployment topologies, retro
boards, release flows) from JSON specs — design-as-code, gated PASS/FAIL.

It is **MCP-free**: it ships no tool server. Instead it teaches Claude Code to
drive the `uxfactory` CLI over Bash, bundling the UXFactory skill, slash
commands, and two hooks (sync-on-edit + drift-notify).

## Install

```bash
# 1. Add the marketplace (this repo)
/plugin marketplace add uxfactory/uxfactory

# 2. Install the plugin
/plugin install uxfactory@uxfactory
```

## Prerequisites

This plugin orchestrates the local UXFactory loop — it does not replace it.

1. **The CLI.** The plugin shells out to the published CLI; install it or use
   `npx`: `npm i -g uxfactory` (or rely on `npx uxfactory`).
2. **The bridge.** Start the localhost relay with `/uxfactory:bridge` (it runs
   `uxfactory bridge` on `localhost:3779`).
3. **The Figma plugin.** Open the `uxfactory-plugin` in the target Figma/FigJam
   file so it polls the bridge. Without it, publishes time out (CLI exit `2`).

## Bash permission (the trade for dropping MCP)

The slash commands declare `allowed-tools: Bash(uxfactory:*)` so they run without
a generic shell prompt. So the skill-driven calls and **both hooks** run
unprompted, allowlist the binary in your Claude Code settings:

```json
{ "permissions": { "allow": ["Bash(uxfactory:*)"] } }
```

## What it bundles

- `skills/uxfactory/SKILL.md` — the UXFactory skill (vendored from the
  monorepo's canonical `skill/SKILL.md`).
- `commands/` — `/uxfactory:bridge`, `:publish`, `:verify`, `:scan`, `:status`.
- `hooks/hooks.json` — `PostToolUse(Write|Edit)` re-renders `*.uxfactory.json`
  edits; `SessionStart` surfaces spec-vs-reality drift.

# Quick Start — Vibe Figma 🎨

**Vibe Figma** = design like you vibe-code. You _describe_ a screen as a small JSON spec (or let an agent write it), it **renders into Figma** through a local bridge, and a **gate verifies** the canvas matches what you asked for — so you iterate by editing text and re-rendering, not by pushing pixels.

```
   you (or an agent)            uxfactory CLI            Figma
   ───────────────────          ─────────────            ─────
   write/edit a spec   ──►   publish ──► bridge ──►  plugin renders it
        ▲                                              │
        └──────  verify (PASS/FAIL) ◄── gate ◄────  render report
```

Three ways to vibe, smallest setup first:

- **Offline** — render a spec to PNG/SVG and gate a _batch_ of screens, no Figma at all.
- **Live** — render specs straight into Figma via the bridge + plugin.
- **Agent-driven** — drive the whole loop from Claude Code (the real "vibe": talk, it renders).

---

## Prerequisites

- **Node ≥ 20.10** and **pnpm** (`corepack enable`)
- **Figma desktop app** (for the live loop — the plugin runs there)
- _(optional)_ **Claude Code** for the agent-driven loop

---

## 0. Build the CLI (it's source-first, v0.0.0)

UXFactory isn't on npm yet — build it from this repo and put `uxfactory` on your PATH:

```bash
pnpm install
pnpm -r build
cd packages/uxfactory-cli && pnpm link --global && cd -   # gives you the `uxfactory` command
uxfactory --help
```

> Prefer not to link globally? Use `node packages/uxfactory-cli/dist/src/cli.js …` anywhere this guide says `uxfactory …`.

---

## 1. Your first spec

A spec is a `*.uxfactory.json` file. Minimal design screen:

```jsonc
// hello.uxfactory.json
{
  "editor": "figma",
  "page": "Vibe",
  "frames": [
    {
      "name": "login",
      "x": 0,
      "y": 0,
      "width": 360,
      "height": 640,
      "children": [
        {
          "type": "shape",
          "name": "card",
          "x": 24,
          "y": 80,
          "width": 312,
          "height": 360,
          "fill": "#ffffff",
          "cornerRadius": 12,
        },
        {
          "type": "text",
          "name": "title",
          "x": 48,
          "y": 112,
          "width": 264,
          "height": 32,
          "characters": "Sign in",
        },
        {
          "type": "shape",
          "name": "cta",
          "x": 48,
          "y": 380,
          "width": 264,
          "height": 44,
          "fill": "#1e88e5",
          "characters": "Continue",
        },
      ],
    },
  ],
  "connectors": [],
}
```

Sanity-check it before rendering:

```bash
uxfactory lint hello.uxfactory.json     # exit 0 = valid spec
```

---

## 2. The live loop (renders into Figma)

**Terminal — start the bridge** (a localhost relay on `127.0.0.1:3779`):

```bash
uxfactory bridge        # keep this running
```

> Start it from a **project root** — a folder with `.git` or `uxfactory.batch.json`. Requests that don't name a repo (including legacy worker polls) resolve to the bridge's launch directory and are re-validated against it, so a bridge launched elsewhere answers those with `410 root-gone`.

**Figma desktop — install & open the plugin** (once):

```bash
pnpm --filter @uxfactory/plugin build   # writes the plugin bundle + manifest.json
```

In Figma: **Plugins → Development → Import plugin from manifest…** → pick `packages/uxfactory-plugin/manifest.json`, then run **UX Factory** (it connects to the bridge at `localhost:3779`).

**Render it:**

```bash
uxfactory publish hello.uxfactory.json --wait     # blocks until the canvas renders
```

Your `login` frame appears on the **Vibe** page. Now **gate** it:

```bash
uxfactory verify hello.uxfactory.json             # PASS → exit 0, FAIL → exit 1
```

**Iterate:** edit the spec (change `"Continue"` → `"Get started"`, move the CTA), then `publish --wait` again. That's the vibe — text in, canvas out, verified.

> One-shot render + gate: `uxfactory publish hello.uxfactory.json --verify`.

### The worker — serves Seed / Generate jobs (one per project)

The panel's **Seed**, **Create**, and design-generation buttons enqueue jobs on the bridge — but the bridge is only a relay. A **worker** process claims and runs them, and it claims **only jobs for the project it was started in** (its working directory). No worker for your project = jobs wait in the queue and the panel shows a "No worker is serving this project" banner (plus an amber dot in the ContextBar).

```bash
cd <your-project-root>          # the repo your panel is connected to
uxfactory worker                # keep this running (assumes the global link from step 0)
```

Or run the whole stack under one supervisor — bridge plus a worker for every project a panel connects:

```bash
uxfactory up                    # bridge on :3779 + auto worker per connected root
```

`up` restarts crashed workers with backoff; a worker that fails setup (exit 2, e.g. missing `~/.agentx/auth.json`) is NOT restarted until you reconnect the project. Flags on both verbs: `--model`, `--kinds`, `--pool`, `--debug` (worker also takes `--root`, `--bridge`).

Start order doesn't matter: a worker started before its project is connected is held pending and counted the moment the panel connects. The ContextBar dot goes **green** when a live worker covers your project, **amber** when none does, **grey** when unknown.

> Without the global link, the raw form still works:
> `<engine>/clients/uxfactory-worker/node_modules/.bin/tsx <engine>/clients/uxfactory-worker/src/main.ts`
> from your project root — or point the verb at a checkout with
> `UXFACTORY_WORKER_ENTRY=<path-to-clients/uxfactory-worker>`. The worker needs agent
> credentials at `~/.agentx/auth.json`.

---

## 3. Vibe with Claude Code (agent-driven)

This is the real flow: you _talk_, the agent writes specs and drives the CLI.

```text
/plugin marketplace add JefeLabs/uxfactory
/plugin install uxfactory@uxfactory
```

You get:

- **The skill** — Claude knows the spec format and the `bridge → publish → verify` loop.
- **Slash commands** — `/uxfactory:bridge`, `/uxfactory:publish <spec>`, `/uxfactory:verify <spec>`, `/uxfactory:scan`, `/uxfactory:status`.
- **Hooks** — _sync-on-edit_ re-renders the moment Claude edits a `*.uxfactory.json`; _drift-notify_ flags stale diagrams at session start.

Allowlist the binary so it runs unprompted — add to your Claude Code settings:

```json
{ "permissions": { "allow": ["Bash(uxfactory:*)"] } }
```

Then just ask: _"Add a password field and an error state to the login screen, render it, and verify."_ Claude edits the spec → the hook renders it → it reports PASS/FAIL → it fixes and re-renders until green.

---

## 4. Offline vibing (no Figma)

**Preview a single spec** to an image — deterministic SVG, browser-faithful PNG when you ask for fidelity:

```bash
uxfactory render hello.uxfactory.json --out preview.svg    # vector, always deterministic
uxfactory render hello.uxfactory.json --out preview.png    # raster (resvg)
```

**Batch mode** — generate/validate one or more screens against your requirements, gated by a **render scope**. The scope is four dials — `visual` · `editorial` (how polished) and `coverage` · `flow` (how complete) — each `low | medium | high`; a gate only fires when the design is mature enough to owe it.

```bash
# uxfactory.batch.json registers your inputs (tokens / stories / flow)
uxfactory batch ./specs --scope wireframe          # greybox: only structure/coverage gates bind
uxfactory batch ./specs --scope visual             # adds token-conformance (needs tokens.ds.json)
uxfactory batch ./specs --visual high --flow low   # off-preset: pixel-perfect hero, no flow yet
```

Exit codes drive the loop: **`0`** the binding gates pass · **`1`** a gate failed (read `report.json`, revise, re-run) · **`2`** setup (e.g. a required artifact is missing — `uxfactory batch … --json` lists exactly what to provide). The **`uxfactory-batch` skill** teaches an agent to run this generate → gate → revise loop on its own and stop when it goes green.

> Outputs land in `.uxfactory/batch/` (previews + `report.json`).

---

## 5. Keep designs honest (drift)

Bind components to their source (`uxfactory.map.json`) and catch when reality and the diagram disagree:

```bash
uxfactory map scaffold      # propose component ↔ spec-node links
uxfactory map check         # exit 1 if an entry dangles
uxfactory drift             # exit 1 if the design drifted from code/spec, 2 if it couldn't check
```

---

## Cheat sheet

| Command                                          | Does                                        |
| ------------------------------------------------ | ------------------------------------------- |
| `uxfactory lint <spec>`                          | Validate a spec                             |
| `uxfactory bridge`                               | Start the localhost relay (`:3779`)         |
| `uxfactory worker`                               | Serve Seed/Generate jobs for the cwd project root |
| `uxfactory up`                                   | Bridge + supervised worker per connected root |
| `uxfactory publish <spec> [--wait] [--verify]`   | Render into Figma (optionally block + gate) |
| `uxfactory verify <spec>`                        | Gate the latest render PASS/FAIL            |
| `uxfactory render <spec> --out <file.png\|.svg>` | Offline preview, no Figma                   |
| `uxfactory batch <dir> --scope <preset>`         | Scope-gated batch of screens                |
| `uxfactory scan`                                 | Rebuild the asset catalog                   |
| `uxfactory drift` / `map check`                  | Detect spec-vs-reality drift                |
| `uxfactory status`                               | Bridge health + plugin connection           |

**Exit codes everywhere:** `0` ok · `1` a real signal (gate FAIL / drift / dangling) · `2` transport/setup (bridge down, missing input).

**Config:** bridge URL via `--bridge <url>` or `UXFACTORY_PORT`; data dir via `--data-dir` (default `./.uxfactory`); `--json` on any command for machine-readable output.

---

## Not built yet

- `uxfactory review <design>` (§14 conformance review — _does this design satisfy its stories?_) reuses the same render scope and is the next phase.
- The hosted/team tier (shared state, accounts) — the local bridge stays the free, solo path.

Happy vibing. ✨

---
name: uxfactory
description: "Render and update structured Figma/FigJam diagrams from JSON specs — architecture diagrams, deployment topologies, retro boards, release flow charts — treating the spec as the source of truth and the canvas as a deterministic, verifiable output. Use this skill WHENEVER the user wants to create, update, or sync a diagram in Figma or FigJam from code or structured data, asks to 'put this architecture in Figma', wants a diagram regenerated after an infra/deployment change, wants to programmatically edit nodes on a Figma canvas, or wants to verify that a Figma canvas matches a spec. Use it even when the user doesn't say 'UXFactory' by name but describes design-as-code, spec-driven diagrams, or gating a render PASS/FAIL. Do NOT use it for freeform UI/screen design from a prose description — that is out of scope."
compatibility: "Requires the uxfactory-cli (Node 20+), a running uxfactory-bridge on localhost:3779, and the uxfactory-plugin open in the target Figma/FigJam file."
---

# UXFactory

UXFactory turns a **JSON spec into a Figma canvas**, deterministically and reversibly, and lets you **verify** that the canvas matches the spec. The spec is the source of truth; the canvas is an output. Your job when using this skill is to author or edit a spec, publish it, and — when correctness matters — gate the result PASS/FAIL.

Use UXFactory for artifacts with a small, declarative alphabet: **architecture diagrams, deployment topologies, retro boards, release flow charts** — frames, sections, shapes, stickies, connectors, and named asset instances (AWS/k8s/GCP icons). Do **not** use it to design freeform UI screens from a sentence.

## How the pieces fit

```
you / agent ──HTTP──▶ uxfactory-bridge (localhost:3779) ◀──poll── uxfactory-plugin (in Figma)
                            │                                          │ figma.* API
                            └─ holds queue + last render + selection ──▶ Figma canvas
```

The Figma plugin can only reach `localhost` and has no filesystem access, so the **bridge is mandatory** and the **plugin polls** it. You never talk to the plugin directly — you talk to the bridge.

## Before you render: confirm the loop is live

1. **Bridge running?** `uxfactory bridge` (starts it on `localhost:3779`). Check `GET /health` returns `{ ok: true }`.
2. **Plugin connected?** The user must have the UXFactory plugin open in the target file; its panel shows the small CONNECTED_MIN state when it's talking to the bridge. If publishing times out (`exit 2`), the plugin almost certainly isn't open — tell the user, don't retry blindly.

## The spec format

A spec is one of three shapes. The authoritative contract is the JSON Schema (`uxfactory-spec/schema/uxfactory.schema.json`); run `uxfactory lint <spec.json>` to validate before publishing.

**Design spec** — frames containing shapes / instances, plus connectors:

```jsonc
{
  "editor": "figma",
  "page": "Architecture",                 // target page; created if absent
  "frames": [
    {
      "name": "prod-vpc",
      "x": 0, "y": 0, "width": 1200, "height": 800,
      "children": [
        { "type": "shape", "name": "api-gateway", "x": 80, "y": 80,
          "width": 160, "height": 64, "fill": "#1E88E5", "characters": "API Gateway" },
        { "type": "instance", "name": "lambda-ingest", "asset": "aws:lambda", "x": 320, "y": 80 }
      ]
    }
  ],
  "connectors": [ { "from": "api-gateway", "to": "lambda-ingest" } ]
}
```

**FigJam spec** — set `"editor": "figjam"` and use `sections[]`, stickies, and `connectors[]` instead of frames.

**Edit-only spec** — no frames/sections, just surgical mutations (this is also the `POST /edits` body):

```jsonc
{
  "edits": [
    { "id": "12:34", "set": { "x": 120, "fill": "#43A047" } },
    { "name": "redis-cache", "set": { "characters": "Redis 7.2" } }
  ]
}
```

`asset` names (`aws:lambda`, `k8s:pod`, `gcp:pubsub`, …) resolve through the catalog produced by `uxfactory scan`. If an asset name doesn't resolve, run `uxfactory scan` to (re)build `.uxfactory/catalog.json`.

## Surgical edits — change without redrawing

Prefer editing existing nodes over re-rendering whole frames. Each entry in `edits[]`:

- **Target by `id`** (preferred — stable across renames) or first-match `name`.
- **`set` only the properties you mean to change** — everything else is left alone.
- **No-ops safely** on a missing target (it's skipped, not an error), and one malformed edit does **not** kill the rest of the batch.

Supported properties in v1: `name`, `x`, `y`, `width`, `height`, `rotation`, `opacity`, `visible`, `cornerRadius`, `fill`, `stroke`, `strokeWidth`, `characters`.

To get the `id` of a node the user is pointing at, read the selection (below) and target by that `id`.

## Reading what the user is pointing at

`uxfactory selection` returns the current Figma selection via `GET /selection`: the page/file, and for each selected node its `id`, `name`, `type`, geometry, `opacity`, `rotation`, `visibility`, `cornerRadius`, and `characters`. Use this to scope edits ("make the selected box green") to concrete `id`s.

## Publishing

```bash
uxfactory publish deployment.spec.json          # render-only (fast inner loop)
uxfactory publish deployment.spec.json --wait    # block until the render report lands
```

`publish` validates the spec, enqueues it, and the plugin renders it (typically in ~2s). Rendering is **deterministic**: the same spec on the same file produces an identical canvas every time, so re-publishing is safe and idempotent.

## Verifying — gate the canvas PASS/FAIL (optional, but do it when correctness matters)

Verification is **separate from and optional to** rendering. The fast loop is just `publish`. Reach for verification when you need a guarantee the canvas matches the spec — in CI, before merge, or as a self-check after an agent-authored change. It runs over the bridge's REST API (`POST /verify`), so it's the same gate whether you call it from the CLI or hit the endpoint directly.

```bash
uxfactory verify deployment.spec.json                 # gate the latest render against the spec
uxfactory publish deployment.spec.json --verify        # publish, then gate in one step
```

The gate checks: editor type, node counts (frames/sections/objects/connectors), presence of every spec'd node, geometry within tolerance (`--tolerance <px>`, default 0.5), and that each edit's `set` properties are reflected. Output is a PASS/FAIL table; with `--json` you get the structured result.

**Exit codes — distinguish "wrong" from "broken":**

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | PASS | Done. |
| `1` | FAIL — the canvas doesn't match the spec | Read the `failures[]`, fix the spec, re-publish. |
| `2` | Transport/setup error (bridge down, plugin not open, timeout) | Fix the environment; do **not** treat as drift. |

### The verification loop (your default when asked to "make sure it's right")

```
author/edit spec → uxfactory publish --verify
   ├─ exit 0 → done
   ├─ exit 1 → inspect failures (e.g. {check:"geometry", name:"api-gateway", property:"x",
   │            expected:120, actual:180}); correct the spec to match intent; re-publish
   └─ exit 2 → environment problem (bridge/plugin); surface to the user, don't loop
```

When a FAIL reports a node `missing`, the spec named a node the render didn't produce — usually a typo in `name`/`asset` or a frame that didn't render; fix and re-publish. When it reports a geometry mismatch, decide whether the **spec** is the intended truth (adjust the canvas by re-publishing) or the **canvas** is (update the spec) — the spec is the source of truth, so default to making the spec correct and re-rendering.

## Undo

Forward edits are reversible: the plugin captures the BEFORE values (by `id`) and the panel shows `Undo (n)` with `⌘/Ctrl+Z` while focused. The stack holds up to 50 edits. Don't engineer your own "undo" by sending inverse edits — use the panel, or just re-publish the correct spec.

## Gotchas worth internalizing

- **Localhost only.** Nothing leaves the machine; there is no cloud. If a user expects a shareable hosted render, that's not v1.
- **Determinism is a feature.** Re-publishing the same spec is safe — lean on it instead of hand-editing in Figma.
- **One bad edit ≠ failed batch.** Malformed edits are skipped and surface as gate `failures`, not crashes.
- **Target edits by `id`, not `name`, when you can** — a forward edit may rename the node out from under a name match.
- **`exit 2` means the tooling didn't run** (usually the plugin isn't open). It is never a drift signal — don't "fix the spec" in response to it.

## Quick reference

| Command | Does |
|---------|------|
| `uxfactory bridge` | Start the localhost relay (`--port` / `UXFACTORY_PORT` to override). |
| `uxfactory lint <spec>` | Validate a spec against the schema; renders nothing. |
| `uxfactory publish <spec> [--wait] [--verify] [--dry-run]` | Enqueue a spec for rendering; optionally wait and/or gate. |
| `uxfactory verify <spec> [--tolerance <px>] [--render <id>] [--json]` | Gate the latest (or a specific) render against the spec via `POST /verify`. |
| `uxfactory selection` | Read the current Figma selection (`GET /selection`). |
| `uxfactory scan` | Rebuild the asset catalog (friendly name → component key). |

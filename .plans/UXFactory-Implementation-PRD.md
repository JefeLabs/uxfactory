# UXFactory — Implementation PRD

> **Status:** Implementation spec (greenfield build) &nbsp;|&nbsp; **Owner:** jefelabs &nbsp;|&nbsp; **Org:** `github.com/uxfactory` &nbsp;|&nbsp; **Site:** `uxfactory.dev` (docs) · `uxfactory.io` (app/API)
> **Last updated:** 2026-06-27
> **Positioning:** **open-core.** The engine (CLI, plugin, generation) is open-source (MIT) and free for solo use — unlimited with your own compute (model API or RunPod); a proprietary hosted backend powers managed-premium generation and the paid **team** tier. Solo is free; teams are the commercial product. (§16)
> **Audience:** engineers implementing UXFactory, agent authors integrating against it, reviewers gating the build.

UXFactory is the **"design-as-code" rendering tier for Figma**: a JSON spec is the source of truth, and the Figma canvas is a deterministic, reversible, _verifiable_ output of that spec. It is built as six shippable components over a shared spec and gate library, and adds a first-class, **optional verification path exposed over REST** so any CLI, agent, or CI runner can gate a render PASS/FAIL without bespoke glue. This PRD specifies UXFactory's structured, deterministic core — spec→Figma rendering and verification — which is the foundation its higher-fidelity design generation builds on. That generation tier (the part that competes on design quality) emits the same verifiable, gateable specs rather than opaque output; its subsystem is not yet detailed in this document. Everything here stays at the level of structured specs and deterministic gates. UXFactory is **open-core**, built and maintained by jefelabs under the **@uxfactory** org: the engine is open-source and free for individuals (unlimited with your own compute), and a proprietary hosted backend funds the project through paid team and premium tiers (§16).

This document is the build contract.

---

## 1. Context & problem

Design artifacts (architecture diagrams, deployment topologies, retro boards, release flow charts) live in Figma. Engineering artifacts (code, infrastructure, schemas, APIs) live in version-controlled files and CI. The two stay in sync only by manual effort — which in practice means they don't. When a service's port changes, a component is deployed, or a system is re-architected, the diagram that documented it is silently wrong, and nobody fixes it because the diagram is in someone else's hands, the cost of opening Figma and finding the node is high, and **there is no programmatic path between the engineering source of truth and the design artifact.**

UXFactory closes that gap for the class of artifacts that are _structured enough to describe declaratively_ — a small alphabet of node types (sections, shapes, stickies, connectors), constrained layouts, and reusable building blocks (cloud-provider icons, k8s primitives). For these, "describe in JSON, render to canvas, then prove the canvas matches" is tractable. Beyond that structured core, UXFactory **also generates high-fidelity UI and full designs** — the harder "beautiful UI from intent" problem — but it refuses the usual black-box bargain: generation still produces a structured, verifiable spec, so even high-fidelity output can be gated, diffed, and built from. The wager is that _verifiable_ high-fidelity design beats opaque prompt-to-pixels generation; that is UXFactory's wedge.

**Why this is buildable now (2026):** LLM-driven engineering workflows routinely emit structured output, so JSON-spec-driven rendering is a natural target; Figma's Plugin API is mature for both `figma` and `figjam` editor types (stable component import, instance overrides, connector APIs); and local agent loops (Cursor, Copilot, Continue) have normalized the "agent writes a file → tooling reacts" pattern. UXFactory's bridge _is_ that pattern, scoped to Figma.

---

## 2. Goals & non-goals

### Primary goals (must-have for v1)

| ID      | Goal                                                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1**  | **Deterministic rendering.** Given a spec, the resulting Figma canvas is identical every time on the same file.                                                                                                                                                       |
| **G2**  | **Programmatic write access** to Figma for code/agents running outside Figma, with no manual handoff.                                                                                                                                                                 |
| **G3**  | **Reversibility.** Every UXFactory-applied mutation can be cleanly rolled back without affecting work the user did in between.                                                                                                                                        |
| **G4**  | **Verifiability.** A spec + a rendered canvas can be programmatically compared and gated PASS/FAIL.                                                                                                                                                                   |
| **G8**  | **Verification over REST.** The gate is callable as an HTTP endpoint and as an optional CLI step, so any client can verify without owning the comparator logic.                                                                                                       |
| **G10** | **Verifiable high-fidelity generation.** Generate quality UI and full designs (not just render hand-written specs) that stay structured, gateable, diffable, and buildable — the wedge over prompt-to-pixels tools. _(Subsystem specified separately — forthcoming.)_ |

### Secondary goals (should-have for v1)

- **G5 — Bidirectional context.** External code can read what the user is pointing at (selection) and act on it.
- **G6 — Multi-editor support.** Both Figma design files and FigJam boards, editor-aware specs, one plugin binary.
- **G7 — Asset library integration.** Reference published components (AWS, Kubernetes, GCP) by friendly name, not opaque component key.
- **G9 — Agent-driveable by default.** A `SKILL.md` ships as a first-class component so an LLM agent can author specs and run the publish→verify loop unaided.

### Non-goals (explicitly out of scope for v1)

- **NG1** — **Freeform, black-box UI generation.** UXFactory _does_ generate high-fidelity UI and diagrams — but always through structured specs and deterministic gates, so output is verifiable, diffable, and buildable rather than opaque pixels. What's out of scope is generation that _can't_ be gated, compiled, or rolled back: that verifiability is the differentiator from prompt-to-pixels tools, not a limitation.
- **NG2** — **Forcing everyone onto hosted SaaS.** Single-player stays fully local and private — local bridge, your files, your compute (BYO model API or RunPod), no account required. The hosted multi-tenant backend exists only for the **team** tier and the optional managed-premium generation; it is never a requirement for solo use. Local-only is a guarantee for the free tier, not a limit on the product (§16).
- **NG3** — Cross-file rendering. Figma's API doesn't allow it; UXFactory doesn't pretend to.
- **NG4** — **The _renderer_ doesn't editorialize.** The deterministic render path outputs exactly what the spec describes — no inferred polish, no second-guessing — because that faithfulness is what makes verification meaningful. Design _quality_ is produced upstream by the generation tier that authors the spec, not invented by the renderer; the two stay deliberately separate.
- **NG5** — Replacing the designer. UXFactory generates and verifies design _artifacts_ with human review and approval as the backstop (§13.5); the designer stays in the loop — they're just not hand-placing nodes.

---

## 3. Component architecture

UXFactory is six delivered components over two shared libraries. The boundary lines follow Figma's security model: the plugin iframe can only `fetch` localhost and has no filesystem access, so a localhost relay (the bridge) is mandatory, and the plugin must **poll** (inverted pull) — it cannot be pushed to.

```
                                    uxfactory-spec  (shared TS types + JSON Schema + validators)
                                            │ imported by all of:
   ┌──────────────┐   HTTP    ┌───────────────────────┐   HTTP    ┌──────────────────────┐
   │ uxfactory-cli │ ───────▶  │   uxfactory-bridge     │ ◀──────── │   uxfactory-plugin    │
   │  (or agent,  │  publish  │   localhost:3779      │   poll    │     (in Figma)       │
   │   or CI)     │  verify   │   queue + state       │  /next    │  renders spec via    │
   └──────────────┘ ◀───────  └───────────────────────┘ ────────▶ │  figma.* API         │
          ▲          report          ▲       │                    └──────────┬───────────┘
          │                          │       │ POST /rendered                │ figma.* API
          │  POST /verify   ┌────────┴─────┐ │ POST /selection               ▼
          └───────────────▶ │ uxfactory-gate│ │                         ┌───────────┐
            PASS / FAIL     │ (comparator) │ └──────────────────────▶  │  Figma    │
                            └──────────────┘     render report stored   │  canvas   │
                                                                        └───────────┘
```

| #   | Component              | Runtime                    | Responsibility                                                                                                                                                                |
| --- | ---------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`SKILL.md`**         | Agent context              | Teaches an LLM agent when to use UXFactory, the spec format, and the publish→verify loop. The agent-facing interface.                                                         |
| 2   | **`uxfactory-cli`**    | Node 20+                   | Human/CI entry point. Starts the bridge, publishes specs, **verifies over REST**, reads selection, scans assets, lints specs.                                                 |
| 3   | **`uxfactory-bridge`** | Node 20+                   | Localhost relay. Holds the spec queue and last-known state; exposes the REST surface including the new `/verify` endpoint.                                                    |
| 4   | **`uxfactory-plugin`** | Figma iframe + main thread | Polls the bridge, renders specs deterministically, applies surgical edits, captures inverses for undo, emits render reports, forwards selection, drives the 3-state panel UX. |
| 5   | **`uxfactory-cc`**     | Claude Code                | The Claude Code plugin (distinct from the Figma `uxfactory-plugin`). Packages the skill, slash commands, and a sync-on-edit hook; drives the CLI over Bash — no MCP.          |
| 6   | **`uxfactory-vscode`** | VS Code                    | VS Code extension; a thin client that spawns the `uxfactory` CLI (like the Claude Code plugin) for developers who want UXFactory in their editor without Claude Code.         |
| —   | **`uxfactory-spec`**   | Shared lib                 | TypeScript-first spec types, the JSON Schema, and validators used by **both** the UI and code sides. No build-time codegen — specs are runtime JSON.                          |
| —   | **`uxfactory-gate`**   | Shared lib                 | Pure comparator: `(spec, renderReport) → GateResult`. No I/O. Imported by the bridge (`POST /verify`) and usable offline by the CLI.                                          |

**Key architectural decisions:**

1. **Bridge in the middle, not direct plugin↔agent.** Required by Figma iframe sandboxing.
2. **Plugin polls; bridge holds state.** The only model the iframe security allows.
3. **Spec types are TypeScript-first.** Validators run on both UI and code sides; the same types feed CLI tooling.
4. **No build-time codegen.** Edits to spec types propagate by recompilation, not regeneration.
5. **The comparator is a pure function in its own package.** This is what makes verification cheap to expose simultaneously over REST (`/verify`), in the CLI, and in tests.
6. **The Claude Code plugin is a Bash client, not an MCP server.** It shells out to the same `uxfactory` CLI a human would — one client type, one backend — and reaches verification through the CLI's exit codes and `--json` rather than a separate tool protocol.
7. **The component map is committed and maintained, not inferred.** Drift detection (§11) joins code to diagram through a version-controlled `uxfactory.map.json`; UXFactory auto-fills only the volatile Figma node IDs, while the code↔node link stays human/agent-maintained because no tool can infer it with certainty.
8. **Offline batch is a separate mode, not a change to the online path.** Batch assembly, gating, and iterate-to-threshold (§13) run entirely offline against committed guidance inputs; the online publish→bridge→plugin→verify loop is untouched, and durable inputs never live in the ephemeral `.uxfactory/` runtime dir.
9. **The core is provider-agnostic; three seams isolate what varies.** (a) _Clients_ — the CLI is the shared executable that the VS Code and Claude Code wrappers spawn; the Figma plugin is a protocol _peer_ (it talks to the bridge/backend over HTTP), not a CLI wrapper, because its sandbox can't spawn processes. (b) _Targets_ — spec, gate, and generation are target-agnostic; the Figma plugin + bridge are one _render adapter_, and a target is anything that can emit a render report, so additional targets (Penpot, SVG) are post-v1 adapters rather than core changes. (c) _Compute_ — generation runs behind a pluggable model/compute backend (model API · BYO-GPU/RunPod · hosted), so orchestration never hardcodes a provider. Each seam is _designed_ now; second implementations are built only when needed (no speculative abstraction).
10. **Open-core boundary: single-player vs. team.** The engine — including generation orchestration — is open/MIT; the hosted `uxfactory.io` backend (managed-premium generation + shared/team state) is proprietary; the paid boundary is solo-vs-team (§16).
11. **Runtime substrate is AWS AgentCore; the gate model and design artifacts live in a companion PRD.** UXFactory owns the design artifacts, the trace graph, the design-specific gate tiers, and the Figma render adapter; **orchestration, the iterate-to-threshold loop, HITL routing, and runtime are the AWS AgentCore harness + runtime** (§13, §16), while tier-2 correctness (integration tests) and the component registry are generic **CI + code-repo** concerns, not UXFactory-owned. The full data model, ownership taxonomy, tiered gate ladder, and fidelity ramp are specified in the companion **UXFactory — Design Artifacts & Models PRD** (whose owned **trace graph** — view-state ↔ Figma node ↔ component — generalizes the §11 component map), which this document references rather than duplicates.

---

## 4. Component 1 — `SKILL.md` (agent interface)

The skill is shipped, not incidental: it is how an agent drives UXFactory without a human translating intent into API calls. It lives at `skill/SKILL.md` and is delivered as a complete, ready-to-install file alongside this PRD.

**It MUST:**

- Carry YAML frontmatter (`name: uxfactory`, a triggering `description`) and stay under ~500 lines.
- State **when to reach for UXFactory** (rendering/updating an architecture diagram, deployment topology, retro board, or release flow from a structured source) and when **not** to (freeform UI design → out of scope).
- Document the **spec format** compactly (design / figjam / edit-only) with at least one worked example of each, and point to the JSON Schema for the authoritative contract.
- Document the **CLI workflow**: confirm the bridge is up, `uxfactory publish`, then the **verification loop** (`uxfactory publish --verify` or `uxfactory verify`, read the failures, fix the spec, re-publish).
- Explain **surgical edits** (`edits[]`: target by `id`, set only listed properties, no-op on missing) and selection-driven context (`uxfactory selection`).
- Call out the gotchas that change agent behavior: rendering is deterministic, everything is localhost-only, a single malformed edit does not kill the batch, and undo is bounded.

The full text is in the companion `SKILL.md` deliverable. Acceptance for this component is in §19.

---

## 5. Component 2 — `uxfactory-cli`

A Node 20+ CLI, published in v1 as a workspace bin (`pnpm uxfactory …`) and as `npx uxfactory` for power users. It is the human and CI entry point, and a **thin client** over the bridge — it owns argument parsing, file I/O, exit codes, and pretty-printing, but defers rendering to the plugin and verification to the bridge.

### 5.1 Commands

| Command                         | Purpose                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uxfactory bridge`              | Start `uxfactory-bridge` on `localhost:3779` (override with `--port` / `UXFACTORY_PORT`). Foregrounds the relay.                                             |
| `uxfactory publish <spec.json>` | Validate the spec, then enqueue it for the plugin to render.                                                                                                 |
| `uxfactory verify <spec.json>`  | Gate the most recent render report against the spec via **`POST /verify`**. PASS/FAIL.                                                                       |
| `uxfactory selection`           | Read the current Figma selection via `GET /selection`.                                                                                                       |
| `uxfactory scan`                | Build the asset catalog: friendly name (e.g. `aws:lambda`) → component key, written to `.uxfactory/catalog.json`.                                            |
| `uxfactory lint <spec.json>`    | Validate a spec against the JSON Schema and print human-readable errors. Renders nothing.                                                                    |
| `uxfactory map`                 | Maintain the component map (`scaffold` / `check`) — the committed join between implemented components and spec nodes. _(§11)_                                |
| `uxfactory drift`               | Detect spec-vs-reality drift via the map: field diffs + orphans, PASS/FAIL exit codes. _(§11)_                                                               |
| `uxfactory render <spec>`       | Render a spec to an image offline (approximate; no Figma). `--out <file>`. _(§12)_                                                                           |
| `uxfactory batch`               | Offline batch mode: assemble, gate, and iterate a set of specs against registered guidance inputs, then stage for approval. _(§13)_                          |
| `uxfactory review <design>`     | Conformance review: check a design against registered stories/journeys (and, secondarily, heuristic UX), returning annotated notes. `--json` for CI. _(§14)_ |
| `uxfactory snapshot`            | _(roadmap)_ Pull current canvas state back into a spec via `GET /snapshot`.                                                                                  |

### 5.2 Flags (shared)

- `--bridge <url>` — bridge base URL (default `http://localhost:3779`).
- `--wait` — block until the matching render report arrives (used by `publish`).
- `--verify` — on `publish`, chain straight into verification after the render report lands (see §10). **This is the optional verification path in its most convenient form.**
- `--tolerance <px>` — geometry epsilon for verification (default `0.5`).
- `--render <id>` — verify against a specific render report instead of the most recent.
- `--dry-run` — validate and print what _would_ be enqueued/edited without mutating the canvas. _(roadmap-adjacent; gated behind plugin dry-run support)_
- `--json` — emit machine-readable output instead of the pretty table.

### 5.3 Exit codes (CI contract)

| Code | Meaning                                                                                    |
| ---- | ------------------------------------------------------------------------------------------ |
| `0`  | Success. For `verify`/`publish --verify`: gate **PASS**.                                   |
| `1`  | Gate **FAIL** (spec did not match the rendered canvas).                                    |
| `2`  | Transport/setup error (bridge unreachable, plugin not connected, timeout, malformed spec). |

This split lets CI distinguish "the diagram is wrong" (`1`, a real drift signal) from "the tooling didn't run" (`2`, an infra problem) — they demand different responses.

---

## 6. Component 3 — `uxfactory-bridge`

A localhost HTTP server that holds the queue and the last-known render/selection/verify state. It persists nothing sensitive: render reports live only as long as the gate needs them and only on the user's local disk. Every endpoint is CORS-open for the Figma iframe origin.

### 6.1 REST surface

| Endpoint                  | Purpose                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /health`             | `{ ok, pending }` for liveness probes.                                                      |
| `GET /next`               | Plugin polls; serves the next queued spec, or `204` if the queue is empty.                  |
| `POST /rendered`          | Plugin posts a render report.                                                               |
| `GET /rendered`           | Gate / agent reads the most recent render report.                                           |
| `POST /selection`         | Plugin posts the current selection.                                                         |
| `GET /selection`          | Agent reads the most recent selection.                                                      |
| `POST /edits`             | Synchronous edit channel: enqueue an edit-only spec **and await the render report inline**. |
| **`POST /verify`**        | **Run the gate against a render report and return a structured PASS/FAIL.** _(see §10)_     |
| **`GET /verify/:id`**     | **Read a stored verification result by id (async / CI polling, audit).**                    |
| `POST /batch`             | Enqueue a pre-validated batch with previews (staged, not auto-applied).                     |
| `GET /batch`              | Plugin reads the pending batch + previews for review.                                       |
| `POST /batch/:id/approve` | Apply approved batch items to the canvas.                                                   |

### 6.2 Queue & persistence

- Specs queued via `uxfactory publish` land as files in `.uxfactory/queue/`. In-flight specs remain there until the plugin picks them up; processed specs are moved to `.uxfactory/queue/processed/` renamed with a timestamp.
- Render reports are written to `.uxfactory/renders/` (user-readable plaintext; the user is responsible for `.gitignore`-ing it). Each report carries a `renderId`.
- The last _N_ verification results are retained (in memory + `.uxfactory/renders/verify/`) so `GET /verify/:id` can serve them. Nothing is uploaded anywhere.
- A bridge restart MUST NOT corrupt the queue.

---

## 7. Component 4 — `uxfactory-plugin`

The in-Figma plugin: a main thread (talks to `figma.*`) and an iframe UI (talks to the bridge over `fetch`). It is the only component that mutates the canvas.

### 7.1 Spec-driven rendering

Accept a spec from any of: the plugin UI textarea (manual), a queued file served by `GET /next` (CLI path via `uxfactory publish`), or a direct `POST /edits` body (agents). A spec is one of:

- a **design spec** (`frames[]` + optional `components` / `instances` / `edits`),
- a **FigJam spec** (`editor: "figjam"` + `sections[]` / `connectors[]` / `edits[]`), or
- an **edit-only spec** (`edits[]`, no frames or sections).

Rendering MUST be deterministic: same spec on the same file → identical canvas state.

### 7.2 Surgical edits

A spec MAY carry `edits[]`: targeted property mutations against existing nodes. Each edit MUST target by stable Figma `id` (preferred) or first-match `name`, apply only the properties present under `set` (leaving others alone), and be a safe **no-op** on missing targets (skipped, not errored). Supported edit properties in v1:

`name`, `x`, `y`, `width`, `height`, `rotation`, `opacity`, `visible`, `cornerRadius`, `fill`, `stroke`, `strokeWidth`, `characters`.

### 7.3 Reversibility (command pattern)

For every successful edit, capture the **inverse** — the BEFORE values of every property the edit will mutate, **targeted by stable `id`** (not name, because a forward edit may rename the node). The UI MUST provide a visible Undo button with a live count (`Undo (3)`), a `⌘/Ctrl + Z` shortcut while the iframe has focus, and an undo stack capped at **50** entries (oldest evicted). Undo runs through the same render pipeline as forward edits, and MUST NOT push its own inverse onto the stack (no "redo via undo" loop). Figma's native `Cmd+Z` remains the cross-session truth.

### 7.4 Verifiability — the render report

After rendering, post a report to `POST /rendered` containing everything the gate needs:

- editor type, target page, file name and key;
- counts of frames / sections / objects / connectors;
- per-section **and** whole-page PNG exports (base64);
- geometry of section children (`id`, `name`, `type`, `x`, `y`, `w`, `h`);
- edit count and a per-edit human-readable diff string.

This report is the single artifact the gate compares against the spec (§10).

### 7.5 Selection reporting

Forward every `selectionchange` event to `POST /selection` with the page name / file name & key, and for each selected node its `id`, `name`, `type`, `x/y/w/h`, `opacity`, `rotation`, `visibility`, `cornerRadius`, `characters`. Exposed to clients via `GET /selection`.

### 7.6 Panel UX states

Three states, with the transitions below:

- **COMPACT** (540×220) — default, disconnected; full action bar + hint.
- **EXPANDED** (540×560) — when a `<details>` panel is open.
- **CONNECTED_MIN** (156×72) — auto-engaged on bridge connect; icon-only Expand / Connected / Undo + status line.

Transitions: `COMPACT ↔ EXPANDED` via the `<details>` toggle; `COMPACT → CONNECTED_MIN` automatically on bridge connect; `CONNECTED_MIN → COMPACT` on Expand click (stays connected) or on disconnect.

### 7.7 Batch review mode

When a pre-validated batch arrives (§13.5), the plugin enters a **review mode** instead of auto-applying: it shows the queued previews shipped with the batch (the §12 approximate rasters) with per-item and whole-batch approve/reject. Only approved specs render to the canvas via the normal pipeline; rejected ones are discarded. This is the one case where the plugin shows work _before_ applying it — everywhere else, polling a spec renders it.

### 7.8 Conformance review mode

The plugin also runs **conformance review** (§14): select a frame or design, run the check, and the plugin annotates the canvas with notes — per-element flags where a design element doesn't satisfy a registered story, and coverage gaps where a story is unmet or a journey dead-ends, each with a severity and a reason. Requirement-conformance flags (the gate) and advisory heuristic-UX flags (judgment) are visually distinguished so the designer can tell a violation from a suggestion. Reviewing a UXFactory-rendered design is exact (its spec exists); reviewing an arbitrary hand-made design is best-effort (structure is inferred from the canvas).

---

## 8. Component 5 — `uxfactory-cc` (Claude Code plugin)

`uxfactory-cc` packages UXFactory as a Claude Code plugin so the agent can drive the system from the terminal it already lives in. It is **MCP-free**: instead of exposing a tool server, it teaches Claude Code to shell out to the `uxfactory` CLI (§5) over Bash — Claude Code's most native mode. It is the _second consumer_ of the CLI alongside a human operator, so there is one client type and one backend, and verification is reached through the CLI's exit codes (§5.3) and `--json` output (§10) rather than a separate protocol.

This is distinct from `uxfactory-plugin`, the Figma plugin of §7: two different "plugins" for two different hosts — one renders **inside Figma**, this one runs **inside Claude Code**.

```
uxfactory-cc/
├── .claude-plugin/
│   ├── plugin.json          # manifest: name, version, description, repo, keywords
│   └── marketplace.json     # catalog entry for distribution (or hosted in a separate repo)
├── skills/
│   └── uxfactory/SKILL.md    # the Component-1 skill, vendored verbatim
├── commands/                # slash commands: thin CLI wrappers
│   ├── publish.md   ├── verify.md   ├── bridge.md   ├── scan.md   └── status.md
├── hooks/
│   └── hooks.json           # sync-on-edit hook
└── README.md
```

### 8.1 What it bundles (and what it deliberately omits)

A Claude Code plugin auto-discovers convention-based directories under its manifest. `uxfactory-cc` ships three of them and intentionally omits `.mcp.json`:

- **`skills/uxfactory/SKILL.md`** — the Component-1 skill (§4), unchanged. It is already CLI-first (every instruction is "run `uxfactory …`"), so it needs no edits for the Bash model. It is _vendored_ here — physically copied, not referenced — because Claude Code copies a plugin's directory to a cache on install and cannot resolve paths outside that directory (`../`). The canonical source stays in `skill/`; a build step copies it in.
- **`commands/`** — slash commands (§8.2), thin wrappers for when a human wants to drive UXFactory explicitly.
- **`hooks/hooks.json`** — two hooks (§8.3): sync-on-edit (auto re-render on spec edits) and drift-notify (surfaces spec-vs-reality drift at session start; see §11).
- **No `.mcp.json`.** The MCP adapter is out of scope by decision; the CLI _is_ the tool surface. This removes a moving part — a stdio server to build, version, and run — at the cost of managing Bash permissions instead (§8.4).

### 8.2 Slash commands

Each command is a markdown file that runs the corresponding CLI invocation against the user's arguments. The commands render nothing themselves — they delegate to the same CLI a human or CI would call.

| Command                     | Runs                                                | For                               |
| --------------------------- | --------------------------------------------------- | --------------------------------- |
| `/uxfactory:bridge`         | `uxfactory bridge`                                  | Start the localhost relay.        |
| `/uxfactory:publish <spec>` | `uxfactory publish <spec> [--wait]`                 | Render a spec.                    |
| `/uxfactory:verify <spec>`  | `uxfactory verify <spec>`                           | Gate the latest render PASS/FAIL. |
| `/uxfactory:scan`           | `uxfactory scan`                                    | Rebuild the asset catalog.        |
| `/uxfactory:status`         | `uxfactory bridge` health + plugin-connection check | Confirm the loop is live.         |

Each command file scopes its Bash permission to the UXFactory binary (`allowed-tools: Bash(uxfactory:*)`) so it runs without a generic shell-approval prompt. The exact command frontmatter (`description`, `argument-hint`, `$ARGUMENTS`) is confirmed against current Claude Code docs at build time, since command syntax is among the faster-moving parts of the plugin format.

### 8.3 Hooks: sync-on-edit and drift-notify

The plugin's one automation realizes the original "a pre-commit hook re-renders the spec" intent — but inside the Claude Code loop, so the canvas stays in sync the moment Claude edits a spec, with no human action.

- **Event:** `PostToolUse`, matching the `Edit` / `Write` tools.
- **Filter:** the edited path matches `*.uxfactory.json` (the spec-file convention).
- **Action:** run `uxfactory publish --verify` on that file. On a gate FAIL (CLI exit `1`), the hook surfaces the structured `failures[]` back into the session so Claude can correct the spec and re-edit; on exit `2` it reports an environment problem (bridge down / plugin not open) rather than a drift signal.

This is the §10.3 publish→verify sequence, triggered automatically by a file edit instead of an explicit command. The exact hook wiring (event name, matcher shape, command-vs-script form in `hooks.json`) is confirmed against current docs at build time.

`uxfactory-cc` ships a second hook, **drift-notify**: a `SessionStart` hook that runs `uxfactory drift` and surfaces any spec-vs-reality drift as session context, so a session opens with stale diagrams already flagged for the user to act on. Like sync-on-edit it runs the CLI over Bash, but it **detects and notifies only — it never auto-edits**. The mapping it relies on and its full behavior are specified in §11.

### 8.4 Bash permissions — the trade for dropping MCP

An MCP server would have arrived with its own tool-permission model; a Bash-driven plugin instead inherits Claude Code's shell-approval flow, which can prompt before running a command. `uxfactory-cc` handles this in two places: the slash commands declare `allowed-tools: Bash(uxfactory:*)`, and the README instructs users to allowlist `uxfactory` in their Claude Code settings so the skill-driven calls and both hooks (sync-on-edit and drift-notify) run unprompted. This is the deliberate cost of the simpler build — permissions managed at the Bash layer rather than acquired for free from MCP.

### 8.5 Distribution

`uxfactory-cc` ships through Claude Code's plugin system: a `marketplace.json` lists it, users run `/plugin marketplace add <repo>` then `/plugin install uxfactory@<marketplace>`, and Claude Code copies the plugin into its cache. This marketplace is UXFactory's **primary distribution and marketing surface** — where developers discover and install it — complemented by npm for the CLI and the GitHub repo as the other developer-first channels. Two constraints shape the build:

- **No outside-directory references.** Because the install copies only the plugin directory, `uxfactory-cc` must not reach into the monorepo for the CLI — it depends on the **published** CLI (`npx uxfactory`) rather than a relative path, and vendors the skill rather than symlinking it.
- **The relay still runs locally.** The plugin drives the CLI, which talks to a `uxfactory-bridge` the user starts (`/uxfactory:bridge`) with the Figma `uxfactory-plugin` open. The Claude Code plugin does not replace that loop — it orchestrates it.

---

## 9. The spec format

The authoritative contract is `packages/uxfactory-spec/schema/uxfactory.schema.json`; the TypeScript types in the same package are the source it is generated from. The shapes below are the v1 surface.

**Design spec (skeleton):**

```jsonc
{
  "editor": "figma",
  "page": "Architecture", // target page; created if absent
  "frames": [
    {
      "name": "prod-vpc",
      "x": 0,
      "y": 0,
      "width": 1200,
      "height": 800,
      "children": [
        {
          "type": "shape",
          "name": "api-gateway",
          "x": 80,
          "y": 80,
          "width": 160,
          "height": 64,
          "fill": "#1E88E5",
          "characters": "API Gateway",
        },
        { "type": "instance", "name": "lambda-ingest", "asset": "aws:lambda", "x": 320, "y": 80 },
      ],
    },
  ],
  "connectors": [{ "from": "api-gateway", "to": "lambda-ingest" }],
}
```

**FigJam spec** swaps `editor: "figjam"` and uses `sections[]` / stickies / `connectors[]`.
**Edit-only spec** is just `{ "edits": [ … ] }` — the `POST /edits` payload:

```jsonc
{
  "edits": [
    { "id": "12:34", "set": { "x": 120, "fill": "#43A047" } },
    { "name": "redis-cache", "set": { "characters": "Redis 7.2" } },
  ],
}
```

`asset` values (`aws:lambda`, `k8s:pod`, `gcp:pubsub`, …) resolve through `.uxfactory/catalog.json`, produced by `uxfactory scan`. _(G7.)_

---

## 10. Optional verification over REST _(the headline addition)_

Verification is **decoupled from rendering and opt-in.** Publishing never blocks on it — the fast inner-loop is "edit spec, `uxfactory publish`, look at Figma." Verification is the separate gate you wire in when you want a hard guarantee that the canvas matches the spec: a CI step before merge, a post-render assertion in an agent loop, or a manual `uxfactory verify` after a change. Making it optional keeps the dev loop fast while still offering a CI-grade contract.

The comparator (`uxfactory-gate`) is a pure function. It is exposed three ways from one implementation:

1. **`POST /verify` on the bridge** — the canonical path; any HTTP client can call it.
2. **`uxfactory verify` / `uxfactory publish --verify`** — the CLI, which is a thin client over `POST /verify`.
3. **Offline in tests** — importing `uxfactory-gate` directly against a saved report.

### 10.1 `POST /verify`

**Request:**

```jsonc
{
  "spec": {/* the UXFactory spec to assert against */},
  "renderId": "r_2026-06-27T18-04-11Z", // optional; defaults to the most recent report
  "tolerance": { "geometryPx": 0.5 }, // optional; default 0.5
  "checks": ["editorType", "counts", "presence", "geometry", "edits"], // optional subset
}
```

**Response — HTTP `200` in all gate outcomes (status is in the body, not the HTTP code):**

```jsonc
// PASS
{
  "status": "PASS",
  "renderId": "r_2026-06-27T18-04-11Z",
  "verifyId": "v_2026-06-27T18-04-13Z",
  "editor": "figma",
  "pageKey": "0:1",
  "fileName": "Infra Diagrams",
  "summary": { "checks": 5, "passed": 5, "failed": 0 },
  "checks": [
    { "id": "editorType", "status": "PASS" },
    {
      "id": "counts",
      "status": "PASS",
      "expected": { "frames": 1, "connectors": 1 },
      "actual": { "frames": 1, "connectors": 1 },
    },
    { "id": "presence", "status": "PASS" },
    { "id": "geometry", "status": "PASS", "tolerancePx": 0.5 },
    { "id": "edits", "status": "PASS" },
  ],
  "failures": [],
}
```

```jsonc
// FAIL
{
  "status": "FAIL",
  "renderId": "r_2026-06-27T18-04-11Z",
  "verifyId": "v_2026-06-27T18-09-02Z",
  "summary": { "checks": 5, "passed": 3, "failed": 2 },
  "failures": [
    {
      "check": "geometry",
      "nodeId": "12:34",
      "name": "api-gateway",
      "property": "x",
      "expected": 120,
      "actual": 180,
      "tolerancePx": 0.5,
    },
    { "check": "presence", "name": "redis-cache", "expected": "present", "actual": "missing" },
  ],
}
```

HTTP status is reserved for transport problems: `409` if no render report exists yet for the page, `404` for an unknown `renderId`, `503` if the plugin has never connected.

### 10.2 The gate's checks

| Check        | Asserts                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `editorType` | Report's editor matches the spec's `editor`.                                                      |
| `counts`     | Frames / sections / objects / connectors counts match.                                            |
| `presence`   | Every node named/identified in the spec appears in the report (by `id`, else first-match `name`). |
| `geometry`   | Each present node's `x/y/w/h` is within `tolerancePx` of the spec.                                |
| `edits`      | For an edit-bearing spec, every edit's target shows the `set` properties reflected in the report. |

### 10.3 `uxfactory publish --verify` sequence

```
uxfactory publish deployment.spec.json --verify
   │
   ├─▶ lint spec (uxfactory-spec) ............ fail → exit 2
   ├─▶ write spec to .uxfactory/queue/
   ├─▶ (plugin) GET /next picks it up, renders via figma.* API
   ├─▶ (plugin) POST /rendered  → report r_… stored, renderId returned
   ├─▶ CLI POST /verify { spec, renderId } .. transport error → exit 2
   ├─◀ bridge runs uxfactory-gate(spec, report) → GateResult
   └─▶ print gate table;  PASS → exit 0   |   FAIL → exit 1
```

CI usage is then exactly:

```bash
uxfactory bridge &                                   # relay up (operator opens the plugin once)
uxfactory publish deployment.spec.json --verify      # exit 0 PASS / 1 FAIL / 2 broke
```

`--verify` is what makes the capability _optional but one keystroke away_: drop it, and `publish` is the fast render-only path; add it, and you get the gate.

---

## 11. Drift detection

§10 verifies one thing: the Figma canvas matches its spec. Drift detection asks the harder question the whole tool exists to answer — does the spec still match the **code and infrastructure it documents?** There are two kinds of drift, handled with different machinery:

- **Canvas drift** (Figma ≠ spec) — already covered by `uxfactory verify` (§10). It only occurs when someone hand-edits the canvas, since the canvas is an output of the spec.
- **Spec drift** (spec ≠ implemented reality) — the spec is stale relative to the source of truth: a port changed, a service was added, a component was renamed or deleted. This is the failure mode from §1, and detecting it requires a _join_ between the spec and the implementation. That join is a maintained mapping file.

### 11.1 The component map (`uxfactory.map.json`)

Detecting spec drift means knowing which implemented component each diagram node represents. UXFactory records that in a committed, version-controlled `uxfactory.map.json` — the join table between code, spec, and canvas.

The map links three things — **implemented component ↔ spec node ↔ Figma node** — but only one of those links is new work. The spec↔canvas link already exists in the render report (which carries Figma node IDs), so UXFactory **auto-fills the volatile Figma identifiers**; the only thing a human or agent maintains is the **code↔node** link.

```jsonc
// uxfactory.map.json — committed at repo root (NOT the ephemeral .uxfactory/ runtime dir)
{
  "version": 1,
  "components": [
    {
      "component": "api-gateway", // logical id — the stable join key
      "spec": "deployment.uxfactory.json", // which spec renders it…
      "node": "api-gateway", // …and which node within that spec
      "source": {
        // ← the maintained part
        "kind": "terraform",
        "ref": "infra/main.tf#aws_apigatewayv2_api.main",
        "compare": { "label": "name", "port": "target_port" },
      },
      "figmaId": "12:34", // ← auto-filled from the render report
      "lastSynced": { "render": "r_2026-…", "commit": "abc123" },
    },
  ],
}
```

You maintain `component` / `spec` / `node` / `source`; UXFactory writes `figmaId` and `lastSynced` on every render.

**This is a different artifact from the asset catalog (§9, G7), despite both being "mapping files."** The catalog (`.uxfactory/catalog.json`, from `uxfactory scan`) maps a friendly asset name → Figma component _key_ — a rendering concern ("which published icon to instantiate"), regenerable and ephemeral. The component map maps implemented component → spec node + source binding — a drift concern ("what code this node represents"), committed and maintained. Same word, opposite ends of the pipeline.

### 11.2 `uxfactory map` and `uxfactory drift`

| Command                  | Purpose                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uxfactory map scaffold` | Scan known source kinds (Terraform, k8s, compose) and the spec; propose `component`↔`node` links by name match for the user to confirm. Lowers the cold-start cost.                                                                                    |
| `uxfactory map check`    | Validate that every map entry still resolves on **both** sides (source ref _and_ spec node); flag dangling entries. Wire into CI so map rot fails the build.                                                                                           |
| `uxfactory drift`        | Walk the map: extract `compare` fields from each `source.ref` (expected) and diff against the spec node and latest render (actual); emit a structured report. `--json` for machine output; exit `0` clean, `1` drift found, `2` transport/setup error. |

`uxfactory drift` falls back to a **git-staleness** heuristic when a map entry has no `source.compare` (flagging "the inputs changed but the diagram hasn't re-rendered since"), and produces a **precise field-level diff** when bindings are present.

### 11.3 Orphan detection (the high-value check)

The map's biggest payoff isn't property drift — it's catching the two structural ways design and code silently diverge, **neither of which is detectable without the map**:

- **Deleted-but-diagrammed** — a `source.ref` that no longer resolves: the diagram documents a component that was removed.
- **Implemented-but-undiagrammed** — a discovered source component with no matching map entry: a real thing that was never put on the diagram.

`uxfactory drift` reports both as first-class findings, not just per-property mismatches.

### 11.4 The drift-notify hook

`uxfactory-cc` ships a second hook (§8.3) alongside sync-on-edit: a **`SessionStart` hook** that runs `uxfactory drift --json` and emits the result as session context. Because SessionStart output is surfaced to Claude, every session opens with any drift already in view — _"3 diagrams have likely drifted; api-gateway documents a deleted resource — want me to re-render and verify?"_ — and the user decides. The hook **detects and notifies; it never auto-edits.** This is the mirror image of sync-on-edit: that hook fires when Claude edits a _spec_ and pushes it to the canvas (spec changed → update canvas); the drift hook fires when the _sources_ changed and notifies that the _spec needs to catch up_ (reality changed → update spec). Together they close both directions of the design-stays-in-sync-with-code loop.

A Claude Code hook is event-driven, not a background daemon, so it surfaces drift at session boundaries — not continuously. For always-on detection (e.g. infra changed overnight), run `uxfactory map check` / `uxfactory drift` in CI or a git pre-push hook; the `SessionStart` hook is the in-session twin of that gate.

### 11.5 Maintaining the map

The map is a new layer that must stay in sync, and the code↔node link is irreducibly a human/agent judgment — no tool can be certain that "this box means that service." Three mechanisms carry the maintenance cost so the map doesn't silently rot:

- **`uxfactory map scaffold`** proposes links by name match, so the map starts as a draft to confirm rather than a blank file.
- **`uxfactory map check`** in CI fails the build on a dangling entry — the same way diagram drift does — so map rot is caught, not discovered months later.
- **Agent-assisted upkeep** — Claude Code reads the repo and specs and proposes map edits when a component is added or renamed. This is itself a showcase of the thesis: the agent maintaining the very mapping that keeps design and code honest.

---

## 12. Headless preview rendering

CI and agent-loop environments have no Figma session, so the canonical render path (§7) — the plugin drawing into a real canvas — can't run there. **Figma has no server-side rendering**, so a spec cannot be rendered _into a Figma file_ headlessly; that's a Figma platform limit, not a UXFactory one. UXFactory provides two ways to get an image without a live editor:

- **Approximate offline raster** (`uxfactory render <spec> --out diagram.png`) — interpret the spec's frames/shapes/connectors/geometry and draw them straight to SVG, then rasterize. No bridge, no plugin, no Figma; runs anywhere Node runs. Because the spec is already declarative geometry, this is the same describe-in-JSON-render-to-canvas problem with a non-Figma backend. It is explicitly an **approximation**: fonts, published-component icons (`aws:lambda` instances), and connector routing will not be pixel-identical to Figma. Sufficient for PR previews, visual diffs, and the batch review loop (§13) — not for pixel-faithful sign-off.
- **Figma-accurate export (REST)** — when the diagram already exists in a file, Figma's REST image export (`GET /v1/images/:key?ids=<node>&format=png|svg`) returns a pixel-accurate image fully headlessly. The render report already carries the page and node keys, so CI knows exactly what to export. Requires a Figma token and a prior render into the file. (Confirm current formats/limits against Figma's docs at build time.)

**Gating does not need pixels.** The gate (§10) compares the spec to the render _report_ (counts, presence, geometry, edits), and `uxfactory-gate` is a pure function, so it runs headlessly. What it needs is a _real_ render report (from a prior plugin render, stored under `.uxfactory/renders/`). Pointing the gate at the offline raster's own output instead checks "is the spec renderable and self-consistent," not "does Figma match the spec" — a different guarantee, and callers should be explicit about which.

---

## 13. Offline batch mode

`uxfactory batch` is an **exclusive offline mode** for assembling and pre-validating a _set_ of specs — a screen-flow / user-journey set — before any of it touches Figma. It is separate from the online path (§5–§7): the online publish→bridge→plugin→verify loop is unchanged; batch is a distinct pipeline an agent drives to generate, evaluate, and iterate a batch, surfacing it for human approval only once it clears a quality threshold. It depends on the headless renderer (§12) for previews and on the gate (§10) for mechanical validity.

**Scope note (NG1 holds):** the artifacts here are _low-fidelity structured screen-flow diagrams_ (boxes, labels, nav connectors, story annotations), and every automated check is **structural or mechanical** — reachability, coverage, token conformance, reuse — never visual-usability judgment. This keeps batch mode inside the declarative-diagram domain; it does **not** make UXFactory a UI-design tool.

### 13.1 The inputs registry (`uxfactory.batch.json`)

The checks batch can run are a function of which **guidance inputs** are registered — _input-conditional capability_: a check exists only if its input does, so the system can't pretend to evaluate state-coverage without the acceptance criteria. Inputs are committed, authored source, registered by path in a committed `uxfactory.batch.json` manifest at repo root (mirroring `uxfactory.map.json`):

```jsonc
{
  "version": 1,
  "inputs": {
    "tokens": "design/tokens.ds.json", // design-system token register
    "prd": "design/product.prd.md", // design PRD
    "journey": "design/journeys/checkout.md", // user-journey doc
    "reuse": ["specs/**/*.uxfactory.json"], // existing specs to compose against
  },
  "threshold": { "mustPass": "all" },
  "maxIterations": 6,
}
```

The input set is **extensible**: each input _type_ declares the checks it unlocks, so a new input (e.g. an accessibility-guidelines doc later) registers more checks without reworking the command. (These inputs are the batch view of the broader **inputs/knowledge store** — §15 — that conformance review and drift also read from.)

### 13.2 Input-conditional checks

| Input registered                  | Checks unlocked                                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| design-tokens register            | **token conformance** — colors/spacing/type reference named tokens, not ad-hoc values                                                                                                                             |
| design PRD / stories              | **requirement & state coverage** — every story's acceptance criteria map to a screen/state; flag screens with no story basis (ACs are the hinge — companion PRD)                                                  |
| user-flow doc (declared sequence) | **optional soft flow-sequence** _(advisory)_ — if a flow declares an expected step order, verify a reachable path through it; journeys/experience maps are upstream input, not a hard gate source (companion PRD) |
| existing figma spec files         | **reuse** — a screen/component that already exists is referenced, not regenerated                                                                                                                                 |

A check whose input is absent is **skipped and declared so** in the batch report ("token-conformance: skipped, no register"), never silently passed and never failed — keeping "no acceptance criteria" honestly distinct from "coverage checks passed."

### 13.3 The iterate-to-threshold loop

The agent's judgment is the **fitness signal** that drives revision until a threshold, then stops and asks the human. Integrity lives in keeping two stop-conditions separate: the **deterministic gate** (binary, reproducible) and the **judgment threshold** (LLM, non-deterministic, self-graded — the same model that wrote the wireframes is scoring them). To keep the threshold from drifting toward "good enough":

- It is a **rubric of checkable criteria with reasons**, not one holistic score — a failure is actionable ("story-4 has no error state") so the next iteration knows what to fix, and the threshold ("all must-pass criteria green") sits close to the gate's binary character rather than a fuzzy percentage.
- Everything mechanically checkable (orphan screens, unreachable nodes, unmapped stories) lives in the **gate**, deterministic; the LLM is reserved for the subjective residue (is the flow _sensible_, is labeling clear). The more the threshold rests on mechanical criteria, the less it can drift.

The loop runs: generate → gate (mechanical) → score against rubric (LLM, residue) → revise failed criteria → repeat. Guardrails independent of the score: a hard **max-iteration cap** (then surface best-effort with unmet criteria shown, not spin), **no-regression** (track per-criterion — a revision that fixes one story but breaks another's green criteria is not progress), and the **human-approval step as the real backstop** (it never becomes rubber-stamping just because a score cleared). The threshold decides when to stop iterating and ask the human; it does not replace the human.

**Reconciliation to the tiered gate model (companion PRD).** The "deterministic gate vs. judgment threshold" split above is the binary form of a finer model in the companion **Design Artifacts & Models PRD**: a **tiered ladder** (coverage → correctness → conformance → integrity → a11y → craft → brand → content → discoverability) where each check carries a **hardness** (`hard` blocks · `soft` advises · `escalate` routes to HITL) and a **`min_fidelity`** threshold, so a check binds only when the render is mature enough to owe it (a wireframe doesn't owe "on-brand"). Three consequences for batch: (1) the iterate loop and HITL routing are owned by the **AWS AgentCore harness/runtime** — the UXFactory engine performs one deterministic gate pass per call (the split §13 already drew); (2) promotion runs along the **fidelity ramp** (wireframe → content → visual → interactive → production), each level a superset, advancing only when its hard checks pass and its soft/escalate checks are resolved; (3) the checkable criteria are grounded in **acceptance criteria** — view-states fall out of ACs — while journeys and experience maps are upstream _input_ (they motivate the stories; the gate doesn't dereference them).

### 13.4 Reuse

The existing-spec input lets a batch **compose against prior work** instead of duplicating it: when a screen or component already exists in a registered spec, the batch references it rather than regenerating. This is also what keeps a set of journeys consistent with each other and with already-shipped diagrams.

### 13.5 Staged approval (bulk → review → apply)

Once a batch clears threshold, it is **bulk-queued** to the bridge as _pre-validated_ — but not auto-applied. The bridge queue gains a `pending → approved` state, and the plugin gains a **review mode** (§7.7) showing the queued previews shipped with the batch (the §12 approximate rasters) with per-item and whole-batch approve/reject. The user approves; only then does the real `figma.*` render run on the approved specs. The plugin can't pre-render N specs into Figma just to display them, so the previews are what the user decides on, and the accurate render happens on approval.

New bridge endpoints (§6): `POST /batch` (enqueue a pre-validated batch with previews), `GET /batch` (plugin reads the pending batch + previews), `POST /batch/:id/approve` (apply approved items). The online single-spec path is untouched.

### 13.6 Folders — committed inputs vs ephemeral outputs

The batch _inputs_ are committed authored source; the batch _outputs_ are ephemeral runtime state, and the PRD keeps that line clean. The `uxfactory.batch.json` manifest and the files it points at (a `design/` inputs folder, no dot) are **committed**; previews, iteration scratch, and the batch report go under **`.uxfactory/batch/`** (gitignored, alongside the queue and renders). This deliberately does _not_ reintroduce the old ephemeral working-dir name — there is one runtime convention (`.uxfactory/`), and durable source never lives in it.

---

## 14. Conformance review (interactive quality check)

**Conformance review** answers a different question than verification (§10) does. Verification asks _did the render match its spec?_ — spec↔render. Conformance review asks _does this design satisfy the requirements it's supposed to?_ — design↔intent. A user selects a design (in the plugin) or points the CLI at one and gets back annotated notes: which **acceptance criteria** are unmet (which view-states a story requires but the design lacks), and — secondarily — where the UX is weak. It is the §13 rubric run **interactively and in reverse**: generation goes stories/ACs → design; review goes design → checked-against → the ACs. Same structured inputs (§13.1), same engine, opposite direction.

This is the verification moat made interactive, and it ships on the existing gate + structured-inputs machinery — **no generation tier required.** It is also the sharpest counter to prompt-to-pixels tools: they critique a design's _aesthetics and general usability_ in isolation; UXFactory checks it against _the specific stories and acceptance criteria you defined_, which they structurally cannot do without those inputs.

### 14.1 Two kinds of check (the gate / judgment split)

Review runs two layers, kept distinct because they differ in both reliability and defensibility:

- **Conformance checks — the gate (UXFactory's moat).** Grounded in **acceptance criteria** (the hinge: a story's ACs enumerate the view-states that must exist — companion PRD), these are _traceability and coverage_ checks, mechanical and near-deterministic:
  - **State coverage** — every AC-implied state (empty/loading/error/success/edge) is rendered; flag ACs with no supporting design, and states with no AC basis.
  - **Traceability** — _which_ design element satisfies _which_ acceptance criterion (and which ACs have no element at all).
  - **Optional flow-sequence** _(soft / advisory)_ — if a **user flow** declares an expected step order, check the design provides a reachable path through it. Journeys and experience maps themselves are upstream _input_ that motivate the stories — the gate does not dereference them (the NN/g discovery-vs-implementation split).

  These produce a verdict-with-reason in the §13.3 rubric style ("AC-4 implies an error state with no screen," "the success path has no confirm state") — actionable, reproducible, and gateable.

- **Heuristic UX checks — the judgment (advisory, clearly secondary).** General usability: visual hierarchy, affordances, contrast, cognitive load. This is vision/LLM judgment, _not_ a verdict, and it is **labeled as advisory**. It's included because it's useful, but it is the commodity layer (it's what prompt-to-pixels review tools already do), so it never leads and never masquerades as conformance.

A check whose input is absent is **skipped and declared** (as in §13.2): no registered acceptance criteria means coverage checks report "skipped, no ACs," never a false pass.

### 14.2 The reliability boundary (rendered vs. arbitrary designs)

A review is only as deterministic as the design is structured, and the PRD is explicit about the two cases:

- **UXFactory-rendered designs (the reliable case).** The design was rendered from a spec, so the structured spec already exists — conformance is checked against known structure, and the verdict is exact and near-deterministic. **Lead with this case.**
- **Arbitrary / hand-made Figma designs (best-effort).** When a user selects a design UXFactory did not render, there is no spec — structure must be _inferred_ from the canvas (which node is the "checkout" button a story needs?). That inference is a vision/semantic step, and the conformance verdict inherits its fuzziness. This case is supported but **labeled best-effort**, not deterministic.

The product leads with the reliable case and offers arbitrary-design review as the best-effort extension; it never promises a deterministic verdict on a design whose structure had to be guessed.

### 14.3 Surfaces

- **Plugin (interactive — designer-facing).** Select a frame/design → run review → notes annotated **on the canvas**: per-element flags (this element doesn't satisfy story-X), coverage gaps (AC-4 has no screen, the success path lacks a confirm state), each with a severity and a reason. Conformance flags (gate) and advisory UX flags (judgment) are visually distinguished so the designer can tell a requirement violation from a suggestion. See §7.8.
- **CLI (headless / CI — developer & agent-facing).** `uxfactory review <design>` runs the same checks and returns a structured report (`--json`) with a clean exit-code contract (conformance pass/fail), so it gates in CI and is callable by a harness — the same machine-readable discipline as `verify` (§10) and `batch` (§13). Distinct from `verify`: `verify` is spec↔render, `review` is design↔intent.

### 14.4 Relationship to the rest of the system

Conformance review **reuses the §13 rubric engine** rather than introducing a parallel one — the same input-conditional checks (§13.2) and reason-bearing criteria (§13.3), pointed at a single existing design instead of an iterating batch. Concretely it is an **interactive run of the tiered gate ladder** (companion PRD): the conformance gate is the hard/near-deterministic tiers (coverage, conformance) and the "heuristic UX" layer is the soft/escalate judgment tiers (craft, brand) — the same hardness gradient, surfaced for a single design at a chosen fidelity. It is complementary to verification (§10) and drift (§11): together they cover the three "is this still right?" axes — _render matches spec_ (verify), _design matches code_ (drift), _design matches product intent_ (review). And it is differentiated against both incumbents: prompt-to-pixels tools can't check _your_ stories, and Figma's design↔code direction isn't pointed at design↔intent at all.

> **Positioning note.** Because conformance review is pure-moat (grounded in structured intent nobody else has), ships on existing machinery without the unbuilt generation tier, and counters UX Pilot exactly where UXFactory wins, it is a strong candidate for the **near-term flagship** — ahead of generation in sequencing.

---

## 15. Inputs & knowledge store

The design tokens, user stories and their **acceptance criteria**, brand guidelines, and design guidelines that batch generation (§13), conformance review (§14), and drift detection (§11) consume are not loose files read on demand — they are a first-class **inputs/knowledge store**: the persistent, versioned **reference standard** the quality gates check against and that the iterate-to-threshold loop (§13.3) measures progress toward. (User journeys and experience maps live here too, but as upstream _input/context_ — they motivate the stories; the gate dereferences the **acceptance criteria**, not the journey, per the NN/g discovery-vs-implementation split.) This generalizes the §13.1 inputs registry into the shared source of truth all three subsystems read from. The full data model — every artifact, its ownership class, and the gate check it compiles into — is specified in the companion **Design Artifacts & Models PRD**; this section is the Implementation-PRD view of it.

Because the store _is_ the definition of "correct," it carries a hard dependency, stated up front: **store quality is gate quality.** A vague story ("user can manage settings") or a hand-wavy journey yields a vague conformance verdict; the gate is only as sharp as the store is precise. And when generation iterates _toward_ the store while review checks _against_ the same store, there is a closed-loop risk — the system can satisfy a literally-written story while missing its intent and grade itself as passing. The §13.3 guardrails (human approval as backstop, no-regression) carry over; the store adds the prerequisite that **the standard must be good for the gate to mean anything.** Vague store in, vague gate out.

### 15.1 Content model — every artifact compiles into a gate check

The organizing principle (companion PRD): **authoring is gate-authoring.** Each owned artifact is captured with the check it compiles into and that check's _hardness_ — the store isn't reference data the gate happens to read, it's gate-source data. Each artifact also has an **ownership class**: `OWNED` (authored, exists nowhere else), `REFERENCED` (pointer + content-hash into Figma/repo), `MATERIALIZED` (synced cache with provenance hash — e.g. the Figma-variable mirror the conformance tier resolves against), or `GENERATED` (produced by a gate run, kept for audit).

| Type                                | Ownership     | What it is                                                                                                 | Compiles into                                                                                              |
| ----------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Stories + acceptance criteria**   | OWNED         | requirements a design must satisfy; **ACs are the hinge** — they enumerate the view-states that must exist | state coverage + traceability (§14), hard                                                                  |
| **Design tokens**                   | MATERIALIZED  | the Figma-variable mirror + resolved index (name → value → code-symbol)                                    | token conformance (§14), hard                                                                              |
| **Design guidelines**               | OWNED         | layout / spacing / hierarchy / craft rules — part mechanical, part qualitative                             | split: quantifiable → hard lint; qualitative → soft judge (§15.3)                                          |
| **Brand guidelines**                | OWNED         | voice, tone, brand feel ("premium," "approachable")                                                        | advisory judgment, soft → escalate (§14, §13.3)                                                            |
| **User journeys / experience maps** | OWNED (input) | discovery/empathy artifacts that motivate stories                                                          | _not a gate source_ — upstream input; a declared **flow** sequence may compile into an optional soft check |

Generation (§13) consumes the same artifacts in the other direction. The Figma-variable mirror is MATERIALIZED rather than referenced because the conformance tier must _resolve_ the legal token set on every check — you cannot grep code against a bare pointer (companion PRD).

### 15.2 Two homes (local and hosted)

Same content model, two homes, split on the existing tier line (§16):

- **Local store (committed, free / solo).** Formalizes §13.1 into a structured store the repo owns and version-controls — the open-tier home. The engine reads it directly; nothing leaves the machine.
- **Hosted store (`uxfactory.io`, team tier).** The same content model as a shared, versioned, multi-user repository, backed by the hosted control plane (the **AWS AgentCore**—run service — §16). A team's accumulated tokens, stories/ACs, and guidelines is high-switching-cost shared state — so the hosted store **is the concrete form of the team-tier moat** (§16), not a separate feature. (Same one-interface, local-or-hosted-adapter pattern as the compute backends and render targets.)

### 15.3 Each input on the correct side of the gate

The store earns its "quality gate" role only if each content type is checked the way its nature allows — the **hardness gradient** of the tiered ladder (companion PRD), applied per type:

- **Hard (the gate — deterministic):** design tokens (name→value→code-symbol conformance), **acceptance criteria** (state coverage, traceability), and the _quantifiable_ slice of design guidelines (spacing scale, type ramp, min-contrast).
- **Soft / escalate (judgment — LLM / vision):** brand guidelines and the _qualitative_ slice of design guidelines ("feels premium," "approachable tone"). These feed §14's advisory layer and §13.3's subjective-residue score as scored criteria-with-reasons — never a hard PASS/FAIL; brand failures _escalate_ to a different owner (brand / tenant admin) than eng-facing conformance.
- **Input only (not gated):** user journeys and experience maps — they motivate the stories; only a declared **flow** sequence may compile into an optional soft reachability check.

So iteration tightens _deterministically_ toward token / AC conformance and _advisorily_ toward brand / design taste — the loop never pretends "feels premium" is a binary check. Design guidelines straddle the line deliberately: the parts that reduce to numbers join the gate; the parts that don't stay judgment.

---

## 16. Distribution, licensing & compute model

UXFactory is **open-core**: the engine is open-source and free; a proprietary hosted backend powers managed-premium generation and team collaboration. The paid boundary is **single-player vs. team** — solo use is free, multiplayer is the commercial tier.

### 16.1 Licensing

- **Open (MIT):** the engine — CLI, bridge, plugin, gate, spec, _and the generation orchestration_. A solo user gets a complete, inspectable tool, free, including high-fidelity generation. This is the adoption surface; the prompts/orchestration aren't the moat (they're replicable), so they're given away.
- **Proprietary (closed):** the hosted `uxfactory.io` backend — managed-premium generation (tuned models, curated quality), shared/team state, accounts, and billing. This is what enterprise pays for.
- If enterprise-only features later need to be source-visible but not free to self-host, those specific modules can adopt a **source-available** license (BSL/Elastic-style: source public, production use requires a license). Not needed for v1 — the open-core split already supports charging.

> Terminology: "open source" means the MIT engine specifically. Any future source-available enterprise modules are _source-available_, not open-source, and the docs/marketing keep that distinction precise.

### 16.2 Tiers (the paid boundary is single-player vs. team)

| Tier                  | Who               | Compute                      | What you get                                                                                     | Price |
| --------------------- | ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ | ----- |
| **Free — local**      | solo, BYO compute | user's (model API or RunPod) | full open engine **incl. generation**, unlimited, fully private                                  | free  |
| **Free — hosted**     | solo              | UXFactory's                  | managed-premium, **capped** (e.g. one project)                                                   | free  |
| **Paid — individual** | solo              | UXFactory's                  | premium generation, cap lifted                                                                   | paid  |
| **Enterprise — team** | teams / orgs      | UXFactory's                  | shared design systems & libraries, multi-user review/approval, org governance & RBAC, SSO, audit | paid  |

Single-player is free (local-unlimited, or hosted-capped); **team/collaboration is what enterprise buys** — and it's the stickiest part (shared state and standardized workflow carry high switching cost), a stronger moat than generation itself. The concrete form of that shared state is the hosted **inputs/knowledge store** (§15): a team's versioned tokens, stories/ACs, and guidelines — the highest-switching-cost asset in the product.

### 16.3 Compute model (three doors; whoever bears compute decides the cap)

Generation compute runs behind a **pluggable backend** (§3) — orchestration (the iterate loop + HITL routing) is provided by the **AWS AgentCore harness**, and each compute backend is an adapter under it:

- **BYO model API** (Claude Code, any model): user pays per-token to the provider. Free, unlimited.
- **BYO GPU — RunPod (opt-in):** user rents compute on RunPod (or similar) and runs open-weight models there. Free, unlimited, maximally private — their hardware bill. The natural home for the self-hosted-model / no-data-leaves path.
- **Hosted `uxfactory.io` (AWS AgentCore runtime):** UXFactory pays compute — the hosted door runs on the **AWS AgentCore harness + runtime** — so the free tier **must** be capped; paid lifts it. This is where UXFactory controls the model and therefore guarantees tuned, top-quality generation.

The cap on hosted-free isn't arbitrary gating — it's the compute-cost boundary made visible (mirrors Figma's free-file limit). The honest trade is **quality vs. control:** BYO-compute buys privacy, cost-control, and no cap, but generation quality then depends on the user's chosen model and pod ops; the hosted premium tier is where UXFactory owns the model and guarantees the quality. Additional providers (Modal, Replicate, local Ollama/vLLM) are added as adapters, not forks.

### 16.4 Surfaces & domains

| Surface                         | Role                                                        | Hosting                              |
| ------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| **Figma plugin**                | designer product surface; hosted-default, local-opt-in (§3) | Figma Community                      |
| **CLI + VS Code / Claude Code** | developer product surface                                   | open-source, local                   |
| **`uxfactory.dev`**             | static marketing + CLI docs (the public front door)         | GitHub Pages, no backend             |
| **`uxfactory.io`**              | control plane: accounts, billing, hosted-backend API        | proprietary service on AWS AgentCore |
| **GitHub `@uxfactory`**         | OSS home — source, packages, keyword-discoverable           | —                                    |

The _daily product_ lives in the Figma plugin (designers) and the CLI (developers); there is **no web app** for everyday use. `uxfactory.io` is the _occasional_ surface — sign up, manage a subscription — plus the API the plugin and CLI call; `uxfactory.dev` is a static site that _markets and documents_, never an auth/billing surface. What a user _sees_ of their work is the structured layer — design systems (token views), user stories and acceptance criteria, and user journeys (as input/context) rendered from their own artifacts — not the Figma canvas, which is the render target and appears elsewhere only as a headless image (§12).

---

## 17. Non-functional requirements

**NF1 — Performance.** Spec validation completes in **< 50 ms** for specs up to 100 nodes. A single `POST /edits` with 10 edits returns in **< 4 s** end-to-end (queue → poll pickup → apply → report) on a warm plugin. Plugin poll interval is **2 s**; missing the deadline is acceptable while a render is in flight. _(Verification adds the gate's own comparison time, which is O(nodes) and well within the same envelope; `--verify` waits on the render report, not on extra round-trips.)_

**NF2 — Privacy / security.** In **local mode** (solo, the default for the open engine), no data leaves the user's machine and all network access is localhost-only — the plugin manifest's `networkAccess` declares `["http://localhost:3779"]` and nothing else, and BYO-compute (model API or RunPod) keeps generation off UXFactory's servers entirely. In **hosted mode** (the managed-premium and team tiers), specs and generation requests go to `uxfactory.io` over TLS under an authenticated session, and the plugin manifest additionally declares the `uxfactory.io` API origin; that data path is opt-in by choosing the hosted tier. In both modes the plugin MUST NOT execute arbitrary code from specs; all text set on nodes MUST go through the official Figma API (no `innerHTML`-equivalents). Local render reports and verification results are plaintext under `.uxfactory/renders/`; the user is responsible for `.gitignore`-ing them.

**NF3 — Reliability.** A bridge restart MUST NOT corrupt the queue. Plugin disconnect MUST be detectable from the agent side: `POST /edits` (and `POST /verify` when no report can be produced) must time out cleanly with a `504`/`503` rather than hang. The plugin MUST tolerate malformed individual edits — one bad edit doesn't kill the batch — and the gate MUST surface that as per-node `failures` rather than crashing.

**NF4 — Compatibility.** Figma Plugin API **≥ 1.0.0**; both `editor: "figma"` and `editor: "figjam"`; macOS and Windows desktop apps **and** browser Figma; **Node 20+** for the bridge and CLI.

---

## 18. Repository layout & build order

```
uxfactory/
├── pnpm-workspace.yaml
├── package.json
├── uxfactory.map.json           # committed code↔node map for drift detection (§11)
├── uxfactory.batch.json         # committed batch inputs registry (offline batch; §13)
├── packages/
│   ├── uxfactory-spec/          # ① TS types + JSON Schema + validators (no deps on others)
│   │   ├── src/types.ts
│   │   ├── src/validate.ts
│   │   └── schema/uxfactory.schema.json
│   ├── uxfactory-gate/          # ② pure comparator (spec, report) → GateResult; deps: uxfactory-spec
│   │   └── src/gate.ts
│   ├── uxfactory-bridge/        # ③ localhost relay + REST surface incl. /verify; deps: spec, gate
│   │   └── src/server.ts
│   └── uxfactory-cli/           # ④ publish / verify / scan / lint / selection / bridge / map / drift
│       └── src/index.ts
├── plugin/                     # ⑤ uxfactory-plugin (Figma)
│   ├── manifest.json           #     networkAccess: ["http://localhost:3779"]
│   ├── code.ts                 #     main thread: figma.* API, render + applyEdits + inverse
│   └── ui.html                 #     iframe: poll bridge, panel UX, undo
├── skill/
│   └── SKILL.md                # ⑥ the agent skill (canonical source; vendored into uxfactory-cc)
├── clients/
│   └── uxfactory-cc/            # ⑦ Claude Code plugin (MCP-free; drives the CLI via Bash)
│       ├── .claude-plugin/     #     plugin.json + marketplace.json
│       ├── skills/uxfactory/SKILL.md   # vendored copy of the skill (Claude Code copies plugin dirs on install)
│       ├── commands/           #     publish, verify, bridge, scan, status (.md)
│       ├── hooks/hooks.json    #     PostToolUse(sync) + SessionStart(drift-notify) — see §11
│       └── README.md
├── design/                     # committed batch inputs: tokens.ds.json, *.prd.md, journeys/ (§13)
└── .uxfactory/                  # runtime working dir (mostly gitignored)
    ├── queue/  └─ processed/
    ├── renders/ └─ verify/
    ├── batch/   # previews, iteration scratch, batch report (§13)
    └── catalog.json
```

**Build order** (each layer is testable before the next): **① spec → ② gate → ③ bridge → ④ cli → ⑤ plugin → ⑥ skill → ⑦ uxfactory-cc.** The spec package is the keystone — its types feed every other package, so it lands and stabilizes first. The gate is built and unit-tested against fixture reports before the bridge wires it into `/verify`. The plugin is last because it's the only piece that needs a live Figma session to exercise, and it depends on the spec types being frozen. The Claude Code plugin (`uxfactory-cc`) comes last because it builds nothing of its own — it vendors the skill and invokes the already-finished CLI over Bash, so it cannot be assembled until both exist.

---

## 19. Acceptance criteria (Definition of Done)

**uxfactory-spec** — Types compile; the JSON Schema validates the three spec shapes and rejects unknown edit properties; `validate()` returns the same verdict on identical input whether called from the plugin UI or Node.

**uxfactory-gate** — `gate(spec, report)` is pure (no I/O), returns the §10.2 check set, and produces identical `GateResult` for identical inputs. Unit tests cover each check passing and failing, plus tolerance boundaries.

**uxfactory-bridge** — All §6.1 endpoints behave per spec; `/health` reports `pending`; `/next` serves `204` on empty; the queue survives a process restart; `POST /verify` returns the §10.1 shapes with correct HTTP codes for the no-report / unknown-id / no-plugin cases; nothing is written outside `.uxfactory/`.

**uxfactory-cli** — Each command in §5.1 works against a live bridge; exit codes match §5.3 (notably `1` = gate FAIL vs `2` = transport); `--verify` runs the §10.3 sequence; `--json` is machine-parseable.

**uxfactory-plugin** — Deterministic render verified by rendering the same spec twice and diffing reports; surgical edits mutate only `set` properties and no-op on missing targets; undo restores BEFORE values by `id` with the bounded stack and live count; the render report contains every §7.4 field; selection forwarding fires on `selectionchange`; the three panel states and transitions behave per §7.6; manifest `networkAccess` is truthful.

**SKILL.md** — An agent given only the skill can author a valid spec for a described diagram, run `uxfactory publish --verify`, read a FAIL, correct the spec, and reach PASS — without a human translating any step.

**Drift detection** — `uxfactory map check` flags a dangling entry; `uxfactory drift` detects a field change, a deleted-but-diagrammed orphan, and an implemented-but-undiagrammed orphan, exiting `1` on any; the `SessionStart` hook surfaces the report as context; UXFactory auto-fills `figmaId`/`lastSynced` on render and never edits the maintained map fields.

---

## 20. Roadmap (12-week horizon, rebranded)

| Phase            | Scope                                                                                                                                                                                                                                                                                                          | Goal                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Now (v1.0)**   | All §4–§10 functional requirements: spec-driven rendering, surgical edits, reversibility, render reports, selection, panel UX, sync `POST /edits`, **`POST /verify` + `uxfactory verify`/`--verify`**, the `SKILL.md`, and the `uxfactory-cc` Claude Code plugin (skill + slash commands + sync-on-edit hook). | Internal usability + CI-gateable verification |
| **Next 2 weeks** | `GET /snapshot`, auto-reconnect, Redo + `⌘⇧Z`, `--dry-run` (plugin support).                                                                                                                                                                                                                                   | Complete the agent loop                       |
| **Weeks 3–4**    | JSON Schema polish, `uxfactory lint`, snapshot tests for `applyEdits`, coalesced undo.                                                                                                                                                                                                                         | Authoring quality                             |
| **Weeks 5–6**    | Persist undo via `clientStorage`, history dropdown, selection-relative edits.                                                                                                                                                                                                                                  | Iterative editing UX                          |
| **Weeks 7–9**    | Distribution & onboarding polish: versioned manifest, setup README for manifest import + bridge start, pinned plugin typings.                                                                                                                                                                                  | Frictionless developer import                 |
| **Weeks 10–12**  | Track `frames[]` upserts in the command stream, webhook on render, visual-regression on edits, **drift detection** (`uxfactory.map.json` + `uxfactory map`/`uxfactory drift` + drift-notify hook), **headless preview rendering** (§12).                                                                       | Production-grade                              |

**Beyond the 12-week horizon (committed post-v1 directions):** **conformance review** (§14, `uxfactory review` — interactive story/journey quality checks; a strong near-term flagship candidate, ahead of generation since it ships on the existing rubric engine without the unbuilt generation tier); the **generation subsystem** (the HTML-origin pipeline → screenshot → Figma spec, structural validation, vision-critique, iterate-to-threshold — the high-fidelity generation NG1 now promises); the **hosted backend and team tier** (managed-premium generation, shared/team state, accounts and billing on `uxfactory.io` — §16); a **VS Code extension** and broader **compute adapters** (RunPod and other GPU/model backends); a **prompt-to-spec layer**; and a **design-system token spec** (`tokens.ds.json`, also a batch/generation input — §13.1). The render bridge stays the free/solo local path; the hosted backend is the paid/team path.

---

## 21. Risks & decisions

**Risks.** _Two audiences_ — UXFactory serves **developers** (CLI, Claude Code, dev-imported Figma plugin) and **designers** (the Figma Community plugin, hosted-default). The developer niche — those who treat design as code — is small but **directly reachable** through developer-first channels; the designer audience arrives through Figma Community. Earn the developer niche first (it anchors the open engine and adoption), then grow the hosted/designer funnel. As a commercial open-core product, audience and conversion matter — but the free local engine keeps the top of funnel wide while the paid team/premium tiers (§16) carry the revenue. _Distribution model_ — the developer front door is the **Claude Code plugin marketplace** (the `uxfactory-cc` plugin) plus npm for the CLI, the GitHub repo, and developer communities; the designer front door is the **Figma Community** plugin. Because the Community plugin is **hosted-default** (it connects to the `uxfactory.io` API, not localhost), it works on install with no local bridge — which is what makes Community distribution viable and removes the old marketplace-review failure mode (a reviewer no longer has to connect to a localhost daemon). Local-bridge mode is the **developer opt-in** for offline/local work. Residual risks: **onboarding friction in local mode** (importing the manifest and keeping `uxfactory bridge` running — within tolerance for an audience that already runs local services), and the **plugin-sandbox networking/auth** that the hosted-default and local modes both depend on (reaching `uxfactory.io` for OAuth and `localhost` for the dev path from Figma's sandbox) — to be verified against current Figma plugin networking limits before launch. _Figma API drift_ on `combineAsVariants`, sticky/shape text sublayers, and the connector API → keep typings pinned and let the gate's snapshot tests catch regressions. _Spec sprawl_ → JSON Schema + autocomplete keep hand-authoring cheap. _Composition with existing tools_ (draw.io, mermaid, Lucid) → offer migration paths (e.g. a `mermaid-to-spec` converter) later.

**Resolved decisions.** (1) **The render bridge stays local-only** — it is the localhost relay for the deterministic render path, not a hosted service, and gains no remote mode. This is distinct from the **hosted backend** (§16): the bridge is local rendering; the proprietary `uxfactory.io` backend powers managed-premium generation and the team tier, and _is_ pursued as the commercial layer. (2) **Build a prompt-to-spec layer (post-v1).** Natural language → a UXFactory spec — for diagrams within the declarative domain, and feeding the high-fidelity generation tier NG1 now embraces. (3) **Ship a design-system token spec (post-v1).** `tokens.ds.json` with colors and primitives referenced by name instead of inline hex — also a batch and generation input. (4) **Primary success metric: free-tier adoption** — Claude Code and Figma Community plugin installs (the front-door funnel) — with conversion to the paid premium/team tiers as the commercial signal. Secondary signals: gate pass-rate (automatic via `/verify`), spec count in repos, bridge connects/week, hosted-tier conversions, and drift-incidents-avoided testimonials.

---

## 22. Glossary

- **Spec** — a JSON document describing what to render (design / figjam / edit-only).
- **Bridge** — `uxfactory-bridge`, the localhost HTTP relay (`localhost:3779`).
- **Gate** — `uxfactory-gate`, the pure comparator asserting a render matches its spec; surfaced over REST as `POST /verify` and in the CLI as `uxfactory verify`.
- **Render report** — the plugin's post-render artifact (counts, geometry, PNGs, edit diffs) that the gate reads.
- **`edits[]`** — partial-update spec entries: target by `id`/`name`, `set` some properties, leave the rest alone.
- **Inverse edits** — the BEFORE-value capture of an `edits[]` op, used to undo.
- **Catalog** — `uxfactory scan` output mapping friendly asset names (e.g. `aws:lambda`) to component keys.
- **CONNECTED_MIN** — the auto-engaged tiny panel state shown while the plugin is connected to the bridge.
- **`uxfactory-cc`** — the Claude Code plugin packaging the skill, slash commands, and a sync-on-edit hook; drives the CLI over Bash (no MCP).
- **Component map** — `uxfactory.map.json`, the committed join between an implemented component, its spec node, and its Figma node; the basis for spec-drift detection (§11). Distinct from the Catalog.
- **Drift** — _canvas drift_ (Figma ≠ spec, caught by `uxfactory verify`) or _spec drift_ (spec ≠ implemented reality, caught by `uxfactory drift` via the component map).
- **Orphan** — a map entry whose source no longer resolves (deleted-but-diagrammed), or a source component with no map entry (implemented-but-undiagrammed).
- **Headless preview** — `uxfactory render` output: an approximate offline raster of a spec (no Figma), for CI, visual diffs, and batch review (§12).
- **Offline batch mode** — `uxfactory batch`: assemble, gate, and iterate-to-threshold a set of specs against committed guidance inputs, then stage for approval (§13).
- **Inputs registry** — `uxfactory.batch.json`, the committed manifest of guidance inputs (tokens / PRD / journey / reuse) that conditionally unlock batch checks.
- **Staged approval** — a pre-validated batch is queued `pending`, reviewed by the user against its previews, and only `approved` items render to the canvas.

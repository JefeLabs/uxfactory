# PRD — Settings screen (runtime, account, skills, storage)

**Source:** `.screenshots/img_8-settings.png`
**Position in flow:** sixth tab. The trust-and-plumbing view: what's running, who's paying, what the agent knows, and where data lives.

## 1. Purpose

Make the runtime **legible and controllable**: bridge daemon health and controls, subscription/worker identity, the pinned agent skills, and an explicit statement of the storage contract (what does and does not live in the Figma file). This screen is where the security posture is *visible*.

## 2. Layout — four cards

### Card 1 — Bridge daemon
- Header: green dot + `Bridge daemon` + right-aligned version `v0.4.2`.
- Fields (label/value rows):
  - `Endpoint` — `http://localhost:3779` (monospace; click to copy; editable — see Decisions. The mock's `4141` is illustrative).
  - `Uptime` — `2h 14m · 38 runs relayed`.
  - `Token index` — `1,204 resolved tokens · cached on disk`.
- Actions: `Restart` (secondary) · `View logs` (secondary).

### Card 2 — Subscription
- `Account` — `alex@jefelabs.com · Pro`.
- `Worker` — `worker.uxfactory.dev · us-east` (the hosted worker for Cloud mode / escalation).
- `Keys` — `Held by bridge — never in this plugin ✓` (green check; the security invariant as UI copy).

### Card 3 — Agent skills (`server-side, read-only` caption)
- Monospace list with right-aligned revision info:
  - `craft-review — rev 14 · pinned`
  - `vision-review — rev 9`
  - `intake — rev 6`
- Read-only in the panel; `pinned` marks a skill locked to a revision (project reproducibility).

### Card 4 — File storage
- Header + right-aligned `38.2 / 100 kb` with progress bar.
- Caption: "Only IDs + hashes stored in file. Heavy payloads live in the bridge cache."

## 3. Behaviors

- **Bridge card:**
  - Live fields poll `/health` + a `/stats` endpoint (uptime, runs relayed, token index size) every 10s while visible.
  - `Restart` → confirm dialog ("Active runs will resume from the queue") → bridge restart via its control endpoint; the pill in the context bar shows `Reconnecting…` until healthy.
  - `View logs` opens the bridge log (tail) in a read-only panel drawer (last 200 lines, live-follow toggle).
  - Bridge down: card shows red state + the copyable start command (mirrors Connect screen affordance).
- **Subscription card:** read-only summary; `Manage` link (row hover) opens the account portal in the browser. Free/local-only setups show `Local only — no subscription` and hide the Worker row.
- **Agent skills card:** informational; hovering a row reveals `rev history` tooltip (dates). Pinning/unpinning is a server-side operation (out of panel scope, v1 read-only) — the caption says so.
- **File storage card:** the bar reflects the plugin's client-storage + plugin-data footprint vs the self-imposed 100kb budget. Approaching the budget (>80%) turns the bar amber with a `Compact` action (drops stale run indexes; never artifacts — those aren't in the file).

## 4. The storage & security contract (normative)

1. **Figma file/plugin storage holds only:** connection record (mode, endpoint, repo path), run/link/annotation **ids + hashes**, UI state. Budgeted at 100kb.
2. **Bridge cache holds:** reports, artifacts content, asset payloads, token index.
3. **Keys (LLM/provider credentials) exist only bridge/worker-side.** The plugin never reads, stores, or transmits them; the manifest permits only localhost.
4. Skills execute server-side (worker); the panel displays their pinned revisions for reproducibility.

## 5. Data & system touchpoints

- `/health`, `/stats` (uptime, relayed count, token index), `/logs?tail=200` (new bridge endpoints; additive).
- Subscription/worker info from bridge config (Cloud mode) — never fetched by the plugin from the internet directly.
- Skills list + revisions: bridge-provided manifest of the worker's skill registry.
- Storage meter: computed locally from `figma.clientStorage` + plugin-data usage.

## 6. Acceptance criteria

1. All four cards render with live data; bridge fields update within 10s of change (e.g. runs-relayed increments after a check run).
2. `Restart` recovers to a healthy pill without losing queued jobs (queue persists on disk).
3. `View logs` shows the live tail without freezing the panel.
4. Keys row always renders the invariant line; there is no code path where a key string reaches the panel (enforced by review + the localhost-only manifest).
5. With no subscription configured, the card degrades gracefully to `Local only`.
6. The storage bar reflects real usage within ±10% and `Compact` reduces it without breaking run history links (ids re-resolvable bridge-side).
7. Version string matches the running bridge build.

## 7. Open questions

- ~~Endpoint edit~~ **Decided (2026-07-02):** default is `:3779` (the mock's `4141` is illustrative); the Endpoint field is editable here with validation + reconnect.
- Should skill revision pinning be panel-controllable for Pro accounts (v1 read-only assumed)?
- Log drawer redaction: bridge logs must already be secret-free; add a panel-side secret-pattern scrubber as defense-in-depth?

## 8. Out of scope

Billing management; multi-workspace switching; bridge auto-update.

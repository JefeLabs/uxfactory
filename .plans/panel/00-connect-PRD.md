# PRD — Connect screen

**Source:** `.screenshots/img-0-connect.png`
**Position in flow:** first-run (and any disconnected state). Everything else is gated behind a successful connect.

## 1. Purpose

Link the **current Figma file** to a **project repository** through a runtime the user controls — the local bridge ("Local Dev") or a hosted worker ("Cloud") — so generation, artifacts, and checks operate against that repo. Establish trust and prove liveness before showing any project UI.

## 2. Users & entry points

- **Developer/designer on their own machine** (primary, "Developer VM" edition): has the repo checked out and the bridge available.
- Entry: plugin launch with no stored connection for this Figma file; or the context-bar connection pill when disconnected; or Settings → Restart flows landing back here on failure.

## 3. Layout

1. **Hero band** (indigo): logo tile, headline "UX artifacts at your fingertips.", three value bullets (create/maintain specs · verify designs · generate goal-oriented AI-rendered designs). Static marketing copy — hidden on subsequent reconnects (show a compact variant).
2. **Connect section:** heading "Connect **{Figma file name}** to your project" — file name in indigo, taken live from `figma.root.name`.
3. **Mode segmented control:** `Local Dev` | `Cloud` (default Local Dev; persisted per file).
4. **Mode explainer:** one paragraph. Local Dev: "Link current Figma file to a project repository and leverage your machine's agent setup whether a subscription or local hosted LLM."
5. **Bridge status row:** label `Bridge:` + live pill — `● Running` (green) / `● Not detected` (red) / `● Checking…` (muted). Polls `GET /health` on the configured endpoint (Settings) every 3s while this screen is visible.
6. **Repository row:** label `Repository:` + monospace text input, prefilled from the last successful connect for this file (else empty with placeholder `~/path/to/repo`).
7. **Primary CTA:** full-width `Connect`.
8. **Caption:** "Repository root is validated on connect."

**Cloud mode variant:** replaces rows 5–6 with account sign-in state + workspace/worker picker (see Settings §Subscription for the fields); CTA unchanged. (Cloud specifics are a follow-up PRD; this screen must simply not dead-end.)

## 4. Behaviors

- **Connect (Local Dev):**
  1. Disable CTA, show inline spinner ("Connecting…").
  2. `GET /health` must be ok; else fail fast: "Bridge not reachable at {endpoint} — start it with `uxfactory bridge`." (copyable command).
  3. Bridge validates the repository path server-side: exists, is a directory, is a git worktree root (or contains `uxfactory.batch.json`/`.uxfactory/`). Errors render under the input, field outlined red: `Path not found` / `Not a repository root — pick the folder containing uxfactory.batch.json or .git`.
  4. On success: persist `{fileKey → mode, endpoint, repoPath}` in plugin client storage (IDs only — see Settings §File storage), emit a `connected` event, and route: repo has no project state → **Project setup 1**; else → **Prompt** tab.
- **Bridge pill transitions** never block typing; CTA disabled only while `Not detected` or path empty.
- **Close (×)** closes the plugin without persisting a partial connection.

## 5. States

| State | Treatment |
|---|---|
| Bridge running, path prefilled | CTA enabled (screenshot state) |
| Bridge checking | pill `Checking…`, CTA disabled |
| Bridge down | pill red + inline help with copyable `uxfactory bridge` command |
| Validating | CTA spinner, inputs locked |
| Validation error | red field + specific message; CTA re-enabled |
| Reconnect (returning user) | compact hero; path + mode prefilled; auto-connect if bridge healthy and path unchanged (with visible 2s "Reconnecting…" and a Cancel) |

## 6. Data & system touchpoints

- `GET /health` → `{ ok, pending }` (bridge liveness).
- Connect handshake → bridge validates path; returns project snapshot `{ hasClassification, hasProfile, artifactCounts }` used for routing.
- Plugin client storage: connection record keyed by `figma.fileKey`.
- No secrets: the panel never stores or transmits API keys (bridge/worker hold them — Settings).

## 7. Acceptance criteria

1. With the bridge running and a valid repo path, Connect completes in ≤ 2s (local) and routes to Setup (empty repo) or Prompt (existing project).
2. With the bridge down, Connect is disabled and the UI shows the exact start command; starting the bridge flips the pill to Running within 3s without user action.
3. An invalid path yields a field-level error naming the failure kind (not-found vs not-a-root); no partial state is persisted.
4. Mode + path are prefilled on next launch for the same Figma file.
5. The headline always reflects the live Figma file name.
6. Cloud tab renders and is selectable without dead-ending (may show a "coming soon"/sign-in stub per follow-up PRD).
7. All interactive elements are keyboard-operable; the status pill has an ARIA live region announcing changes.

## 8. Open questions

- ~~Default bridge endpoint~~ **Decided (2026-07-02):** canonical default is `:3779` (matches the implementation and the manifest's `devAllowedDomains`); configurable in Settings.
- Should Local Dev offer a native folder picker (Figma plugin sandbox limits) or stay text-entry + validation only?
- Multi-project files: one Figma file ↔ one repo for v1 (assumed); revisit for multi-repo monorepos.

## 9. Out of scope

Cloud auth flows; multi-user presence; bridge auto-install.

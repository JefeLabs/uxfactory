# PRD — Prompt screen (generate a design unit)

**Source:** `.screenshots/img_3-prompt.png`
**Position in flow:** default tab of the connected panel. The front door to the `generate-design` pipeline.

## 1. Purpose

Turn a natural-language goal into a **generate-design job**: the worker's agent authors the design (HTML tier), the gate + craft judge verify it, and the result lands **on the canvas** — grounded in the project's artifacts and generation defaults. This screen is prompt entry + grounding transparency + run history.

## 2. Layout

1. **Project context bar:** collapsed chip summary (`Ecommerce · Responsive · +10`), `● Connected`, expand button (expanded state = full chip set + quick dial, see 04-artifacts).
2. **Tab nav:** Prompt (active) · Artifacts · Components · Assets · Checks · Settings.
3. **Prompt composer** (indigo-outlined card):
   - Multiline text area, placeholder "Describe the screen or component to generate…"; screenshot example: "An order-confirmation page with delivery tracking, order summary, and a reorder shortcut".
   - **Unit-type dropdown chip** (bottom-left): `Page ▾` — options `Page · Template · Organism · Molecule` (the design-unit granularity).
   - **Platform target dropdown chip:** `Desktop + Mobile ▾` — options derived from classification Platforms (single or combined).
   - **Submit button:** circular indigo `↑` (disabled when the composer is empty or a run for this composer is already queued).
4. **GROUNDED IN** chip row: `✓ Requirements · ✓ Brand colors · ✓ Font pairings · ✓ Grid & viewports · ✓ Icon set` — one chip per artifact the generation will consume. Chip states: `✓` green (fresh) / `!` amber (stale/draft) / hollow gray (missing — generation proceeds with defaults; tooltip explains). Clicking a chip deep-links to that artifact in the Artifacts tab.
5. **RECENT** list: latest runs (3 visible, scroll for more): prompt text (single line, truncated) + status (`✓ checked` green / `2 warnings` amber / `generating…` muted-animated / `failed` red) + `View` link.
6. **Footer hint:** "Generates on canvas using your artifacts & generation defaults."

## 3. Behaviors

- **Submit:**
  1. Compose the job: `{ kind: "generate-design", prompt, unitType, platforms, profile snapshot, artifact refs }` → enqueue via the bridge pipeline (`POST /pipeline/request`).
  2. Insert a RECENT row at top with `generating…`; the composer clears but keeps unit/platform chips.
  3. Progress: the worker streams `UXF::PROGRESS` events (`draft → gate → revise → craft → extract → landing`) — surface as a compact status line under the RECENT row (e.g. `gate · iteration 3 · contrast fail`), throttled.
  4. On completion the design lands on the canvas (bridge → plugin render path); the row status becomes `✓ checked` (gate + craft pass), `N warnings` (best-effort finish with open findings), or `failed` (setup/transport error). `View` selects/zooms the landed frames and opens **Checks** filtered to that run.
- **Unit type** changes the composer placeholder ("Describe the component…" for Organism/Molecule) and the job's unit granularity.
- **Grounding chips** recompute on tab focus from artifact freshness (see 04).
- **Concurrent runs:** allowed (queue), but the composer shows "1 run in progress" affordance; RECENT is the queue view.
- **Empty project (no artifacts):** GROUNDED IN shows all-hollow chips + one inline callout "No artifacts yet — designs will use generation defaults only. Create artifacts →" (links to Artifacts).

## 4. States

| State | Treatment |
|---|---|
| Idle, ready | screenshot state |
| Empty composer | submit disabled |
| Run in flight | RECENT top row `generating…` + live progress line |
| Bridge lost mid-run | context pill → `Reconnecting…`; RECENT row holds; on reconnect, status resyncs from the bridge |
| Run failed (exit 2) | red `failed` + `View` opens Checks with the transport/setup error surfaced |

## 5. Data & system touchpoints

- Enqueue: bridge pipeline request (`generate-design`), consumed by the worker → agent skill loop (author HTML → batch gate → craft judge → extract → publish → landing verification).
- Progress: bridge SSE / event stream → panel.
- RECENT: persisted run index (IDs + status hashes) in plugin storage; full reports live bridge-side (see Settings §File storage).
- Landing: rendered via the plugin's DesignSpec render path; `View` uses the stored node ids from the landing report.

## 6. Acceptance criteria

1. Submitting the screenshot prompt enqueues a `generate-design` job with unitType `page` and platforms `desktop+mobile`, and a `generating…` row appears immediately.
2. A completed run flips its row to `✓ checked` and `View` zooms to the landed frames and opens Checks scoped to that run.
3. A run finishing with open findings shows `N warnings` where N = open must-findings count from the final report.
4. Grounding chips reflect artifact freshness within 1s of tab focus, and clicking one opens the Artifacts tab anchored to that artifact.
5. With zero artifacts, the callout renders and generation still works (defaults-only).
6. Progress events appear within 2s of the worker emitting them; the panel never polls the worker directly (bridge only).
7. Composer state (unit/platform) persists across tab switches within a session.

## 7. Open questions

- Per-run dial overrides (e.g. "this one at Low fidelity") — v1.1 advanced popover?
- RECENT retention: last N (20?) runs per file; archive/inspect older via Checks history?
- Should `View` on a `generating…` row live-follow the canvas as frames land (camera-follow toggle)?

## 8. Out of scope

Multi-prompt batching; prompt templates/library; variation count (N variations per prompt is a separate future phase — the design-unit granularity itself is CONFIRMED in scope, per README Decisions).

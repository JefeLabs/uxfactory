# PRD — Queue screen (offline work landing: previews → sequential apply)

**Tab position:** between Checks and Settings.
**Origin:** user request 2026-07-02 during the acceptance walk — "work that was done by some CI or developer requested changes while Figma was not running… a list of previews with associated specs that are applied in sequence by user or some render all."

## 1. Purpose

While Figma is closed, CI runs and developer-requested generations keep producing render work: the worker publishes batches (`saveBatch` — items each carrying a DesignSpec and a preview image) and approved specs land in the bridge's render queue. Today the redesigned panel consumes **none** of it — the queue-drain loop died with the legacy pipeline panel. The Queue tab restores that landing path with user control: see what accumulated, apply items one at a time in order, or Render All sequentially.

## 2. Layout

- **Header row:** `Queue` title + count badge (`N waiting`), right-aligned primary button **Render all** (disabled when N = 0 or a render is in flight).
- **Item list (FIFO, oldest first):** one card per waiting item:
  - **Preview thumbnail** (left, ~96px, object-fit contain, gray placeholder when the item has no preview).
  - **Spec summary** (middle): item title (spec's page/unit name), source badge (`batch` | `direct`), enqueue time (relative), spec digest line (e.g., "3 frames · 42 nodes · desktop 1440").
  - **Row actions** (right): **Apply** (render just this item, respecting order — applying item 3 first is allowed but confirms "2 earlier items will stay waiting"), overflow: **View spec** (read-only JSON view, same pattern as JSON artifacts), **Discard** (confirm; marks rejected).
- **In-flight state:** the active row shows a spinner + "Rendering…"; Render All shows sequence progress (`2 of 5`) in the header button.
- **Empty state:** "Nothing waiting. CI publishes and offline generations will land here." + secondary link to Checks (latest verified run).
- **Failure state:** failing row flips to error tone with the render-error message and a **Resume** button on the header (sequence stops at first failure; earlier successes stay applied).

## 3. Behaviors (normative)

1. **Listing is non-destructive.** The tab NEVER consumes queue entries to display them. New bridge route `GET /queue` returns waiting items (peek): `{items: [{id, source: "batch"|"direct", title, enqueuedAt, hasPreview, spec}]}` — merges the latest pending batch's items (status pending) with already-enqueued queue files.
2. **Previews over the wire.** `GET /queue/preview?id=<id>` serves the item's preview image bytes (PNG/SVG from `.uxfactory/batch/previews/` or the batch item's `preview` field); 404 → placeholder. (Manifest allows only `localhost:3779`, so previews must come through the bridge.)
3. **Apply = approve + drain one.** Applying a batch item approves exactly that item (partial approve — the batch stays pending for the rest); the spec is enqueued, then the panel drains it: fetch job → post `{type:"render", spec, jobId}` on the plugin bus → await `render-done`/`render-error` → `POST /rendered` report. Direct queue items skip approval and drain directly.
4. **Render All = sequential drain.** Items apply strictly in list order, one at a time (the canvas mutates on the main thread; parallel renders interleave nodes). Stop at first failure; Resume re-attempts from the failed item.
5. **Refresh:** the list refetches on tab focus and every 10s while the tab is visible (matches Settings' stats cadence); a render in flight suspends polling.
6. **Figma-closed accumulation is the point:** no auto-drain on connect in v1 — the user decides what lands on their canvas. (Auto-apply toggle is a Settings candidate, out of scope.)

## 4. Data & system touchpoints

- Bridge (additive): `GET /queue` (peek merge of pending batch items + queue files), `GET /queue/preview?id=`, `POST /queue/apply` `{id}` → `{jobId}` (partial-approve semantics for batch items; returns the enqueued job), `POST /queue/discard` `{id}` → `{ok}`. Existing: `GET /next` (drain), `POST /rendered` (report), `store.approveBatch` (extended with per-item approve that does NOT reject the remainder).
- Plugin bus (existing): `{type:"render", spec, jobId}` → main thread `renderSpec`; `render-done`/`render-error` messages back.
- Tab defs: `{ value: "queue", label: "Queue" }` inserted before `settings`; store `Tab` union gains `"queue"`.

## 5. Acceptance criteria

- AC-1: Items published while the plugin was closed appear on first open of the tab with previews, titles, and relative times; the display consumes nothing (bridge `pending` count unchanged until Apply).
- AC-2: Apply on a single item renders exactly that spec to the canvas and flips the row to applied; remaining items stay waiting (batch not force-resolved).
- AC-3: Render All processes every waiting item in FIFO order sequentially; header shows `k of N`; queue empties on success.
- AC-4: A render failure stops the sequence, shows the error on the failing row, leaves later items waiting; Resume retries from the failed item.
- AC-5: Discard removes an item without rendering (confirm dialog); batch item marked rejected.
- AC-6: With an older bridge lacking `/queue`, the tab shows a "bridge upgrade required" note (optional client method, three-tier degradation convention).

## 6. Open questions

1. Preview identity: batch previews are keyed by page name today (`cart.uxfactory.png`) — items and previews need a stable shared key; proposal: batch item carries the preview filename at `saveBatch` time (worker change).
2. Should applied items linger as a short history section ("Landed today") or vanish? Proposal: vanish; Checks is the history surface.

## 7. Out of scope

Auto-apply on connect (Settings toggle, later); parallel rendering; editing specs before apply; per-item diff-against-canvas preview; TanStack query keys (the migration will wrap these routes like all others); multi-root scoping (arrives with the multi-root bridge feature).

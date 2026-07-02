# Multi-Root Bridge — one bridge, N repos, root-scoped routes (Design)

**Date:** 2026-07-02
**Status:** Approved direction (user: "option 1" — multi-root bridge over rebind or bridge-per-port).
**Sequencing:** After the acceptance walk stabilizes; BEFORE the TanStack adoption (feature-first, same precedent as the Artifact Editor — the refactor then migrates root-scoped queries with everything else, and Query keys get the root dimension from day one).

## 1. Problem

The bridge binds exactly one `servedRoot` at startup (`project.ts` — connect to any other valid repo returns `bridge-serves-different-root`), and every `/project/*` route is hardwired to it. A user running multiple AI sessions on multiple repos cannot connect a second Figma file to a second repo. The plugin manifest permits only `localhost:3779` (untouchable), so the answer is one bridge serving N roots — not N bridges.

## 2. Design

### Root registry (user-level, persisted)
- `~/.uxfactory/repos.json`: `{ repos: [{ root, firstConnectedAt, lastConnectedAt }] }`, deduped by resolved absolute path, updated on every successful connect. Corrupt/missing file → treated as empty (never blocks the bridge).
- On startup the bridge's launch cwd is auto-registered (the "launch root") — always servable, preserves today's behavior.

### Serving semantics
- `POST /project/connect {repoPath}`: validate exists + `isProjectRoot` → resolve → **register** (registry + in-memory served set) → return snapshot. The `bridge-serves-different-root` reason is deleted; remaining errors: `not-found`, `not-a-root`.
- A served root must re-pass `isProjectRoot` at request time; a root that vanished returns 410 `{error: "root-gone"}`.

### Root-scoped routes (wire contract)
- Every `/project/*` route accepts `?root=<encodeURIComponent(absolutePath)>` — **query param on ALL verbs** (GET/POST/PUT). Chosen over a custom header deliberately: no new CORS preflight surface (headers burned us once), and the log ring then shows which root every request targeted — forensics-grade.
- Missing `?root=` → falls back to the launch root (legacy panel + worker builds keep working; documented as deprecated).
- Unknown/unregistered `?root=` → 403 `{error: "root-not-served"}` (connect first). Path containment is enforced per root exactly as today.

### /fs/repos (supersedes /fs/cwd for discovery; /fs/cwd stays for compat)
- `GET /fs/repos` → `{ cwd: string, repos: [{ root, name, lastConnectedAt, live }] }` — `name` = basename, `live` = passes `isProjectRoot` now, cwd pinned first then most-recent-first. Dead entries are returned with `live: false` (the panel decides to grey or hide).

### Panel
- Bridge client: `createBridge(fetchImpl?)` gains `setProjectRoot(root: string | null)`; once set, every `/project/*` call appends `?root=`. The resolved root comes from the connect response (`snapshot.root`) and the per-file stored connection — never the raw typed path.
- Connect screen: the single cwd chip becomes a chip list from `getRepos?.()` (fallback: `getCwd` single chip, then no chip — three-tier degradation against older bridges). Click fills the field; the existing validate-on-connect flow is unchanged.
- Stores: `connection.repoPath` stores the resolved root returned by connect.

### Worker / pipeline
- Enqueue: the bridge stamps every pipeline request with its resolved root (from `?root=` or launch-root fallback) — the panel does not hand-author the tag.
- `GET /pipeline/request/next?root=` → worker polls with its own projectRoot and claims only matching jobs. A legacy poll without `?root=` claims only launch-root jobs (never steals another repo's work).
- `/pipeline/events` SSE stays a single global stream; the panel already filters by its own run ids. (Per-root channels are PP2.)

## 3. Compatibility matrix (the invariants)
- Old panel + new bridge: no `?root=` → launch root. Works.
- New panel + old bridge: `getRepos`/`setProjectRoot` degrade (optional methods); connect to a non-launch root still surfaces the old `bridge-serves-different-root` message. Works.
- Old worker + new bridge: claims launch-root jobs only. Works.

## 4. Testing
Bridge: two temp roots connected concurrently — per-root snapshot/classification/profile/artifact isolation (writes land in the right repo), containment per root, legacy no-param fallback, 403 unknown root, 410 vanished root, registry round-trip + corrupt-file tolerance, /fs/repos shape with a dead entry. Contract (`bridge-contract.test.ts`): client with `setProjectRoot` → every route carries the param (the anti-wire-drift net this feature most needs); enqueue stamped with root; next?root= filtering. Panel: chip list render/order/fallback tiers, click-fill, resolved-root storage. Worker: polls with root, foreign jobs never claimed.

## 5. Non-goals
Web-app auth/multi-user; same-root concurrent-edit conflict resolution (last-write-wins stays); registry management UI (prune via editing the JSON for now); per-root SSE channels; any manifest/port change.

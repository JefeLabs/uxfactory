# Worker CLI verbs + supervised stack — `uxfactory worker` / `uxfactory up`

**Date:** 2026-07-09
**Status:** approved (design), pending implementation plan
**Scope:** step 2 of the worker-availability ladder. Step 1 (liveness presence + panel surface) shipped 2026-07-09 (`d135cd5..386a892`, spec `2026-07-09-worker-liveness-design.md`). Step 3 (on-demand spawn per job + idle reaping) remains out of scope.

## Problem

Starting a worker today is a raw incantation — `cd <project> && <engine>/clients/uxfactory-worker/node_modules/.bin/tsx <engine>/clients/uxfactory-worker/src/main.ts` — that nothing discoverable teaches. The quick-start documents it, the panel's no-worker banner can only point at that doc (step 1 deliberately shipped no copyable command), and "start uxfactory" is three processes in three terminals with no crash recovery. The multi-root design (workers claim only `root === cwd`) makes this worse: every project the panel connects needs its own correctly-cwd'd worker.

## Decisions (with user)

1. **`uxfactory up` spawns a worker per connected root automatically** (over explicit `--root` flags or a hybrid): the bridge runs in-process; whenever a root becomes served — the launch root at start, and each `POST /project/connect` thereafter — the supervisor ensures a worker child for it. Cost stays user-initiated (workers spawn on panel connects, jobs only run when the user clicks).
2. **The banner's copyable command is `cd <repoPath> && uxfactory worker`** (over `uxfactory up` or both): a scoped fix that works whether the running bridge came from `bridge` or `up`. It assumes a globally-linked `uxfactory` (`pnpm link --global`), which becomes the documented install step.
3. **Launch mechanics: spawn `tsx` from the engine checkout, resolved relative to the CLI's own location** (over compiling the worker or absorbing it into the CLI): zero changes to the private worker package, honors the source-first distribution, and keeps the published CLI free of the helmsmith/LLM stack. A CLI installed outside an engine checkout fails the verb with clear guidance.

## Constraints

- The worker package (`clients/uxfactory-worker`) is private, source-first (`tsx src/main.ts`), and depends on `@helmsmith/*` via local links — it can never be imported by the published CLI, only spawned.
- The worker already reads its config from env (`UXFACTORY_BRIDGE`, `UXFACTORY_WORKER_MODEL/KINDS/POOL/DEBUG/AUTH`, `UXFACTORY_CLI_BIN`) and cwd (project root). The verbs map flags to that contract; **no worker-package changes**.
- Worker exit codes: `2` = setup/preflight failure (missing `~/.agentx/auth.json`, invalid runtime) — deterministic, retrying is pointless. Other nonzero/signal = crash.
- `@uxfactory/bridge` and `@uxfactory/cli` are published → changesets required. The `BridgeOptions` addition must be optional/additive.
- CLI exit-code convention (PRD §5.3): 0 ok · 1 real signal · 2 setup/transport.

## Design

### 1. Worker-entry resolution (`packages/uxfactory-cli/src/worker-entry.ts`, pure)

`resolveWorkerEntry(cliModuleUrl, env, fileExists)` returns `{ tsxBin, mainTs } | null`:

1. `env.UXFACTORY_WORKER_ENTRY` — explicit dir of the worker package (must contain `src/main.ts`; tsx resolved from `<dir>/node_modules/.bin/tsx`). Wins when set.
2. Engine-relative: from the CLI module's real path (`packages/uxfactory-cli/dist/src/…` or `src/…` under vitest), walk up to the directory that contains both `packages/uxfactory-cli` and `clients/uxfactory-worker`; use `<engine>/clients/uxfactory-worker/{src/main.ts, node_modules/.bin/tsx}`.
3. Both miss → `null`; callers exit `2` with: `worker entry not found — the worker runs from a uxfactory checkout; set UXFACTORY_WORKER_ENTRY=<path-to-clients/uxfactory-worker> or run the CLI from the repo` (single source for this message).

Injectable `fileExists` so resolution is unit-testable without a real checkout layout.

### 2. `uxfactory worker` (`packages/uxfactory-cli/src/commands/worker.ts`)

`uxfactory worker [--root <path>] [--model <m>] [--kinds <csv>] [--pool <n>] [--bridge <url>] [--debug]`

- `--root` defaults to `process.cwd()`; resolved absolute; must be a project root (`.git` or `uxfactory.batch.json` — same `isProjectRoot` rule as the bridge). Not one → exit `2`.
- Spawns `tsxBin mainTs` with `cwd = root`, `stdio: "inherit"`, env = `process.env` overlaid with: `UXFACTORY_BRIDGE` (from `--bridge`), `UXFACTORY_WORKER_MODEL` / `_KINDS` / `_POOL` (from flags), `UXFACTORY_WORKER_DEBUG=1` (from `--debug`) — each only when the flag is present — plus `UXFACTORY_CLI_BIN=<path.resolve(process.argv[1])>` — the executing CLI script itself — set only when the env var is not already present, so skills' gate loops shell the same CLI the user invoked.
- Foreground: the command resolves when the child exits and passes the child's exit code through (signal-killed → `2`).
- The spawn call goes through an injectable seam (`deps.spawn`) so tests assert argv/env/cwd without launching tsx.

### 3. `uxfactory up` (`packages/uxfactory-cli/src/commands/up.ts` + `packages/uxfactory-cli/src/worker-supervisor.ts`)

`uxfactory up [--port <n>] [--data-dir <p>] [--model <m>] [--kinds <csv>] [--pool <n>] [--debug]`

**Bridge:** in-process `startBridge({ port, dataDir, onRootServed })`. New optional `BridgeOptions.onRootServed?: (root: string) => void` — in `server.ts` the projectPlugin registration composes it with the existing presence promotion:

```ts
onRootServed: (root) => {
  if (presence.promoteFor(root)) broadcastWorkerStatus(root);
  options.onRootServed?.(root);
}
```

Listen failure (`EADDRINUSE`) → exit `2` with: `bridge already running on :<port> — add a worker to it with 'uxfactory worker'`.

**Supervisor** (`worker-supervisor.ts`, pure logic + injectable `spawn`/timer seams):

- State: `Map<root, { child, restarts, lastStartAt, failed }>`.
- `ensure(root)`: no entry or exited entry → spawn (same env mapping as the `worker` command, `stdio: "pipe"`); entry running → no-op. `failed` roots (prior exit-2) retry ONCE per new `ensure` call (a fresh panel connect is a user signal), not on a timer.
- On start: `ensure(launchRoot)` (the launch root is always served; `onRootServed` doesn't fire for it). Then `ensure` on every `onRootServed(root)` callback.
- Exit handling: code `2` → mark `failed`, log the worker's last stderr lines prominently, do NOT auto-restart. Any other exit/signal → restart with exponential backoff `1s → 2s → 4s → … → 30s` cap; a run that survives `60s` resets the backoff counter.
- Output: each child's stdout/stderr lines re-emitted prefixed `[worker <basename(root)>]`.
- Shutdown: SIGINT/SIGTERM → SIGTERM all children, `close()` the bridge, exit `0`.

### 4. Panel — banner command upgrade

`WorkerBanner` line 2 becomes the copyable command, built from the store's `connection.repoPath`:

> `cd <repoPath> && uxfactory worker`

with a copy-to-clipboard button (`aria-label="Copy worker command"`). Use the pattern already established in `screens/Connect.tsx:46-73`: `navigator.clipboard.writeText` with a select-the-text fallback — the fallback is load-bearing because Figma's plugin iframe does not reliably grant clipboard permission. Extract that helper into `ui/lib/` and have both call sites use it rather than duplicating it a third time (Settings.tsx already copies it once). When `repoPath` is empty (shouldn't happen while connected), fall back to the current doc-pointer line. Line 1 and the dismiss/coverage contract from step 1 are unchanged (`role="status"`, `aria-label="Dismiss worker warning"`, render only on `uncovered`).

### 5. Docs + changesets

- Quick-start "The worker" section: verbs first (`uxfactory worker`, `uxfactory up`), the tsx incantation demoted to a "without a global link" fallback note; `pnpm link --global` called out as the install step the banner command assumes; cheat-sheet rows updated (`uxfactory worker`, `uxfactory up`).
- Changesets: `@uxfactory/bridge` minor (`onRootServed` option), `@uxfactory/cli` minor (two new commands).

### 6. Error handling & edge cases

- **CLI outside a checkout:** resolution miss → exit 2 + guidance (§1). Never a stack trace.
- **`up` with a bridge already running:** exit 2 + "use `uxfactory worker`" (decision 2's companion).
- **Worker preflight failure under `up`:** exit-2 → failed-root state; retried once per subsequent connect of that root; never a crash-loop against a missing auth file.
- **Crash-looping worker:** capped backoff (30s) bounds the churn; each restart re-announces presence via the tagged SSE URL (step 1), so the panel dot flickers honestly rather than lying.
- **Root connected twice / snapshot refetch storms:** `ensure` is idempotent per root (dedup map).
- **Multiple `up` instances:** second one fails on the port bind (exit 2) before spawning any worker — no duplicate-worker herd.
- **`uxfactory worker` against a dead bridge:** the worker itself already handles this (SSE reconnect loop + poll errors logged); the verb does not pre-check the bridge.

### 7. Testing

- **CLI unit** (`packages/uxfactory-cli/test/`): `worker-entry` resolution (env override valid/invalid, engine-relative hit from a fake layout, total miss → null); `worker` command spawn-mapping (argv, cwd, env overlay incl. `UXFACTORY_CLI_BIN` only-when-unset, exit-code passthrough) via the spawn seam; `worker-supervisor` with fake children (ensure/dedup; exit-2 → failed, no restart, retry-once-on-ensure; crash → backoff sequence 1/2/4…30 using injected timers; 60s-stable reset; SIGTERM fan-out on shutdown).
- **Bridge** (`packages/uxfactory-bridge/test/`): `onRootServed` option fires on `POST /project/connect` with the resolved root AND presence promotion still broadcasts (compose, don't replace).
- **Panel** (`packages/uxfactory-plugin/test/`): banner renders `cd <repoPath> && uxfactory worker` from the store's repoPath; copy button present with its aria-label; empty-repoPath fallback line; step-1 contracts (role, dismiss, coverage gating) still hold.
- **Live smoke:** `uxfactory up` from the engine root → curl-connect `uxfio-demo` → supervisor spawns a second worker (snapshot `workers` for both roots non-empty) → `kill -9` one worker → observe prefixed restart log + presence flap → Ctrl-C tears everything down clean.

## Out of scope (step 3 and later)

- On-demand worker spawn per enqueued job + idle reaping.
- Softening the banner copy for the old-worker/new-bridge skew (folded into the step-1 follow-ups; the copy chosen here still assumes tagged workers).
- Worker identity/telemetry beyond step 1's `kinds` + `connectedAt`.
- Windows support for the spawn path (the stack is developed/run on macOS/Linux; tsx shim resolution uses POSIX layout).

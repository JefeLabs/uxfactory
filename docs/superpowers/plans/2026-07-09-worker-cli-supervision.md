# Worker CLI Verbs + Supervised Stack (`uxfactory worker` / `uxfactory up`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tsx worker incantation with `uxfactory worker` (one root, foreground) and `uxfactory up` (in-process bridge + supervised worker per connected root), and give the panel banner its copyable start command.

**Architecture:** The published CLI never imports the private worker package — it *spawns* `tsx src/main.ts` resolved relative to the CLI's own location inside the engine checkout (env override `UXFACTORY_WORKER_ENTRY`). Flags map onto the worker's existing env contract; zero worker-package changes. `up` runs `startBridge` in-process with a new additive `BridgeOptions.onRootServed` callback feeding a pure `WorkerSupervisor` (exit-2 = setup → no restart, retry on next connect; crashes → capped exponential backoff).

**Tech Stack:** commander (CLI), Fastify via `@uxfactory/bridge` (in-process), node:child_process with injectable spawn seams, vitest; React/Zustand for the panel banner.

**Spec:** `docs/superpowers/specs/2026-07-09-worker-cli-supervision-design.md` — read it first.

## Global Constraints

- Node ≥ 20.10, pnpm workspace, run commands from the repo root unless stated. Commit directly to `main` (project convention).
- Exit codes (PRD §5.3): `0` ok · `1` real signal · `2` setup/transport. Worker child exit `2` = deterministic setup failure → supervisor must NOT auto-restart it.
- Worker env contract (names verbatim, worker package unchanged): `UXFACTORY_BRIDGE`, `UXFACTORY_WORKER_MODEL`, `UXFACTORY_WORKER_KINDS`, `UXFACTORY_WORKER_POOL`, `UXFACTORY_WORKER_DEBUG=1`, `UXFACTORY_CLI_BIN`. `UXFACTORY_CLI_BIN` is set to `path.resolve(process.argv[1])` ONLY when not already present in the env.
- Resolution-miss message (verbatim, single source): `worker entry not found — the worker runs from a uxfactory checkout; set UXFACTORY_WORKER_ENTRY=<path-to-clients/uxfactory-worker> or run the CLI from the repo`
- Port-busy message (verbatim): `bridge already running on :<port> — add a worker to it with 'uxfactory worker'`
- Backoff: `1s → 2s → 4s → … → 30s` cap; a run surviving `60s` resets the counter. Retry of a `failed` (exit-2) root happens once per subsequent `ensure` call, never on a timer.
- Banner command (verbatim shape): `cd <repoPath> && uxfactory worker`; copy button `aria-label="Copy worker command"`; step-1 contracts unchanged (`role="status"`, `aria-label="Dismiss worker warning"`, render only on `uncovered`).
- Changesets: `@uxfactory/bridge` minor (Task 3), `@uxfactory/cli` minor (Task 5). Plugin/worker are private — no changesets.
- Panel `.tsx` tests run from `packages/uxfactory-plugin` (root vitest globs only `.test.ts`). New RTL files need `// @vitest-environment jsdom`, `import "@testing-library/jest-dom/vitest"`, `afterEach(cleanup)`.
- Pre-existing failures NOT to fix or worsen: `@uxfactory/spec` typecheck (story-schema.test.ts:184) and the plugin's 16 typecheck errors.

---

### Task 1: CLI — `worker-entry.ts` (pure resolution + env mapping)

**Files:**
- Create: `packages/uxfactory-cli/src/worker-entry.ts`
- Test: `packages/uxfactory-cli/test/worker-entry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 2 & 5):
  - `interface WorkerEntry { tsxBin: string; mainTs: string }`
  - `const WORKER_ENTRY_HELP: string` (the verbatim miss message)
  - `resolveWorkerEntry(cliModuleUrl: string, env?: NodeJS.ProcessEnv, fileExists?: (p: string) => boolean): WorkerEntry | null`
  - `isProjectRootDir(dir: string, fileExists?: (p: string) => boolean): boolean`
  - `workerEnv(flags: { bridge?: string; model?: string; kinds?: string; pool?: string; debug?: boolean }, base: NodeJS.ProcessEnv, cliBinPath: string): NodeJS.ProcessEnv`

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-cli/test/worker-entry.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  resolveWorkerEntry,
  isProjectRootDir,
  workerEnv,
  WORKER_ENTRY_HELP,
} from "../src/worker-entry.js";

/** fileExists stub backed by a set of absolute paths. */
function fsOf(...paths: string[]): (p: string) => boolean {
  const set = new Set(paths.map((p) => path.resolve(p)));
  return (p) => set.has(path.resolve(p));
}

const ENGINE = "/eng";
const WORKER_DIR = `${ENGINE}/clients/uxfactory-worker`;
const WORKER_FILES = [
  `${ENGINE}/packages/uxfactory-cli`,
  `${ENGINE}/clients/uxfactory-worker`,
  `${WORKER_DIR}/src/main.ts`,
  `${WORKER_DIR}/node_modules/.bin/tsx`,
];
const CLI_URL = pathToFileURL(`${ENGINE}/packages/uxfactory-cli/dist/src/cli.js`).href;

describe("resolveWorkerEntry", () => {
  it("resolves engine-relative from the CLI module location", () => {
    const entry = resolveWorkerEntry(CLI_URL, {}, fsOf(...WORKER_FILES));
    expect(entry).toEqual({
      tsxBin: `${WORKER_DIR}/node_modules/.bin/tsx`,
      mainTs: `${WORKER_DIR}/src/main.ts`,
    });
  });

  it("UXFACTORY_WORKER_ENTRY override wins over engine-relative", () => {
    const alt = "/elsewhere/uxfactory-worker";
    const entry = resolveWorkerEntry(
      CLI_URL,
      { UXFACTORY_WORKER_ENTRY: alt },
      fsOf(`${alt}/src/main.ts`, `${alt}/node_modules/.bin/tsx`, ...WORKER_FILES),
    );
    expect(entry?.mainTs).toBe(`${alt}/src/main.ts`);
  });

  it("an override that lacks the entry files yields null (no silent fallback)", () => {
    const entry = resolveWorkerEntry(
      CLI_URL,
      { UXFACTORY_WORKER_ENTRY: "/nope" },
      fsOf(...WORKER_FILES),
    );
    expect(entry).toBeNull();
  });

  it("total miss (CLI outside a checkout) yields null; help text names the env var", () => {
    expect(resolveWorkerEntry(CLI_URL, {}, fsOf())).toBeNull();
    expect(WORKER_ENTRY_HELP).toContain("UXFACTORY_WORKER_ENTRY");
  });
});

describe("isProjectRootDir", () => {
  it("true for .git or uxfactory.batch.json, false otherwise", () => {
    expect(isProjectRootDir("/p", fsOf("/p/.git"))).toBe(true);
    expect(isProjectRootDir("/p", fsOf("/p/uxfactory.batch.json"))).toBe(true);
    expect(isProjectRootDir("/p", fsOf("/p/README.md"))).toBe(false);
  });
});

describe("workerEnv", () => {
  it("maps only the flags that are present, onto the base env", () => {
    const env = workerEnv(
      { bridge: "http://127.0.0.1:4000", model: "opus", debug: true },
      { PATH: "/usr/bin" },
      "/eng/packages/uxfactory-cli/dist/src/cli.js",
    );
    expect(env.PATH).toBe("/usr/bin");
    expect(env.UXFACTORY_BRIDGE).toBe("http://127.0.0.1:4000");
    expect(env.UXFACTORY_WORKER_MODEL).toBe("opus");
    expect(env.UXFACTORY_WORKER_DEBUG).toBe("1");
    expect(env.UXFACTORY_WORKER_KINDS).toBeUndefined();
    expect(env.UXFACTORY_WORKER_POOL).toBeUndefined();
    expect(env.UXFACTORY_CLI_BIN).toBe("/eng/packages/uxfactory-cli/dist/src/cli.js");
  });

  it("never clobbers a pre-set UXFACTORY_CLI_BIN", () => {
    const env = workerEnv({}, { UXFACTORY_CLI_BIN: "/pinned" }, "/other");
    expect(env.UXFACTORY_CLI_BIN).toBe("/pinned");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/worker-entry.test.ts`
Expected: FAIL — `Cannot find module '../src/worker-entry.js'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/uxfactory-cli/src/worker-entry.ts
/**
 * worker-entry — locate the private worker package the CLI spawns, and map CLI
 * flags onto the worker's env contract (spec 2026-07-09-worker-cli-supervision).
 *
 * The worker (clients/uxfactory-worker) is source-first with @helmsmith link
 * deps — the published CLI can never import it, only spawn `tsx src/main.ts`
 * from a uxfactory checkout. Resolution: UXFACTORY_WORKER_ENTRY override, else
 * walk up from THIS module's real location to the checkout root (the directory
 * containing both packages/uxfactory-cli and clients/uxfactory-worker).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkerEntry {
  tsxBin: string;
  mainTs: string;
}

export const WORKER_ENTRY_HELP =
  "worker entry not found — the worker runs from a uxfactory checkout; " +
  "set UXFACTORY_WORKER_ENTRY=<path-to-clients/uxfactory-worker> or run the CLI from the repo";

/** Both entry files present under `dir`, or null. */
function fromDir(dir: string, fileExists: (p: string) => boolean): WorkerEntry | null {
  const mainTs = path.join(dir, "src", "main.ts");
  const tsxBin = path.join(dir, "node_modules", ".bin", "tsx");
  return fileExists(mainTs) && fileExists(tsxBin) ? { tsxBin, mainTs } : null;
}

export function resolveWorkerEntry(
  cliModuleUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (p: string) => boolean = existsSync,
): WorkerEntry | null {
  const override = env["UXFACTORY_WORKER_ENTRY"];
  // An explicit override must be honored or fail — never silently fall back.
  if (override !== undefined && override.trim() !== "") {
    return fromDir(path.resolve(override), fileExists);
  }
  let dir = path.dirname(fileURLToPath(cliModuleUrl));
  for (let i = 0; i < 8; i += 1) {
    if (
      fileExists(path.join(dir, "packages", "uxfactory-cli")) &&
      fileExists(path.join(dir, "clients", "uxfactory-worker"))
    ) {
      return fromDir(path.join(dir, "clients", "uxfactory-worker"), fileExists);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Same project-root rule as the bridge (roots.ts): .git or uxfactory.batch.json. */
export function isProjectRootDir(
  dir: string,
  fileExists: (p: string) => boolean = existsSync,
): boolean {
  return (
    fileExists(path.join(dir, ".git")) || fileExists(path.join(dir, "uxfactory.batch.json"))
  );
}

/** Overlay flag-derived vars on `base`; UXFACTORY_CLI_BIN only when unset. */
export function workerEnv(
  flags: { bridge?: string; model?: string; kinds?: string; pool?: string; debug?: boolean },
  base: NodeJS.ProcessEnv,
  cliBinPath: string,
): NodeJS.ProcessEnv {
  return {
    ...base,
    ...(flags.bridge !== undefined ? { UXFACTORY_BRIDGE: flags.bridge } : {}),
    ...(flags.model !== undefined ? { UXFACTORY_WORKER_MODEL: flags.model } : {}),
    ...(flags.kinds !== undefined ? { UXFACTORY_WORKER_KINDS: flags.kinds } : {}),
    ...(flags.pool !== undefined ? { UXFACTORY_WORKER_POOL: flags.pool } : {}),
    ...(flags.debug === true ? { UXFACTORY_WORKER_DEBUG: "1" } : {}),
    ...(base["UXFACTORY_CLI_BIN"] === undefined ? { UXFACTORY_CLI_BIN: cliBinPath } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-cli/test/worker-entry.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/worker-entry.ts packages/uxfactory-cli/test/worker-entry.test.ts
git commit -m "feat(cli): worker-entry resolution + env mapping for the worker verbs"
```

---

### Task 2: CLI — `uxfactory worker` command

**Files:**
- Create: `packages/uxfactory-cli/src/commands/worker.ts`
- Modify: `packages/uxfactory-cli/src/cli.ts` (register the command; follow the `bridge` command's lazy-import pattern at cli.ts:59-79)
- Test: `packages/uxfactory-cli/test/worker-cmd.test.ts`

**Interfaces:**
- Consumes: Task 1's `resolveWorkerEntry`, `isProjectRootDir`, `workerEnv`, `WORKER_ENTRY_HELP`; `EXIT` from `../exit.js`; `IO` from `../io.js`.
- Produces: `workerCmd(flags: WorkerCmdFlags, io: IO, deps?: WorkerCmdDeps): Promise<number>` where `WorkerCmdFlags = { root?: string; model?: string; kinds?: string; pool?: string; bridge?: string; debug?: boolean }` and `WorkerCmdDeps = { spawn?; cliModuleUrl?: string; cliBinPath?: string; env?: NodeJS.ProcessEnv; cwd?: string; fileExists? }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-cli/test/worker-cmd.test.ts
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SpawnOptions } from "node:child_process";
import { workerCmd } from "../src/commands/worker.js";
import { WORKER_ENTRY_HELP } from "../src/worker-entry.js";
import type { IO } from "../src/io.js";

function captureIO(): IO & { outs: string[]; errs: string[] } {
  const outs: string[] = [];
  const errs: string[] = [];
  return { outs, errs, out: (s) => outs.push(s), err: (s) => errs.push(s) };
}

const ENGINE = "/eng";
const WORKER_DIR = `${ENGINE}/clients/uxfactory-worker`;
const CLI_URL = pathToFileURL(`${ENGINE}/packages/uxfactory-cli/dist/src/cli.js`).href;
const FILES = new Set(
  [
    `${ENGINE}/packages/uxfactory-cli`,
    `${ENGINE}/clients/uxfactory-worker`,
    `${WORKER_DIR}/src/main.ts`,
    `${WORKER_DIR}/node_modules/.bin/tsx`,
    "/proj/.git",
  ].map((p) => path.resolve(p)),
);
const fileExists = (p: string): boolean => FILES.has(path.resolve(p));

/** Fake child: an EventEmitter the test resolves by emitting "close". */
function fakeSpawn(): {
  spawn: (bin: string, args: string[], opts: SpawnOptions) => EventEmitter;
  calls: Array<{ bin: string; args: string[]; opts: SpawnOptions }>;
  children: EventEmitter[];
} {
  const calls: Array<{ bin: string; args: string[]; opts: SpawnOptions }> = [];
  const children: EventEmitter[] = [];
  return {
    calls,
    children,
    spawn: (bin, args, opts) => {
      calls.push({ bin, args, opts });
      const child = new EventEmitter();
      children.push(child);
      return child;
    },
  };
}

describe("workerCmd", () => {
  it("spawns tsx main.ts with cwd=root and the mapped env; passes the exit code through", async () => {
    const io = captureIO();
    const f = fakeSpawn();
    const done = workerCmd(
      { root: "/proj", model: "opus" },
      io,
      { spawn: f.spawn as never, cliModuleUrl: CLI_URL, cliBinPath: "/bin/uxfactory", env: { PATH: "/usr/bin" }, fileExists },
    );
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.bin).toBe(`${WORKER_DIR}/node_modules/.bin/tsx`);
    expect(f.calls[0]!.args).toEqual([`${WORKER_DIR}/src/main.ts`]);
    expect(f.calls[0]!.opts.cwd).toBe(path.resolve("/proj"));
    expect(f.calls[0]!.opts.stdio).toBe("inherit");
    expect((f.calls[0]!.opts.env as NodeJS.ProcessEnv).UXFACTORY_WORKER_MODEL).toBe("opus");
    expect((f.calls[0]!.opts.env as NodeJS.ProcessEnv).UXFACTORY_CLI_BIN).toBe("/bin/uxfactory");
    f.children[0]!.emit("close", 0);
    expect(await done).toBe(0);
  });

  it("non-project root → exit 2, no spawn", async () => {
    const io = captureIO();
    const f = fakeSpawn();
    const code = await workerCmd(
      { root: "/not-a-project" },
      io,
      { spawn: f.spawn as never, cliModuleUrl: CLI_URL, env: {}, fileExists },
    );
    expect(code).toBe(2);
    expect(f.calls).toHaveLength(0);
    expect(io.errs.join("\n")).toContain("not a project root");
  });

  it("entry resolution miss → exit 2 with the canonical help text", async () => {
    const io = captureIO();
    const f = fakeSpawn();
    const code = await workerCmd(
      { root: "/proj" },
      io,
      { spawn: f.spawn as never, cliModuleUrl: CLI_URL, env: {}, fileExists: (p) => path.resolve(p) === path.resolve("/proj/.git") },
    );
    expect(code).toBe(2);
    expect(io.errs.join("\n")).toContain(WORKER_ENTRY_HELP);
  });

  it("signal-killed child (close null) → exit 2; spawn error → exit 2", async () => {
    const io = captureIO();
    const f = fakeSpawn();
    const done = workerCmd({ root: "/proj" }, io, {
      spawn: f.spawn as never, cliModuleUrl: CLI_URL, env: {}, fileExists,
    });
    f.children[0]!.emit("close", null);
    expect(await done).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/worker-cmd.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/worker.js'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/uxfactory-cli/src/commands/worker.ts
/**
 * `uxfactory worker` — run a generation worker for ONE project root in the
 * foreground (spec 2026-07-09-worker-cli-supervision §2). The worker claims
 * only jobs whose root equals its cwd, so the verb's whole job is: resolve the
 * worker entry, validate the root, spawn tsx with the mapped env, and pass the
 * child's exit code through.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import { EXIT } from "../exit.js";
import type { IO } from "../io.js";
import {
  resolveWorkerEntry,
  isProjectRootDir,
  workerEnv,
  WORKER_ENTRY_HELP,
} from "../worker-entry.js";

export interface WorkerCmdFlags {
  root?: string;
  model?: string;
  kinds?: string;
  pool?: string;
  bridge?: string;
  debug?: boolean;
}

/** Minimal child surface the command needs (satisfied by ChildProcess). */
interface SpawnedChild {
  on(event: "error", cb: (err: Error) => void): unknown;
  on(event: "close", cb: (code: number | null) => void): unknown;
}

export interface WorkerCmdDeps {
  spawn?: (bin: string, args: string[], opts: SpawnOptions) => SpawnedChild;
  cliModuleUrl?: string;
  cliBinPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fileExists?: (p: string) => boolean;
}

export async function workerCmd(
  flags: WorkerCmdFlags,
  io: IO,
  deps: WorkerCmdDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const fileExists = deps.fileExists ?? existsSync;
  const root = path.resolve(flags.root ?? deps.cwd ?? process.cwd());

  if (!isProjectRootDir(root, fileExists)) {
    io.err(`not a project root (needs .git or uxfactory.batch.json): ${root}`);
    return EXIT.TRANSPORT;
  }

  const entry = resolveWorkerEntry(deps.cliModuleUrl ?? import.meta.url, env, fileExists);
  if (entry === null) {
    io.err(WORKER_ENTRY_HELP);
    return EXIT.TRANSPORT;
  }

  const spawn = deps.spawn ?? (nodeSpawn as unknown as NonNullable<WorkerCmdDeps["spawn"]>);
  const cliBin = deps.cliBinPath ?? path.resolve(process.argv[1] ?? "uxfactory");
  const child = spawn(entry.tsxBin, [entry.mainTs], {
    cwd: root,
    stdio: "inherit",
    env: workerEnv(flags, env, cliBin),
  });

  return await new Promise<number>((resolve) => {
    child.on("error", (err: Error) => {
      io.err(`spawn failed: ${err.message}`);
      resolve(EXIT.TRANSPORT);
    });
    // A signal-killed child reports code null → setup/transport (2).
    child.on("close", (code: number | null) => resolve(code ?? EXIT.TRANSPORT));
  });
}
```

- [ ] **Step 4: Register in `cli.ts`** (after the `bridge` command block, same lazy-import style):

```ts
  program
    .command("worker")
    .description("Run a generation worker for a project root (claims only that root's jobs)")
    .option("--root <path>", "project root to serve (default: cwd)")
    .option("--model <model>", "model passed to the agent runtime")
    .option("--kinds <csv>", "job kinds this worker claims (default: all)")
    .option("--pool <n>", "concurrent drain lanes (default 1)")
    .option("--bridge <url>", "bridge base URL")
    .option("--debug", "retain per-job scratch files")
    .action(
      async (opts: {
        root?: string;
        model?: string;
        kinds?: string;
        pool?: string;
        bridge?: string;
        debug?: boolean;
      }) => {
        const { workerCmd } = await import("./commands/worker.js");
        lastCode = await workerCmd(opts, consoleIO);
      },
    );
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run packages/uxfactory-cli/test/worker-cmd.test.ts packages/uxfactory-cli/test/cli.test.ts && pnpm --filter @uxfactory/cli typecheck`
Expected: PASS / clean

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-cli/src/commands/worker.ts packages/uxfactory-cli/src/cli.ts packages/uxfactory-cli/test/worker-cmd.test.ts
git commit -m "feat(cli): uxfactory worker — spawn the checkout worker for one root"
```

---

### Task 3: Bridge — additive `BridgeOptions.onRootServed` + changeset

**Files:**
- Modify: `packages/uxfactory-bridge/src/server.ts` (BridgeOptions interface ~line 21; the `projectPlugin` registration's `onRootServed`)
- Create: `.changeset/bridge-on-root-served.md`
- Test: `packages/uxfactory-bridge/test/on-root-served.test.ts`

**Interfaces:**
- Consumes: existing `presence.promoteFor` / `broadcastWorkerStatus` wiring (step 1).
- Produces (used by Task 5): `BridgeOptions.onRootServed?: (root: string) => void` — fires with the RESOLVED root on every successful `POST /project/connect`, composed AFTER presence promotion.

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-bridge/test/on-root-served.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

describe("BridgeOptions.onRootServed", () => {
  let app: FastifyInstance;
  let launchRoot: string;
  const served: string[] = [];

  beforeEach(async () => {
    served.length = 0;
    launchRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-onrootserved-"));
    await mkdir(path.join(launchRoot, ".git"), { recursive: true });
    app = await createBridge({
      dataDir: path.join(launchRoot, ".uxfactory"),
      reposRegistryPath: path.join(launchRoot, "repos-registry.json"),
      onRootServed: (root) => served.push(root),
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(launchRoot, { recursive: true, force: true });
  });

  it("fires with the resolved root on every successful connect", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "uxf-conn-root-"));
    await mkdir(path.join(other, ".git"), { recursive: true });
    const res = await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: other },
    });
    expect(res.json()).toMatchObject({ ok: true });
    expect(served).toEqual([path.resolve(other)]);

    await app.inject({ method: "POST", url: "/project/connect", payload: { repoPath: other } });
    expect(served).toHaveLength(2); // fires per connect, not per new root
    await rm(other, { recursive: true, force: true });
  });

  it("does not fire on a failed connect", async () => {
    await app.inject({
      method: "POST",
      url: "/project/connect",
      payload: { repoPath: "/definitely/missing" },
    });
    expect(served).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-bridge/test/on-root-served.test.ts`
Expected: FAIL — TS/object error: `onRootServed` is not a known BridgeOptions property (typecheck) or callback never fires.

- [ ] **Step 3: Implement**

3a. `BridgeOptions` (server.ts ~line 21) gains:

```ts
  /**
   * Fired with the RESOLVED root after every successful POST /project/connect
   * (spec 2026-07-09-worker-cli-supervision). `uxfactory up` uses this to
   * ensure a worker per connected root. Composed AFTER presence promotion.
   */
  onRootServed?: (root: string) => void;
```

3b. In the `projectPlugin` registration, compose (the existing callback body from step 1 stays first):

```ts
    onRootServed: (root) => {
      if (presence.promoteFor(root)) broadcastWorkerStatus(root);
      options.onRootServed?.(root);
    },
```

3c. Changeset `.changeset/bridge-on-root-served.md`:

```md
---
"@uxfactory/bridge": minor
---

BridgeOptions gains an optional `onRootServed(root)` callback, fired with the
resolved root after every successful POST /project/connect — the hook
`uxfactory up` uses to ensure a worker per connected root.
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/uxfactory-bridge/test/on-root-served.test.ts packages/uxfactory-bridge/test/worker-status-relay.test.ts && pnpm --filter @uxfactory/bridge typecheck`
Expected: PASS / clean (presence promotion still works — the relay suite covers it)

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-bridge/src/server.ts packages/uxfactory-bridge/test/on-root-served.test.ts .changeset/bridge-on-root-served.md
git commit -m "feat(bridge): BridgeOptions.onRootServed — connect hook for the up supervisor"
```

---

### Task 4: CLI — `WorkerSupervisor` (pure, injectable seams)

**Files:**
- Create: `packages/uxfactory-cli/src/worker-supervisor.ts`
- Test: `packages/uxfactory-cli/test/worker-supervisor.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (spawning is injected).
- Produces (used by Task 5):
  - `interface SupervisedChild { on(event: "close", cb: (code: number | null) => void): unknown; kill(signal?: string): unknown }`
  - `interface SupervisorDeps { spawnWorker(root: string): SupervisedChild; log(line: string): void; now?(): number; schedule?(fn: () => void, ms: number): unknown; cancel?(handle: unknown): void }`
  - `class WorkerSupervisor { constructor(deps); ensure(root: string): void; stop(): void }`
  - Exported constants `BACKOFF_BASE_MS = 1000`, `BACKOFF_CAP_MS = 30000`, `STABLE_RESET_MS = 60000`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-cli/test/worker-supervisor.test.ts
import { describe, it, expect } from "vitest";
import { WorkerSupervisor, BACKOFF_CAP_MS } from "../src/worker-supervisor.js";
import type { SupervisedChild, SupervisorDeps } from "../src/worker-supervisor.js";

/** Deterministic harness: manual clock, captured timers, scripted children. */
function harness(): {
  deps: SupervisorDeps;
  spawns: string[];
  children: Array<{ close(code: number | null): void; killed: string[] }>;
  timers: Array<{ fn: () => void; ms: number; cancelled: boolean }>;
  logs: string[];
  tick(ms: number): void;
} {
  let clock = 0;
  const spawns: string[] = [];
  const children: Array<{ close(code: number | null): void; killed: string[] }> = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const logs: string[] = [];
  const deps: SupervisorDeps = {
    spawnWorker(root) {
      spawns.push(root);
      let onClose: ((code: number | null) => void) | null = null;
      const killed: string[] = [];
      const child: SupervisedChild = {
        on(_event, cb) {
          onClose = cb;
          return child;
        },
        kill(signal) {
          killed.push(signal ?? "SIGTERM");
          return true;
        },
      };
      children.push({ close: (code) => onClose?.(code), killed });
      return child;
    },
    log: (line) => logs.push(line),
    now: () => clock,
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return t;
    },
    cancel: (handle) => {
      (handle as { cancelled: boolean }).cancelled = true;
    },
  };
  return {
    deps, spawns, children, timers, logs,
    tick(ms) {
      clock += ms;
      for (const t of timers.splice(0)) if (!t.cancelled) t.fn();
    },
  };
}

describe("WorkerSupervisor", () => {
  it("ensure spawns once per root; running root is a no-op", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    sup.ensure("/a");
    sup.ensure("/b");
    expect(h.spawns).toEqual(["/a", "/b"]);
  });

  it("crash → restarts with exponential backoff 1s, 2s, 4s … capped at 30s", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    const delays: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      h.children[h.children.length - 1]!.close(1); // crash immediately (0ms uptime)
      delays.push(h.timers[h.timers.length - 1]!.ms);
      h.tick(0); // fire the pending restart without advancing stability clock
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(delays[5]).toBe(BACKOFF_CAP_MS);
  });

  it("a run surviving 60s resets the backoff counter", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    h.children[0]!.close(1);
    expect(h.timers[0]!.ms).toBe(1000);
    h.tick(0); // restart #1
    h.tick(60_000); // stable for 60s
    h.children[1]!.close(1); // then crashes
    expect(h.timers[h.timers.length - 1]!.ms).toBe(1000); // reset, not 2000
  });

  it("exit 2 marks the root failed: no timer restart, but a later ensure retries once", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    h.children[0]!.close(2);
    expect(h.timers).toHaveLength(0); // no scheduled restart
    expect(h.logs.join("\n")).toContain("setup");
    sup.ensure("/a"); // fresh connect → one retry
    expect(h.spawns).toEqual(["/a", "/a"]);
  });

  it("stop kills children, cancels pending restarts, and blocks further spawns", () => {
    const h = harness();
    const sup = new WorkerSupervisor(h.deps);
    sup.ensure("/a");
    sup.ensure("/b");
    h.children[0]!.close(1); // pending restart for /a
    sup.stop();
    expect(h.timers[0]!.cancelled).toBe(true);
    expect(h.children[1]!.killed).toEqual(["SIGTERM"]);
    sup.ensure("/c");
    expect(h.spawns).toEqual(["/a", "/b"]); // no /c
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/worker-supervisor.test.ts`
Expected: FAIL — `Cannot find module '../src/worker-supervisor.js'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/uxfactory-cli/src/worker-supervisor.ts
/**
 * WorkerSupervisor — one worker child per project root, restart-on-crash
 * (spec 2026-07-09-worker-cli-supervision §3).
 *
 * Policy: exit code 2 is a DETERMINISTIC setup failure (missing agent auth,
 * bad runtime) — restarting on a timer would crash-loop against a missing
 * credential, so the root is marked failed and retried ONCE per subsequent
 * ensure() (a fresh panel connect is a user signal that something changed).
 * Any other exit is a crash: restart with exponential backoff 1s→30s, counter
 * reset after 60s of stable uptime. Spawning/clock/timers are injected so the
 * whole state machine is unit-testable without processes.
 */

export interface SupervisedChild {
  on(event: "close", cb: (code: number | null) => void): unknown;
  kill(signal?: string): unknown;
}

export interface SupervisorDeps {
  /** Spawn a worker for `root` (cwd, env, and output prefixing pre-bound by the caller). */
  spawnWorker(root: string): SupervisedChild;
  log(line: string): void;
  now?(): number;
  schedule?(fn: () => void, ms: number): unknown;
  cancel?(handle: unknown): void;
}

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 30_000;
export const STABLE_RESET_MS = 60_000;

interface Entry {
  child: SupervisedChild | null;
  restarts: number;
  lastStartAt: number;
  failed: boolean;
  pendingRestart: unknown | null;
}

export class WorkerSupervisor {
  private readonly entries = new Map<string, Entry>();
  private stopped = false;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(private readonly deps: SupervisorDeps) {
    this.now = deps.now ?? Date.now;
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = deps.cancel ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  }

  /** Idempotent: running root → no-op; failed root → one retry; else spawn. */
  ensure(root: string): void {
    if (this.stopped) return;
    const entry = this.entries.get(root);
    if (entry?.child !== null && entry?.child !== undefined) return;
    if (entry?.pendingRestart !== null && entry?.pendingRestart !== undefined) return;
    if (entry !== undefined) entry.failed = false; // a fresh ensure retries a failed root once
    this.start(root);
  }

  private start(root: string): void {
    const prev = this.entries.get(root);
    const entry: Entry = {
      child: null,
      restarts: prev?.restarts ?? 0,
      lastStartAt: this.now(),
      failed: false,
      pendingRestart: null,
    };
    this.entries.set(root, entry);
    const child = this.deps.spawnWorker(root);
    entry.child = child;
    child.on("close", (code) => this.onExit(root, code));
  }

  private onExit(root: string, code: number | null): void {
    if (this.stopped) return;
    const entry = this.entries.get(root);
    if (entry === undefined) return;
    entry.child = null;

    if (code === 2) {
      entry.failed = true;
      this.deps.log(
        `worker for ${root} exited with a setup error (code 2) — not restarting; ` +
          `fix the cause (e.g. ~/.agentx/auth.json) and reconnect the project to retry`,
      );
      return;
    }

    // Stable run resets the backoff counter before computing the next delay.
    if (this.now() - entry.lastStartAt >= STABLE_RESET_MS) entry.restarts = 0;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** entry.restarts, BACKOFF_CAP_MS);
    entry.restarts += 1;
    this.deps.log(`worker for ${root} exited (code ${String(code)}) — restarting in ${delay}ms`);
    entry.pendingRestart = this.schedule(() => {
      entry.pendingRestart = null;
      if (!this.stopped) this.start(root);
    }, delay);
  }

  /** Kill children, cancel pending restarts, refuse further ensures. */
  stop(): void {
    this.stopped = true;
    for (const entry of this.entries.values()) {
      if (entry.pendingRestart !== null) this.cancel(entry.pendingRestart);
      entry.pendingRestart = null;
      entry.child?.kill("SIGTERM");
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/uxfactory-cli/test/worker-supervisor.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/worker-supervisor.ts packages/uxfactory-cli/test/worker-supervisor.test.ts
git commit -m "feat(cli): WorkerSupervisor — per-root children, exit-2 no-restart, capped backoff"
```

---

### Task 5: CLI — `uxfactory up` command + CLI changeset

**Files:**
- Create: `packages/uxfactory-cli/src/commands/up.ts`
- Modify: `packages/uxfactory-cli/src/cli.ts` (register `up`, lazy-import like `bridge`; set `foreground = true` on success exactly as the bridge action does)
- Create: `.changeset/cli-worker-up-verbs.md`
- Test: `packages/uxfactory-cli/test/up-cmd.test.ts`

**Interfaces:**
- Consumes: Task 1 (`resolveWorkerEntry`, `workerEnv`, `WORKER_ENTRY_HELP`), Task 3 (`BridgeOptions.onRootServed`), Task 4 (`WorkerSupervisor`).
- Produces: `upCmd(flags: UpCmdFlags, io: IO, deps?: UpCmdDeps): Promise<{ code: number; close?: () => Promise<void> }>` where `UpCmdFlags = { port?: number; dataDir: string; model?: string; kinds?: string; pool?: string; debug?: boolean }` and `UpCmdDeps = { startBridge?; spawn?; cliModuleUrl?; cliBinPath?; env?; fileExists?; onSignal?: (sig: string, cb: () => void) => void }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-cli/test/up-cmd.test.ts
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { upCmd } from "../src/commands/up.js";
import type { IO } from "../src/io.js";

function captureIO(): IO & { outs: string[]; errs: string[] } {
  const outs: string[] = [];
  const errs: string[] = [];
  return { outs, errs, out: (s) => outs.push(s), err: (s) => errs.push(s) };
}

const ENGINE = "/eng";
const WORKER_DIR = `${ENGINE}/clients/uxfactory-worker`;
const CLI_URL = pathToFileURL(`${ENGINE}/packages/uxfactory-cli/dist/src/cli.js`).href;
const FILES = new Set(
  [
    `${ENGINE}/packages/uxfactory-cli`,
    `${ENGINE}/clients/uxfactory-worker`,
    `${WORKER_DIR}/src/main.ts`,
    `${WORKER_DIR}/node_modules/.bin/tsx`,
  ].map((p) => path.resolve(p)),
);
const fileExists = (p: string): boolean => FILES.has(path.resolve(p));

function fakeChild(): EventEmitter & { kill: () => boolean; stdout: null; stderr: null } {
  const child = new EventEmitter() as EventEmitter & {
    kill: () => boolean;
    stdout: null;
    stderr: null;
  };
  child.kill = () => true;
  child.stdout = null;
  child.stderr = null;
  return child;
}

describe("upCmd", () => {
  it("starts the bridge, ensures a launch-root worker, and ensures per onRootServed", async () => {
    const io = captureIO();
    const spawned: string[] = [];
    let onRootServed: ((root: string) => void) | undefined;
    const { code } = await upCmd(
      { dataDir: "/launch/.uxfactory" },
      io,
      {
        startBridge: async (opts) => {
          onRootServed = opts.onRootServed;
          return { url: "http://127.0.0.1:3779", close: async () => {} };
        },
        spawn: ((_bin: string, _args: string[], opts: { cwd?: string }) => {
          spawned.push(String(opts.cwd));
          return fakeChild();
        }) as never,
        cliModuleUrl: CLI_URL,
        env: {},
        fileExists,
        onSignal: () => {},
      },
    );
    expect(code).toBe(0);
    expect(spawned).toEqual([path.resolve("/launch")]); // dirname(dataDir)
    onRootServed?.("/other");
    expect(spawned).toEqual([path.resolve("/launch"), "/other"]);
    expect(io.outs.join("\n")).toContain("http://127.0.0.1:3779");
  });

  it("port already in use → exit 2 with the canonical message", async () => {
    const io = captureIO();
    const { code } = await upCmd(
      { port: 3779, dataDir: "/launch/.uxfactory" },
      io,
      {
        startBridge: async () => {
          const err = new Error("listen EADDRINUSE") as Error & { code?: string };
          err.code = "EADDRINUSE";
          throw err;
        },
        spawn: (() => fakeChild()) as never,
        cliModuleUrl: CLI_URL,
        env: {},
        fileExists,
        onSignal: () => {},
      },
    );
    expect(code).toBe(2);
    expect(io.errs.join("\n")).toContain(
      "bridge already running on :3779 — add a worker to it with 'uxfactory worker'",
    );
  });

  it("worker entry missing → exit 2 before the bridge starts", async () => {
    const io = captureIO();
    let bridgeStarted = false;
    const { code } = await upCmd(
      { dataDir: "/launch/.uxfactory" },
      io,
      {
        startBridge: async () => {
          bridgeStarted = true;
          return { url: "x", close: async () => {} };
        },
        spawn: (() => fakeChild()) as never,
        cliModuleUrl: CLI_URL,
        env: {},
        fileExists: () => false,
        onSignal: () => {},
      },
    );
    expect(code).toBe(2);
    expect(bridgeStarted).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/up-cmd.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/up.js'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/uxfactory-cli/src/commands/up.ts
/**
 * `uxfactory up` — the supervised stack (spec 2026-07-09-worker-cli-supervision
 * §3): bridge in-process + one worker child per connected root. The launch
 * root is served at startup (registry.init seeds it without firing the
 * callback), so it is ensured explicitly; every subsequent successful
 * POST /project/connect fires BridgeOptions.onRootServed → supervisor.ensure.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { EXIT } from "../exit.js";
import type { IO } from "../io.js";
import { resolveWorkerEntry, workerEnv, WORKER_ENTRY_HELP } from "../worker-entry.js";
import { WorkerSupervisor } from "../worker-supervisor.js";
import type { SupervisedChild } from "../worker-supervisor.js";

export interface UpCmdFlags {
  port?: number;
  dataDir: string;
  model?: string;
  kinds?: string;
  pool?: string;
  debug?: boolean;
}

interface BridgeHandle {
  url: string;
  close: () => Promise<void>;
}

export interface UpCmdDeps {
  startBridge?: (opts: {
    port?: number;
    dataDir: string;
    onRootServed: (root: string) => void;
  }) => Promise<BridgeHandle>;
  spawn?: typeof nodeSpawn;
  cliModuleUrl?: string;
  cliBinPath?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (p: string) => boolean;
  /** Signal registration seam (default process.on) so tests never trap signals. */
  onSignal?: (sig: "SIGINT" | "SIGTERM", cb: () => void) => void;
}

/** Re-emit a child stream line-by-line with the worker's root prefix. */
function prefixStream(
  stream: NodeJS.ReadableStream | null | undefined,
  prefix: string,
  log: (line: string) => void,
): void {
  if (stream === null || stream === undefined) return;
  let buf = "";
  stream.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim() !== "") log(`${prefix} ${line}`);
    }
  });
}

export async function upCmd(
  flags: UpCmdFlags,
  io: IO,
  deps: UpCmdDeps = {},
): Promise<{ code: number; close?: () => Promise<void> }> {
  const env = deps.env ?? process.env;
  const fileExists = deps.fileExists ?? existsSync;

  // Fail fast: no worker entry means up cannot deliver its promise at all.
  const entry = resolveWorkerEntry(deps.cliModuleUrl ?? import.meta.url, env, fileExists);
  if (entry === null) {
    io.err(WORKER_ENTRY_HELP);
    return { code: EXIT.TRANSPORT };
  }

  const spawn = deps.spawn ?? nodeSpawn;
  const cliBin = deps.cliBinPath ?? path.resolve(process.argv[1] ?? "uxfactory");
  const launchRoot = path.dirname(path.resolve(flags.dataDir));

  const supervisor = new WorkerSupervisor({
    spawnWorker: (root): SupervisedChild => {
      const child = spawn(entry.tsxBin, [entry.mainTs], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: workerEnv(flags, env, cliBin),
      }) as ChildProcess;
      const prefix = `[worker ${path.basename(root)}]`;
      prefixStream(child.stdout, prefix, io.err);
      prefixStream(child.stderr, prefix, io.err);
      return child as unknown as SupervisedChild;
    },
    log: io.err,
  });

  const startBridge =
    deps.startBridge ??
    (async (opts: { port?: number; dataDir: string; onRootServed: (root: string) => void }) => {
      const bridge = await import("@uxfactory/bridge");
      return bridge.startBridge(opts);
    });

  let handle: BridgeHandle;
  try {
    handle = await startBridge({
      ...(flags.port !== undefined ? { port: flags.port } : {}),
      dataDir: flags.dataDir,
      onRootServed: (root) => supervisor.ensure(root),
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "EADDRINUSE") {
      const port = flags.port ?? Number(env["UXFACTORY_PORT"] ?? 3779);
      io.err(`bridge already running on :${port} — add a worker to it with 'uxfactory worker'`);
      return { code: EXIT.TRANSPORT };
    }
    throw err;
  }

  io.out(`uxfactory up: bridge ${handle.url}`);
  supervisor.ensure(launchRoot);

  const shutdown = async (): Promise<void> => {
    supervisor.stop();
    await handle.close();
  };
  const onSignal = deps.onSignal ?? ((sig, cb) => process.on(sig, cb));
  onSignal("SIGINT", () => void shutdown().then(() => process.exit(EXIT.OK)));
  onSignal("SIGTERM", () => void shutdown().then(() => process.exit(EXIT.OK)));

  return { code: EXIT.OK, close: shutdown };
}
```

- [ ] **Step 4: Register in `cli.ts`** (after the `worker` block; sets `foreground = true` on success like `bridge` does):

```ts
  program
    .command("up")
    .description("Supervised stack: bridge + one worker per connected project root")
    .option("--port <port>", "port to listen on (default 3779 or UXFACTORY_PORT)")
    .option("--data-dir <path>", "data directory (default <cwd>/.uxfactory)")
    .option("--model <model>", "model passed to spawned workers")
    .option("--kinds <csv>", "job kinds spawned workers claim (default: all)")
    .option("--pool <n>", "concurrent drain lanes per worker")
    .option("--debug", "retain per-job scratch files")
    .action(
      async (opts: {
        port?: string;
        dataDir?: string;
        model?: string;
        kinds?: string;
        pool?: string;
        debug?: boolean;
      }) => {
        const { upCmd } = await import("./commands/up.js");
        const { code } = await upCmd(
          {
            ...(opts.port !== undefined ? { port: Number(opts.port) } : {}),
            dataDir: resolveDataDir(opts.dataDir),
            ...(opts.model !== undefined ? { model: opts.model } : {}),
            ...(opts.kinds !== undefined ? { kinds: opts.kinds } : {}),
            ...(opts.pool !== undefined ? { pool: opts.pool } : {}),
            ...(opts.debug === true ? { debug: true } : {}),
          },
          consoleIO,
        );
        if (code !== EXIT.OK) {
          lastCode = code;
        } else {
          foreground = true; // keep the relay + supervisor alive
        }
      },
    );
```

- [ ] **Step 5: Changeset** `.changeset/cli-worker-up-verbs.md`:

```md
---
"@uxfactory/cli": minor
---

Two new commands: `uxfactory worker` runs a generation worker for one project
root (foreground, spawned from the checkout's worker package), and
`uxfactory up` runs the supervised stack — bridge in-process plus one
auto-restarted worker per connected project root.
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run packages/uxfactory-cli/test/up-cmd.test.ts packages/uxfactory-cli/test/worker-supervisor.test.ts packages/uxfactory-cli/test/cli.test.ts && pnpm --filter @uxfactory/cli typecheck`
Expected: PASS / clean

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-cli/src/commands/up.ts packages/uxfactory-cli/src/cli.ts packages/uxfactory-cli/test/up-cmd.test.ts .changeset/cli-worker-up-verbs.md
git commit -m "feat(cli): uxfactory up — in-process bridge + supervised worker per connected root"
```

---

### Task 6: Panel — copy helper extraction + banner command

**Files:**
- Create: `packages/uxfactory-plugin/ui/lib/copy.ts`
- Modify: `packages/uxfactory-plugin/ui/screens/Connect.tsx:46-77` (replace the local helper with the lib import; `CopyableCommand` keeps its exact DOM)
- Modify: `packages/uxfactory-plugin/ui/components/WorkerBanner.tsx` (command line + copy button)
- Test: `packages/uxfactory-plugin/test/worker-banner.test.tsx` (extend)

**Interfaces:**
- Consumes: store `connection.repoPath` (shape `{ status, endpoint, repoPath, mode }`), step-1 banner contracts.
- Produces: `copyText(text: string, fallbackElementId: string): void` and `selectText(elementId: string): void` in `ui/lib/copy.ts`.

- [ ] **Step 1: Write the failing tests** (add to the existing `describe` in `worker-banner.test.tsx`; keep all step-1 tests untouched):

```tsx
  it("shows the copyable worker command built from the connected repoPath", () => {
    useAppStore.setState({
      workers: [],
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "/repo/demo", mode: "local" },
    });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(screen.getByText("cd /repo/demo && uxfactory worker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy worker command" })).toBeInTheDocument();
  });

  it("falls back to the doc-pointer line when repoPath is empty", () => {
    useAppStore.setState({
      workers: [],
      connection: { status: "connected", endpoint: "http://localhost:3779", repoPath: "", mode: "local" },
    });
    render(<WorkerBanner kind="generate-artifact" />);
    expect(
      screen.getByText("Start a worker from this project's root (see the quick-start's worker section)."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy worker command" })).toBeNull();
  });
```

(If the existing test file's `beforeEach` resets only `workers`/`workerBannerDismissed`, extend it to also reset `connection` to the store's initial shape so these tests don't leak into the step-1 assertions.)

- [ ] **Step 2: Run to verify failure**

Run (from `packages/uxfactory-plugin`): `pnpm vitest run test/worker-banner.test.tsx`
Expected: the two new tests FAIL (command text absent)

- [ ] **Step 3: Implement**

3a. `ui/lib/copy.ts` — extracted verbatim from Connect.tsx's pattern:

```ts
/**
 * copy — clipboard with a text-selection fallback. The fallback is
 * load-bearing: Figma's plugin iframe does not reliably grant clipboard
 * permission, so on failure we select the <code> element's contents so the
 * user can hit ⌘C (spec 2026-07-09-worker-cli-supervision §4).
 */
export function selectText(elementId: string): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function copyText(text: string, fallbackElementId: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => selectText(fallbackElementId));
  } else {
    selectText(fallbackElementId);
  }
}
```

3b. `Connect.tsx`: delete the local `selectText` helper (lines 46-56) and the inline clipboard branch in `CopyableCommand.handleCopy` (lines 71-77); import `{ copyText } from "../lib/copy.js"` and make `handleCopy = (): void => copyText(command, id);`. DOM/classes unchanged.

3c. `WorkerBanner.tsx`: add imports `{ copyText } from "../lib/copy.js"` and read `repoPath`:

```tsx
  const repoPath = useAppStore((s) => s.connection.repoPath);
```

Replace the second `<p>` with:

```tsx
      {repoPath !== "" ? (
        <p className="mt-1 flex items-center gap-2">
          <code
            id="worker-banner-cmd"
            className="font-mono bg-warn-50 border border-warn-400 px-1.5 py-0.5 rounded select-all"
          >
            {`cd ${repoPath} && uxfactory worker`}
          </code>
          <button
            type="button"
            aria-label="Copy worker command"
            onClick={() => copyText(`cd ${repoPath} && uxfactory worker`, "worker-banner-cmd")}
            className="text-warn-600 hover:text-warn-700 hover:underline shrink-0"
          >
            Copy
          </button>
        </p>
      ) : (
        <p className="opacity-75">
          Start a worker from this project's root (see the quick-start's worker section).
        </p>
      )}
```

Line 1, the render gate, `role="status"`, and the dismiss button stay byte-identical.

- [ ] **Step 4: Run the suites**

Run (from `packages/uxfactory-plugin`): `pnpm vitest run test/worker-banner.test.tsx test/screen-connect.test.tsx test/screen-artifacts.test.tsx test/screen-prompt.test.tsx`
Expected: all PASS (Connect's copy behavior is exercised by its existing screen tests)

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-plugin/ui/lib/copy.ts packages/uxfactory-plugin/ui/screens/Connect.tsx packages/uxfactory-plugin/ui/components/WorkerBanner.tsx packages/uxfactory-plugin/test/worker-banner.test.tsx
git commit -m "feat(panel): banner shows copyable 'uxfactory worker' command; extract copy helper"
```

---

### Task 7: Docs + full verification + live smoke

**Files:**
- Modify: `QUICK-START-TO-VIBE-FIGMA.md` ("The worker" section + cheat sheet)

- [ ] **Step 1: Rewrite the worker section.** In `QUICK-START-TO-VIBE-FIGMA.md`'s "The worker" section, replace the existing tsx command block AND the "planned verb" blockquote with the following content (each block below becomes a fenced `bash` block / prose paragraph / blockquote in the doc):

First command block:

    cd <your-project-root>          # the repo your panel is connected to
    uxfactory worker                # keep this running (assumes the global link from step 0)

Prose paragraph: "Or run the whole stack under one supervisor — bridge plus a worker for every project a panel connects:"

Second command block:

    uxfactory up                    # bridge on :3779 + auto worker per connected root

Prose paragraph: "`up` restarts crashed workers with backoff; a worker that fails setup (exit 2, e.g. missing `~/.agentx/auth.json`) is NOT restarted until you reconnect the project. Flags on both verbs: `--model`, `--kinds`, `--pool`, `--debug` (worker also takes `--root`, `--bridge`)."

Blockquote: "Without the global link, the raw form still works: `<engine>/clients/uxfactory-worker/node_modules/.bin/tsx <engine>/clients/uxfactory-worker/src/main.ts` from your project root — or point the verb at a checkout with `UXFACTORY_WORKER_ENTRY=<path-to-clients/uxfactory-worker>`."

Update the cheat-sheet rows: replace the `worker (tsx …)` row with `uxfactory worker` ("Serve Seed/Generate jobs for the cwd project root") and add `uxfactory up` ("Bridge + supervised worker per connected root"). Keep the paragraph about per-root claiming, the banner, and start-order — only the commands change.

- [ ] **Step 2: Full verification**

```bash
pnpm -r build && pnpm test
```
Expected: build green; suite green (1789+ passing; the pre-existing spec/plugin typecheck failures are known and out of scope — `pnpm typecheck` is NOT a gate here for that reason; run `pnpm --filter @uxfactory/cli typecheck && pnpm --filter @uxfactory/bridge typecheck` instead, both clean).

- [ ] **Step 3: Live smoke** (controller may run this — it manages the user's running stack):

```bash
# stop any existing bridge/worker first, then from the engine root:
node packages/uxfactory-cli/dist/src/cli.js up
# in another terminal:
curl -s -X POST http://127.0.0.1:3779/project/connect -H 'content-type: application/json' \
  -d '{"repoPath":"/Users/edwincruz/Development/Workspaces/jefelabs/uxfio-demo"}'
# expect: a "[worker uxfio-demo]" prefixed startup line; snapshot workers non-empty for BOTH roots
# kill the uxfio-demo worker child (pkill -f 'uxfactory-worker/src/main.ts' picks both; use the child pid)
# expect: "restarting in 1000ms" log; presence flaps and recovers
# Ctrl-C the up process: both children die, port frees
```

- [ ] **Step 4: Commit docs**

```bash
git add QUICK-START-TO-VIBE-FIGMA.md
git commit -m "docs: quick-start worker section — uxfactory worker / up verbs first"
```

---

## Self-review notes (kept for the implementer)

- **Spec coverage:** §1 resolution (T1), §2 worker verb (T2), §3 up + supervisor + onRootServed (T3-T5), §4 banner command + copy extraction (T6), §5 docs + changesets (T3/T5/T7), §6 edge cases (encoded in T2/T4/T5 tests: entry miss, non-root, EADDRINUSE, exit-2, backoff, dedup, signal teardown), §7 testing (each task).
- **Known anchors (from 2026-07-09 `main` @ 6e534fb), re-grep before editing:** `bridge` command block cli.ts:59-79; `resolveDataDir` cli.ts:42; BridgeOptions server.ts:21; projectPlugin `onRootServed` registration in server.ts; Connect.tsx helper lines 46-77; WorkerBanner.tsx (44 lines, `WorkerBannerProps` since 386a892).
- **`up` launch-root nuance:** `registry.init()` serves the launch root without firing `onRootServed` — that's why `upCmd` calls `supervisor.ensure(dirname(dataDir))` explicitly after the bridge starts.
- **cli.ts `foreground` flag:** both `bridge` and `up` set it so `run()` leaves the event loop alive; `worker` does NOT (its promise resolves only when the child exits, which IS the lifetime).

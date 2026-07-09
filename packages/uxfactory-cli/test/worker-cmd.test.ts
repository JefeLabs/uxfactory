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

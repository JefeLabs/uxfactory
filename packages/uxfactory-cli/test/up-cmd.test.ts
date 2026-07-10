import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
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

/** Fake child whose stdout is a real stream, so prefixStream's flush-on-end can be exercised. */
function fakeChildWithStdout(
  stdout: NodeJS.ReadableStream,
): EventEmitter & { kill: () => boolean; stdout: NodeJS.ReadableStream; stderr: null } {
  const child = new EventEmitter() as EventEmitter & {
    kill: () => boolean;
    stdout: NodeJS.ReadableStream;
    stderr: null;
  };
  child.kill = () => true;
  child.stdout = stdout;
  child.stderr = null;
  return child;
}

describe("upCmd", () => {
  it("wires job signals: enqueue spawns, settle+idle reaps; connect only tracks managed", async () => {
    const io = captureIO();
    const spawned: string[] = [];
    let hooks: {
      onRootServed?: (root: string) => void;
      onRequestEnqueued?: (root: string, kind: string) => void;
      onRequestSettled?: (root: string) => void;
      managedRoots?: () => { root: string; kinds?: string[] }[];
    } = {};
    const { code } = await upCmd(
      { dataDir: "/launch/.uxfactory", idleMinutes: 10 },
      io,
      {
        startBridge: async (opts) => {
          hooks = opts;
          return { url: "http://127.0.0.1:3779", close: async () => {} };
        },
        spawn: ((_b: string, _a: string[], o: { cwd?: string }) => {
          spawned.push(String(o.cwd));
          return fakeChild();
        }) as never,
        cliModuleUrl: CLI_URL,
        env: {},
        fileExists,
        onSignal: () => {},
      },
    );
    expect(code).toBe(0);
    expect(io.outs.join("\n")).toContain("http://127.0.0.1:3779");
    expect(spawned).toEqual([]); // NOTHING spawns at startup any more
    expect(hooks.managedRoots?.().map((m) => m.root)).toEqual([path.resolve("/launch")]); // launch root tracked

    hooks.onRootServed?.("/other");
    expect(spawned).toEqual([]); // connect does not spawn
    expect(hooks.managedRoots?.().map((m) => m.root)).toContain("/other");

    hooks.onRequestEnqueued?.("/other", "generate-artifact");
    expect(spawned).toEqual(["/other"]); // job spawns
  });

  it("--kinds flows into managedRoots entries", async () => {
    const io = captureIO();
    let hooks: { managedRoots?: () => { root: string; kinds?: string[] }[] } = {};
    await upCmd(
      { dataDir: "/launch/.uxfactory", idleMinutes: 10, kinds: "generate-artifact,validate" },
      io,
      {
        startBridge: async (opts) => {
          hooks = opts as never;
          return { url: "x", close: async () => {} };
        },
        spawn: (() => fakeChild()) as never,
        cliModuleUrl: CLI_URL,
        env: {},
        fileExists,
        onSignal: () => {},
      },
    );
    expect(hooks.managedRoots?.()[0]).toEqual({
      root: path.resolve("/launch"),
      kinds: ["generate-artifact", "validate"],
    });
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

  it("spawned workers receive the actual bridge URL, not the :3779 default", async () => {
    const io = captureIO();
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    let onRequestEnqueued: ((root: string, kind: string) => void) | undefined;
    const { code } = await upCmd(
      { dataDir: "/launch/.uxfactory" },
      io,
      {
        startBridge: async (opts) => {
          onRequestEnqueued = opts.onRequestEnqueued;
          return { url: "http://127.0.0.1:4000", close: async () => {} };
        },
        spawn: ((_bin: string, _args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
          capturedEnv = opts.env;
          return fakeChild();
        }) as never,
        cliModuleUrl: CLI_URL,
        env: {},
        fileExists,
        onSignal: () => {},
      },
    );
    expect(code).toBe(0);
    // Nothing spawns until a job lands (on-demand model) — enqueue one to
    // exercise the same spawn path this test cares about.
    onRequestEnqueued?.(path.resolve("/launch"), "generate-artifact");
    expect(capturedEnv?.["UXFACTORY_BRIDGE"]).toBe("http://127.0.0.1:4000");
  });

  it("prefixStream flushes a final unterminated line when the child stream ends", async () => {
    const io = captureIO();
    const stdout = new PassThrough();
    let onRequestEnqueued: ((root: string, kind: string) => void) | undefined;
    const { code } = await upCmd(
      { dataDir: "/launch/.uxfactory" },
      io,
      {
        startBridge: async (opts) => {
          onRequestEnqueued = opts.onRequestEnqueued;
          return { url: "http://127.0.0.1:3779", close: async () => {} };
        },
        spawn: (() => fakeChildWithStdout(stdout)) as never,
        cliModuleUrl: CLI_URL,
        env: {},
        fileExists,
        onSignal: () => {},
      },
    );
    expect(code).toBe(0);
    // Nothing spawns until a job lands (on-demand model) — enqueue one so the
    // child (and its stdout stream) actually exists to flush.
    onRequestEnqueued?.(path.resolve("/launch"), "generate-artifact");
    const ended = new Promise<void>((resolve) => stdout.once("end", () => resolve()));
    stdout.write("partial line");
    stdout.end();
    await ended;
    expect(io.errs.some((l) => l.endsWith("partial line"))).toBe(true);
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

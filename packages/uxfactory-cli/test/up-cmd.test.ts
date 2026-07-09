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

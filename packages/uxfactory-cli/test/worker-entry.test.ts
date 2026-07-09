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

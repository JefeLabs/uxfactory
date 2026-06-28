/**
 * Bin-wiring tests — prove the §5.3 exit-code contract at the run() layer.
 * run() returns a number (or "foreground"), never calls process.exit(), so all
 * calls are safe in-process.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "../src/cli.js";
import { EXIT } from "../src/exit.js";
import { matchingSpec } from "./helpers.js";

let dir: string;
let validSpec: string;
let invalidSpec: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uxf-cli-wiring-"));
  validSpec = path.join(dir, "valid.json");
  invalidSpec = path.join(dir, "invalid.json");
  await writeFile(validSpec, JSON.stringify(matchingSpec), "utf8");
  // Missing required "editor" field — fails schema validation
  await writeFile(invalidSpec, JSON.stringify({ frames: [{ name: "f" }] }), "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("bin wiring — exit code contract (§5.3)", () => {
  it("lint <valid spec> → 0", async () => {
    expect(await run(["node", "uxfactory", "lint", validSpec])).toBe(EXIT.OK);
  });

  it("lint <invalid spec> → 2", async () => {
    expect(await run(["node", "uxfactory", "lint", invalidSpec])).toBe(EXIT.TRANSPORT);
  });

  it("verify <valid spec> against unreachable bridge → 2 (transport)", async () => {
    const code = await run([
      "node",
      "uxfactory",
      "verify",
      validSpec,
      "--bridge",
      "http://127.0.0.1:1",
    ]);
    expect(code).toBe(EXIT.TRANSPORT);
  });

  it("unknown command → 2 (not 1)", async () => {
    expect(await run(["node", "uxfactory", "frobnicate"])).toBe(EXIT.TRANSPORT);
  });

  it("missing required arg (verify with no spec) → 2", async () => {
    expect(await run(["node", "uxfactory", "verify"])).toBe(EXIT.TRANSPORT);
  });

  it("--help → 0", async () => {
    expect(await run(["node", "uxfactory", "--help"])).toBe(EXIT.OK);
  });
});

/**
 * Bin-wiring tests — prove the §5.3 exit-code contract at the run() layer.
 * run() returns a number (or "foreground"), never calls process.exit(), so all
 * calls are safe in-process.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { run, entryUrlMatches } from "../src/cli.js";
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

describe("entryUrlMatches — bin-symlink entry-point detection", () => {
  it("resolves a bin symlink to the real module (the .bin/uxfactory case)", () => {
    const d = mkdtempSync(path.join(os.tmpdir(), "uxf-entry-"));
    try {
      const real = path.join(d, "cli.js");
      writeFileSync(real, "// real\n");
      const link = path.join(d, "uxfactory");
      symlinkSync(real, link);
      // Canonicalize via realpath so the test is robust when $TMPDIR is itself a
      // symlink (macOS /var → /private/var) — matching what entryUrlMatches does.
      const moduleUrl = pathToFileURL(realpathSync(real)).href;

      // Invoked via the symlink → matches (the realpath fix).
      expect(entryUrlMatches(link, moduleUrl)).toBe(true);
      // The naive compare (no realpath) does NOT match — this is the bug the live
      // e2e caught: run through .bin/uxfactory, the CLI was a silent no-op.
      expect(pathToFileURL(link).href === moduleUrl).toBe(false);
      // A direct (non-symlink) invocation still matches.
      expect(entryUrlMatches(real, moduleUrl)).toBe(true);
      // Unrelated / undefined argv[1] → no match (so import-in-tests never auto-runs).
      expect(entryUrlMatches(path.join(d, "other.js"), moduleUrl)).toBe(false);
      expect(entryUrlMatches(undefined, moduleUrl)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

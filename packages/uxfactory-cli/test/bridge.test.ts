import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bridgeCmd } from "../src/commands/bridge.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

describe("bridge", () => {
  it("starts a listening relay and returns a close handle (code 0)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-cli-"));
    const io = makeIO();
    const { code, close } = await bridgeCmd(
      { port: 0, dataDir: path.join(root, ".uxfactory") },
      io,
    );
    try {
      expect(code).toBe(EXIT.OK);
      const match = io.outText().match(/http:\/\/127\.0\.0\.1:\d+/);
      expect(match).not.toBeNull();
      const res = await fetch(`${match![0]}/health`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    } finally {
      await close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

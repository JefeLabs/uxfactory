import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { landDesign } from "../src/landing.js";

const mkProject = async (files: string[]): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uxf-landing-"));
  const dir = path.join(root, ".uxfactory/batch/designspec");
  await mkdir(dir, { recursive: true });
  for (const f of files) await writeFile(path.join(dir, f), JSON.stringify({ frames: [] }));
  return root;
};

describe("landDesign", () => {
  it("publishes each per-view spec and parses verify verdicts", async () => {
    const root = await mkProject(["design.designspec.json", "checkout-success.designspec.json", "cart-empty.designspec.json"]);
    const calls: string[][] = [];
    const res = await landDesign(root, "/bridge/.uxfactory", {
      exec: async (_cmd, args) => { calls.push(args); return { code: 0, stdout: '{"verified":true,"gate":"pass"}' }; },
    });
    expect(res!.published).toHaveLength(2);                       // combined file excluded
    expect(res!.verdicts.every((v) => v.verify === "pass")).toBe(true);
    expect(calls[0]).toContain("--verify");
    expect(calls[0]).toContain("--data-dir");
  });

  it("maps timeout/non-zero to pending and never throws", async () => {
    const root = await mkProject(["checkout-success.designspec.json"]);
    const res = await landDesign(root, "/b", { exec: async () => { throw new Error("timeout"); } });
    expect(res!.verdicts[0]!.verify).toBe("pending");
  });

  it("returns null when no designspec outputs exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-landing-empty-"));
    expect(await landDesign(root, "/b", { exec: async () => ({ code: 0, stdout: "" }) })).toBeNull();
  });
});

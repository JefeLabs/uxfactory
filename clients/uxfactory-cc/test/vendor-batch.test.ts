import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vendorSkill } from "../scripts/vendor-skill.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url)); // clients/uxfactory-cc/
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)); // repo root

describe("vendored batch skill", () => {
  it("byte-matches the canonical batch skill after vendoring", async () => {
    await vendorSkill();
    const canonical = await readFile(`${repoRoot}skill/batch/SKILL.md`);
    const vendored = await readFile(`${pkgRoot}skills/uxfactory-batch/SKILL.md`);
    expect(vendored.equals(canonical)).toBe(true);
  });

  it("still ships no .mcp.json", () => {
    expect(existsSync(`${pkgRoot}.mcp.json`)).toBe(false);
    expect(existsSync(`${pkgRoot}.claude-plugin/.mcp.json`)).toBe(false);
  });
});

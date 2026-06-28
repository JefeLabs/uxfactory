import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vendorSkill } from "../scripts/vendor-skill.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url)); // clients/uxfactory-cc/
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)); // repo root

describe("plugin manifest", () => {
  it("plugin.json has the required Claude Code plugin fields", async () => {
    const m = JSON.parse(await readFile(`${pkgRoot}.claude-plugin/plugin.json`, "utf8"));
    expect(m.name).toBe("uxfactory");
    expect(typeof m.version).toBe("string");
    expect(m.description).toBeTruthy();
    expect(m.author).toMatchObject({ name: "JefeLabs" });
    expect(m.license).toBe("MIT");
    expect(Array.isArray(m.keywords)).toBe(true);
  });

  it("marketplace.json lists the uxfactory plugin with a local source", async () => {
    const mk = JSON.parse(await readFile(`${pkgRoot}.claude-plugin/marketplace.json`, "utf8"));
    expect(mk.name).toBe("uxfactory");
    expect(mk.owner).toMatchObject({ name: "JefeLabs" });
    expect(Array.isArray(mk.plugins)).toBe(true);
    const entry = mk.plugins.find((p: { name: string }) => p.name === "uxfactory");
    expect(entry).toBeTruthy();
    expect(entry.source).toBe("./");
  });
});

describe("MCP-free", () => {
  it("ships no .mcp.json", () => {
    expect(existsSync(`${pkgRoot}.mcp.json`)).toBe(false);
    expect(existsSync(`${pkgRoot}.claude-plugin/.mcp.json`)).toBe(false);
  });
});

describe("vendored skill", () => {
  it("byte-matches the canonical skill after vendoring", async () => {
    await vendorSkill();
    const canonical = await readFile(`${repoRoot}skill/SKILL.md`);
    const vendored = await readFile(`${pkgRoot}skills/uxfactory/SKILL.md`);
    expect(vendored.equals(canonical)).toBe(true);
  });
});

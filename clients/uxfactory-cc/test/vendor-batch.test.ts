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

describe("batch skill content — four-dial scope loop", () => {
  let skill: string;

  // Read canonical skill once before all tests in this suite
  it("loads the canonical skill", async () => {
    skill = (await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8")) as string;
    expect(skill.length).toBeGreaterThan(100);
  });

  it("has frontmatter name: uxfactory-batch and a description", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    expect(content).toMatch(/^name:\s*uxfactory-batch/m);
    expect(content).toMatch(/^description:/m);
  });

  it("teaches the four dials: visual, editorial, coverage, flow", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    expect(content).toMatch(/\bvisual\b/);
    expect(content).toMatch(/\beditorial\b/);
    expect(content).toMatch(/\bcoverage\b/);
    expect(content).toMatch(/\bflow\b/);
  });

  it("teaches the three dial levels: low, medium, high", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    expect(content).toMatch(/\blow\b/);
    expect(content).toMatch(/\bmedium\b/);
    expect(content).toMatch(/\bhigh\b/);
  });

  it("documents at least one preset name", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    // At least one of the five presets must appear
    expect(content).toMatch(/wireframe|content|interactive|production/);
  });

  it("documents per-dial override flags", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    // Per-dial override flags --visual / --editorial / --coverage / --flow
    expect(content).toMatch(/--visual/);
    expect(content).toMatch(/--flow/);
  });

  it("documents readiness and generate-missing on exit 2", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    expect(content).toMatch(/missing/i);
    expect(content).toMatch(/generate/i);
  });

  it("documents per-dial gate binding (which gates bind on which dial)", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    // token-conformance binds on visual>=medium
    expect(content).toMatch(/token.conformance/i);
    // flow-reachability binds on flow>=medium
    expect(content).toMatch(/flow.reachability/i);
    // requirement-coverage binds on coverage>=low
    expect(content).toMatch(/requirement.coverage/i);
  });

  it("documents ratchet / dial promotion", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    expect(content).toMatch(/ratchet/i);
  });

  it("documents exit-code termination contract (0 / 1 / 2)", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    expect(content).toMatch(/exit.*0|`0`/i);
    expect(content).toMatch(/exit.*1|`1`/i);
    expect(content).toMatch(/exit.*2|`2`/i);
  });

  it("contains no agentcore references", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    expect(content).not.toMatch(/agentcore/i);
  });

  it("contains no runpod references", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    expect(content).not.toMatch(/runpod/i);
  });

  it("contains no standalone 'cloud' references", async () => {
    const content = await readFile(`${repoRoot}skill/batch/SKILL.md`, "utf8");
    expect(content).not.toMatch(/\bcloud\b/i);
  });
});

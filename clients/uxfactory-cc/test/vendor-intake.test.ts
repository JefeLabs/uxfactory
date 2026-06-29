import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vendorSkill } from "../scripts/vendor-skill.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url)); // clients/uxfactory-cc/
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)); // repo root

describe("vendored intake skill", () => {
  it("byte-matches the canonical intake skill after vendoring", async () => {
    await vendorSkill();
    const canonical = await readFile(`${repoRoot}skill/intake/SKILL.md`);
    const vendored = await readFile(`${pkgRoot}skills/uxfactory-intake/SKILL.md`);
    expect(vendored.equals(canonical)).toBe(true);
  });

  it("still ships no .mcp.json", () => {
    expect(existsSync(`${pkgRoot}.mcp.json`)).toBe(false);
    expect(existsSync(`${pkgRoot}.claude-plugin/.mcp.json`)).toBe(false);
  });
});

describe("intake skill content — Intake → Scoping → Confirm", () => {
  async function load(): Promise<string> {
    return readFile(`${repoRoot}skill/intake/SKILL.md`, "utf8");
  }

  it("has frontmatter name: uxfactory-intake and a description", async () => {
    const content = await load();
    expect(content).toMatch(/^name:\s*uxfactory-intake/m);
    expect(content).toMatch(/^description:/m);
  });

  it("names all eight enumerated dimensions (category, industry, age_demographic, style, visual, editorial, coverage, flow) plus flow_refs", async () => {
    const content = await load();
    expect(content).toMatch(/\bcategory\b/);
    expect(content).toMatch(/\bindustry\b/);
    expect(content).toMatch(/\bage_demographic\b/);
    expect(content).toMatch(/\bstyle\b/);
    expect(content).toMatch(/\bvisual\b/);
    expect(content).toMatch(/\beditorial\b/);
    expect(content).toMatch(/\bcoverage\b/);
    expect(content).toMatch(/\bflow\b/);
  });

  it("names the flow_refs dimension", async () => {
    const content = await load();
    expect(content).toMatch(/\bflow_refs\b/);
  });

  it("teaches the three phases: Intake, Scoping, Confirm", async () => {
    const content = await load();
    expect(content).toMatch(/\bIntake\b/);
    expect(content).toMatch(/\bScoping\b/);
    expect(content).toMatch(/\bConfirm\b/);
  });

  it("teaches assert-needed and provide-or-build prompting", async () => {
    const content = await load();
    // assert needed (REQUESTED) artifacts
    expect(content).toMatch(/requested/i);
    // prompt the user to provide or build
    expect(content).toMatch(/provide/i);
    expect(content).toMatch(/build/i);
  });

  it("documents uxfactory classify and --confirm", async () => {
    const content = await load();
    expect(content).toMatch(/uxfactory classify/);
    expect(content).toMatch(/--confirm/);
  });

  it("documents the compute-commit boundary: batch refuses a draft profile", async () => {
    const content = await load();
    // batch refuses a draft profile (the compute-commit boundary)
    expect(content).toMatch(/draft/i);
    expect(content).toMatch(/batch/i);
    // the boundary language — refuses or must be approved
    expect(content).toMatch(/refuses|not confirmed|compute.commit/i);
  });

  it("documents asymmetric friction (adding vs removing REQUESTED artifacts)", async () => {
    const content = await load();
    expect(content).toMatch(/asymmetric|derived_from/i);
  });

  it("documents provenance: derived_from on manifest entries", async () => {
    const content = await load();
    expect(content).toMatch(/derived_from/);
  });

  it("documents that conditioning is deterministic (no LLM)", async () => {
    const content = await load();
    expect(content).toMatch(/deterministic/i);
  });

  it("contains no agentcore references", async () => {
    const content = await load();
    expect(content).not.toMatch(/agentcore/i);
  });

  it("contains no runpod references", async () => {
    const content = await load();
    expect(content).not.toMatch(/runpod/i);
  });

  it("contains no standalone 'cloud' references", async () => {
    const content = await load();
    expect(content).not.toMatch(/\bcloud\b/i);
  });
});

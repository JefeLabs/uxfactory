import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vendorSkill } from "../scripts/vendor-skill.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url)); // clients/uxfactory-cc/
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)); // repo root

describe("vendored vision-review skill", () => {
  it("byte-matches the canonical vision-review skill after vendoring", async () => {
    await vendorSkill();
    const canonical = await readFile(`${repoRoot}skill/vision-review/SKILL.md`);
    const vendored = await readFile(`${pkgRoot}skills/uxfactory-vision-review/SKILL.md`);
    expect(vendored.equals(canonical)).toBe(true);
  });

  it("still ships no .mcp.json", () => {
    expect(existsSync(`${pkgRoot}.mcp.json`)).toBe(false);
    expect(existsSync(`${pkgRoot}.claude-plugin/.mcp.json`)).toBe(false);
  });
});

describe("vision-review skill content", () => {
  async function load(): Promise<string> {
    return readFile(`${repoRoot}skill/vision-review/SKILL.md`, "utf8");
  }

  it("has frontmatter name: uxfactory-vision-review and a description", async () => {
    const content = await load();
    expect(content).toMatch(/^name:\s*uxfactory-vision-review/m);
    expect(content).toMatch(/^description:/m);
  });

  it("teaches GET /canvas to fetch the pending canvas review request", async () => {
    const content = await load();
    expect(content).toMatch(/GET.*\/canvas|\/canvas.*GET/i);
  });

  it("teaches the vision step using the screenshot for semantic mapping", async () => {
    const content = await load();
    expect(content).toMatch(/screenshot/i);
    // must explicitly connect the screenshot to the vision/semantic mapping step
    expect(content).toMatch(/vision|semantic mapping/i);
  });

  it("teaches running uxfactory review --annotate for the deterministic baseline", async () => {
    const content = await load();
    expect(content).toMatch(/uxfactory review/);
    expect(content).toMatch(/--annotate/);
  });

  it("teaches posting the combined report so the plugin annotates the canvas", async () => {
    const content = await load();
    expect(content).toMatch(/POST.*\/review|\/review.*POST/i);
    expect(content).toMatch(/annotate/i);
  });

  it("states that the review is best-effort and explains reliability distinction", async () => {
    const content = await load();
    expect(content).toMatch(/best.effort/i);
    expect(content).toMatch(/reliability/i);
  });

  it("documents the terminal / Claude Code agent topology", async () => {
    const content = await load();
    expect(content).toMatch(/terminal|claude.code agent/i);
  });

  it("documents the backend agent worker topology", async () => {
    const content = await load();
    expect(content).toMatch(/backend.*worker|worker.*backend/i);
  });

  it("documents both topologies sharing the same bridge contract", async () => {
    const content = await load();
    // should mention both topologies and that the bridge relays both directions
    expect(content).toMatch(/topology/i);
    expect(content).toMatch(/bridge/i);
  });

  it("contains no agentcore references", async () => {
    const content = await load();
    expect(content).not.toMatch(/agentcore/i);
  });

  it("contains no runpod references", async () => {
    const content = await load();
    expect(content).not.toMatch(/runpod/i);
  });

  it("contains no standalone 'cloud' word", async () => {
    const content = await load();
    expect(content).not.toMatch(/\bcloud\b/i);
  });
});

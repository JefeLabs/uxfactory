import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const skillPath = fileURLToPath(new URL("../skill/batch/SKILL.md", import.meta.url));

describe("skill/batch/SKILL.md (the batch-loop skill)", () => {
  it("carries the triggering frontmatter and stays under 500 lines", async () => {
    const content = await readFile(skillPath, "utf8");
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fm, "must open with YAML frontmatter").not.toBeNull();
    const front = fm![1]!;
    expect(front).toMatch(/^name:\s*uxfactory-batch\s*$/m);
    expect(front).toMatch(/^description:\s*\S+/m);
    expect(content.split("\n").length).toBeLessThan(500);
  });

  it("documents the loop, the gates, skip-and-declare, exit-code termination, and the max-iterations stop", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain("## The loop");
    expect(content).toContain("## The gates");
    expect(content.toLowerCase()).toContain("skip-and-declare");
    expect(content).toContain("Exit codes");
    expect(content).toContain("`0`");
    expect(content).toContain("`1`");
    expect(content).toContain("`2`");
    expect(content).toContain("maxIterations");
    // the four gates named
    expect(content.toLowerCase()).toContain("token conformance");
    expect(content.toLowerCase()).toContain("coverage");
    expect(content.toLowerCase()).toContain("reuse");
    expect(content.toLowerCase()).toContain("reachability");
  });

  it("makes no external-project mentions", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).not.toMatch(/agentcore/i);
    expect(content).not.toMatch(/runpod/i);
    expect(content).not.toMatch(/uxfactory\.io/i);
    expect(content).not.toMatch(/\bcloud\b/i);
  });
});

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const skillPath = fileURLToPath(new URL("../skill/SKILL.md", import.meta.url));

describe("skill/SKILL.md (canonical agent skill)", () => {
  it("carries the triggering frontmatter and stays under 500 lines", async () => {
    const content = await readFile(skillPath, "utf8");
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fm, "must open with YAML frontmatter").not.toBeNull();
    const front = fm![1];
    expect(front).toMatch(/^name:\s*uxfactory\s*$/m);
    expect(front).toMatch(/^description:\s*\S+/m); // non-empty triggering description
    expect(content.split("\n").length).toBeLessThan(500);
  });

  it("documents the spec format, publish/verify loop, exit codes, and gotchas", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain("## The spec format");
    expect(content).toContain("## Surgical edits");
    expect(content).toContain("uxfactory selection");
    expect(content).toContain("## Publishing");
    expect(content).toContain("## Verifying");
    expect(content).toContain("Exit codes");
    expect(content).toContain("`0`");
    expect(content).toContain("`1`");
    expect(content).toContain("`2`");
    expect(content).toContain("## Gotchas worth internalizing");
  });

  it("references the schema at its real package path (no stale path)", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain("packages/uxfactory-spec/schema/uxfactory.schema.json");
    // The stale form is `uxfactory-spec/schema` NOT preceded by a slash
    // (the corrected `packages/uxfactory-spec/schema` always is).
    expect(content).not.toMatch(/(^|[^/])uxfactory-spec\/schema/);
  });
});

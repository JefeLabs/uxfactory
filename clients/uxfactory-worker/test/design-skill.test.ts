import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../skill/design/SKILL.md",
);

describe("skill/design SKILL.md — SP3c Step 4c extract for Figma landing", () => {
  it("documents Step 4c — Extract for Figma landing with the extract command and progress marker", async () => {
    const md = await readFile(SKILL, "utf8");
    expect(md, "SKILL.md must contain Step 4c heading").toContain("Step 4c");
    expect(md, "SKILL.md must contain the extract command").toContain("uxfactory extract --json design");
    expect(md, 'SKILL.md must contain the extract phase progress marker').toContain('"phase":"extract"');
  });
});

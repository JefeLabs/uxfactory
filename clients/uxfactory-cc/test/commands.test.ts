import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const cmdDir = fileURLToPath(new URL("../commands/", import.meta.url));

function split(src: string): { fm: string; body: string } | null {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return m ? { fm: m[1]!, body: m[2]! } : null;
}

const cases = [
  { file: "bridge.md", argHint: false, body: ["uxfactory bridge"] },
  { file: "publish.md", argHint: true, body: ["uxfactory publish", "$ARGUMENTS", "--wait"] },
  { file: "verify.md", argHint: true, body: ["uxfactory verify", "$ARGUMENTS"] },
  { file: "scan.md", argHint: false, body: ["uxfactory scan"] },
  { file: "status.md", argHint: false, body: ["/health", "uxfactory"] },
];

describe("slash commands", () => {
  for (const c of cases) {
    it(`${c.file} is a well-formed uxfactory command`, async () => {
      const parsed = split(await readFile(`${cmdDir}${c.file}`, "utf8"));
      expect(parsed, `${c.file} must have YAML frontmatter`).not.toBeNull();
      const { fm, body } = parsed!;
      expect(fm).toContain("allowed-tools: Bash(uxfactory:*)");
      expect(fm).toMatch(/description:\s*\S+/);
      if (c.argHint) expect(fm).toMatch(/argument-hint:\s*\S+/);
      for (const needle of c.body) expect(body).toContain(needle);
    });
  }
});

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTrace } from "../src/batch/trace.js";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../skill/design/SKILL.md");

describe("skill/design SKILL.md stays in sync with the engine", () => {
  it("its embedded trace.json example validates", async () => {
    const md = await readFile(SKILL, "utf8");
    const m = /<!-- trace-example-start -->\s*```json\s*([\s\S]*?)```\s*<!-- trace-example-end -->/.exec(md);
    expect(m, "SKILL.md must contain a marked trace.json example").not.toBeNull();
    const parsed = JSON.parse(m![1]!);
    expect(validateTrace(parsed).ok).toBe(true);
  });

  it("documents the four HTML gate ids and the progress marker", async () => {
    const md = await readFile(SKILL, "utf8");
    for (const id of ["render-coverage", "a11y", "contrast", "token-conformance", "UXF::PROGRESS", "window.uxfReady"]) {
      expect(md, `SKILL.md must mention ${id}`).toContain(id);
    }
  });

  it("carries the SP2 craft-quality authoring uplift", async () => {
    const md = await readFile(SKILL, "utf8");
    for (const s of ["type scale", "spacing", "elevation", "radi", "production-quality", "uxfactory.classification.json", ".uxfactory/batch/previews", "craft-report.json", ".uxfactory/craft-rubric.md"]) {
      expect(md, `SKILL.md must mention ${s}`).toContain(s);
    }
  });

  it("carries the SP3c Step 4c extract-for-Figma-landing step", async () => {
    const md = await readFile(SKILL, "utf8");
    expect(md, "SKILL.md must contain Step 4c heading").toContain("Step 4c");
    expect(md, "SKILL.md must document the extract command").toContain("uxfactory extract --json design");
    expect(md, 'SKILL.md must contain the extract phase progress marker').toContain('"phase":"extract"');
  });
});

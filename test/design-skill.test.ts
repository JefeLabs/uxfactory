import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const skillPath = fileURLToPath(new URL("../skill/design/SKILL.md", import.meta.url));

describe("skill/design/SKILL.md (the high-fidelity HTML-authoring + rendering gate-loop skill)", () => {
  it("carries the triggering frontmatter and stays under 500 lines", async () => {
    const content = await readFile(skillPath, "utf8");
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fm, "must open with YAML frontmatter").not.toBeNull();
    const front = fm![1]!;
    expect(front).toMatch(/^name:\s*uxfactory-design\s*$/m);
    expect(front).toMatch(/^description:\s*\S+/m);
    expect(content.split("\n").length).toBeLessThan(500);
  });

  it("documents the author -> gate -> read-report -> revise -> green loop", async () => {
    const content = await readFile(skillPath, "utf8");
    // the gate command + the report it reads + the green/exit-0 stop
    expect(content).toContain("uxfactory batch --json -- design");
    expect(content).toContain(".uxfactory/batch/report.json");
    expect(content).toContain("exit 0");
    expect(content).toContain("maxIterations");
    // the inputs it reads
    expect(content).toContain("design/acceptance-criteria.json");
    expect(content).toContain("uxfactory.profile.json");
    expect(content).toContain("uxfactory.batch.json");
    // it authors REAL HTML screens + a coverage manifest at the registered path convention
    expect(content).toContain("design/screens");
    expect(content).toContain(".html");
    expect(content).toContain("trace.json");
    // the must-checks it acts on (real gate ids over the rendering)
    expect(content).toContain("render-coverage");
    expect(content).toContain("token-conformance");
    expect(content).toContain("a11y");
    expect(content).toContain("contrast");
    // impliedState view-states the screens must cover
    for (const kw of ["empty", "loading", "error", "success", "edge"]) {
      expect(content).toContain(kw);
    }
    // tokens authored only at visual >= medium
    expect(content).toContain("tokens.ds.json");
    expect(content).toContain("visual");
    // the async-settle hook for loading (async) view-states
    expect(content).toContain("window.uxfReady");
  });

  it("is cc-invariant: no external cloud-deploy mentions", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).not.toMatch(/agentcore/i);
    expect(content).not.toMatch(/runpod/i);
    expect(content).not.toMatch(/\bcloud\b/i);
    expect(content).not.toMatch(/uxfactory\.io/i);
  });
});

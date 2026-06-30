import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildPlugin } from "../scripts/build-plugin.mjs";

// Build into a UNIQUE temp out-dir (not the shared `dist/`) so this test is
// deterministic under parallel Vitest workers — nothing else can read/write the
// bundles mid-build and the assertions see exactly this build's output.
describe("built bundles", () => {
  let outDir: string;
  let code: string;
  let html: string;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), "uxf-plugin-build-"));
    await buildPlugin(outDir);
    code = await readFile(path.join(outDir, "code.js"), "utf8");
    html = await readFile(path.join(outDir, "ui.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("bundles code.ts and inlines the ui.ts bundle into ui.html", () => {
    expect(code).toContain("showUI"); // main thread bundled
    expect(html).toContain("http://localhost:3779"); // ui.ts bundle (BRIDGE const) inlined
    expect(html).toContain("<script>");
    expect(html).not.toContain("<script src="); // inlining guarantee: no external script src
  });

  it("inlines the pipeline panel: the container + the rendered panel strings are present", () => {
    // The panel container is in the HTML template…
    expect(html).toContain('id="pipeline"');
    // …and the inlined ui.ts bundle carries the pipeline-view render strings
    // (intake header + the verbatim chip enums), proving the panel modules were
    // bundled into the iframe UI rather than dropped by tree-shaking.
    expect(html).toContain("Define your project");
    expect(html).toContain("generate-artifact");
    for (const v of ["user-story", "acceptance-criteria", "user-journey"]) {
      expect(html).toContain(v);
    }
  });
});

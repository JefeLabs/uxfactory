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
  }, 60_000);

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("bundles code.ts into a non-empty code.js and vite builds a ui.html with React root", () => {
    expect(code).toContain("showUI"); // main thread bundled
    expect(code.length).toBeGreaterThan(0);
    expect(html).toContain('id="root"'); // React mount point present
    expect(html).toContain("<script>"); // singlefile inlined the React bundle
  });

  it("ui.html is fully self-contained with no external resource references", () => {
    // vite-plugin-singlefile must have inlined all assets — no http URLs allowed
    expect(html).not.toContain('src="http'); // no external script src
    expect(html).not.toContain('href="http'); // no external link href
    expect(html).not.toContain("url(http"); // no external CSS url() references
  });
});

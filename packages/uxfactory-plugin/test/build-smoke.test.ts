import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPlugin } from "../scripts/build-plugin.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

describe("built bundles", () => {
  it("bundles code.ts and inlines the ui.ts bundle into ui.html", async () => {
    await buildPlugin();
    const code = await readFile(`${pkgRoot}dist/code.js`, "utf8");
    const html = await readFile(`${pkgRoot}dist/ui.html`, "utf8");
    expect(code).toContain("showUI"); // main thread bundled
    expect(html).toContain("http://localhost:3779"); // ui.ts bundle (BRIDGE const) inlined
    expect(html).toContain("<script>");
  });
});

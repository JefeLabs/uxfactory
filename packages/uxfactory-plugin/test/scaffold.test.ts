import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPlugin } from "../scripts/build-plugin.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

describe("manifest", () => {
  it("declares a truthful, localhost-only manifest", async () => {
    const manifest = JSON.parse(await readFile(`${pkgRoot}manifest.json`, "utf8"));
    expect(manifest.api).toBe("1.0.0");
    expect(manifest.main).toBe("dist/code.js");
    expect(manifest.ui).toBe("dist/ui.html");
    expect(manifest.editorType).toEqual(["figma", "figjam"]);
    expect(manifest.networkAccess).toEqual({ allowedDomains: ["http://localhost:3779"] });
  });
});

describe("build", () => {
  it("emits a non-empty dist/code.js and a dist/ui.html that inlines the UI bundle", async () => {
    await buildPlugin();
    const code = await readFile(`${pkgRoot}dist/code.js`, "utf8");
    const html = await readFile(`${pkgRoot}dist/ui.html`, "utf8");
    expect(code.length).toBeGreaterThan(0);
    expect(html).toContain("<script>");
    expect(html).not.toContain("/*__UI_BUNDLE__*/"); // placeholder was replaced
  });
});

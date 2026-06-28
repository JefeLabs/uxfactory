import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

// Resolve workspace deps to their TypeScript source so the bundle is
// self-contained — no prior `tsc` build of spec/gate is required.
const alias = {
  "@uxfactory/spec": path.join(root, "..", "uxfactory-spec", "src", "index.ts"),
  "@uxfactory/gate": path.join(root, "..", "uxfactory-gate", "src", "index.ts"),
};

const common = {
  bundle: true,
  format: "iife",
  target: "es2017",
  platform: "browser",
  alias,
};

export async function buildPlugin() {
  await mkdir(dist, { recursive: true });

  // 1. main thread → dist/code.js
  await build({ ...common, entryPoints: [path.join(root, "src/code.ts")], outfile: path.join(dist, "code.js") });

  // 2. iframe UI → bundled JS string, inlined into ui.html
  const uiResult = await build({ ...common, entryPoints: [path.join(root, "src/ui.ts")], write: false });
  const uiJs = uiResult.outputFiles[0].text;
  const template = await readFile(path.join(root, "src/ui.html"), "utf8");
  // Function replacement avoids `$`-pattern expansion in the bundled JS.
  const html = template.replace("/*__UI_BUNDLE__*/", () => uiJs);
  await writeFile(path.join(dist, "ui.html"), html, "utf8");

  console.log("plugin build complete: dist/code.js, dist/ui.html");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildPlugin().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

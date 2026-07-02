import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rename } from "node:fs/promises";

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

/**
 * Build the plugin's two bundles into `outDir` (default `dist`). The out-dir is
 * a parameter so the build-smoke test can build into a UNIQUE temp dir — without
 * it, parallel Vitest workers would race on the shared `dist/` (one writing
 * code.js/ui.html while another reads them), making the smoke test flaky.
 */
export async function buildPlugin(outDir = dist) {
  await mkdir(outDir, { recursive: true });

  // 1. main thread → <outDir>/code.js
  await build({
    ...common,
    entryPoints: [path.join(root, "src/code.ts")],
    outfile: path.join(outDir, "code.js"),
  });

  // 2. React panel UI → fully inlined ui.html (via vite + vite-plugin-singlefile)
  //    vite emits dist/index.html; we rename it to <outDir>/ui.html.
  const { build: viteBuild } = await import("vite");
  await viteBuild({
    configFile: path.join(root, "vite.config.ts"),
    // Override outDir so smoke-test temp-dir builds don't touch the shared dist/.
    build: {
      outDir,
      emptyOutDir: false, // preserve code.js already written above
    },
    // Suppress vite's stdout chatter during automated builds.
    logLevel: "warn",
  });
  // Vite's rollup entry produces index.html; rename to the manifest's expected name.
  await rename(path.join(outDir, "index.html"), path.join(outDir, "ui.html"));

  console.log(
    `plugin build complete: ${path.join(outDir, "code.js")}, ${path.join(outDir, "ui.html")}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildPlugin().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

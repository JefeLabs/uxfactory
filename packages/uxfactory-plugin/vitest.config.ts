import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Package-scoped Vitest config so `pnpm --filter @uxfactory/plugin test`
// runs the plugin suite (src + test) in isolation. Mirrors the root config's
// workspace aliases (the only @uxfactory deps the plugin imports) and the
// default node environment; per-file `// @vitest-environment jsdom` markers
// still take precedence where a DOM is needed.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@uxfactory/spec": fileURLToPath(
        new URL("../uxfactory-spec/src/index.ts", import.meta.url),
      ),
      "@uxfactory/gate": fileURLToPath(
        new URL("../uxfactory-gate/src/index.ts", import.meta.url),
      ),
      // The pipeline e2e (src/pipeline-e2e.test.ts) stands up an in-process
      // bridge via startBridge; alias it to source like the root config does.
      "@uxfactory/bridge": fileURLToPath(
        new URL("../uxfactory-bridge/src/index.ts", import.meta.url),
      ),
    },
  },
});

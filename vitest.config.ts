import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  test: {
    include: [
      "test/**/*.test.ts",
      "packages/**/test/**/*.test.ts",
      // Co-located package src suites (the pipeline panel's Task 2–5 modules +
      // the Task 6 e2e live next to their sources) must run under root too.
      "packages/**/src/**/*.test.ts",
      "clients/**/test/**/*.test.ts",
    ],
    environment: "node",
    env: {
      UXFACTORY_REPOS_REGISTRY: path.join(os.tmpdir(), "uxfactory-test-repos.json"),
    },
  },
  resolve: {
    alias: {
      "@uxfactory/spec": fileURLToPath(
        new URL("./packages/uxfactory-spec/src/index.ts", import.meta.url),
      ),
      "@uxfactory/gate": fileURLToPath(
        new URL("./packages/uxfactory-gate/src/index.ts", import.meta.url),
      ),
      "@uxfactory/bridge": fileURLToPath(
        new URL("./packages/uxfactory-bridge/src/index.ts", import.meta.url),
      ),
    },
  },
});

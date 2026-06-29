import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "packages/**/test/**/*.test.ts", "clients/**/test/**/*.test.ts"],
    environment: "node",
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

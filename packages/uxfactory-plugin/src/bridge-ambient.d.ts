// Ambient typing for `@uxfactory/bridge`, used ONLY by `src/pipeline-e2e.test.ts`
// to stand up an in-process bridge. The bridge is a node-only package whose
// source (fastify, node http) cannot be compiled under the plugin's DOM-flavored
// typecheck tsconfig, and it is not a plugin dependency — so rather than map its
// source into the program we declare just the `startBridge` surface the e2e
// drives. At RUNTIME the import is resolved by Vitest's `@uxfactory/bridge` alias
// (present in both the root and the plugin vitest configs).
//
// This file is intentionally a SCRIPT (no top-level import/export) so the
// `declare module` is a genuine ambient declaration, not a module augmentation.
declare module "@uxfactory/bridge" {
  export function startBridge(options?: {
    dataDir?: string;
    port?: number;
    editTimeoutMs?: number;
  }): Promise<{ url: string; close: () => Promise<void> }>;
}

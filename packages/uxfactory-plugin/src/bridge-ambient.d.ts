// Ambient typing for `@uxfactory/bridge`, used ONLY by `src/pipeline-e2e.test.ts`
// (startBridge) and `test/bridge-contract.test.ts` (createBridge). The bridge is
// a node-only package whose source (fastify, node http) cannot be compiled under
// the plugin's DOM-flavored typecheck tsconfig, and it is not a plugin
// dependency — so rather than map its source into the program we declare just
// the surface those tests drive. At RUNTIME the import is resolved by Vitest's
// `@uxfactory/bridge` alias (present in both the root and the plugin vitest
// configs).
//
// This file is intentionally a SCRIPT (no top-level import/export) so the
// `declare module` is a genuine ambient declaration, not a module augmentation.
declare module "@uxfactory/bridge" {
  /**
   * Minimal inject-capable slice of the FastifyInstance that `createBridge`
   * actually returns — just what the contract test needs to drive requests
   * in-process without listening on a port.
   */
  export interface BridgeServer {
    inject(options: {
      method: string;
      url: string;
      payload?: unknown;
      headers?: Record<string, string>;
    }): Promise<{ statusCode: number; body: string }>;
    close(): Promise<void>;
  }

  export function createBridge(options?: {
    dataDir?: string;
    editTimeoutMs?: number;
  }): Promise<BridgeServer>;

  export function startBridge(options?: {
    dataDir?: string;
    port?: number;
    editTimeoutMs?: number;
  }): Promise<{ url: string; close: () => Promise<void> }>;
}

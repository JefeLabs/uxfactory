import { startBridge } from "@uxfactory/bridge";
import { EXIT } from "../exit.js";
import type { IO } from "../io.js";

/**
 * `uxfactory bridge` — start the localhost relay in the foreground. Returns the
 * exit code and a `close` handle; the action itself NEVER closes (the bin keeps the
 * relay open). Tests call the returned `close`.
 */
export async function bridgeCmd(
  flags: { port?: number; dataDir?: string },
  io: IO,
): Promise<{ code: number; close: () => Promise<void> }> {
  const handle = await startBridge({
    ...(flags.port !== undefined ? { port: flags.port } : {}),
    ...(flags.dataDir !== undefined ? { dataDir: flags.dataDir } : {}),
  });
  io.out(`uxfactory bridge listening on ${handle.url}`);
  return { code: EXIT.OK, close: handle.close };
}

import { EXIT } from "../exit.js";
import { loadSpec, printSpecProblem } from "../spec-file.js";
import type { IO } from "../io.js";

/** `uxfactory lint <spec>` — validate a spec against the schema. No bridge needed. */
export async function lintCmd(file: string, flags: { json?: boolean }, io: IO): Promise<number> {
  const loaded = await loadSpec(file);
  if (loaded.ok) {
    io.out(flags.json ? JSON.stringify({ valid: true }) : "OK");
    return EXIT.OK;
  }
  return printSpecProblem(io, loaded, flags.json);
}

import { EXIT, TransportError } from "../exit.js";
import type { IO } from "../io.js";
import type { BridgeClient } from "../client.js";

/** `uxfactory selection` — read the current Figma selection via GET /selection. */
export async function selectionCmd(
  flags: { json?: boolean },
  io: IO,
  client: BridgeClient,
): Promise<number> {
  try {
    const selection = await client.getSelection();
    if (selection === null) {
      io.out(flags.json ? "null" : "no selection");
      return EXIT.OK;
    }
    io.out(flags.json ? JSON.stringify(selection) : formatSelection(selection));
    return EXIT.OK;
  } catch (err) {
    if (err instanceof TransportError) {
      io.err(err.message);
      return EXIT.TRANSPORT;
    }
    throw err;
  }
}

/** Pretty-print a selection: one `id  type  name` line per node, else raw JSON. */
function formatSelection(selection: unknown): string {
  const s = selection as { nodes?: Array<{ id?: string; name?: string; type?: string }> };
  if (Array.isArray(s.nodes)) {
    if (s.nodes.length === 0) return "no selection";
    return s.nodes
      .map((n) => `${n.id ?? "?"}  ${n.type ?? "?"}  ${n.name ?? ""}`.trimEnd())
      .join("\n");
  }
  return JSON.stringify(selection, null, 2);
}

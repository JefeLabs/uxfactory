import { EXIT } from "../exit.js";
import type { IO } from "../io.js";

/** A not-yet-implemented command: report the phase it lands in and exit 2 (transport/setup). */
export function stubCmd(name: string, phase: string, io: IO): number {
  io.err(`${name}: not yet implemented (Phase ${phase})`);
  return EXIT.TRANSPORT;
}

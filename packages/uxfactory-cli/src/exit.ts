/** Process exit codes — the CI contract (PRD §5.3). */
export const EXIT = {
  /** Success / gate PASS. */
  OK: 0,
  /** Gate FAIL — the rendered canvas did not match the spec. */
  GATE_FAIL: 1,
  /** Transport/setup error: bridge unreachable, plugin not connected, timeout, malformed/invalid spec. */
  TRANSPORT: 2,
} as const;

/** Thrown by BridgeClient on any network failure or non-JSON response. */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}

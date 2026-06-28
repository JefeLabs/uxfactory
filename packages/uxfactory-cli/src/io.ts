/** Output sink injected into command actions so tests can capture stdout/stderr. */
export interface IO {
  out(s: string): void;
  err(s: string): void;
}

/** The default IO, writing to the real console (used by the bin; tests inject a capture). */
export const consoleIO: IO = {
  out(s: string): void {
    console.log(s);
  },
  err(s: string): void {
    console.error(s);
  },
};

import { describe, it, expect } from "vitest";
import { stubCmd } from "../src/commands/stub.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

describe("stub", () => {
  it("reports the target phase on stderr and returns 2", () => {
    const io = makeIO();
    expect(stubCmd("map", "4", io)).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toBe("map: not yet implemented (Phase 4)");
  });

  it("formats the roadmap phase verbatim", () => {
    const io = makeIO();
    expect(stubCmd("snapshot", "roadmap", io)).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toBe("snapshot: not yet implemented (Phase roadmap)");
  });
});

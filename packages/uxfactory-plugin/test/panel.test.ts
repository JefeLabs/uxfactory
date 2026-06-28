import { describe, it, expect } from "vitest";
import { nextPanel } from "../src/panel.js";

describe("nextPanel", () => {
  it("toggles COMPACT ↔ EXPANDED on toggle-details with correct dimensions", () => {
    expect(nextPanel("COMPACT", "toggle-details")).toEqual({
      state: "EXPANDED",
      width: 540,
      height: 560,
    });
    expect(nextPanel("EXPANDED", "toggle-details")).toEqual({
      state: "COMPACT",
      width: 540,
      height: 220,
    });
  });

  it("auto-engages CONNECTED_MIN on connect from any state", () => {
    expect(nextPanel("COMPACT", "connect")).toEqual({
      state: "CONNECTED_MIN",
      width: 156,
      height: 72,
    });
    expect(nextPanel("EXPANDED", "connect")).toEqual({
      state: "CONNECTED_MIN",
      width: 156,
      height: 72,
    });
  });

  it("expands CONNECTED_MIN → COMPACT on expand-click (stays connected)", () => {
    expect(nextPanel("CONNECTED_MIN", "expand-click")).toEqual({
      state: "COMPACT",
      width: 540,
      height: 220,
    });
  });

  it("returns to COMPACT on disconnect from any state", () => {
    expect(nextPanel("CONNECTED_MIN", "disconnect")).toEqual({
      state: "COMPACT",
      width: 540,
      height: 220,
    });
    expect(nextPanel("EXPANDED", "disconnect")).toEqual({
      state: "COMPACT",
      width: 540,
      height: 220,
    });
  });

  it("ignores irrelevant events (no-op transitions)", () => {
    expect(nextPanel("CONNECTED_MIN", "toggle-details").state).toBe("CONNECTED_MIN");
    expect(nextPanel("COMPACT", "expand-click").state).toBe("COMPACT");
  });
});

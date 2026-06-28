import { describe, it, expect } from "vitest";
import { validate, isSpec } from "../src/validate.js";
import { cases } from "./cases.js";

describe("validate (node)", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(validate(c.input).valid).toBe(c.valid);
    });
  }

  it("reports the offending property for an unknown edit key", () => {
    const result = validate({ edits: [{ id: "1", set: { color: "#fff" } }] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("color"))).toBe(true);
  });

  it("returns no errors for a valid spec", () => {
    const result = validate({ edits: [{ id: "1", set: { x: 1 } }] });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("isSpec narrows valid input", () => {
    expect(isSpec({ edits: [{ id: "1", set: { x: 1 } }] })).toBe(true);
    expect(isSpec({})).toBe(false);
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { validate } from "../src/validate.js";
import { cases } from "./cases.js";

describe("validate (jsdom / browser parity)", () => {
  it("runs in a DOM environment", () => {
    expect(typeof window).toBe("object");
  });

  for (const c of cases) {
    it(`${c.name} — identical verdict to node`, () => {
      expect(validate(c.input).valid).toBe(c.valid);
    });
  }
});

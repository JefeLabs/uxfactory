import { describe, it, expect } from "vitest";
import { planEdit, captureInverse } from "../src/edits.js";

describe("planEdit", () => {
  it("applies only the listed props when the target is present", () => {
    expect(planEdit({ id: "1:2", set: { x: 120, fill: "#43a047" } }, true)).toEqual({
      apply: true,
      props: { x: 120, fill: "#43a047" },
    });
  });

  it("is a no-op when the target is missing", () => {
    expect(planEdit({ name: "ghost", set: { x: 1 } }, false)).toEqual({ apply: false, props: {} });
  });
});

describe("captureInverse", () => {
  it("targets by id and captures only the before-values of the changed props", () => {
    const inverse = captureInverse(
      { id: "9:9", name: "renamed-by-forward-edit", set: { x: 120, fill: "#43a047" } },
      { x: 10, fill: "#000000", y: 999 },
    );
    expect(inverse).toEqual({ id: "9:9", set: { x: 10, fill: "#000000" } });
    expect(inverse.name).toBeUndefined();
    expect(Object.keys(inverse.set)).toEqual(["x", "fill"]); // not y
  });
});

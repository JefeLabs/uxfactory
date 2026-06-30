import { describe, it, expect } from "vitest";
import { validateTrace } from "../src/batch/trace.js";

const VALID = {
  version: 1,
  pages: [
    {
      file: "screens/checkout.html",
      views: [
        { id: "success", activate: { hash: "view=success" },
          covers: [{ story: "checkout", impliedState: "success", selector: "[data-ac='ok']" }] },
        { id: "error", activate: { click: ["#pay"] },
          covers: [{ story: "checkout", impliedState: "error", selector: "#err" }] },
      ],
    },
  ],
};

describe("validateTrace", () => {
  it("accepts a valid two-level manifest", () => {
    const r = validateTrace(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trace.pages[0]!.views[1]!.id).toBe("error");
  });

  it("rejects a non-1 version", () => {
    const r = validateTrace({ ...VALID, version: 2 });
    expect(r).toEqual({ ok: false, message: "trace version must be 1" });
  });

  it("rejects a page missing file", () => {
    const r = validateTrace({ version: 1, pages: [{ views: VALID.pages[0]!.views }] });
    expect(r.ok).toBe(false);
  });

  it("rejects a bad impliedState", () => {
    const bad = structuredClone(VALID);
    (bad.pages[0]!.views[0]!.covers[0] as { impliedState: string }).impliedState = "nope";
    const r = validateTrace(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects a view with no covers", () => {
    const bad = structuredClone(VALID);
    bad.pages[0]!.views[0]!.covers = [];
    expect(validateTrace(bad).ok).toBe(false);
  });

  it("accepts and preserves an optional viewports array (reserved, unused)", () => {
    const r = validateTrace({ ...VALID, pages: [{ ...VALID.pages[0], viewports: ["mobile"] }] });
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown activation form", () => {
    const bad = structuredClone(VALID);
    (bad.pages[0]!.views[0]!.activate as Record<string, unknown>) = { scroll: 10 };
    expect(validateTrace(bad).ok).toBe(false);
  });
});

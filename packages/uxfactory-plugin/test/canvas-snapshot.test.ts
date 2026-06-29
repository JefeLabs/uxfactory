import { describe, it, expect } from "vitest";
import { snapshotNode } from "../src/canvas-snapshot.js";
import type { FrameLike } from "../src/canvas-snapshot.js";
import { validate } from "@uxfactory/spec";

describe("snapshotNode — pure serializer", () => {
  it("emits source:'canvas-inferred' marker", () => {
    const frame: FrameLike = { name: "F", x: 0, y: 0, width: 100, height: 100 };
    const snap = snapshotNode(frame);
    expect(snap.source).toBe("canvas-inferred");
  });

  it("maps a frame with shape/text/instance children correctly", () => {
    const frame: FrameLike = {
      name: "Screen",
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      children: [
        { name: "bg", type: "RECTANGLE", x: 0, y: 0, width: 800, height: 600 },
        { name: "label", type: "TEXT", x: 10, y: 10, width: 200, height: 40, characters: "Hello" },
        { name: "icon", type: "INSTANCE", x: 50, y: 50, width: 40, height: 40 },
        { name: "comp", type: "COMPONENT", x: 100, y: 50, width: 40, height: 40 },
        { name: "unknown", type: "ELLIPSE", x: 200, y: 50, width: 40, height: 40 },
      ],
    };
    const snap = snapshotNode(frame, "Page 1");
    expect(snap.page).toBe("Page 1");
    expect(snap.frames).toHaveLength(1);
    const f = snap.frames[0]!;
    expect(f.name).toBe("Screen");
    expect(f.x).toBe(10);
    expect(f.y).toBe(20);
    expect(f.width).toBe(800);
    expect(f.height).toBe(600);
    expect(f.children).toHaveLength(5);

    const bg = f.children.find((c) => c.name === "bg")!;
    expect(bg.type).toBe("shape");

    const label = f.children.find((c) => c.name === "label")!;
    expect(label.type).toBe("text");
    expect(label.characters).toBe("Hello");

    const icon = f.children.find((c) => c.name === "icon")!;
    // Fix I2: INSTANCE maps to "shape" (not "instance") so no asset key is required.
    expect(icon.type).toBe("shape");

    const comp = f.children.find((c) => c.name === "comp")!;
    // Fix I2: COMPONENT also maps to "shape".
    expect(comp.type).toBe("shape");

    const unknown = f.children.find((c) => c.name === "unknown")!;
    expect(unknown.type).toBe("shape"); // default
  });

  it("handles a frame with no children", () => {
    const frame: FrameLike = { name: "Empty", x: 0, y: 0, width: 100, height: 100 };
    const snap = snapshotNode(frame);
    expect(snap.frames[0]!.children).toHaveLength(0);
  });

  it("does not set page when not provided", () => {
    const frame: FrameLike = { name: "F", x: 0, y: 0, width: 100, height: 100 };
    const snap = snapshotNode(frame);
    expect(snap.page).toBeUndefined();
  });

  it("does not include characters on shape nodes with undefined characters", () => {
    const frame: FrameLike = {
      name: "F",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [{ name: "box", type: "RECTANGLE", x: 0, y: 0, width: 50, height: 50 }],
    };
    const snap = snapshotNode(frame);
    expect(snap.frames[0]!.children[0]!.characters).toBeUndefined();
  });

  it("maps FRAME type to 'shape'", () => {
    const frame: FrameLike = {
      name: "F",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [{ name: "inner", type: "FRAME", x: 0, y: 0, width: 50, height: 50 }],
    };
    const snap = snapshotNode(frame);
    expect(snap.frames[0]!.children[0]!.type).toBe("shape");
  });

  it("always emits characters (default '') on a TEXT child with no characters (Fix I2)", () => {
    // textNode schema requires `characters` — Fix I2 ensures it is always emitted.
    const frame: FrameLike = {
      name: "F",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [{ name: "txt", type: "TEXT", x: 0, y: 0, width: 50, height: 20 }],
    };
    const snap = snapshotNode(frame);
    // characters must be "" (not undefined) so the spec validates successfully.
    expect(snap.frames[0]!.children[0]!.characters).toBe("");
  });

  it("maps a node with no type to 'shape'", () => {
    const frame: FrameLike = {
      name: "F",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [{ name: "notype", x: 0, y: 0, width: 50, height: 50 }],
    };
    const snap = snapshotNode(frame);
    expect(snap.frames[0]!.children[0]!.type).toBe("shape");
  });

  it("preserves geometry on the snapshot frame and child", () => {
    const frame: FrameLike = {
      name: "Geo",
      x: 100,
      y: 200,
      width: 400,
      height: 300,
      children: [{ name: "child", type: "RECTANGLE", x: 10, y: 20, width: 80, height: 60 }],
    };
    const snap = snapshotNode(frame);
    const f = snap.frames[0]!;
    expect(f).toMatchObject({ x: 100, y: 200, width: 400, height: 300 });
    expect(f.children[0]).toMatchObject({ x: 10, y: 20, width: 80, height: 60 });
  });
});

// ---------------------------------------------------------------------------
// Fix I2 — validate() passes after stripping source
// ---------------------------------------------------------------------------

describe("Fix I2 — snapshot with INSTANCE + TEXT (no characters) passes validate()", () => {
  it("strips source and validates successfully when children include INSTANCE + TEXT", () => {
    const frame: FrameLike = {
      name: "CheckoutScreen",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        // INSTANCE node — used to fail because mapType returned "instance" (needs asset).
        { name: "CartButton", type: "INSTANCE", x: 10, y: 100, width: 200, height: 44 },
        // TEXT node with NO characters — used to fail because textNode requires characters.
        { name: "PriceLabel", type: "TEXT", x: 10, y: 60, width: 100, height: 20 },
        // TEXT node WITH characters — should still pass.
        {
          name: "Title",
          type: "TEXT",
          x: 10,
          y: 20,
          width: 300,
          height: 40,
          characters: "Checkout",
        },
      ],
    };

    const snap = snapshotNode(frame);

    // Fix I2 assertions — the mapping must be correct before validate().
    const cartButton = snap.frames[0]!.children.find((c) => c.name === "CartButton")!;
    expect(cartButton.type).toBe("shape"); // not "instance"

    const priceLabel = snap.frames[0]!.children.find((c) => c.name === "PriceLabel")!;
    expect(priceLabel.type).toBe("text");
    expect(priceLabel.characters).toBe(""); // default "" — not undefined

    // Strip the source marker (review.ts does the same before validate()).
    const { source: _source, ...specBody } = snap as unknown as Record<string, unknown>;
    void _source;

    // The stripped spec body MUST pass validate().
    const result = validate(specBody);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      // Log errors for debugging if the test fails.
      console.error("validate errors:", result.errors);
    }
  });

  it("INSTANCE + TEXT snapshot passes validate after strip — same as review.ts path", () => {
    // Simulates the exact path in review.ts: detect source → strip → validate.
    const frame: FrameLike = {
      name: "Frame",
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      children: [
        { name: "NavBar", type: "INSTANCE", x: 0, y: 0, width: 390, height: 56 },
        { name: "EmptyLabel", type: "TEXT", x: 16, y: 100, width: 200, height: 24 },
      ],
    };
    const snap = snapshotNode(frame, "Page 1");

    // Confirm source marker is present (review.ts detects on this).
    expect(snap.source).toBe("canvas-inferred");

    // Strip and validate — mimics review.ts lines 130-143.
    const { source: _src, ...body } = snap as unknown as Record<string, unknown>;
    void _src;
    const result = validate(body);
    expect(result.valid).toBe(true);
  });
});

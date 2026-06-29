import { describe, it, expect } from "vitest";
import { snapshotNode } from "../src/canvas-snapshot.js";
import type { FrameLike } from "../src/canvas-snapshot.js";

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
    expect(icon.type).toBe("instance");

    const comp = f.children.find((c) => c.name === "comp")!;
    expect(comp.type).toBe("instance");

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

  it("omits characters when undefined on a text child", () => {
    const frame: FrameLike = {
      name: "F",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [{ name: "txt", type: "TEXT", x: 0, y: 0, width: 50, height: 20 }],
    };
    const snap = snapshotNode(frame);
    expect(snap.frames[0]!.children[0]!.characters).toBeUndefined();
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

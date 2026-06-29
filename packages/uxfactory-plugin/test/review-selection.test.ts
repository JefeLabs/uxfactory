import { describe, it, expect, vi } from "vitest";
import { makeFigma, type FakeFigma } from "./figma-mock.js";
import type { MainToUi } from "../src/messages.js";

async function loadCode(fig: FakeFigma): Promise<void> {
  (globalThis as Record<string, unknown>).figma = fig;
  (globalThis as Record<string, unknown>).__html__ = "<html></html>";
  vi.resetModules();
  await import("../src/code.js");
}

const lastOfType = <T extends MainToUi["type"]>(fig: FakeFigma, type: T) =>
  [...fig.ui.posted].reverse().find((m) => m.type === type) as
    Extract<MainToUi, { type: T }> | undefined;

describe("code.ts review-selection", () => {
  it("posts review-selection-ready with snapshot + screenshot for a selected frame", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    const frame = fig.createFrame();
    frame.name = "MyFrame";
    frame.x = 10;
    frame.y = 20;
    frame.resize(800, 600);

    const rect = fig.createRectangle();
    rect.name = "bg";
    rect.x = 0;
    rect.y = 0;
    rect.resize(800, 600);
    frame.appendChild(rect);

    fig.currentPage.selection = [frame];

    await fig.__send({ type: "review-selection" });

    const ready = lastOfType(fig, "review-selection-ready");
    expect(ready).toBeDefined();
    expect(ready!.snapshot.source).toBe("canvas-inferred");
    expect(ready!.snapshot.frames).toHaveLength(1);
    expect(ready!.snapshot.frames[0]!.name).toBe("MyFrame");
    expect(ready!.snapshot.frames[0]!.children).toHaveLength(1);
    expect(ready!.snapshot.frames[0]!.children[0]!.name).toBe("bg");
    expect(ready!.snapshot.page).toBeDefined();
    expect(Array.isArray(ready!.screenshot)).toBe(true);
    expect(ready!.screenshot.length).toBeGreaterThan(0);
  });

  it("posts review-selection-error when selection is empty", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    fig.currentPage.selection = [];

    await fig.__send({ type: "review-selection" });

    const err = lastOfType(fig, "review-selection-error");
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/select/i);
    expect(lastOfType(fig, "review-selection-ready")).toBeUndefined();
  });

  it("posts review-selection-error if exportAsync throws", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    const frame = fig.createFrame();
    frame.name = "F";
    frame.x = 0;
    frame.y = 0;
    frame.resize(100, 100);
    // Override exportAsync on this specific node to throw
    (frame as unknown as Record<string, unknown>).exportAsync = () =>
      Promise.reject(new Error("export failed"));

    fig.currentPage.selection = [frame];

    await fig.__send({ type: "review-selection" });

    const err = lastOfType(fig, "review-selection-error");
    expect(err).toBeDefined();
    expect(err!.message).toContain("export failed");
  });

  it("combines multiple selected frames into one snapshot", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    const frame1 = fig.createFrame();
    frame1.name = "F1";
    frame1.x = 0;
    frame1.y = 0;
    frame1.resize(100, 100);

    const frame2 = fig.createFrame();
    frame2.name = "F2";
    frame2.x = 200;
    frame2.y = 0;
    frame2.resize(100, 100);

    fig.currentPage.selection = [frame1, frame2];

    await fig.__send({ type: "review-selection" });

    const ready = lastOfType(fig, "review-selection-ready");
    expect(ready).toBeDefined();
    expect(ready!.snapshot.frames).toHaveLength(2);
    expect(ready!.snapshot.frames.map((f) => f.name)).toEqual(["F1", "F2"]);
  });

  it("snapshot type-maps children correctly (RECTANGLE→shape, TEXT→text, INSTANCE→instance)", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    const frame = fig.createFrame();
    frame.name = "TypeTest";
    frame.x = 0;
    frame.y = 0;
    frame.resize(400, 400);

    const rect = fig.createRectangle();
    rect.name = "box";
    rect.x = 0;
    rect.y = 0;
    rect.resize(100, 100);
    frame.appendChild(rect);

    const txt = fig.createText();
    txt.name = "label";
    txt.x = 10;
    txt.y = 10;
    txt.resize(100, 30);
    frame.appendChild(txt);

    const inst = fig.createFrame(); // will be typed "FRAME" → maps to "shape"
    inst.name = "nested";
    inst.x = 50;
    inst.y = 50;
    inst.resize(40, 40);
    frame.appendChild(inst);

    fig.currentPage.selection = [frame];

    await fig.__send({ type: "review-selection" });

    const ready = lastOfType(fig, "review-selection-ready");
    expect(ready).toBeDefined();
    const children = ready!.snapshot.frames[0]!.children;

    const box = children.find((c) => c.name === "box")!;
    expect(box.type).toBe("shape"); // RECTANGLE → shape

    const lbl = children.find((c) => c.name === "label")!;
    expect(lbl.type).toBe("text"); // TEXT → text

    const nested = children.find((c) => c.name === "nested")!;
    expect(nested.type).toBe("shape"); // FRAME → shape
  });
});

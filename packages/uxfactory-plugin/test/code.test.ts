import { describe, it, expect, vi } from "vitest";
import { makeFigma, type FakeFigma } from "./figma-mock.js";
import type { MainToUi } from "../src/messages.js";
import type { DesignSpec, FigjamSpec } from "@uxfactory/spec";

async function loadCode(fig: FakeFigma): Promise<void> {
  (globalThis as Record<string, unknown>).figma = fig;
  (globalThis as Record<string, unknown>).__html__ = "<html></html>";
  vi.resetModules();
  await import("../src/code.js");
}

const lastOfType = <T extends MainToUi["type"]>(fig: FakeFigma, type: T) =>
  [...fig.ui.posted].reverse().find((m) => m.type === type) as
    Extract<MainToUi, { type: T }> | undefined;

const design: DesignSpec = {
  editor: "figma",
  page: "Architecture",
  frames: [
    {
      name: "vpc",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      children: [
        { type: "shape", name: "api", x: 80, y: 80, width: 160, height: 64, fill: "#1E88E5" },
        { type: "instance", name: "lambda", asset: "aws:lambda", x: 320, y: 80 },
      ],
    },
  ],
  connectors: [{ from: "api", to: "lambda" }],
};

describe("code.ts render", () => {
  it("renders a design spec and posts a complete report echoing jobId", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    await fig.__send({ type: "render", spec: design, jobId: "job_7" });

    const rendered = lastOfType(fig, "rendered");
    expect(rendered).toBeDefined();
    const report = rendered!.report;
    expect(report.jobId).toBe("job_7");
    expect(report.renderId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(report.editor).toBe("figma");
    expect(report.page).toBe("Architecture");
    expect(report.pageKey).toBe(fig.currentPage.id);
    expect(report.fileName).toBe("Test File");
    expect(report.fileKey).toBe("file-key-123");
    expect(report.counts).toEqual({ frames: 1, sections: 0, objects: 2, connectors: 1 });
    const api = report.nodes.find((n) => n.name === "api");
    expect(api).toMatchObject({ type: "RECTANGLE", x: 80, y: 80, w: 160, h: 64, fill: "#1e88e5" });
    expect(report.nodes.some((n) => n.name === "lambda" && n.type === "INSTANCE")).toBe(true);
  });

  it("renders a figjam spec into sections/stickies/connectors", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const figjam: FigjamSpec = {
      editor: "figjam",
      sections: [
        {
          name: "retro",
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          children: [
            { type: "sticky", name: "note", x: 10, y: 10, characters: "ship it" },
            { type: "shape", name: "card", x: 50, y: 50, width: 80, height: 40 },
          ],
        },
      ],
      connectors: [{ from: "note", to: "card" }],
    };
    await fig.__send({ type: "render", spec: figjam });
    const report = lastOfType(fig, "rendered")!.report;
    expect(report.editor).toBe("figjam");
    expect(report.counts).toEqual({ frames: 0, sections: 1, objects: 2, connectors: 1 });
    expect(report.nodes.some((n) => n.type === "STICKY" && n.characters === "ship it")).toBe(true);
  });

  it("applies only set props, skips a missing target, captures an inverse, posts the count", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    await fig.__send({
      type: "render",
      spec: {
        editor: "figma",
        frames: [
          {
            name: "f",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            children: [
              { type: "shape", name: "box", x: 10, y: 10, width: 20, height: 20, fill: "#000000" },
            ],
          },
        ],
        edits: [
          { name: "box", set: { x: 99, fill: "#43A047" } },
          { name: "ghost", set: { x: 1 } },
        ],
      } satisfies DesignSpec,
    });

    const report = lastOfType(fig, "rendered")!.report;
    const box = report.nodes.find((n) => n.name === "box")!;
    expect(box).toMatchObject({ x: 99, y: 10, w: 20, fill: "#43a047" }); // only x+fill changed
    expect(report.edits).toHaveLength(2);
    expect(report.edits!.some((e) => /skip/i.test(e.diff))).toBe(true); // ghost skipped
    expect(lastOfType(fig, "undo-count")!.count).toBe(1); // one inverse captured

    // undo restores the BEFORE value by id and decrements the count
    const boxId = box.id;
    await fig.__send({ type: "undo" });
    expect(fig.getNodeById(boxId)!.x).toBe(10);
    expect(lastOfType(fig, "undo-count")!.count).toBe(0);
  });

  it("forwards selectionchange as a selection message", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const node = fig.createRectangle();
    node.name = "picked";
    node.x = 5;
    node.y = 6;
    node.resize(7, 8);
    fig.currentPage.selection = [node];
    fig.__fireSelectionChange();

    const sel = lastOfType(fig, "selection")!.selection;
    expect(sel.fileName).toBe("Test File");
    expect(sel.nodes[0]).toMatchObject({ id: node.id, name: "picked", x: 5, y: 6, w: 7, h: 8 });
  });

  it("renders the same spec twice into equal reports (modulo node ids + renderId)", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    await fig.__send({ type: "render", spec: design });
    await fig.__send({ type: "render", spec: design });
    const posts = fig.ui.posted.filter((m) => m.type === "rendered");
    const strip = (r: MainToUi) => {
      const report = (r as Extract<MainToUi, { type: "rendered" }>).report;
      return { ...report, renderId: "X", nodes: report.nodes.map((n) => ({ ...n, id: "X" })) };
    };
    expect(strip(posts[0]!)).toEqual(strip(posts[1]!));
  });
});

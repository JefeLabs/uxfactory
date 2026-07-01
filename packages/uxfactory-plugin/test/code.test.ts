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

  it("applies auto-layout to a frame and nests child frames", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        {
          name: "col", x: 0, y: 0, width: 320, height: 480,
          layout: { mode: "vertical", gap: 16, padding: { top: 24, right: 8, bottom: 24, left: 8 }, primaryAlign: "space-between", counterAlign: "center" },
          sizing: { horizontal: "fill", vertical: "hug" },
          children: [
            { name: "row", x: 0, y: 0, width: 100, height: 40, layout: { mode: "horizontal", gap: 4 }, children: [] },
          ],
        },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j1" });

    const col = fig.currentPage.children.find((n) => n.name === "col")!;
    expect(col.layoutMode).toBe("VERTICAL");
    expect(col.itemSpacing).toBe(16);
    expect(col.paddingTop).toBe(24);
    expect(col.paddingLeft).toBe(8);
    expect(col.primaryAxisAlignItems).toBe("SPACE_BETWEEN");
    expect(col.counterAxisAlignItems).toBe("CENTER");
    expect(col.layoutSizingHorizontal).toBe("FILL");
    expect(col.layoutSizingVertical).toBe("HUG");
    const row = col.children.find((n) => n.name === "row")!;
    expect(row.type).toBe("FRAME");
    expect(row.layoutMode).toBe("HORIZONTAL");
  });

  it("sets layoutSizing only after children are appended", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        { name: "col", x: 0, y: 0, width: 200, height: 200, layout: { mode: "vertical" }, sizing: { horizontal: "fill" },
          children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10, height: 10 }] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j2" });
    const col = fig.currentPage.children.find((n) => n.name === "col")!;
    // sizing recorded the child count present at the moment it was set
    expect(col.__childCountAtSizing).toBe(1);
  });

  it("builds a component once and instantiates it with per-instance overrides", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      components: {
        button: { name: "Button", width: 120, height: 40, layout: { mode: "horizontal", gap: 8 },
          children: [{ type: "text", name: "label", x: 0, y: 0, width: 96, height: 16, characters: "OK", fill: "#101828" }] },
      },
      frames: [
        { name: "screen", x: 0, y: 0, width: 400, height: 300, children: [
          { type: "component-instance", name: "primary", component: "button", x: 20, y: 20,
            overrides: { label: { characters: "Pay now", fill: "#FFFFFF" } } },
          { type: "component-instance", name: "secondary", component: "button", x: 20, y: 80,
            overrides: { label: { characters: "Cancel" } } },
        ] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j3" });

    expect(fig.createComponentCalls).toBe(1);
    const screen = fig.currentPage.children.find((n) => n.name === "screen")!;
    const primary = screen.children.find((n) => n.name === "primary")!;
    expect(primary.type).toBe("INSTANCE");
    const primaryLabel = primary.children.find((n) => n.name === "label")!;
    expect(primaryLabel.characters).toBe("Pay now");
    const secondary = screen.children.find((n) => n.name === "secondary")!;
    const secondaryLabel = secondary.children.find((n) => n.name === "label")!;
    expect(secondaryLabel.characters).toBe("Cancel");
  });

  it("skips a component-instance with an unknown component id without aborting", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        { name: "screen", x: 0, y: 0, width: 200, height: 200, children: [
          { type: "component-instance", name: "ghost", component: "missing", x: 0, y: 0 },
          { type: "shape", name: "ok", x: 0, y: 0, width: 10, height: 10, fill: "#1E88E5" },
        ] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j4" });
    const rendered = lastOfType(fig, "rendered");
    expect(rendered).toBeDefined();
    const screen = fig.currentPage.children.find((n) => n.name === "screen")!;
    expect(screen.children.some((n) => n.name === "ok")).toBe(true);
    expect(screen.children.some((n) => n.name === "ghost")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix 1 — error boundary
// ---------------------------------------------------------------------------
describe("code.ts error boundary (Fix 1)", () => {
  it("posts render-error instead of hanging when a node-creation call throws", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    // Simulate a Figma runtime crash mid-render by making createFrame throw.
    (fig as unknown as Record<string, unknown>).createFrame = () => {
      throw new Error("simulated Figma crash");
    };
    await fig.__send({ type: "render", spec: design });
    const err = lastOfType(fig, "render-error");
    expect(err).toBeDefined();
    expect(err!.message).toContain("simulated");
    // The render did NOT complete — no "rendered" message posted.
    expect(lastOfType(fig, "rendered")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — font loading + sticky/connector text sublayer
// ---------------------------------------------------------------------------
describe("code.ts font loading + text sublayer (Fix 2)", () => {
  it("calls loadFontAsync before setting TextNode.characters", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "f",
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          children: [
            {
              type: "text",
              name: "label",
              x: 10,
              y: 10,
              width: 100,
              height: 30,
              characters: "Hello",
            },
          ],
        },
      ],
    };
    await fig.__send({ type: "render", spec });
    // Font loading must have been called.
    expect(fig.loadFontAsyncCalls.length).toBeGreaterThan(0);
    // Text renders successfully.
    const report = lastOfType(fig, "rendered")!.report;
    expect(report.nodes.some((n) => n.name === "label" && n.characters === "Hello")).toBe(true);
    // No render-error — the guard did not throw.
    expect(lastOfType(fig, "render-error")).toBeUndefined();
  });

  it("sets sticky text via .text.characters (not .characters)", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const figjam: FigjamSpec = {
      editor: "figjam",
      sections: [
        {
          name: "board",
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          children: [
            { type: "sticky", name: "stk", x: 10, y: 10, characters: "hello sticky" },
            { type: "shape", name: "box", x: 100, y: 100, width: 80, height: 40 },
          ],
        },
      ],
      connectors: [{ from: "stk", to: "box", label: "points to" }],
    };
    await fig.__send({ type: "render", spec: figjam });
    expect(lastOfType(fig, "render-error")).toBeUndefined();

    // Sticky's text sublayer must have been set.
    const section = fig.currentPage.children.find((n) => n.type === "SECTION")!;
    const sticky = section.children.find((n) => n.type === "STICKY")!;
    expect((sticky as unknown as { text: { characters?: string } }).text.characters).toBe(
      "hello sticky",
    );

    // Connector label must be in its text sublayer.
    const connector = fig.currentPage.children.find((n) => n.type === "CONNECTOR")!;
    expect((connector as unknown as { text: { characters?: string } }).text.characters).toBe(
      "points to",
    );

    // Report still surfaces characters for sticky nodes.
    const report = lastOfType(fig, "rendered")!.report;
    expect(report.nodes.some((n) => n.type === "STICKY" && n.characters === "hello sticky")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — find-or-create page
// ---------------------------------------------------------------------------
describe("code.ts find-or-create page (Fix 3)", () => {
  it("creates a new page when the named page is absent", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    // Initial state: only the blank default page.
    expect(fig.root.children).toHaveLength(1);

    await fig.__send({ type: "render", spec: design }); // page: "Architecture"
    expect(fig.root.children).toHaveLength(2);
    expect(fig.currentPage.name).toBe("Architecture");
  });

  it("reuses an existing page on a second render (no duplicate createPage)", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    await fig.__send({ type: "render", spec: design });
    const afterFirst = fig.root.children.length;
    const pageIdAfterFirst = fig.currentPage.id;

    await fig.__send({ type: "render", spec: design });
    // No new page should have been created.
    expect(fig.root.children).toHaveLength(afterFirst);
    // The same page is reused.
    expect(fig.currentPage.id).toBe(pageIdAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// Fix 5 — graceful instance failure
// ---------------------------------------------------------------------------
describe("code.ts graceful instance failure (Fix 5)", () => {
  it("skips a failing instance and still renders remaining nodes", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    // Make importComponentByKeyAsync always reject.
    (fig as unknown as Record<string, unknown>).importComponentByKeyAsync = () =>
      Promise.reject(new Error("asset not found"));

    const spec: DesignSpec = {
      editor: "figma",
      frames: [
        {
          name: "f",
          x: 0,
          y: 0,
          width: 300,
          height: 300,
          children: [
            { type: "instance", name: "bad-instance", asset: "bad:key", x: 0, y: 0 },
            { type: "shape", name: "good-shape", x: 50, y: 50, width: 80, height: 40 },
          ],
        },
      ],
    };

    await fig.__send({ type: "render", spec });

    // Render completes — no whole-spec render-error.
    const rendered = lastOfType(fig, "rendered");
    expect(rendered).toBeDefined();

    // The good shape is present.
    expect(rendered!.report.nodes.some((n) => n.name === "good-shape")).toBe(true);

    // The bad instance is absent from the report nodes.
    expect(rendered!.report.nodes.some((n) => n.name === "bad-instance")).toBe(false);

    // A skip note is recorded in the report's edit diffs.
    expect(rendered!.report.edits?.some((e) => /skip/i.test(e.diff))).toBe(true);
  });
});

import { describe, it, expect, vi } from "vitest";
import { makeFigma, type FakeFigma, type FakeNode } from "./figma-mock.js";
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

  it("computes stylesInUse from the primary selected node subtree", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    // Build a parent FRAME with two children carrying distinct fills.
    const parent = fig.createFrame();
    parent.name = "checkout";
    parent.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }]; // red fill

    const childA = fig.createRectangle();
    childA.name = "bg";
    childA.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }]; // blue fill (distinct)
    parent.appendChild(childA);

    const childB = fig.createRectangle();
    childB.name = "dup";
    childB.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }]; // same red as parent (not counted again)
    parent.appendChild(childB);

    fig.currentPage.selection = [parent];
    fig.__fireSelectionChange();

    const sel = lastOfType(fig, "selection")!.selection;
    expect(typeof sel.stylesInUse).toBe("number");
    // red fill + blue fill = 2 distinct fill keys
    expect(sel.stylesInUse).toBe(2);
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
            { name: "row", x: 0, y: 0, width: 100, height: 40, layout: { mode: "horizontal", gap: 4 }, sizing: { horizontal: "fill" }, children: [] },
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
    // Top-level frame: the page is not auto-layout, so FILL is illegal in real
    // Figma — skipped, keeping the fixed frame width. HUG (self-referential)
    // stays legal on the auto-layout node itself.
    expect(col.layoutSizingHorizontal).toBeUndefined();
    expect(col.layoutSizingVertical).toBe("HUG");
    expect(col.primaryAxisSizingMode).toBe("FIXED");
    expect(col.counterAxisSizingMode).toBe("FIXED");
    const row = col.children.find((n) => n.name === "row")!;
    expect(row.type).toBe("FRAME");
    expect(row.layoutMode).toBe("HORIZONTAL");
    expect(row.primaryAxisSizingMode).toBe("FIXED");
    // Nested child of an auto-layout parent: FILL is legal and applied.
    expect(row.layoutSizingHorizontal).toBe("FILL");
  });

  it("sets FILL only after children are appended and only under an auto-layout parent", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        { name: "host", x: 0, y: 0, width: 400, height: 400, layout: { mode: "vertical" },
          children: [
            { name: "col", x: 0, y: 0, width: 200, height: 200, layout: { mode: "vertical" }, sizing: { horizontal: "fill" },
              children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10, height: 10 }] },
          ] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j2" });
    const host = fig.currentPage.children.find((n) => n.name === "host")!;
    const col = host.children.find((n) => n.name === "col")!;
    expect(col.layoutSizingHorizontal).toBe("FILL");
    // sizing recorded the child count present at the moment it was set
    expect(col.__childCountAtSizing).toBe(1);
  });

  it("keeps the spec's fixed size on auto-layout frames (real Figma hugs on layoutMode enable)", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        { name: "page", x: 0, y: 0, width: 1440, height: 900,
          children: [
            // Fixed-size promise: children sum to 420 wide, spec says 1280.
            { name: "nav-wrap", x: 80, y: 24, width: 1280, height: 64,
              layout: { mode: "horizontal", gap: 24, primaryAlign: "space-between" },
              children: [
                { type: "shape", name: "brand", x: 0, y: 0, width: 120, height: 32 },
                { type: "shape", name: "links", x: 0, y: 0, width: 300, height: 32 },
              ] },
            // Declared hug: Figma's computed size IS the intent on that axis.
            { name: "chip-row", x: 80, y: 120, width: 400, height: 48,
              layout: { mode: "horizontal", gap: 8 }, sizing: { horizontal: "hug" },
              children: [{ type: "shape", name: "chip", x: 0, y: 0, width: 60, height: 24 }] },
          ] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j-hug" });

    const page = fig.currentPage.children.find((n) => n.name === "page")!;
    const nav = page.children.find((n) => n.name === "nav-wrap")!;
    expect(nav.width).toBe(1280);
    expect(nav.height).toBe(64);
    const chips = page.children.find((n) => n.name === "chip-row")!;
    expect(chips.width).toBe(60); // hugged to its single 60-wide child
    expect(chips.height).toBe(48); // non-hug axis restored to spec

    // The verify report must carry the restored geometry, not the hugged one.
    const report = (lastOfType(fig, "rendered") as Extract<MainToUi, { type: "rendered" }>).report;
    const navReport = report.nodes.find((n) => n.name === "nav-wrap")!;
    expect(navReport.w).toBe(1280);
  });

  it("regression: mixed corner radii never leak figma.mixed into the report post", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        { name: "card-host", x: 0, y: 0, width: 200, height: 200,
          children: [
            // Distinct per-corner radii → node.cornerRadius reads as figma.mixed
            // (a Symbol) in real Figma; postMessage cannot serialize it.
            { type: "shape", name: "card", x: 0, y: 0, width: 100, height: 80,
              cornerRadius: { tl: 8, tr: 8, br: 0, bl: 0 } },
          ] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j_mixed" });

    const types = fig.ui.posted.map((m) => (m as { type: string }).type);
    expect(types).toContain("rendered");
    expect(types).not.toContain("render-error");
  });

  it("regression: fill-heavy specs render instead of dying on real Figma's FILL constraint", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    // Top-level fill (illegal — page parent) + nested fills (legal) — the shape
    // that killed the generate-design canvas landing in real Figma.
    const spec: DesignSpec = {
      frames: [
        { name: "page-frame", x: 0, y: 0, width: 390, height: 800, layout: { mode: "vertical" },
          sizing: { horizontal: "fill", vertical: "fill" },
          children: [
            { name: "hero", x: 0, y: 0, width: 390, height: 300, layout: { mode: "vertical", gap: 8 },
              sizing: { horizontal: "fill" },
              children: [
                { type: "text", name: "title", x: 0, y: 0, width: 200, height: 32, characters: "Hi" },
              ] },
          ] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j_fill" });

    const types = fig.ui.posted.map((m) => (m as { type: string }).type);
    expect(types).toContain("rendered");
    expect(types).not.toContain("render-error");

    const pageFrame = fig.currentPage.children.find((n) => n.name === "page-frame")!;
    expect(pageFrame.layoutSizingHorizontal).toBeUndefined(); // skipped: page parent
    const hero = pageFrame.children.find((n) => n.name === "hero")!;
    expect(hero.layoutSizingHorizontal).toBe("FILL");
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

  it("applies drop-shadow effects and per-corner radius", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      frames: [
        { name: "f", x: 0, y: 0, width: 200, height: 200,
          effects: [{ type: "drop-shadow", color: "#000000", opacity: 0.25, x: 0, y: 4, blur: 12, spread: 1 }],
          children: [
            { type: "shape", name: "card", x: 0, y: 0, width: 100, height: 60,
              cornerRadius: { tl: 8, tr: 8, br: 0, bl: 0 } },
          ] },
      ],
    };
    await fig.__send({ type: "render", spec, jobId: "j5" });
    const frame = fig.currentPage.children.find((n) => n.name === "f")!;
    expect(Array.isArray(frame.effects)).toBe(true);
    const eff = (frame.effects as Array<Record<string, unknown>>)[0]!;
    expect(eff.type).toBe("DROP_SHADOW");
    expect(eff.radius).toBe(12);
    expect(eff.offset).toEqual({ x: 0, y: 4 });
    const card = frame.children.find((n) => n.name === "card")!;
    expect(card.topLeftRadius).toBe(8);
    expect(card.bottomRightRadius).toBe(0);
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

  it("renders a legacy flat spec with no semantic props touched (backward-compat)", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    await fig.__send({ type: "render", spec: design, jobId: "legacy" });

    const rendered = lastOfType(fig, "rendered");
    expect(rendered).toBeDefined();
    expect(rendered!.report.counts).toEqual({ frames: 1, sections: 0, objects: 2, connectors: 1 });

    const vpc = fig.currentPage.children.find((n) => n.name === "vpc")!;
    expect(vpc.type).toBe("FRAME");
    // No auto-layout, no effects, no per-corner radius applied to a legacy frame.
    expect(vpc.layoutMode).toBeUndefined();
    expect(vpc.itemSpacing).toBeUndefined();
    expect(vpc.effects).toBeUndefined();
    expect(vpc.topLeftRadius).toBeUndefined();
    expect(vpc.layoutSizingHorizontal).toBeUndefined();
    // No components were created for a spec without a components map.
    expect(fig.createComponentCalls).toBe(0);
    const api = vpc.children.find((n) => n.name === "api")!;
    expect(api).toMatchObject({ type: "RECTANGLE", x: 80, y: 80 });
  });

  it("reports recursive object counts and places masters off-flow", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      components: { b: { name: "Btn", width: 100, height: 40,
        children: [{ type: "text", name: "l", x: 8, y: 8, width: 80, height: 20, characters: "Go" }] } },
      frames: [{ name: "v", x: 0, y: 0, width: 390, height: 400, children: [
        { name: "col", x: 0, y: 0, width: 390, height: 200, children: [
          { type: "shape", name: "s", x: 0, y: 0, width: 10, height: 10 },
        ] },
        { type: "component-instance", name: "go", component: "b", x: 10, y: 210 },
      ] }],
    };
    await fig.__send({ type: "render", spec, jobId: "r1" });
    const rendered = lastOfType(fig, "rendered")!;
    // objects = col + s + go = 3 (recursive; master internals excluded)
    expect(rendered.report.counts.objects).toBe(3);
    const master = fig.currentPage.children.find((n) => n.type === "COMPONENT")!;
    expect(master.x).toBe(-200);                                 // cursor -100 → x = -100 - 100(width)
    expect(master.y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SP3c — master rendering isolation (multi-level component)
// ---------------------------------------------------------------------------
describe("code.ts master rendering isolation (SP3c)", () => {
  it("does not leak multi-level master internals into the report", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      components: { card: { name: "Card", width: 200, height: 80,
        children: [ { name: "row", x: 8, y: 8, width: 184, height: 40, children: [
          { type: "text", name: "t1", x: 4, y: 4, width: 100, height: 20, characters: "Hi" },
        ] } ] } },
      frames: [{ name: "v", x: 0, y: 0, width: 390, height: 400, children: [
        { type: "component-instance", name: "i1", component: "card", x: 10, y: 10 },
        { type: "component-instance", name: "i2", component: "card", x: 10, y: 100 },
      ] }],
    };
    await fig.__send({ type: "render", spec, jobId: "leak1" });
    const rendered = lastOfType(fig, "rendered")!;
    expect(rendered.report.counts.objects).toBe(2);                        // i1 + i2 ONLY
    expect(rendered.report.nodes.some((n) => n.name === "row" || n.name === "t1")).toBe(false);
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
// SP3c Task 6 — typography rendering + fail-soft font chain
// ---------------------------------------------------------------------------
describe("code.ts typography rendering (SP3c Task 6)", () => {
  it("applies typography with a fail-soft font chain", async () => {
    const fig = makeFigma();
    fig.failFontKeys.push("Fraunces/Bold");                     // style load fails → falls to Regular
    await loadCode(fig);
    const spec: DesignSpec = { frames: [{ name: "f", x: 0, y: 0, width: 300, height: 100, children: [
      { type: "text", name: "h1", x: 0, y: 0, width: 200, height: 40, characters: "Title",
        fontSize: 28, fontWeight: 700, fontFamily: "Fraunces", lineHeight: 36 },
    ] }] };
    await fig.__send({ type: "render", spec, jobId: "t1" });
    const f = fig.currentPage.children.find((n) => n.name === "f")!;
    const h1 = f.children.find((n) => n.name === "h1")!;
    expect(fig.loadFontAsyncCalls).toContain("Fraunces/Bold");   // tried
    expect(h1.fontName).toEqual({ family: "Fraunces", style: "Regular" });  // fell back one step
    expect(h1.characters).toBe("Title");
    expect(h1.fontSize).toBe(28);
    expect(h1.lineHeight).toEqual({ value: 36, unit: "PIXELS" });
  });

  it("falls all the way back to Inter and never aborts", async () => {
    const fig = makeFigma();
    fig.failFontKeys.push("Ghost/Regular");                      // both family attempts fail
    await loadCode(fig);
    const spec: DesignSpec = { frames: [{ name: "f", x: 0, y: 0, width: 300, height: 100, children: [
      { type: "text", name: "t", x: 0, y: 0, width: 200, height: 40, characters: "x",
        fontWeight: 400, fontFamily: "Ghost" },
    ] }] };
    await fig.__send({ type: "render", spec, jobId: "t2" });
    const t = fig.currentPage.children.find((n) => n.name === "f")!.children[0]!;
    expect(t.fontName).toEqual({ family: "Inter", style: "Regular" });
    expect(t.characters).toBe("x");
  });

  it("preserves the weight when only the family is unavailable", async () => {
    const fig = makeFigma();
    fig.failFontKeys.push("-apple-system/Semi Bold", "-apple-system/Regular");
    await loadCode(fig);
    const spec: DesignSpec = { frames: [{ name: "f", x: 0, y: 0, width: 300, height: 100, children: [
      { type: "text", name: "h2", x: 0, y: 0, width: 200, height: 40, characters: "Cart",
        fontSize: 24, fontWeight: 600, fontFamily: "-apple-system" },
    ] }] };
    await fig.__send({ type: "render", spec, jobId: "w1" });
    const h2 = fig.currentPage.children.find((n) => n.name === "f")!.children[0]!;
    expect(h2.fontName).toEqual({ family: "Inter", style: "Semi Bold" });   // weight preserved
  });

  it("applies fontSize/lineHeight even without a font family or weight", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = { frames: [{ name: "f", x: 0, y: 0, width: 300, height: 100, children: [
      { type: "text", name: "t", x: 0, y: 0, width: 200, height: 40, characters: "x", fontSize: 18, lineHeight: 26 },
    ] }] };
    await fig.__send({ type: "render", spec, jobId: "t3" });
    const t = fig.currentPage.children.find((n) => n.name === "f")!.children[0]!;
    expect(t.fontName).toEqual({ family: "Inter", style: "Regular" });   // font-less path
    expect(t.fontSize).toBe(18);
    expect(t.lineHeight).toEqual({ value: 26, unit: "PIXELS" });
  });
});

// ---------------------------------------------------------------------------
// Task 2 — typed ui↔main bus handlers
// ---------------------------------------------------------------------------
describe("code.ts bus handlers (Task 2)", () => {
  it("storage-get retrieves a value and posts storage-value with the same key", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    // Pre-populate the store so getAsync returns a known value.
    await fig.clientStorage.setAsync("palette", ["#FF0000", "#00FF00"]);

    await fig.__send({ type: "storage-get", key: "palette" });
    const reply = lastOfType(fig, "storage-value");
    expect(reply).toBeDefined();
    expect(reply!.key).toBe("palette");
    expect(reply!.value).toEqual(["#FF0000", "#00FF00"]);
  });

  it("storage-get returns undefined for an unknown key", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    await fig.__send({ type: "storage-get", key: "unknown-key" });
    const reply = lastOfType(fig, "storage-value");
    expect(reply).toBeDefined();
    expect(reply!.key).toBe("unknown-key");
    expect(reply!.value).toBeUndefined();
  });

  it("storage-set persists the value (no reply posted)", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    await fig.__send({ type: "storage-set", key: "user", value: { id: 42 } });
    // No storage-value reply is expected.
    expect(lastOfType(fig, "storage-value")).toBeUndefined();
    // Value is stored in the mock.
    expect(await fig.clientStorage.getAsync("user")).toEqual({ id: 42 });
  });

  it("file-info-request posts file-info with root name and fileKey", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    await fig.__send({ type: "file-info-request" });
    const reply = lastOfType(fig, "file-info");
    expect(reply).toBeDefined();
    expect(reply!.name).toBe("Test File");
    expect(reply!.fileKey).toBe("file-key-123");
  });

  it("insert-icon creates a node with correct size, position, plugin data, and posts icon-inserted", async () => {
    const fig = makeFigma();
    // Set viewport center so positioning is predictable.
    fig.viewport.center.x = 100;
    fig.viewport.center.y = 200;
    await loadCode(fig);

    await fig.__send({ type: "insert-icon", name: "star", svg: "<svg/>", size: 24 });

    const reply = lastOfType(fig, "icon-inserted");
    expect(reply).toBeDefined();
    expect(typeof reply!.nodeId).toBe("string");

    // Find the node on the current page.
    const node = fig.currentPage.children.find((n) => n.id === reply!.nodeId);
    expect(node).toBeDefined();

    // Correct size.
    expect(node!.width).toBe(24);
    expect(node!.height).toBe(24);

    // Centered at viewport center.
    expect(node!.x).toBe(100 - 12); // center.x - size/2
    expect(node!.y).toBe(200 - 12); // center.y - size/2

    // Plugin data set.
    expect(node!._pluginData.get("assetSet")).toBe("lucide");
    expect(node!._pluginData.get("assetId")).toBe("star");

    // SVG stashed on the node.
    expect(node!._svg).toBe("<svg/>");
  });

  it("notify records the message via figma.notify", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    await fig.__send({ type: "notify", message: "Hello from plugin" });
    expect(fig.notifyCalls).toContain("Hello from plugin");
  });

  it("close calls figma.closePlugin", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    expect(fig.closeCalled).toBe(false);
    await fig.__send({ type: "close" });
    expect(fig.closeCalled).toBe(true);
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


describe("code.ts select-nodes", () => {
  it("selects found nodes and scrolls into view", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    // Render a spec to get real node ids into the registry.
    await fig.__send({ type: "render", spec: design, jobId: "sn1" });
    const rendered = lastOfType(fig, "rendered")!.report;
    const nodeId = rendered.nodes[0]?.id;
    if (!nodeId) return; // skip if no nodes rendered (shouldn't happen)

    await fig.__send({ type: "select-nodes", ids: [nodeId] });

    expect(fig.currentPage.selection).toHaveLength(1);
    expect(fig.currentPage.selection[0]?.id).toBe(nodeId);
    expect(fig.viewport.scrollAndZoomIntoViewCalls).toHaveLength(1);
  });

  it("no-ops gracefully when no ids resolve to nodes", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    await fig.__send({ type: "select-nodes", ids: ["999:999"] });

    // selection should remain empty, no crash
    expect(fig.currentPage.selection).toHaveLength(0);
    expect(fig.viewport.scrollAndZoomIntoViewCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// identity-scan (node-identity feature, Task 4)
// ---------------------------------------------------------------------------
describe("code.ts identity-scan (Task 4)", () => {
  it("scans the current page and posts identity-extraction with page + nodes in doc order", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    const frame = fig.createFrame();
    frame.name = "Hero";
    const text = fig.createText();
    text.name = "Headline";
    frame.appendChild(text);
    fig.currentPage.appendChild(frame);

    await fig.__send({ type: "identity-scan" });

    const reply = lastOfType(fig, "identity-extraction");
    expect(reply).toBeDefined();
    expect(reply!.extraction.page).toEqual({
      figmaNodeId: fig.currentPage.id,
      name: fig.currentPage.name,
    });
    expect(reply!.extraction.pageCount).toBe(1); // just the initial page
    expect(reply!.extraction.nodes.map((n) => n.currentName)).toEqual(["Hero", "Headline"]);
    expect(reply!.extraction.nodes[0]!.isPageChild).toBe(true);
    expect(reply!.extraction.nodes[1]!.isPageChild).toBe(false);
    expect(reply!.truncated).toBe(0);
  });

  it("stamps a durable id onto the real Figma node via setPluginData", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const frame = fig.createFrame();
    frame.name = "Card";
    fig.currentPage.appendChild(frame);

    await fig.__send({ type: "identity-scan" });

    expect(frame._pluginData.get("uxf:durableId")).toMatch(/^n-[0-9a-z]{12}$/);
    const reply = lastOfType(fig, "identity-extraction")!;
    expect(reply.extraction.nodes[0]!.durableId).toBe(frame._pluginData.get("uxf:durableId"));
  });

  it("harvests a COMPONENT's real .key as componentKey (required for downstream dedupe)", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const comp = fig.createComponent();
    comp.name = "Icon/Star";
    comp.key = "real-figma-key-1";
    fig.currentPage.appendChild(comp);

    await fig.__send({ type: "identity-scan" });

    const reply = lastOfType(fig, "identity-extraction")!;
    expect(reply.components).toEqual([
      { key: "real-figma-key-1", roleName: "icon", source: "figma-document", matchability: "matchable" },
    ]);
  });

  it("resolves an INSTANCE's main component via getMainComponentAsync and dedupes against its definition", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    const comp = fig.createComponent();
    comp.name = "Button/Primary";
    comp.key = "shared-key";
    fig.currentPage.appendChild(comp);

    const inst = (comp as unknown as { createInstance(): FakeNode }).createInstance();
    inst.name = "Button instance";
    // A remote/renamed view of the SAME component — the definition (found via
    // .key) must win the harvest; the async-resolved mainComponent must still
    // appear verbatim on the instance's own extracted node.
    inst._mainComponentResult = { key: "shared-key", name: "Renamed/Elsewhere", remote: true };
    fig.currentPage.appendChild(inst);

    await fig.__send({ type: "identity-scan" });

    const reply = lastOfType(fig, "identity-extraction")!;
    expect(reply.components).toEqual([
      { key: "shared-key", roleName: "button", source: "figma-document", matchability: "matchable" },
    ]);
    const instNode = reply.extraction.nodes.find((n) => n.currentName === "Button instance");
    expect(instNode?.mainComponent).toEqual({
      key: "shared-key",
      name: "Renamed/Elsewhere",
      remote: true,
    });
  });

  it("pageCount reflects the total number of pages in the file, not the current page's children", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    fig.createPage();
    fig.createPage();

    await fig.__send({ type: "identity-scan" });

    const reply = lastOfType(fig, "identity-extraction")!;
    expect(reply.extraction.pageCount).toBe(3); // initial page + 2 created
  });

  it("posts an empty extraction (no crash) when the page has no children", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    await fig.__send({ type: "identity-scan" });

    const reply = lastOfType(fig, "identity-extraction")!;
    expect(reply.extraction.nodes).toEqual([]);
    expect(reply.components).toEqual([]);
    expect(reply.truncated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// identity-crops (node-identity feature, Task 9 — Phase 3: vision)
// ---------------------------------------------------------------------------
describe("code.ts identity-crops (Task 9)", () => {
  it("exports one PNG per PAGE CHILD only — never a descendant", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    const frame = fig.createFrame();
    frame.name = "Hero";
    const child = fig.createText();
    child.name = "Headline";
    frame.appendChild(child);
    fig.currentPage.appendChild(frame);

    await fig.__send({ type: "identity-crops" });

    const reply = lastOfType(fig, "identity-crops");
    expect(reply).toBeDefined();
    expect(reply!.crops).toHaveLength(1);
    expect(reply!.crops[0]!.figmaNodeId).toBe(frame.id);
  });

  it("reuses the SAME durable id identity-scan would stamp (ensureDurableId convention)", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const frame = fig.createFrame();
    frame.name = "Card";
    fig.currentPage.appendChild(frame);

    await fig.__send({ type: "identity-crops" });

    const stamped = frame._pluginData.get("uxf:durableId");
    expect(stamped).toMatch(/^n-[0-9a-z]{12}$/);
    const reply = lastOfType(fig, "identity-crops")!;
    expect(reply.crops[0]!.durableId).toBe(stamped);
  });

  it("does not mint a new durable id when the node already has one (scan-then-crops)", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const frame = fig.createFrame();
    frame.name = "Card";
    fig.currentPage.appendChild(frame);

    await fig.__send({ type: "identity-scan" });
    const scanned = frame._pluginData.get("uxf:durableId");

    await fig.__send({ type: "identity-crops" });
    const reply = lastOfType(fig, "identity-crops")!;
    expect(reply.crops[0]!.durableId).toBe(scanned);
  });

  it("scales a wide node's export so its longest edge (width) lands at 1024px", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const frame = fig.createFrame();
    frame.name = "Wide";
    frame.resize(4096, 512);
    fig.currentPage.appendChild(frame);

    const exportCalls: unknown[] = [];
    (frame as unknown as Record<string, unknown>).exportAsync = async (settings: unknown) => {
      exportCalls.push(settings);
      return new Uint8Array([137, 80, 78, 71]);
    };

    await fig.__send({ type: "identity-crops" });

    expect(exportCalls).toEqual([
      { format: "PNG", constraint: { type: "SCALE", value: 0.25 } },
    ]);
  });

  it("never upscales — a node smaller than 1024px exports at constraint value 1", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const frame = fig.createFrame();
    frame.name = "Small";
    frame.resize(200, 100);
    fig.currentPage.appendChild(frame);

    const exportCalls: unknown[] = [];
    (frame as unknown as Record<string, unknown>).exportAsync = async (settings: unknown) => {
      exportCalls.push(settings);
      return new Uint8Array([137, 80, 78, 71]);
    };

    await fig.__send({ type: "identity-crops" });

    expect(exportCalls).toEqual([
      { format: "PNG", constraint: { type: "SCALE", value: 1 } },
    ]);
  });

  it("posts crops with durableId, figmaNodeId, and the exported bytes for every page child", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const a = fig.createFrame();
    a.name = "A";
    fig.currentPage.appendChild(a);
    const b = fig.createFrame();
    b.name = "B";
    fig.currentPage.appendChild(b);

    await fig.__send({ type: "identity-crops" });

    const reply = lastOfType(fig, "identity-crops")!;
    expect(reply.crops).toHaveLength(2);
    for (const crop of reply.crops) {
      expect(crop.durableId).toMatch(/^n-[0-9a-z]{12}$/);
      expect(crop.bytes).toBeInstanceOf(Uint8Array);
      expect(crop.bytes.length).toBeGreaterThan(0);
    }
    expect(reply.crops.map((c) => c.figmaNodeId).sort()).toEqual([a.id, b.id].sort());
  });

  it("posts an empty crops array (no crash) when the page has no children", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    await fig.__send({ type: "identity-crops" });

    const reply = lastOfType(fig, "identity-crops")!;
    expect(reply.crops).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// identity-apply (node-identity feature, Task 14 — Phase 4: write-back)
// ---------------------------------------------------------------------------
describe("code.ts identity-apply (Task 14)", () => {
  it("writes each rename's newName onto the live node and posts identity-applied with the applied list", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    const frame = fig.createFrame();
    frame.name = "Hero (old name)";
    fig.currentPage.appendChild(frame);

    await fig.__send({
      type: "identity-apply",
      renames: [{ figmaNodeId: frame.id, durableId: "n-hero", newName: "home/hero@desktop" }],
    });

    expect(frame.name).toBe("home/hero@desktop");
    const reply = lastOfType(fig, "identity-applied")!;
    expect(reply.applied).toEqual([{ durableId: "n-hero", newName: "home/hero@desktop" }]);
    expect(reply.failed).toEqual([]);
  });

  it("reports a missing node in failed[] without throwing or aborting the rest of the batch", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    const frame = fig.createFrame();
    frame.name = "Footer (old name)";
    fig.currentPage.appendChild(frame);

    await fig.__send({
      type: "identity-apply",
      renames: [
        { figmaNodeId: "999:999", durableId: "n-ghost", newName: "ghost@desktop" },
        { figmaNodeId: frame.id, durableId: "n-footer", newName: "footer@desktop" },
      ],
    });

    expect(frame.name).toBe("footer@desktop");
    const reply = lastOfType(fig, "identity-applied")!;
    expect(reply.applied).toEqual([{ durableId: "n-footer", newName: "footer@desktop" }]);
    expect(reply.failed).toEqual([
      { durableId: "n-ghost", error: expect.stringContaining("999:999") },
    ]);
  });

  it("posts empty applied/failed (no crash) for an empty renames batch", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    await fig.__send({ type: "identity-apply", renames: [] });

    const reply = lastOfType(fig, "identity-applied")!;
    expect(reply.applied).toEqual([]);
    expect(reply.failed).toEqual([]);
  });
});

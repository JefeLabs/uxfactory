# Phase 5 — Headless Preview Rendering (`uxfactory render`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PRD §12's approximate offline raster — `uxfactory render <spec> --out diagram.(png|svg)` — by walking a spec into a pure, deterministic SVG, rasterizing it with `@resvg/resvg-js`, replacing the `render` CLI stub; plus a unit-tested Figma-accurate REST image-export helper for the pixel-faithful path.

**Architecture:** A pure `specToSvg(spec)` builder (`src/render/svg.ts`) walks frames/sections/children/connectors into a byte-deterministic SVG document (no clock, no randomness, coordinates rounded). A thin rasterizer (`src/render/raster.ts`) is the only module touching the native `@resvg/resvg-js` binding. The `renderCmd` (`src/commands/render.ts`) reuses `loadSpec`/`printSpecProblem`/`EXIT`/`IO`, picks SVG vs PNG by output extension, and replaces the table-driven stub. A separate `src/render/figma-export.ts` constructs the token-gated Figma REST image-export request with an injectable `fetch` for the pixel-accurate path.

**Tech Stack:** Node `>=20.10`, TS 6.0.3, ESM/NodeNext with `.js` import extensions and `verbatimModuleSyntax`. New runtime dep `@resvg/resvg-js@2.6.2` (SVG→PNG; ships its own types + prebuilt napi binaries). Tests are Vitest 4.1.9 (`.ts`) reading the spec types via the existing `@uxfactory/spec` alias; PNG/SVG written to per-test temp dirs.

## Global Constraints

- Node `>=20.10`; TS 6.0.3; ESM/NodeNext; `.js` import extensions; `verbatimModuleSyntax` on. WORK DIRECTLY ON `main` (no feature branch); each task commits to main. NEVER touch `packages/uxfactory-agent` (the user's excluded package).
- This phase EXTENDS `@uxfactory/cli`. Add `@resvg/resvg-js@2.6.2` as a dependency (SVG→PNG rasterization; native napi module — if pnpm 11's build-script policy blocks its install, add it to `allowBuilds` in `pnpm-workspace.yaml` and commit that, mirroring the esbuild approval).
- The offline raster is EXPLICITLY APPROXIMATE (§12): fonts, published-component icons, and connector routing are not pixel-identical to Figma. The SVG is the deterministic source of truth; the PNG is its rasterization.
- Exit codes: `uxfactory render` → `0` success, `2` invalid spec / write error / setup. (No `1` — there's no gate here.)
- Per the established conventions: `paths` only in tsconfig.typecheck.json; `@types/node` devDep; built artifact verified; commit scoped per task (`git add packages/uxfactory-cli`, + pnpm-lock/workspace when deps change) — never `git add -A`.

### Layout added by this phase

```
packages/uxfactory-cli/
  src/
    render/
      svg.ts            specToSvg — pure, deterministic SVG builder      (Task 1)
      raster.ts         svgToPng via @resvg/resvg-js (ONLY resvg import) (Task 2)
      figma-export.ts   figmaImageExport — token-gated REST helper        (Task 3)
    commands/
      render.ts         renderCmd — loadSpec → SVG → PNG/SVG → write      (Task 2)
    cli.ts              replace the `render` stub with real wiring         (Task 2)
    index.ts            export the new public surface                      (Task 3)
  test/
    svg.test.ts                                                            (Task 1)
    render.test.ts                                                         (Task 2)
    figma-export.test.ts                                                   (Task 3)
```

> The existing `commands/stub.ts` and `stub.test.ts` stay: `batch`/`review`/`snapshot` remain stubs. Only the `render` row is removed from `cli.ts`'s `stubs` table; `stub.test.ts` calls `stubCmd(...)` directly (not through the program wiring), so it stays green.

---

## Task 1: `src/render/svg.ts` — `specToSvg` (pure, deterministic)

Walk a `Spec` into an SVG document string. Pure: same spec → byte-identical output (no `Date`, no `Math.random`); coordinates rounded to 2 decimals. Design specs draw frames (rect + label) and children (shape rect + optional centered text, text node, dashed instance placeholder labelled by `asset`); FigJam specs draw sections + sticky rects. Connectors resolve `from`/`to` by node name to the node's center and emit a `<line>` with an arrowhead marker; a connector whose endpoint can't be resolved is skipped. All text is XML-escaped. An edit-only spec (no frames/sections) yields a minimal empty SVG without crashing.

**Files:**

- Create: `packages/uxfactory-cli/src/render/svg.ts`
- Test: `packages/uxfactory-cli/test/svg.test.ts`

**Interfaces:**

```ts
export function specToSvg(spec: Spec): string; // pure + deterministic; no I/O
```

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-cli/test/svg.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { specToSvg } from "../src/render/svg.js";
import type { DesignSpec, FigjamSpec, EditOnlySpec } from "@uxfactory/spec";

const design: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "Frame A",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        {
          type: "shape",
          name: "box",
          x: 10,
          y: 20,
          width: 30,
          height: 40,
          fill: "#1E88E5",
          stroke: "#000000",
          strokeWidth: 2,
          cornerRadius: 4,
          characters: "Hi & <ok>",
        },
        {
          type: "text",
          name: "label",
          x: 10,
          y: 100,
          width: 80,
          height: 20,
          characters: "Caption",
        },
        { type: "instance", name: "fn", asset: "aws:lambda", x: 120, y: 20, width: 48, height: 48 },
      ],
    },
  ],
};

const figjam: FigjamSpec = {
  editor: "figjam",
  sections: [
    {
      name: "Sec",
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      children: [
        { type: "sticky", name: "note", x: 20, y: 20, characters: "Idea", fill: "#FFD966" },
      ],
    },
  ],
};

const connSpec: DesignSpec = {
  editor: "figma",
  frames: [
    {
      name: "F",
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      children: [
        { type: "shape", name: "a", x: 0, y: 0, width: 100, height: 100 },
        { type: "shape", name: "b", x: 200, y: 0, width: 100, height: 100 },
      ],
    },
  ],
  connectors: [
    { from: "a", to: "b", label: "calls" },
    { from: "a", to: "ghost" }, // unresolved endpoint → skipped
  ],
};

const editOnly: EditOnlySpec = {
  editor: "figma",
  edits: [{ name: "x", set: { fill: "#ffffff" } }],
};

describe("specToSvg", () => {
  it("is deterministic — same spec renders to a byte-identical string", () => {
    expect(specToSvg(design)).toBe(specToSvg(design));
    expect(specToSvg(connSpec)).toBe(specToSvg(connSpec));
  });

  it("renders a well-formed SVG root with a sized viewBox", () => {
    const svg = specToSvg(design);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("viewBox=");
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("renders a design frame, shape (fill/stroke/radius), text node, and dashed instance", () => {
    const svg = specToSvg(design);
    // frame rect + label
    expect(svg).toContain('width="200"');
    expect(svg).toContain(">Frame A<");
    // shape rect carries geometry, fill, corner radius, and stroke
    expect(svg).toContain('width="30"');
    expect(svg).toContain('height="40"');
    expect(svg).toContain('fill="#1E88E5"');
    expect(svg).toContain('rx="4"');
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke-width="2"');
    // text node
    expect(svg).toContain(">Caption<");
    // instance is a dashed placeholder labelled by its asset
    expect(svg).toContain('stroke-dasharray="4 4"');
    expect(svg).toContain(">aws:lambda<");
  });

  it("XML-escapes special characters in text", () => {
    const svg = specToSvg(design);
    expect(svg).toContain("Hi &amp; &lt;ok&gt;");
    expect(svg).not.toContain("Hi & <ok>");
  });

  it("renders a figjam section and a sticky", () => {
    const svg = specToSvg(figjam);
    expect(svg).toContain(">Sec<");
    expect(svg).toContain('fill="#FFD966"');
    expect(svg).toContain(">Idea<");
  });

  it("resolves connector endpoints to node centers, draws an arrow, and skips unresolved ones", () => {
    const svg = specToSvg(connSpec);
    const lines = svg.match(/<line/g) ?? [];
    expect(lines.length).toBe(1); // the a→ghost connector is dropped
    // a center = (50,50); b center = (250,50)
    expect(svg).toContain('x1="50"');
    expect(svg).toContain('y1="50"');
    expect(svg).toContain('x2="250"');
    expect(svg).toContain('y2="50"');
    expect(svg).toContain('marker-end="url(#arrow)"');
    expect(svg).toContain("<defs>");
    expect(svg).toContain(">calls<");
  });

  it("renders an edit-only spec as a minimal empty SVG without crashing", () => {
    const svg = specToSvg(editOnly);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).not.toContain("<rect");
    expect(svg).not.toContain("<line");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/svg.test.ts`
Expected: FAIL — `../src/render/svg.js` does not exist yet (resolution error / cannot find module).

- [ ] **Step 3: Implement `src/render/svg.ts` (complete)**

`packages/uxfactory-cli/src/render/svg.ts`:

```ts
import type { Spec, Connector, FrameChild, SectionChild } from "@uxfactory/spec";

/** Geometry of a positioned, sized box. */
interface Geom {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A normalized drawable, discriminated by kind, emitted in document order. */
type Drawable =
  | { kind: "frame" | "section"; name: string; geom: Geom }
  | {
      kind: "shape";
      name: string;
      geom: Geom;
      fill: string;
      stroke?: string;
      strokeWidth?: number;
      cornerRadius?: number;
      characters?: string;
    }
  | { kind: "text"; name: string; geom: Geom; characters: string }
  | { kind: "instance"; name: string; geom: Geom; asset: string }
  | { kind: "sticky"; name: string; geom: Geom; fill: string; characters: string };

// --- approximate styling constants (§12 — not pixel-identical to Figma) ---
const MARGIN = 40;
const FONT = 14;
const STICKY_W = 160;
const STICKY_H = 120;
const INSTANCE_W = 48;
const INSTANCE_H = 48;
const FRAME_FILL = "#ffffff";
const FRAME_STROKE = "#cccccc";
const SECTION_FILL = "#f5f5f5";
const SECTION_STROKE = "#bbbbbb";
const SHAPE_FILL = "#e8eef7";
const STICKY_FILL = "#ffd966";
const TEXT_FILL = "#111111";
const LABEL_FILL = "#555555";
const INSTANCE_STROKE = "#888888";
const CONNECTOR_STROKE = "#555555";

const ARROW_DEFS =
  `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">` +
  `<path d="M0,0 L8,4 L0,8 z" fill="${CONNECTOR_STROKE}" /></marker></defs>`;

/** Round to 2 decimals so output is byte-stable across calls. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Escape the five XML metacharacters in text content / attribute values. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Build a `<rect>`; stroke/strokeWidth/rx/dashed are emitted only when set. */
function rectTag(
  g: Geom,
  opts: { fill: string; stroke?: string; strokeWidth?: number; rx?: number; dashed?: boolean },
): string {
  const attrs = [
    `x="${r(g.x)}"`,
    `y="${r(g.y)}"`,
    `width="${r(g.width)}"`,
    `height="${r(g.height)}"`,
    `fill="${opts.fill}"`,
  ];
  if (opts.rx !== undefined) attrs.push(`rx="${r(opts.rx)}"`);
  if (opts.stroke !== undefined) {
    attrs.push(`stroke="${opts.stroke}"`);
    attrs.push(`stroke-width="${r(opts.strokeWidth ?? 1)}"`);
  }
  if (opts.dashed === true) attrs.push(`stroke-dasharray="4 4"`);
  return `<rect ${attrs.join(" ")} />`;
}

/** Build a `<text>` at a baseline point. */
function textTag(
  x: number,
  y: number,
  s: string,
  opts: { anchor?: "start" | "middle"; fill?: string; size?: number } = {},
): string {
  return (
    `<text x="${r(x)}" y="${r(y)}" font-family="sans-serif" ` +
    `font-size="${opts.size ?? FONT}" fill="${opts.fill ?? TEXT_FILL}" ` +
    `text-anchor="${opts.anchor ?? "start"}">${esc(s)}</text>`
  );
}

/** Normalize a frame/section child into a single drawable. */
function leaf(child: FrameChild | SectionChild): Drawable {
  switch (child.type) {
    case "shape":
      return {
        kind: "shape",
        name: child.name,
        geom: { x: child.x, y: child.y, width: child.width, height: child.height },
        fill: child.fill ?? SHAPE_FILL,
        stroke: child.stroke,
        strokeWidth: child.strokeWidth,
        cornerRadius: child.cornerRadius,
        characters: child.characters,
      };
    case "text":
      return {
        kind: "text",
        name: child.name,
        geom: { x: child.x, y: child.y, width: child.width, height: child.height },
        characters: child.characters,
      };
    case "instance":
      return {
        kind: "instance",
        name: child.name,
        geom: {
          x: child.x,
          y: child.y,
          width: child.width ?? INSTANCE_W,
          height: child.height ?? INSTANCE_H,
        },
        asset: child.asset,
      };
    case "sticky":
      return {
        kind: "sticky",
        name: child.name,
        geom: { x: child.x, y: child.y, width: STICKY_W, height: STICKY_H },
        fill: child.fill ?? STICKY_FILL,
        characters: child.characters,
      };
  }
}

/** Walk a spec into an ordered list of drawables (container, then its children). */
function normalize(spec: Spec): Drawable[] {
  const out: Drawable[] = [];
  if ("frames" in spec) {
    for (const frame of spec.frames) {
      out.push({
        kind: "frame",
        name: frame.name,
        geom: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      });
      for (const child of frame.children ?? []) out.push(leaf(child));
    }
  } else if ("sections" in spec) {
    for (const section of spec.sections) {
      out.push({
        kind: "section",
        name: section.name,
        geom: { x: section.x, y: section.y, width: section.width, height: section.height },
      });
      for (const child of section.children ?? []) out.push(leaf(child));
    }
  }
  return out;
}

/** Overall bounding box of all drawables, or null when there is nothing to draw. */
function bounds(drawables: Drawable[]): Geom | null {
  if (drawables.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of drawables) {
    minX = Math.min(minX, d.geom.x);
    minY = Math.min(minY, d.geom.y);
    maxX = Math.max(maxX, d.geom.x + d.geom.width);
    maxY = Math.max(maxY, d.geom.y + d.geom.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Map each node name to its center (first occurrence wins — deterministic). */
function centers(drawables: Drawable[]): Map<string, { cx: number; cy: number }> {
  const m = new Map<string, { cx: number; cy: number }>();
  for (const d of drawables) {
    if (!m.has(d.name)) {
      m.set(d.name, { cx: d.geom.x + d.geom.width / 2, cy: d.geom.y + d.geom.height / 2 });
    }
  }
  return m;
}

/** Emit the markup for a single drawable. */
function drawDrawable(d: Drawable): string[] {
  switch (d.kind) {
    case "frame":
    case "section": {
      const fill = d.kind === "frame" ? FRAME_FILL : SECTION_FILL;
      const stroke = d.kind === "frame" ? FRAME_STROKE : SECTION_STROKE;
      return [
        rectTag(d.geom, { fill, stroke, strokeWidth: 1 }),
        textTag(d.geom.x, d.geom.y - 4, d.name, { fill: LABEL_FILL, size: 12 }),
      ];
    }
    case "shape": {
      const out = [
        rectTag(d.geom, {
          fill: d.fill,
          stroke: d.stroke,
          strokeWidth: d.strokeWidth,
          rx: d.cornerRadius,
        }),
      ];
      if (d.characters !== undefined && d.characters !== "") {
        out.push(
          textTag(
            d.geom.x + d.geom.width / 2,
            d.geom.y + d.geom.height / 2 + FONT / 3,
            d.characters,
            {
              anchor: "middle",
            },
          ),
        );
      }
      return out;
    }
    case "text":
      return [textTag(d.geom.x, d.geom.y + FONT, d.characters)];
    case "instance":
      return [
        rectTag(d.geom, { fill: "#ffffff", stroke: INSTANCE_STROKE, strokeWidth: 1, dashed: true }),
        textTag(d.geom.x + d.geom.width / 2, d.geom.y + d.geom.height / 2 + FONT / 3, d.asset, {
          anchor: "middle",
          fill: INSTANCE_STROKE,
          size: 11,
        }),
      ];
    case "sticky": {
      const out = [rectTag(d.geom, { fill: d.fill })];
      if (d.characters !== "") out.push(textTag(d.geom.x + 8, d.geom.y + FONT + 4, d.characters));
      return out;
    }
  }
}

/** Emit a connector `<line>` (+ optional label), or null when an endpoint is unresolved. */
function connectorLine(
  c: Connector,
  centerMap: Map<string, { cx: number; cy: number }>,
): string | null {
  const from = centerMap.get(c.from);
  const to = centerMap.get(c.to);
  if (from === undefined || to === undefined) return null;
  const parts = [
    `<line x1="${r(from.cx)}" y1="${r(from.cy)}" x2="${r(to.cx)}" y2="${r(to.cy)}" ` +
      `stroke="${CONNECTOR_STROKE}" stroke-width="1.5" marker-end="url(#arrow)" />`,
  ];
  if (c.label !== undefined && c.label !== "") {
    parts.push(
      textTag((from.cx + to.cx) / 2, (from.cy + to.cy) / 2, c.label, {
        anchor: "middle",
        fill: LABEL_FILL,
        size: 11,
      }),
    );
  }
  return parts.join("\n");
}

/**
 * Render a spec to a deterministic SVG document string (PRD §12, approximate).
 * Pure: no clock, no randomness; coordinates rounded to 2 decimals so the same
 * spec always produces byte-identical output. No filesystem access.
 */
export function specToSvg(spec: Spec): string {
  const drawables = normalize(spec);
  const conns: Connector[] = "connectors" in spec && spec.connectors ? spec.connectors : [];
  const b = bounds(drawables);

  // Edit-only (or otherwise empty) spec → a minimal, valid SVG.
  if (b === null) {
    const side = MARGIN * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"></svg>\n`;
  }

  const vbX = r(b.x - MARGIN);
  const vbY = r(b.y - MARGIN);
  const vbW = r(b.width + MARGIN * 2);
  const vbH = r(b.height + MARGIN * 2);

  const centerMap = centers(drawables);
  const connectorLines = conns
    .map((c) => connectorLine(c, centerMap))
    .filter((s): s is string => s !== null);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vbW}" height="${vbH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">`,
  );
  if (connectorLines.length > 0) parts.push(ARROW_DEFS);
  for (const d of drawables) parts.push(...drawDrawable(d));
  parts.push(...connectorLines);
  parts.push("</svg>");
  return parts.join("\n") + "\n";
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm vitest run packages/uxfactory-cli/test/svg.test.ts`
Expected: PASS — determinism, SVG root/viewBox, design frame/shape/text/instance markup, XML-escaping, figjam section/sticky, connector center-resolution + arrow + skip-unresolved, edit-only minimal SVG.

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @uxfactory/cli typecheck`
Expected: exit 0 — `specToSvg` typechecks under strict / `noUncheckedIndexedAccess` / `verbatimModuleSyntax` (all `@uxfactory/spec` imports are `import type`).

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-cli
git commit -m "feat(cli): add pure deterministic specToSvg builder for headless render (§12)"
```

---

## Task 2: `src/render/raster.ts` + `commands/render.ts` + cli wiring (the `render` command)

Add `@resvg/resvg-js@2.6.2`. Implement `svgToPng` (the only module importing resvg). Implement `renderCmd`: `loadSpec` → on failure `printSpecProblem` (EXIT.TRANSPORT, writes nothing); on success build the SVG, choose SVG vs PNG by the `--out` extension (default `<spec-basename>.png` next to the spec), write it, print the path, EXIT.OK; on write error print and EXIT.TRANSPORT. Replace the `render` stub in `cli.ts` with a real command wiring `--out <file>`.

**Files:**

- Modify: `packages/uxfactory-cli/package.json` (add the dependency)
- Modify: `pnpm-workspace.yaml` (only if pnpm blocks the resvg build — see Step 4)
- Create: `packages/uxfactory-cli/src/render/raster.ts`
- Create: `packages/uxfactory-cli/src/commands/render.ts`
- Modify: `packages/uxfactory-cli/src/cli.ts` (remove the `render` stub row; add the `render` command)
- Test: `packages/uxfactory-cli/test/render.test.ts`

**Interfaces:**

```ts
export function svgToPng(svg: string): Buffer; // @resvg/resvg-js; deterministic within a process
export interface RenderFlags {
  out?: string;
}
export function renderCmd(file: string, flags: RenderFlags, io: IO): Promise<number>;
```

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-cli/test/render.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderCmd } from "../src/commands/render.js";
import { EXIT } from "../src/exit.js";
import { makeIO, matchingSpec } from "./helpers.js";

/** The 8-byte PNG signature. */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let dir: string;
let specPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uxf-render-"));
  specPath = path.join(dir, "spec.json");
  await writeFile(specPath, JSON.stringify(matchingSpec), "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("renderCmd", () => {
  it("writes a valid PNG and prints the path", async () => {
    const out = path.join(dir, "out.png");
    const io = makeIO();
    expect(await renderCmd(specPath, { out }, io)).toBe(EXIT.OK);
    const buf = await readFile(out);
    expect(buf.length).toBeGreaterThan(8);
    expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(io.outText()).toContain(out);
  });

  it("writes raw SVG when --out ends in .svg", async () => {
    const out = path.join(dir, "out.svg");
    const io = makeIO();
    expect(await renderCmd(specPath, { out }, io)).toBe(EXIT.OK);
    const svg = await readFile(out, "utf8");
    expect(svg).toContain("<svg");
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("defaults the output to <spec-basename>.png next to the spec", async () => {
    const io = makeIO();
    expect(await renderCmd(specPath, {}, io)).toBe(EXIT.OK);
    const buf = await readFile(path.join(dir, "spec.png"));
    expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true);
  });

  it("returns 2 on an invalid spec and writes nothing", async () => {
    await writeFile(specPath, JSON.stringify({ frames: [{ name: "f" }] }), "utf8");
    const out = path.join(dir, "out.png");
    const io = makeIO();
    expect(await renderCmd(specPath, { out }, io)).toBe(EXIT.TRANSPORT);
    await expect(readFile(out)).rejects.toThrow();
  });

  it("renders the same spec to identical PNG bytes within a process", async () => {
    const a = path.join(dir, "a.png");
    const b = path.join(dir, "b.png");
    const io = makeIO();
    expect(await renderCmd(specPath, { out: a }, io)).toBe(EXIT.OK);
    expect(await renderCmd(specPath, { out: b }, io)).toBe(EXIT.OK);
    expect((await readFile(a)).equals(await readFile(b))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/render.test.ts`
Expected: FAIL — `../src/commands/render.js` does not exist yet (cannot find module).

- [ ] **Step 3: Add the `@resvg/resvg-js` dependency**

Edit `packages/uxfactory-cli/package.json` — add to `dependencies` (keep keys sorted; the block becomes):

```json
  "dependencies": {
    "@resvg/resvg-js": "2.6.2",
    "@uxfactory/bridge": "workspace:*",
    "@uxfactory/spec": "workspace:*",
    "commander": "14.0.1",
    "yaml": "2.9.0"
  },
```

- [ ] **Step 4: Install and handle the build-script policy if triggered**

Run: `pnpm install`
Expected: installs `@resvg/resvg-js@2.6.2` and its platform binary (`@resvg/resvg-js-darwin-arm64` on this Mac), updating `pnpm-lock.yaml`. `@resvg/resvg-js` ships prebuilt napi binaries via optionalDependencies and has no postinstall, so pnpm 11 should NOT block it.

If — and only if — `pnpm install` prints that build scripts for `@resvg/resvg-js` were ignored/blocked, add it to the existing `allowBuilds` block in `pnpm-workspace.yaml` (mirroring the esbuild approval) and re-run `pnpm install`:

```yaml
allowBuilds:
  esbuild: true
  "@resvg/resvg-js": true
```

- [ ] **Step 5: Implement `src/render/raster.ts` (complete)**

`packages/uxfactory-cli/src/render/raster.ts`:

```ts
import { Resvg } from "@resvg/resvg-js";

/**
 * Rasterize an SVG document to a PNG Buffer (PRD §12, approximate raster).
 * This is the ONLY module that imports `@resvg/resvg-js`. Output is deterministic
 * within a process for a given SVG; text fidelity depends on the host's available
 * fonts — the documented approximation. Renders at the SVG's intrinsic size over a
 * white background.
 */
export function svgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    background: "white",
    fitTo: { mode: "original" },
  });
  return resvg.render().asPng();
}
```

- [ ] **Step 6: Implement `src/commands/render.ts` (complete)**

`packages/uxfactory-cli/src/commands/render.ts`:

```ts
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../exit.js";
import { loadSpec, printSpecProblem } from "../spec-file.js";
import { specToSvg } from "../render/svg.js";
import { svgToPng } from "../render/raster.js";
import type { Spec } from "@uxfactory/spec";
import type { IO } from "../io.js";

/** Flags for `uxfactory render`. */
export interface RenderFlags {
  out?: string;
}

/** Default output path: `<spec-basename-without-extension>.png` beside the spec. */
function defaultOut(file: string): string {
  const base = path.basename(file).replace(/\.[^.]+$/, "");
  return path.join(path.dirname(file), `${base}.png`);
}

/**
 * `uxfactory render <spec> --out <file>` — approximate offline raster (PRD §12).
 * No bridge, no plugin, no Figma. Loads + validates the spec, builds a deterministic
 * SVG, then writes raw SVG (`--out *.svg`) or a rasterized PNG (default). Returns
 * EXIT.OK on success; EXIT.TRANSPORT on an invalid/unparseable spec or a write error.
 */
export async function renderCmd(file: string, flags: RenderFlags, io: IO): Promise<number> {
  const loaded = await loadSpec(file);
  if (!loaded.ok) return printSpecProblem(io, loaded);

  const svg = specToSvg(loaded.spec as Spec);
  const out = flags.out ?? defaultOut(file);

  try {
    if (out.toLowerCase().endsWith(".svg")) {
      await writeFile(out, svg, "utf8");
    } else {
      await writeFile(out, svgToPng(svg));
    }
  } catch (err) {
    io.err(`cannot write ${out}: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT.TRANSPORT;
  }

  io.out(out);
  return EXIT.OK;
}
```

- [ ] **Step 7: Wire the `render` command into `cli.ts` (remove the stub row)**

In `packages/uxfactory-cli/src/cli.ts`, add the import alongside the other command imports (after the `driftCmd` import on line 15):

```ts
import { renderCmd } from "./commands/render.js";
```

Add the real command — place it immediately before the `const stubs` declaration:

```ts
program
  .command("render <spec>")
  .description("Render a spec to an image offline (approximate; no Figma)")
  .option("--out <file>", "output path (.png or .svg; default <spec>.png)")
  .action(async (spec: string, opts: { out?: string }) => {
    lastCode = await renderCmd(spec, { out: opts.out }, consoleIO);
  });
```

Remove the `["render", "5", …]` row from the `stubs` table so it reads:

```ts
const stubs: ReadonlyArray<readonly [name: string, phase: string, desc: string]> = [
  ["batch", "6", "Offline batch mode"],
  ["review", "7", "Conformance review"],
  ["snapshot", "roadmap", "Pull current canvas state back into a spec"],
];
```

(Leave `commands/stub.ts` and `test/stub.test.ts` untouched — `batch`/`review`/`snapshot` remain stubs, and `stub.test.ts` exercises `stubCmd` directly.)

- [ ] **Step 8: Run the new tests + full CLI suite + typecheck**

Run: `pnpm vitest run packages/uxfactory-cli/test/render.test.ts packages/uxfactory-cli/test/svg.test.ts packages/uxfactory-cli/test/cli.test.ts packages/uxfactory-cli/test/stub.test.ts && pnpm --filter @uxfactory/cli typecheck`
Expected: PASS — PNG signature + non-empty, `.svg` branch, default-out, invalid→2-writes-nothing, within-process determinism; the bin-wiring and stub suites still green; typecheck exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/uxfactory-cli pnpm-lock.yaml
git commit -m "feat(cli): implement 'uxfactory render' offline raster (SVG/PNG) (§12)"
```

(If Step 4 required editing `pnpm-workspace.yaml`, include it: `git add packages/uxfactory-cli pnpm-lock.yaml pnpm-workspace.yaml`.)

---

## Task 3: `src/render/figma-export.ts` (REST helper) + public exports + built-artifact & monorepo green

Add the Figma-accurate, token-gated REST image-export helper (`figmaImageExport`) with an injectable `fetch` for testing — the pixel-faithful path of §12 (needs a Figma token + a prior render into the file; the render report carries the page/node keys). Export the new public surface from `index.ts`. Verify the built bin renders a real PNG, then confirm the whole monorepo is green.

**Files:**

- Create: `packages/uxfactory-cli/src/render/figma-export.ts`
- Modify: `packages/uxfactory-cli/src/index.ts` (export the new surface)
- Test: `packages/uxfactory-cli/test/figma-export.test.ts`

**Interfaces:**

```ts
export interface FigmaExportOptions {
  token: string;
  fileKey: string;
  ids: string[];
  format?: "png" | "svg";
  scale?: number;
}
export interface FigmaImageResult {
  images: Record<string, string>;
}
export function figmaImageExport(
  opts: FigmaExportOptions,
  fetchImpl?: FetchLike,
): Promise<FigmaImageResult>;
```

- [ ] **Step 1: Write the failing test**

`packages/uxfactory-cli/test/figma-export.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { figmaImageExport } from "../src/render/figma-export.js";

/** A minimal fetch-like response. */
function res(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

describe("figmaImageExport", () => {
  it("builds the REST URL + X-Figma-Token header and parses images", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> | undefined;
    const fetchImpl = async (url: string, opts?: { headers?: Record<string, string> }) => {
      capturedUrl = url;
      capturedHeaders = opts?.headers;
      return res({ images: { "1:2": "https://img.figma/1.png" } });
    };

    const out = await figmaImageExport(
      { token: "tok-123", fileKey: "FILEKEY", ids: ["1:2", "3:4"], format: "png", scale: 2 },
      fetchImpl,
    );

    expect(out.images).toEqual({ "1:2": "https://img.figma/1.png" });
    expect(capturedUrl).toContain("https://api.figma.com/v1/images/FILEKEY");
    expect(capturedUrl).toContain("ids=1%3A2%2C3%3A4"); // "1:2,3:4" url-encoded
    expect(capturedUrl).toContain("format=png");
    expect(capturedUrl).toContain("scale=2");
    expect(capturedHeaders?.["X-Figma-Token"]).toBe("tok-123");
  });

  it("defaults to format=png and omits scale when not given", async () => {
    let capturedUrl = "";
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return res({ images: {} });
    };
    await figmaImageExport({ token: "t", fileKey: "K", ids: ["9:9"] }, fetchImpl);
    expect(capturedUrl).toContain("format=png");
    expect(capturedUrl).not.toContain("scale=");
  });

  it("throws on a non-200 response", async () => {
    const fetchImpl = async () => res({}, { ok: false, status: 403 });
    await expect(
      figmaImageExport({ token: "t", fileKey: "K", ids: ["1:1"] }, fetchImpl),
    ).rejects.toThrow(/403/);
  });

  it("throws when the body carries an `err` field", async () => {
    const fetchImpl = async () => res({ err: "Invalid node id", status: 400 });
    await expect(
      figmaImageExport({ token: "t", fileKey: "K", ids: ["1:1"] }, fetchImpl),
    ).rejects.toThrow(/Invalid node id/);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm vitest run packages/uxfactory-cli/test/figma-export.test.ts`
Expected: FAIL — `../src/render/figma-export.js` does not exist yet (cannot find module).

- [ ] **Step 3: Implement `src/render/figma-export.ts` (complete)**

`packages/uxfactory-cli/src/render/figma-export.ts`:

```ts
/** Options for a Figma REST image export. */
export interface FigmaExportOptions {
  /** Personal access token, sent as the `X-Figma-Token` header. */
  token: string;
  /** The file key (the `:key` in a Figma file URL). */
  fileKey: string;
  /** Node ids to export (e.g. `["1:2", "3:4"]`). */
  ids: string[];
  /** Image format; defaults to `"png"`. */
  format?: "png" | "svg";
  /** Raster scale factor (0.01–4); omitted from the request when absent. */
  scale?: number;
}

/** The parsed `{ images }` map: node id → temporary CDN URL. */
export interface FigmaImageResult {
  images: Record<string, string>;
}

/** The slice of the Fetch API this helper depends on (injectable for tests). */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Figma-accurate, token-gated image export (PRD §12, REST path). Constructs
 * `GET https://api.figma.com/v1/images/<fileKey>?ids=<id,id>&format=<fmt>&scale=<n>`
 * with the `X-Figma-Token` header and returns the parsed `{ images }` map (node id →
 * a temporary CDN URL the caller downloads). This is the pixel-faithful path: it
 * requires a Figma token AND a prior render into the file — the render report (§7.4)
 * carries the page/node keys to pass as `ids`. `fetchImpl` defaults to the global
 * `fetch`. Throws a clear error on a non-200 response or an `err` field in the body.
 */
export async function figmaImageExport(
  opts: FigmaExportOptions,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<FigmaImageResult> {
  const params = new URLSearchParams();
  params.set("ids", opts.ids.join(","));
  params.set("format", opts.format ?? "png");
  if (opts.scale !== undefined) params.set("scale", String(opts.scale));

  const url = `https://api.figma.com/v1/images/${encodeURIComponent(opts.fileKey)}?${params.toString()}`;
  const response = await fetchImpl(url, { headers: { "X-Figma-Token": opts.token } });

  if (!response.ok) {
    throw new Error(`Figma image export failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as { images?: Record<string, string>; err?: string | null };
  if (body.err) {
    throw new Error(`Figma image export error: ${body.err}`);
  }
  if (body.images === undefined || body.images === null) {
    throw new Error("Figma image export returned no images");
  }
  return { images: body.images };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm vitest run packages/uxfactory-cli/test/figma-export.test.ts`
Expected: PASS — URL + header construction, `ids` url-encoding, `format`/`scale` params, default format / omitted scale, non-200 throws, `err`-field throws.

- [ ] **Step 5: Export the new public surface from `index.ts`**

Append to `packages/uxfactory-cli/src/index.ts` (after the existing drift exports on line 29):

```ts
export { specToSvg } from "./render/svg.js";
export { svgToPng } from "./render/raster.js";
export { figmaImageExport } from "./render/figma-export.js";
export type { FigmaExportOptions, FigmaImageResult, FetchLike } from "./render/figma-export.js";
export { renderCmd } from "./commands/render.js";
export type { RenderFlags } from "./commands/render.js";
```

- [ ] **Step 6: Run the whole CLI suite + typecheck**

Run: `pnpm vitest run packages/uxfactory-cli && pnpm --filter @uxfactory/cli typecheck`
Expected: PASS — svg / render / figma-export plus every prior CLI suite; typecheck exit 0 (all type-only imports use `import type`; `Resvg` is a value import; `Buffer` is the `@types/node` global).

- [ ] **Step 7: Verify the built bin renders a real PNG in real Node**

Run:

```bash
pnpm -r build

TMP="$(mktemp -d)"
cat > "$TMP/diagram.uxfactory.json" <<'JSON'
{ "editor": "figma",
  "frames": [ { "name": "F", "x": 0, "y": 0, "width": 320, "height": 140, "children": [
    { "type": "shape", "name": "a", "x": 10, "y": 40, "width": 100, "height": 50, "fill": "#1E88E5", "characters": "API" },
    { "type": "shape", "name": "b", "x": 200, "y": 40, "width": 100, "height": 50 }
  ] } ],
  "connectors": [ { "from": "a", "to": "b", "label": "calls" } ] }
JSON

CLI="$PWD/packages/uxfactory-cli/dist/src/cli.js"

node "$CLI" render "$TMP/diagram.uxfactory.json" --out "$TMP/out.png"; test $? -eq 0 && echo "render-png -> 0 OK"
node -e 'const fs=require("fs");const b=fs.readFileSync(process.argv[1]);const s=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);process.exit(b.length>8 && b.subarray(0,8).equals(s)?0:1)' "$TMP/out.png" && echo "png-signature OK"

node "$CLI" render "$TMP/diagram.uxfactory.json" --out "$TMP/out.svg"; test $? -eq 0 && grep -q "<svg" "$TMP/out.svg" && echo "render-svg -> 0 OK"

echo '{ "frames": [ { "name": "f" } ] }' > "$TMP/bad.json"
node "$CLI" render "$TMP/bad.json" --out "$TMP/bad.png"; test $? -eq 2 && echo "render-invalid -> 2 OK"

rm -rf "$TMP"
```

Expected: prints `render-png -> 0 OK`, `png-signature OK`, `render-svg -> 0 OK`, `render-invalid -> 2 OK`. Proves the compiled bin loads in real Node ESM, `@resvg/resvg-js` resolves and rasterizes from `node_modules`, `@uxfactory/spec` resolves from its built `dist`, and the §12 exit contract holds end-to-end (`0` write success / `2` invalid spec).

- [ ] **Step 8: Whole-monorepo green check**

Run: `pnpm typecheck && pnpm test && pnpm format:check`
Expected: all exit 0 (run `pnpm format` first if `format:check` flags the new files). Confirms the render modules and the new `@resvg/resvg-js` dependency integrate without breaking spec/gate/bridge/plugin or any existing suite.

- [ ] **Step 9: Commit**

```bash
git add packages/uxfactory-cli
git commit -m "feat(cli): add Figma REST image-export helper + render public exports (§12)"
```

---

## Self-Review

**1. Spec coverage** (against THE DESIGN and PRD §12):

- **`specToSvg` pure + deterministic** — no `Date`/random; coordinates rounded via `r()` to 2 decimals; first-occurrence center map; `specToSvg(x) === specToSvg(x)` test → Task 1. ✅
- **Canvas bounds + viewBox** — `bounds()` over all frame/section/child geometry + `MARGIN`; width/height/viewBox set from it → Task 1. ✅
- **Design spec** — frame → `<rect>` (light fill, stroke) + name `<text>` label; shape → `<rect>` at x/y/w/h with `fill` (default light), `stroke`/`stroke-width` when present, `rx`=cornerRadius, centered `characters` text; text → `<text>` with characters; instance → dashed-stroke placeholder `<rect>` labelled with `asset` → Task 1 (asserted). ✅
- **FigJam spec** — section → `<rect>` + label; sticky → filled `<rect>` (sticky color) + characters; shape/instance shared → Task 1 (asserted). ✅
- **Connectors** — resolve `from`/`to` by node name to centers; `<line>` + arrowhead `<marker>`; unresolved endpoint skipped (test asserts exactly one `<line>` from two connectors) → Task 1. ✅
- **XML-escape + rounded coords** — `esc()` on every text/asset/label; `r()` on every coordinate → Task 1 (escaping asserted). ✅
- **Edit-only → minimal SVG** — `bounds()` returns null → a valid empty `<svg>` with no `<rect>`/`<line>`, no crash → Task 1. ✅
- **`raster.ts` `svgToPng`** — `new Resvg(svg, {...}).render().asPng()`; ONLY module importing resvg; deterministic white background at original size → Task 2. ✅
- **`renderCmd`** — `loadSpec` → invalid/parse → `printSpecProblem` (EXIT.TRANSPORT, nothing written); `.svg` out → write SVG; else rasterize to PNG; default out `<basename>.png`; write error → EXIT.TRANSPORT; success → print path → EXIT.OK → Task 2 (all branches asserted). ✅
- **`render` stub replaced + `--out` wired** — real commander command added, `render` row removed from the `stubs` table; `stub.test.ts` stays green → Task 2. ✅
- **`figmaImageExport`** — builds `GET /v1/images/<fileKey>?ids&format&scale`, `X-Figma-Token` header, parses `{images}`, throws on non-200 / `err`, injectable `fetchImpl` (defaults to global `fetch`) → Task 3 (asserted). ✅
- **Public exports + built-artifact + monorepo green** — `specToSvg`/`svgToPng`/`figmaImageExport`/`renderCmd` (+ types) exported; built bin renders a real PNG (signature checked) and honors exit codes; `pnpm typecheck && pnpm test && pnpm format:check` → Task 3. ✅
- **Exit codes** — only `0`/`2` for render (no `1`; there is no gate) → Tasks 2–3. ✅
- **Dependency policy** — `@resvg/resvg-js@2.6.2` added; `allowBuilds` fallback documented; `pnpm-lock.yaml` committed; no new `paths` entry (resvg self-typed, spec already mapped) → Task 2. ✅

**2. Placeholder scan:** No "TODO"/"TBD"/"similar to"/"add error handling here". Every implement step ships complete code. The "approximate" comments restate the §12 contract; they are documentation, not placeholders. ✅

**3. Type consistency:** `Spec`/`Connector`/`FrameChild`/`SectionChild`/`IO` are `import type` (verbatimModuleSyntax); `Resvg`, `writeFile`, `path`, `EXIT`, `loadSpec`, `printSpecProblem`, `specToSvg`, `svgToPng` are value imports. The `Drawable` union is discriminated by `kind` and exhaustively switched in `leaf`/`drawDrawable` (the spec's `child.type` covers shape/text/instance/sticky). `loadSpec` yields `spec: unknown`; `renderCmd` casts `loaded.spec as Spec` (the spec is already schema-valid at that point). `svgToPng` returns the `@types/node` `Buffer` global, consumed by `writeFile`. `exactOptionalPropertyTypes:false` (base) makes the optional-undefined assignments in `leaf`/`rectTag` legal. `FetchLike` is a structural subset of the global `fetch`, cast once at the default-parameter site. ✅

**4. Judgment calls** (where the design left a choice or required a small extension):

- **Child coordinates treated as absolute page coordinates.** The render report (`test/helpers.ts`) records a frame child at the same x/y the spec gives it, so the gate compares them directly; `specToSvg` follows suit and does not offset children by their frame origin. Frames/sections are containers drawn at their own geometry, children at theirs. (Spec authors using frame-relative coordinates would see drift — but that would also fail the gate, so the offline raster stays faithful to the canonical render.)
- **Default-out strips only the last extension.** `deployment.uxfactory.json` → `deployment.uxfactory.png` (not `deployment.png`). The design says "`<specbasename>.png`"; stripping a single extension keeps the disambiguating middle segment and is least-surprising for the common `*.uxfactory.json` naming.
- **`.svg` vs PNG chosen by output extension (case-insensitive); everything non-`.svg` rasterizes.** Matches the design ("`--out` ends in `.svg` → SVG; `.png`/no-extension/default → PNG"). A `--figma` flag on `render` is explicitly OUT OF SCOPE (only the exported `figmaImageExport` + unit tests ship).
- **`FetchLike` is a minimal structural type, not the DOM `fetch` type.** Keeps `figma-export.ts` free of `lib.dom` and lets tests pass a 3-line mock; the global `fetch` is cast at the default-parameter site. The helper returns the parsed `{ images }` (node id → CDN URL); downloading those URLs is the caller's concern, consistent with "just the exported function + unit tests."
- **Approximate styling constants are fixed in-module.** Margins, fonts, default fills/strokes, sticky/instance default sizes are module constants (no theming surface) — §12 only promises an approximation sufficient for PR previews / visual diffs / batch review, and fixed constants keep the SVG deterministic.
- **`allowBuilds` step is conditional.** `@resvg/resvg-js` ships prebuilt napi binaries with no postinstall, so pnpm 11 should install it without approval; the `pnpm-workspace.yaml` edit is included only if the install actually reports a blocked build, mirroring the committed esbuild approval.

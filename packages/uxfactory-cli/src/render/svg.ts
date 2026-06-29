import type {
  Spec,
  Connector,
  FrameChild,
  SectionChild,
} from "@uxfactory/spec";

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
          textTag(d.geom.x + d.geom.width / 2, d.geom.y + d.geom.height / 2 + FONT / 3, d.characters, {
            anchor: "middle",
          }),
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

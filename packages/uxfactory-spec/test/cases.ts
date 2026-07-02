export interface Case {
  name: string;
  input: unknown;
  valid: boolean;
}

export const cases: Case[] = [
  {
    name: "minimal design spec",
    valid: true,
    input: {
      frames: [
        {
          name: "f",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10, height: 10 }],
        },
      ],
    },
  },
  {
    name: "design spec with instance + connectors + editor",
    valid: true,
    input: {
      editor: "figma",
      page: "Architecture",
      frames: [
        {
          name: "f",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          children: [{ type: "instance", name: "i", asset: "aws:lambda", x: 1, y: 2 }],
        },
      ],
      connectors: [{ from: "s", to: "i", label: "calls" }],
    },
  },
  {
    name: "design spec carrying edits",
    valid: true,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 1, height: 1 }],
      edits: [{ id: "1:2", set: { x: 5 } }],
    },
  },
  {
    name: "figjam spec with sticky + connectors",
    valid: true,
    input: {
      editor: "figjam",
      sections: [
        {
          name: "retro",
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          children: [{ type: "sticky", name: "w", x: 1, y: 1, characters: "ok" }],
        },
      ],
      connectors: [{ from: "w", to: "w" }],
    },
  },
  {
    name: "edit-only spec by id and name",
    valid: true,
    input: {
      edits: [
        { id: "12:34", set: { x: 120, fill: "#43A047" } },
        { name: "redis-cache", set: { characters: "Redis 7.2" } },
      ],
    },
  },
  {
    name: "unknown edit property",
    valid: false,
    input: { edits: [{ id: "1", set: { color: "#fff" } }] },
  },
  { name: "edit with neither id nor name", valid: false, input: { edits: [{ set: { x: 1 } }] } },
  { name: "empty object", valid: false, input: {} },
  { name: "design spec missing frames", valid: false, input: { page: "x" } },
  { name: "figjam missing editor", valid: false, input: { sections: [] } },
  {
    name: "shape missing height",
    valid: false,
    input: {
      frames: [
        {
          name: "f",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10 }],
        },
      ],
    },
  },
  {
    name: "figjam with frames (contradiction)",
    valid: false,
    input: { editor: "figjam", frames: [{ name: "f", x: 0, y: 0, width: 1, height: 1 }] },
  },
  { name: "extra top-level property", valid: false, input: { frames: [], extra: 1 } },
  { name: "opacity above 1", valid: false, input: { edits: [{ id: "1", set: { opacity: 1.5 } }] } },
  { name: "bad hex color", valid: false, input: { edits: [{ id: "1", set: { fill: "red" } }] } },
  {
    name: "edit-only spec with editor present",
    valid: true,
    input: { editor: "figma", edits: [{ id: "1", set: { x: 1 } }] },
  },
  { name: "null root", valid: false, input: null },
  { name: "array root", valid: false, input: [] },
  { name: "string root", valid: false, input: "nope" },
  { name: "number root", valid: false, input: 5 },
  {
    name: "frame with vertical auto-layout + sizing + fill",
    valid: true,
    input: {
      frames: [
        {
          name: "col", x: 0, y: 0, width: 320, height: 480, fill: "#FFFFFF",
          layout: { mode: "vertical", gap: 16, padding: 24, primaryAlign: "start", counterAlign: "center" },
          sizing: { horizontal: "fill", vertical: "hug" },
          children: [{ type: "text", name: "t", x: 0, y: 0, width: 100, height: 20, characters: "Hi" }],
        },
      ],
    },
  },
  {
    name: "frame with object padding + nested frame child",
    valid: true,
    input: {
      frames: [
        {
          name: "outer", x: 0, y: 0, width: 400, height: 400,
          layout: { mode: "horizontal", padding: { top: 8, right: 8, bottom: 8, left: 8 } },
          children: [
            { name: "inner", x: 0, y: 0, width: 100, height: 100,
              layout: { mode: "vertical", gap: 4 }, children: [] },
          ],
        },
      ],
    },
  },
  {
    name: "invalid auto-layout mode is rejected",
    valid: false,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10, layout: { mode: "diagonal" } }],
    },
  },
  {
    name: "invalid sizing value is rejected",
    valid: false,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10, sizing: { horizontal: "stretch" } }],
    },
  },
  {
    name: "design spec with local component + two instances + overrides",
    valid: true,
    input: {
      components: {
        button: {
          name: "Button", width: 120, height: 40,
          layout: { mode: "horizontal", gap: 8, padding: 12 },
          children: [{ type: "text", name: "label", x: 0, y: 0, width: 96, height: 16, characters: "OK" }],
        },
      },
      frames: [
        {
          name: "screen", x: 0, y: 0, width: 400, height: 300,
          children: [
            { type: "component-instance", name: "primary", component: "button", x: 20, y: 20,
              overrides: { label: { characters: "Pay now", fill: "#FFFFFF" } } },
            { type: "component-instance", name: "secondary", component: "button", x: 20, y: 80,
              overrides: { label: { characters: "Cancel", visible: true } } },
          ],
        },
      ],
    },
  },
  {
    name: "component-instance missing component id is rejected",
    valid: false,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10,
        children: [{ type: "component-instance", name: "x", x: 0, y: 0 }] }],
    },
  },
  {
    name: "instance override with an unknown key is rejected",
    valid: false,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10,
        children: [{ type: "component-instance", name: "x", component: "b", x: 0, y: 0,
          overrides: { label: { color: "#fff" } } }] }],
    },
  },
  {
    name: "shape with drop-shadow effect + per-corner radius",
    valid: true,
    input: {
      frames: [
        {
          name: "f", x: 0, y: 0, width: 200, height: 200,
          effects: [{ type: "drop-shadow", color: "#000000", opacity: 0.2, x: 0, y: 4, blur: 12, spread: 0 }],
          children: [
            { type: "shape", name: "card", x: 0, y: 0, width: 100, height: 60,
              cornerRadius: { tl: 8, tr: 8, br: 0, bl: 0 },
              effects: [{ type: "inner-shadow", color: "#101828", x: 0, y: 1, blur: 2 }] },
          ],
        },
      ],
    },
  },
  {
    name: "numeric cornerRadius still valid (backward-compat)",
    valid: true,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10,
        children: [{ type: "shape", name: "s", x: 0, y: 0, width: 10, height: 10, cornerRadius: 4 }] }],
    },
  },
  {
    name: "invalid effect type is rejected",
    valid: false,
    input: {
      frames: [{ name: "f", x: 0, y: 0, width: 10, height: 10,
        effects: [{ type: "glow", color: "#000000", x: 0, y: 0, blur: 1 }] }],
    },
  },
  {
    name: "text node with typography fields",
    valid: true,
    input: { frames: [{ name: "f", x: 0, y: 0, width: 100, height: 100, children: [
      { type: "text", name: "h1", x: 0, y: 0, width: 90, height: 30, characters: "Hi",
        fontSize: 24, fontWeight: 700, fontFamily: "Fraunces", lineHeight: 32 },
    ] }] },
  },
  {
    name: "invalid fontWeight is rejected",
    valid: false,
    input: { frames: [{ name: "f", x: 0, y: 0, width: 100, height: 100, children: [
      { type: "text", name: "t", x: 0, y: 0, width: 90, height: 30, characters: "Hi", fontWeight: 0 },
    ] }] },
  },
];

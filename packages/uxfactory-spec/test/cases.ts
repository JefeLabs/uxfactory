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
];

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import { BridgeClient } from "../src/client.js";
import { batchCmd } from "../src/commands/batch.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

let root: string;
let dataDir: string;
let specsDir: string;
let handle: { url: string; close: () => Promise<void> };
let client: BridgeClient;

const cleanSpec = {
  editor: "figma",
  frames: [
    {
      name: "story-1-home",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      children: [
        {
          type: "shape",
          name: "home-empty-state",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          fill: "#1E88E5",
        },
        {
          type: "shape",
          name: "home-success-view",
          x: 0,
          y: 20,
          width: 10,
          height: 10,
          fill: "#111111",
        },
      ],
    },
  ],
};

const tokens = { colors: { brand: "#1E88E5", ink: "#111111" } };
const stories = {
  stories: [
    {
      id: "story-1",
      role: "user",
      goal: "see home",
      benefit: "fast",
      acceptanceCriteria: [
        { statement: "no data", impliedState: "empty" },
        { statement: "ok", impliedState: "success" },
      ],
    },
  ],
};

async function writeRegistry(inputs: Record<string, unknown>): Promise<void> {
  await writeFile(
    path.join(root, "uxfactory.batch.json"),
    JSON.stringify({ version: 1, inputs, maxIterations: 6 }),
    "utf8",
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-batch-"));
  dataDir = path.join(root, ".uxfactory");
  specsDir = path.join(root, "specs");
  await mkdir(specsDir, { recursive: true });
  await mkdir(path.join(root, "design"), { recursive: true });
  await writeFile(path.join(specsDir, "home.uxfactory.json"), JSON.stringify(cleanSpec), "utf8");
  handle = await startBridge({ dataDir: path.join(root, ".bridge"), port: 0 });
  client = new BridgeClient(handle.url);
});

afterEach(async () => {
  await handle.close();
  await rm(root, { recursive: true, force: true });
});

describe("batchCmd", () => {
  it("returns 2 when uxfactory.batch.json is missing", async () => {
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.TRANSPORT);
  });

  it("clean batch → 0, writes a report and a preview per spec", async () => {
    await writeFile(path.join(root, "design", "tokens.ds.json"), JSON.stringify(tokens), "utf8");
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ tokens: "design/tokens.ds.json", stories: "design/stories.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.OK);
    const report = JSON.parse(await readFile(path.join(dataDir, "batch", "report.json"), "utf8"));
    expect(report.clean).toBe(true);
    const previews = await readdir(path.join(dataDir, "batch", "previews"));
    expect(previews).toContain("home.uxfactory.svg");
  });

  it("a must-pass gate failure → 1 (ad-hoc color)", async () => {
    await writeFile(
      path.join(specsDir, "home.uxfactory.json"),
      JSON.stringify({
        editor: "figma",
        frames: [
          {
            name: "story-1-home",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            children: [
              {
                type: "shape",
                name: "home-empty-state",
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                fill: "#abcdef",
              },
              { type: "shape", name: "home-success-view", x: 0, y: 1, width: 1, height: 1 },
            ],
          },
        ],
      }),
      "utf8",
    );
    await writeFile(path.join(root, "design", "tokens.ds.json"), JSON.stringify(tokens), "utf8");
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ tokens: "design/tokens.ds.json", stories: "design/stories.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.GATE_FAIL);
    const report = JSON.parse(await readFile(path.join(dataDir, "batch", "report.json"), "utf8"));
    expect(report.mustPassFailed).toBe(true);
  });

  it("skip-and-declare: absent inputs are reported as skipped, batch still clean → 0", async () => {
    await writeRegistry({}); // no inputs registered
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, json: true, cwd: root }, io, client)).toBe(EXIT.OK);
    const printed = JSON.parse(io.outText());
    expect(printed.checks.every((c: { status: string }) => c.status === "skip")).toBe(true);
  });

  it("returns 2 when a registered input file is unreadable", async () => {
    await writeRegistry({ tokens: "design/missing.ds.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.TRANSPORT);
  });

  // Fix 5 regression: malformed tokens.ds.json (colors not an object) → exit 2
  it("Fix 5: malformed tokens.ds.json (colors not an object) → returns 2", async () => {
    const malformedTokens = { colors: ["red", "blue"] }; // array, not object
    await writeFile(
      path.join(root, "design", "tokens.ds.json"),
      JSON.stringify(malformedTokens),
      "utf8",
    );
    await writeRegistry({ tokens: "design/tokens.ds.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/malformed tokens/);
  });

  it("--stage on a clean batch posts the specs + previews to the bridge", async () => {
    await writeFile(path.join(root, "design", "tokens.ds.json"), JSON.stringify(tokens), "utf8");
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ tokens: "design/tokens.ds.json", stories: "design/stories.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, stage: true, cwd: root }, io, client)).toBe(EXIT.OK);
    const res = await fetch(`${handle.url}/batch`);
    expect(res.status).toBe(200);
    const batch = (await res.json()) as { items: { spec: unknown; preview?: string }[] };
    expect(batch.items.length).toBe(1);
    expect(typeof batch.items[0]!.preview).toBe("string");
  });
});

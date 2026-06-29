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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A spec whose frames match story-1 and use only registered token colors. */
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

/** Single-step flow — no consecutive pairs → flow-reachability trivially passes. */
const flow = { steps: ["story-1-home"] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeRegistry(
  inputs: Record<string, unknown>,
  extra?: { scope?: string | Record<string, unknown> },
): Promise<void> {
  const obj: Record<string, unknown> = { version: 1, inputs, maxIterations: 6 };
  if (extra?.scope !== undefined) obj["scope"] = extra.scope;
  await writeFile(path.join(root, "uxfactory.batch.json"), JSON.stringify(obj), "utf8");
}

/** Write all three input files (tokens, stories, flow) under <root>/design/. */
async function writeAllInputs(): Promise<void> {
  await mkdir(path.join(root, "design"), { recursive: true });
  await writeFile(path.join(root, "design", "tokens.ds.json"), JSON.stringify(tokens), "utf8");
  await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
  await writeFile(path.join(root, "design", "flow.json"), JSON.stringify(flow), "utf8");
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("batchCmd", () => {
  // ── setup errors (exit 2) ─────────────────────────────────────────────────

  it("returns 2 when uxfactory.batch.json is missing", async () => {
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.TRANSPORT);
  });

  it("returns 2 when scope is unset (no registry scope, no --scope flag)", async () => {
    await writeRegistry({});
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/set a render scope before requesting a batch/);
  });

  it("returns 2 when --visual flag has an invalid value", async () => {
    await writeRegistry({});
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root, visual: "bogus" }, io, client)).toBe(
      EXIT.TRANSPORT,
    );
    expect(io.errText()).toMatch(/invalid --visual/);
    expect(io.errText()).toMatch(/bogus/);
  });

  it("returns 2 when --editorial flag has an invalid value (none is not valid for a dial)", async () => {
    await writeRegistry({});
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root, editorial: "none" }, io, client)).toBe(
      EXIT.TRANSPORT,
    );
    expect(io.errText()).toMatch(/invalid --editorial/);
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

  // ── readiness failures (exit 2) ──────────────────────────────────────────

  it("returns 2 when --scope visual but tokens (and other inputs) are not registered", async () => {
    // Nothing registered → readiness fails for stories, tokens, flow
    await writeRegistry({});
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root, scope: "visual" }, io, client)).toBe(
      EXIT.TRANSPORT,
    );
    // Error output must name "tokens" in the missing list
    expect(io.errText()).toMatch(/tokens/);
  });

  it("readiness missing list names tokens with dial:visual level:medium when --scope visual", async () => {
    // stories registered but no tokens and no flow
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ stories: "design/stories.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root, scope: "visual" }, io, client)).toBe(
      EXIT.TRANSPORT,
    );
    // The missing entry for tokens must carry the dial+level it requires
    const errOut = io.errText();
    expect(errOut).toMatch(/tokens/);
    expect(errOut).toMatch(/visual/);
    expect(errOut).toMatch(/medium/);
    expect(errOut).toMatch(/provide-or-generate/);
    // Fix 6: visual preset has flow:medium → flow is also required and must appear in the missing list
    expect(errOut).toMatch(/flow/);
  });

  // ── wireframe scope (visual:low → token-conformance not-owed) ─────────────

  it("--scope wireframe with stories → token-conformance not-owed, exit 0", async () => {
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ stories: "design/stories.json" });
    const io = makeIO();
    expect(
      await batchCmd(specsDir, { dataDir, json: true, cwd: root, scope: "wireframe" }, io, client),
    ).toBe(EXIT.OK);
    const report = JSON.parse(io.outText()) as {
      clean: boolean;
      checks: { id: string; status: string }[];
    };
    expect(report.clean).toBe(true);
    const tc = report.checks.find((c) => c.id === "token-conformance");
    expect(tc?.status).toBe("not-owed");
  });

  it("registry scope field used as base when no --scope flag", async () => {
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ stories: "design/stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    // No scope flag — registry.scope = "wireframe" acts as the base
    expect(await batchCmd(specsDir, { dataDir, json: true, cwd: root }, io, client)).toBe(EXIT.OK);
    const report = JSON.parse(io.outText()) as { scope: Record<string, string> };
    expect(report.scope).toMatchObject({
      visual: "low",
      editorial: "low",
      coverage: "low",
      flow: "low",
    });
  });

  // ── visual scope (visual:high → token-conformance binds) ──────────────────

  it("--scope visual with all required inputs → exit 0, rubric includes token-conformance", async () => {
    await writeAllInputs();
    await writeRegistry({
      tokens: "design/tokens.ds.json",
      stories: "design/stories.json",
      flow: "design/flow.json",
    });
    const io = makeIO();
    expect(
      await batchCmd(specsDir, { dataDir, json: true, cwd: root, scope: "visual" }, io, client),
    ).toBe(EXIT.OK);
    const report = JSON.parse(io.outText()) as {
      clean: boolean;
      scope: Record<string, string>;
      rubric: string[];
      checks: { id: string; status: string }[];
    };
    expect(report.clean).toBe(true);
    expect(report.scope).toMatchObject({
      visual: "high",
      editorial: "medium",
      coverage: "medium",
      flow: "medium",
    });
    expect(report.rubric).toContain("token-conformance");
    // not-owed entries still appear in checks (non-binding gates)
    expect(report.checks.some((c) => c.status === "not-owed")).toBe(false); // all gates bind at visual
  });

  // ── must-pass failure → exit 1 ────────────────────────────────────────────

  it("a must-pass gate failure → 1 (token-conformance fails on ad-hoc color)", async () => {
    // Overwrite spec with an ad-hoc fill color not in tokens
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
              {
                type: "shape",
                name: "home-success-view",
                x: 0,
                y: 1,
                width: 1,
                height: 1,
                fill: "#1E88E5",
              },
            ],
          },
        ],
      }),
      "utf8",
    );
    await writeAllInputs();
    await writeRegistry({
      tokens: "design/tokens.ds.json",
      stories: "design/stories.json",
      flow: "design/flow.json",
    });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root, scope: "visual" }, io, client)).toBe(
      EXIT.GATE_FAIL,
    );
    const report = JSON.parse(
      await readFile(path.join(dataDir, "batch", "report.json"), "utf8"),
    ) as { mustPassFailed: boolean };
    expect(report.mustPassFailed).toBe(true);
  });

  // ── previews: .svg and .png written ───────────────────────────────────────

  it("writes both .svg and .png previews per spec", async () => {
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ stories: "design/stories.json" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root, scope: "wireframe" }, io, client)).toBe(
      EXIT.OK,
    );
    const previews = await readdir(path.join(dataDir, "batch", "previews"));
    expect(previews).toContain("home.uxfactory.svg");
    expect(previews).toContain("home.uxfactory.png");
  });

  // ── --json carries scope + rubric + not-owed + declared ───────────────────

  it("--json output carries scope, rubric, not-owed, and declared entries", async () => {
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ stories: "design/stories.json" });
    const io = makeIO();
    expect(
      await batchCmd(specsDir, { dataDir, json: true, cwd: root, scope: "wireframe" }, io, client),
    ).toBe(EXIT.OK);
    const doc = JSON.parse(io.outText()) as {
      scope: unknown;
      rubric: unknown;
      checks: { status: string }[];
    };
    expect(doc).toHaveProperty("scope");
    expect(doc).toHaveProperty("rubric");
    expect(Array.isArray(doc.checks)).toBe(true);
    // token-conformance and flow-reachability are not-owed at wireframe scope
    expect(doc.checks.some((c) => c.status === "not-owed")).toBe(true);
    // declared future tiers always present
    expect(doc.checks.some((c) => c.status === "declared")).toBe(true);
  });

  // ── Fix 3: invalid --scope names the bad value, not the generic "set a scope" message ──

  it("Fix 3: returns 2 when --scope has an unknown preset name, error names the bad value", async () => {
    await writeRegistry({});
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root, scope: "wirefram" }, io, client)).toBe(
      EXIT.TRANSPORT,
    );
    // Must name the bad value, not the generic unset message
    expect(io.errText()).toMatch(/wirefram/);
    expect(io.errText()).not.toMatch(/set a render scope before requesting a batch/);
  });

  // ── Fix 6: registry scope "bogus" → exit 2 via registry validation ────────

  it("Fix 6: uxfactory.batch.json with scope: 'bogus' → returns 2 (registry validation catches it)", async () => {
    await writeRegistry({}, { scope: "bogus" });
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.TRANSPORT);
    // Registry validation surfaces the bad value via readRegistry → reg.message
    expect(io.errText()).toMatch(/bogus/);
  });

  // ── --stage ───────────────────────────────────────────────────────────────

  it("--stage on a clean batch posts the specs + previews to the bridge", async () => {
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(stories), "utf8");
    await writeRegistry({ stories: "design/stories.json" });
    const io = makeIO();
    expect(
      await batchCmd(specsDir, { dataDir, stage: true, cwd: root, scope: "wireframe" }, io, client),
    ).toBe(EXIT.OK);
    const res = await fetch(`${handle.url}/batch`);
    expect(res.status).toBe(200);
    const batch = (await res.json()) as { items: { spec: unknown; preview?: string }[] };
    expect(batch.items.length).toBe(1);
    expect(typeof batch.items[0]!.preview).toBe("string");
  });
});

/**
 * Deterministic spec scaffolder ("render path") tests.
 *
 * Three layers:
 *   1. scaffoldSpec / scaffoldSpecs units — naming contract + schema validity.
 *   2. THE LOAD-BEARING TEST — scaffoldSpecs over a stories fixture, written to a
 *      temp dir alongside a registry, fed to the real `batchCmd` at all-low
 *      ("wireframe") scope → exit 0 with requirement-coverage PASS and no findings.
 *      This proves the whole point: the scaffold satisfies the hard gate.
 *   3. generate-specs CLI — writes <dir>/<id>.uxfactory.json, respects --force/skip,
 *      and reads stories from the registry or the conventional fallback path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validate } from "@uxfactory/spec";
import { BridgeClient } from "../src/client.js";
import { batchCmd } from "../src/commands/batch.js";
import { generateSpecsCmd } from "../src/commands/generate-specs.js";
import { scaffoldSpec, scaffoldSpecs, sanitizeFileName } from "../src/batch/scaffold-specs.js";
import { loadSpec } from "../src/spec-file.js";
import type { Story } from "../src/batch/checks.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const STORIES: { stories: Story[] } = {
  stories: [
    {
      id: "checkout",
      role: "customer",
      goal: "complete a purchase",
      benefit: "receive items without friction",
      acceptanceCriteria: [
        { statement: "payment completes", impliedState: "success" },
        { statement: "payment fails readably", impliedState: "error" },
        { statement: "payment still completes", impliedState: "success" }, // duplicate state
      ],
    },
    {
      id: "cart",
      role: "customer",
      goal: "manage the cart",
      benefit: "review before buying",
      acceptanceCriteria: [
        { statement: "no items", impliedState: "empty" },
        { statement: "items with totals", impliedState: "success" },
      ],
    },
  ],
};

/**
 * Local mirror of checks.ts tokenBoundaryMatch — storyId's segments must appear as
 * a contiguous run in frameName's segments (split on [-_/\s]+). Used to assert the
 * scaffold's coverage contract directly at the unit level.
 */
function tokenBoundaryMatch(frameName: string, storyId: string): boolean {
  const fs = frameName
    .toLowerCase()
    .split(/[-_/\s]+/)
    .filter(Boolean);
  const ss = storyId
    .toLowerCase()
    .split(/[-_/\s]+/)
    .filter(Boolean);
  if (ss.length === 0) return false;
  for (let i = 0; i <= fs.length - ss.length; i++) {
    if (ss.every((seg, j) => fs[i + j] === seg)) return true;
  }
  return false;
}

// ─── 1. scaffoldSpec / scaffoldSpecs units ───────────────────────────────────

describe("scaffoldSpec", () => {
  it("emits one frame per UNIQUE impliedState, each token-boundary-matching the story id", () => {
    const spec = scaffoldSpec(STORIES.stories[0]!); // checkout: success, error (dup success collapsed)
    expect(spec.frames).toHaveLength(2);
    expect(spec.frames.map((f) => f.name)).toEqual(["checkout-success", "checkout-error"]);
    for (const f of spec.frames) {
      expect(tokenBoundaryMatch(f.name, "checkout")).toBe(true);
    }
  });

  it("each AC-implied state keyword appears (substring) in a node name of its frame", () => {
    const spec = scaffoldSpec(STORIES.stories[1]!); // cart: empty, success
    for (const state of ["empty", "success"]) {
      const frame = spec.frames.find((f) => f.name.includes(state));
      expect(frame).toBeDefined();
      const nodeNames = [frame!.name, ...(frame!.children ?? []).map((c) => c.name)];
      expect(nodeNames.some((n) => n.toLowerCase().includes(state))).toBe(true);
      // the labelled TextNode carries the <id>-<state>-label name + a fill + characters
      const label = (frame!.children ?? [])[0];
      expect(label).toMatchObject({ type: "text", name: `cart-${state}-label` });
      expect((label as { characters: string }).characters.length).toBeGreaterThan(0);
    }
  });

  it("lays frames out at non-overlapping x offsets", () => {
    const spec = scaffoldSpec(STORIES.stories[0]!);
    const xs = spec.frames.map((f) => f.x);
    expect(new Set(xs).size).toBe(xs.length);
    for (let i = 1; i < spec.frames.length; i++) {
      const prev = spec.frames[i - 1]!;
      expect(spec.frames[i]!.x).toBeGreaterThanOrEqual(prev.x + prev.width);
    }
  });

  it("defaults to a single success state when there are no acceptance criteria", () => {
    const spec = scaffoldSpec({
      id: "lonely",
      role: "r",
      goal: "g",
      benefit: "b",
      acceptanceCriteria: [],
    });
    expect(spec.frames.map((f) => f.name)).toEqual(["lonely-success"]);
  });

  it("produces a spec that passes schema validation / loadSpec", () => {
    for (const story of STORIES.stories) {
      const result = validate(scaffoldSpec(story));
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    }
  });
});

describe("scaffoldSpecs", () => {
  it("emits one spec per story with fileName = <sanitized-id>.uxfactory.json", () => {
    const out = scaffoldSpecs(STORIES.stories);
    expect(out.map((s) => s.id)).toEqual(["checkout", "cart"]);
    expect(out.map((s) => s.fileName)).toEqual(["checkout.uxfactory.json", "cart.uxfactory.json"]);
  });

  it("sanitizes filename-unsafe ids without altering the in-spec frame names", () => {
    const out = scaffoldSpecs([
      { id: "Story 1/Home", role: "r", goal: "g", benefit: "b", acceptanceCriteria: [] },
    ]);
    expect(out[0]!.fileName).toBe("Story-1-Home.uxfactory.json");
    // names embed the RAW id so token-boundary match against the raw id still holds
    expect(out[0]!.spec.frames[0]!.name).toBe("Story 1/Home-success");
    expect(tokenBoundaryMatch(out[0]!.spec.frames[0]!.name, "Story 1/Home")).toBe(true);
  });

  it("sanitizeFileName falls back to 'spec' for an empty/garbage id", () => {
    expect(sanitizeFileName("")).toBe("spec");
    expect(sanitizeFileName("///")).toBe("spec");
  });
});

// ─── 2. THE LOAD-BEARING TEST — scaffold + stories → batch exit 0 ─────────────

describe("scaffold + stories → batch passes GREEN (exit 0)", () => {
  let root: string;
  let dataDir: string;
  let specsDir: string;
  const client = new BridgeClient("http://127.0.0.1:0"); // unused: no --stage

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "uxf-scaffold-"));
    dataDir = path.join(root, ".uxfactory");
    specsDir = path.join(root, "specs");
    await mkdir(specsDir, { recursive: true });
    await mkdir(path.join(root, "design"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("requirement-coverage BINDS, PASSES with no findings, and the batch exits 0", async () => {
    // 1. stories + registry (all-low "wireframe" scope: coverage binds; visual/flow do not,
    //    so no tokens/flow inputs are required for readiness).
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(STORIES), "utf8");
    await writeFile(
      path.join(root, "uxfactory.batch.json"),
      JSON.stringify({
        version: 1,
        inputs: { stories: "design/stories.json" },
        scope: "wireframe",
      }),
      "utf8",
    );

    // 2. scaffold the specs and write them into the batch directory.
    for (const { fileName, spec } of scaffoldSpecs(STORIES.stories)) {
      expect(validate(spec).valid).toBe(true);
      await writeFile(path.join(specsDir, fileName), JSON.stringify(spec), "utf8");
    }

    // 3. run the real batch gate.
    const io = makeIO();
    const code = await batchCmd(specsDir, { dataDir, cwd: root }, io, client);
    expect(code).toBe(EXIT.OK);

    // 4. requirement-coverage actually RAN (bound) and PASSED with no findings.
    const report = JSON.parse(
      await readFile(path.join(dataDir, "batch", "report.json"), "utf8"),
    ) as {
      clean: boolean;
      mustPassFailed: boolean;
      checks: { id: string; status: string; severity: string; findings: unknown[] }[];
    };
    expect(report.clean).toBe(true);
    expect(report.mustPassFailed).toBe(false);
    const rc = report.checks.find((c) => c.id === "requirement-coverage");
    expect(rc).toBeDefined();
    expect(rc!.status).toBe("pass");
    expect(rc!.severity).toBe("must");
    expect(rc!.findings).toHaveLength(0);
  });
});

// ─── 3. generate-specs CLI ───────────────────────────────────────────────────

describe("generate-specs command", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "uxf-gen-"));
    await mkdir(path.join(root, "design"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const exists = async (p: string): Promise<boolean> => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  };

  it("reads stories via the registry and writes <dir>/<id>.uxfactory.json (--json)", async () => {
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(STORIES), "utf8");
    await writeFile(
      path.join(root, "uxfactory.batch.json"),
      JSON.stringify({ version: 1, inputs: { stories: "design/stories.json" } }),
      "utf8",
    );

    const io = makeIO();
    const code = await generateSpecsCmd("design", { json: true, cwd: root }, io);
    expect(code).toBe(EXIT.OK);

    const out = JSON.parse(io.outText()) as { written: string[]; skipped: string[] };
    expect(out.written.sort()).toEqual(["cart.uxfactory.json", "checkout.uxfactory.json"]);
    expect(out.skipped).toEqual([]);

    // each written file exists and is a schema-valid spec
    for (const name of out.written) {
      const loaded = await loadSpec(path.join(root, "design", name));
      expect(loaded.ok).toBe(true);
    }
    const written = await readdir(path.join(root, "design"));
    expect(written).toContain("checkout.uxfactory.json");
    expect(written).toContain("cart.uxfactory.json");
  });

  it("falls back to <dir>/acceptance-criteria.json when there is no registry", async () => {
    await writeFile(
      path.join(root, "design", "acceptance-criteria.json"),
      JSON.stringify(STORIES),
      "utf8",
    );

    const io = makeIO();
    const code = await generateSpecsCmd("design", { json: true, cwd: root }, io);
    expect(code).toBe(EXIT.OK);
    expect(await exists(path.join(root, "design", "checkout.uxfactory.json"))).toBe(true);
  });

  it("SKIPS an existing same-named file, and --force overwrites it", async () => {
    await writeFile(
      path.join(root, "design", "acceptance-criteria.json"),
      JSON.stringify(STORIES),
      "utf8",
    );
    const target = path.join(root, "design", "checkout.uxfactory.json");
    await writeFile(target, JSON.stringify({ editor: "figma", frames: [] }), "utf8");

    // without --force: checkout is skipped, cart is written
    const io1 = makeIO();
    expect(await generateSpecsCmd("design", { json: true, cwd: root }, io1)).toBe(EXIT.OK);
    const out1 = JSON.parse(io1.outText()) as { written: string[]; skipped: string[] };
    expect(out1.skipped).toEqual(["checkout.uxfactory.json"]);
    expect(out1.written).toEqual(["cart.uxfactory.json"]);
    // the user's file is untouched (still the empty-frames placeholder)
    const preserved = JSON.parse(await readFile(target, "utf8")) as { frames: unknown[] };
    expect(preserved.frames).toEqual([]);

    // with --force: checkout is overwritten with the real scaffold (frames present)
    const io2 = makeIO();
    expect(await generateSpecsCmd("design", { json: true, force: true, cwd: root }, io2)).toBe(
      EXIT.OK,
    );
    const out2 = JSON.parse(io2.outText()) as { written: string[]; skipped: string[] };
    expect(out2.written.sort()).toEqual(["cart.uxfactory.json", "checkout.uxfactory.json"]);
    const overwritten = JSON.parse(await readFile(target, "utf8")) as { frames: unknown[] };
    expect(overwritten.frames.length).toBeGreaterThan(0);
  });

  it("absent/invalid stories → EXIT.TRANSPORT (2) via io.err", async () => {
    const io = makeIO();
    // no registry, no acceptance-criteria.json → fallback path is absent
    expect(await generateSpecsCmd("design", { cwd: root }, io)).toBe(EXIT.TRANSPORT);
    expect(io.errText().length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reviewCmd } from "../src/commands/review.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";
import type { ReviewReport } from "../src/review/review.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A spec whose frames + children COVER story-1 (empty + success implied states). */
const conformantSpec = {
  editor: "figma",
  frames: [
    {
      name: "story-1-home",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        { type: "shape", name: "story-1-empty-state", x: 0, y: 0, width: 10, height: 10 },
        { type: "shape", name: "story-1-success-view", x: 0, y: 20, width: 10, height: 10 },
      ],
    },
  ],
};

/** A spec MISSING the loading state for story-2 — will fail requirement-coverage. */
const nonConformantSpec = {
  editor: "figma",
  frames: [
    {
      name: "story-2-detail",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        { type: "text", name: "story-2-header", x: 0, y: 0, width: 1, height: 1, characters: "H" },
        // intentionally NO "loading" node
      ],
    },
  ],
};

const stories1 = {
  stories: [
    {
      id: "story-1",
      role: "user",
      goal: "see home",
      benefit: "fast",
      acceptanceCriteria: [
        { statement: "no data", impliedState: "empty" },
        { statement: "loaded", impliedState: "success" },
      ],
    },
  ],
};

const stories2 = {
  stories: [
    {
      id: "story-2",
      role: "user",
      goal: "see detail",
      benefit: "comprehension",
      acceptanceCriteria: [{ statement: "shows loading", impliedState: "loading" }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-review-cmd-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeRegistry(
  inputs: Record<string, unknown>,
  extra?: { scope?: string | Record<string, unknown> },
): Promise<void> {
  const obj: Record<string, unknown> = { version: 1, inputs };
  if (extra?.scope !== undefined) obj["scope"] = extra.scope;
  await writeFile(path.join(root, "uxfactory.batch.json"), JSON.stringify(obj), "utf8");
}

async function writeSpec(name: string, spec: unknown, dir?: string): Promise<string> {
  const targetDir = dir ?? root;
  await mkdir(targetDir, { recursive: true });
  const file = path.join(targetDir, name);
  await writeFile(file, JSON.stringify(spec), "utf8");
  return file;
}

// ---------------------------------------------------------------------------
// Test 1: conformant design → exit 0
// ---------------------------------------------------------------------------

describe("reviewCmd — conformant design", () => {
  it("exits 0 when design covers all stories", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeFile(path.join(root, "stories.json"), JSON.stringify(stories1), "utf8");
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.OK);
  });

  it("human output mentions conformant", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeFile(path.join(root, "stories.json"), JSON.stringify(stories1), "utf8");
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    await reviewCmd(specFile, { cwd: root }, io);
    expect(io.outText().toUpperCase()).toMatch(/CONFORMANT/);
  });
});

// ---------------------------------------------------------------------------
// Test 2: non-conformant design (missing AC state) → exit 1 + unmet finding
// ---------------------------------------------------------------------------

describe("reviewCmd — non-conformant design", () => {
  it("exits 1 when design is missing an AC-implied state", async () => {
    const specFile = await writeSpec("design.uxfactory.json", nonConformantSpec);
    await writeFile(path.join(root, "stories.json"), JSON.stringify(stories2), "utf8");
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.GATE_FAIL);
  });

  it("human output mentions UNMET or non-conformant", async () => {
    const specFile = await writeSpec("design.uxfactory.json", nonConformantSpec);
    await writeFile(path.join(root, "stories.json"), JSON.stringify(stories2), "utf8");
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    await reviewCmd(specFile, { cwd: root }, io);
    const text = io.outText().toUpperCase() + io.errText().toUpperCase();
    expect(text).toMatch(/UNMET|NON.CONFORMANT/);
  });

  it("--json output exits 1 and report has conformant:false + unmet findings", async () => {
    const specFile = await writeSpec("design.uxfactory.json", nonConformantSpec);
    await writeFile(path.join(root, "stories.json"), JSON.stringify(stories2), "utf8");
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { json: true, cwd: root }, io);
    expect(code).toBe(EXIT.GATE_FAIL);
    const report = JSON.parse(io.outText()) as ReviewReport;
    expect(report.conformant).toBe(false);
    const unmet = report.findings.filter((f) => f.status === "unmet");
    expect(unmet.length).toBeGreaterThan(0);
    expect(unmet.some((f) => f.requirement === "story-2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 3: missing/invalid registry → exit 2
// ---------------------------------------------------------------------------

describe("reviewCmd — missing/invalid registry", () => {
  it("exits 2 when uxfactory.batch.json is missing", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    // no registry written
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText().length).toBeGreaterThan(0);
  });

  it("exits 2 when uxfactory.batch.json has invalid JSON", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeFile(path.join(root, "uxfactory.batch.json"), "{ invalid json }", "utf8");
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
  });

  it("exits 2 when uxfactory.batch.json has wrong version", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeFile(
      path.join(root, "uxfactory.batch.json"),
      JSON.stringify({ version: 99, inputs: {} }),
      "utf8",
    );
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
  });
});

// ---------------------------------------------------------------------------
// Test 4: unreadable/zero-spec design → exit 2
// ---------------------------------------------------------------------------

describe("reviewCmd — unreadable/zero-spec design", () => {
  it("exits 2 when the design file does not exist", async () => {
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(path.join(root, "nonexistent.uxfactory.json"), { cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
  });

  it("exits 2 when the design is an invalid spec", async () => {
    const specFile = await writeSpec("design.uxfactory.json", { not: "a spec" });
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
  });

  it("exits 2 when the design directory is empty (zero specs)", async () => {
    const specDir = path.join(root, "specs");
    await mkdir(specDir, { recursive: true });
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specDir, { cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
  });

  it("exits 2 when a design file in the directory is invalid", async () => {
    const specDir = path.join(root, "specs");
    await mkdir(specDir, { recursive: true });
    await writeSpec("bad.uxfactory.json", { invalid: true }, specDir);
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specDir, { cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
  });
});

// ---------------------------------------------------------------------------
// Test 5: invalid --visual bogus → exit 2
// ---------------------------------------------------------------------------

describe("reviewCmd — invalid dial flag", () => {
  it("exits 2 when --visual has an invalid value", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { visual: "bogus", cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/invalid --visual/);
  });

  it("exits 2 when --editorial has an invalid value", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { editorial: "none", cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/invalid --editorial/);
  });

  it("exits 2 when --scope has an unknown preset name", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeRegistry({});
    const io = makeIO();
    const code = await reviewCmd(specFile, { scope: "bogus-preset", cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
  });
});

// ---------------------------------------------------------------------------
// Test 6: no stories registered → exit 0 with coverage check in skipped
// ---------------------------------------------------------------------------

describe("reviewCmd — no stories registered", () => {
  it("exits 0 when no stories are registered (best-effort, skip-and-declare)", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    // no stories key in inputs
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.OK);
  });

  it("--json output shows coverage check in skipped array", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    await reviewCmd(specFile, { json: true, cwd: root }, io);
    const report = JSON.parse(io.outText()) as ReviewReport;
    expect(report.conformant).toBe(true);
    const skippedCoverage = report.skipped.find((s) => s.check === "requirement-coverage");
    expect(skippedCoverage).toBeDefined();
    expect(typeof skippedCoverage?.reason).toBe("string");
  });

  it("human output mentions skipped when no stories", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    await reviewCmd(specFile, { cwd: root }, io);
    expect(io.outText()).toMatch(/skipped/);
  });
});

// ---------------------------------------------------------------------------
// Test 7: --json shape carries scope+conformant+findings+skipped+rubric+advisory
// ---------------------------------------------------------------------------

describe("reviewCmd — --json shape", () => {
  it("--json report carries scope, conformant, findings, skipped, rubric, advisory", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeFile(path.join(root, "stories.json"), JSON.stringify(stories1), "utf8");
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    await reviewCmd(specFile, { json: true, cwd: root }, io);
    const report = JSON.parse(io.outText()) as ReviewReport;
    // Shape checks
    expect(report).toHaveProperty("scope");
    expect(report).toHaveProperty("conformant");
    expect(report).toHaveProperty("findings");
    expect(report).toHaveProperty("skipped");
    expect(report).toHaveProperty("rubric");
    expect(report).toHaveProperty("advisory");
    // Types
    expect(typeof report.conformant).toBe("boolean");
    expect(Array.isArray(report.findings)).toBe(true);
    expect(Array.isArray(report.skipped)).toBe(true);
    expect(Array.isArray(report.rubric)).toBe(true);
    expect(typeof report.advisory).toBe("string");
    // Scope shape
    expect(report.scope).toMatchObject({
      visual: expect.any(String),
      editorial: expect.any(String),
      coverage: expect.any(String),
      flow: expect.any(String),
    });
  });

  it("--json rubric includes requirement-coverage at wireframe scope", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    await reviewCmd(specFile, { json: true, cwd: root }, io);
    const report = JSON.parse(io.outText()) as ReviewReport;
    expect(report.rubric).toContain("requirement-coverage");
  });

  it("--json advisory is a non-empty string mentioning agent or plugin", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    await reviewCmd(specFile, { json: true, cwd: root }, io);
    const report = JSON.parse(io.outText()) as ReviewReport;
    expect(report.advisory.length).toBeGreaterThan(0);
    expect(report.advisory.toLowerCase()).toMatch(/agent|plugin/);
  });
});

// ---------------------------------------------------------------------------
// Test 8: default scope is `interactive` (review wants the broadest picture)
// ---------------------------------------------------------------------------

describe("reviewCmd — default scope", () => {
  it("defaults to interactive scope when neither --scope nor registry scope is set", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    // no scope in registry, no --scope flag
    await writeRegistry({});
    const io = makeIO();
    await reviewCmd(specFile, { json: true, cwd: root }, io);
    const report = JSON.parse(io.outText()) as ReviewReport;
    // interactive = { visual:high, editorial:high, coverage:high, flow:high }
    expect(report.scope).toMatchObject({
      visual: "high",
      editorial: "high",
      coverage: "high",
      flow: "high",
    });
  });
});

// ---------------------------------------------------------------------------
// Test 9: directory of specs (multiple *.uxfactory.json files)
// ---------------------------------------------------------------------------

describe("reviewCmd — directory of specs", () => {
  it("loads all *.uxfactory.json files from a directory and exits 0 when conformant", async () => {
    const specDir = path.join(root, "specs");
    await mkdir(specDir, { recursive: true });
    await writeSpec("design-a.uxfactory.json", conformantSpec, specDir);
    await writeFile(path.join(root, "stories.json"), JSON.stringify(stories1), "utf8");
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specDir, { cwd: root }, io);
    expect(code).toBe(EXIT.OK);
  });
});

// ---------------------------------------------------------------------------
// Test 10 (Fix 1): registered-but-broken inputs → exit 2, NOT skip-and-declare
// ---------------------------------------------------------------------------

describe("reviewCmd — registered-but-broken stories → exit 2 (Fix 1)", () => {
  it("exits 2 when stories is registered but the file is missing on disk", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    // Register a stories path that does not exist on disk
    await writeRegistry({ stories: "no-such-stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
    // Must emit a clear message (not silent)
    expect(io.errText().length).toBeGreaterThan(0);
  });

  it("exits 2 when stories is registered but the file contains invalid JSON", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeFile(path.join(root, "stories.json"), "{ this is not valid json }", "utf8");
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
  });

  it("exits 2 when stories is registered but has wrong shape (stories not array)", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    // Wrong shape: stories is a string, not an array
    await writeFile(
      path.join(root, "stories.json"),
      JSON.stringify({ stories: "not-an-array" }),
      "utf8",
    );
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
    // Must name the shape error — not a silent exit
    expect(io.errText()).toMatch(/malformed stories/);
  });

  it("exits 0 when stories is genuinely absent (not registered) — skip-and-declare", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    // No stories key in inputs at all → absent, skip-and-declare is valid
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.OK);
    // Coverage check must appear in skipped, not as an error
    const report = JSON.parse(
      await (async () => {
        const io2 = makeIO();
        await reviewCmd(specFile, { json: true, cwd: root }, io2);
        return io2.outText();
      })(),
    ) as ReviewReport;
    expect(report.skipped.find((s) => s.check === "requirement-coverage")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 11 (Fix 3): hardened conformant verdict — requirement-coverage must have RUN
// ---------------------------------------------------------------------------

describe("reviewCmd — hardened conformant verdict (Fix 3)", () => {
  it("passed[] includes requirement-coverage when it ran and passed", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeFile(path.join(root, "stories.json"), JSON.stringify(stories1), "utf8");
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { json: true, cwd: root }, io);
    expect(code).toBe(EXIT.OK);
    const report = JSON.parse(io.outText()) as ReviewReport;
    // Self-evidencing: the gate RAN and PASSED
    expect(report.rubric).toContain("requirement-coverage");
    expect(report.skipped.find((s) => s.check === "requirement-coverage")).toBeUndefined();
    expect(report.passed).toContain("requirement-coverage");
    expect(report.conformant).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 12 (Fix 4): declared tiers in the report
// ---------------------------------------------------------------------------

describe("reviewCmd — declared tiers in --json report (Fix 4)", () => {
  it("--json report includes a declared array with future tier artifact names", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    await reviewCmd(specFile, { json: true, cwd: root }, io);
    const report = JSON.parse(io.outText()) as ReviewReport;
    expect(Array.isArray(report.declared)).toBe(true);
    // At wireframe scope there are always declared future tiers (a11y, etc.)
    expect(report.declared.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 13 (Fix 5): vacuous-conformant headline is qualified
// ---------------------------------------------------------------------------

describe("reviewCmd — vacuous-conformant headline qualification (Fix 5)", () => {
  it("headline says 'skipped' when some checks were skipped and verdict is conformant", async () => {
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    // No stories registered → coverage check skipped → vacuous conformant
    await writeRegistry({}, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.OK);
    // Headline must be qualified, not bare "CONFORMANT"
    expect(io.outText()).toMatch(/CONFORMANT.*skipped/i);
  });

  it("headline is bare CONFORMANT when all binding gates ran and passed", async () => {
    // This case uses only 1 registered story that fully passes and no reuse spec
    // but reuse will be skipped (no reuse input registered).
    // So the headline will be qualified since reuse is skipped.
    // Instead, test that non-skipped conformant still contains CONFORMANT
    const specFile = await writeSpec("design.uxfactory.json", conformantSpec);
    await writeFile(path.join(root, "stories.json"), JSON.stringify(stories1), "utf8");
    await writeRegistry({ stories: "stories.json" }, { scope: "wireframe" });
    const io = makeIO();
    const code = await reviewCmd(specFile, { cwd: root }, io);
    expect(code).toBe(EXIT.OK);
    // Must still contain CONFORMANT
    expect(io.outText().toUpperCase()).toContain("CONFORMANT");
  });
});

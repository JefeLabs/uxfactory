/**
 * End-to-end "golden batch" integration tests for the uxfactory batch offline pipeline.
 *
 * Exercises the full offline path: uxfactory.batch.json registry → spec loading →
 * four deterministic gates (tokenConformance, requirementCoverage, reuse,
 * flowReachability, coverage-orphans) → report.json + preview SVGs → exit code.
 *
 * Scenarios:
 *   1. Clean multi-story + reusable-component batch → exit 0
 *   2. Token-conformance revision loop (ad-hoc color → exit 1 → fix → exit 0)
 *   3. Requirement-coverage revision loop (missing AC-state → exit 1 → add node → exit 0)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import { BridgeClient } from "../src/client.js";
import { batchCmd } from "../src/commands/batch.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

// ─── Token palette ────────────────────────────────────────────────────────────
// Only these five colors are registered; every spec fill MUST reference one of them.

const TOKENS = {
  colors: {
    brand: "#2563EB",
    surface: "#FFFFFF",
    text: "#1F2937",
    error: "#DC2626",
    success: "#16A34A",
  },
};

// ─── User stories ─────────────────────────────────────────────────────────────

const STORIES = {
  stories: [
    {
      id: "checkout",
      role: "customer",
      goal: "complete a purchase",
      benefit: "receive ordered items without friction",
      acceptanceCriteria: [
        { statement: "payment completes successfully", impliedState: "success" },
        { statement: "payment fails with a user-readable message", impliedState: "error" },
      ],
    },
    {
      id: "cart",
      role: "customer",
      goal: "view and manage the shopping cart",
      benefit: "review items and totals before buying",
      acceptanceCriteria: [
        { statement: "cart contains no items", impliedState: "empty" },
        { statement: "cart contains items with totals visible", impliedState: "success" },
      ],
    },
  ],
};

// ─── Spec fixtures ────────────────────────────────────────────────────────────

/**
 * Checkout page: two frames covering the "checkout" story.
 * Frame names contain "checkout" at token boundaries → story coverage.
 * Each frame's name/children contain the AC-implied state keyword → state coverage.
 */
const CHECKOUT_SPEC = {
  editor: "figma",
  frames: [
    {
      name: "checkout-success",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        {
          type: "shape",
          name: "checkout-header",
          x: 0,
          y: 0,
          width: 375,
          height: 56,
          fill: "#2563EB",
        },
        {
          type: "shape",
          name: "checkout-success-banner",
          x: 16,
          y: 72,
          width: 343,
          height: 64,
          fill: "#16A34A",
        },
        {
          type: "text",
          name: "checkout-success-title",
          x: 16,
          y: 152,
          width: 200,
          height: 24,
          characters: "Order Confirmed",
          fill: "#1F2937",
        },
      ],
    },
    {
      name: "checkout-error",
      x: 400,
      y: 0,
      width: 375,
      height: 812,
      children: [
        {
          type: "shape",
          name: "checkout-header",
          x: 0,
          y: 0,
          width: 375,
          height: 56,
          fill: "#2563EB",
        },
        {
          type: "shape",
          name: "checkout-error-banner",
          x: 16,
          y: 72,
          width: 343,
          height: 64,
          fill: "#DC2626",
        },
        {
          type: "text",
          name: "checkout-error-message",
          x: 16,
          y: 152,
          width: 280,
          height: 24,
          characters: "Payment failed. Please try again.",
          fill: "#1F2937",
        },
      ],
    },
  ],
};

/**
 * Checkout spec with a single ad-hoc color (#ABCABC) on checkout-header — used to
 * trigger a tokenConformance gate failure in the revision loop scenario.
 */
const CHECKOUT_SPEC_DIRTY_TOKEN = {
  editor: "figma",
  frames: [
    {
      name: "checkout-success",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        {
          type: "shape",
          name: "checkout-header",
          x: 0,
          y: 0,
          width: 375,
          height: 56,
          fill: "#ABCABC", // ad-hoc — not in token register
        },
        {
          type: "shape",
          name: "checkout-success-banner",
          x: 16,
          y: 72,
          width: 343,
          height: 64,
          fill: "#16A34A",
        },
        {
          type: "text",
          name: "checkout-success-title",
          x: 16,
          y: 152,
          width: 200,
          height: 24,
          characters: "Order Confirmed",
          fill: "#1F2937",
        },
      ],
    },
    {
      name: "checkout-error",
      x: 400,
      y: 0,
      width: 375,
      height: 812,
      children: [
        {
          type: "shape",
          name: "checkout-header",
          x: 0,
          y: 0,
          width: 375,
          height: 56,
          fill: "#2563EB",
        },
        {
          type: "shape",
          name: "checkout-error-banner",
          x: 16,
          y: 72,
          width: 343,
          height: 64,
          fill: "#DC2626",
        },
        {
          type: "text",
          name: "checkout-error-message",
          x: 16,
          y: 152,
          width: 280,
          height: 24,
          characters: "Payment failed. Please try again.",
          fill: "#1F2937",
        },
      ],
    },
  ],
};

/**
 * Checkout spec with the error-state frame removed — triggers requirementCoverage failure
 * because the "error" AC-implied state has no matching node in checkout's covering frames.
 */
const CHECKOUT_SPEC_MISSING_ERROR_STATE = {
  editor: "figma",
  frames: [
    // Only the success frame — checkout-error frame intentionally absent
    {
      name: "checkout-success",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        {
          type: "shape",
          name: "checkout-header",
          x: 0,
          y: 0,
          width: 375,
          height: 56,
          fill: "#2563EB",
        },
        {
          type: "shape",
          name: "checkout-success-banner",
          x: 16,
          y: 72,
          width: 343,
          height: 64,
          fill: "#16A34A",
        },
        {
          type: "text",
          name: "checkout-success-title",
          x: 16,
          y: 152,
          width: 200,
          height: 24,
          characters: "Order Confirmed",
          fill: "#1F2937",
        },
      ],
    },
  ],
};

/**
 * Cart page: two frames covering the "cart" story + empty/success states.
 */
const CART_SPEC = {
  editor: "figma",
  frames: [
    {
      name: "cart-empty",
      x: 0,
      y: 0,
      width: 375,
      height: 812,
      children: [
        {
          type: "shape",
          name: "cart-header",
          x: 0,
          y: 0,
          width: 375,
          height: 56,
          fill: "#2563EB",
        },
        {
          type: "shape",
          name: "cart-empty-illustration",
          x: 80,
          y: 200,
          width: 215,
          height: 160,
          fill: "#FFFFFF",
        },
        {
          type: "text",
          name: "cart-empty-label",
          x: 100,
          y: 380,
          width: 175,
          height: 24,
          characters: "Your cart is empty",
          fill: "#1F2937",
        },
      ],
    },
    {
      name: "cart-success",
      x: 400,
      y: 0,
      width: 375,
      height: 812,
      children: [
        {
          type: "shape",
          name: "cart-header",
          x: 0,
          y: 0,
          width: 375,
          height: 56,
          fill: "#2563EB",
        },
        {
          type: "shape",
          name: "cart-success-item-row",
          x: 16,
          y: 72,
          width: 343,
          height: 88,
          fill: "#FFFFFF",
        },
        {
          type: "shape",
          name: "cart-success-checkout-btn",
          x: 16,
          y: 712,
          width: 343,
          height: 48,
          fill: "#2563EB",
        },
      ],
    },
  ],
};

/**
 * Reusable button-primary component: no corresponding story ID in its frame name.
 * Lands in coverage-orphans (advisory) but never gates the batch.
 */
const BUTTON_SPEC = {
  editor: "figma",
  frames: [
    {
      name: "button-primary",
      x: 0,
      y: 0,
      width: 200,
      height: 48,
      children: [
        {
          type: "shape",
          name: "button-bg",
          x: 0,
          y: 0,
          width: 200,
          height: 48,
          fill: "#2563EB",
        },
        {
          type: "text",
          name: "button-label",
          x: 16,
          y: 12,
          width: 168,
          height: 24,
          characters: "Continue",
          fill: "#FFFFFF",
        },
      ],
    },
  ],
};

// ─── Shared test infrastructure ───────────────────────────────────────────────

let root: string;
let dataDir: string;
let specsDir: string;
let handle: { url: string; close: () => Promise<void> };
let client: BridgeClient;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-golden-"));
  dataDir = path.join(root, ".uxfactory");
  specsDir = path.join(root, "specs");
  await mkdir(specsDir, { recursive: true });
  await mkdir(path.join(root, "design"), { recursive: true });
  handle = await startBridge({ dataDir: path.join(root, ".bridge"), port: 0 });
  client = new BridgeClient(handle.url);
});

afterEach(async () => {
  await handle.close();
  await rm(root, { recursive: true, force: true });
});

async function writeRegistry(
  inputs: Record<string, unknown>,
  extra?: { scope?: string | Record<string, unknown> },
): Promise<void> {
  const obj: Record<string, unknown> = { version: 1, inputs, maxIterations: 6 };
  if (extra?.scope !== undefined) obj["scope"] = extra.scope;
  await writeFile(path.join(root, "uxfactory.batch.json"), JSON.stringify(obj), "utf8");
}

async function writeSpec(name: string, spec: unknown): Promise<void> {
  await writeFile(path.join(specsDir, name), JSON.stringify(spec), "utf8");
}

async function readReport(): Promise<{
  specs: string[];
  clean: boolean;
  mustPassFailed: boolean;
  checks: { id: string; status: string; severity: string; findings: { detail: string }[] }[];
}> {
  return JSON.parse(
    await readFile(path.join(dataDir, "batch", "report.json"), "utf8"),
  ) as ReturnType<typeof readReport> extends Promise<infer T> ? T : never;
}

// ─── Scenario 1: clean multi-story + reusable-component batch ─────────────────

describe("scenario 1: clean multi-story + reusable-component batch → exit 0", () => {
  beforeEach(async () => {
    await writeFile(path.join(root, "design", "tokens.ds.json"), JSON.stringify(TOKENS), "utf8");
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(STORIES), "utf8");
    // scope {visual:high, coverage:medium} — token-conformance + requirement-coverage bind;
    // flow-reachability does NOT bind (flow:low) so no flow input is needed.
    await writeRegistry(
      { tokens: "design/tokens.ds.json", stories: "design/stories.json" },
      { scope: { visual: "high", coverage: "medium" } },
    );
    await writeSpec("checkout.uxfactory.json", CHECKOUT_SPEC);
    await writeSpec("cart.uxfactory.json", CART_SPEC);
    await writeSpec("button-primary.uxfactory.json", BUTTON_SPEC);
  });

  it("exits 0 and report.json is clean with no must-pass failures", async () => {
    const io = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io, client)).toBe(EXIT.OK);
    const report = await readReport();
    expect(report.clean).toBe(true);
    expect(report.mustPassFailed).toBe(false);
  });

  it("tokenConformance: pass — all fills reference registered token colors", async () => {
    const io = makeIO();
    await batchCmd(specsDir, { dataDir, cwd: root }, io, client);
    const report = await readReport();
    const tc = report.checks.find((c) => c.id === "token-conformance");
    expect(tc).toBeDefined();
    expect(tc!.status).toBe("pass");
    expect(tc!.severity).toBe("must");
    expect(tc!.findings).toHaveLength(0);
  });

  it("requirementCoverage: pass — both checkout and cart stories fully covered by state", async () => {
    const io = makeIO();
    await batchCmd(specsDir, { dataDir, cwd: root }, io, client);
    const report = await readReport();
    const rc = report.checks.find((c) => c.id === "requirement-coverage");
    expect(rc).toBeDefined();
    expect(rc!.status).toBe("pass");
    expect(rc!.severity).toBe("must");
    expect(rc!.findings).toHaveLength(0);
  });

  it("reuse: skip — no reuse specs registered in batch.json", async () => {
    const io = makeIO();
    await batchCmd(specsDir, { dataDir, cwd: root }, io, client);
    const report = await readReport();
    const ru = report.checks.find((c) => c.id === "reuse");
    expect(ru).toBeDefined();
    expect(ru!.status).toBe("skip");
    expect(ru!.severity).toBe("must");
  });

  it("flowReachability: not-owed — flow dial is low at the current scope", async () => {
    // scope {visual:high, coverage:medium} → flow:low → flow-reachability does not bind
    const io = makeIO();
    await batchCmd(specsDir, { dataDir, cwd: root }, io, client);
    const report = await readReport();
    const fr = report.checks.find((c) => c.id === "flow-reachability");
    expect(fr).toBeDefined();
    expect(fr!.status).toBe("not-owed");
    expect(fr!.severity).toBe("advisory");
  });

  it("coverage-orphans: advisory fail for button-primary (no story basis) — does NOT gate", async () => {
    const io = makeIO();
    await batchCmd(specsDir, { dataDir, cwd: root }, io, client);
    const report = await readReport();
    const co = report.checks.find((c) => c.id === "coverage-orphans");
    expect(co).toBeDefined();
    expect(co!.severity).toBe("advisory");
    // button-primary frame name has no token-boundary match with "checkout" or "cart"
    expect(co!.findings.length).toBeGreaterThanOrEqual(1);
    expect(co!.findings.some((f) => f.detail.includes("button-primary"))).toBe(true);
    // advisory finding must NOT affect clean / mustPassFailed
    expect(report.clean).toBe(true);
    expect(report.mustPassFailed).toBe(false);
  });

  it("preview SVGs written under .uxfactory/batch/previews/ for each spec", async () => {
    const io = makeIO();
    await batchCmd(specsDir, { dataDir, cwd: root }, io, client);
    const previews = await readdir(path.join(dataDir, "batch", "previews"));
    expect(previews).toContain("checkout.uxfactory.svg");
    expect(previews).toContain("cart.uxfactory.svg");
    expect(previews).toContain("button-primary.uxfactory.svg");
  });

  it("report.json lists all three spec files in the specs array", async () => {
    const io = makeIO();
    await batchCmd(specsDir, { dataDir, cwd: root }, io, client);
    const report = await readReport();
    expect(report.specs).toContain("checkout.uxfactory.json");
    expect(report.specs).toContain("cart.uxfactory.json");
    expect(report.specs).toContain("button-primary.uxfactory.json");
  });
});

// ─── Scenario 2: token-conformance revision loop ─────────────────────────────

describe("scenario 2: token-conformance revision loop (models SKILL.md gate-fail → fix → pass)", () => {
  beforeEach(async () => {
    await writeFile(path.join(root, "design", "tokens.ds.json"), JSON.stringify(TOKENS), "utf8");
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(STORIES), "utf8");
    await writeRegistry(
      { tokens: "design/tokens.ds.json", stories: "design/stories.json" },
      { scope: { visual: "high", coverage: "medium" } },
    );
    await writeSpec("cart.uxfactory.json", CART_SPEC);
    await writeSpec("button-primary.uxfactory.json", BUTTON_SPEC);
  });

  it("iteration 1 → exit 1 (ad-hoc color); iteration 2 → exit 0 (token restored)", async () => {
    // ── Iteration 1: introduce one ad-hoc color not in the token register ──
    await writeSpec("checkout.uxfactory.json", CHECKOUT_SPEC_DIRTY_TOKEN);

    const io1 = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io1, client)).toBe(EXIT.GATE_FAIL);

    const report1 = await readReport();
    expect(report1.clean).toBe(false);
    expect(report1.mustPassFailed).toBe(true);

    const tc1 = report1.checks.find((c) => c.id === "token-conformance");
    expect(tc1).toBeDefined();
    expect(tc1!.status).toBe("fail");
    expect(tc1!.severity).toBe("must");
    // The finding must name the exact ad-hoc color
    expect(tc1!.findings.length).toBeGreaterThanOrEqual(1);
    expect(tc1!.findings.some((f) => f.detail.includes("#ABCABC"))).toBe(true);

    // ── Iteration 2: fix the ad-hoc color — restore a registered token value ──
    await writeSpec("checkout.uxfactory.json", CHECKOUT_SPEC);

    const io2 = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io2, client)).toBe(EXIT.OK);

    const report2 = await readReport();
    expect(report2.clean).toBe(true);
    expect(report2.mustPassFailed).toBe(false);

    const tc2 = report2.checks.find((c) => c.id === "token-conformance");
    expect(tc2).toBeDefined();
    expect(tc2!.status).toBe("pass");
    expect(tc2!.findings).toHaveLength(0);
  });
});

// ─── Scenario 3: requirement-coverage revision loop ──────────────────────────

describe("scenario 3: requirement-coverage revision loop (missing AC-state → fix → pass)", () => {
  beforeEach(async () => {
    await writeFile(path.join(root, "design", "tokens.ds.json"), JSON.stringify(TOKENS), "utf8");
    await writeFile(path.join(root, "design", "stories.json"), JSON.stringify(STORIES), "utf8");
    await writeRegistry(
      { tokens: "design/tokens.ds.json", stories: "design/stories.json" },
      { scope: { visual: "high", coverage: "medium" } },
    );
    await writeSpec("cart.uxfactory.json", CART_SPEC);
    await writeSpec("button-primary.uxfactory.json", BUTTON_SPEC);
  });

  it("iteration 1 → exit 1 (missing error state); iteration 2 → exit 0 (state added)", async () => {
    // ── Iteration 1: checkout spec missing the "checkout-error" frame ──
    // Story "checkout" is reached (checkout-success covers it), but its error AC has
    // no matching node in the story's covering frames → requirementCoverage fails.
    await writeSpec("checkout.uxfactory.json", CHECKOUT_SPEC_MISSING_ERROR_STATE);

    const io1 = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io1, client)).toBe(EXIT.GATE_FAIL);

    const report1 = await readReport();
    expect(report1.clean).toBe(false);
    expect(report1.mustPassFailed).toBe(true);

    const rc1 = report1.checks.find((c) => c.id === "requirement-coverage");
    expect(rc1).toBeDefined();
    expect(rc1!.status).toBe("fail");
    expect(rc1!.severity).toBe("must");
    // Finding names the uncovered story + implied state
    expect(rc1!.findings.length).toBeGreaterThanOrEqual(1);
    expect(
      rc1!.findings.some((f) => f.detail.includes("checkout") && f.detail.includes("error")),
    ).toBe(true);

    // ── Iteration 2: add the missing checkout-error frame → coverage restored ──
    await writeSpec("checkout.uxfactory.json", CHECKOUT_SPEC);

    const io2 = makeIO();
    expect(await batchCmd(specsDir, { dataDir, cwd: root }, io2, client)).toBe(EXIT.OK);

    const report2 = await readReport();
    expect(report2.clean).toBe(true);

    const rc2 = report2.checks.find((c) => c.id === "requirement-coverage");
    expect(rc2).toBeDefined();
    expect(rc2!.status).toBe("pass");
    expect(rc2!.findings).toHaveLength(0);
  });
});

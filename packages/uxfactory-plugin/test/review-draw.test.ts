import { describe, it, expect, vi } from "vitest";
import { makeFigma, type FakeFigma } from "./figma-mock.js";
import type { MainToUi } from "../src/messages.js";
import type { ReviewReportLike } from "../src/annotation-plan.js";

async function loadCode(fig: FakeFigma): Promise<void> {
  (globalThis as Record<string, unknown>).figma = fig;
  (globalThis as Record<string, unknown>).__html__ = "<html></html>";
  vi.resetModules();
  await import("../src/code.js");
}

const lastOfType = <T extends MainToUi["type"]>(fig: FakeFigma, type: T) =>
  [...fig.ui.posted].reverse().find((m) => m.type === type) as
    Extract<MainToUi, { type: T }> | undefined;

/** 1 conformance ElementFlag (ButtonNode) + 1 advisory ElementFlag (HeaderNode) + 1 CoverageGap */
const sampleReport: ReviewReportLike = {
  conformant: false,
  findings: [
    { property: "ButtonNode", status: "unmet", detail: "Must have 44px min height" },
    { property: "HeaderNode", status: "advisory", detail: "Consider adding aria-label" },
    { status: "unmet", detail: "Login screen not covered", requirement: "REQ-001" },
  ],
  skipped: [],
};

describe("review drawing (Task 4)", () => {
  it("draws a UXFactory Review group with 2 badges (red/amber) and a Review notes panel", async () => {
    const fig = makeFigma();

    // Set up named canvas nodes that the review can find
    const buttonNode = fig.createRectangle();
    buttonNode.name = "ButtonNode";
    buttonNode.x = 100;
    buttonNode.y = 100;
    buttonNode.resize(200, 40);
    fig.currentPage.appendChild(buttonNode);

    const headerNode = fig.createRectangle();
    headerNode.name = "HeaderNode";
    headerNode.x = 100;
    headerNode.y = 50;
    headerNode.resize(400, 44);
    fig.currentPage.appendChild(headerNode);

    await loadCode(fig);
    await fig.__send({ type: "review", report: sampleReport });

    // No render-error; no review-error
    expect(lastOfType(fig, "render-error")).toBeUndefined();
    expect(lastOfType(fig, "review-error")).toBeUndefined();

    // review-done posted with skipped=0 (both nodes found)
    const done = lastOfType(fig, "review-done");
    expect(done).toBeDefined();
    expect(done!.skipped).toBe(0);

    // "UXFactory Review" group appended to the page
    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    expect(group).toBeDefined();

    // 2 badges inside the group
    const badges = group!.children.filter((n) => n.name.startsWith("Badge"));
    expect(badges).toHaveLength(2);

    // Badge for conformance flag → RED fill (~#E53935)
    const fills0 = badges[0]!.fills as Array<{
      type: string;
      color: { r: number; g: number; b: number };
    }>;
    expect(fills0[0]!.type).toBe("SOLID");
    expect(fills0[0]!.color.r).toBeGreaterThan(0.85); // red channel high
    expect(fills0[0]!.color.b).toBeLessThan(0.25); // blue channel low

    // Badge for advisory flag → AMBER fill (~#FB8C00)
    const fills1 = badges[1]!.fills as Array<{
      type: string;
      color: { r: number; g: number; b: number };
    }>;
    expect(fills1[0]!.type).toBe("SOLID");
    expect(fills1[0]!.color.r).toBeGreaterThan(0.9); // red/orange channel high
    expect(fills1[0]!.color.g).toBeGreaterThan(0.4); // green channel (makes it amber/orange)
    expect(fills1[0]!.color.b).toBeLessThan(0.1); // blue channel near zero

    // "Review notes" panel inside the group
    const notes = group!.children.find((n) => n.name === "Review notes");
    expect(notes).toBeDefined();

    // Notes text includes gap, legend, and verdict
    const notesText = notes!.children.find((n) => n.name === "notes-content");
    expect(notesText).toBeDefined();
    expect(notesText!.characters).toContain("NON-CONFORMANT");
    expect(notesText!.characters).toContain("Login screen not covered");
    expect(notesText!.characters).toContain("RED = requirement violation");
    expect(notesText!.characters).toContain("AMBER = advisory suggestion");
  });

  it("re-review clears the prior UXFactory Review group (idempotent)", async () => {
    const fig = makeFigma();

    const buttonNode = fig.createRectangle();
    buttonNode.name = "ButtonNode";
    buttonNode.resize(100, 40);
    fig.currentPage.appendChild(buttonNode);

    await loadCode(fig);
    await fig.__send({ type: "review", report: sampleReport });
    await fig.__send({ type: "review", report: sampleReport });

    // Exactly ONE "UXFactory Review" group after two reviews
    const groups = fig.currentPage.children.filter((n) => n.name === "UXFactory Review");
    expect(groups).toHaveLength(1);
  });

  it("skips a flag whose node is absent without crashing, increments skipped count", async () => {
    const fig = makeFigma();

    // Only add HeaderNode — ButtonNode is absent
    const headerNode = fig.createRectangle();
    headerNode.name = "HeaderNode";
    headerNode.resize(400, 44);
    fig.currentPage.appendChild(headerNode);

    await loadCode(fig);
    await fig.__send({ type: "review", report: sampleReport });

    // No crash
    expect(lastOfType(fig, "review-error")).toBeUndefined();

    // review-done with skipped=1
    const done = lastOfType(fig, "review-done");
    expect(done).toBeDefined();
    expect(done!.skipped).toBe(1);

    // Only 1 badge rectangle for HeaderNode (badge-num labels use lowercase prefix)
    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    expect(group).toBeDefined();
    const badges = group!.children.filter((n) => n.name.startsWith("Badge"));
    expect(badges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Fix C1 — notes panel fallback: nothing vanishes
// ---------------------------------------------------------------------------
describe("Fix C1 — unmatched ElementFlag appears in notes panel (not silently dropped)", () => {
  it("token-conformance ElementFlag with no matching node appears in notes panel [not on canvas]", async () => {
    const fig = makeFigma();
    // No nodes on canvas — "#FF0000" will never be found by findByName.
    await loadCode(fig);

    const report: ReviewReportLike = {
      conformant: false,
      findings: [
        {
          property: "#FF0000",
          status: "unmet",
          detail: "ad-hoc color #FF0000 is not a registered token",
        },
      ],
    };

    await fig.__send({ type: "review", report });

    // review-done posted with skipped=1 (no badge drawn — node absent)
    const done = lastOfType(fig, "review-done");
    expect(done).toBeDefined();
    expect(done!.skipped).toBe(1);

    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    expect(group).toBeDefined();

    // No badge rectangle (node not on canvas)
    const badges = group!.children.filter((n) => n.name.startsWith("Badge"));
    expect(badges).toHaveLength(0);

    // But the flag IS surfaced in the notes panel — not vanished, not only a skip count
    const notes = group!.children.find((n) => n.name === "Review notes");
    expect(notes).toBeDefined();
    const notesText = notes!.children.find((n) => n.name === "notes-content");
    expect(notesText).toBeDefined();
    expect(notesText!.characters).toContain("ad-hoc color #FF0000 is not a registered token");
    expect(notesText!.characters).toContain("[not on canvas]");
    expect(notesText!.characters).toContain("Element flags:");
  });

  it("requirement-coverage finding (requirement set) becomes a CoverageGap in the panel", async () => {
    const fig = makeFigma();
    await loadCode(fig);

    const report: ReviewReportLike = {
      conformant: false,
      findings: [
        {
          property: "loading", // state token, not a node name
          status: "unmet",
          detail: "story story-2 AC implies a loading state with no matching node",
          requirement: "story-2",
        },
      ],
    };

    await fig.__send({ type: "review", report });

    // No ElementFlags → skipped=0
    const done = lastOfType(fig, "review-done");
    expect(done!.skipped).toBe(0);

    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    const notes = group!.children.find((n) => n.name === "Review notes");
    const notesText = notes!.children.find((n) => n.name === "notes-content");

    // Requirement-coverage finding → CoverageGap section (NOT Element flags)
    expect(notesText!.characters).toContain("Coverage gaps:");
    expect(notesText!.characters).toContain("implies a loading state with no matching node");
    // No Element flags section since the plan has 0 ElementFlags
    expect(notesText!.characters).not.toContain("Element flags:");
  });
});

// ---------------------------------------------------------------------------
// Fix I1 — amber (advisory) badges fire when property is set
// ---------------------------------------------------------------------------
describe("Fix I1 — advisory finding with property produces amber badge", () => {
  it("advisory finding with property draws an AMBER badge on the found frame", async () => {
    const fig = makeFigma();

    const orphanFrame = fig.createRectangle();
    orphanFrame.name = "orphan-screen";
    orphanFrame.x = 100;
    orphanFrame.y = 50;
    orphanFrame.resize(375, 812);
    fig.currentPage.appendChild(orphanFrame);

    await loadCode(fig);

    const advisoryReport: ReviewReportLike = {
      conformant: true,
      findings: [
        // Advisory finding WITH property — simulates coverage-orphans after Fix I1
        { status: "advisory", property: "orphan-screen", detail: "Frame has no story basis" },
      ],
    };

    await fig.__send({ type: "review", report: advisoryReport });

    expect(lastOfType(fig, "review-error")).toBeUndefined();

    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    expect(group).toBeDefined();

    const badges = group!.children.filter((n) => n.name.startsWith("Badge"));
    expect(badges).toHaveLength(1);

    // Must be AMBER fill (~#FB8C00): high red, moderate green, near-zero blue
    const fills = badges[0]!.fills as Array<{
      type: string;
      color: { r: number; g: number; b: number };
    }>;
    expect(fills[0]!.type).toBe("SOLID");
    expect(fills[0]!.color.r).toBeGreaterThan(0.9); // orange-red channel high
    expect(fills[0]!.color.g).toBeGreaterThan(0.4); // green channel (makes it amber)
    expect(fills[0]!.color.b).toBeLessThan(0.1); // blue near zero
  });
});

// ---------------------------------------------------------------------------
// Fix I2 — badge number text + element flags section in notes
// ---------------------------------------------------------------------------
describe("Fix I2 — badge number text node + element flags section", () => {
  it("found-node badge has a visible badge-num text AND an element flags entry in notes", async () => {
    const fig = makeFigma();

    const buttonNode = fig.createRectangle();
    buttonNode.name = "ButtonNode";
    buttonNode.x = 50;
    buttonNode.y = 100;
    buttonNode.resize(200, 40);
    fig.currentPage.appendChild(buttonNode);

    await loadCode(fig);

    const simpleReport: ReviewReportLike = {
      conformant: false,
      findings: [{ property: "ButtonNode", status: "unmet", detail: "Must have 44px min height" }],
    };

    await fig.__send({ type: "review", report: simpleReport });

    expect(lastOfType(fig, "review-error")).toBeUndefined();

    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    expect(group).toBeDefined();

    // Badge rectangle (found node)
    const badge = group!.children.find((n) => n.name === "Badge 1");
    expect(badge).toBeDefined();

    // Fix I2a: badge number visible as a text node (named "badge-num-1")
    const badgeLabel = group!.children.find((n) => n.name === "badge-num-1");
    expect(badgeLabel).toBeDefined();
    expect(badgeLabel!.characters).toBe("1");

    // Fix I2b: notes panel includes "Element flags" section
    const notes = group!.children.find((n) => n.name === "Review notes");
    const notesText = notes!.children.find((n) => n.name === "notes-content");
    expect(notesText!.characters).toContain("Element flags:");
    expect(notesText!.characters).toContain("[violation]");
    expect(notesText!.characters).toContain("Must have 44px min height");
    expect(notesText!.characters).toContain("(ButtonNode)");
  });
});

// ---------------------------------------------------------------------------
// Fix I1 — reliability: "best-effort" shows in the notes panel header
// ---------------------------------------------------------------------------
describe("Fix I1 — reliability label in notes panel", () => {
  it("notes panel includes 'Reliability: best-effort' when report.reliability is best-effort", async () => {
    const fig = makeFigma();

    const buttonNode = fig.createRectangle();
    buttonNode.name = "ButtonNode";
    buttonNode.x = 50;
    buttonNode.y = 100;
    buttonNode.resize(200, 40);
    fig.currentPage.appendChild(buttonNode);

    await loadCode(fig);

    const bestEffortReport: ReviewReportLike = {
      conformant: false,
      reliability: "best-effort",
      findings: [{ property: "ButtonNode", status: "unmet", detail: "Button is too small" }],
    };

    await fig.__send({ type: "review", report: bestEffortReport });

    expect(lastOfType(fig, "review-error")).toBeUndefined();

    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    expect(group).toBeDefined();

    const notes = group!.children.find((n) => n.name === "Review notes");
    expect(notes).toBeDefined();
    const notesText = notes!.children.find((n) => n.name === "notes-content");
    expect(notesText).toBeDefined();

    // Fix I1: reliability label must be visible in the notes panel.
    expect(notesText!.characters).toContain("best-effort");
    expect(notesText!.characters).toContain("Reliability:");
    expect(notesText!.characters).toContain("inferred from canvas");
  });

  it("notes panel does NOT include reliability line when report.reliability is exact", async () => {
    const fig = makeFigma();

    const buttonNode = fig.createRectangle();
    buttonNode.name = "ButtonNode";
    buttonNode.x = 50;
    buttonNode.y = 100;
    buttonNode.resize(200, 40);
    fig.currentPage.appendChild(buttonNode);

    await loadCode(fig);

    const exactReport: ReviewReportLike = {
      conformant: false,
      reliability: "exact",
      findings: [{ property: "ButtonNode", status: "unmet", detail: "Button is too small" }],
    };

    await fig.__send({ type: "review", report: exactReport });

    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    const notes = group!.children.find((n) => n.name === "Review notes");
    const notesText = notes!.children.find((n) => n.name === "notes-content");

    // For exact reviews, the reliability line should not appear.
    expect(notesText!.characters).not.toContain("Reliability:");
  });

  it("notes panel does NOT include reliability line when reliability is omitted", async () => {
    const fig = makeFigma();

    const buttonNode = fig.createRectangle();
    buttonNode.name = "ButtonNode";
    buttonNode.resize(200, 40);
    fig.currentPage.appendChild(buttonNode);

    await loadCode(fig);

    // No reliability field — old-format report.
    const noReliabilityReport: ReviewReportLike = {
      conformant: true,
      findings: [],
    };

    await fig.__send({ type: "review", report: noReliabilityReport });

    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    const notes = group!.children.find((n) => n.name === "Review notes");
    const notesText = notes!.children.find((n) => n.name === "notes-content");
    expect(notesText!.characters).not.toContain("Reliability:");
  });
});

// ---------------------------------------------------------------------------
// Fix I3 — clipsContent=false + no orphan on forced failure
// ---------------------------------------------------------------------------
describe("Fix I3 — no-clip container + orphan-clear on draw failure", () => {
  it("UXFactory Review container has clipsContent === false", async () => {
    const fig = makeFigma();

    const buttonNode = fig.createRectangle();
    buttonNode.name = "ButtonNode";
    buttonNode.resize(200, 40);
    fig.currentPage.appendChild(buttonNode);

    await loadCode(fig);
    await fig.__send({ type: "review", report: sampleReport });

    expect(lastOfType(fig, "review-error")).toBeUndefined();

    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    expect(group).toBeDefined();
    // clipsContent must be false so badges outside the 1×1 frame are visible on real Figma
    expect((group as unknown as { clipsContent: boolean }).clipsContent).toBe(false);
  });

  it("forced draw failure (font load throws) leaves no orphan group and posts review-error", async () => {
    const fig = makeFigma();
    // Override loadFontAsync to reject — this fires AFTER page.appendChild(group),
    // so the group IS on the page when the catch runs and must be removed.
    (fig as unknown as Record<string, unknown>).loadFontAsync = () =>
      Promise.reject(new Error("font unavailable in test"));

    await loadCode(fig);
    await fig.__send({ type: "review", report: sampleReport });

    // review-error was posted with the font failure message
    const err = lastOfType(fig, "review-error");
    expect(err).toBeDefined();
    expect(err!.message).toContain("font unavailable in test");

    // No "UXFactory Review" group may remain as an orphan on the page
    const orphan = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    expect(orphan).toBeUndefined();
  });
});

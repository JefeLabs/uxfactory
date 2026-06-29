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

    // Only 1 badge for HeaderNode
    const group = fig.currentPage.children.find((n) => n.name === "UXFactory Review");
    expect(group).toBeDefined();
    const badges = group!.children.filter((n) => n.name.startsWith("Badge"));
    expect(badges).toHaveLength(1);
  });
});

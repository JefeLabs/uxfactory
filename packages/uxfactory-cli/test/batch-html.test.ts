import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { batchHtmlMode } from "../src/commands/batch-html.js";
import { resolveInputs } from "../src/batch/registry.js";
import { batchCmd } from "../src/commands/batch.js";
import { BridgeClient } from "../src/client.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";
import type { RenderSnapshot } from "../src/batch/html-checks.js";

let root: string;

const stories = {
  stories: [{
    id: "checkout", role: "user", goal: "pay", benefit: "done",
    acceptanceCriteria: [{ statement: "ok", impliedState: "success" }],
  }],
};
const tokens = { colors: { ink: "#111111" } };
const trace = {
  version: 1,
  pages: [{ file: "screens/checkout.html", views: [{ id: "success", covers: [{ story: "checkout", impliedState: "success", selector: "#ok" }] }] }],
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-batch-html-"));
  await mkdir(path.join(root, "design/screens"), { recursive: true });
  await writeFile(path.join(root, "design/acceptance-criteria.json"), JSON.stringify(stories));
  await writeFile(path.join(root, "design/tokens.ds.json"), JSON.stringify(tokens));
  await writeFile(path.join(root, "design/trace.json"), JSON.stringify(trace));
  await writeFile(path.join(root, "design/screens/checkout.html"), "<!doctype html><html><body><h1 id=ok>ok</h1></body></html>");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function inputsFor(): ReturnType<typeof resolveInputs> {
  return resolveInputs(
    { version: 1, inputs: { stories: "design/acceptance-criteria.json", tokens: "design/tokens.ds.json", screens: "design/screens", trace: "design/trace.json" } },
    root,
  );
}

const goodSnap: RenderSnapshot = {
  page: "screens/checkout.html", view: "success", viewport: { width: 390, height: 844 },
  screenshot: "checkout-success.png", ok: true,
  coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true }],
  paintedColors: [{ hex: "#111111", exampleSelector: "h1" }], axe: [],
};

describe("batchHtmlMode", () => {
  it("returns EXIT.OK and writes report.json when the rendering passes", async () => {
    const io = makeIO();
    const code = await batchHtmlMode(
      "design",
      { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined, undefined, undefined, undefined, undefined,
      { renderViews: async () => [goodSnap] },
    );
    expect(code).toBe(EXIT.OK);
    const report = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/report.json"), "utf8"));
    expect(report.clean).toBe(true);
    expect(report.checks.map((c: { id: string }) => c.id)).toContain("render-coverage");
  });

  it("returns EXIT.GATE_FAIL when a binding must check fails", async () => {
    const io = makeIO();
    const badSnap: RenderSnapshot = { ...goodSnap, coverChecks: [{ ...goodSnap.coverChecks[0]!, visible: false }] };
    const code = await batchHtmlMode(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined, undefined, undefined, undefined, undefined, { renderViews: async () => [badSnap] },
    );
    expect(code).toBe(EXIT.GATE_FAIL);
  });

  it("returns EXIT.TRANSPORT when the renderer is unavailable", async () => {
    const io = makeIO();
    const code = await batchHtmlMode(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined, undefined, undefined, undefined, undefined,
      { renderViews: async () => { throw new Error("playwright not installed"); } },
    );
    expect(code).toBe(EXIT.TRANSPORT);
  });

  it("honors the committed registry scope when no --scope flag or profile scope is set", async () => {
    const io = makeIO();
    // No flags.scope and no profileScope, but the registry committed scope "visual".
    const code = await batchHtmlMode(
      "design",
      { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root },
      io, inputsFor(), undefined, "visual", undefined, undefined, undefined,
      { renderViews: async () => [goodSnap] },
    );
    // The committed registry scope is honored — no spurious "set a render scope" EXIT.TRANSPORT.
    expect(code).toBe(EXIT.OK);
  });

  it("renders once per registry viewport, at that viewport's size", async () => {
    const io = makeIO();
    const seen: { width: number; height: number; previewDir: string }[] = [];
    const code = await batchHtmlMode(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined, undefined, undefined,
      [
        { name: "desktop", width: 1920, height: 1080 },
        { name: "mobile-portrait", width: 390, height: 844 },
      ],
      undefined,
      {
        renderViews: async (req) => {
          seen.push({ ...req.viewport, previewDir: req.previewDir });
          return [{ ...goodSnap, viewport: req.viewport }];
        },
      },
    );
    expect(code).toBe(EXIT.OK);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ width: 1920, height: 1080 });
    expect(seen[1]).toMatchObject({ width: 390, height: 844 });
    // Screenshots partition per viewport so filenames can't collide.
    expect(seen[0]!.previewDir).toContain("desktop");
    expect(seen[1]!.previewDir).toContain("mobile-portrait");

    // The gate ran over the union of snapshots from both viewports.
    const report = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/report.json"), "utf8"));
    expect(report.clean).toBe(true);
    expect(report.screens).toHaveLength(2);
  });

  it("no registry viewports → single legacy 390×844 render", async () => {
    const io = makeIO();
    const seen: { width: number; height: number }[] = [];
    const code = await batchHtmlMode(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined, undefined, undefined, undefined, undefined,
      {
        renderViews: async (req) => {
          seen.push(req.viewport);
          return [goodSnap];
        },
      },
    );
    expect(code).toBe(EXIT.OK);
    expect(seen).toEqual([{ width: 390, height: 844 }]);
  });

  it("passes the registry unit to the gate: atom relaxes story coverage; report echoes unit", async () => {
    const io = makeIO();
    // Covers no story at all — fails render-coverage for a page, passes for an atom.
    const componentSnap: RenderSnapshot = { ...goodSnap, coverChecks: [] };
    const code = await batchHtmlMode(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined, undefined, "atom", undefined, undefined,
      { renderViews: async () => [componentSnap] },
    );
    expect(code).toBe(EXIT.OK);
    const report = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/report.json"), "utf8"));
    expect(report.unit).toBe("atom");
    expect(report.clean).toBe(true);
  });

  it("passes the registry designStyle to the gate: advisory findings never fail the exit code", async () => {
    const io = makeIO();
    const shadowySnap: RenderSnapshot = {
      ...goodSnap,
      styleStats: { shadowCount: 5, fontFamilies: ["inter"], visibleElements: 40, roundedBlocks: 2 },
    };
    const code = await batchHtmlMode(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined, undefined, undefined, undefined, "flat",
      { renderViews: async () => [shadowySnap] },
    );
    expect(code).toBe(EXIT.OK); // advisory only
    const report = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/report.json"), "utf8"));
    expect(report.designStyle).toBe("flat");
    const sc = report.checks.find((c: { id: string }) => c.id === "style-conformance");
    expect(sc.status).toBe("fail");
    expect(sc.severity).toBe("advisory");
  });

  it("loads the previous report.json as the story-regression baseline: a newly-lost story fails must", async () => {
    const twoStories = {
      stories: [
        { id: "checkout", role: "user", goal: "pay", benefit: "done", acceptanceCriteria: [{ statement: "ok", impliedState: "success" }] },
        { id: "profile", role: "user", goal: "view profile", benefit: "info", acceptanceCriteria: [{ statement: "ok", impliedState: "success" }] },
      ],
    };
    await writeFile(path.join(root, "design/acceptance-criteria.json"), JSON.stringify(twoStories));

    // Seed a qualifying baseline (no unit, no storyRefs): "profile" is already
    // uncovered there, so its continued absence is NOT a regression.
    const baseline = {
      scope: "visual",
      rubric: ["render-coverage"],
      mustPassFailed: true,
      clean: false,
      checks: [
        {
          id: "render-coverage",
          status: "fail",
          severity: "must",
          findings: [{ detail: "story profile success state is not covered by any visible rendering", ref: "profile/success" }],
        },
      ],
    };
    await mkdir(path.join(root, ".uxfactory/batch"), { recursive: true });
    await writeFile(path.join(root, ".uxfactory/batch/report.json"), JSON.stringify(baseline));

    const io = makeIO();
    // This run revises "profile" (storyRefs); "checkout" — covered at baseline,
    // not a ref — loses coverage entirely: a genuine regression.
    const regressedSnap: RenderSnapshot = { ...goodSnap, coverChecks: [] };
    const code = await batchHtmlMode(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined, undefined, "story", undefined, undefined,
      { renderViews: async () => [regressedSnap] }, undefined, ["profile"],
    );
    expect(code).toBe(EXIT.GATE_FAIL);
    const report = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/report.json"), "utf8"));
    const sr = report.checks.find((c: { id: string }) => c.id === "story-regression");
    expect(sr.status).toBe("fail");
    expect(sr.reason).toBe("baseline: last full-denominator report");
    expect(sr.findings.some((f: { detail: string }) => f.detail.includes("checkout"))).toBe(true);
    expect(sr.findings.some((f: { detail: string }) => f.detail.includes("profile"))).toBe(false);
  });

  it("no pre-existing report.json → story-regression runs strict", async () => {
    const twoStories = {
      stories: [
        { id: "checkout", role: "user", goal: "pay", benefit: "done", acceptanceCriteria: [{ statement: "ok", impliedState: "success" }] },
        { id: "profile", role: "user", goal: "view profile", benefit: "info", acceptanceCriteria: [{ statement: "ok", impliedState: "success" }] },
      ],
    };
    await writeFile(path.join(root, "design/acceptance-criteria.json"), JSON.stringify(twoStories));

    const io = makeIO();
    // This run revises "checkout" (storyRefs); "profile" — a co-located,
    // non-ref story — is covered here too, so strict mode (no baseline) still passes.
    const bothCoveredSnap: RenderSnapshot = {
      ...goodSnap,
      coverChecks: [
        ...goodSnap.coverChecks,
        { story: "profile", impliedState: "success", selector: "#ok", found: true, visible: true },
      ],
    };
    const code = await batchHtmlMode(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined, undefined, "story", undefined, undefined,
      { renderViews: async () => [bothCoveredSnap] }, undefined, ["checkout"],
    );
    expect(code).toBe(EXIT.OK);
    const report = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/report.json"), "utf8"));
    const sr = report.checks.find((c: { id: string }) => c.id === "story-regression");
    expect(sr.status).toBe("pass");
    expect(sr.reason).toMatch(/strict/);
  });
});

// Guards CORRECTION 1: batchCmd must reach the HTML branch (right after readRegistry,
// BEFORE the *.uxfactory.json readdir) when screens + trace are registered — even with
// no spec files present. We stop it at the scope-unset check so no browser is launched.
describe("batchCmd HTML branch (CORRECTION 1)", () => {
  it("does NOT return the no-specs error when screens+trace are registered", async () => {
    // Registry selects HTML mode (screens + trace) but declares no render scope.
    await writeFile(
      path.join(root, "uxfactory.batch.json"),
      JSON.stringify({ version: 1, inputs: { screens: "design/screens", trace: "design/trace.json" } }),
      "utf8",
    );
    const io = makeIO();
    // The client is never used on the HTML branch; a non-connecting URL is fine.
    const client = new BridgeClient("http://127.0.0.1:1");
    const code = await batchCmd(
      path.join(root, "specs"), // no *.uxfactory.json specs here — spec path would error
      { dataDir: path.join(root, ".uxfactory"), cwd: root },
      io,
      client,
    );
    expect(code).toBe(EXIT.TRANSPORT);
    // Reached batchHtmlMode's scope-unset gate — proves the early branch fired.
    expect(io.errText()).toMatch(/set a render scope before requesting a batch/);
    // And did NOT fall through to the spec-directory readdir.
    expect(io.errText()).not.toMatch(/no \*\.uxfactory\.json specs found/);
  });
});

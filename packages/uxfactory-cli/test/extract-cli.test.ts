import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractCmd } from "../src/commands/extract.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";
import { validate } from "@uxfactory/spec";
import type { RenderSnapshot } from "../src/batch/html-checks.js";
import { node } from "./extract-fixtures.js";

let root: string;
// covers must be non-empty — validateTrace rejects covers: []
const trace = {
  version: 1,
  pages: [{ file: "screens/checkout.html", views: [
    { id: "success", covers: [{ story: "checkout", impliedState: "success", selector: "body" }] },
    { id: "error",   covers: [{ story: "checkout", impliedState: "error",   selector: "body" }] },
  ] }],
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-extract-"));
  await mkdir(path.join(root, "design/screens"), { recursive: true });
  await writeFile(path.join(root, "design/trace.json"), JSON.stringify(trace));
  await writeFile(path.join(root, "design/screens/checkout.html"), "<!doctype html><html><body></body></html>");
  await writeFile(path.join(root, "uxfactory.batch.json"), JSON.stringify({
    version: 1, inputs: { screens: "design/screens", trace: "design/trace.json" },
  }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const snap = (view: string, ok = true): RenderSnapshot => ({
  page: "screens/checkout.html", view, viewport: { width: 390, height: 844 },
  screenshot: `checkout-${view}.png`, ok, ...(ok ? {} : { error: "boom" }),
  coverChecks: [], paintedColors: [], axe: [],
  ...(ok ? { domTree: node({ tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 },
    children: [node({ tag: "h1", bbox: { x: 20, y: 20, width: 200, height: 32 }, text: "Done" })] }) } : {}),
});

describe("extractCmd", () => {
  it("renders with captureDom, assembles, validates, writes combined + per-view files", async () => {
    const io = makeIO();
    let sawCapture = false;
    const code = await extractCmd(
      "design",
      { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root },
      io,
      { renderViews: async (r) => { sawCapture = r.captureDom === true; return [snap("success"), snap("error")]; } },
    );
    expect(code).toBe(EXIT.OK);
    expect(sawCapture).toBe(true);
    const combined = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/designspec/design.designspec.json"), "utf8"));
    expect(validate(combined).valid).toBe(true);
    expect(combined.frames).toHaveLength(2);
    const perView = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/designspec/checkout-success.designspec.json"), "utf8"));
    expect(validate(perView).valid).toBe(true);
    expect(perView.frames).toHaveLength(1);
    expect(perView.frames[0].x).toBe(0);
    // real makeIO uses outText(), not stdout()
    const summary = JSON.parse(io.outText().trim().split("\n").at(-1)!);
    expect(summary.ok).toBe(true);
    expect(summary.views).toBe(2);
  });

  it("excludes failed views, still writes the good ones, and exits 1", async () => {
    const io = makeIO();
    const code = await extractCmd(
      "design",
      { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root },
      io,
      { renderViews: async () => [snap("success"), snap("error", false)] },
    );
    expect(code).toBe(EXIT.GATE_FAIL);
    const combined = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/designspec/design.designspec.json"), "utf8"));
    expect(combined.frames).toHaveLength(1);
    const summary = JSON.parse(io.outText().trim().split("\n").at(-1)!);
    expect(summary.excluded).toEqual([{ page: "screens/checkout.html", view: "error", error: "boom" }]);
  });

  it("exits 2 when screens/trace are not registered", async () => {
    await writeFile(path.join(root, "uxfactory.batch.json"), JSON.stringify({ version: 1, inputs: {} }));
    const io = makeIO();
    const code = await extractCmd("design", { dataDir: path.join(root, ".uxfactory"), cwd: root }, io,
      { renderViews: async () => [] });
    expect(code).toBe(EXIT.TRANSPORT);
  });
});

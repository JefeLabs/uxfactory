import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderViewsPlaywright } from "../src/render/html-render-playwright.js";
import type { CapturedNode } from "../src/render/dom-capture.js";

const PAGE = `<!doctype html><html><body style="margin:0">
  <div id="card" style="display:flex;flex-direction:column;gap:8px;padding:16px;background:#ffffff;width:200px">
    <h1 style="margin:0">Title</h1>
    <p style="margin:0">Body <b>bold</b> tail</p>
  </div>
</body></html>`;

describe("EXTRACT_FN in a real browser", () => {
  it("captures a serializable tree with bboxes, styles, and #text runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-domcap-"));
    await mkdir(path.join(root, "previews"), { recursive: true });
    await writeFile(path.join(root, "page.html"), PAGE);
    const snaps = await renderViewsPlaywright({
      baseDir: root,
      trace: { version: 1, pages: [{ file: "page.html", views: [{ id: "default", covers: [] }] }] },
      previewDir: path.join(root, "previews"),
      viewport: { width: 390, height: 844 },
      captureDom: true,
    });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.ok).toBe(true);
    const tree = snaps[0]!.domTree as CapturedNode;
    expect(tree.tag).toBe("body");
    const card = tree.children.find((c) => c.sel === "div#card")!;
    expect(card.styles.display).toBe("flex");
    expect(card.styles.flexDirection).toBe("column");
    expect(card.bbox.width).toBeGreaterThan(0);
    const h1 = card.children.find((c) => c.tag === "h1")!;
    expect(h1.text).toBe("Title");
    // The <p> has a <b> element child + text runs → #text children with real bboxes.
    const p = card.children.find((c) => c.tag === "p")!;
    const runs = p.children.filter((c) => c.tag === "#text");
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0]!.text).toBe("Body");
    expect(runs[0]!.bbox.width).toBeGreaterThan(0);
  }, 60_000);
});

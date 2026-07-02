import { describe, it, expect } from "vitest";
import { EXTRACT_FN } from "../src/render/dom-capture.js";
import { renderHtml } from "../src/render/html-render.js";
import type { HtmlRenderRequest } from "../src/render/html-render.js";

describe("EXTRACT_FN", () => {
  it("is a parseable single-argument function expression", () => {
    // Parsed (not executed — it needs a DOM); throws on syntax error.
    const fn = new Function(`return (${EXTRACT_FN});`)();
    expect(typeof fn).toBe("function");
    expect(fn.length).toBe(0);
  });
});

describe("renderHtml captureDom passthrough", () => {
  it("hands captureDom to the injected renderer", async () => {
    let seen: HtmlRenderRequest | null = null;
    await renderHtml(
      {
        baseDir: "/tmp", trace: { version: 1, pages: [] }, previewDir: "/tmp",
        viewport: { width: 390, height: 844 }, captureDom: true,
      },
      { renderViews: async (r) => { seen = r; return []; } },
    );
    expect(seen?.captureDom).toBe(true);
  });
});

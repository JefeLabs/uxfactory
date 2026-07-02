import type { CapturedNode } from "../src/render/dom-capture.js";
import type { ExtractedView } from "../src/extract/dom-to-designspec.js";

/** Fixture helper: a CapturedNode with all-neutral styles, overridable. */
export function node(partial: Partial<CapturedNode> & { tag: string }): CapturedNode {
  return {
    sel: partial.tag, bbox: { x: 0, y: 0, width: 100, height: 50 }, text: null, children: [],
    styles: {
      display: "block", flexDirection: "row", justifyContent: "normal", alignItems: "normal",
      rowGap: "normal", columnGap: "normal", gridTemplateColumns: "none", gridTemplateRows: "none",
      paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderTopWidth: "0px", borderRightWidth: "0px", borderBottomWidth: "0px", borderLeftWidth: "0px",
      borderTopColor: "rgb(0, 0, 0)",
      borderTopLeftRadius: "0px", borderTopRightRadius: "0px",
      borderBottomRightRadius: "0px", borderBottomLeftRadius: "0px",
      boxShadow: "none", opacity: "1", color: "rgb(17, 24, 39)",
      fontSize: "16px", fontWeight: "400", fontFamily: "Inter, sans-serif", lineHeight: "24px",
    },
    ...partial,
  };
}

export const VIEWPORT = { width: 390, height: 844 };

export const view = (tree: CapturedNode, pageName = "screens/checkout.html", viewId = "success"): ExtractedView =>
  ({ page: pageName, view: viewId, viewport: VIEWPORT, tree });

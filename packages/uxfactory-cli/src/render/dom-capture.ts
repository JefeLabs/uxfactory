/**
 * In-page DOM capture for the DOM→DesignSpec extractor (SP3b).
 * EXTRACT_FN is a string-form function (the CAPTURE_FN convention) evaluated in
 * the browser against the settled+frozen DOM — the engine tsconfig stays DOM-free.
 * Raw computed strings cross the wire; ALL parsing happens Node-side.
 */

/** The computed-style subset the assembler maps. Raw computed strings. */
export interface CapturedStyles {
  display: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  rowGap: string;
  columnGap: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  backgroundColor: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderTopColor: string;
  borderTopLeftRadius: string;
  borderTopRightRadius: string;
  borderBottomRightRadius: string;
  borderBottomLeftRadius: string;
  boxShadow: string;
  opacity: string;
  color: string;
}

/** One visible element (or `#text` run) in the captured tree. Fully serializable. */
export interface CapturedNode {
  /** Lowercase tag name, or "#text" for a measured text run inside mixed content. */
  tag: string;
  /** Short selector for naming: tag + #id or .firstClass (e.g. "div#cart", "button.pay"). */
  sel: string;
  /** Absolute viewport coordinates (page unscrolled — equals document coords). */
  bbox: { x: number; y: number; width: number; height: number };
  /** Collapsed text: set for text-only leaf elements and #text runs; null otherwise. */
  text: string | null;
  styles: CapturedStyles;
  children: CapturedNode[];
}

/** Tags treated as replaced/media leaves — never recursed into. */
export const REPLACED_TAGS = ["img", "svg", "canvas", "video", "picture"] as const;

/**
 * In-page walker: body → CapturedNode tree. Visibility-filtered (same rules as
 * CAPTURE_FN). Mixed-content text runs are measured with a DOM Range.
 */
export const EXTRACT_FN = `() => {
  const REPLACED = ["img", "svg", "canvas", "video", "picture"];
  const STYLE_KEYS = ["display","flexDirection","justifyContent","alignItems","rowGap","columnGap",
    "gridTemplateColumns","gridTemplateRows","paddingTop","paddingRight","paddingBottom","paddingLeft",
    "backgroundColor","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth",
    "borderTopColor","borderTopLeftRadius","borderTopRightRadius","borderBottomRightRadius",
    "borderBottomLeftRadius","boxShadow","opacity","color"];
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const shortSel = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + el.id;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/)[0] : "";
    return cls ? tag + "." + cls : tag;
  };
  const collapse = (s) => s.replace(/\\s+/g, " ").trim();
  const box = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const styleSubset = (el) => {
    const s = getComputedStyle(el);
    const out = {};
    for (const k of STYLE_KEYS) out[k] = s[k];
    return out;
  };
  const walk = (el) => {
    const tag = el.tagName.toLowerCase();
    const node = {
      tag, sel: shortSel(el), bbox: box(el.getBoundingClientRect()),
      text: null, styles: styleSubset(el), children: [],
    };
    if (REPLACED.includes(tag)) return node;
    const elementChildren = [];
    const textRuns = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 1) {
        if (visible(child)) elementChildren.push(child);
      } else if (child.nodeType === 3) {
        const t = collapse(child.textContent || "");
        if (t !== "") textRuns.push(child);
      }
    }
    if (elementChildren.length === 0) {
      // Text-only (or empty) leaf: carry collapsed text directly.
      const t = collapse(el.textContent || "");
      if (t !== "") node.text = t;
      return node;
    }
    // Mixed content: measure each text run with a Range so it lands as a child.
    for (const child of el.childNodes) {
      if (child.nodeType === 1) {
        if (visible(child)) node.children.push(walk(child));
      } else if (child.nodeType === 3) {
        const t = collapse(child.textContent || "");
        if (t === "") continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          node.children.push({
            tag: "#text", sel: "#text", bbox: box(r), text: t,
            styles: styleSubset(el), children: [],
          });
        }
      }
    }
    return node;
  };
  return walk(document.body);
}`;

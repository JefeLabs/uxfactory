import { describe, it, expect } from "vitest";
import { renderChips, toggleChip, dialChip, type ChipGroup } from "./chips.js";

// ---------------------------------------------------------------------------
// Fixtures — the verbatim chip enums from the plan's Global Constraints (§8).
// ---------------------------------------------------------------------------

/** category `marketing·ecommerce·web_app·news` (single-select). */
const CATEGORY: ChipGroup = {
  id: "category",
  mode: "single",
  selected: ["ecommerce"],
  options: [
    { value: "marketing", label: "Marketing" },
    { value: "ecommerce", label: "E-commerce" },
    { value: "web_app", label: "Web app" },
    { value: "news", label: "News" },
  ],
};

/** gates `requirement-coverage·token-conformance·flow-reachability·coverage-orphans·reuse` (multi-select). */
const GATES: ChipGroup = {
  id: "gates",
  mode: "multi",
  selected: ["requirement-coverage", "reuse"],
  options: [
    { value: "requirement-coverage", label: "Requirement coverage" },
    { value: "token-conformance", label: "Token conformance" },
    { value: "flow-reachability", label: "Flow reachability" },
    { value: "coverage-orphans", label: "Coverage orphans" },
    { value: "reuse", label: "Reuse" },
  ],
};

/** Count non-overlapping occurrences of `needle` in `hay`. */
function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// toggleChip
// ---------------------------------------------------------------------------

describe("toggleChip — single mode replaces", () => {
  it("returns exactly [value], discarding the previous selection", () => {
    expect(toggleChip(CATEGORY, "news")).toEqual(["news"]);
  });

  it("replaces even when the value is already selected (single is a radio)", () => {
    expect(toggleChip(CATEGORY, "ecommerce")).toEqual(["ecommerce"]);
  });

  it("does not mutate the input group's selected array", () => {
    const before = [...CATEGORY.selected];
    toggleChip(CATEGORY, "news");
    expect(CATEGORY.selected).toEqual(before);
  });
});

describe("toggleChip — multi mode toggles", () => {
  it("adds a value that is not selected", () => {
    expect(toggleChip(GATES, "token-conformance")).toEqual([
      "requirement-coverage",
      "reuse",
      "token-conformance",
    ]);
  });

  it("removes a value that is already selected", () => {
    expect(toggleChip(GATES, "reuse")).toEqual(["requirement-coverage"]);
  });

  it("add then remove round-trips back to the original selection", () => {
    const added = toggleChip(GATES, "flow-reachability");
    const removed = toggleChip({ ...GATES, selected: added }, "flow-reachability");
    expect(removed).toEqual(GATES.selected);
  });

  it("does not mutate the input group's selected array", () => {
    const before = [...GATES.selected];
    toggleChip(GATES, "token-conformance");
    toggleChip(GATES, "reuse");
    expect(GATES.selected).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// renderChips
// ---------------------------------------------------------------------------

describe("renderChips — selection + data attributes", () => {
  it("emits one chip per option", () => {
    const html = renderChips(CATEGORY);
    expect(count(html, "<button")).toBe(CATEGORY.options.length);
  });

  it("carries the group id + value as data- attributes for the delegated click handler", () => {
    const html = renderChips(CATEGORY);
    for (const opt of CATEGORY.options) {
      expect(html).toContain(`data-chip-value="${opt.value}"`);
    }
    expect(count(html, 'data-chip-group="category"')).toBeGreaterThanOrEqual(
      CATEGORY.options.length,
    );
  });

  it("marks the selected chip(s) and only those", () => {
    const html = renderChips(GATES);
    // 2 selected → 2 aria-pressed="true", the rest false
    expect(count(html, 'aria-pressed="true"')).toBe(2);
    expect(count(html, 'aria-pressed="false"')).toBe(GATES.options.length - 2);
    expect(count(html, "selected")).toBeGreaterThanOrEqual(2);
  });

  it("marks every chip disabled when the group is disabled", () => {
    const html = renderChips({ ...CATEGORY, disabled: true });
    expect(count(html, "disabled")).toBeGreaterThanOrEqual(CATEGORY.options.length);
    expect(html).toContain('data-disabled="true"');
  });

  it("omits the disabled markers when the group is enabled", () => {
    const html = renderChips(CATEGORY);
    expect(html).not.toContain('data-disabled="true"');
  });
});

describe("renderChips — HTML escaping (no injection)", () => {
  const INJECT: ChipGroup = {
    id: "x",
    mode: "single",
    selected: ["a<b"],
    options: [{ value: 'a<b&c"', label: 'Tom & "Jerry" <script>' }],
  };

  it("escapes &, <, >, and \" in labels", () => {
    const html = renderChips(INJECT);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;");
    expect(html).toContain("&quot;");
  });

  it("escapes the value inside the data- attribute", () => {
    const html = renderChips(INJECT);
    expect(html).not.toContain('data-chip-value="a<b&c"');
    expect(html).toContain("a&lt;b&amp;c&quot;");
  });
});

// ---------------------------------------------------------------------------
// dialChip
// ---------------------------------------------------------------------------

describe("dialChip — low/medium/high dial", () => {
  it("renders exactly three levels", () => {
    const html = dialChip("visual", "medium");
    expect(count(html, "<button")).toBe(3);
    expect(html).toContain('data-dial-level="low"');
    expect(html).toContain('data-dial-level="medium"');
    expect(html).toContain('data-dial-level="high"');
  });

  it("marks the active level and only the active level", () => {
    const html = dialChip("flow", "high");
    expect(count(html, 'aria-pressed="true"')).toBe(1);
    expect(count(html, 'aria-pressed="false"')).toBe(2);
    // the active one is the high level
    expect(html).toMatch(/data-dial-level="high"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-dial-level="high"/);
  });

  it("carries the dial id + level as data- attributes for the click handler", () => {
    const html = dialChip("editorial", "low");
    expect(count(html, 'data-chip-group="editorial"')).toBeGreaterThanOrEqual(3);
    expect(html).toContain('data-chip-value="low"');
    expect(html).toContain('data-chip-value="medium"');
    expect(html).toContain('data-chip-value="high"');
  });

  it("escapes the dial id", () => {
    const html = dialChip('a"b', "low");
    expect(html).not.toContain('data-chip-group="a"b"');
    expect(html).toContain("a&quot;b");
  });
});

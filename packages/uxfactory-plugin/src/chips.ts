/**
 * chips.ts — the pipeline panel's chip-selector component: a pure HTML-string
 * renderer plus the selection helpers that drive single/multi chip groups and
 * the low/medium/high scope dials.
 *
 * BOUNDARY (load-bearing): this module is pure UI. It imports NOTHING — no
 * `@helmsmith/*`, no LLM / agent runtime, no `agentcore` / `runpod` / `cloud`
 * surface, not even a framework. The esbuild-inlined UI builds its markup as
 * strings (see `ui.html`'s inlined-bundle slot), so these helpers return HTML
 * strings rather than DOM nodes.
 *
 * EVENT MODEL: rendered chips carry `data-chip-group` (the group/dial id) and
 * `data-chip-value` (the option value / dial level) so the view can attach ONE
 * delegated click handler that reads both off the clicked `<button>` and calls
 * `toggleChip` to compute the next selection. The render functions never bind
 * handlers themselves.
 *
 * ESCAPING: every caller-supplied label, value, and id is HTML-escaped (`&`,
 * `<`, `>`, `"`, `'`) so no chip enum — or future dynamic value — can inject
 * markup, whether it lands in element text or inside a double-quoted attribute.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One selectable chip: a machine `value` and a human `label`. */
export interface ChipOption {
  value: string;
  label: string;
}

/**
 * A group of chips. `single` behaves like a radio (one selection); `multi`
 * behaves like a checkbox set (any number). `selected` holds the currently
 * chosen `value`s. When `disabled`, every chip renders non-interactive.
 */
export interface ChipGroup {
  id: string;
  options: ChipOption[];
  mode: "single" | "multi";
  selected: string[];
  disabled?: boolean;
}

/** The three scope-dial levels (`visual·editorial·coverage·flow` each take one). */
export type DialLevel = "low" | "medium" | "high";

const DIAL_LEVELS: readonly DialLevel[] = ["low", "medium", "high"];

/** Short labels for the dial levels (compact `low ◖med◗ high` control). */
const DIAL_LABELS: Record<DialLevel, string> = {
  low: "low",
  medium: "med",
  high: "high",
};

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * HTML-escape a string for safe use in BOTH element text and double-quoted
 * attribute values. `&` is replaced first so the other entities are not
 * double-escaped.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// renderChips
// ---------------------------------------------------------------------------

/**
 * Render a chip group as an HTML string. Each option becomes a `<button>` that
 * carries `data-chip-group` + `data-chip-value` for the view's delegated click
 * handler, an `aria-pressed` reflecting selection, a `selected` class on chosen
 * chips, and the `disabled` attribute + class when the group is disabled.
 */
export function renderChips(g: ChipGroup): string {
  const groupDisabled = g.disabled === true;
  const selected = new Set(g.selected);
  const id = esc(g.id);

  const chips = g.options
    .map((opt) => {
      const isSelected = selected.has(opt.value);
      const classes = ["chip"];
      if (isSelected) classes.push("selected");
      if (groupDisabled) classes.push("disabled");

      const attrs = [
        `class="${classes.join(" ")}"`,
        `type="button"`,
        `data-chip-group="${id}"`,
        `data-chip-value="${esc(opt.value)}"`,
        `aria-pressed="${isSelected ? "true" : "false"}"`,
      ];
      if (isSelected) attrs.push(`data-selected="true"`);
      if (groupDisabled) attrs.push("disabled", `aria-disabled="true"`);

      return `<button ${attrs.join(" ")}>${esc(opt.label)}</button>`;
    })
    .join("");

  const groupAttrs = [
    `class="chip-group${groupDisabled ? " disabled" : ""}"`,
    `role="group"`,
    `data-chip-group="${id}"`,
    `data-mode="${g.mode}"`,
  ];
  if (groupDisabled) groupAttrs.push(`data-disabled="true"`);

  return `<div ${groupAttrs.join(" ")}>${chips}</div>`;
}

// ---------------------------------------------------------------------------
// toggleChip
// ---------------------------------------------------------------------------

/**
 * Compute the NEXT `selected` array for a chip group, given the clicked value.
 * Pure — it never mutates `g` or `g.selected`.
 *  - `single`: replaces the selection with `[value]` (radio semantics).
 *  - `multi`: toggles `value` in/out of the current selection (checkbox set).
 */
export function toggleChip(g: ChipGroup, value: string): string[] {
  if (g.mode === "single") return [value];
  return g.selected.includes(value)
    ? g.selected.filter((v) => v !== value)
    : [...g.selected, value];
}

// ---------------------------------------------------------------------------
// dialChip
// ---------------------------------------------------------------------------

/**
 * Render a named low/medium/high scope dial as an HTML string. The three levels
 * become `<button>`s that share the chip event model — `data-chip-group` (the
 * dial id) + `data-chip-value` (the level) — so the SAME delegated click handler
 * drives both chips and dials, plus a `data-dial-level` marker for styling. The
 * `active` level is marked (class + `aria-pressed="true"`).
 */
export function dialChip(id: string, level: DialLevel): string {
  const dialId = esc(id);

  const levels = DIAL_LEVELS.map((lvl) => {
    const active = lvl === level;
    const classes = ["dial-level"];
    if (active) classes.push("active");

    const attrs = [
      `class="${classes.join(" ")}"`,
      `type="button"`,
      `data-chip-group="${dialId}"`,
      `data-chip-value="${lvl}"`,
      `data-dial-level="${lvl}"`,
      `aria-pressed="${active ? "true" : "false"}"`,
    ];
    if (active) attrs.push(`data-active="true"`);

    return `<button ${attrs.join(" ")}>${DIAL_LABELS[lvl]}</button>`;
  }).join("");

  return `<div class="dial" role="radiogroup" data-dial="${dialId}" data-chip-group="${dialId}">${levels}</div>`;
}

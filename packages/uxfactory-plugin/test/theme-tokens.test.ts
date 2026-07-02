/**
 * theme-tokens.test.ts — drift net between Tailwind class usage and @theme.
 *
 * Tailwind v4 only generates utilities for shades declared as --color-* in
 * @theme; a class naming an undeclared shade (e.g. bg-primary-300 with no
 * --color-primary-300) compiles to NOTHING — no build error, the element just
 * loses that style. This shipped an invisible Connect button. Every custom
 * palette shade referenced in ui/ sources must be declared in panel.css.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const UI_ROOT = join(__dirname, "..", "ui");
const PANEL_CSS = join(UI_ROOT, "panel.css");

/** Custom palettes declared in @theme; default Tailwind palettes (gray, red-50, …) always exist. */
const CUSTOM_PALETTES = ["primary", "success", "warn", "fail", "ok"] as const;

const CLASS_RE = new RegExp(
  `(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|decoration|accent|caret|shadow)-(${CUSTOM_PALETTES.join("|")})-(\\d+)`,
  "g",
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

describe("panel.css @theme covers every custom palette shade used in ui/", () => {
  it("declares a --color-<palette>-<shade> for each class referencing one", () => {
    const declared = new Set(
      [...readFileSync(PANEL_CSS, "utf8").matchAll(/--color-([a-z]+)-(\d+)\s*:/g)].map(
        (m) => `${m[1]}-${m[2]}`,
      ),
    );

    const missing = new Map<string, string[]>();
    for (const file of sourceFiles(UI_ROOT)) {
      if (file === PANEL_CSS) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(CLASS_RE)) {
        const token = `${m[1]}-${m[2]}`;
        if (!declared.has(token)) {
          const rel = file.slice(UI_ROOT.length + 1);
          if (!missing.get(token)?.includes(rel)) {
            missing.set(token, [...(missing.get(token) ?? []), rel]);
          }
        }
      }
    }

    const report = [...missing.entries()]
      .map(([token, files]) => `--color-${token} (used in ${files.join(", ")})`)
      .join("\n");
    expect(missing.size, `undeclared theme tokens:\n${report}`).toBe(0);
  });
});

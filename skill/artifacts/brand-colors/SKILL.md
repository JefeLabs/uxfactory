---
name: uxfactory-artifact-brand-colors
description: "Draft the brand-colors section of a project's design system — anchor hues with roles, derived from the project's classification, audience, and any brand direction. Use when a producer is asked to author or seed the brand-colors artifact. Produces exactly the brand-colors section; the bridge merges it into design-system.json."
compatibility: "Runs offline against the project's pinned classification/profile — no external service."
---

# Draft brand-colors

You author **one** artifact: the `brand-colors` section of the design system. Ground every choice in the project's registered artifacts — read `uxfactory.classification.json` (category, industry, style), `uxfactory.profile.json`, and any `audience`/`brief` under `.uxfactory/artifacts/`.

## Output shape

Emit JSON for the brand-colors section only:

```json
{
  "anchors": { "primary": "#RRGGBB", "primary-hover": "#RRGGBB", "accent": "#RRGGBB" },
  "neutrals": { "text.primary": "#RRGGBB", "text.secondary": "#RRGGBB", "surface": "#RRGGBB", "border": "#RRGGBB" },
  "semantic": { "success": "#RRGGBB", "warning": "#RRGGBB", "danger": "#RRGGBB" },
  "assumptions": ["…"]
}
```

## Rules that make it good (self-eval before finishing)

1. **Roles, not swatches** — every hue names its job (primary/accent/surface/text/border/semantic). A palette without roles is unusable downstream.
2. **Contrast is a hard constraint** — `text.primary` on `surface` must reach WCAG AA (4.5:1); if the audience notes small-text or vision sensitivity, target AAA (7:1). State the ratios you hit in `assumptions`.
3. **A point of view** — do not default to the generic corporate blue unless the classification's `style` demands it. Let category/industry push the accent toward something the product would actually own. A distinctive-but-appropriate accent beats a safe one.
4. **Coherent, not rainbow** — one primary, one accent, semantic colors that harmonize; neutrals with a slight hue bias toward the primary, not pure grey.
5. **Honest assumptions** — anything you inferred (no registered brand, a chosen direction) goes in `assumptions`, verbatim.

Produce the section and stop. Do not author fonts, grid, or typography — those are their own artifacts.

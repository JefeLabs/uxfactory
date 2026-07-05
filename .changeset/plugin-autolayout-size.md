---
"@uxfactory/plugin": patch
---

Auto-layout frames keep their spec size. Real Figma shrink-wraps a frame
to its children the instant layoutMode is enabled, and pinning the sizing
modes FIXED afterwards freezes that hugged size — the resize done at
creation was silently lost, so fixed-width containers (e.g. a 1280px nav
inside a plain header) rendered hugged. The renderer now restores the
planned dimensions after enabling auto-layout, except on axes the spec
declares hug. The test mock models the hug-on-enable behavior so this
class of infidelity fails in tests, not on canvas.

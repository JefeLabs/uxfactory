---
"@uxfactory/cli": minor
---

The gate consumes the new system artifacts. A registered accessibility
contract (.uxfactory/artifacts/accessibility.json) escalates the
a11y and contrast checks to bound at ANY fidelity — registration
upgrades the posture (mapping decision 14). A typography artifact
(design-system.json#typography) activates the advisory
typography-conformance check: the renderer now measures body-copy
minimum font size and line measure (chars per line) per view, checked
against the artifact's limits (minBodySizePx — strictest of per-device
values — and lineLengthCh.max). Advisory severity: readability
findings inform, never fail the gate.

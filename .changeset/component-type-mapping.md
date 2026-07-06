---
"@uxfactory/spec": minor
"@uxfactory/plugin": patch
---

The component-type → artifact requirement mapping ships as data.
@uxfactory/spec gains ARTIFACT_REGISTRY (12 registered + 20 planned
IDs), COMPONENT_TYPE_MAPPING (15 types), QUADRANT_MODIFIERS, and
resolveRequirements() honoring the PRD's resolution order — base
requires → quadrant overrides → n/a dropped → planned never blocks.
Consistency tests encode the doc's invariants (registry closure,
stories/AC lockstep, resolver-consumed exclusion).

The composer's GROUNDED IN chips are now type-aware: resolved per
selected unit type, with required-missing rendered as a distinct
create-affordance chip, planned artifacts as disabled coming-soon
chips, and optional artifacts shown only when they exist. Missing
blocking requirements never block submission — the run is annotated
ungoverned:true on the wire and the composer shows the escape-hatch
hint (mapping decision 1, escape hatch default-on).

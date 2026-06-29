/**
 * condition.ts — The conditioning function (§6.6 Stage 2).
 *
 * `condition(classification) → GateProfile`
 *
 * A FIXED per-dimension effect map; conflicting effects resolve
 * strictest-wins (a compliance/raising effect always dominates a relaxing one).
 * PURE — no I/O, no Date/random, no LLM.
 *
 * Reuses `scope.ts` LEVEL_ORD for dial comparisons; does NOT re-implement scope logic.
 * Implements design §3.1 effect map + §3.2 manifest dispositions VERBATIM.
 */

import type { ProjectClassification } from "./classification.js";
import type { RenderScope } from "../batch/scope.js";
import { LEVEL_ORD } from "../batch/scope.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Requirement = "requested" | "generatable" | "suppressed";
export type GateEffect = "hard" | "soft" | "suppressed";

export interface ManifestEntry {
  /** A §4 catalog kind (AcceptanceCriterion, TokenSet, UserFlow, …). */
  artifact_kind: string;
  requirement: Requirement;
  gate_effect: GateEffect;
  /** true only for engine-checkable artifacts (stories / tokens / flow / reuse). */
  enforced: boolean;
  /** Dimension(s) that forced this entry — provenance trail. */
  derived_from: string[];
}

export interface GateProfile {
  /** Derived scope: category defaults ⊕ explicit dials, floors applied. */
  scope: RenderScope;
  /** §3.2 artifact manifest — one entry per §4 catalog kind. */
  manifest: ManifestEntry[];
  /** Compliance constraints (FERPA, COPPA, HIPAA, disclosure) — deduped, strictest-wins. */
  constraints: string[];
  /** Tier-weighting / archetype notes (recorded; engine doesn't weight yet). */
  notes: string[];
  /** Draft until `--confirm` pins it; batch refuses a draft profile. */
  confirm_status: "draft" | "approved";
}

// ---------------------------------------------------------------------------
// condition
// ---------------------------------------------------------------------------

/**
 * Maps a `ProjectClassification` to a `GateProfile` (the pinned plan).
 * `confirm_status` defaults to "draft" — `uxfactory classify --confirm` pins it.
 */
export function condition(c: ProjectClassification): GateProfile {
  const scope = deriveScope(c);
  return {
    scope,
    manifest: deriveManifest(c, scope),
    constraints: deriveConstraints(c),
    notes: deriveNotes(c),
    confirm_status: "draft",
  };
}

// ---------------------------------------------------------------------------
// Scope derivation — §3.1 "Scope dials"
// ---------------------------------------------------------------------------

/** The four scope dials (typed tuple for iteration). */
const DIALS = ["visual", "editorial", "coverage", "flow"] as const;

/**
 * Category-specific scope FLOORS (strictest-wins).
 *
 * marketing → coverage:low, flow:low (shallow archetype)
 * web_app   → coverage:high, flow:high (stateful archetype — BINDING FLOORS; can't be lowered)
 * ecommerce, news → no category floors (classification dials used as-is)
 */
function categoryFloors(category: ProjectClassification["category"]): Partial<RenderScope> {
  if (category === "marketing") return { coverage: "low", flow: "low" };
  if (category === "web_app") return { coverage: "high", flow: "high" };
  return {};
}

/**
 * Derive the final RenderScope:
 *   1. Start from classification's explicit scope dials.
 *   2. Apply category floors (strictest-wins: max(dial, floor) — a floor can never be lowered).
 *
 * Reuses LEVEL_ORD from scope.ts for ordinal comparisons.
 */
function deriveScope(c: ProjectClassification): RenderScope {
  // Step 1: seed from classification's explicit dials (all four always present after validation)
  const scope: RenderScope = { ...c.scope };

  // Step 2: apply category floors (raise any dial that falls below the floor; never lower)
  const floors = categoryFloors(c.category);
  for (const dial of DIALS) {
    const floor = floors[dial];
    if (floor !== undefined && LEVEL_ORD[scope[dial]] < LEVEL_ORD[floor]) {
      scope[dial] = floor;
    }
  }

  return scope;
}

// ---------------------------------------------------------------------------
// Constraints — §3.1 "Industry"
// ---------------------------------------------------------------------------

/**
 * Derive compliance constraints from the industry dimension.
 * education → FERPA + COPPA; healthcare → HIPAA; finance → disclosure.
 * Deduped via Set (strictest-wins: a constraint once forced can't be removed).
 */
function deriveConstraints(c: ProjectClassification): string[] {
  const set = new Set<string>();
  if (c.industry === "education") {
    set.add("FERPA");
    set.add("COPPA");
  } else if (c.industry === "healthcare") {
    set.add("HIPAA");
  } else if (c.industry === "finance") {
    set.add("disclosure");
  }
  // corporate / consumer → no constraints (defaults)
  return [...set];
}

// ---------------------------------------------------------------------------
// Notes — §3.1 tier-weighting + archetype notes
// ---------------------------------------------------------------------------

/**
 * Derive tier-weighting and archetype notes.
 * Recorded for human review at the Confirm gate; the engine does not weight on them yet.
 */
function deriveNotes(c: ProjectClassification): string[] {
  const notes: string[] = [];

  // §3.1 Category tier notes
  if (c.category === "ecommerce") notes.push("Tier 2 up");
  if (c.category === "news") notes.push("Tier 9 up");
  if (c.category === "marketing") notes.push("Tiers 6-7 up; Tier 2 light");
  if (c.category === "web_app") notes.push("Tiers 2-4 up");

  // §3.1 Age demographic notes
  if (c.age_demographic === "children") {
    notes.push("dark-pattern ban; simplified flows");
  }

  // §3.1 Style notes
  if (c.style === "formal") {
    notes.push("formal voice; Tier 8 voice threshold tightened");
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Manifest — §3.2 per-artifact dispositions
// ---------------------------------------------------------------------------

/**
 * Derive the gate_effect from requirement + enforced.
 *
 * Mapping (from design §3.2):
 *   enforced=true  + requested   → "hard"       (engine blocks if missing)
 *   generatable   (any enforced) → "soft"       (engine warns / skips)
 *   suppressed    (any enforced) → "suppressed"  (engine ignores)
 *   enforced=false + requested   → "soft"       (agent/confirm prompts; engine doesn't gate)
 */
function toGateEffect(requirement: Requirement, enforced: boolean): GateEffect {
  if (requirement === "suppressed") return "suppressed";
  if (requirement === "requested" && enforced) return "hard";
  return "soft";
}

/** Build a single ManifestEntry. */
function entry(
  artifact_kind: string,
  requirement: Requirement,
  enforced: boolean,
  derived_from: string[],
): ManifestEntry {
  return {
    artifact_kind,
    requirement,
    gate_effect: toGateEffect(requirement, enforced),
    enforced,
    derived_from,
  };
}

/**
 * Derive the full §3.2 manifest.
 * One entry per §4 catalog kind; enforced=true only for engine-checkable artifacts.
 */
function deriveManifest(c: ProjectClassification, scope: RenderScope): ManifestEntry[] {
  const entries: ManifestEntry[] = [];

  // ── AcceptanceCriterion (→ stories) ──────────────────────────────────────
  // always requested (the moat); enforced → batch requirement-coverage / readiness stories
  entries.push(entry("AcceptanceCriterion", "requested", true, []));

  // ── TokenSet (→ tokens) ──────────────────────────────────────────────────
  // requested if scope.visual ≥ medium; else generatable
  // enforced → token-conformance / readiness tokens
  {
    const req: Requirement = LEVEL_ORD[scope.visual] >= LEVEL_ORD["medium"] ? "requested" : "generatable";
    entries.push(entry("TokenSet", req, true, ["scope.visual"]));
  }

  // ── UserFlow (→ flow) ────────────────────────────────────────────────────
  // requested if scope.flow ≥ medium; else generatable
  // enforced → flow-reachability / readiness flow
  {
    const req: Requirement = LEVEL_ORD[scope.flow] >= LEVEL_ORD["medium"] ? "requested" : "generatable";
    entries.push(entry("UserFlow", req, true, ["scope.flow"]));
  }

  // ── reuse specs ──────────────────────────────────────────────────────────
  // generatable/optional; enforced → reuse (optional, never blocks readiness)
  entries.push(entry("reuse", "generatable", true, []));

  // ── A11yProfile ──────────────────────────────────────────────────────────
  // requested if age=children OR industry=education; else generatable
  // enforced: false (declared — engine doesn't gate)
  {
    const derivedFrom: string[] = [];
    if (c.age_demographic === "children") derivedFrom.push("age_demographic");
    if (c.industry === "education") derivedFrom.push("industry");
    const req: Requirement = derivedFrom.length > 0 ? "requested" : "generatable";
    entries.push(entry("A11yProfile", req, false, derivedFrom));
  }

  // ── BrandGuide.Rule ──────────────────────────────────────────────────────
  // requested if category ∈ {marketing, ecommerce}; else generatable
  // enforced: false (declared)
  {
    const req: Requirement =
      c.category === "marketing" || c.category === "ecommerce" ? "requested" : "generatable";
    entries.push(entry("BrandGuide.Rule", req, false, ["category"]));
  }

  // ── EditorialStyle ───────────────────────────────────────────────────────
  // generatable (drafted from style+industry); requested if scope.editorial ≥ medium
  // enforced: false (declared)
  {
    const derivedFrom: string[] = ["style", "industry"];
    const req: Requirement =
      LEVEL_ORD[scope.editorial] >= LEVEL_ORD["medium"] ? "requested" : "generatable";
    if (req === "requested") derivedFrom.push("scope.editorial");
    entries.push(entry("EditorialStyle", req, false, derivedFrom));
  }

  // ── MotionSystem ─────────────────────────────────────────────────────────
  // suppressed if scope.visual=low; generatable otherwise
  // enforced: false (declared)
  {
    const req: Requirement = scope.visual === "low" ? "suppressed" : "generatable";
    entries.push(entry("MotionSystem", req, false, ["scope.visual"]));
  }

  // ── DiscoverabilityStrategy ──────────────────────────────────────────────
  // requested if category=news; suppressed if category=web_app; else generatable
  // enforced: false (declared)
  {
    let req: Requirement = "generatable";
    if (c.category === "news") req = "requested";
    else if (c.category === "web_app") req = "suppressed";
    entries.push(entry("DiscoverabilityStrategy", req, false, ["category"]));
  }

  return entries;
}

/**
 * condition.ts — TDD tests (written RED before implementation).
 *
 * Covers every row of the design §3.1 effect map + §3.2 manifest dispositions:
 *   - Category archetypes: scope defaults/floors, notes, category-specific manifest entries
 *   - Industry compliance: constraints, A11yProfile floor
 *   - Age=children: A11yProfile requested + dark-pattern note
 *   - Style=formal: editorial voice note
 *   - Scope derivation: category defaults ⊕ explicit dials
 *   - Strictest-wins: a relaxing dial can't lower a category floor
 *   - Enforced flags: only AcceptanceCriterion/TokenSet/UserFlow/reuse
 *   - derived_from provenance on every manifest entry
 */

import { describe, it, expect } from "vitest";
import { condition } from "../src/classify/condition.js";
import type { GateProfile, ManifestEntry } from "../src/classify/condition.js";
import type { ProjectClassification } from "../src/classify/classification.js";
import { requiredInputs } from "../src/batch/scope.js";
import type { RenderScope } from "../src/batch/scope.js";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/** A fully valid baseline classification (web_app, corporate, 26-35, informal, high everywhere). */
const BASE: ProjectClassification = {
  version: 1,
  category: "web_app",
  industry: "corporate",
  age_demographic: "26-35",
  style: "informal",
  scope: { visual: "high", editorial: "medium", coverage: "high", flow: "high" },
  flow_refs: [],
};

/** Merge overrides into BASE; scope is deep-merged. */
function cls(
  overrides: Partial<Omit<ProjectClassification, "scope">> & {
    scope?: Partial<ProjectClassification["scope"]>;
  },
): ProjectClassification {
  return {
    ...BASE,
    ...overrides,
    scope: overrides.scope ? { ...BASE.scope, ...overrides.scope } : BASE.scope,
  };
}

/** Find a manifest entry by artifact_kind (throws if missing — tests surface the failure). */
function findEntry(profile: GateProfile, kind: string): ManifestEntry {
  const entry = profile.manifest.find((e) => e.artifact_kind === kind);
  if (!entry) throw new Error(`Missing manifest entry: ${kind}`);
  return entry;
}

// ---------------------------------------------------------------------------
// §3.1 — Category archetypes
// ---------------------------------------------------------------------------

describe("category=marketing", () => {
  it("produces a draft GateProfile with confirm_status: draft", () => {
    const p = condition(cls({ category: "marketing" }));
    expect(p.confirm_status).toBe("draft");
  });

  it("contains the tier note: 'Tiers 6-7 up; Tier 2 light'", () => {
    const p = condition(cls({ category: "marketing" }));
    expect(p.notes.some((n) => n.includes("Tiers 6-7") && n.includes("Tier 2"))).toBe(true);
  });

  it("BrandGuide.Rule is requested for marketing", () => {
    const p = condition(cls({ category: "marketing" }));
    const e = findEntry(p, "BrandGuide.Rule");
    expect(e.requirement).toBe("requested");
  });

  it("DiscoverabilityStrategy is generatable for marketing (not news, not web_app)", () => {
    const p = condition(cls({ category: "marketing" }));
    const e = findEntry(p, "DiscoverabilityStrategy");
    expect(e.requirement).toBe("generatable");
  });

  it("marketing scope: coverage=low, flow=low when classification sets them low", () => {
    const p = condition(
      cls({
        category: "marketing",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    expect(p.scope.coverage).toBe("low");
    expect(p.scope.flow).toBe("low");
  });

  it("marketing scope: explicit high dials stay high (category floor=low is trivial)", () => {
    const p = condition(
      cls({
        category: "marketing",
        scope: { visual: "high", editorial: "high", coverage: "high", flow: "high" },
      }),
    );
    expect(p.scope.coverage).toBe("high");
    expect(p.scope.flow).toBe("high");
  });
});

describe("category=web_app", () => {
  it("contains the tier note: 'Tiers 2-4 up'", () => {
    const p = condition(cls({ category: "web_app" }));
    expect(p.notes.some((n) => n.includes("Tiers 2-4"))).toBe(true);
  });

  it("DiscoverabilityStrategy is suppressed for web_app", () => {
    const p = condition(cls({ category: "web_app" }));
    const e = findEntry(p, "DiscoverabilityStrategy");
    expect(e.requirement).toBe("suppressed");
    expect(e.gate_effect).toBe("suppressed");
  });

  it("web_app scope floor: coverage=high, flow=high (can't be lowered by classification dials)", () => {
    const p = condition(
      cls({
        category: "web_app",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    expect(p.scope.coverage).toBe("high");
    expect(p.scope.flow).toBe("high");
  });

  it("web_app: visual and editorial come from the classification dials", () => {
    const p = condition(
      cls({
        category: "web_app",
        scope: { visual: "medium", editorial: "high", coverage: "low", flow: "low" },
      }),
    );
    expect(p.scope.visual).toBe("medium");
    expect(p.scope.editorial).toBe("high");
  });

  it("BrandGuide.Rule is generatable for web_app", () => {
    const p = condition(cls({ category: "web_app" }));
    const e = findEntry(p, "BrandGuide.Rule");
    expect(e.requirement).toBe("generatable");
  });
});

describe("category=ecommerce", () => {
  it("contains the tier note: 'Tier 2 up'", () => {
    const p = condition(cls({ category: "ecommerce" }));
    expect(p.notes.some((n) => n.includes("Tier 2 up"))).toBe(true);
  });

  it("contains a payment-failure acceptance criteria note", () => {
    const p = condition(cls({ category: "ecommerce" }));
    expect(p.notes.some((n) => /payment.failure/i.test(n))).toBe(true);
  });

  it("BrandGuide.Rule is requested for ecommerce", () => {
    const p = condition(cls({ category: "ecommerce" }));
    const e = findEntry(p, "BrandGuide.Rule");
    expect(e.requirement).toBe("requested");
  });

  it("DiscoverabilityStrategy is generatable for ecommerce", () => {
    const p = condition(cls({ category: "ecommerce" }));
    const e = findEntry(p, "DiscoverabilityStrategy");
    expect(e.requirement).toBe("generatable");
  });

  it("ecommerce: scope comes directly from classification dials (no category floors)", () => {
    const p = condition(
      cls({
        category: "ecommerce",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    expect(p.scope.coverage).toBe("low");
    expect(p.scope.flow).toBe("low");
  });
});

describe("category=news", () => {
  it("contains the tier note: 'Tier 9 up'", () => {
    const p = condition(cls({ category: "news" }));
    expect(p.notes.some((n) => n.includes("Tier 9"))).toBe(true);
  });

  it("contains a reading-level note", () => {
    const p = condition(cls({ category: "news" }));
    expect(p.notes.some((n) => /reading.level/i.test(n))).toBe(true);
  });

  it("DiscoverabilityStrategy is requested for news", () => {
    const p = condition(cls({ category: "news" }));
    const e = findEntry(p, "DiscoverabilityStrategy");
    expect(e.requirement).toBe("requested");
  });

  it("news: scope comes directly from classification dials (no category floors)", () => {
    const p = condition(
      cls({
        category: "news",
        scope: { visual: "medium", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    expect(p.scope.coverage).toBe("low");
    expect(p.scope.flow).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// §3.1 — Industry compliance constraints + A11yProfile
// ---------------------------------------------------------------------------

describe("industry=education", () => {
  it("adds FERPA and COPPA to constraints", () => {
    const p = condition(cls({ industry: "education" }));
    expect(p.constraints).toContain("FERPA");
    expect(p.constraints).toContain("COPPA");
  });

  it("does NOT add HIPAA or disclosure for education", () => {
    const p = condition(cls({ industry: "education" }));
    expect(p.constraints).not.toContain("HIPAA");
    expect(p.constraints).not.toContain("disclosure");
  });

  it("A11yProfile is requested for education industry", () => {
    const p = condition(cls({ industry: "education", age_demographic: "26-35" }));
    const e = findEntry(p, "A11yProfile");
    expect(e.requirement).toBe("requested");
    expect(e.derived_from).toContain("industry");
  });

  it("notes include age-appropriate copy for education", () => {
    const p = condition(cls({ industry: "education" }));
    expect(p.notes.some((n) => /age-appropriate/i.test(n))).toBe(true);
  });
});

describe("industry=healthcare", () => {
  it("adds HIPAA to constraints", () => {
    const p = condition(cls({ industry: "healthcare" }));
    expect(p.constraints).toContain("HIPAA");
  });

  it("does NOT add FERPA, COPPA, or disclosure for healthcare", () => {
    const p = condition(cls({ industry: "healthcare" }));
    expect(p.constraints).not.toContain("FERPA");
    expect(p.constraints).not.toContain("COPPA");
    expect(p.constraints).not.toContain("disclosure");
  });

  it("notes include Tier 5 + Tier 8 rigor raised (HIPAA)", () => {
    const p = condition(cls({ industry: "healthcare" }));
    expect(p.notes.some((n) => /Tier 5.*Tier 8/i.test(n))).toBe(true);
  });
});

describe("industry=finance", () => {
  it("adds disclosure to constraints", () => {
    const p = condition(cls({ industry: "finance" }));
    expect(p.constraints).toContain("disclosure");
  });

  it("does NOT add FERPA, COPPA, or HIPAA for finance", () => {
    const p = condition(cls({ industry: "finance" }));
    expect(p.constraints).not.toContain("FERPA");
    expect(p.constraints).not.toContain("COPPA");
    expect(p.constraints).not.toContain("HIPAA");
  });

  it("notes include Tier 5 + Tier 8 rigor raised (disclosure)", () => {
    const p = condition(cls({ industry: "finance" }));
    expect(p.notes.some((n) => /Tier 5.*Tier 8/i.test(n))).toBe(true);
  });
});

describe("industry=corporate or consumer", () => {
  it("no compliance constraints for corporate", () => {
    const p = condition(cls({ industry: "corporate" }));
    expect(p.constraints).toHaveLength(0);
  });

  it("no compliance constraints for consumer", () => {
    const p = condition(cls({ industry: "consumer" }));
    expect(p.constraints).toHaveLength(0);
  });
});

describe("constraints deduplication", () => {
  it("constraints are deduped (no duplicate entries)", () => {
    // education always adds FERPA+COPPA; they should only appear once
    const p = condition(cls({ industry: "education" }));
    const ferpaCount = p.constraints.filter((c) => c === "FERPA").length;
    const coppaCount = p.constraints.filter((c) => c === "COPPA").length;
    expect(ferpaCount).toBe(1);
    expect(coppaCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §3.1 — Age demographic
// ---------------------------------------------------------------------------

describe("age_demographic=children", () => {
  it("A11yProfile is requested when age=children", () => {
    const p = condition(cls({ age_demographic: "children", industry: "corporate" }));
    const e = findEntry(p, "A11yProfile");
    expect(e.requirement).toBe("requested");
    expect(e.derived_from).toContain("age_demographic");
  });

  it("notes include 'dark-pattern ban' for age=children", () => {
    const p = condition(cls({ age_demographic: "children" }));
    expect(p.notes.some((n) => n.toLowerCase().includes("dark-pattern"))).toBe(true);
  });

  it("notes include reading_level for age=children", () => {
    const p = condition(cls({ age_demographic: "children" }));
    expect(p.notes.some((n) => /reading.level/i.test(n))).toBe(true);
  });

  it("A11yProfile derived_from contains both age_demographic and industry when both trigger it", () => {
    const p = condition(cls({ age_demographic: "children", industry: "education" }));
    const e = findEntry(p, "A11yProfile");
    expect(e.requirement).toBe("requested");
    expect(e.derived_from).toContain("age_demographic");
    expect(e.derived_from).toContain("industry");
  });
});

describe("age_demographic=other", () => {
  it("A11yProfile is generatable for non-children, non-education industry", () => {
    const p = condition(cls({ age_demographic: "26-35", industry: "corporate" }));
    const e = findEntry(p, "A11yProfile");
    expect(e.requirement).toBe("generatable");
  });
});

// ---------------------------------------------------------------------------
// §3.1 — Style
// ---------------------------------------------------------------------------

describe("style=formal", () => {
  it("notes include 'formal voice' for style=formal", () => {
    const p = condition(cls({ style: "formal" }));
    expect(p.notes.some((n) => n.toLowerCase().includes("formal voice"))).toBe(true);
  });

  it("notes include 'Tier 8' for style=formal (voice threshold tightened)", () => {
    const p = condition(cls({ style: "formal" }));
    expect(p.notes.some((n) => n.includes("Tier 8"))).toBe(true);
  });
});

describe("style=informal or mix", () => {
  it("no formal-voice note for informal", () => {
    const p = condition(cls({ style: "informal" }));
    expect(p.notes.some((n) => n.toLowerCase().includes("formal voice"))).toBe(false);
  });

  it("no formal-voice note for mix", () => {
    const p = condition(cls({ style: "mix" }));
    expect(p.notes.some((n) => n.toLowerCase().includes("formal voice"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3.2 — Per-artifact manifest dispositions
// ---------------------------------------------------------------------------

describe("AcceptanceCriterion manifest entry", () => {
  it("is always requested", () => {
    for (const category of ["marketing", "ecommerce", "web_app", "news"] as const) {
      const p = condition(cls({ category }));
      const e = findEntry(p, "AcceptanceCriterion");
      expect(e.requirement).toBe("requested");
    }
  });

  it("gate_effect=hard (enforced + requested)", () => {
    const p = condition(BASE);
    const e = findEntry(p, "AcceptanceCriterion");
    expect(e.gate_effect).toBe("hard");
  });

  it("enforced=true", () => {
    const p = condition(BASE);
    const e = findEntry(p, "AcceptanceCriterion");
    expect(e.enforced).toBe(true);
  });
});

describe("TokenSet manifest entry", () => {
  it("is requested when scope.visual >= medium", () => {
    const p = condition(
      cls({ scope: { visual: "medium", editorial: "low", coverage: "low", flow: "low" } }),
    );
    const e = findEntry(p, "TokenSet");
    expect(e.requirement).toBe("requested");
    expect(e.gate_effect).toBe("hard");
  });

  it("is requested when scope.visual = high", () => {
    const p = condition(
      cls({ scope: { visual: "high", editorial: "low", coverage: "low", flow: "high" } }),
    );
    const e = findEntry(p, "TokenSet");
    expect(e.requirement).toBe("requested");
    expect(e.gate_effect).toBe("hard");
  });

  it("is generatable when scope.visual = low", () => {
    const p = condition(
      cls({
        category: "ecommerce",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    const e = findEntry(p, "TokenSet");
    expect(e.requirement).toBe("generatable");
    expect(e.gate_effect).toBe("soft");
  });

  it("enforced=true regardless of requirement", () => {
    const pHigh = condition(
      cls({ scope: { visual: "high", editorial: "low", coverage: "low", flow: "high" } }),
    );
    const pLow = condition(
      cls({
        category: "ecommerce",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    expect(findEntry(pHigh, "TokenSet").enforced).toBe(true);
    expect(findEntry(pLow, "TokenSet").enforced).toBe(true);
  });

  it("derived_from contains 'scope.visual'", () => {
    const p = condition(BASE);
    const e = findEntry(p, "TokenSet");
    expect(e.derived_from).toContain("scope.visual");
  });
});

describe("UserFlow manifest entry", () => {
  it("is requested when scope.flow >= medium", () => {
    const p = condition(
      cls({ scope: { visual: "low", editorial: "low", coverage: "low", flow: "medium" } }),
    );
    const e = findEntry(p, "UserFlow");
    expect(e.requirement).toBe("requested");
    expect(e.gate_effect).toBe("hard");
  });

  it("is requested when scope.flow = high", () => {
    const p = condition(
      cls({ scope: { visual: "low", editorial: "low", coverage: "low", flow: "high" } }),
    );
    const e = findEntry(p, "UserFlow");
    expect(e.requirement).toBe("requested");
  });

  it("is generatable when scope.flow = low (and no web_app floor applies)", () => {
    const p = condition(
      cls({
        category: "ecommerce",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    const e = findEntry(p, "UserFlow");
    expect(e.requirement).toBe("generatable");
    expect(e.gate_effect).toBe("soft");
  });

  it("enforced=true regardless of requirement", () => {
    const pHigh = condition(
      cls({ scope: { visual: "low", editorial: "low", coverage: "low", flow: "high" } }),
    );
    const pLow = condition(
      cls({
        category: "ecommerce",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    expect(findEntry(pHigh, "UserFlow").enforced).toBe(true);
    expect(findEntry(pLow, "UserFlow").enforced).toBe(true);
  });

  it("derived_from contains 'scope.flow'", () => {
    const p = condition(BASE);
    const e = findEntry(p, "UserFlow");
    expect(e.derived_from).toContain("scope.flow");
  });
});

describe("reuse manifest entry", () => {
  it("is always generatable", () => {
    for (const category of ["marketing", "ecommerce", "web_app", "news"] as const) {
      const p = condition(cls({ category }));
      const e = findEntry(p, "reuse");
      expect(e.requirement).toBe("generatable");
      expect(e.gate_effect).toBe("soft");
    }
  });

  it("enforced=true (engine checks it, optional)", () => {
    const p = condition(BASE);
    const e = findEntry(p, "reuse");
    expect(e.enforced).toBe(true);
  });
});

describe("A11yProfile manifest entry", () => {
  it("is generatable for a neutral classification (no children, no education)", () => {
    const p = condition(cls({ age_demographic: "26-35", industry: "corporate" }));
    const e = findEntry(p, "A11yProfile");
    expect(e.requirement).toBe("generatable");
    expect(e.gate_effect).toBe("soft");
  });

  it("enforced=false (declared, engine doesn't gate)", () => {
    const p = condition(BASE);
    const e = findEntry(p, "A11yProfile");
    expect(e.enforced).toBe(false);
  });
});

describe("BrandGuide.Rule manifest entry", () => {
  it("is requested for marketing and ecommerce", () => {
    for (const category of ["marketing", "ecommerce"] as const) {
      const p = condition(cls({ category }));
      const e = findEntry(p, "BrandGuide.Rule");
      expect(e.requirement).toBe("requested");
    }
  });

  it("is generatable for web_app and news", () => {
    for (const category of ["web_app", "news"] as const) {
      const p = condition(cls({ category }));
      const e = findEntry(p, "BrandGuide.Rule");
      expect(e.requirement).toBe("generatable");
    }
  });

  it("enforced=false", () => {
    const p = condition(BASE);
    const e = findEntry(p, "BrandGuide.Rule");
    expect(e.enforced).toBe(false);
  });

  it("derived_from contains 'category'", () => {
    const p = condition(BASE);
    const e = findEntry(p, "BrandGuide.Rule");
    expect(e.derived_from).toContain("category");
  });
});

describe("EditorialStyle manifest entry", () => {
  it("is requested when scope.editorial >= medium", () => {
    const p = condition(
      cls({ scope: { visual: "low", editorial: "medium", coverage: "low", flow: "low" } }),
    );
    const e = findEntry(p, "EditorialStyle");
    expect(e.requirement).toBe("requested");
  });

  it("is generatable when scope.editorial = low", () => {
    const p = condition(
      cls({
        category: "ecommerce",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    const e = findEntry(p, "EditorialStyle");
    expect(e.requirement).toBe("generatable");
  });

  it("enforced=false (declared)", () => {
    const p = condition(BASE);
    const e = findEntry(p, "EditorialStyle");
    expect(e.enforced).toBe(false);
  });

  it("derived_from includes style and industry (drafted from them)", () => {
    const p = condition(BASE);
    const e = findEntry(p, "EditorialStyle");
    expect(e.derived_from).toContain("style");
    expect(e.derived_from).toContain("industry");
  });
});

describe("MotionSystem manifest entry", () => {
  it("is suppressed when scope.visual = low", () => {
    const p = condition(
      cls({
        category: "ecommerce",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    const e = findEntry(p, "MotionSystem");
    expect(e.requirement).toBe("suppressed");
    expect(e.gate_effect).toBe("suppressed");
  });

  it("is generatable when scope.visual = medium", () => {
    const p = condition(
      cls({ scope: { visual: "medium", editorial: "low", coverage: "low", flow: "high" } }),
    );
    const e = findEntry(p, "MotionSystem");
    expect(e.requirement).toBe("generatable");
    expect(e.gate_effect).toBe("soft");
  });

  it("is generatable when scope.visual = high", () => {
    const p = condition(
      cls({ scope: { visual: "high", editorial: "low", coverage: "low", flow: "high" } }),
    );
    const e = findEntry(p, "MotionSystem");
    expect(e.requirement).toBe("generatable");
    expect(e.gate_effect).toBe("soft");
  });

  it("enforced=false", () => {
    const p = condition(BASE);
    const e = findEntry(p, "MotionSystem");
    expect(e.enforced).toBe(false);
  });

  it("derived_from contains 'scope.visual'", () => {
    const p = condition(BASE);
    const e = findEntry(p, "MotionSystem");
    expect(e.derived_from).toContain("scope.visual");
  });
});

describe("DiscoverabilityStrategy manifest entry", () => {
  it("is requested for news", () => {
    const p = condition(cls({ category: "news" }));
    const e = findEntry(p, "DiscoverabilityStrategy");
    expect(e.requirement).toBe("requested");
  });

  it("is suppressed for web_app", () => {
    const p = condition(cls({ category: "web_app" }));
    const e = findEntry(p, "DiscoverabilityStrategy");
    expect(e.requirement).toBe("suppressed");
    expect(e.gate_effect).toBe("suppressed");
  });

  it("is generatable for marketing and ecommerce", () => {
    for (const category of ["marketing", "ecommerce"] as const) {
      const p = condition(cls({ category }));
      const e = findEntry(p, "DiscoverabilityStrategy");
      expect(e.requirement).toBe("generatable");
    }
  });

  it("enforced=false", () => {
    const p = condition(BASE);
    const e = findEntry(p, "DiscoverabilityStrategy");
    expect(e.enforced).toBe(false);
  });

  it("derived_from contains 'category'", () => {
    const p = condition(BASE);
    const e = findEntry(p, "DiscoverabilityStrategy");
    expect(e.derived_from).toContain("category");
  });
});

// ---------------------------------------------------------------------------
// Scope derivation
// ---------------------------------------------------------------------------

describe("scope derivation — category defaults ⊕ explicit dials", () => {
  it("web_app: classification.scope.coverage=low is raised to high by floor", () => {
    const p = condition(
      cls({
        category: "web_app",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "medium" },
      }),
    );
    expect(p.scope.coverage).toBe("high");
  });

  it("web_app: classification.scope.flow=low is raised to high by floor", () => {
    const p = condition(
      cls({
        category: "web_app",
        scope: { visual: "low", editorial: "low", coverage: "medium", flow: "low" },
      }),
    );
    expect(p.scope.flow).toBe("high");
  });

  it("web_app: classification.scope.coverage=high stays high (floor doesn't raise what's already high)", () => {
    const p = condition(
      cls({
        category: "web_app",
        scope: { visual: "low", editorial: "low", coverage: "high", flow: "high" },
      }),
    );
    expect(p.scope.coverage).toBe("high");
  });

  it("ecommerce: scope dials come directly from the classification (no floors)", () => {
    const p = condition(
      cls({
        category: "ecommerce",
        scope: { visual: "medium", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    expect(p.scope.visual).toBe("medium");
    expect(p.scope.editorial).toBe("low");
    expect(p.scope.coverage).toBe("low");
    expect(p.scope.flow).toBe("low");
  });

  it("news: scope dials come directly from the classification (no floors)", () => {
    const p = condition(
      cls({
        category: "news",
        scope: { visual: "high", editorial: "high", coverage: "medium", flow: "low" },
      }),
    );
    expect(p.scope.visual).toBe("high");
    expect(p.scope.editorial).toBe("high");
    expect(p.scope.coverage).toBe("medium");
    expect(p.scope.flow).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// Strictest-wins
// ---------------------------------------------------------------------------

describe("strictest-wins — a relaxing dial can't lower a compliance floor", () => {
  it("web_app coverage floor=high: cannot be lowered to medium by explicit dial", () => {
    const p = condition(
      cls({
        category: "web_app",
        scope: { visual: "low", editorial: "low", coverage: "medium", flow: "high" },
      }),
    );
    expect(p.scope.coverage).toBe("high");
  });

  it("web_app flow floor=high: cannot be lowered to low by explicit dial", () => {
    const p = condition(
      cls({
        category: "web_app",
        scope: { visual: "low", editorial: "low", coverage: "high", flow: "low" },
      }),
    );
    expect(p.scope.flow).toBe("high");
  });

  it("web_app: visual and editorial are NOT floored (classification's low stays low)", () => {
    const p = condition(
      cls({
        category: "web_app",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    expect(p.scope.visual).toBe("low");
    expect(p.scope.editorial).toBe("low");
  });

  it("marketing: no floor constraint — classification's coverage and flow are used as-is", () => {
    const p = condition(
      cls({
        category: "marketing",
        scope: { visual: "high", editorial: "high", coverage: "medium", flow: "high" },
      }),
    );
    expect(p.scope.coverage).toBe("medium");
    expect(p.scope.flow).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// enforced flags — only AcceptanceCriterion, TokenSet, UserFlow, reuse
// ---------------------------------------------------------------------------

describe("enforced flags", () => {
  const ENFORCED_KINDS = new Set(["AcceptanceCriterion", "TokenSet", "UserFlow", "reuse"]);
  const ALL_KINDS = [
    "AcceptanceCriterion",
    "TokenSet",
    "UserFlow",
    "reuse",
    "A11yProfile",
    "BrandGuide.Rule",
    "EditorialStyle",
    "MotionSystem",
    "DiscoverabilityStrategy",
  ];

  it("enforced=true only for AcceptanceCriterion, TokenSet, UserFlow, reuse", () => {
    const p = condition(BASE);
    for (const kind of ALL_KINDS) {
      const e = findEntry(p, kind);
      const expectedEnforced = ENFORCED_KINDS.has(kind);
      expect(e.enforced, `enforced for ${kind}`).toBe(expectedEnforced);
    }
  });
});

// ---------------------------------------------------------------------------
// derived_from provenance — every manifest entry must have it defined (array)
// ---------------------------------------------------------------------------

describe("derived_from provenance", () => {
  it("every manifest entry has a derived_from array (may be empty)", () => {
    const p = condition(BASE);
    for (const entry of p.manifest) {
      expect(Array.isArray(entry.derived_from), `derived_from for ${entry.artifact_kind}`).toBe(
        true,
      );
    }
  });

  it('AcceptanceCriterion.derived_from deep-equals ["always"] (total provenance sentinel)', () => {
    const p = condition(BASE);
    expect(findEntry(p, "AcceptanceCriterion").derived_from).toEqual(["always"]);
  });

  it('reuse.derived_from deep-equals ["always"] (total provenance sentinel)', () => {
    const p = condition(BASE);
    expect(findEntry(p, "reuse").derived_from).toEqual(["always"]);
  });

  it("TokenSet.derived_from contains 'scope.visual'", () => {
    const p = condition(BASE);
    expect(findEntry(p, "TokenSet").derived_from).toContain("scope.visual");
  });

  it("UserFlow.derived_from contains 'scope.flow'", () => {
    const p = condition(BASE);
    expect(findEntry(p, "UserFlow").derived_from).toContain("scope.flow");
  });

  it("A11yProfile.derived_from contains 'age_demographic' when age=children", () => {
    const p = condition(cls({ age_demographic: "children" }));
    expect(findEntry(p, "A11yProfile").derived_from).toContain("age_demographic");
  });

  it("A11yProfile.derived_from contains 'industry' when industry=education", () => {
    const p = condition(cls({ industry: "education", age_demographic: "26-35" }));
    expect(findEntry(p, "A11yProfile").derived_from).toContain("industry");
  });

  it("BrandGuide.Rule.derived_from contains 'category'", () => {
    const p = condition(BASE);
    expect(findEntry(p, "BrandGuide.Rule").derived_from).toContain("category");
  });

  it("DiscoverabilityStrategy.derived_from contains 'category'", () => {
    const p = condition(BASE);
    expect(findEntry(p, "DiscoverabilityStrategy").derived_from).toContain("category");
  });

  it("EditorialStyle.derived_from contains 'style' and 'industry'", () => {
    const p = condition(BASE);
    const e = findEntry(p, "EditorialStyle");
    expect(e.derived_from).toContain("style");
    expect(e.derived_from).toContain("industry");
  });

  it("MotionSystem.derived_from contains 'scope.visual'", () => {
    const p = condition(BASE);
    expect(findEntry(p, "MotionSystem").derived_from).toContain("scope.visual");
  });
});

// ---------------------------------------------------------------------------
// Manifest completeness — all §4 catalog kinds must be present
// ---------------------------------------------------------------------------

describe("manifest completeness", () => {
  it("manifest contains all 9 §4 catalog kinds", () => {
    const p = condition(BASE);
    const kinds = p.manifest.map((e) => e.artifact_kind);
    expect(kinds).toContain("AcceptanceCriterion");
    expect(kinds).toContain("TokenSet");
    expect(kinds).toContain("UserFlow");
    expect(kinds).toContain("reuse");
    expect(kinds).toContain("A11yProfile");
    expect(kinds).toContain("BrandGuide.Rule");
    expect(kinds).toContain("EditorialStyle");
    expect(kinds).toContain("MotionSystem");
    expect(kinds).toContain("DiscoverabilityStrategy");
  });

  it("manifest has exactly 9 entries (one per §4 kind)", () => {
    const p = condition(BASE);
    expect(p.manifest).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------
// gate_effect derivation logic
// ---------------------------------------------------------------------------

describe("gate_effect derivation", () => {
  it("gate_effect=hard for enforced+requested (AcceptanceCriterion)", () => {
    const p = condition(BASE);
    expect(findEntry(p, "AcceptanceCriterion").gate_effect).toBe("hard");
  });

  it("gate_effect=hard for TokenSet when visual>=medium (enforced+requested)", () => {
    const p = condition(
      cls({ scope: { visual: "medium", editorial: "low", coverage: "low", flow: "high" } }),
    );
    expect(findEntry(p, "TokenSet").gate_effect).toBe("hard");
  });

  it("gate_effect=hard for UserFlow when flow>=medium (enforced+requested)", () => {
    const p = condition(
      cls({ scope: { visual: "low", editorial: "low", coverage: "low", flow: "medium" } }),
    );
    expect(findEntry(p, "UserFlow").gate_effect).toBe("hard");
  });

  it("gate_effect=soft for reuse (enforced+generatable)", () => {
    const p = condition(BASE);
    expect(findEntry(p, "reuse").gate_effect).toBe("soft");
  });

  it("gate_effect=soft for non-enforced requested (A11yProfile when children)", () => {
    const p = condition(cls({ age_demographic: "children" }));
    expect(findEntry(p, "A11yProfile").gate_effect).toBe("soft");
  });

  it("gate_effect=suppressed for MotionSystem when visual=low", () => {
    const p = condition(
      cls({
        category: "ecommerce",
        scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
      }),
    );
    expect(findEntry(p, "MotionSystem").gate_effect).toBe("suppressed");
  });

  it("gate_effect=suppressed for DiscoverabilityStrategy when category=web_app", () => {
    const p = condition(cls({ category: "web_app" }));
    expect(findEntry(p, "DiscoverabilityStrategy").gate_effect).toBe("suppressed");
  });
});

// ---------------------------------------------------------------------------
// Fix 3 (Phase 8 review) — Scope→enforced-readiness coupling invariant
//
// The "visual≥medium ⇒ tokens / flow≥medium ⇒ flow" threshold is hardcoded in
// BOTH condition.ts (manifest enforced+requested) and scope.ts GATE_THRESHOLDS
// (batch readiness).  This test ensures they agree — if either table drifts this
// test fails loudly.
// ---------------------------------------------------------------------------

/**
 * Mapping from enforced manifest artifact_kind → the input name that
 * `requiredInputs(scope)` returns (reuse is optional/excluded).
 */
const KIND_TO_INPUT: Record<string, string> = {
  AcceptanceCriterion: "stories",
  TokenSet: "tokens",
  UserFlow: "flow",
  // reuse → optional; never appears in requiredInputs()
};

describe("scope→enforced-readiness coupling invariant (Fix 3)", () => {
  /**
   * For a given scope, derive the MANDATORY input set from `condition()` and
   * compare it to `requiredInputs()` from scope.ts.
   * They must agree exactly.
   */
  function mandatoryInputsFromCondition(scope: RenderScope): Set<string> {
    const classification = cls({ scope });
    const profile = condition(classification);
    const mandatory = new Set<string>();
    for (const entry of profile.manifest) {
      if (entry.requirement === "requested" && entry.enforced) {
        const input = KIND_TO_INPUT[entry.artifact_kind];
        if (input !== undefined) mandatory.add(input);
      }
    }
    return mandatory;
  }

  const REPRESENTATIVE_SCOPES: Array<{ label: string; scope: RenderScope }> = [
    {
      label: "all-low",
      scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
    },
    {
      label: "visual:medium (tokens threshold)",
      scope: { visual: "medium", editorial: "low", coverage: "low", flow: "low" },
    },
    {
      label: "flow:medium (flow threshold)",
      scope: { visual: "low", editorial: "low", coverage: "low", flow: "medium" },
    },
    {
      label: "visual:medium + flow:medium",
      scope: { visual: "medium", editorial: "low", coverage: "low", flow: "medium" },
    },
    {
      label: "all-high",
      scope: { visual: "high", editorial: "high", coverage: "high", flow: "high" },
    },
    {
      label: "visual:high only",
      scope: { visual: "high", editorial: "low", coverage: "low", flow: "low" },
    },
    {
      label: "flow:high only",
      scope: { visual: "low", editorial: "low", coverage: "low", flow: "high" },
    },
  ];

  for (const { label, scope } of REPRESENTATIVE_SCOPES) {
    it(`condition() mandatory inputs === requiredInputs() for scope [${label}]`, () => {
      // Use ecommerce (no category floors) so scope dials are passed through unmodified.
      const classification: ProjectClassification = {
        version: 1,
        category: "ecommerce",
        industry: "corporate",
        age_demographic: "26-35",
        style: "informal",
        scope,
        flow_refs: [],
      };

      const profile = condition(classification);

      // Collect mandatory inputs from condition() manifest (enforced + requested, excluding reuse).
      const fromCondition = new Set<string>();
      for (const entry of profile.manifest) {
        if (entry.requirement === "requested" && entry.enforced) {
          const input = KIND_TO_INPUT[entry.artifact_kind];
          if (input !== undefined) fromCondition.add(input);
        }
      }

      // requiredInputs() from scope.ts (single source of truth for batch readiness).
      const fromScope = new Set(requiredInputs(profile.scope));

      // They must agree exactly — "stories" is always required (coverage≥low, which is always true).
      expect(fromCondition).toEqual(fromScope);
    });
  }
});

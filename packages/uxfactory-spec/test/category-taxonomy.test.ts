/**
 * category-taxonomy.test.ts — the taxonomy doc's invariants as tests.
 */
import { describe, it, expect } from "vitest";
import {
  CATEGORY_GROUPS,
  CATEGORY_TAXONOMY,
  LEGACY_CATEGORY_ALIASES,
  normalizeCategory,
  categoryLabel,
  categoryConsequences,
} from "../src/category-taxonomy.js";

describe("category taxonomy", () => {
  it("holds exactly 34 categories across 8 groups", () => {
    expect(Object.keys(CATEGORY_TAXONOMY)).toHaveLength(34);
    expect(CATEGORY_GROUPS).toHaveLength(8);
  });

  it("every entry references a declared group and carries a one-liner", () => {
    const groupIds = new Set(CATEGORY_GROUPS.map((g) => g.id));
    for (const [id, profile] of Object.entries(CATEGORY_TAXONOMY)) {
      expect(groupIds.has(profile.group), `${id} → ${profile.group}`).toBe(true);
      expect(profile.oneLiner.length, id).toBeGreaterThan(0);
      expect(profile.label.length, id).toBeGreaterThan(0);
    }
  });

  it("every group has at least one category", () => {
    for (const group of CATEGORY_GROUPS) {
      const members = Object.values(CATEGORY_TAXONOMY).filter((p) => p.group === group.id);
      expect(members.length, group.id).toBeGreaterThan(0);
    }
  });

  it("dial defaults use only the existing six dials with valid levels", () => {
    const dialKeys = new Set(["tone", "visual", "editorial", "flows", "coverage", "coherence"]);
    const levels = new Set(["informal", "mix", "formal", "low", "medium", "high"]);
    for (const [id, profile] of Object.entries(CATEGORY_TAXONOMY)) {
      for (const [dial, level] of Object.entries(profile.dials)) {
        expect(dialKeys.has(dial), `${id}.${dial}`).toBe(true);
        expect(levels.has(level as string), `${id}.${dial}=${level}`).toBe(true);
      }
    }
  });

  it("legacy aliases resolve to taxonomy entries; normalizeCategory is identity on new ids", () => {
    for (const [legacy, id] of Object.entries(LEGACY_CATEGORY_ALIASES)) {
      expect(CATEGORY_TAXONOMY[id], `${legacy} → ${id}`).toBeDefined();
      expect(normalizeCategory(legacy)).toBe(id);
    }
    expect(normalizeCategory("dashboard-analytics")).toBe("dashboard-analytics");
  });

  it("categoryLabel is legacy-tolerant", () => {
    expect(categoryLabel("ecommerce")).toBe("Ecommerce storefront");
    expect(categoryLabel("dashboard-analytics")).toBe("Dashboard & analytics");
    expect(categoryLabel("unknown-thing")).toBe("unknown-thing");
  });

  it("consequences preview surfaces dials, activations, and posture", () => {
    expect(categoryConsequences("dashboard-analytics")).toBe(
      "Sets editorial low · activates dataviz",
    );
    expect(categoryConsequences("government-civic")).toContain("statutory compliance posture");
    // No stated defaults → falls back to the one-liner, never an empty string.
    expect(categoryConsequences("marketplace")).toBe("Multi-vendor, buyer/seller duality");
  });
});

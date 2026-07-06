/**
 * industry-taxonomy.test.ts — the industry doc's invariants as tests.
 */
import { describe, it, expect } from "vitest";
import {
  INDUSTRY_SECTORS,
  INDUSTRY_TAXONOMY,
  LEGACY_INDUSTRY_ALIASES,
  normalizeIndustry,
  industryLabel,
  industryDrivers,
} from "../src/industry-taxonomy.js";

describe("industry taxonomy", () => {
  it("holds exactly 76 industries across 13 sectors", () => {
    expect(Object.keys(INDUSTRY_TAXONOMY)).toHaveLength(76);
    expect(INDUSTRY_SECTORS).toHaveLength(13);
  });

  it("every entry references a declared sector and carries drivers", () => {
    const sectorIds = new Set(INDUSTRY_SECTORS.map((s) => s.id));
    for (const [id, profile] of Object.entries(INDUSTRY_TAXONOMY)) {
      expect(sectorIds.has(profile.sector), `${id} → ${profile.sector}`).toBe(true);
      expect(profile.drivers.length, id).toBeGreaterThan(0);
    }
  });

  it("every sector has at least one industry", () => {
    for (const sector of INDUSTRY_SECTORS) {
      const members = Object.values(INDUSTRY_TAXONOMY).filter((p) => p.sector === sector.id);
      expect(members.length, sector.id).toBeGreaterThan(0);
    }
  });

  it("regulated sectors carry the regulated flag on their members (veterinary exempt)", () => {
    for (const sector of INDUSTRY_SECTORS.filter((s) => s.regulated)) {
      for (const [id, p] of Object.entries(INDUSTRY_TAXONOMY)) {
        if (p.sector !== sector.id || id === "veterinary" || id === "religious-organizations") continue;
        expect(p.complianceFlags, id).toContain("regulated");
      }
    }
  });

  it("'corporate' is retired: absent from the taxonomy, aliased to Consulting", () => {
    expect(INDUSTRY_TAXONOMY["corporate"]).toBeUndefined();
    expect(normalizeIndustry("corporate")).toBe("consulting");
  });

  it("all legacy aliases resolve to taxonomy entries", () => {
    for (const [legacy, id] of Object.entries(LEGACY_INDUSTRY_ALIASES)) {
      expect(INDUSTRY_TAXONOMY[id], `${legacy} → ${id}`).toBeDefined();
    }
  });

  it("labels and drivers are legacy-tolerant; custom values fall back verbatim", () => {
    expect(industryLabel("finance")).toBe("Banking");
    expect(industryLabel("space-mining")).toBe("space-mining");
    expect(industryDrivers("kids-toys")).toContain("flags: age-sensitive");
  });
});

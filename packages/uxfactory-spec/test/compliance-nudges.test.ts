/**
 * compliance-nudges.test.ts — flag consumers stay advisory and truthful.
 */
import { describe, it, expect } from "vitest";
import { complianceNudges } from "../src/compliance-nudges.js";

describe("complianceNudges", () => {
  it("unremarkable configurations produce no nudges", () => {
    expect(
      complianceNudges({ category: "blog-publication", industry: "cafes-coffee", ageGroup: "18-39" }),
    ).toEqual([]);
  });

  it("the doc's worked example: under-18 × Ecommerce surfaces the COPPA-class nudge", () => {
    const nudges = complianceNudges({
      category: "ecommerce", // legacy value — normalizes to ecommerce-storefront
      industry: "grocery-cpg",
      ageGroup: "under-18",
    });
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatch(/COPPA-class/);
  });

  it("age-sensitive industry + under-18 nudges even outside commerce", () => {
    const nudges = complianceNudges({
      category: "blog-publication",
      industry: "kids-toys",
      ageGroup: "under-18",
    });
    expect(nudges.some((n) => /COPPA-class/.test(n))).toBe(true);
  });

  it("regulated and jurisdiction-sensitive flags each surface once, locale interpolated", () => {
    const nudges = complianceNudges({
      category: "dashboard-analytics",
      industry: "crypto-web3",
      ageGroup: "18-39",
      locale: "de",
    });
    expect(nudges.some((n) => /Regulated industry \(Crypto & web3\)/.test(n))).toBe(true);
    expect(nudges.some((n) => /vary by locale \(de\)/.test(n))).toBe(true);
    expect(nudges).toHaveLength(2);
  });

  it("age-gated industries expect the verification pattern", () => {
    const nudges = complianceNudges({ industry: "alcohol-beverages", ageGroup: "18-39" });
    expect(nudges.some((n) => /age-verification/.test(n))).toBe(true);
  });

  it("legacy industry aliases participate (corporate → Consulting, unflagged)", () => {
    expect(complianceNudges({ industry: "corporate", ageGroup: "40-64" })).toEqual([]);
  });
});

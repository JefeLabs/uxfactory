import { describe, it, expect } from "vitest";
import { buildDemoConfigContext } from "../ui/lib/demo-config.js";

describe("buildDemoConfigContext", () => {
  it("names category group+label+one-liner and industry sector+label+drivers+compliance", () => {
    const ctx = buildDemoConfigContext(
      { category: "productivity-collaboration", industry: "k12", locale: "en-US",
        platforms: ["desktop", "mobile"], layout: "responsive", ageGroup: "18-39",
        style: "informal", designStyle: "y2k" },
      { scope: { visual: "medium", editorial: "high", coverage: "high", flow: "high" },
        experimental: { coherence: "high" } },
    );
    expect(ctx).toContain("SaaS & tools › Productivity & collaboration");
    expect(ctx).toContain("Education › K-12");
    expect(ctx).toContain("Nostalgic & retro › Y2K Aesthetic"); // design-style group+label
    expect(ctx).toContain("en-US");
    expect(ctx).toContain("desktop, mobile");
    expect(ctx).toContain("informal");
    expect(ctx).toMatch(/coverage[^\n]*high/i);
  });

  it("omits the design-style vibe line when style is unset/exploring", () => {
    const ctx = buildDemoConfigContext(
      { category: "ecommerce-storefront", industry: "fashion-apparel", designStyle: "" },
      null,
    );
    expect(ctx).toContain("Commerce & transactions › Ecommerce storefront");
    expect(ctx).not.toMatch(/design style/i); // exploring → no style line
  });

  it("never throws and yields a generic line for an empty config", () => {
    expect(buildDemoConfigContext(null, null)).toMatch(/\S/); // non-empty
    expect(() => buildDemoConfigContext({ category: 42 as unknown as string }, {})).not.toThrow();
  });
});

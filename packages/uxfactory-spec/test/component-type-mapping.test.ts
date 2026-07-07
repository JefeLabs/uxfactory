/**
 * component-type-mapping.test.ts — the mapping is DATA with invariants.
 *
 * Source of truth: .plans/component-type-artifact-mapping.md §§1–5.
 * Consistency tests encode the doc's schema invariants so mapping edits
 * cannot silently drift; resolver tests pin the resolution order:
 * base requires → quadrant overrides → n/a dropped → planned never blocks.
 */
import { describe, it, expect } from "vitest";
import {
  ARTIFACT_REGISTRY,
  PROJECT_QUADRANTS,
  normalizeQuadrant,
  COMPONENT_TYPE_MAPPING,
  QUADRANT_MODIFIERS,
  resolveRequirements,
} from "../src/component-type-mapping.js";

const TYPE_IDS = Object.keys(COMPONENT_TYPE_MAPPING);

describe("mapping consistency invariants", () => {
  it("covers exactly the 16 composer unit types", () => {
    expect(TYPE_IDS.sort()).toEqual(
      [
        "user-flow", "home-page", "landing-page", "secondary-page", "tertiary-page", "page",
        "template", "organism", "molecule", "atom",
        "email", "instagram-post", "instagram-story", "youtube-thumbnail",
        "facebook-post", "x-post",
      ].sort(),
    );
  });

  it("every requires key and quadrant override targets a registry artifact", () => {
    for (const [typeId, entry] of Object.entries(COMPONENT_TYPE_MAPPING)) {
      for (const artifactId of Object.keys(entry.requires)) {
        expect(ARTIFACT_REGISTRY[artifactId], `${typeId} → ${artifactId}`).toBeDefined();
      }
    }
    for (const overrides of Object.values(QUADRANT_MODIFIERS)) {
      for (const artifactId of Object.keys(overrides)) {
        expect(ARTIFACT_REGISTRY[artifactId], `quadrant → ${artifactId}`).toBeDefined();
      }
    }
  });

  it("acceptance-criteria is absorbed into stories (decision 6): in NO requires block", () => {
    for (const [typeId, entry] of Object.entries(COMPONENT_TYPE_MAPPING)) {
      expect(entry.requires["acceptance-criteria"], typeId).toBeUndefined();
    }
    for (const overrides of Object.values(QUADRANT_MODIFIERS)) {
      expect(overrides["acceptance-criteria"]).toBeUndefined();
    }
  });

  it("every superseded entry names a registered successor", () => {
    for (const [id, entry] of Object.entries(ARTIFACT_REGISTRY)) {
      if (entry.status !== "superseded") continue;
      expect(entry.supersededBy, id).toBeDefined();
      expect(ARTIFACT_REGISTRY[entry.supersededBy!]?.status, `${id} → ${entry.supersededBy}`).toBe(
        "registered",
      );
    }
    expect(ARTIFACT_REGISTRY["acceptance-criteria"]).toMatchObject({
      status: "superseded",
      supersededBy: "stories",
    });
  });

  it("the resolver-consumed class never appears in a requires block", () => {
    for (const entry of Object.values(COMPONENT_TYPE_MAPPING)) {
      for (const id of ["features", "conformance-policy", "generation-config"]) {
        expect(entry.requires[id]).toBeUndefined();
      }
    }
  });

  it("registry marks exactly the 19 shipped artifacts as registered", () => {
    const registered = Object.entries(ARTIFACT_REGISTRY)
      .filter(([, e]) => e.status === "registered")
      .map(([id]) => id)
      .sort();
    expect(registered).toEqual(
      [
        "product-brief", "audience", "stories", "features", "sitemap", "flows",
        "brand-colors", "palettes", "fonts", "grid", "tokens",
        "typography", "a11y-spec", "personas", "copy-deck",
        "icons", "photography", "illustrations",
      ].sort(),
    );
  });
});

describe("resolveRequirements", () => {
  it("unknown type resolves to an empty list", () => {
    expect(resolveRequirements("dashboard")).toEqual([]);
  });

  it("drops n/a and preserves the mapping's declaration order", () => {
    const atom = resolveRequirements("atom");
    expect(atom.map((r) => r.artifactId)).toEqual([
      "brand-colors", "fonts", "typography", "tokens", "a11y-spec", "interaction-states",
    ]);
  });

  it("required + registered blocks; required + planned never blocks", () => {
    const home = resolveRequirements("home-page");
    const sitemap = home.find((r) => r.artifactId === "sitemap")!;
    expect(sitemap).toMatchObject({ level: "required", status: "registered", blocking: true });
    // copy-deck is registered now (the anti-lorem-ipsum gate) — it blocks;
    // atom's interaction-states remains the required-but-planned example.
    const copyDeck = home.find((r) => r.artifactId === "copy-deck")!;
    expect(copyDeck).toMatchObject({ level: "required", status: "registered", blocking: true });
    const states = resolveRequirements("atom").find((r) => r.artifactId === "interaction-states")!;
    expect(states).toMatchObject({ level: "required", status: "planned", blocking: false });
    const typography = home.find((r) => r.artifactId === "typography")!;
    expect(typography).toMatchObject({ level: "required", status: "registered", blocking: true });
    // stories carries the intent slot alone now — registered and blocking.
    const stories = home.find((r) => r.artifactId === "stories")!;
    expect(stories).toMatchObject({ level: "required", status: "registered", blocking: true });
  });

  it("greenfield applies no relaxation", () => {
    expect(resolveRequirements("home-page", "greenfield")).toEqual(
      resolveRequirements("home-page"),
    );
  });

  it("re-skin relaxes stories/sitemap to recommended and product-brief to optional", () => {
    const home = resolveRequirements("home-page", "re-skin");
    expect(home.find((r) => r.artifactId === "stories")).toMatchObject({
      level: "recommended",
      blocking: false,
    });
    expect(home.find((r) => r.artifactId === "sitemap")).toMatchObject({
      level: "recommended",
      blocking: false,
    });
    expect(home.find((r) => r.artifactId === "product-brief")).toMatchObject({
      level: "optional",
    });
    // Overrides only touch listed artifacts — grid stays required + blocking.
    expect(home.find((r) => r.artifactId === "grid")).toMatchObject({
      level: "required",
      blocking: true,
    });
  });

  it("quadrant overrides never add artifacts a type does not require", () => {
    // x-post requires no sitemap; re-skin's sitemap override must not create one.
    const xpost = resolveRequirements("x-post", "re-skin");
    expect(xpost.find((r) => r.artifactId === "sitemap")).toBeUndefined();
  });

  it("every resolved requirement carries a human label", () => {
    for (const r of resolveRequirements("home-page")) {
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});


describe("landing-page — the conversion-page hybrid (pages group, channel DNA)", () => {
  it("copy-deck and the design system block; stories are recommended; sitemap never appears", () => {
    const landing = resolveRequirements("landing-page");
    expect(landing.find((r) => r.artifactId === "copy-deck")).toMatchObject({
      level: "required", status: "registered", blocking: true,
    });
    expect(landing.find((r) => r.artifactId === "brand-colors")).toMatchObject({
      level: "required", blocking: true,
    });
    // One conversion story is verifiable and valuable — but never forced.
    expect(landing.find((r) => r.artifactId === "stories")).toMatchObject({
      level: "recommended", blocking: false,
    });
    // A campaign destination lives OUTSIDE the IA tree.
    expect(landing.find((r) => r.artifactId === "sitemap")).toBeUndefined();
    expect(landing.find((r) => r.artifactId === "flows")).toBeUndefined();
    // Campaign intent arrives with the creative brief — planned, never blocks.
    expect(landing.find((r) => r.artifactId === "creative-brief")).toMatchObject({
      level: "required", status: "planned", blocking: false,
    });
  });
});

describe("project quadrants", () => {
  it("covers the four quadrants with greenfield first (the default)", () => {
    expect(PROJECT_QUADRANTS.map((q) => q.id)).toEqual([
      "greenfield", "re-skin", "extend", "redesign",
    ]);
    for (const q of PROJECT_QUADRANTS) expect(q.description.length).toBeGreaterThan(0);
  });

  it("normalizeQuadrant defaults anything unknown to greenfield", () => {
    expect(normalizeQuadrant("re-skin")).toBe("re-skin");
    expect(normalizeQuadrant(undefined)).toBe("greenfield");
    expect(normalizeQuadrant("brownfield")).toBe("greenfield");
  });
});

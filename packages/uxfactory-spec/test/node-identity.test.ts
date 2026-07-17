/**
 * node-identity.test.ts — registries, defaults, and disjointness validation
 * for canonical node addresses (e.g. `home/hero@desktop@theme=students`).
 *
 * Source: .superpowers/sdd/task-1-brief.md. The viewport (breakpoint band)
 * and mode token vocabularies must never collide — an address segment like
 * `@desktop` would be ambiguous between a viewport and a mode otherwise.
 */
import { describe, it, expect } from "vitest";
import {
  defaultIdentityRegistries,
  validateIdentityRegistries,
  modeTokens,
  themeTokens,
  type IdentityRegistries,
  type PaletteCollection,
} from "../src/node-identity.js";

describe("defaultIdentityRegistries", () => {
  it("returns mobile/tablet/desktop bands, empty palette, default state list", () => {
    const defaults = defaultIdentityRegistries();
    expect(defaults).toEqual({
      version: 1,
      breakpoints: {
        bands: [
          { name: "mobile", min: 0, max: 767 },
          { name: "tablet", min: 768, max: 1279 },
          { name: "desktop", min: 1280, max: null },
        ],
      },
      palette: { collections: [] },
      states: { states: ["default", "hover", "focus", "disabled"], defaultState: "default" },
    });
  });

  it("validates clean", () => {
    const result = validateIdentityRegistries(defaultIdentityRegistries());
    expect(result.ok).toBe(true);
  });
});

describe("validateIdentityRegistries", () => {
  it("rejects non-object input", () => {
    expect(validateIdentityRegistries(null).ok).toBe(false);
    expect(validateIdentityRegistries("nope").ok).toBe(false);
    expect(validateIdentityRegistries([]).ok).toBe(false);
  });

  it("names the offending token when a mode collection collides with a viewport band", () => {
    const registries: IdentityRegistries = {
      ...defaultIdentityRegistries(),
      palette: {
        collections: [
          {
            collectionId: "coll-1",
            name: "Mode",
            axis: "mode",
            values: [
              { modeId: "m1", token: "light" },
              { modeId: "m2", token: "desktop" }, // collides with the desktop viewport band
            ],
          },
        ],
      },
    };
    const result = validateIdentityRegistries(registries);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("desktop"))).toBe(true);
  });

  it("does not flag a theme collection colliding with a viewport band (disjointness is viewport∪mode only)", () => {
    const registries: IdentityRegistries = {
      ...defaultIdentityRegistries(),
      palette: {
        collections: [
          {
            collectionId: "coll-1",
            name: "Theme",
            axis: "theme",
            values: [{ modeId: "m1", token: "desktop" }],
          },
        ],
      },
    };
    const result = validateIdentityRegistries(registries);
    expect(result.ok).toBe(true);
  });

  it("rejects overlapping breakpoint bands", () => {
    const registries: IdentityRegistries = {
      ...defaultIdentityRegistries(),
      breakpoints: {
        bands: [
          { name: "mobile", min: 0, max: 767 },
          { name: "tablet", min: 700, max: 1279 }, // overlaps mobile [0,767]
          { name: "desktop", min: 1280, max: null },
        ],
      },
    };
    const result = validateIdentityRegistries(registries);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /overlap/i.test(e))).toBe(true);
  });

  it("rejects bands not ordered ascending by min", () => {
    const registries: IdentityRegistries = {
      ...defaultIdentityRegistries(),
      breakpoints: {
        bands: [
          { name: "tablet", min: 768, max: 1279 },
          { name: "mobile", min: 0, max: 767 },
          { name: "desktop", min: 1280, max: null },
        ],
      },
    };
    const result = validateIdentityRegistries(registries);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /ascending/i.test(e))).toBe(true);
  });

  it("rejects a non-kebab breakpoint band name", () => {
    const registries: IdentityRegistries = {
      ...defaultIdentityRegistries(),
      breakpoints: { bands: [{ name: "Mobile Phone", min: 0, max: null }] },
    };
    const result = validateIdentityRegistries(registries);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("Mobile Phone"))).toBe(true);
  });

  it("rejects a non-kebab palette token", () => {
    const registries: IdentityRegistries = {
      ...defaultIdentityRegistries(),
      palette: {
        collections: [
          {
            collectionId: "coll-1",
            name: "Mode",
            axis: "mode",
            values: [{ modeId: "m1", token: "Light Mode" }],
          },
        ],
      },
    };
    const result = validateIdentityRegistries(registries);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("Light Mode"))).toBe(true);
  });

  it("rejects an empty state list", () => {
    const registries: IdentityRegistries = {
      ...defaultIdentityRegistries(),
      states: { states: [], defaultState: "default" },
    };
    const result = validateIdentityRegistries(registries);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /state/i.test(e))).toBe(true);
  });

  it("rejects a defaultState not present in states", () => {
    const registries: IdentityRegistries = {
      ...defaultIdentityRegistries(),
      states: { states: ["default", "hover"], defaultState: "focus" },
    };
    const result = validateIdentityRegistries(registries);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("focus"))).toBe(true);
  });

  it("tolerates unknown fields, matching the package's hand-rolled validator convention", () => {
    const withExtra = { ...defaultIdentityRegistries(), extraTopLevelField: "ignored" };
    const result = validateIdentityRegistries(withExtra);
    expect(result.ok).toBe(true);
  });
});

describe("modeTokens / themeTokens", () => {
  const collections: PaletteCollection[] = [
    {
      collectionId: "coll-1",
      name: "Mode",
      axis: "mode",
      values: [
        { modeId: "m1", token: "light" },
        { modeId: "m2", token: "dark" },
      ],
      defaultToken: "light",
    },
    {
      collectionId: "coll-2",
      name: "Theme",
      axis: "theme",
      values: [
        { modeId: "t1", token: "students" },
        { modeId: "t2", token: "professionals" },
      ],
    },
  ];
  const registries: IdentityRegistries = {
    ...defaultIdentityRegistries(),
    palette: { collections },
  };

  it("modeTokens returns only axis:mode collection tokens", () => {
    expect(modeTokens(registries)).toEqual(["light", "dark"]);
  });

  it("themeTokens returns only axis:theme collection tokens", () => {
    expect(themeTokens(registries)).toEqual(["students", "professionals"]);
  });

  it("returns an empty vocabulary when there are no collections on that axis", () => {
    expect(modeTokens(defaultIdentityRegistries())).toEqual([]);
    expect(themeTokens(defaultIdentityRegistries())).toEqual([]);
  });
});

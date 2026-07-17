/**
 * identity-resolve.test.ts — viewport bands, mode/theme axes, fallback
 * labels, and variant-prop coordinates.
 *
 * Source: .superpowers/sdd/task-6-brief.md and
 * .plans/2026-0717-edwin-node-identity/node-identity-input-provenance.md §4/§7.
 */
import { describe, it, expect } from "vitest";
import {
  resolveViewport,
  resolveAxesFromModes,
  deriveFallbackLabel,
  coordinatesFromVariantProps,
} from "../src/identity-resolve.js";
import { defaultIdentityRegistries, type IdentityRegistries } from "../src/node-identity.js";

// ─── fixtures ─────────────────────────────────────────────────────────────

/**
 * A gapped custom breakpoint registry — mobile [0,500], desktop [1200,∞) —
 * with a real gap (501-1199) the default contiguous registries never have.
 * This is the only way to exercise the out-of-band nearest-neighbor path.
 */
function gappedRegistries(): IdentityRegistries {
  const base = defaultIdentityRegistries();
  return {
    ...base,
    breakpoints: {
      bands: [
        { name: "mobile", min: 0, max: 500 },
        { name: "desktop", min: 1200, max: null },
      ],
    },
  };
}

/** Registries with both a mode axis (light/dark) and a theme axis (schools/students) — two independently-resolved collections, per A4. */
function withModeAndTheme(): IdentityRegistries {
  const base = defaultIdentityRegistries();
  return {
    ...base,
    palette: {
      collections: [
        {
          collectionId: "mode-coll",
          name: "Mode",
          axis: "mode",
          values: [
            { modeId: "m-light", token: "light" },
            { modeId: "m-dark", token: "dark" },
          ],
          defaultToken: "light",
        },
        {
          collectionId: "brand-coll",
          name: "Brand",
          axis: "theme",
          values: [
            { modeId: "t-schools", token: "schools" },
            { modeId: "t-students", token: "students" },
          ],
          defaultToken: "schools",
        },
      ],
    },
  };
}

// ─── resolveViewport ────────────────────────────────────────────────────────

describe("resolveViewport", () => {
  it("1440 inside the desktop band → derived, high", () => {
    const r = defaultIdentityRegistries();
    expect(resolveViewport(1440, r)).toEqual({
      token: "desktop",
      provenance: "derived",
      confidence: "high",
      reasoning: expect.stringContaining("1440"),
    });
  });

  it("900 inside the tablet band (default registries are contiguous) → derived, high", () => {
    const r = defaultIdentityRegistries();
    const result = resolveViewport(900, r);
    expect(result.token).toBe("tablet");
    expect(result.provenance).toBe("derived");
    expect(result.confidence).toBe("high");
  });

  it("gapped registry: 900 falls in the gap, nearest is desktop (dist 300) over mobile (dist 400) → derived, low", () => {
    const r = gappedRegistries();
    const result = resolveViewport(900, r);
    expect(result.token).toBe("desktop");
    expect(result.provenance).toBe("derived");
    expect(result.confidence).toBe("low");
    expect(result.reasoning).toContain("900");
    expect(result.reasoning).toContain("desktop");
  });

  it("gapped registry: 600 falls in the gap, nearest is mobile (dist 100) over desktop (dist 600) → derived, low", () => {
    const r = gappedRegistries();
    const result = resolveViewport(600, r);
    expect(result.token).toBe("mobile");
    expect(result.provenance).toBe("derived");
    expect(result.confidence).toBe("low");
  });
});

// ─── resolveAxesFromModes ───────────────────────────────────────────────────

describe("resolveAxesFromModes", () => {
  it("resolves mode and theme independently from two collections, bound (A4: never crossed)", () => {
    const r = withModeAndTheme();
    const result = resolveAxesFromModes({ "mode-coll": "m-dark", "brand-coll": "t-students" }, r);
    expect(result.mode).toEqual({ value: "dark", provenance: "derived", source: "structure", confidence: "high" });
    expect(result.theme).toEqual({ value: "students", provenance: "derived", source: "structure", confidence: "high" });
    // A4 guard: the brand token never lands in `mode`, and vice versa.
    expect(["light", "dark"]).toContain(result.mode?.value);
    expect(["schools", "students"]).toContain(result.theme?.value);
  });

  it("unbound node, collection declares a defaultToken → defaulted / registry-default", () => {
    const r = withModeAndTheme();
    const result = resolveAxesFromModes({}, r);
    expect(result.mode).toEqual({ value: "light", provenance: "defaulted", source: "registry-default" });
    expect(result.theme).toEqual({ value: "schools", provenance: "defaulted", source: "registry-default" });
  });

  it("no collections declared for an axis → that axis is absent from the result", () => {
    const r = defaultIdentityRegistries(); // no palette collections at all
    const result = resolveAxesFromModes({}, r);
    expect(result.mode).toBeUndefined();
    expect(result.theme).toBeUndefined();
    expect("mode" in result).toBe(false);
    expect("theme" in result).toBe(false);
  });

  it("mixed: mode bound, theme unbound-but-defaulted, resolved independently", () => {
    const r = withModeAndTheme();
    const result = resolveAxesFromModes({ "mode-coll": "m-dark" }, r);
    expect(result.mode).toEqual({ value: "dark", provenance: "derived", source: "structure", confidence: "high" });
    expect(result.theme).toEqual({ value: "schools", provenance: "defaulted", source: "registry-default" });
  });
});

// ─── deriveFallbackLabel ────────────────────────────────────────────────────

describe("deriveFallbackLabel", () => {
  it('"Hero Section: Desktop" → "hero-section" (strips the viewport band name)', () => {
    const r = defaultIdentityRegistries();
    const result = deriveFallbackLabel("Hero Section: Desktop", "FRAME", r);
    expect(result).toMatchObject({ label: "hero-section", provenance: "inferred", source: "prior-name" });
    expect(result.reasoning).toEqual(expect.any(String));
  });

  it('"Discover Schools features- desktop" → "discover-schools-features"', () => {
    const r = defaultIdentityRegistries();
    const result = deriveFallbackLabel("Discover Schools features- desktop", "FRAME", r);
    expect(result.label).toBe("discover-schools-features");
  });

  it('strips the noise word "version"', () => {
    const r = defaultIdentityRegistries();
    const result = deriveFallbackLabel("Hero Section Version", "FRAME", r);
    expect(result.label).toBe("hero-section");
  });

  it("strips a viewport device synonym (ipad normalizes onto the tablet band)", () => {
    const r = defaultIdentityRegistries();
    const result = deriveFallbackLabel("Header iPad", "FRAME", r);
    expect(result.label).toBe("header");
  });

  it("KEEPS a registered mode token — mode can be part of a section's real name, not stripped like viewport", () => {
    const r = withModeAndTheme();
    const result = deriveFallbackLabel("Hero Dark", "FRAME", r);
    expect(result.label).toBe("hero-dark");
  });

  it('KEEPS a registered theme token — grammar §7: "Discover Students" stays in the label AND separately carries @theme=students; the redundancy is intended', () => {
    const r = withModeAndTheme();
    const result = deriveFallbackLabel("Discover Students", "FRAME", r);
    expect(result.label).toBe("discover-students");
  });

  it('is robust to "schools" being a registered theme token — the section keyword survives regardless (only viewport tokens strip)', () => {
    const r = withModeAndTheme(); // registers "schools"/"students" as theme tokens
    const result = deriveFallbackLabel("Discover Schools features- desktop", "FRAME", r);
    expect(result.label).toBe("discover-schools-features");
  });

  it('empty after stripping → lowercased kind ("Desktop" alone, kind FRAME → "frame")', () => {
    const r = defaultIdentityRegistries();
    const result = deriveFallbackLabel("Desktop", "FRAME", r);
    expect(result.label).toBe("frame");
    expect(result.provenance).toBe("inferred");
    expect(result.source).toBe("prior-name");
  });
});

// ─── coordinatesFromVariantProps ────────────────────────────────────────────

describe("coordinatesFromVariantProps", () => {
  it("Viewport=Desktop, State=Hover → derived coordinates", () => {
    const r = defaultIdentityRegistries();
    const result = coordinatesFromVariantProps({ Viewport: "Desktop", State: "Hover" }, r);
    expect(result).toEqual({
      viewport: { value: "desktop", provenance: "derived", source: "structure", confidence: "high" },
      state: { value: "hover", provenance: "derived", source: "structure", confidence: "high" },
    });
  });

  it('"Breakpoint" is a case-insensitive synonym key for viewport, and normalizes device synonyms', () => {
    const r = defaultIdentityRegistries();
    const result = coordinatesFromVariantProps({ Breakpoint: "iPad" }, r);
    expect(result.viewport).toEqual({ value: "tablet", provenance: "derived", source: "structure", confidence: "high" });
  });

  it("ignores keys that don't map to an axis", () => {
    const r = defaultIdentityRegistries();
    const result = coordinatesFromVariantProps({ Size: "Large" }, r);
    expect(result).toEqual({});
  });

  it("ignores values that don't normalize into the axis's registry", () => {
    const r = defaultIdentityRegistries();
    const result = coordinatesFromVariantProps({ Viewport: "Watch" }, r);
    expect(result).toEqual({});
  });

  it("resolves mode/theme from variant props against a registry with those axes", () => {
    const r = withModeAndTheme();
    const result = coordinatesFromVariantProps({ Mode: "Dark", Theme: "Students" }, r);
    expect(result.mode).toEqual({ value: "dark", provenance: "derived", source: "structure", confidence: "high" });
    expect(result.theme).toEqual({ value: "students", provenance: "derived", source: "structure", confidence: "high" });
  });
});

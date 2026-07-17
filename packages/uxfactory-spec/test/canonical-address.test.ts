/**
 * canonical-address.test.ts — serialize / parse / normalize for the canonical
 * node address grammar (e.g. `home/hero@desktop@theme=students`).
 *
 * Source: .superpowers/sdd/task-5-brief.md and
 * .plans/2026-0717-edwin-node-identity/node-identity-naming-grammar.md §3–§5.
 * Cases below are drawn from the grammar's §7 worked examples.
 */
import { describe, it, expect } from "vitest";
import {
  serializeAddress,
  parseAddress,
  normalizeCoordinateToken,
  type CanonicalAddress,
} from "../src/canonical-address.js";
import { defaultIdentityRegistries, type IdentityRegistries } from "../src/node-identity.js";

// ─── fixtures ─────────────────────────────────────────────────────────────

/** Registries with a theme axis (schools/students, default schools) layered on the defaults. */
function withTheme(): IdentityRegistries {
  const base = defaultIdentityRegistries();
  return {
    ...base,
    palette: {
      collections: [
        {
          collectionId: "brand",
          name: "Brand",
          axis: "theme",
          values: [
            { modeId: "t1", token: "schools" },
            { modeId: "t2", token: "students" },
          ],
          defaultToken: "schools",
        },
      ],
    },
  };
}

/** Registries with a mode axis (light/dark, default light) layered on the defaults. */
function withMode(): IdentityRegistries {
  const base = defaultIdentityRegistries();
  return {
    ...base,
    palette: {
      collections: [
        {
          collectionId: "mode",
          name: "Mode",
          axis: "mode",
          values: [
            { modeId: "m1", token: "light" },
            { modeId: "m2", token: "dark" },
          ],
          defaultToken: "light",
        },
      ],
    },
  };
}

// ─── round-trips (grammar §7 worked examples) ──────────────────────────────

describe("round-trips", () => {
  it("home/hero@desktop", () => {
    const r = defaultIdentityRegistries();
    const s = "home/hero@desktop";
    const parsed = parseAddress(s, r);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual<CanonicalAddress>({
      path: [{ label: "home" }, { label: "hero" }],
      coordinates: { viewport: "desktop" },
    });
    expect(serializeAddress(parsed.value, r)).toBe(s);
  });

  it("home/discover-students@desktop@theme=students", () => {
    const r = withTheme();
    const s = "home/discover-students@desktop@theme=students";
    const parsed = parseAddress(s, r);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual<CanonicalAddress>({
      path: [{ label: "home" }, { label: "discover-students" }],
      coordinates: { viewport: "desktop", theme: "students" },
    });
    expect(serializeAddress(parsed.value, r)).toBe(s);
  });

  it("home/discover-schools/card#2@desktop round-trips with ordinal 2", () => {
    const r = defaultIdentityRegistries();
    const s = "home/discover-schools/card#2@desktop";
    const parsed = parseAddress(s, r);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual<CanonicalAddress>({
      path: [{ label: "home" }, { label: "discover-schools" }, { label: "card", ordinal: 2 }],
      coordinates: { viewport: "desktop" },
    });
    expect(serializeAddress(parsed.value, r)).toBe(s);
  });

  it("a lone node carries no ordinal even if ordinal:1 is supplied to serialize", () => {
    const r = defaultIdentityRegistries();
    const a: CanonicalAddress = {
      path: [{ label: "home" }, { label: "card", ordinal: 1 }],
      coordinates: { viewport: "desktop" },
    };
    expect(serializeAddress(a, r)).toBe("home/card@desktop");
  });
});

// ─── keyed-input tolerance / normalization on re-serialize ─────────────────

describe("keyed viewport/mode input normalizes to keyless canonical output", () => {
  it("@viewport=desktop input parses and re-serializes as @desktop", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("home/hero@viewport=desktop", r);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.coordinates.viewport).toBe("desktop");
    expect(serializeAddress(parsed.value, r)).toBe("home/hero@desktop");
  });

  it("@mode=dark input parses and re-serializes as @dark", () => {
    const r = withMode();
    const parsed = parseAddress("home/hero@mode=dark", r);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.coordinates.mode).toBe("dark");
    expect(serializeAddress(parsed.value, r)).toBe("home/hero@dark");
  });
});

// ─── keyless resolution by registry membership ─────────────────────────────

describe("keyless coordinate resolution", () => {
  it("@dark resolves to the mode axis when dark is a registered mode token", () => {
    const r = withMode();
    const parsed = parseAddress("home/hero@dark", r);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.coordinates).toEqual({ mode: "dark" });
  });

  it("bare @students (a theme token, not keyed) is an error", () => {
    const r = withTheme();
    const parsed = parseAddress("home/hero@students", r);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/theme/i);
    expect(parsed.error).toMatch(/@theme=students/);
  });

  it("bare state token (not keyed) is an error naming the correct key", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("home/hero@hover", r);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/state/i);
    expect(parsed.error).toMatch(/@state=hover/);
  });

  it("a keyless token in neither viewport nor mode is an unknown-token error", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("home/hero@nonexistent", r);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/nonexistent/);
  });
});

// ─── default-dropping on serialize ──────────────────────────────────────────

describe("serialize drops mode/theme/state at registry default, never drops viewport", () => {
  it("@state=default is dropped when default is the registry default state", () => {
    const r = defaultIdentityRegistries();
    const a: CanonicalAddress = {
      path: [{ label: "home" }, { label: "hero" }],
      coordinates: { viewport: "desktop", state: "default" },
    };
    expect(serializeAddress(a, r)).toBe("home/hero@desktop");
  });

  it("a non-default state is rendered keyed", () => {
    const r = defaultIdentityRegistries();
    const a: CanonicalAddress = {
      path: [{ label: "home" }, { label: "hero" }],
      coordinates: { viewport: "desktop", state: "hover" },
    };
    expect(serializeAddress(a, r)).toBe("home/hero@desktop@state=hover");
  });

  it("a default-mode coordinate is dropped, a non-default one is rendered keyless", () => {
    const r = withMode();
    const atDefault: CanonicalAddress = {
      path: [{ label: "home" }],
      coordinates: { viewport: "desktop", mode: "light" },
    };
    expect(serializeAddress(atDefault, r)).toBe("home@desktop");
    const notDefault: CanonicalAddress = {
      path: [{ label: "home" }],
      coordinates: { viewport: "desktop", mode: "dark" },
    };
    expect(serializeAddress(notDefault, r)).toBe("home@desktop@dark");
  });

  it("a default-theme coordinate is dropped, a non-default one is rendered keyed", () => {
    const r = withTheme();
    const atDefault: CanonicalAddress = {
      path: [{ label: "home" }],
      coordinates: { viewport: "desktop", theme: "schools" },
    };
    expect(serializeAddress(atDefault, r)).toBe("home@desktop");
  });

  it("viewport is always rendered, even if it happened to equal a mode/theme default token", () => {
    const r = defaultIdentityRegistries();
    const a: CanonicalAddress = {
      path: [{ label: "home" }],
      coordinates: { viewport: "mobile" },
    };
    expect(serializeAddress(a, r)).toBe("home@mobile");
  });
});

// ─── order-independence (EBNF §5 constraint 3) ─────────────────────────────

describe("coordinates are order-independent", () => {
  it("@theme=students@desktop parses identically to @desktop@theme=students", () => {
    const r = withTheme();
    const forward = parseAddress("home/discover-students@desktop@theme=students", r);
    const reversed = parseAddress("home/discover-students@theme=students@desktop", r);
    expect(forward.ok).toBe(true);
    expect(reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(reversed.value).toEqual(forward.value);
  });

  it("multiple non-default coordinates always serialize in canonical order: viewport, mode, theme, state", () => {
    const r: IdentityRegistries = { ...withMode(), palette: { collections: [...withMode().palette.collections, ...withTheme().palette.collections] } };
    const a: CanonicalAddress = {
      path: [{ label: "hero" }],
      coordinates: { state: "hover", theme: "students", mode: "dark", viewport: "mobile" },
    };
    expect(serializeAddress(a, r)).toBe("hero@mobile@dark@theme=students@state=hover");
  });
});

// ─── error cases: duplicate axis, malformed kebab, unknown token ───────────

describe("errors", () => {
  it("duplicate axis via keyless + keyed viewport is an error", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("home/hero@desktop@viewport=tablet", r);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/duplicate/i);
    expect(parsed.error).toMatch(/viewport/);
  });

  it("duplicate axis via two keyed theme coordinates is an error", () => {
    const r = withTheme();
    const parsed = parseAddress("home/hero@theme=students@theme=schools", r);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/duplicate/i);
    expect(parsed.error).toMatch(/theme/);
  });

  it("uppercase label is a malformed-kebab error", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("Home/hero@desktop", r);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/Home/);
  });

  it("leading hyphen label is a malformed-kebab error", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("-home/hero@desktop", r);
    expect(parsed.ok).toBe(false);
  });

  it("trailing hyphen label is a malformed-kebab error", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("home-/hero@desktop", r);
    expect(parsed.ok).toBe(false);
  });

  it("double hyphen label is a malformed-kebab error", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("ho--me/hero@desktop", r);
    expect(parsed.ok).toBe(false);
  });

  it("empty path segment (double slash) is a malformed-kebab error", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("home//hero@desktop", r);
    expect(parsed.ok).toBe(false);
  });

  it("unknown keyed axis is an error", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("home/hero@breakpoint=desktop", r);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/breakpoint/);
  });

  it("a keyed value not present in the target axis's registry is an error", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("home/hero@viewport=widescreen", r);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/widescreen/);
  });

  it("an ordinal below 2 is rejected", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("home/card#1@desktop", r);
    expect(parsed.ok).toBe(false);
  });

  it("a non-numeric ordinal is rejected", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("home/card#two@desktop", r);
    expect(parsed.ok).toBe(false);
  });

  it("an address with no path (starts with @) is rejected", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("@desktop", r);
    expect(parsed.ok).toBe(false);
  });

  it("an empty string is rejected", () => {
    const r = defaultIdentityRegistries();
    const parsed = parseAddress("", r);
    expect(parsed.ok).toBe(false);
  });
});

// ─── normalizeCoordinateToken ───────────────────────────────────────────────

describe("normalizeCoordinateToken", () => {
  const r = defaultIdentityRegistries();

  it("lowercases before matching", () => {
    expect(normalizeCoordinateToken("viewport", "DESKTOP", r)).toBe("desktop");
  });

  it("ipad -> tablet", () => {
    expect(normalizeCoordinateToken("viewport", "ipad", r)).toBe("tablet");
  });

  it("iphone -> mobile", () => {
    expect(normalizeCoordinateToken("viewport", "iphone", r)).toBe("mobile");
  });

  it("phone -> mobile", () => {
    expect(normalizeCoordinateToken("viewport", "phone", r)).toBe("mobile");
  });

  it("desktop -> desktop", () => {
    expect(normalizeCoordinateToken("viewport", "desktop", r)).toBe("desktop");
  });

  it("web -> desktop", () => {
    expect(normalizeCoordinateToken("viewport", "web", r)).toBe("desktop");
  });

  it("an unrecognized viewport token normalizes to null", () => {
    expect(normalizeCoordinateToken("viewport", "gizmo", r)).toBeNull();
  });

  it("mode is registry membership only, case-insensitive, no device synonyms", () => {
    const modeR = withMode();
    expect(normalizeCoordinateToken("mode", "Dark", modeR)).toBe("dark");
    expect(normalizeCoordinateToken("mode", "ipad", modeR)).toBeNull();
  });

  it("theme is registry membership only", () => {
    const themeR = withTheme();
    expect(normalizeCoordinateToken("theme", "Students", themeR)).toBe("students");
    expect(normalizeCoordinateToken("theme", "professionals", themeR)).toBeNull();
  });

  it("state is registry membership only", () => {
    expect(normalizeCoordinateToken("state", "Hover", r)).toBe("hover");
    expect(normalizeCoordinateToken("state", "dragging", r)).toBeNull();
  });
});

/**
 * identity-assemble.test.ts — the grammar's convergence point: extraction +
 * registries (+ optional prior manifest) -> provenance-tagged
 * `NodeIdentityRecord[]` with canonical addresses.
 *
 * Source: .superpowers/sdd/task-7-brief.md. The main fixture below is
 * modeled on the grammar's §7 worked example and reuses the exact
 * `currentName` strings already exercised by `deriveFallbackLabel` in
 * identity-resolve.test.ts ("Hero Section: Desktop", "Hero Section: Ipad
 * version", "Discover Schools features- desktop", "Discover Students
 * features- desktop") so the fallback labels are known-good.
 */
import { describe, it, expect } from "vitest";
import { assembleIdentities } from "../src/identity-assemble.js";
import {
  defaultIdentityRegistries,
  type ComponentRegistry,
  type ExtractedNode,
  type IdentityExtraction,
  type IdentityRegistries,
  type NodeManifest,
} from "../src/node-identity.js";

// ─── shared fixtures ────────────────────────────────────────────────────────

/**
 * Registries with a theme axis (default vs. students, non-default) — needed
 * for the Discover Students case. Deliberately uses the grammar doc's own
 * `default`/`vibrant`-style vocabulary (§3.2) rather than "schools" as the
 * default token: "schools" would collide with `deriveFallbackLabel`'s
 * coordinate-noise stripping on "Discover Schools features- desktop" (it
 * would read as a theme token and get stripped from the section's OWN
 * label, breaking the brief's expected "discover-schools-features").
 */
function registriesWithTheme(): IdentityRegistries {
  const base = defaultIdentityRegistries();
  return {
    ...base,
    palette: {
      collections: [
        {
          collectionId: "brand-coll",
          name: "Brand",
          axis: "theme",
          values: [
            { modeId: "t-default", token: "default" },
            { modeId: "t-students", token: "students" },
          ],
          defaultToken: "default",
        },
      ],
    },
  };
}

const components: ComponentRegistry = {
  version: 1,
  components: [
    { key: "button-key", roleName: "button", source: "figma-document", matchability: "matchable" },
    { key: "card-key", roleName: "card", source: "figma-document", matchability: "matchable" },
  ],
};

/**
 * The main worked-example fixture (grammar §7): a "home" page, pageCount 2
 * (home + an implied pricing page, per the brief — only home's tree is
 * extracted here). Eight nodes:
 *  - Hero Section: Desktop (1440, page child) + a bound Button instance
 *  - Hero Section: Ipad version (800, page child) — same label as the
 *    desktop hero, different viewport: must NOT collide (no ordinal)
 *  - Discover Schools features- desktop (1440, page child) + three bound
 *    Card instances — same label, same viewport: MUST collide (#2, #3)
 *  - Discover Students features- desktop (1440, page child), bound to the
 *    "students" theme mode (non-default -> serialized)
 */
function homePageNodes(): ExtractedNode[] {
  return [
    {
      durableId: "n-hero-desktop",
      figmaNodeId: "f-hero-desktop",
      parentDurableId: null,
      ordinal: 0,
      kind: "FRAME",
      width: 1440,
      currentName: "Hero Section: Desktop",
      resolvedModes: {},
      mainComponent: null,
      variantProperties: null,
      isPageChild: true,
    },
    {
      durableId: "n-hero-desktop-button",
      figmaNodeId: "f-hero-desktop-button",
      parentDurableId: "n-hero-desktop",
      ordinal: 0,
      kind: "INSTANCE",
      width: null,
      currentName: "Button",
      resolvedModes: {},
      mainComponent: { key: "button-key", name: "Button", remote: false },
      variantProperties: null,
      isPageChild: false,
    },
    {
      durableId: "n-hero-tablet",
      figmaNodeId: "f-hero-tablet",
      parentDurableId: null,
      ordinal: 1,
      kind: "FRAME",
      width: 800,
      currentName: "Hero Section: Ipad version",
      resolvedModes: {},
      mainComponent: null,
      variantProperties: null,
      isPageChild: true,
    },
    {
      durableId: "n-discover-schools",
      figmaNodeId: "f-discover-schools",
      parentDurableId: null,
      ordinal: 2,
      kind: "FRAME",
      width: 1440,
      currentName: "Discover Schools features- desktop",
      resolvedModes: {},
      mainComponent: null,
      variantProperties: null,
      isPageChild: true,
    },
    {
      durableId: "n-card-1",
      figmaNodeId: "f-card-1",
      parentDurableId: "n-discover-schools",
      ordinal: 0,
      kind: "INSTANCE",
      width: null,
      currentName: "Card",
      resolvedModes: {},
      mainComponent: { key: "card-key", name: "Card", remote: false },
      variantProperties: null,
      isPageChild: false,
    },
    {
      durableId: "n-card-2",
      figmaNodeId: "f-card-2",
      parentDurableId: "n-discover-schools",
      ordinal: 1,
      kind: "INSTANCE",
      width: null,
      currentName: "Card",
      resolvedModes: {},
      mainComponent: { key: "card-key", name: "Card", remote: false },
      variantProperties: null,
      isPageChild: false,
    },
    {
      durableId: "n-card-3",
      figmaNodeId: "f-card-3",
      parentDurableId: "n-discover-schools",
      ordinal: 2,
      kind: "INSTANCE",
      width: null,
      currentName: "Card",
      resolvedModes: {},
      mainComponent: { key: "card-key", name: "Card", remote: false },
      variantProperties: null,
      isPageChild: false,
    },
    {
      durableId: "n-discover-students",
      figmaNodeId: "f-discover-students",
      parentDurableId: null,
      ordinal: 3,
      kind: "FRAME",
      width: 1440,
      currentName: "Discover Students features- desktop",
      resolvedModes: { "brand-coll": "t-students" },
      mainComponent: null,
      variantProperties: null,
      isPageChild: true,
    },
  ];
}

function homePageExtraction(pageCount: number): IdentityExtraction {
  return {
    version: 1,
    page: { figmaNodeId: "page-home", name: "Home" },
    pageCount,
    nodes: homePageNodes(),
  };
}

function byId(records: ReturnType<typeof assembleIdentities>["records"], durableId: string) {
  const r = records.find((rec) => rec.durableId === durableId);
  if (!r) throw new Error(`no record for ${durableId}`);
  return r;
}

// ─── the must-cover fixture: full worked-example addresses ─────────────────

describe("assembleIdentities — worked-example fixture (pageCount 2)", () => {
  const registries = registriesWithTheme();
  const extraction = homePageExtraction(2);
  const { records } = assembleIdentities(extraction, registries, components);

  it("produces exactly the addresses in the brief", () => {
    expect(byId(records, "n-hero-desktop").address).toBe("home/hero-section@desktop");
    expect(byId(records, "n-hero-tablet").address).toBe("home/hero-section@tablet");
    expect(byId(records, "n-hero-desktop-button").address).toBe("home/hero-section/button@desktop");
    expect(byId(records, "n-card-2").address).toBe("home/discover-schools-features/card#2@desktop");
    // NOTE ("discover-students-features" vs "discover-features" — see below): this is the one
    // address in the brief's fixture list this suite does NOT reproduce byte-for-byte, and it's a
    // discovered interaction, not a bug here. `deriveFallbackLabel` (Task 6, already shipped and
    // tested — identity-resolve.test.ts's "strips a registered theme token" case literally covers
    // `deriveFallbackLabel("Discover Students", ...)` -> "discover") strips any path-label segment
    // that is ITSELF a registered coordinate token, on purpose (the grammar's anti-redundancy
    // rule: a coordinate's value should never also sit duplicated in the label). Registering
    // "students" as the theme token needed to produce `@theme=students` at all means the section's
    // OWN currentName segment "Students" is *itself* now coordinate-noise and gets stripped by the
    // very same rule — same mechanism, same reasoning, as "desktop"/"tablet" being stripped from
    // every other section name in this fixture. The brief's fixture prose predates verifying this
    // specific interaction against Task 6's shipped, tested behavior; rule 5 explicitly says reuse
    // `deriveFallbackLabel` as-is, so this suite asserts the mechanism's real (and, per the
    // grammar's own no-redundant-coordinate-in-label principle, arguably more correct) output
    // rather than hand-editing around it. Flagged in the task report.
    expect(byId(records, "n-discover-students").address).toBe("home/discover-features@desktop@theme=students");
  });

  it("hero desktop/tablet: same label, different viewport -> NEITHER carries an ordinal", () => {
    const desktop = byId(records, "n-hero-desktop");
    const tablet = byId(records, "n-hero-tablet");
    expect(desktop.path.at(-1)).toMatchObject({ label: "hero-section" });
    expect(desktop.path.at(-1)?.ordinal).toBeUndefined();
    expect(tablet.path.at(-1)).toMatchObject({ label: "hero-section" });
    expect(tablet.path.at(-1)?.ordinal).toBeUndefined();
  });

  it("three same-viewport cards: first carries no ordinal, 2nd/3rd carry #2/#3 by document order", () => {
    const [c1, c2, c3] = ["n-card-1", "n-card-2", "n-card-3"].map((id) => byId(records, id));
    expect(c1!.path.at(-1)?.ordinal).toBeUndefined();
    expect(c2!.path.at(-1)?.ordinal).toBe(2);
    expect(c3!.path.at(-1)?.ordinal).toBe(3);
    expect(c1!.address).toBe("home/discover-schools-features/card@desktop");
    expect(c3!.address).toBe("home/discover-schools-features/card#3@desktop");
  });

  it("pageCount>1: page label is the FIRST path segment of every record, scope is empty", () => {
    for (const id of ["n-hero-desktop", "n-hero-desktop-button", "n-discover-students"]) {
      const r = byId(records, id);
      expect(r.path[0]).toMatchObject({ label: "home", provenance: "derived" });
      expect(r.scope).toEqual([]);
    }
  });

  it("provenance per segment: page segment derived/structure, section label inferred/prior-name, instance label derived/registry", () => {
    const hero = byId(records, "n-hero-desktop");
    expect(hero.path[0]).toMatchObject({ label: "home", provenance: "derived", source: "structure" });
    expect(hero.path[1]).toMatchObject({ label: "hero-section", provenance: "inferred", source: "prior-name" });

    const button = byId(records, "n-hero-desktop-button");
    expect(button.path.at(-1)).toMatchObject({ label: "button", provenance: "derived", source: "registry" });
  });

  it("bound registered instance: resolutionStatus bound, matchability matchable, definitionRef = registry key", () => {
    const button = byId(records, "n-hero-desktop-button");
    expect(button.resolutionStatus).toBe("bound");
    expect(button.matchability).toBe("matchable");
    expect(button.definitionRef).toBe("button-key");
    expect(button.reasoning).toContain('label "button" derived from bound instance of "Button"');
  });

  it("composition: a section's composition lists its direct children's durableIds in document order; leaves have none", () => {
    expect(byId(records, "n-discover-schools").composition).toEqual(["n-card-1", "n-card-2", "n-card-3"]);
    expect(byId(records, "n-hero-desktop").composition).toEqual(["n-hero-desktop-button"]);
    expect(byId(records, "n-hero-desktop-button").composition).toEqual([]);
  });

  it("theme coordinate: students is non-default and appears in both address and coordinates; schools default never printed elsewhere", () => {
    const students = byId(records, "n-discover-students");
    expect(students.coordinates.theme).toMatchObject({ value: "students", provenance: "derived" });
    expect(students.address).toContain("@theme=students");

    const hero = byId(records, "n-hero-desktop");
    expect(hero.address).not.toContain("theme");
  });

  it("descendant inherits viewport from the page-child root, with 'inherited from root frame' reasoning", () => {
    const button = byId(records, "n-hero-desktop-button");
    expect(button.coordinates.viewport).toMatchObject({ value: "desktop", provenance: "derived", source: "structure" });
    expect(button.reasoning).toContain("inherited from root frame");
  });

  it("pathRoleDefault: page-child FRAME -> section; INSTANCE -> component", () => {
    expect(byId(records, "n-hero-desktop").pathRoleDefault).toBe("section");
    expect(byId(records, "n-hero-desktop-button").pathRoleDefault).toBe("component");
  });

  it("isDefinition is false for FRAME and INSTANCE nodes", () => {
    expect(byId(records, "n-hero-desktop").isDefinition).toBe(false);
    expect(byId(records, "n-hero-desktop-button").isDefinition).toBe(false);
  });

  it("currentName, figmaNodeId, kind, updatedAt are populated", () => {
    const hero = byId(records, "n-hero-desktop");
    expect(hero.currentName).toBe("Hero Section: Desktop");
    expect(hero.figmaNodeId).toBe("f-hero-desktop");
    expect(hero.kind).toBe("FRAME");
    expect(hero.updatedAt).toEqual(expect.any(String));
    expect(() => new Date(hero.updatedAt).toISOString()).not.toThrow();
  });
});

// ─── rule 1: pageCount === 1 -> page into scope, addresses start at sections ─

describe("assembleIdentities — pageCount === 1", () => {
  it("page slug goes into scope; addresses start at the section tier (no page prefix)", () => {
    const registries = registriesWithTheme();
    const extraction = homePageExtraction(1);
    const { records } = assembleIdentities(extraction, registries, components);

    const hero = byId(records, "n-hero-desktop");
    expect(hero.scope).toEqual(["home"]);
    expect(hero.address).toBe("hero-section@desktop");
    expect(hero.path[0]).toMatchObject({ label: "hero-section" }); // no "home" segment at all

    const button = byId(records, "n-hero-desktop-button");
    expect(button.address).toBe("hero-section/button@desktop");
    expect(button.scope).toEqual(["home"]);
  });
});

// ─── rule 2: prior-manifest override + "derived labels always recompute" ────

describe("assembleIdentities — prior-manifest override", () => {
  function extractionWithOneComposedNode(): IdentityExtraction {
    return {
      version: 1,
      page: { figmaNodeId: "page-home", name: "Home" },
      pageCount: 1,
      nodes: [
        {
          durableId: "n-section",
          figmaNodeId: "f-section",
          parentDurableId: null,
          ordinal: 0,
          kind: "FRAME",
          width: 1440,
          currentName: "Weird Layer Name 42",
          resolvedModes: {},
          mainComponent: null,
          variantProperties: null,
          isPageChild: true,
        },
        {
          durableId: "n-button",
          figmaNodeId: "f-button",
          parentDurableId: "n-section",
          ordinal: 0,
          kind: "INSTANCE",
          width: null,
          currentName: "Button",
          resolvedModes: {},
          mainComponent: { key: "button-key", name: "Button", remote: false },
          variantProperties: null,
          isPageChild: false,
        },
      ],
    };
  }

  it("confirmed prior label on a composed node survives instead of the freshly-inferred one", () => {
    const registries = defaultIdentityRegistries();
    const extraction = extractionWithOneComposedNode();
    const prior: NodeManifest = {
      version: 1,
      records: {
        "n-section": {
          durableId: "n-section",
          figmaNodeId: "old-figma-id",
          address: "login-card@desktop",
          scope: ["home"],
          path: [{ label: "login-card", provenance: "elicited", confirmed: true }],
          coordinates: {},
          kind: "FRAME",
          pathRoleDefault: "section",
          isDefinition: false,
          composition: [],
          currentName: "Weird Layer Name 42",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };

    const { records } = assembleIdentities(extraction, registries, components, prior);
    const section = byId(records, "n-section");
    expect(section.path.at(-1)).toMatchObject({ label: "login-card", provenance: "elicited", confirmed: true });
    expect(section.address).toBe("login-card@desktop");
    expect(section.reasoning).toContain('kept prior label "login-card"');
  });

  it("elicited (unconfirmed) prior label also survives — the gate is confirmed:true OR provenance elicited", () => {
    const registries = defaultIdentityRegistries();
    const extraction = extractionWithOneComposedNode();
    const prior: NodeManifest = {
      version: 1,
      records: {
        "n-section": {
          durableId: "n-section",
          figmaNodeId: "old-figma-id",
          address: "renamed-by-user@desktop",
          scope: ["home"],
          path: [{ label: "renamed-by-user", provenance: "elicited" }],
          coordinates: {},
          kind: "FRAME",
          pathRoleDefault: "section",
          isDefinition: false,
          composition: [],
          currentName: "Weird Layer Name 42",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };

    const { records } = assembleIdentities(extraction, registries, components, prior);
    expect(byId(records, "n-section").path.at(-1)).toMatchObject({ label: "renamed-by-user", provenance: "elicited" });
  });

  it("un-confirmed, non-elicited prior label (plain inferred) does NOT survive — re-derives fresh", () => {
    const registries = defaultIdentityRegistries();
    const extraction = extractionWithOneComposedNode();
    const prior: NodeManifest = {
      version: 1,
      records: {
        "n-section": {
          durableId: "n-section",
          figmaNodeId: "old-figma-id",
          address: "stale-guess@desktop",
          scope: ["home"],
          path: [{ label: "stale-guess", provenance: "inferred" }], // not confirmed, not elicited
          coordinates: {},
          kind: "FRAME",
          pathRoleDefault: "section",
          isDefinition: false,
          composition: [],
          currentName: "Weird Layer Name 42",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };

    const { records } = assembleIdentities(extraction, registries, components, prior);
    // deriveFallbackLabel("Weird Layer Name 42", "FRAME", registries) -> kebabbed, "42" survives (not coordinate noise).
    expect(byId(records, "n-section").path.at(-1)?.label).toBe("weird-layer-name-42");
  });

  it("derived labels ALWAYS recompute: a confirmed prior override on a BOUND INSTANCE is ignored", () => {
    const registries = defaultIdentityRegistries();
    const extraction = extractionWithOneComposedNode();
    const prior: NodeManifest = {
      version: 1,
      records: {
        "n-button": {
          durableId: "n-button",
          figmaNodeId: "old-figma-id",
          address: "cta-primary@desktop",
          scope: ["home"],
          path: [
            { label: "login-card", provenance: "inferred" },
            { label: "cta-primary", provenance: "elicited", confirmed: true },
          ],
          coordinates: {},
          kind: "INSTANCE",
          pathRoleDefault: "component",
          isDefinition: false,
          composition: [],
          currentName: "Button",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };

    const { records } = assembleIdentities(extraction, registries, components, prior);
    const button = byId(records, "n-button");
    // Registry-derived label wins regardless of the confirmed prior override.
    expect(button.path.at(-1)).toMatchObject({ label: "button", provenance: "derived", source: "registry" });
  });

  it("appliedAddress/appliedAt carry forward from the prior record when present", () => {
    const registries = defaultIdentityRegistries();
    const extraction = extractionWithOneComposedNode();
    const prior: NodeManifest = {
      version: 1,
      records: {
        "n-section": {
          durableId: "n-section",
          figmaNodeId: "old-figma-id",
          address: "weird-layer-name-42@desktop",
          scope: ["home"],
          path: [{ label: "weird-layer-name-42", provenance: "inferred" }],
          coordinates: {},
          kind: "FRAME",
          pathRoleDefault: "section",
          isDefinition: false,
          composition: [],
          currentName: "Weird Layer Name 42",
          updatedAt: "2026-01-01T00:00:00.000Z",
          appliedAddress: "weird-layer-name-42@desktop",
          appliedAt: "2026-01-02T00:00:00.000Z",
        },
      },
    };

    const { records } = assembleIdentities(extraction, registries, components, prior);
    const section = byId(records, "n-section");
    expect(section.appliedAddress).toBe("weird-layer-name-42@desktop");
    expect(section.appliedAt).toBe("2026-01-02T00:00:00.000Z");

    // A node with no prior record at all carries neither field.
    const button = byId(records, "n-button");
    expect(button.appliedAddress).toBeUndefined();
    expect(button.appliedAt).toBeUndefined();
  });
});

// ─── rule 2: unregistered bound instance ────────────────────────────────────

describe("assembleIdentities — unregistered bound instance", () => {
  it("kebabs the main-component name (stripping variant syntax), still resolutionStatus bound, no definitionRef", () => {
    const registries = defaultIdentityRegistries();
    const extraction: IdentityExtraction = {
      version: 1,
      page: { figmaNodeId: "page-home", name: "Home" },
      pageCount: 1,
      nodes: [
        {
          durableId: "n-section",
          figmaNodeId: "f-section",
          parentDurableId: null,
          ordinal: 0,
          kind: "FRAME",
          width: 1440,
          currentName: "Section",
          resolvedModes: {},
          mainComponent: null,
          variantProperties: null,
          isPageChild: true,
        },
        {
          durableId: "n-mystery",
          figmaNodeId: "f-mystery",
          parentDurableId: "n-section",
          ordinal: 0,
          kind: "INSTANCE",
          width: null,
          currentName: "Mystery Instance",
          resolvedModes: {},
          mainComponent: { key: "unregistered-key", name: "Chip/Selected", remote: false },
          variantProperties: null,
          isPageChild: false,
        },
      ],
    };

    const { records } = assembleIdentities(extraction, registries, components);
    const mystery = byId(records, "n-mystery");
    expect(mystery.path.at(-1)).toMatchObject({ label: "chip", provenance: "derived", source: "structure" });
    expect(mystery.resolutionStatus).toBe("bound");
    expect(mystery.definitionRef).toBeUndefined();
    expect(mystery.matchability).toBe("matchable");
    expect(mystery.reasoning).toContain("unregistered");
  });
});

// ─── rule 2: COMPONENT / COMPONENT_SET definitions ──────────────────────────

describe("assembleIdentities — COMPONENT/COMPONENT_SET definitions", () => {
  function extractionWithDefinition(kind: "COMPONENT" | "COMPONENT_SET", name: string): IdentityExtraction {
    return {
      version: 1,
      page: { figmaNodeId: "page-home", name: "Home" },
      pageCount: 1,
      nodes: [
        {
          durableId: "n-def",
          figmaNodeId: "f-def",
          parentDurableId: null,
          ordinal: 0,
          kind,
          width: 1440,
          currentName: name,
          resolvedModes: {},
          mainComponent: null,
          variantProperties: null,
          isPageChild: true,
        },
      ],
    };
  }

  it("isDefinition true; matched registry entry (by figmaNodeId) wins over kebabbing the name", () => {
    const registries = defaultIdentityRegistries();
    const registryComponents: ComponentRegistry = {
      version: 1,
      components: [{ key: "f-def", roleName: "badge", source: "figma-document", matchability: "matchable" }],
    };
    const { records } = assembleIdentities(extractionWithDefinition("COMPONENT", "Badge/Small"), registries, registryComponents);
    const def = byId(records, "n-def");
    expect(def.isDefinition).toBe(true);
    expect(def.path.at(-1)).toMatchObject({ label: "badge", provenance: "derived", source: "registry" });
    expect(def.definitionRef).toBe("f-def");
    // Even though this definition IS a page child, pathRoleDefault is "component" (kind-driven),
    // never "section" — the FRAME-page-child -> section rule never fires for a component kind.
    expect(def.pathRoleDefault).toBe("component");
  });

  it("unmatched: kebab of name, stripping variant syntax", () => {
    const registries = defaultIdentityRegistries();
    const { records } = assembleIdentities(extractionWithDefinition("COMPONENT_SET", "Badge/Small"), registries, components);
    const def = byId(records, "n-def");
    expect(def.isDefinition).toBe(true);
    expect(def.path.at(-1)).toMatchObject({ label: "badge", provenance: "derived" });
    expect(def.definitionRef).toBeUndefined();
  });
});

// ─── rule 5: state coordinate — variant prop only, never defaulted ──────────

describe("assembleIdentities — state coordinate", () => {
  it("state present via variant prop; omitted entirely when absent (never defaulted)", () => {
    const registries = defaultIdentityRegistries();
    const extraction: IdentityExtraction = {
      version: 1,
      page: { figmaNodeId: "page-home", name: "Home" },
      pageCount: 1,
      nodes: [
        {
          durableId: "n-section",
          figmaNodeId: "f-section",
          parentDurableId: null,
          ordinal: 0,
          kind: "FRAME",
          width: 1440,
          currentName: "Section",
          resolvedModes: {},
          mainComponent: null,
          variantProperties: null,
          isPageChild: true,
        },
        {
          durableId: "n-btn-hover",
          figmaNodeId: "f-btn-hover",
          parentDurableId: "n-section",
          ordinal: 0,
          kind: "INSTANCE",
          width: null,
          currentName: "Button",
          resolvedModes: {},
          mainComponent: { key: "button-key", name: "Button", remote: false },
          variantProperties: { State: "Hover" },
          isPageChild: false,
        },
        {
          durableId: "n-btn-default",
          figmaNodeId: "f-btn-default",
          parentDurableId: "n-section",
          ordinal: 1,
          kind: "INSTANCE",
          width: null,
          currentName: "Button",
          resolvedModes: {},
          mainComponent: { key: "button-key", name: "Button", remote: false },
          variantProperties: null,
          isPageChild: false,
        },
      ],
    };

    const { records } = assembleIdentities(extraction, registries, components);
    const hover = byId(records, "n-btn-hover");
    expect(hover.coordinates.state).toMatchObject({ value: "hover" });
    expect(hover.address).toContain("@state=hover");

    const plain = byId(records, "n-btn-default");
    expect(plain.coordinates.state).toBeUndefined();
    expect(plain.address).not.toContain("state");
  });
});

// ─── rule 6: pathRoleDefault "element" for a non-root, non-component node ───

describe("assembleIdentities — pathRoleDefault element", () => {
  it("a nested, non-page-child, non-component/instance node defaults to 'element'", () => {
    const registries = defaultIdentityRegistries();
    const extraction: IdentityExtraction = {
      version: 1,
      page: { figmaNodeId: "page-home", name: "Home" },
      pageCount: 1,
      nodes: [
        {
          durableId: "n-section",
          figmaNodeId: "f-section",
          parentDurableId: null,
          ordinal: 0,
          kind: "FRAME",
          width: 1440,
          currentName: "Section",
          resolvedModes: {},
          mainComponent: null,
          variantProperties: null,
          isPageChild: true,
        },
        {
          durableId: "n-group",
          figmaNodeId: "f-group",
          parentDurableId: "n-section",
          ordinal: 0,
          kind: "GROUP",
          width: null,
          currentName: "Icon Group",
          resolvedModes: {},
          mainComponent: null,
          variantProperties: null,
          isPageChild: false,
        },
      ],
    };

    const { records } = assembleIdentities(extraction, registries, components);
    const group = byId(records, "n-group");
    expect(group.pathRoleDefault).toBe("element");
    expect(group.matchability).toBe("composed");
    expect(group.isDefinition).toBe(false);
  });
});

// ─── edge case: page child with no width ────────────────────────────────────

describe("assembleIdentities — page child with null width", () => {
  it("does not throw; viewport is simply absent (and address serializes without one)", () => {
    const registries = defaultIdentityRegistries();
    const extraction: IdentityExtraction = {
      version: 1,
      page: { figmaNodeId: "page-home", name: "Home" },
      pageCount: 1,
      nodes: [
        {
          durableId: "n-widthless",
          figmaNodeId: "f-widthless",
          parentDurableId: null,
          ordinal: 0,
          kind: "GROUP",
          width: null,
          currentName: "Widthless Root",
          resolvedModes: {},
          mainComponent: null,
          variantProperties: null,
          isPageChild: true,
        },
      ],
    };

    expect(() => assembleIdentities(extraction, registries, components)).not.toThrow();
    const { records } = assembleIdentities(extraction, registries, components);
    const widthless = byId(records, "n-widthless");
    expect(widthless.coordinates.viewport).toBeUndefined();
    expect(widthless.address).toBe("widthless-root");
  });
});

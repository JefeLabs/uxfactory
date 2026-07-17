import { describe, it, expect } from "vitest";
import {
  ensureDurableId,
  extractIdentityTree,
  harvestComponents,
  type IdentitySourceNode,
} from "./identity-extract.js";

// ---------------------------------------------------------------------------
// Fixture builder — a structural IdentitySourceNode with an in-memory
// pluginData store (mirrors Figma's getPluginData/setPluginData contract:
// unset keys read back as "").
// ---------------------------------------------------------------------------

interface NodeSpec {
  id: string;
  name: string;
  type: string;
  width?: number;
  children?: NodeSpec[];
  resolvedVariableModes?: Record<string, string>;
  mainComponent?: { key: string; name: string; remote: boolean } | null;
  variantProperties?: Record<string, string> | null;
  pluginData?: Record<string, string>;
  componentKey?: string;
}

function buildNode(spec: NodeSpec): IdentitySourceNode {
  const store = new Map<string, string>(Object.entries(spec.pluginData ?? {}));
  return {
    id: spec.id,
    name: spec.name,
    type: spec.type,
    width: spec.width,
    children: spec.children?.map(buildNode),
    resolvedVariableModes: spec.resolvedVariableModes,
    mainComponent: spec.mainComponent,
    variantProperties: spec.variantProperties,
    componentKey: spec.componentKey,
    getPluginData(key: string): string {
      return store.get(key) ?? "";
    },
    setPluginData(key: string, value: string): void {
      store.set(key, value);
    },
  };
}

/** Builds a flat forest of N leaf roots named root-0..root-{n-1}. */
function flatRoots(n: number): NodeSpec[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `root-${i}`, type: "FRAME" }));
}

// ---------------------------------------------------------------------------
// ensureDurableId
// ---------------------------------------------------------------------------

describe("ensureDurableId", () => {
  it("mints and persists a durable id when absent", () => {
    const node = buildNode({ id: "1:1", name: "Frame", type: "FRAME" });
    const id = ensureDurableId(node, () => "n-fixedid0001");
    expect(id).toBe("n-fixedid0001");
    expect(node.getPluginData("uxf:durableId")).toBe("n-fixedid0001");
  });

  it("reads back the existing durable id without re-minting", () => {
    const node = buildNode({
      id: "1:1",
      name: "Frame",
      type: "FRAME",
      pluginData: { "uxf:durableId": "n-existing0001" },
    });
    let mintCalls = 0;
    const id = ensureDurableId(node, () => {
      mintCalls++;
      return "n-shouldnotuse";
    });
    expect(id).toBe("n-existing0001");
    expect(mintCalls).toBe(0);
  });

  it("default mint produces \"n-\" + 12 base36 chars", () => {
    const node = buildNode({ id: "1:1", name: "Frame", type: "FRAME" });
    const id = ensureDurableId(node);
    expect(id).toMatch(/^n-[0-9a-z]{12}$/);
  });

  it("uses the exact pluginData key \"uxf:durableId\"", () => {
    const node = buildNode({ id: "1:1", name: "Frame", type: "FRAME" });
    ensureDurableId(node, () => "n-abc");
    expect(node.getPluginData("uxf:durableId")).toBe("n-abc");
    expect(node.getPluginData("someOtherKey")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// extractIdentityTree — ordering, ordinals, isPageChild
// ---------------------------------------------------------------------------

describe("extractIdentityTree — parent-before-child ordering + ordinals", () => {
  const tree: NodeSpec[] = [
    {
      id: "A",
      name: "RootA",
      type: "FRAME",
      children: [
        { id: "A1", name: "ChildA1", type: "TEXT" },
        {
          id: "A2",
          name: "ChildA2",
          type: "FRAME",
          children: [{ id: "A2a", name: "GrandchildA2a", type: "TEXT" }],
        },
      ],
    },
    { id: "B", name: "RootB", type: "FRAME" },
  ];

  it("emits parent before child, depth-first, in doc order", () => {
    let counter = 0;
    const { extraction, truncated } = extractIdentityTree(tree.map(buildNode), {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
      mint: () => `n-mint${counter++}`.padEnd(14, "0").slice(0, 14),
    });

    expect(truncated).toBe(0);
    expect(extraction.nodes.map((n) => n.figmaNodeId)).toEqual(["A", "A1", "A2", "A2a", "B"]);
  });

  it("assigns ordinal = index among the parent's children", () => {
    const { extraction } = extractIdentityTree(tree.map(buildNode), {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
    });
    const byId = new Map(extraction.nodes.map((n) => [n.figmaNodeId, n]));

    expect(byId.get("A")!.ordinal).toBe(0); // 1st page child
    expect(byId.get("B")!.ordinal).toBe(1); // 2nd page child
    expect(byId.get("A1")!.ordinal).toBe(0); // 1st child of A
    expect(byId.get("A2")!.ordinal).toBe(1); // 2nd child of A
    expect(byId.get("A2a")!.ordinal).toBe(0); // 1st child of A2
  });

  it("sets isPageChild true only for the extraction roots", () => {
    const { extraction } = extractIdentityTree(tree.map(buildNode), {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
    });
    const byId = new Map(extraction.nodes.map((n) => [n.figmaNodeId, n]));

    expect(byId.get("A")!.isPageChild).toBe(true);
    expect(byId.get("B")!.isPageChild).toBe(true);
    expect(byId.get("A1")!.isPageChild).toBe(false);
    expect(byId.get("A2")!.isPageChild).toBe(false);
    expect(byId.get("A2a")!.isPageChild).toBe(false);
  });

  it("sets parentDurableId to null for roots and to the parent's durableId otherwise", () => {
    const { extraction } = extractIdentityTree(tree.map(buildNode), {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
    });
    const byId = new Map(extraction.nodes.map((n) => [n.figmaNodeId, n]));

    expect(byId.get("A")!.parentDurableId).toBeNull();
    expect(byId.get("B")!.parentDurableId).toBeNull();
    expect(byId.get("A1")!.parentDurableId).toBe(byId.get("A")!.durableId);
    expect(byId.get("A2")!.parentDurableId).toBe(byId.get("A")!.durableId);
    expect(byId.get("A2a")!.parentDurableId).toBe(byId.get("A2")!.durableId);
  });

  it("carries page + pageCount through to the extraction envelope", () => {
    const { extraction } = extractIdentityTree(tree.map(buildNode), {
      page: { figmaNodeId: "0:99", name: "Marketing" },
      pageCount: 3,
    });
    expect(extraction.version).toBe(1);
    expect(extraction.page).toEqual({ figmaNodeId: "0:99", name: "Marketing" });
    expect(extraction.pageCount).toBe(3);
  });

  it("maps node fields (kind, width, resolvedModes, mainComponent, variantProperties) with null/{} defaults", () => {
    const nodes: NodeSpec[] = [
      { id: "X", name: "Bare", type: "FRAME" },
      {
        id: "Y",
        name: "Full",
        type: "INSTANCE",
        width: 240,
        resolvedVariableModes: { "collection:1": "mode:light" },
        mainComponent: { key: "comp-key-1", name: "Button/Primary", remote: false },
        variantProperties: { Size: "Large" },
      },
    ];
    const { extraction } = extractIdentityTree(nodes.map(buildNode), {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
    });
    const byId = new Map(extraction.nodes.map((n) => [n.figmaNodeId, n]));

    const bare = byId.get("X")!;
    expect(bare.width).toBeNull();
    expect(bare.resolvedModes).toEqual({});
    expect(bare.mainComponent).toBeNull();
    expect(bare.variantProperties).toBeNull();
    expect(bare.kind).toBe("FRAME");
    expect(bare.currentName).toBe("Bare");

    const full = byId.get("Y")!;
    expect(full.width).toBe(240);
    expect(full.resolvedModes).toEqual({ "collection:1": "mode:light" });
    expect(full.mainComponent).toEqual({ key: "comp-key-1", name: "Button/Primary", remote: false });
    expect(full.variantProperties).toEqual({ Size: "Large" });
  });
});

// ---------------------------------------------------------------------------
// extractIdentityTree — durable id minting integration
// ---------------------------------------------------------------------------

describe("extractIdentityTree — durable id minting", () => {
  it("mints a durable id for every emitted node and persists it on the source node", () => {
    const node = buildNode({ id: "1:1", name: "Frame", type: "FRAME" });
    let calls = 0;
    const { extraction } = extractIdentityTree([node], {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
      mint: () => `n-minted${String(calls++).padStart(4, "0")}`,
    });
    expect(extraction.nodes[0]!.durableId).toBe("n-minted0000");
    expect(node.getPluginData("uxf:durableId")).toBe("n-minted0000");
  });

  it("reuses an existing durable id already stamped on the node", () => {
    const node = buildNode({
      id: "1:1",
      name: "Frame",
      type: "FRAME",
      pluginData: { "uxf:durableId": "n-preexisting1" },
    });
    const { extraction } = extractIdentityTree([node], {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
      mint: () => "n-shouldnotuse",
    });
    expect(extraction.nodes[0]!.durableId).toBe("n-preexisting1");
  });
});

// ---------------------------------------------------------------------------
// extractIdentityTree — 2000-node cap
// ---------------------------------------------------------------------------

describe("extractIdentityTree — truncation cap", () => {
  it("caps a flat forest at 2000 nodes and counts the overflow in truncated", () => {
    const roots = flatRoots(2005);
    const { extraction, truncated } = extractIdentityTree(roots.map(buildNode), {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
    });
    expect(extraction.nodes.length).toBe(2000);
    expect(truncated).toBe(5);
  });

  it("stops descending at the cap and counts the whole dropped subtree", () => {
    // 1999 flat leaf roots + a 2000th root that itself has 3 children.
    // The 2000th root fits exactly (nodes.length goes 1999 -> 2000); its
    // 3 children no longer fit and must be dropped as a subtree (not
    // silently skipped one-by-one at the top level).
    const roots: NodeSpec[] = [
      ...flatRoots(1999),
      {
        id: "last-root",
        name: "LastRoot",
        type: "FRAME",
        children: [
          { id: "c1", name: "Child1", type: "TEXT" },
          { id: "c2", name: "Child2", type: "TEXT" },
          { id: "c3", name: "Child3", type: "TEXT" },
        ],
      },
    ];
    const { extraction, truncated } = extractIdentityTree(roots.map(buildNode), {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
    });
    expect(extraction.nodes.length).toBe(2000);
    expect(extraction.nodes.at(-1)!.figmaNodeId).toBe("last-root");
    expect(truncated).toBe(3);
  });

  it("drops an entire never-visited subtree (root + descendants) when the cap is already full", () => {
    // 2000 flat leaf roots fill the cap exactly; a 2001st root with 4
    // children arrives after — the whole 5-node subtree is uncounted.
    const roots: NodeSpec[] = [
      ...flatRoots(2000),
      {
        id: "overflow-root",
        name: "OverflowRoot",
        type: "FRAME",
        children: [
          { id: "o1", name: "O1", type: "TEXT" },
          { id: "o2", name: "O2", type: "TEXT" },
          { id: "o3", name: "O3", type: "TEXT" },
          { id: "o4", name: "O4", type: "TEXT" },
        ],
      },
    ];
    const { extraction, truncated } = extractIdentityTree(roots.map(buildNode), {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
    });
    expect(extraction.nodes.length).toBe(2000);
    expect(truncated).toBe(5);
    expect(extraction.nodes.some((n) => n.figmaNodeId === "overflow-root")).toBe(false);
  });

  it("does not touch pluginData on dropped nodes", () => {
    const overflow = buildNode({ id: "dropped", name: "Dropped", type: "FRAME" });
    const roots = [...flatRoots(2000).map(buildNode), overflow];
    extractIdentityTree(roots, {
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
    });
    expect(overflow.getPluginData("uxf:durableId")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// harvestComponents
// ---------------------------------------------------------------------------

describe("harvestComponents — collects definitions + instance mainComponents", () => {
  it("collects a directly-defined COMPONENT with a document source", () => {
    const tree: NodeSpec[] = [{ id: "c1", name: "Icon", type: "COMPONENT" }];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries).toEqual([
      { key: "c1", roleName: "icon", source: "figma-document", matchability: "matchable" },
    ]);
  });

  it("collects a directly-defined COMPONENT_SET", () => {
    const tree: NodeSpec[] = [{ id: "cs1", name: "Button", type: "COMPONENT_SET" }];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries).toEqual([
      { key: "cs1", roleName: "button", source: "figma-document", matchability: "matchable" },
    ]);
  });

  it("derives roleName from slash variant syntax: \"Button/Primary\" -> \"button\"", () => {
    const tree: NodeSpec[] = [{ id: "c1", name: "Button/Primary", type: "COMPONENT" }];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries[0]!.roleName).toBe("button");
  });

  it("derives roleName from Prop=Value variant syntax by stripping from the first delimiter", () => {
    const tree: NodeSpec[] = [
      { id: "c1", name: "Size=Large, State=Default", type: "COMPONENT" },
    ];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries[0]!.roleName).toBe("size");
  });

  it("collects the mainComponent of an INSTANCE", () => {
    const tree: NodeSpec[] = [
      {
        id: "inst1",
        name: "Button instance",
        type: "INSTANCE",
        mainComponent: { key: "mc-key-1", name: "Button/Primary", remote: false },
      },
    ];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries).toEqual([
      { key: "mc-key-1", roleName: "button", source: "figma-document", matchability: "matchable" },
    ]);
  });

  it("marks source figma-library when the mainComponent is remote", () => {
    const tree: NodeSpec[] = [
      {
        id: "inst1",
        name: "Icon instance",
        type: "INSTANCE",
        mainComponent: { key: "mc-key-2", name: "Icon/Star", remote: true },
      },
    ];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries[0]!.source).toBe("figma-library");
  });

  it("dedupes two instances sharing the same mainComponent key into one entry", () => {
    const tree: NodeSpec[] = [
      {
        id: "inst1",
        name: "Button instance A",
        type: "INSTANCE",
        mainComponent: { key: "shared-key", name: "Button/Primary", remote: false },
      },
      {
        id: "inst2",
        name: "Button instance B",
        type: "INSTANCE",
        mainComponent: { key: "shared-key", name: "Button/Primary", remote: false },
      },
    ];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toBe("shared-key");
  });

  it("dedupes a definition (componentKey) and an instance pointing at it into one entry, keeping the definition's fields", () => {
    const tree: NodeSpec[] = [
      { id: "def-node-id", name: "Card/Elevated", type: "COMPONENT", componentKey: "real-figma-key" },
      {
        id: "inst1",
        name: "Card instance",
        type: "INSTANCE",
        // A remote/renamed mainComponent view of the SAME component — if the
        // instance-derived entry won, source would wrongly read
        // "figma-library" and roleName would read "renamed". The
        // definition must win: source "figma-document", roleName "card".
        mainComponent: { key: "real-figma-key", name: "Renamed/Elsewhere", remote: true },
      },
    ];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      key: "real-figma-key",
      roleName: "card",
      source: "figma-document",
      matchability: "matchable",
    });
  });

  it("dedupes regardless of visit order — instance appears before its own definition in doc order", () => {
    const tree: NodeSpec[] = [
      {
        id: "inst1",
        name: "Card instance",
        type: "INSTANCE",
        mainComponent: { key: "shared-real-key", name: "Card", remote: false },
      },
      { id: "def-node-id", name: "Card", type: "COMPONENT", componentKey: "shared-real-key" },
    ];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toBe("shared-real-key");
    expect(entries[0]!.source).toBe("figma-document");
  });

  it("falls back to node id as the key when a COMPONENT has no componentKey", () => {
    const tree: NodeSpec[] = [{ id: "no-key-node", name: "Card", type: "COMPONENT" }];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toBe("no-key-node");
  });

  it("walks nested subtrees to find components and instances at any depth", () => {
    const tree: NodeSpec[] = [
      {
        id: "root",
        name: "Root",
        type: "FRAME",
        children: [
          {
            id: "group",
            name: "Group",
            type: "GROUP",
            children: [
              {
                id: "inst1",
                name: "Nested instance",
                type: "INSTANCE",
                mainComponent: { key: "deep-key", name: "Card", remote: false },
              },
            ],
          },
        ],
      },
    ];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries).toEqual([
      { key: "deep-key", roleName: "card", source: "figma-document", matchability: "matchable" },
    ]);
  });

  it("returns an empty array when there are no components or instances", () => {
    const tree: NodeSpec[] = [{ id: "t1", name: "Just text", type: "TEXT" }];
    expect(harvestComponents(tree.map(buildNode))).toEqual([]);
  });

  it("falls back to the lowercased node type when the name kebabs to empty", () => {
    const tree: NodeSpec[] = [{ id: "c1", name: "!!!", type: "COMPONENT" }];
    const entries = harvestComponents(tree.map(buildNode));
    expect(entries[0]!.roleName).toBe("component");
  });

  it("caps roleName at 40 chars (exact word boundary at the cut point needs no adjustment)", () => {
    // Full kebab is "...component-name-that-exceeds-forty-characters" (70 chars);
    // a hard 40-char slice lands exactly at the end of "name" — already a clean
    // boundary, so no dash-trim is needed.
    const longName = "This Is An Extremely Long Component Name That Exceeds Forty Characters";
    const tree: NodeSpec[] = [{ id: "c1", name: longName, type: "COMPONENT" }];
    const entries = harvestComponents(tree.map(buildNode));
    const roleName = entries[0]!.roleName;
    expect(roleName).toBe("this-is-an-extremely-long-component-name");
    expect(roleName.length).toBe(40);
  });

  it("truncates a long roleName back to the last dash boundary when the 40-char cut lands mid-word", () => {
    // Full kebab is "...component-named-that-exceeds-forty-characters"; a hard
    // 40-char slice lands mid-word ("...component-name", losing the trailing "d"
    // of "named"), so it must be pulled back to the preceding dash.
    const longName = "This Is An Extremely Long Component Named That Exceeds Forty Characters";
    const tree: NodeSpec[] = [{ id: "c1", name: longName, type: "COMPONENT" }];
    const entries = harvestComponents(tree.map(buildNode));
    const roleName = entries[0]!.roleName;
    expect(roleName).toBe("this-is-an-extremely-long-component");
    expect(roleName.endsWith("-")).toBe(false);
    expect(roleName.length).toBeLessThanOrEqual(40);
  });
});

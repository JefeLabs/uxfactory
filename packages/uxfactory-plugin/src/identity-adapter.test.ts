import { describe, it, expect } from "vitest";
import { toIdentitySourceNode, type RawIdentityNode } from "./identity-adapter.js";

// ---------------------------------------------------------------------------
// Fixture builder — a RawIdentityNode with an in-memory pluginData store
// (mirrors Figma's getPluginData/setPluginData contract).
// ---------------------------------------------------------------------------

interface RawSpec {
  id: string;
  name: string;
  type: string;
  width?: number;
  resolvedVariableModes?: Record<string, string>;
  variantProperties?: Record<string, string> | null;
  key?: string;
  mainComponent?: { key: string; name: string; remote: boolean } | null;
  children?: RawSpec[];
  pluginData?: Record<string, string>;
}

function buildRaw(spec: RawSpec): RawIdentityNode {
  const store = new Map<string, string>(Object.entries(spec.pluginData ?? {}));
  return {
    id: spec.id,
    name: spec.name,
    type: spec.type,
    width: spec.width,
    resolvedVariableModes: spec.resolvedVariableModes,
    variantProperties: spec.variantProperties,
    key: spec.key,
    mainComponent: spec.mainComponent,
    children: spec.children?.map(buildRaw),
    getPluginData(key: string): string {
      return store.get(key) ?? "";
    },
    setPluginData(key: string, value: string): void {
      store.set(key, value);
    },
  };
}

describe("toIdentitySourceNode — field pass-through", () => {
  it("maps id/name/type/width straight through", () => {
    const raw = buildRaw({ id: "1:1", name: "Hero", type: "FRAME", width: 375 });
    const out = toIdentitySourceNode(raw);
    expect(out.id).toBe("1:1");
    expect(out.name).toBe("Hero");
    expect(out.type).toBe("FRAME");
    expect(out.width).toBe(375);
  });

  it("passes resolvedVariableModes, variantProperties, and mainComponent through unchanged", () => {
    const raw = buildRaw({
      id: "1:2",
      name: "Button instance",
      type: "INSTANCE",
      resolvedVariableModes: { "collection:1": "mode:light" },
      variantProperties: { Size: "Large" },
      mainComponent: { key: "mc-key", name: "Button/Primary", remote: false },
    });
    const out = toIdentitySourceNode(raw);
    expect(out.resolvedVariableModes).toEqual({ "collection:1": "mode:light" });
    expect(out.variantProperties).toEqual({ Size: "Large" });
    expect(out.mainComponent).toEqual({ key: "mc-key", name: "Button/Primary", remote: false });
  });

  it("leaves width/resolvedVariableModes/variantProperties/mainComponent undefined when absent on the raw node", () => {
    const raw = buildRaw({ id: "1:3", name: "Bare", type: "FRAME" });
    const out = toIdentitySourceNode(raw);
    expect(out.width).toBeUndefined();
    expect(out.resolvedVariableModes).toBeUndefined();
    expect(out.variantProperties).toBeUndefined();
    expect(out.mainComponent).toBeUndefined();
  });
});

describe("toIdentitySourceNode — componentKey population", () => {
  it("populates componentKey from key for a COMPONENT node", () => {
    const raw = buildRaw({ id: "c1", name: "Icon", type: "COMPONENT", key: "real-figma-key" });
    const out = toIdentitySourceNode(raw);
    expect(out.componentKey).toBe("real-figma-key");
  });

  it("populates componentKey from key for a COMPONENT_SET node", () => {
    const raw = buildRaw({ id: "cs1", name: "Button", type: "COMPONENT_SET", key: "set-key" });
    const out = toIdentitySourceNode(raw);
    expect(out.componentKey).toBe("set-key");
  });

  it("does NOT populate componentKey for a FRAME, even if key happens to be present", () => {
    const raw = buildRaw({ id: "f1", name: "Frame", type: "FRAME", key: "should-not-leak" });
    const out = toIdentitySourceNode(raw);
    expect(out.componentKey).toBeUndefined();
  });

  it("does NOT populate componentKey for an INSTANCE", () => {
    const raw = buildRaw({
      id: "i1",
      name: "Button instance",
      type: "INSTANCE",
      mainComponent: { key: "mc-key", name: "Button", remote: false },
    });
    const out = toIdentitySourceNode(raw);
    expect(out.componentKey).toBeUndefined();
  });

  it("leaves componentKey undefined for a COMPONENT with no key (a downstream fallback handles this)", () => {
    const raw = buildRaw({ id: "c2", name: "Card", type: "COMPONENT" });
    const out = toIdentitySourceNode(raw);
    expect(out.componentKey).toBeUndefined();
  });
});

describe("toIdentitySourceNode — recursive children", () => {
  it("recursively maps a nested subtree, preserving depth and order", () => {
    const raw = buildRaw({
      id: "root",
      name: "Root",
      type: "FRAME",
      children: [
        { id: "a", name: "A", type: "TEXT" },
        {
          id: "b",
          name: "B",
          type: "FRAME",
          children: [{ id: "b1", name: "B1", type: "COMPONENT", key: "nested-key" }],
        },
      ],
    });
    const out = toIdentitySourceNode(raw);
    expect(out.children?.map((c) => c.id)).toEqual(["a", "b"]);
    expect(out.children?.[1]?.children?.[0]?.id).toBe("b1");
    expect(out.children?.[1]?.children?.[0]?.componentKey).toBe("nested-key");
  });

  it("leaves children undefined for a leaf raw node", () => {
    const raw = buildRaw({ id: "leaf", name: "Leaf", type: "TEXT" });
    const out = toIdentitySourceNode(raw);
    expect(out.children).toBeUndefined();
  });
});

describe("toIdentitySourceNode — pluginData delegation", () => {
  it("getPluginData/setPluginData delegate to the raw node's own functions (writes are visible via the same raw node)", () => {
    const raw = buildRaw({ id: "1:1", name: "Frame", type: "FRAME" });
    const out = toIdentitySourceNode(raw);

    expect(out.getPluginData("uxf:durableId")).toBe("");
    out.setPluginData("uxf:durableId", "n-abc123");
    // Reading back through BOTH the adapted view and the original raw node
    // proves the write landed on the same underlying store (the real node).
    expect(out.getPluginData("uxf:durableId")).toBe("n-abc123");
    expect(raw.getPluginData("uxf:durableId")).toBe("n-abc123");
  });

  it("reads pre-existing pluginData already stamped on the raw node", () => {
    const raw: RawIdentityNode = {
      ...buildRaw({ id: "1:1", name: "Frame", type: "FRAME" }),
    };
    const store = new Map<string, string>([["uxf:durableId", "n-existing"]]);
    raw.getPluginData = (key: string) => store.get(key) ?? "";
    raw.setPluginData = (key: string, value: string) => store.set(key, value);

    const out = toIdentitySourceNode(raw);
    expect(out.getPluginData("uxf:durableId")).toBe("n-existing");
  });
});

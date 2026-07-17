import type { IdentitySourceNode } from "./identity-extract.js";

/**
 * identity-adapter.ts — pure Figma-node → IdentitySourceNode field mapping.
 *
 * Task 4 (plugin main-thread scan). code.ts owns the impure half: an async
 * walk over the real `figma.currentPage.children` that resolves each
 * INSTANCE's main component (`getMainComponentAsync`) before this module
 * ever runs — real network/global access has to happen there, not here.
 * This module is the pure remainder: given an already-resolved node tree
 * (`RawIdentityNode`, whose only Figma-touching members are the two
 * pluginData functions that still delegate to the live node), produce the
 * exact `IdentitySourceNode` shape identity-extract.ts (Task 3) expects.
 * Unit-testable against plain object fixtures — no Figma globals, no async.
 */

/** A Figma-node-shaped input, already resolved (mainComponent pre-fetched). */
export interface RawIdentityNode {
  id: string;
  name: string;
  type: string;
  width?: number;
  resolvedVariableModes?: Record<string, string>;
  variantProperties?: Record<string, string> | null;
  /** The real Figma component key (`node.key`) — present on COMPONENT/COMPONENT_SET. */
  key?: string;
  /** Pre-resolved (async, via getMainComponentAsync) for INSTANCE nodes; absent otherwise. */
  mainComponent?: { key: string; name: string; remote: boolean } | null;
  children?: RawIdentityNode[];
  getPluginData(key: string): string;
  setPluginData(key: string, value: string): void;
}

/**
 * Maps one already-resolved raw node (and its subtree) into the
 * `IdentitySourceNode` shape. `componentKey` is populated from `key` ONLY for
 * COMPONENT/COMPONENT_SET nodes (required — `harvestComponents` in
 * identity-extract.ts depends on this to dedupe a definition against
 * instances pointing at it). getPluginData/setPluginData are passed straight
 * through so durable-id writes still land on the real Figma node.
 */
export function toIdentitySourceNode(raw: RawIdentityNode): IdentitySourceNode {
  const isDefinition = raw.type === "COMPONENT" || raw.type === "COMPONENT_SET";
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    width: raw.width,
    children: raw.children?.map(toIdentitySourceNode),
    resolvedVariableModes: raw.resolvedVariableModes,
    mainComponent: raw.mainComponent,
    variantProperties: raw.variantProperties,
    componentKey: isDefinition ? raw.key : undefined,
    getPluginData: raw.getPluginData,
    setPluginData: raw.setPluginData,
  };
}

import type { ComponentTypeEntry, ExtractedNode, IdentityExtraction } from "@uxfactory/spec";

/**
 * identity-extract.ts — pure extraction, durable-id minting, and component
 * harvest for the node-identity feature.
 *
 * Source: .superpowers/sdd/task-3-brief.md. Pure module — NO Figma globals.
 * `IdentitySourceNode` is a minimal structural interface over what this
 * module reads/writes (pattern: `canvas-snapshot.ts`'s `FrameLike`), so
 * these functions are unit-testable against plain object fixtures and are
 * satisfied by Figma's real SceneNode at the call site (in code.ts).
 */

/** A structural Figma-node-like input (no Figma globals — unit-testable). */
export interface IdentitySourceNode {
  id: string;
  name: string;
  type: string;
  width?: number;
  children?: IdentitySourceNode[];
  resolvedVariableModes?: Record<string, string>;
  mainComponent?: { key: string; name: string; remote: boolean } | null;
  variantProperties?: Record<string, string> | null;
  /**
   * The real Figma component key (`node.key`), present on COMPONENT/
   * COMPONENT_SET nodes. The Task 4 Figma-side adapter populates this from
   * `node.key`. `harvestComponents` uses it (falling back to `id` when
   * absent) so a tree-walked definition and the `mainComponent.key` of
   * instances pointing at it land under the SAME registry key — assembly
   * matches `instance.mainComponent.key` against registry keys, so a
   * definition and its instances must dedupe into one entry.
   */
  componentKey?: string;
  getPluginData(key: string): string;
  setPluginData(key: string, value: string): void;
}

const DURABLE_ID_KEY = "uxf:durableId";
const NODE_CAP = 2000;
const ROLE_NAME_MAX = 40;

// ─── durable id ──────────────────────────────────────────────────────────────

function randomBase36(length: number): string {
  let out = "";
  while (out.length < length) {
    out += Math.random().toString(36).slice(2);
  }
  return out.slice(0, length);
}

function defaultMint(): string {
  return `n-${randomBase36(12)}`;
}

/**
 * Reads the durable id already stamped on `node` (pluginData key
 * `"uxf:durableId"`); mints and persists one via `mint` (default:
 * `"n-" + 12 random base36 chars`) when absent. Figma's getPluginData
 * returns `""` for an unset key, so an empty string counts as absent.
 */
export function ensureDurableId(node: IdentitySourceNode, mint: () => string = defaultMint): string {
  const existing = node.getPluginData(DURABLE_ID_KEY);
  if (existing !== "") return existing;
  const minted = mint();
  node.setPluginData(DURABLE_ID_KEY, minted);
  return minted;
}

// ─── extraction ─────────────────────────────────────────────────────────────

export interface ExtractIdentityTreeOptions {
  page: { figmaNodeId: string; name: string };
  pageCount: number;
  mint?: () => string;
}

export interface ExtractIdentityTreeResult {
  extraction: IdentityExtraction;
  truncated: number;
}

/** Counts a node and every descendant — used to size a subtree dropped at the cap. */
function countSubtree(node: IdentitySourceNode): number {
  let count = 1;
  for (const child of node.children ?? []) {
    count += countSubtree(child);
  }
  return count;
}

/**
 * Walks each page child's subtree depth-first, parent before child, emitting
 * one `ExtractedNode` per node. `isPageChild` is true for the roots (the
 * `pageChildren` entries themselves). Capped at 2000 emitted nodes per
 * extraction: once the cap is reached, remaining nodes are not visited (no
 * durable-id minting, no pluginData writes) and the full size of every
 * dropped subtree is accumulated into `truncated`.
 */
export function extractIdentityTree(
  pageChildren: IdentitySourceNode[],
  opts: ExtractIdentityTreeOptions,
): ExtractIdentityTreeResult {
  const mint = opts.mint ?? defaultMint;
  const nodes: ExtractedNode[] = [];
  let truncated = 0;

  function walk(node: IdentitySourceNode, parentDurableId: string | null, ordinal: number, isPageChild: boolean): void {
    if (nodes.length >= NODE_CAP) {
      truncated += countSubtree(node);
      return;
    }

    const durableId = ensureDurableId(node, mint);
    nodes.push({
      durableId,
      figmaNodeId: node.id,
      parentDurableId,
      ordinal,
      kind: node.type,
      width: node.width ?? null,
      currentName: node.name,
      resolvedModes: node.resolvedVariableModes ?? {},
      mainComponent: node.mainComponent ?? null,
      variantProperties: node.variantProperties ?? null,
      isPageChild,
    });

    const children = node.children ?? [];
    for (let i = 0; i < children.length; i++) {
      walk(children[i]!, durableId, i, false);
    }
  }

  for (let i = 0; i < pageChildren.length; i++) {
    walk(pageChildren[i]!, null, i, true);
  }

  return {
    extraction: {
      version: 1,
      page: opts.page,
      pageCount: opts.pageCount,
      nodes,
    },
    truncated,
  };
}

// ─── component harvest ──────────────────────────────────────────────────────

/**
 * lowercase, non-alphanumeric runs -> single "-", trim/collapse "-", max 40
 * chars truncated at a "-" boundary; empty result -> lowercased fallback
 * (the node's Figma type, e.g. "FRAME" -> "frame").
 */
function kebab(input: string, fallback: string): string {
  let slug = input.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  slug = slug.replace(/^-+/, "").replace(/-+$/, "");

  if (slug.length > ROLE_NAME_MAX) {
    // Only pull back to the preceding dash when the hard cut lands mid-word
    // (the char right after the cut point is not itself a "-" boundary).
    const boundaryChar = slug.charAt(ROLE_NAME_MAX);
    let hardCut = slug.slice(0, ROLE_NAME_MAX);
    if (boundaryChar !== "-") {
      const lastDash = hardCut.lastIndexOf("-");
      hardCut = lastDash > 0 ? hardCut.slice(0, lastDash) : hardCut;
    }
    slug = hardCut.replace(/-+$/, "");
  }

  return slug === "" ? fallback.toLowerCase() : slug;
}

/**
 * roleName input: strip everything from the first variant-syntax delimiter
 * ("/", ",", or "=") onward — "Button/Primary" -> "Button",
 * "Size=Large, State=Default" -> "Size" — else the name is used as-is.
 */
function stripVariantSyntax(name: string): string {
  const match = /[/,=]/.exec(name);
  return match ? name.slice(0, match.index) : name;
}

function roleNameFor(name: string, fallbackType: string): string {
  return kebab(stripVariantSyntax(name), fallbackType);
}

/**
 * Walks the tree collecting component definitions (a) COMPONENT/COMPONENT_SET
 * nodes found in the tree, and (b) the mainComponent of every INSTANCE.
 * Deduped by key.
 *
 * Definitions are always the authoritative source for a key: a tree-walked
 * definition uses `componentKey ?? id` (real Figma component key when the
 * adapter populated it, else the node id as a last resort), and an instance
 * whose `mainComponent.key` resolves to the SAME key must dedupe into that
 * one entry — never the other way around. Two passes make this true
 * regardless of document order (an instance can appear before or after its
 * own master component in the tree): pass 1 collects every definition
 * unconditionally (first-definition-wins only guards the pathological case
 * of two definitions sharing a key); pass 2 adds instance-derived entries
 * only for keys no definition already claimed.
 */
export function harvestComponents(pageChildren: IdentitySourceNode[]): ComponentTypeEntry[] {
  const byKey = new Map<string, ComponentTypeEntry>();
  const definitionKeys = new Set<string>();

  function walkDefinitions(node: IdentitySourceNode): void {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      const key = node.componentKey ?? node.id;
      if (!definitionKeys.has(key)) {
        definitionKeys.add(key);
        byKey.set(key, {
          key,
          roleName: roleNameFor(node.name, node.type),
          source: "figma-document",
          matchability: "matchable",
        });
      }
    }
    for (const child of node.children ?? []) {
      walkDefinitions(child);
    }
  }

  function walkInstances(node: IdentitySourceNode): void {
    if (node.type === "INSTANCE" && node.mainComponent) {
      const mc = node.mainComponent;
      if (!byKey.has(mc.key)) {
        byKey.set(mc.key, {
          key: mc.key,
          roleName: roleNameFor(mc.name, "COMPONENT"),
          source: mc.remote ? "figma-library" : "figma-document",
          matchability: "matchable",
        });
      }
    }
    for (const child of node.children ?? []) {
      walkInstances(child);
    }
  }

  for (const root of pageChildren) {
    walkDefinitions(root);
  }
  for (const root of pageChildren) {
    walkInstances(root);
  }

  return Array.from(byKey.values());
}

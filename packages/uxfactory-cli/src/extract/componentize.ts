/**
 * Lossless cross-view component detection (SP3c §2). Pure spec→spec:
 * identical nested-Frame subtrees (≥2, fingerprint-grouped) are rewritten as
 * ComponentDef + component-instance nodes with characters/fill overrides.
 * Two gates before any rewrite: addressability (identical, unique descendant
 * names) and losslessness (re-expansion deep-equals the original). Skip-not-
 * fail at group granularity — like the layout self-check.
 */
import type {
  DesignSpec, Frame, FrameChild, ComponentDef, ComponentInstanceNode, InstanceOverride,
} from "@uxfactory/spec";

export interface ComponentizeStats {
  components: number;
  instances: number;
  rejectedAmbiguous: number;
  rejectedLossy: number;
}

export interface ComponentizeResult {
  spec: DesignSpec;
  stats: ComponentizeStats;
}

/** JSON.stringify with recursively sorted keys — deterministic canonical form. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function isNestedFrame(c: FrameChild): c is Frame {
  return !("type" in c);
}

/** Structural fingerprint — excludes name/x/y everywhere and the override alphabet on leaves. */
function fp(node: FrameChild): string {
  if (isNestedFrame(node)) {
    return stable({
      k: "f", w: node.width, h: node.height, fill: node.fill,
      layout: node.layout, sizing: node.sizing,
      cornerRadius: node.cornerRadius, effects: node.effects,
      ch: (node.children ?? []).map(fp),
    });
  }
  if (node.type === "text") {
    return stable({
      k: "t", w: node.width, h: node.height,
      fontSize: node.fontSize,
      fontWeight: node.fontWeight,
      fontFamily: node.fontFamily,
      lineHeight: node.lineHeight,
      opacity: node.opacity,
    });
  }
  if (node.type === "shape") {
    return stable({
      k: "s", w: node.width, h: node.height, stroke: node.stroke,
      strokeWidth: node.strokeWidth, cornerRadius: node.cornerRadius,
      effects: node.effects, opacity: node.opacity,
    });
  }
  // instance / component-instance / anything else: identity by full shape (never grouped in practice)
  return stable({ k: node.type, v: node });
}

/** Pre-order descendant names (root excluded). */
function nameSeq(node: Frame): string[] {
  const out: string[] = [];
  const walk = (c: FrameChild): void => {
    out.push(c.name);
    if (isNestedFrame(c)) (c.children ?? []).forEach(walk);
  };
  (node.children ?? []).forEach(walk);
  return out;
}

/** Pre-order descendant nodes (root excluded). */
function descendants(node: Frame): FrameChild[] {
  const out: FrameChild[] = [];
  const walk = (c: FrameChild): void => {
    out.push(c);
    if (isNestedFrame(c)) (c.children ?? []).forEach(walk);
  };
  (node.children ?? []).forEach(walk);
  return out;
}

interface Candidate {
  node: Frame;
  parentChildren: FrameChild[]; // the (cloned) array physically holding this node
  index: number;
}

export function componentize(spec: DesignSpec): ComponentizeResult {
  const out = structuredClone(spec) as DesignSpec;
  const stats: ComponentizeStats = { components: 0, instances: 0, rejectedAmbiguous: 0, rejectedLossy: 0 };

  // 1. collect candidates pre-order across all views (on the clone).
  const candidates: Candidate[] = [];
  const collect = (children: FrameChild[]): void => {
    for (const [i, c] of children.entries()) {
      if (isNestedFrame(c)) {
        candidates.push({ node: c, parentChildren: children, index: i });
        collect(c.children ?? []);
      }
    }
  };
  for (const frame of out.frames) collect(frame.children ?? []);

  // 2. group by fingerprint, insertion (pre-order) ordered.
  const groups = new Map<string, Candidate[]>();
  for (const cand of candidates) {
    const key = fp(cand.node);
    const g = groups.get(key);
    if (g) g.push(cand); else groups.set(key, [cand]);
  }

  const replaced = new Set<FrameChild>();
  const components: Record<string, ComponentDef> = {};
  let nextId = 1;

  for (const group of groups.values()) {
    // Outermost-wins: drop members already replaced (they sat inside a replaced
    // subtree) or whose own subtree overlaps a replacement.
    const live = group.filter(
      (m) => !replaced.has(m.node) && !descendants(m.node).some((d) => replaced.has(d)),
    );
    if (live.length < 2) continue;

    // 3. addressability
    const seq0 = nameSeq(live[0]!.node);
    const unique = new Set(seq0).size === seq0.length;
    const allSame = live.every((m) => {
      const s = nameSeq(m.node);
      return s.length === seq0.length && s.every((n, i) => n === seq0[i]);
    });
    if (!unique || !allSame) { stats.rejectedAmbiguous += 1; continue; }

    // 4. overrides + losslessness
    const defRoot = structuredClone(live[0]!.node);
    const defDescendants = descendants(defRoot);
    const perMember: (Record<string, InstanceOverride> | undefined)[] = [];
    let lossy = false;
    for (const m of live) {
      const overrides: Record<string, InstanceOverride> = {};
      const mDesc = descendants(m.node);
      for (const [i, d] of defDescendants.entries()) {
        const md = mDesc[i]!;
        const ov: InstanceOverride = {};
        if ("characters" in d && "characters" in md && d.characters !== md.characters) {
          ov.characters = (md as { characters?: string }).characters;
        }
        if ("fill" in d && !isNestedFrame(d) && (d as { fill?: string }).fill !== (md as { fill?: string }).fill) {
          ov.fill = (md as { fill?: string }).fill;
        }
        if (Object.keys(ov).length > 0) overrides[d.name] = ov;
      }
      // losslessness: expand def + overrides at the member position and compare.
      const expanded = structuredClone(defRoot);
      expanded.x = m.node.x; expanded.y = m.node.y; expanded.name = m.node.name;
      for (const d of descendants(expanded)) {
        const ov = overrides[d.name];
        if (!ov) continue;
        if (ov.characters !== undefined) (d as { characters?: string }).characters = ov.characters;
        if (ov.fill !== undefined) (d as { fill?: string }).fill = ov.fill;
      }
      if (stable(expanded) !== stable(m.node)) { lossy = true; break; }
      perMember.push(Object.keys(overrides).length > 0 ? overrides : undefined);
    }
    if (lossy) { stats.rejectedLossy += 1; continue; }

    // 5. rewrite
    const id = `comp-${nextId}`; nextId += 1;
    const def: ComponentDef = {
      name: defRoot.name, width: defRoot.width, height: defRoot.height,
      ...(defRoot.layout !== undefined ? { layout: defRoot.layout } : {}),
      ...(defRoot.sizing !== undefined ? { sizing: defRoot.sizing } : {}),
      ...(defRoot.fill !== undefined ? { fill: defRoot.fill } : {}),
      ...(defRoot.cornerRadius !== undefined ? { cornerRadius: defRoot.cornerRadius } : {}),
      ...(defRoot.effects !== undefined ? { effects: defRoot.effects } : {}),
      ...(defRoot.children !== undefined ? { children: defRoot.children } : {}),
    };
    components[id] = def;
    for (const [i, m] of live.entries()) {
      const inst: ComponentInstanceNode = {
        type: "component-instance", name: m.node.name, component: id, x: m.node.x, y: m.node.y,
        ...(perMember[i] !== undefined ? { overrides: perMember[i] } : {}),
      };
      m.parentChildren[m.index] = inst;
      replaced.add(m.node);
      for (const d of descendants(m.node)) replaced.add(d);
    }
    stats.components += 1;
    stats.instances += live.length;
  }

  if (Object.keys(components).length > 0) out.components = components;
  return { spec: out, stats };
}

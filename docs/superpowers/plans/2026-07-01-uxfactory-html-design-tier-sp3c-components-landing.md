# SP3c — Components, Loop Landing & Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SP3 v1: lossless cross-view component detection in the extractor, typography fidelity end-to-end, a recursive semantic landing gate, automated publish+verify in the worker loop, masters off-flow placement, and the accumulated cleanups — finished with a live E2E landing proof.

**Architecture:** Engine gains `extract/componentize.ts` (pure spec→spec) + `extract/layout-utils.ts`; `@uxfactory/spec` adds TextNode font fields (types+schema lockstep); the extractor captures/emits fonts; the plugin renders fonts fail-soft, places masters on a negative-X strip, and reports recursive counts in coordination with `@uxfactory/gate` going recursive; `skill/design` gains an extract step and the worker publishes per-view specs via the existing `uxfactory publish --verify` machinery (bounded, best-effort, never blocking job success).

**Tech Stack:** TypeScript ESM/NodeNext, Ajv schema, Vitest, existing bridge/queue/verify infrastructure.

## Global Constraints

- **Boundaries:** componentize is pure spec→spec in `packages/uxfactory-cli` (engine stays LLM-free/offline); `@uxfactory/spec` + `@uxfactory/gate` stay pure; the plugin only renders; the worker only orchestrates (shell-out via its provisioned `uxfactory` shim + progress events). No AgentCore/cloud code anywhere.
- **Component detection (user decision):** cross-view, min **2** instances, **lossless or skip** — a group is rewritten ONLY when (a) descendant names are addressable (identical pre-order name sequences across members; unique names within the subtree) and (b) re-expansion (def + overrides at the instance position) deep-equals every original subtree. Override alphabet: `characters`, `fill` (never geometry). Root-frame `fill` is IN the fingerprint (an instance node cannot override its own root). Outermost-wins for overlaps. Skip-not-fail at group granularity.
- **Landing is downstream & best-effort:** publish+verify runs after job success; verification bounded at **60 s per view**; failure/timeout → `pending`, NEVER a job failure.
- **Gate recursion subsumes flat:** no mode flag; existing flat diagram specs must produce byte-identical verdicts (regression-guarded). Figma `x`/`y` are parent-relative at every depth — expected values stay parent-relative (no absolute accumulation).
- **Fonts fail-soft:** `(family, style)` → `(family, "Regular")` → `("Inter", "Regular")`; weight→style map `300:Light, 400:Regular, 500:Medium, 600:Semi Bold, 700:Bold, 800:Extra Bold` (nearest-down for other values). A missing font never aborts a render.
- **Typecheck gates:** `pnpm -r build` does NOT typecheck the plugin — run `pnpm --filter @uxfactory/plugin typecheck` (0 errors) on every plugin-touching task.
- Commits: on `main`; explicit paths only (never `git add -A`); every message ends `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Suites that must stay green throughout: `pnpm --filter @uxfactory/spec test`, `pnpm --filter @uxfactory/gate test`, `pnpm --filter @uxfactory/plugin test` (197+), `pnpm --filter @uxfactory/cli exec vitest run test/extract-*.test.ts test/dom-capture.test.ts`, `pnpm --filter uxfactory-worker test` (worker package name: check `clients/uxfactory-worker/package.json` `name` and use it), `pnpm -r build`.

## File map

- Task 1: `packages/uxfactory-cli/src/extract/layout-utils.ts` (new) + import updates + stats JSDoc + mock comment.
- Task 2: `packages/uxfactory-cli/src/extract/componentize.ts` (new) + `test/extract-componentize.test.ts`.
- Task 3: `packages/uxfactory-cli/src/commands/extract.ts` + `src/cli.ts` (flag) + `test/extract-cli.test.ts`.
- Task 4: `packages/uxfactory-spec/{src/types.ts, schema/uxfactory.schema.json, test/cases.ts}` (fonts).
- Task 5: `packages/uxfactory-cli/{src/render/dom-capture.ts, src/extract/dom-to-designspec.ts}` + tests (font capture/emit).
- Task 6: `packages/uxfactory-plugin/{src/planner.ts, src/code.ts, test/figma-mock.ts, test/code.test.ts, test/planner.test.ts}` (fonts).
- Task 7: `packages/uxfactory-gate/src/internal.ts` + `packages/uxfactory-plugin/src/code.ts` (recursive counts, masters strip) + tests both packages.
- Task 8: `skill/design/SKILL.md` + `clients/uxfactory-worker/src/generative.ts` (+ new `src/landing.ts`) + worker/cli skill tests.
- Task 9: live E2E (controller-run; no code).

---

## Task 1: Cleanups — `layout-utils.ts`, stats doc, mock note

**Files:**
- Create: `packages/uxfactory-cli/src/extract/layout-utils.ts`
- Modify: `packages/uxfactory-cli/src/extract/dom-to-designspec.ts`, `packages/uxfactory-cli/src/extract/style-map.ts`, `packages/uxfactory-cli/src/extract/layout-infer.ts`
- Modify: `packages/uxfactory-plugin/test/figma-mock.ts` (comment only)

**Interfaces:**
- Produces: `layout-utils.ts` exporting `px(s: string): number`, `r2(n: number): number`, `contentBox(n: CapturedNode): {x,y,width,height}` — moved VERBATIM from `dom-to-designspec.ts`. `dom-to-designspec.ts` re-exports them (`export { px, r2, contentBox } from "./layout-utils.js";`) so existing importers (style-map, tests) keep working; `layout-infer.ts` imports from `./layout-utils.js` directly — the circular import is gone.

- [ ] **Step 1: Move the three helpers**

Create `packages/uxfactory-cli/src/extract/layout-utils.ts` containing the exact `px`, `r2`, `contentBox` implementations currently in `dom-to-designspec.ts` (copy them verbatim, with their JSDoc, plus the `CapturedNode` type-only import). Delete them from `dom-to-designspec.ts` and add there:

```ts
export { px, r2, contentBox } from "./layout-utils.js";
```

(plus a local `import { px, r2, contentBox } from "./layout-utils.js";` for internal use). In `layout-infer.ts`, change the import of `px`/`contentBox` to `./layout-utils.js`. In `style-map.ts`, change `import { px } from "./dom-to-designspec.js"` to `./layout-utils.js`.

- [ ] **Step 2: Stats JSDoc**

On `ExtractStats` in `dom-to-designspec.ts`, extend the doc comment:

```ts
/**
 * Extraction statistics. NOTE: `selfCheckFallbacks` is a SUBSET of
 * `containers.absolute` (candidates found but rejected by the geometric
 * self-check) — do not sum them.
 */
```

- [ ] **Step 3: Mock note**

In `packages/uxfactory-plugin/test/figma-mock.ts`, above the `layoutMode` field on `FakeNode`, add:

```ts
  /**
   * NOTE: real Figma flips primary/counterAxisSizingMode to AUTO (hug) when
   * layoutMode is enabled — this fake does NOT model that. applyAutoLayout pins
   * both axes FIXED (see code.ts); the code.test.ts assertions guard it.
   */
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-structure.test.ts test/extract-style.test.ts test/extract-layout.test.ts test/extract-selfcheck.test.ts test/extract-cli.test.ts` (all green — pure move), `pnpm --filter @uxfactory/plugin test` (green), `pnpm -r build` (green).

```bash
git add packages/uxfactory-cli/src/extract/layout-utils.ts packages/uxfactory-cli/src/extract/dom-to-designspec.ts packages/uxfactory-cli/src/extract/style-map.ts packages/uxfactory-cli/src/extract/layout-infer.ts packages/uxfactory-plugin/test/figma-mock.ts
git commit -m "chore(cli): extract layout-utils, document stats subset, note mock hug gap (SP3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `componentize.ts` — lossless cross-view component detection

**Files:**
- Create: `packages/uxfactory-cli/src/extract/componentize.ts`
- Test: `packages/uxfactory-cli/test/extract-componentize.test.ts`

**Interfaces:**
- Consumes: `DesignSpec`, `Frame`, `FrameChild`, `ComponentDef`, `ComponentInstanceNode`, `InstanceOverride` from `@uxfactory/spec`.
- Produces (Task 3 relies on these exact names):

```ts
export interface ComponentizeStats { components: number; instances: number; rejectedAmbiguous: number; rejectedLossy: number; }
export interface ComponentizeResult { spec: DesignSpec; stats: ComponentizeStats; }
export function componentize(spec: DesignSpec): ComponentizeResult;   // pure; input not mutated
```

**Algorithm (implement exactly):**
1. **Candidates:** pre-order walk of every top-level frame's descendants; every nested `Frame` (a child without `type`) is a candidate. View roots (`spec.frames[*]`) are not.
2. **Fingerprint** `fp(node)` (canonical JSON string, built bottom-up):
   - nested Frame: `{k:"f", w, h, fill, layout, sizing, cornerRadius, effects, ch:[fp(children)...]}` — note **fill IS included on the candidate root and every nested frame** (instance roots can't be overridden; nested-frame fills COULD be overridden but v1 keeps frame fill in the fingerprint for simplicity and losslessness-by-construction; only text/shape `fill` and `characters` are overridable).
   - text: `{k:"t", w, h, fontSize, fontWeight, fontFamily, lineHeight, opacity}` — excludes `characters` + `fill`.
   - shape: `{k:"s", w, h, stroke, strokeWidth, cornerRadius, effects, opacity}` — excludes `fill`.
   - All geometry/`x`/`y`/`name` excluded everywhere except `w`/`h` (sizes are structural). Use a local `stable(v)` — JSON.stringify with sorted object keys — for determinism.
3. **Group** candidates by fingerprint (Map, insertion order = pre-order traversal across `spec.frames` in order — deterministic). Keep groups with ≥ 2 members.
4. **Outermost-wins:** process groups in first-occurrence order (pre-order guarantees parents precede children). Track a `Set` of replaced Frame object references (each replaced subtree's every descendant). A member whose node is already in the set is dropped; groups falling below 2 members are skipped entirely (not counted as rejected).
5. **Addressability gate:** for the group: collect each member's pre-order descendant `name` sequence (excluding the root). All sequences must be identical AND the def's names must be unique within the subtree. Violation → `rejectedAmbiguous += 1`, skip group.
6. **Override computation + losslessness gate:** def = deep clone of the first member. For each member, walk def↔member descendant pairs in pre-order: differing `characters` (text) or `fill` (text/shape) go into `overrides[name]`. Then **re-expand**: clone the def, set `x`/`y` from the member root, apply the member's overrides by name walk, and `stable()`-compare against the original member subtree. ANY member mismatching → `rejectedLossy += 1`, skip the whole group.
7. **Rewrite** (on a structural clone of the spec — input never mutated): register `components["comp-" + n] = { name: firstMember.name, width, height, ...optional layout/sizing/fill/cornerRadius/effects, children }` (the def minus `x`/`y`); replace each member in its parent's `children` array with `{ type: "component-instance", name: member.name, component: id, x: member.x, y: member.y, ...(overrides when non-empty) }`. Mark all member-descendants replaced (step 4). `stats.components += 1`, `stats.instances += members.length`.

- [ ] **Step 1: Write the failing tests**

Create `packages/uxfactory-cli/test/extract-componentize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validate } from "@uxfactory/spec";
import type { DesignSpec, Frame, ComponentInstanceNode } from "@uxfactory/spec";
import { componentize } from "../src/extract/componentize.js";

/** A card frame with a text child — the canonical repeating unit. */
const card = (name: string, x: number, y: number, chars: string, fill = "#111827"): Frame => ({
  name, x, y, width: 200, height: 80, fill: "#FFFFFF", cornerRadius: 8,
  children: [
    { type: "text", name: "label", x: 16, y: 16, width: 168, height: 24, characters: chars, fill },
  ],
});

const view = (name: string, children: Frame["children"]): Frame =>
  ({ name, x: 0, y: 0, width: 390, height: 844, children });

describe("componentize", () => {
  it("groups identical cards across views into one def + instances with overrides", () => {
    const spec: DesignSpec = { frames: [
      view("a.html/v1", [card("div.card", 20, 20, "First")]),
      view("b.html/v1", [card("div.card", 20, 100, "Second", "#0B4E45")]),
    ] };
    const { spec: out, stats } = componentize(spec);
    expect(validate(out).valid).toBe(true);
    expect(stats).toMatchObject({ components: 1, instances: 2, rejectedAmbiguous: 0, rejectedLossy: 0 });
    expect(Object.keys(out.components!)).toEqual(["comp-1"]);
    const def = out.components!["comp-1"]!;
    expect(def.name).toBe("div.card");
    expect(def.width).toBe(200);
    expect((def as { x?: number }).x).toBeUndefined();          // defs carry no position
    const inst1 = (out.frames[0]!.children![0]) as ComponentInstanceNode;
    expect(inst1.type).toBe("component-instance");
    expect(inst1.component).toBe("comp-1");
    expect(inst1.overrides).toBeUndefined();                     // first member IS the def — no diffs
    const inst2 = (out.frames[1]!.children![0]) as ComponentInstanceNode;
    expect(inst2.x).toBe(20); expect(inst2.y).toBe(100);
    expect(inst2.overrides).toEqual({ label: { characters: "Second", fill: "#0B4E45" } });
  });

  it("does not componentize single occurrences or size-differing lookalikes", () => {
    const small = card("div.card", 20, 20, "A");
    const wide: Frame = { ...card("div.card", 20, 120, "B"), width: 240 };
    const spec: DesignSpec = { frames: [view("a/v", [small, wide])] };
    const { spec: out, stats } = componentize(spec);
    expect(stats.components).toBe(0);
    expect(out.components).toBeUndefined();
    expect(out.frames[0]!.children!.every((c) => !("type" in c && c.type === "component-instance"))).toBe(true);
  });

  it("rejects ambiguous groups (duplicate descendant names) and counts them", () => {
    const twin = (x: number): Frame => ({
      name: "div.row", x, y: 0, width: 200, height: 40,
      children: [
        { type: "shape", name: "dot", x: 0, y: 0, width: 8, height: 8 },
        { type: "shape", name: "dot", x: 12, y: 0, width: 8, height: 8 },   // duplicate name
      ],
    });
    const spec: DesignSpec = { frames: [view("a/v", [twin(0), twin(220)])] };
    const { stats } = componentize(spec);
    expect(stats).toMatchObject({ components: 0, rejectedAmbiguous: 1 });
  });

  it("outermost-wins: a repeat nested inside a componentized subtree is not doubly extracted", () => {
    const badge: Frame = { name: "div.badge", x: 8, y: 8, width: 40, height: 16,
      children: [{ type: "text", name: "t", x: 2, y: 2, width: 36, height: 12, characters: "New" }] };
    const tile = (x: number): Frame => ({ name: "div.tile", x, y: 0, width: 120, height: 120,
      children: [structuredClone(badge)] });
    const spec: DesignSpec = { frames: [view("a/v", [tile(0), tile(140)])] };
    const { spec: out, stats } = componentize(spec);
    expect(stats.components).toBe(1);                            // the tile, not the badge
    expect(out.components!["comp-1"]!.name).toBe("div.tile");
    // the def's internals keep the badge as a plain frame
    expect((out.components!["comp-1"]!.children![0] as Frame).name).toBe("div.badge");
  });

  it("is pure and deterministic", () => {
    const spec: DesignSpec = { frames: [
      view("a/v1", [card("div.card", 0, 0, "X")]), view("a/v2", [card("div.card", 0, 0, "Y")]),
    ] };
    const before = JSON.stringify(spec);
    const one = componentize(spec);
    const two = componentize(spec);
    expect(JSON.stringify(spec)).toBe(before);                   // input not mutated
    expect(one).toEqual(two);
  });
});
```

Also add a `rejectedLossy` case: two frames whose fingerprints collide but a NON-overridable field differs at expansion time is impossible by construction (the fingerprint covers all non-overridable fields) — so instead test the honest lossy path: differing `stroke` on a shape descendant lands in the fingerprint → different groups → no componentization (`components: 0`), and assert `rejectedLossy` stays 0. Add:

```ts
  it("keeps non-overridable differences apart via the fingerprint (no lossy rewrite possible)", () => {
    const a = card("div.card", 0, 0, "Same");
    const b = card("div.card", 0, 120, "Same");
    (b.children![0] as { opacity?: number }).opacity = 0.5;      // non-overridable diff
    const spec: DesignSpec = { frames: [view("a/v", [a, b])] };
    const { stats } = componentize(spec);
    expect(stats.components).toBe(0);
    expect(stats.rejectedLossy).toBe(0);
  });
```

(The losslessness re-expansion gate remains in the code as defense-in-depth; `rejectedLossy` counts any future divergence between fingerprint and expansion.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-componentize.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/extract/componentize.ts`**

```ts
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
      fontSize: (node as { fontSize?: number }).fontSize,
      fontWeight: (node as { fontWeight?: number }).fontWeight,
      fontFamily: (node as { fontFamily?: string }).fontFamily,
      lineHeight: (node as { lineHeight?: number }).lineHeight,
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

/** Pre-order descendant nodes (root excluded), paired with names. */
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-componentize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm -r build` — green.

```bash
git add packages/uxfactory-cli/src/extract/componentize.ts packages/uxfactory-cli/test/extract-componentize.test.ts
git commit -m "feat(cli): lossless cross-view component detection (SP3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extract CLI wiring — componentize by default, `--no-components`, per-view component subsets

**Files:**
- Modify: `packages/uxfactory-cli/src/commands/extract.ts`
- Modify: `packages/uxfactory-cli/src/cli.ts` (add `--no-components` to the extract registration)
- Test: `packages/uxfactory-cli/test/extract-cli.test.ts`

**Interfaces:**
- Consumes: `componentize`/`ComponentizeStats` (Task 2).
- Produces: `ExtractFlags` gains `components?: boolean` (default true; commander's `--no-components` sets false). `--json` summary gains `componentize: ComponentizeStats | null` (null when disabled). Per-view files include the `components` subset their frame references.

- [ ] **Step 1: Write the failing tests**

Append to `test/extract-cli.test.ts` (reuse the existing harness; the canned `domTree` needs a repeating frame — extend `snap` or add a new fixture):

```ts
  it("componentizes by default and scopes per-view component subsets", async () => {
    const io = makeIO();
    const cardTree = (chars: string) => node({
      tag: "div", sel: "div.card", bbox: { x: 20, y: 20, width: 200, height: 80 },
      styles: { ...node({ tag: "div" }).styles, backgroundColor: "rgb(255, 255, 255)" },
      children: [node({ tag: "span", sel: "span.label", bbox: { x: 36, y: 36, width: 100, height: 20 }, text: chars })],
    });
    const treeFor = (chars: string) => node({
      tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 }, children: [cardTree(chars)] });
    const snapWithTree = (view: string, chars: string): RenderSnapshot => ({
      ...snap(view), domTree: treeFor(chars) });
    const code = await extractCmd(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root }, io,
      { renderViews: async () => [snapWithTree("success", "Done"), snapWithTree("error", "Failed")] },
    );
    expect(code).toBe(EXIT.OK);
    const combined = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/designspec/design.designspec.json"), "utf8"));
    expect(validate(combined).valid).toBe(true);
    expect(Object.keys(combined.components ?? {})).toEqual(["comp-1"]);
    const perView = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/designspec/checkout-success.designspec.json"), "utf8"));
    expect(validate(perView).valid).toBe(true);
    expect(Object.keys(perView.components ?? {})).toEqual(["comp-1"]);   // subset carried
    const summary = JSON.parse(io.outText().trim().split("\n").at(-1)!);
    expect(summary.componentize).toMatchObject({ components: 1, instances: 2 });
  });

  it("--no-components disables detection", async () => {
    const io = makeIO();
    const code = await extractCmd(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, components: false }, io,
      { renderViews: async () => [snap("success"), snap("error")] },
    );
    expect(code).toBe(EXIT.OK);
    const combined = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/designspec/design.designspec.json"), "utf8"));
    expect(combined.components).toBeUndefined();
    const summary = JSON.parse(io.outText().trim().split("\n").at(-1)!);
    expect(summary.componentize).toBeNull();
  });
```

(If the existing test file's `io` helper name differs, match it. `node` comes from `./extract-fixtures.js`.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-cli.test.ts`
Expected: the two new tests FAIL (`componentize` missing from summary/flags).

- [ ] **Step 3: Implement**

In `commands/extract.ts`: add `components?: boolean` to `ExtractFlags`. After assembling `{ spec, stats }` and BEFORE `validate()`:

```ts
  let compStats: ComponentizeStats | null = null;
  let finalSpec = spec;
  if (flags.components !== false) {
    const result = componentize(spec);
    finalSpec = result.spec;
    compStats = result.stats;
  }
```

Validate + write `finalSpec` everywhere `spec` was used. Per-view files: collect the component ids referenced by that frame (recursive walk for `type === "component-instance"`), and include `components` subset when non-empty:

```ts
  const refs = new Set<string>();
  const collectRefs = (c: FrameChild): void => {
    if ("type" in c && c.type === "component-instance") refs.add((c as ComponentInstanceNode).component);
    if (!("type" in c)) for (const cc of (c as Frame).children ?? []) collectRefs(cc);
  };
  for (const c of frame.children ?? []) collectRefs(c);
  const single: DesignSpec = {
    frames: [{ ...frame, x: 0 }],
    ...(refs.size > 0
      ? { components: Object.fromEntries([...refs].map((id) => [id, finalSpec.components![id]!])) }
      : {}),
  };
```

`--json` summary gains `componentize: compStats`. In `cli.ts`, add `.option("--no-components", "skip component detection")` to the extract registration and pass `components: opts.components` through (commander sets `opts.components === false` for `--no-components`, `undefined`/`true` otherwise).

- [ ] **Step 4: Run to verify green + full extractor suite + commit**

Run: `pnpm --filter @uxfactory/cli exec vitest run test/extract-cli.test.ts test/extract-componentize.test.ts test/extract-structure.test.ts test/extract-style.test.ts test/extract-layout.test.ts test/extract-selfcheck.test.ts`, then `pnpm -r build`.

```bash
git add packages/uxfactory-cli/src/commands/extract.ts packages/uxfactory-cli/src/cli.ts packages/uxfactory-cli/test/extract-cli.test.ts
git commit -m "feat(cli): extract componentizes by default; per-view component subsets (SP3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Typography model — TextNode font fields (spec types + schema)

**Files:**
- Modify: `packages/uxfactory-spec/src/types.ts`, `packages/uxfactory-spec/schema/uxfactory.schema.json`
- Test: `packages/uxfactory-spec/test/cases.ts`

**Interfaces:**
- Produces: `TextNode` gains `fontSize?: number; fontWeight?: number; fontFamily?: string; lineHeight?: number;` — mirrored in the schema's `textNode` definition (`fontSize`/`lineHeight`: `{"type":"number","exclusiveMinimum":0}`; `fontWeight`: `{"type":"number","minimum":1,"maximum":1000}`; `fontFamily`: `{"type":"string","minLength":1}`). All optional/additive; `additionalProperties:false` stays.

- [ ] **Step 1: Failing fixtures** — append to `cases.ts`:

```ts
  {
    name: "text node with typography fields",
    valid: true,
    input: { frames: [{ name: "f", x: 0, y: 0, width: 100, height: 100, children: [
      { type: "text", name: "h1", x: 0, y: 0, width: 90, height: 30, characters: "Hi",
        fontSize: 24, fontWeight: 700, fontFamily: "Fraunces", lineHeight: 32 },
    ] }] },
  },
  {
    name: "invalid fontWeight is rejected",
    valid: false,
    input: { frames: [{ name: "f", x: 0, y: 0, width: 100, height: 100, children: [
      { type: "text", name: "t", x: 0, y: 0, width: 90, height: 30, characters: "Hi", fontWeight: 0 },
    ] }] },
  },
```

- [ ] **Step 2: Verify fail** — `pnpm --filter @uxfactory/spec test` (first case rejected — unknown keys).
- [ ] **Step 3: Add the four fields to `TextNode` (types) and `textNode` (schema) exactly as in Interfaces.**
- [ ] **Step 4: Verify pass + `pnpm -r build` green.** (The plugin typecheck may stay green — the fields are optional and unconsumed until Task 6.)
- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-spec/src/types.ts packages/uxfactory-spec/schema/uxfactory.schema.json packages/uxfactory-spec/test/cases.ts
git commit -m "feat(spec): TextNode typography fields (SP3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Typography capture + emission (extractor)

**Files:**
- Modify: `packages/uxfactory-cli/src/render/dom-capture.ts` (4 style keys), `packages/uxfactory-cli/src/extract/dom-to-designspec.ts` (emit on TextNodes), `packages/uxfactory-cli/test/extract-fixtures.ts` (defaults)
- Test: `packages/uxfactory-cli/test/extract-structure.test.ts` (extend), `packages/uxfactory-cli/test/dom-capture.test.ts` (keys)

**Interfaces:**
- Consumes: Task 4 model fields.
- Produces: `CapturedStyles` gains `fontSize: string; fontWeight: string; fontFamily: string; lineHeight: string;` (and `EXTRACT_FN`'s `STYLE_KEYS` gains the same four — keep interface↔STYLE_KEYS exactly in sync); the assembler emits `fontSize`/`fontWeight` (via `px`), `fontFamily` (first comma token, quotes stripped), `lineHeight` (px number; computed `"normal"` → omit) on every emitted `TextNode` (text leaves and `#text` runs alike).

- [ ] **Step 1: Failing tests.** In `extract-fixtures.ts`, add the four defaults to `node()`'s styles: `fontSize: "16px", fontWeight: "400", fontFamily: "Inter, sans-serif", lineHeight: "24px",`. In `extract-structure.test.ts` append:

```ts
  it("emits typography on text nodes", () => {
    const h1 = node({ tag: "h1", bbox: { x: 0, y: 0, width: 200, height: 40 }, text: "Title",
      styles: { ...node({ tag: "h1" }).styles, fontSize: "28px", fontWeight: "700",
        fontFamily: '"Fraunces", serif', lineHeight: "36px" } });
    const body = node({ tag: "body", bbox: { x: 0, y: 0, width: 390, height: 844 }, children: [h1] });
    const { spec } = extractDesignSpec([view(body)]);
    const t = spec.frames[0]!.children![0] as TextNode;
    expect(t).toMatchObject({ fontSize: 28, fontWeight: 700, fontFamily: "Fraunces", lineHeight: 36 });
  });
```

In `dom-capture.test.ts` add to the parse test: `expect(EXTRACT_FN).toContain("fontFamily");`

- [ ] **Step 2: Verify fail** (styles unknown / fields not emitted).
- [ ] **Step 3: Implement** — add the 4 keys to `CapturedStyles` AND the in-page `STYLE_KEYS` array; in the assembler's text paths (both `#text` and text-leaf), after the fill wiring:

```ts
  const fs = px(n.styles.fontSize); if (fs > 0) text.fontSize = fs;
  const fw = px(n.styles.fontWeight); if (fw > 0) text.fontWeight = fw;
  const fam = n.styles.fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  if (fam) text.fontFamily = fam;
  const lh = px(n.styles.lineHeight); if (lh > 0) text.lineHeight = lh;   // "normal" → px()=0 → omitted
```

(Factor into a small `applyTypography(text, styles)` used by both paths.)

- [ ] **Step 4: Verify** — extractor suite green; **rerun the real-browser test** (`test/dom-capture-real.test.ts`) since EXTRACT_FN changed; `pnpm -r build` green.
- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/render/dom-capture.ts packages/uxfactory-cli/src/extract/dom-to-designspec.ts packages/uxfactory-cli/test/extract-fixtures.ts packages/uxfactory-cli/test/extract-structure.test.ts packages/uxfactory-cli/test/dom-capture.test.ts
git commit -m "feat(cli): extractor captures and emits typography (SP3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Typography rendering (plugin) — fail-soft fonts

**Files:**
- Modify: `packages/uxfactory-plugin/src/planner.ts` (carry 4 fields), `packages/uxfactory-plugin/src/code.ts` (font mapping + application), `packages/uxfactory-plugin/test/figma-mock.ts` (font failure injection + fontSize/lineHeight fields)
- Test: `packages/uxfactory-plugin/test/code.test.ts`, `packages/uxfactory-plugin/test/planner.test.ts`

**Interfaces:**
- Consumes: Task 4 model fields.
- Produces: `PlannedChild` gains `fontSize?/fontWeight?/fontFamily?/lineHeight?` (mapChild passes them through). `code.ts` gains `weightToStyle(w: number): string` (map `300:Light, 400:Regular, 500:Medium, 600:Semi Bold, 700:Bold, 800:Extra Bold`; other values → nearest key at-or-below, floor `Light`) and `loadFontFailSoft(family, style): Promise<{family, style}>` trying `(family, style)` → `(family, "Regular")` → `("Inter", "Regular")`, returning the first that loads. The text branch of `renderChild` uses them: when `child.fontFamily`/`fontWeight` present, load fail-soft, set `node.fontName = loaded`, then `characters`, then `fontSize`, then `lineHeight = { value, unit: "PIXELS" }`. `EditableNode` gains `fontSize?: number; lineHeight?: unknown;` (`fontName` exists). `FakeFigma` gains `failFontKeys: string[]` — `loadFontAsync` rejects when `"family/style"` is listed (recorded in `loadFontAsyncCalls` first).

- [ ] **Step 1: Failing tests.** `planner.test.ts`: extend a text child fixture with the 4 fields and assert the planned child carries them. `code.test.ts`:

```ts
  it("applies typography with a fail-soft font chain", async () => {
    const fig = makeFigma();
    fig.failFontKeys.push("Fraunces/Bold");                     // style load fails → falls to Regular
    await loadCode(fig);
    const spec: DesignSpec = { frames: [{ name: "f", x: 0, y: 0, width: 300, height: 100, children: [
      { type: "text", name: "h1", x: 0, y: 0, width: 200, height: 40, characters: "Title",
        fontSize: 28, fontWeight: 700, fontFamily: "Fraunces", lineHeight: 36 },
    ] }] };
    await fig.__send({ type: "render", spec, jobId: "t1" });
    const f = fig.currentPage.children.find((n) => n.name === "f")!;
    const h1 = f.children.find((n) => n.name === "h1")!;
    expect(fig.loadFontAsyncCalls).toContain("Fraunces/Bold");   // tried
    expect(h1.fontName).toEqual({ family: "Fraunces", style: "Regular" });  // fell back one step
    expect(h1.characters).toBe("Title");
    expect(h1.fontSize).toBe(28);
    expect(h1.lineHeight).toEqual({ value: 36, unit: "PIXELS" });
  });

  it("falls all the way back to Inter and never aborts", async () => {
    const fig = makeFigma();
    fig.failFontKeys.push("Ghost/Regular");                      // both family attempts fail
    await loadCode(fig);
    const spec: DesignSpec = { frames: [{ name: "f", x: 0, y: 0, width: 300, height: 100, children: [
      { type: "text", name: "t", x: 0, y: 0, width: 200, height: 40, characters: "x",
        fontWeight: 400, fontFamily: "Ghost" },
    ] }] };
    await fig.__send({ type: "render", spec, jobId: "t2" });
    const t = fig.currentPage.children.find((n) => n.name === "f")!.children[0]!;
    expect(t.fontName).toEqual({ family: "Inter", style: "Regular" });
    expect(t.characters).toBe("x");
  });
```

Mock changes needed for these to be expressible: `FakeNode` gains `fontSize: number | undefined` and `lineHeight: unknown`; the TEXT node's font-guard keys on the CURRENT `node.fontName` (set by code before characters) rather than the fixed Inter default — adjust `createText` so the guard reads `node.fontName` at set-time and checks `loadedFonts.has(family/style)`; `failFontKeys: string[]` on the returned object; `loadFontAsync` pushes to `loadFontAsyncCalls` then `if (failFontKeys.includes(key)) throw new Error("font unavailable: " + key);` else registers loaded.

- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement** planner carry (4 `if (...) out.X` lines in `mapChild`), the two helpers + text-branch wiring in `code.ts`, and the mock changes. Existing font-less text keeps the current behavior exactly (load `node.fontName ?? Inter Regular`, set characters) — the new path only engages when `fontFamily` or `fontWeight` is present.
- [ ] **Step 4: Gates** — `pnpm --filter @uxfactory/plugin test` all green (197+ + new), `pnpm --filter @uxfactory/plugin typecheck` 0 errors, `pnpm -r build` green.
- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-plugin/src/planner.ts packages/uxfactory-plugin/src/code.ts packages/uxfactory-plugin/test/figma-mock.ts packages/uxfactory-plugin/test/code.test.ts packages/uxfactory-plugin/test/planner.test.ts
git commit -m "feat(plugin): typographic text rendering with fail-soft fonts (SP3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Semantic gate + recursive counts + masters strip (gate + plugin, one commit)

**Files:**
- Modify: `packages/uxfactory-gate/src/internal.ts` (`collectChildren`, `expectedCounts`)
- Modify: `packages/uxfactory-plugin/src/code.ts` (recursive `counts.objects`, masters negative-X strip)
- Test: `packages/uxfactory-gate/test/` (extend the existing gate test file — find it with `ls packages/uxfactory-gate/test/`), `packages/uxfactory-plugin/test/code.test.ts`

**Interfaces:**
- Consumes: the semantic spec model; the plugin's `reportNodes`/`renderContainer` behavior (nested children ARE registered; instances registered as ONE node; masters and their internals NOT registered).
- Produces: `collectChildren(spec)` recurses nested frames — each nested frame contributes ITSELF (name + parent-relative x/y/w/h, matching Figma's parent-relative node coords) AND its descendants; `component-instance` children contribute one entry (their x/y/w?/h?); `spec.components` defs contribute NOTHING. `expectedCounts.objects = collectChildren(spec).length` (unchanged formula — recursion does the work); `frames`/`sections`/`connectors` unchanged. Plugin: `counts.objects` becomes `reportNodes.size`; masters placed at `x = cursor - width; cursor = x - 100` starting `cursor = -100`, `y = 0`.

- [ ] **Step 1: Failing tests.**

Gate (in the existing gate test file, matching its fixture style — read it first):

```ts
  it("counts and gates nested frames and component instances recursively", () => {
    const spec = {
      components: { "comp-1": { name: "card", width: 200, height: 80,
        children: [{ type: "text", name: "label", x: 16, y: 16, width: 100, height: 20, characters: "Hi" }] } },
      frames: [{ name: "view", x: 0, y: 0, width: 390, height: 844, children: [
        { name: "col", x: 10, y: 10, width: 300, height: 400, children: [
          { type: "shape", name: "s1", x: 5, y: 5, width: 50, height: 50 },
        ] },
        { type: "component-instance", name: "card-a", component: "comp-1", x: 20, y: 430 },
      ] }],
    } as unknown as Spec;
    const expected = expectedCounts(spec);
    // objects: col(1) + s1(1) + card-a(1) = 3; the def's internals contribute nothing
    expect(expected).toEqual({ frames: 1, sections: 0, objects: 3, connectors: 0 });
    const children = collectChildren(spec);
    expect(children.map((c) => c.name).sort()).toEqual(["card-a", "col", "s1"]);
    const s1 = children.find((c) => c.name === "s1")!;
    expect(s1.x).toBe(5);                                        // parent-relative, NOT accumulated
  });
```

Plugin (`code.test.ts`):

```ts
  it("reports recursive object counts and places masters off-flow", async () => {
    const fig = makeFigma();
    await loadCode(fig);
    const spec: DesignSpec = {
      components: { b: { name: "Btn", width: 100, height: 40,
        children: [{ type: "text", name: "l", x: 8, y: 8, width: 80, height: 20, characters: "Go" }] } },
      frames: [{ name: "v", x: 0, y: 0, width: 390, height: 400, children: [
        { name: "col", x: 0, y: 0, width: 390, height: 200, children: [
          { type: "shape", name: "s", x: 0, y: 0, width: 10, height: 10 },
        ] },
        { type: "component-instance", name: "go", component: "b", x: 10, y: 210 },
      ] }],
    };
    await fig.__send({ type: "render", spec, jobId: "r1" });
    const rendered = lastOfType(fig, "rendered")!;
    // objects = col + s + go = 3 (recursive; master internals excluded)
    expect(rendered.report.counts.objects).toBe(3);
    const master = fig.currentPage.children.find((n) => n.type === "COMPONENT")!;
    expect(master.x).toBe(-200);                                 // cursor -100 → x = -100 - 100(width)
    expect(master.y).toBe(0);
  });
```

Compute the master-x expectation from the implementation (`cursor = -100; x = cursor - width = -200; cursor = x - 100`) — keep test and code consistent.

Also add a **flat-regression** assertion: the pre-existing legacy test's `counts: { frames: 1, sections: 0, objects: 2, connectors: 1 }` must STILL hold (flat children = same number under recursion). Do not modify that test — if it breaks, your recursion is wrong (e.g. double-counting).

- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement.**

Gate `internal.ts` — replace `collectChildren`'s inner loop with a recursive walk (type it against a minimal structural shape, keeping the package decoupled from `@uxfactory/spec` internals as it is today):

```ts
type AnyChild = { name: string; x: number; y: number; width?: number; height?: number; type?: string; children?: AnyChild[] };

function walkChildren(children: AnyChild[], out: SpecChild[]): void {
  for (const child of children) {
    out.push({ name: child.name, x: child.x, y: child.y, width: child.width, height: child.height });
    if (child.type === undefined && Array.isArray(child.children)) walkChildren(child.children, out);
  }
}
```

(`type === undefined` = nested frame → recurse; `component-instance` has a `type` → one entry, no recursion; `components` defs are never visited — only `frames`/`sections` are walked.) `expectedCounts` is unchanged textually (it calls `collectChildren`).

Plugin `code.ts`: `objects: reportNodes.size` replaces the two `reduce` lines (sections' children are registered in `reportNodes` too — verify the section loop still registers each child; it does). Masters strip in the component loop:

```ts
      let masterCursor = -100;
      // inside the loop, after applyAutoLayout(master, ...):
      master.x = masterCursor - masterWidth;   // masterWidth = def.width
      master.y = 0;
      masterCursor = master.x - 100;
```

- [ ] **Step 4: Gates** — `pnpm --filter @uxfactory/gate test`, `pnpm --filter @uxfactory/plugin test` (ALL existing tests green — the flat legacy counts test is the canary), `pnpm --filter @uxfactory/plugin typecheck`, `pnpm -r build`.
- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-gate/src/internal.ts packages/uxfactory-plugin/src/code.ts packages/uxfactory-gate/test packages/uxfactory-plugin/test/code.test.ts
git commit -m "feat(gate,plugin): recursive semantic counts/presence/geometry; masters off-flow (SP3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Loop landing — skill Step 4c + worker publish/verify

**Files:**
- Modify: `skill/design/SKILL.md` (new Step 4c + report line)
- Create: `clients/uxfactory-worker/src/landing.ts`
- Modify: `clients/uxfactory-worker/src/generative.ts` (call landing after clean generate-design; append extract instruction to the user prompt)
- Test: `clients/uxfactory-worker/test/landing.test.ts` (new), `clients/uxfactory-worker/test/design-skill.test.ts` + `packages/uxfactory-cli/test/skill-design.test.ts` (Step 4c assertions — read what they assert today and extend in kind)

**Interfaces:**
- Produces (`landing.ts`):

```ts
export interface LandingVerdict { view: string; file: string; published: boolean; verify: "pass" | "fail" | "pending" | "skipped"; detail?: string; }
export interface LandingResult { published: string[]; verdicts: LandingVerdict[]; }
export interface LandingDeps { exec: (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string }>; }
export async function landDesign(projectRoot: string, bridgeDataDir: string, deps: LandingDeps): Promise<LandingResult | null>;
```

Behavior: glob `<projectRoot>/.uxfactory/batch/designspec/*.designspec.json` excluding `design.designspec.json`; none → return `null` (no landing block). For each file run `deps.exec("uxfactory", ["publish", file, "--verify", "--json", "--data-dir", bridgeDataDir], 70_000)`; parse the last stdout JSON line → verdict `pass`/`fail`; non-zero exit or timeout or unparseable → `published: true, verify: "pending"` (publish's fast-path enqueue happens before the wait, so timeout still means queued), `detail` = trimmed last line. NEVER throws — any per-file error becomes a `pending`/`skipped` verdict. (Check `publish`'s actual flags in `packages/uxfactory-cli/src/commands/publish.ts` / its cli.ts registration before coding — `--verify`, `--json`, `--data-dir`, and the wait timeout flag name; if publish's wait timeout is configurable, pass 60000, else rely on the 70s exec kill.)
- `generative.ts`: in `runGenerative`, for `req.kind === 'generate-design'` after the stream completes cleanly (status 0 path), call `landDesign(ctx.projectRoot, ctx.bridgeDataDir ?? path.resolve('.uxfactory'), realExecDeps)`, attach non-null results as `result.landing`, and emit one `progress` event `{ phase: "landing", note: "<n> published, <m> verified" }` via the existing event path. `DispatchCtx` gains optional `bridgeDataDir?: string` (default cwd `.uxfactory` — worker and bridge are co-located in current deployments; document this). A landing failure NEVER changes `status`.
- `skill/design/SKILL.md`: new **Step 4c — Extract for Figma landing** between Step 4b and Step 5: after green AND craft-pass, run `uxfactory extract --json design`; report the stats line; emit `UXF::PROGRESS {"phase":"extract",...}`; on exit 1/2 report the failure in the final summary and finish normally (the screens remain the deliverable — extraction never retracts them). Update the Report section to mention the designspec outputs. In `generative.ts`'s generate-design user prompt, append: `"After the craft bar is met (or the budget is spent with the gate green), run \`uxfactory extract --json design\` once and report its stats line (phase \"extract\")."`

- [ ] **Step 1: Failing tests.**

`landing.test.ts` (worker) — fake exec:

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { landDesign } from "../src/landing.js";

const mkProject = async (files: string[]): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uxf-landing-"));
  const dir = path.join(root, ".uxfactory/batch/designspec");
  await mkdir(dir, { recursive: true });
  for (const f of files) await writeFile(path.join(dir, f), JSON.stringify({ frames: [] }));
  return root;
};

describe("landDesign", () => {
  it("publishes each per-view spec and parses verify verdicts", async () => {
    const root = await mkProject(["design.designspec.json", "checkout-success.designspec.json", "cart-empty.designspec.json"]);
    const calls: string[][] = [];
    const res = await landDesign(root, "/bridge/.uxfactory", {
      exec: async (_cmd, args) => { calls.push(args); return { code: 0, stdout: '{"verified":true,"gate":"pass"}' }; },
    });
    expect(res!.published).toHaveLength(2);                       // combined file excluded
    expect(res!.verdicts.every((v) => v.verify === "pass")).toBe(true);
    expect(calls[0]).toContain("--verify");
    expect(calls[0]).toContain("--data-dir");
  });

  it("maps timeout/non-zero to pending and never throws", async () => {
    const root = await mkProject(["checkout-success.designspec.json"]);
    const res = await landDesign(root, "/b", { exec: async () => { throw new Error("timeout"); } });
    expect(res!.verdicts[0]!.verify).toBe("pending");
  });

  it("returns null when no designspec outputs exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "uxf-landing-empty-"));
    expect(await landDesign(root, "/b", { exec: async () => ({ code: 0, stdout: "" }) })).toBeNull();
  });
});
```

(Adjust the pass-verdict parsing assertion to whatever `publish --verify --json` actually prints — READ `publish.ts`'s json output shape first and encode the real key in both code and test.)

Skill tests: extend `design-skill.test.ts` (worker) and `skill-design.test.ts` (cli) with assertions that the SKILL text contains `uxfactory extract --json design`, `"phase":"extract"` (or `phase":"extract`), and "Step 4c" — matching each file's existing assertion style.

- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement** `landing.ts`, the `generative.ts` wiring (+ prompt sentence), and the SKILL.md Step 4c (with the exact command, progress line, failure semantics, and report addition).
- [ ] **Step 4: Gates** — worker suite (`pnpm --filter <worker package name> test`) green; `pnpm --filter @uxfactory/cli exec vitest run test/skill-design.test.ts` green; `pnpm -r build` green.
- [ ] **Step 5: Commit**

```bash
git add skill/design/SKILL.md clients/uxfactory-worker/src/landing.ts clients/uxfactory-worker/src/generative.ts clients/uxfactory-worker/test/landing.test.ts clients/uxfactory-worker/test/design-skill.test.ts packages/uxfactory-cli/test/skill-design.test.ts
git commit -m "feat(worker,skill): automated Figma landing — extract, publish, bounded verify (SP3c)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Live E2E landing proof (controller-run — no subagent)

The session controller runs this live with the user (mirrors SP2 Task 7 / the SP3b live proof):

- [ ] **Step 1:** `pnpm -r build`; rerun `uxfactory extract --json design` on the Meridian project (`live-project` in the session scratchpad) — now with componentize; record stats (expect `componentize.components >= 1` if the design repeats units; honest zero otherwise).
- [ ] **Step 2:** Start the bridge; publish per-view specs with `--verify --json`; ask the user to open the UXFactory plugin in Figma.
- [ ] **Step 3:** Confirm: components land as masters on the negative-X strip + instances in the frames; text lands typographically; `verify` verdicts green (counts/presence/geometry via the recursive gate).
- [ ] **Step 4:** Copy proof artifacts (componentized designspecs + verify verdicts + a screenshot if provided) to `docs/proofs/sp3c-live-landing/` with a README (provenance + stats + verdicts); commit + push on the user's go.

---

## Notes for the implementer

- **Read before coding:** `packages/uxfactory-gate/test/` layout (Task 7 test placement); `publish.ts` `--verify --json` output shape + wait/timeout flags (Task 8); the worker package `name` in `clients/uxfactory-worker/package.json`; existing skill-test assertion styles (Task 8).
- **`componentize` runs BEFORE `validate()`** in the extract command — the componentized spec is what gets self-gated and written.
- **Frame discriminant:** `!("type" in c)` identifies nested frames — `component-instance` nodes carry `type`, so post-componentize specs walk correctly everywhere (gate, per-view subsets, plugin planner).
- **Do not renumber** existing SKILL.md steps — insert Step 4c between 4b and 5.
- **Worker/bridge co-location** is an explicit v1 assumption for `--data-dir` — document it in `landing.ts`'s header comment.

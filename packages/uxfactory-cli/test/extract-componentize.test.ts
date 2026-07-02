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

  it("keeps non-overridable differences apart via the fingerprint (no lossy rewrite possible)", () => {
    const a = card("div.card", 0, 0, "Same");
    const b = card("div.card", 0, 120, "Same");
    (b.children![0] as { opacity?: number }).opacity = 0.5;      // non-overridable diff
    const spec: DesignSpec = { frames: [view("a/v", [a, b])] };
    const { stats } = componentize(spec);
    expect(stats.components).toBe(0);
    expect(stats.rejectedLossy).toBe(0);
  });
});

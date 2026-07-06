/**
 * artifact-elicitation.test.ts — the elicitation doc's discipline as tests.
 */
import { describe, it, expect } from "vitest";
import { ARTIFACT_ELICITATION } from "../src/artifact-elicitation.js";
import { ARTIFACT_REGISTRY } from "../src/component-type-mapping.js";

describe("elicitation discipline", () => {
  it("every REGISTERED artifact has an elicitation entry (possibly empty)", () => {
    for (const [id, entry] of Object.entries(ARTIFACT_REGISTRY)) {
      if (entry.status !== "registered") continue;
      expect(ARTIFACT_ELICITATION[id], id).toBeDefined();
    }
  });

  it("every elicitation key is a registry artifact", () => {
    for (const id of Object.keys(ARTIFACT_ELICITATION)) {
      expect(ARTIFACT_REGISTRY[id], id).toBeDefined();
    }
  });

  it("rule 5: no interview exceeds five [E] questions", () => {
    for (const [id, questions] of Object.entries(ARTIFACT_ELICITATION)) {
      const eCount = questions.filter((q) => q.tag === "E").length;
      expect(eCount, `${id} has ${eCount} [E] questions`).toBeLessThanOrEqual(5);
    }
  });

  it("[F] questions always carry a default; question ids are unique per artifact", () => {
    for (const [id, questions] of Object.entries(ARTIFACT_ELICITATION)) {
      const ids = questions.map((q) => q.id);
      expect(new Set(ids).size, id).toBe(ids.length);
      for (const q of questions) {
        if (q.tag === "F") expect(q.defaultValue, `${id}.${q.id}`).toBeTruthy();
      }
    }
  });

  it("no-interview artifacts stay guidance-only (requirements, tokens)", () => {
    expect(ARTIFACT_ELICITATION["acceptance-criteria"]).toEqual([]);
    expect(ARTIFACT_ELICITATION["tokens"]).toEqual([]);
  });

  it("stories interview: per-story want/so-that/ACs [E] + checkable [F] (decision 6)", () => {
    const questions = ARTIFACT_ELICITATION["stories"]!;
    // [D] questions (actor from personas, feature assignment) are the
    // resolver's job and never encoded — only the E/F residue appears.
    expect(questions.filter((q) => q.tag === "E").map((q) => q.id)).toEqual([
      "want", "so-that", "acceptance",
    ]);
    const checkable = questions.find((q) => q.id === "checkable")!;
    expect(checkable.tag).toBe("F");
    expect(checkable.defaultValue).toMatch(/auto/);
  });
});

// ─── Prerequisite chaining ────────────────────────────────────────────────────

import { ARTIFACT_PREREQS, resolveCreationChain } from "../src/artifact-elicitation.js";

describe("prerequisite chaining", () => {
  it("every prereq id is a registry artifact; registered artifacts only chain to registered ones", () => {
    for (const [id, deps] of Object.entries(ARTIFACT_PREREQS)) {
      expect(ARTIFACT_REGISTRY[id], id).toBeDefined();
      for (const dep of deps) {
        expect(ARTIFACT_REGISTRY[dep], `${id} → ${dep}`).toBeDefined();
        if (ARTIFACT_REGISTRY[id]!.status === "registered") {
          expect(ARTIFACT_REGISTRY[dep]!.status, `${id} → ${dep} must be creatable`).toBe("registered");
        }
      }
    }
  });

  it("chains missing prerequisites in dependency order, target last", () => {
    const missing = (id: string) => ["flows", "sitemap", "acceptance-criteria"].includes(id);
    expect(resolveCreationChain("flows", missing)).toEqual([
      "acceptance-criteria", "sitemap", "flows",
    ]);
  });

  it("satisfied prerequisites do not chain", () => {
    const missing = (id: string) => id === "flows";
    expect(resolveCreationChain("flows", missing)).toEqual(["flows"]);
  });

  it("transitive chains dedupe shared prerequisites", () => {
    const missing = () => true;
    // tokens → colors, palettes (→ colors), typography (→ fonts), grid.
    expect(resolveCreationChain("tokens", missing)).toEqual([
      "brand-colors", "palettes", "fonts", "typography", "grid", "tokens",
    ]);
  });

  it("artifacts without prereqs resolve to themselves", () => {
    expect(resolveCreationChain("brief", () => true)).toEqual(["brief"]);
  });
});

// ─── Authoring order ──────────────────────────────────────────────────────────

import { AUTHORING_ORDER } from "../src/artifact-elicitation.js";

describe("authoring order", () => {
  it("covers every registry artifact exactly once", () => {
    expect([...AUTHORING_ORDER].sort()).toEqual(Object.keys(ARTIFACT_REGISTRY).sort());
  });

  it("respects every hard prerequisite edge (prereq strictly earlier)", () => {
    const index = new Map(AUTHORING_ORDER.map((id, i) => [id, i]));
    for (const [id, deps] of Object.entries(ARTIFACT_PREREQS)) {
      for (const dep of deps) {
        expect(index.get(dep)!, `${dep} must precede ${id}`).toBeLessThan(index.get(id)!);
      }
    }
  });
});

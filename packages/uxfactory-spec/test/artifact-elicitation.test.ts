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
    // tokens → brand-colors, palettes (→ brand-colors), grid — brand-colors once.
    expect(resolveCreationChain("tokens", missing)).toEqual([
      "brand-colors", "palettes", "grid", "tokens",
    ]);
  });

  it("artifacts without prereqs resolve to themselves", () => {
    expect(resolveCreationChain("brief", () => true)).toEqual(["brief"]);
  });
});

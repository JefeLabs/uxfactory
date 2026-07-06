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

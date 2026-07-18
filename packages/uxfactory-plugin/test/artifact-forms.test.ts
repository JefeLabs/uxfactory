import { describe, it, expect } from "vitest";
import { formSpecFor } from "../ui/lib/artifact-forms.js";

describe("personas field spec", () => {
  it("models one persona's fields (goals/frustrations as chips, context as object)", () => {
    const spec = formSpecFor("personas");
    expect(spec).toBeDefined();
    const keys = spec!.fields.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(["name", "archetype", "segmentRef", "goals", "frustrations", "context", "quote"]),
    );
    const goals = spec!.fields.find((f) => f.key === "goals")!;
    expect(goals.kind).toBe("chips");
    const context = spec!.fields.find((f) => f.key === "context")!;
    expect(context.kind).toBe("object");
    // personaId is server-owned — must NOT be an editable field
    expect(keys).not.toContain("personaId");
  });
});

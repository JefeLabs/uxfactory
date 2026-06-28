import { describe, it, expect } from "vitest";
import { UndoStack } from "../src/undo-stack.js";
import type { Edit } from "@uxfactory/spec";

const edit = (n: number): Edit => ({ id: `n_${n}`, set: { x: n } });

describe("UndoStack", () => {
  it("pops nothing when empty", () => {
    const s = new UndoStack();
    expect(s.size).toBe(0);
    expect(s.pop()).toBeUndefined();
  });

  it("pops LIFO", () => {
    const s = new UndoStack();
    s.push(edit(1));
    s.push(edit(2));
    expect(s.pop()?.id).toBe("n_2");
    expect(s.pop()?.id).toBe("n_1");
  });

  it("caps at 50, evicting the oldest", () => {
    const s = new UndoStack();
    for (let i = 0; i <= 50; i++) s.push(edit(i)); // 51 pushes (0..50)
    expect(s.size).toBe(50);
    expect(s.pop()?.id).toBe("n_50"); // newest stays
    // drain to the bottom; n_0 was evicted so the oldest survivor is n_1
    let last: Edit | undefined;
    while (s.size > 0) last = s.pop();
    expect(last?.id).toBe("n_1");
  });
});

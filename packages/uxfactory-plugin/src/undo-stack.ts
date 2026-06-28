import type { Edit } from "@uxfactory/spec";

/**
 * A bounded LIFO stack of inverse edits. Capped at 50; the oldest entry is
 * evicted on overflow. Applying an undo must NOT push its own inverse — that
 * is the caller's responsibility (no "redo via undo" loop).
 */
export class UndoStack {
  readonly cap = 50;
  #items: Edit[] = [];

  push(inverse: Edit): void {
    this.#items.push(inverse);
    if (this.#items.length > this.cap) this.#items.shift();
  }

  pop(): Edit | undefined {
    return this.#items.pop();
  }

  get size(): number {
    return this.#items.length;
  }
}

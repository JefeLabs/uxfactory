import type { Edit, EditSet } from "@uxfactory/spec";

/**
 * Plan a single edit. When the target is missing the edit is a no-op
 * (skipped, never an error); otherwise `props` is exactly the `set` entries
 * to apply — nothing else is touched.
 */
export function planEdit(
  edit: Edit,
  present: boolean,
): { apply: boolean; props: Partial<EditSet> } {
  if (!present) return { apply: false, props: {} };
  return { apply: true, props: { ...edit.set } };
}

/**
 * Capture the inverse of a forward edit: an edit targeting by the SAME node
 * `id` (never name — a forward edit may rename the node) whose `set` holds the
 * before-values of exactly the properties the forward edit changes. The caller
 * passes an edit already resolved to the concrete node id.
 */
export function captureInverse(edit: Edit, before: Record<string, unknown>): Edit {
  const set: Record<string, unknown> = {};
  for (const key of Object.keys(edit.set)) {
    set[key] = before[key];
  }
  const inverse: Edit = { set: set as EditSet };
  if (edit.id !== undefined) inverse.id = edit.id;
  return inverse;
}

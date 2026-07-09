/**
 * worker-coverage — pure truth table for "is a live worker claiming this job
 * kind?" (spec 2026-07-09-worker-liveness). `null` means UNKNOWN (no snapshot
 * yet, or a bridge older than the workers field) and must never warn.
 */
import type { WorkerPresenceEntry } from "./bridge.js";

export type WorkerCoverage = "covered" | "uncovered" | "unknown";

/** The job kinds this panel can enqueue. Extend when the panel gains new kinds. */
export const ENQUEUEABLE_KINDS = ["generate-artifact", "generate-design"] as const;

export function coverageFor(
  workers: WorkerPresenceEntry[] | null,
  kind: string,
): WorkerCoverage {
  if (workers === null) return "unknown";
  const covered = workers.some((w) => w.kinds === undefined || w.kinds.includes(kind));
  return covered ? "covered" : "uncovered";
}

/** True when ANY enqueueable kind is uncovered (drives the ContextBar dot + banner re-arm). */
export function anyUncovered(workers: WorkerPresenceEntry[] | null): boolean {
  return ENQUEUEABLE_KINDS.some((k) => coverageFor(workers, k) === "uncovered");
}

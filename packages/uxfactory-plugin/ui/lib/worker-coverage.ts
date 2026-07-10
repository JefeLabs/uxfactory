/**
 * worker-coverage — pure truth table for "is a live worker claiming this job
 * kind?" (spec 2026-07-09-worker-liveness). `null` means UNKNOWN (no snapshot
 * yet, or a bridge older than the workers field) and must never warn.
 *
 * Managed-aware: a root can also be covered by an up supervisor that spawns a
 * worker on demand (no live worker yet, but jobs still get served). Both
 * `coverageFor`/`anyUncovered` take `managed` as a REQUIRED param so every
 * call site threads it explicitly — a forgotten site is a compile error, not
 * a lying dot.
 */
import type { ManagedInfo, WorkerPresenceEntry } from "./bridge.js";

export type WorkerCoverage = "covered" | "uncovered" | "unknown";

/** The job kinds this panel can enqueue. Extend when the panel gains new kinds. */
export const ENQUEUEABLE_KINDS = ["generate-artifact", "generate-design"] as const;

export function coverageFor(
  workers: WorkerPresenceEntry[] | null,
  kind: string,
  managed: ManagedInfo | null,
): WorkerCoverage {
  const liveCovers = workers !== null && workers.some((w) => w.kinds === undefined || w.kinds.includes(kind));
  const managedCovers = managed !== null && (managed.kinds === undefined || managed.kinds.includes(kind));
  if (liveCovers || managedCovers) return "covered";
  if (workers === null && managed === null) return "unknown";
  return "uncovered";
}

/** True when ANY enqueueable kind is uncovered (drives the ContextBar dot + banner re-arm). */
export function anyUncovered(
  workers: WorkerPresenceEntry[] | null,
  managed: ManagedInfo | null,
): boolean {
  return ENQUEUEABLE_KINDS.some((k) => coverageFor(workers, k, managed) === "uncovered");
}

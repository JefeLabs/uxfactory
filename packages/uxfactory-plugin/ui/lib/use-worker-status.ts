/**
 * useWorkerStatus — keep the app-store `workers` slice in sync with the bridge.
 * Two writers, one shape (spec 2026-07-09-worker-liveness):
 *   1. snapshot arrivals seed it (pull-truth; `workers` absent → null = unknown);
 *   2. `worker-status` SSE frames for the ACTIVE root update it (push-nudge).
 * Mount ONCE in the connected shell (router).
 *
 * Frame-epoch provenance guard (spec 2026-07-11-followup-sweep-2 §1): within
 * one live SSE subscription, frames are TCP-ordered and cannot be missed, so
 * once a frame for the active root has been applied, a snapshot can never
 * carry anything newer — frames win. A snapshot arrival that resolves after
 * such a frame (e.g. a poll the bridge computed before the presence change)
 * is dropped instead of clobbering the frame's fresher data.
 * Accepted transient: a `managed` change with no accompanying presence
 * change reaches the panel only via snapshot and waits for the next
 * worker-connect frame — every durable coverage change comes with a
 * presence frame or a connection reset, which nulls `workers` and re-opens
 * snapshot writes below.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bridge, BridgeEvent, ManagedInfo, WorkerPresenceEntry } from "./bridge.js";
import { snapshotQuery, activeRoot } from "../queries.js";
import { useAppStore } from "../stores/app.js";

interface WorkerStatusEvent {
  type: "worker-status";
  root: string;
  workers: WorkerPresenceEntry[];
  managed?: ManagedInfo;
}

function isWorkerStatusEvent(v: unknown): v is WorkerStatusEvent {
  if (
    v === null ||
    typeof v !== "object" ||
    (v as { type?: unknown }).type !== "worker-status" ||
    typeof (v as { root?: unknown }).root !== "string" ||
    !Array.isArray((v as { workers?: unknown }).workers)
  ) {
    return false;
  }
  const managed = (v as { managed?: unknown }).managed;
  return managed === undefined || (typeof managed === "object" && managed !== null && !Array.isArray(managed));
}

export function useWorkerStatus(bridge: Bridge): void {
  const workersChanged = useAppStore((s) => s.workersChanged);
  const { data } = useQuery(snapshotQuery(bridge));

  // { root, seen }: which root's frame was last applied this SSE epoch.
  // Reset on subscription setup (a new epoch); set on every applied frame.
  const frameEpoch = useRef<{ root: string | null; seen: boolean }>({ root: null, seen: false });

  useEffect(() => {
    if (data === undefined) return;
    const framedActiveRoot = frameEpoch.current.seen && frameEpoch.current.root === activeRoot(bridge);
    if (useAppStore.getState().workers === null || !framedActiveRoot) {
      workersChanged(data.workers ?? null, data.managed ?? null);
    }
  }, [data, workersChanged, bridge]);

  useEffect(() => {
    frameEpoch.current = { root: null, seen: false };
    const teardown = bridge.events((ev: BridgeEvent) => {
      if (ev.requestId !== "worker-status" || !isWorkerStatusEvent(ev.event)) return;
      if (ev.event.root === activeRoot(bridge)) {
        workersChanged(ev.event.workers, ev.event.managed ?? null);
        frameEpoch.current = { root: ev.event.root, seen: true };
      }
    });
    return teardown;
  }, [bridge, workersChanged]);
}

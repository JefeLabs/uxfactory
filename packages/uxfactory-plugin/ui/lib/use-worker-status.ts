/**
 * useWorkerStatus — keep the app-store `workers` slice in sync with the bridge.
 * Two writers, one shape (spec 2026-07-09-worker-liveness):
 *   1. snapshot arrivals seed it (pull-truth; `workers` absent → null = unknown);
 *   2. `worker-status` SSE frames for the ACTIVE root update it (push-nudge).
 * Mount ONCE in the connected shell (router).
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bridge, BridgeEvent, WorkerPresenceEntry } from "./bridge.js";
import { snapshotQuery, activeRoot } from "../queries.js";
import { useAppStore } from "../stores/app.js";

interface WorkerStatusEvent {
  type: "worker-status";
  root: string;
  workers: WorkerPresenceEntry[];
}

function isWorkerStatusEvent(v: unknown): v is WorkerStatusEvent {
  return (
    v !== null &&
    typeof v === "object" &&
    (v as { type?: unknown }).type === "worker-status" &&
    typeof (v as { root?: unknown }).root === "string" &&
    Array.isArray((v as { workers?: unknown }).workers)
  );
}

export function useWorkerStatus(bridge: Bridge): void {
  const workersChanged = useAppStore((s) => s.workersChanged);
  const { data } = useQuery(snapshotQuery(bridge));

  useEffect(() => {
    if (data !== undefined) workersChanged(data.workers ?? null);
  }, [data, workersChanged]);

  useEffect(() => {
    const teardown = bridge.events((ev: BridgeEvent) => {
      if (ev.requestId !== "worker-status" || !isWorkerStatusEvent(ev.event)) return;
      if (ev.event.root === activeRoot(bridge)) workersChanged(ev.event.workers);
    });
    return teardown;
  }, [bridge, workersChanged]);
}

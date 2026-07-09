/**
 * WorkerBanner — "no worker is serving this project" warning (spec
 * 2026-07-09-worker-liveness, decision 2: enqueue-anyway, so this only warns —
 * it never disables anything). Renders ONLY when coverage for `kind` is
 * "uncovered"; unknown (null) shows nothing.
 */
import React from "react";
import { useAppStore } from "../stores/app.js";
import { coverageFor, ENQUEUEABLE_KINDS } from "../lib/worker-coverage.js";

export interface WorkerBannerProps {
  kind: (typeof ENQUEUEABLE_KINDS)[number];
}

export function WorkerBanner({ kind }: WorkerBannerProps): React.JSX.Element | null {
  const workers = useAppStore((s) => s.workers);
  const dismissed = useAppStore((s) => s.workerBannerDismissed);
  const dismissWorkerBanner = useAppStore((s) => s.dismissWorkerBanner);

  if (dismissed || coverageFor(workers, kind) !== "uncovered") return null;

  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-2 rounded-[var(--radius-card)] border border-warn-400 bg-warn-50 px-3 py-2 text-xs text-warn-700"
    >
      <span aria-hidden="true">⚠</span>
      <div className="flex-1">
        <p>No worker is serving this project — jobs will queue until one connects.</p>
        <p className="opacity-75">
          Start a worker from this project's root (see the quick-start's worker section).
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss worker warning"
        onClick={dismissWorkerBanner}
        className="text-warn-600 hover:text-warn-700 leading-none shrink-0 mt-px"
      >
        ✕
      </button>
    </div>
  );
}

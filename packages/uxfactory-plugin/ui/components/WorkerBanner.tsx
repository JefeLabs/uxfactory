/**
 * WorkerBanner — "no worker detected for this project" warning (spec
 * 2026-07-09-worker-liveness, decision 2: enqueue-anyway, so this only warns —
 * it never disables anything). Renders ONLY when coverage for `kind` is
 * "uncovered"; unknown (null) shows nothing.
 */
import React from "react";
import { useAppStore } from "../stores/app.js";
import { coverageFor, ENQUEUEABLE_KINDS } from "../lib/worker-coverage.js";
import { copyText } from "../lib/copy.js";
import { ActionTooltip } from "./ActionTooltip.js";

export interface WorkerBannerProps {
  kind: (typeof ENQUEUEABLE_KINDS)[number];
}

export function WorkerBanner({ kind }: WorkerBannerProps): React.JSX.Element | null {
  const workers = useAppStore((s) => s.workers);
  const managedWorker = useAppStore((s) => s.managedWorker);
  const dismissed = useAppStore((s) => s.workerBannerDismissed);
  const dismissWorkerBanner = useAppStore((s) => s.dismissWorkerBanner);
  const repoPath = useAppStore((s) => s.connection.repoPath);

  if (dismissed || coverageFor(workers, kind, managedWorker) !== "uncovered") return null;

  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-2 rounded-[var(--radius-card)] border border-warn-400 bg-warn-50 px-3 py-2 text-xs text-warn-700"
    >
      <span aria-hidden="true">⚠</span>
      <div className="flex-1">
        {/* "Detected" is the honest claim: a legacy pre-liveness worker
            claims jobs via untagged polls the bridge cannot see, so it may
            in fact be serving this project even while undetected. */}
        <p>No worker detected for this project — jobs will queue until one connects.</p>
        {repoPath !== "" ? (
          <p className="mt-1 flex items-center gap-2">
            <code
              id="worker-banner-cmd"
              className="font-mono bg-warn-50 border border-warn-400 px-1.5 py-0.5 rounded select-all"
            >
              {`cd ${repoPath} && uxfactory worker`}
            </code>
            <button
              type="button"
              aria-label="Copy worker command"
              onClick={() => copyText(`cd ${repoPath} && uxfactory worker`, "worker-banner-cmd")}
              className="text-warn-600 hover:text-warn-700 hover:underline shrink-0"
            >
              Copy
            </button>
          </p>
        ) : (
          <p className="opacity-75">
            Start a worker from this project's root (see the quick-start's worker section).
          </p>
        )}
      </div>
      <ActionTooltip label="Dismiss worker warning">
        <button
          type="button"
          aria-label="Dismiss worker warning"
          onClick={dismissWorkerBanner}
          className="text-warn-600 hover:text-warn-700 leading-none shrink-0 mt-px"
        >
          ✕
        </button>
      </ActionTooltip>
    </div>
  );
}

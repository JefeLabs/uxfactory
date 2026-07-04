/**
 * Queue.tsx — render-queue approval screen.
 *
 * Queued designspec publishes (from CI runs or agent CLI tools) list here with
 * their batch previews. Nothing reaches the canvas until the user approves a
 * job; Discard rejects it without rendering. The list polls via
 * renderQueueQuery so externally-queued work appears while the panel is open.
 *
 * SELECTOR DISCIPLINE: every useAppStore() call selects a single primitive or
 * stable function reference (see Connect.tsx).
 */

import React, { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Bridge, RenderQueueJob } from "../lib/bridge.js";
import type { PluginBus } from "../lib/plugin-bus.js";
import { renderQueueQuery, queryKeys, activeRoot } from "../queries.js";
import { useAppStore } from "../stores/app.js";
import { Card } from "../components/index.js";

/** Best-effort preview image: the job's batch screenshot, else a placeholder. */
function JobPreview({ bridge, jobId }: { bridge: Bridge; jobId: string }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    bridge
      .fetchRenderJobPreview?.(jobId)
      .then((blob) => {
        if (!cancelled && blob !== null) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {
        // Preview is decorative — the frame summary carries the decision data.
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [bridge, jobId]);

  if (url === null) {
    return (
      <div className="w-full h-20 rounded border border-dashed border-gray-200 flex items-center justify-center text-xs text-gray-400">
        No preview
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="w-full max-h-44 object-cover object-top rounded border border-gray-200"
    />
  );
}

export function Queue({
  bridge,
  bus,
}: {
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  const toast = useAppStore((s) => s.toast);
  const queryClient = useQueryClient();
  const queueResult = useQuery(renderQueueQuery(bridge));
  const jobs: RenderQueueJob[] = queueResult.data?.jobs ?? [];
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  function refresh(): void {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.renderQueue(activeRoot(bridge)),
    });
  }

  async function handleApprove(jobId: string): Promise<void> {
    setBusyJobId(jobId);
    try {
      const job = await bridge.approveRenderJob!(jobId);
      bus.postRender?.(job.spec, job.jobId);
      toast("Approved — rendering on canvas");
    } catch {
      toast("Approve failed — is the bridge running?");
    } finally {
      setBusyJobId(null);
      refresh();
    }
  }

  async function handleDiscard(jobId: string): Promise<void> {
    setBusyJobId(jobId);
    try {
      await bridge.discardRenderJob!(jobId);
      toast("Discarded");
    } catch {
      toast("Discard failed — is the bridge running?");
    } finally {
      setBusyJobId(null);
      refresh();
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Inbox size={16} className="text-gray-500" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-gray-900">Render queue</h2>
          <span className="text-xs text-gray-400">
            {jobs.length > 0 ? `${jobs.length} waiting for approval` : ""}
          </span>
        </div>

        {jobs.length === 0 ? (
          <Card>
            <p className="text-sm text-gray-500 px-4 py-6 text-center">
              No designs waiting for approval. Specs published by CI or an
              agent CLI appear here before they render onto this page.
            </p>
          </Card>
        ) : (
          jobs.map((job) => (
            <Card key={job.jobId}>
              <div className="flex flex-col gap-2 p-3">
                <JobPreview bridge={bridge} jobId={job.jobId} />
                <div className="flex flex-col gap-0.5">
                  {job.frames.map((f) => (
                    <div key={f.name} className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-mono text-gray-800 truncate">{f.name}</span>
                      <span className="text-xs text-gray-400 shrink-0 font-mono">
                        {f.width}×{f.height}
                      </span>
                    </div>
                  ))}
                  {job.frames.length === 0 && (
                    <span className="text-xs text-gray-400">No frame metadata</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyJobId === job.jobId}
                    onClick={() => void handleApprove(job.jobId)}
                    className="flex-1 py-1.5 rounded-[var(--radius-card)] text-xs font-semibold bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
                  >
                    Approve &amp; render
                  </button>
                  <button
                    type="button"
                    disabled={busyJobId === job.jobId}
                    onClick={() => void handleDiscard(job.jobId)}
                    className="py-1.5 px-3 rounded-[var(--radius-card)] text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-60"
                  >
                    Discard
                  </button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

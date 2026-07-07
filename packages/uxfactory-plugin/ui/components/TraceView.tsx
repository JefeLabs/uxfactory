/**
 * TraceView.tsx — the traceability tree: Feature → Story → ACs.
 *
 * Renders GET /project/trace: each feature with its conformance dot (from the
 * latest report's Coverage metric), its stories with actor · want and the
 * pages/views that cover them (trace.json), and each AC's linked canvas
 * components (links registry). Stories no feature references appear under
 * "Unassigned stories". Read-only — linking stays in the composer below.
 */

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TraceFeature, TraceStory } from "../lib/bridge.js";

function ConformanceDot({ conformed }: { conformed: boolean | null }): React.JSX.Element {
  const cls =
    conformed === true ? "bg-green-500" : conformed === false ? "bg-amber-500" : "bg-gray-300";
  const label =
    conformed === true ? "conformed" : conformed === false ? "not conformed" : "no gate run yet";
  return <span className={`w-2 h-2 rounded-full shrink-0 ${cls}`} role="img" aria-label={label} />;
}

function StoryRows({ story }: { story: TraceStory }): React.JSX.Element {
  return (
    <div className="pl-4 py-1.5 border-l border-gray-100 ml-1">
      <div className="text-xs text-gray-800">
        <span className="font-medium">{story.storyId}</span>
        <span className="text-gray-500">
          {" — "}
          {story.actor !== "" ? `${story.actor} · ` : ""}
          {story.want}
        </span>
      </div>
      {story.coveredBy.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {story.coveredBy.map((c) => (
            <span
              key={`${c.page}:${c.view}`}
              className="text-[11px] px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-100"
            >
              {c.page} › {c.view}
            </span>
          ))}
        </div>
      )}
      <ul className="mt-1 space-y-0.5">
        {story.acceptanceCriteria.map((ac) => (
          <li key={ac.acId} className="text-[11px] text-gray-600 flex flex-wrap items-center gap-1">
            <span className="text-gray-400">{ac.acId}</span>
            <span className="truncate">{ac.statement}</span>
            {ac.checkable === "manual" && (
              <span className="px-1 rounded bg-gray-100 text-gray-500">manual</span>
            )}
            {ac.linkedNodes.map((n) => (
              <span
                key={n.nodeId}
                title={`Node: ${n.nodeId}`}
                className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-100"
              >
                {n.unitName}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TraceView({
  features,
  unassigned,
}: {
  features: TraceFeature[];
  unassigned: TraceStory[];
}): React.JSX.Element | null {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (features.length === 0 && unassigned.length === 0) return null;

  const toggle = (id: string): void => setOpen((o) => ({ ...o, [id]: !(o[id] ?? true) }));
  const isOpen = (id: string): boolean => open[id] ?? true;

  return (
    <div>
      <div className="px-3 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Trace</span>
      </div>
      <div className="px-3 pb-2 space-y-1">
        {features.map((f) => (
          <div key={f.featureId}>
            <button
              type="button"
              onClick={() => toggle(f.featureId)}
              aria-expanded={isOpen(f.featureId)}
              className="w-full flex items-center gap-2 py-1 text-left text-xs text-gray-800 hover:text-primary-700"
            >
              {isOpen(f.featureId) ? (
                <ChevronDown className="w-3 h-3 text-gray-400" aria-hidden="true" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-400" aria-hidden="true" />
              )}
              <ConformanceDot conformed={f.conformed} />
              <span className="font-medium">{f.name}</span>
              <span className="text-gray-400">
                {f.stories.length} {f.stories.length === 1 ? "story" : "stories"}
              </span>
              {f.plannedPages.length > 0 && (
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500"
                  title="Sitemap pages planned to serve this feature"
                >
                  planned: {f.plannedPages.join(", ")}
                </span>
              )}
            </button>
            {isOpen(f.featureId) &&
              f.stories.map((s) => <StoryRows key={s.storyId} story={s} />)}
          </div>
        ))}
        {unassigned.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggle("__unassigned")}
              aria-expanded={isOpen("__unassigned")}
              className="w-full flex items-center gap-2 py-1 text-left text-xs text-gray-500 hover:text-primary-700"
            >
              {isOpen("__unassigned") ? (
                <ChevronDown className="w-3 h-3 text-gray-400" aria-hidden="true" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-400" aria-hidden="true" />
              )}
              <span className="font-medium">Unassigned stories</span>
              <span className="text-gray-400">{unassigned.length}</span>
            </button>
            {isOpen("__unassigned") &&
              unassigned.map((s) => <StoryRows key={s.storyId} story={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}

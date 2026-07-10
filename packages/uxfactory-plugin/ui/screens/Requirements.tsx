/**
 * Requirements.tsx — the features→stories→ACs trace graph promoted to a
 * first-class tab (read/navigate core, v1).
 *
 * Spec: docs/superpowers/specs/2026-07-10-requirements-tab-design.md
 *
 * Same data as the old read-only trace tree (formerly parked in the
 * Components tab), rebuilt as an enriched, action-bearing tree: a rollup
 * header (counts + attention chips that double as filter toggles), a search
 * box, and Feature → Story → AC rows (dot/chip JSX ported verbatim).
 *
 * Coverage definitions (verbatim from the design doc's Global Constraints):
 *   - uncovered story: story.coveredBy.length === 0
 *   - unverified AC:   ac.coveredBy.length === 0 && ac.linkedNodes.length === 0
 * Search matches feature name / story id·actor·want / AC id·statement.
 * Filter and search compose with AND; a feature-name match keeps every one
 * of its stories, an AC match keeps its whole story (not just that AC).
 *
 * Per-story actions (canvas jump on linked nodes, open in editor, per-story
 * Generate handoff):
 *   - Linked-node chips (AcRow) become buttons: `bus.selectNodes([n.nodeId])`.
 *   - "Open story in editor" (StoryRow): `bridge.openPath(story.filePath)`,
 *     with the Artifacts-tab row-level error note on failure (no modal).
 *   - "Generate design for story" (StoryRow): stashes `[story.storyId]` in
 *     the app store's `pendingStoryRefs` and navigates to `/tabs/prompt`,
 *     which consumes it on mount into its coverage-scope selection.
 */

import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, ExternalLink, Wand2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Bridge, TraceAC, TraceFeature, TraceStory } from "../lib/bridge.js";
import { BridgeError } from "../lib/bridge.js";
import type { PluginBus } from "../lib/plugin-bus.js";
import { traceQuery } from "../queries.js";
import { Card } from "../components/index.js";
import { useAppStore } from "../stores/app.js";

type Filter = "all" | "uncovered" | "unverified";

// ─── Coverage predicates (Global Constraints, verbatim) ───────────────────────

function isUncoveredStory(story: TraceStory): boolean {
  return story.coveredBy.length === 0;
}

function isUnverifiedAc(ac: TraceAC): boolean {
  return ac.coveredBy.length === 0 && ac.linkedNodes.length === 0;
}

function storyPassesFilter(story: TraceStory, filter: Filter): boolean {
  if (filter === "uncovered") return isUncoveredStory(story);
  if (filter === "unverified") return story.acceptanceCriteria.some(isUnverifiedAc);
  return true;
}

/** `needle` is already trimmed + lower-cased; "" always matches. */
function storyMatchesQuery(story: TraceStory, featureName: string | null, needle: string): boolean {
  if (needle === "") return true;
  if (featureName !== null && featureName.toLowerCase().includes(needle)) return true;
  if (
    story.storyId.toLowerCase().includes(needle) ||
    story.actor.toLowerCase().includes(needle) ||
    story.want.toLowerCase().includes(needle)
  ) {
    return true;
  }
  return story.acceptanceCriteria.some(
    (ac) => ac.acId.toLowerCase().includes(needle) || ac.statement.toLowerCase().includes(needle),
  );
}

// ─── ConformanceDot — ported verbatim from the old Components-tab trace tree ──

function ConformanceDot({ conformed }: { conformed: boolean | null }): React.JSX.Element {
  const cls =
    conformed === true ? "bg-green-500" : conformed === false ? "bg-amber-500" : "bg-gray-300";
  const label =
    conformed === true ? "conformed" : conformed === false ? "not conformed" : "no gate run yet";
  return <span className={`w-2 h-2 rounded-full shrink-0 ${cls}`} role="img" aria-label={label} />;
}

// ─── AC row ────────────────────────────────────────────────────────────────────

function AcRow({ ac, bus }: { ac: TraceAC; bus: PluginBus }): React.JSX.Element {
  return (
    <li className="text-[11px] text-gray-600 flex flex-wrap items-center gap-1">
      <span className="text-gray-400">{ac.acId}</span>
      <span className="truncate">{ac.statement}</span>
      {ac.checkable === "manual" && (
        <span className="px-1 rounded bg-gray-100 text-gray-500">manual</span>
      )}
      {ac.coveredBy.map((c) => (
        <span
          key={`${c.page}:${c.view}`}
          title={`Element on ${c.page} › ${c.view} realizes this AC`}
          className="px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-100"
        >
          {c.page.replace(/^.*\//, "")}
        </span>
      ))}
      {ac.linkedNodes.map((n) => (
        <button
          key={n.nodeId}
          type="button"
          onClick={() => bus.selectNodes([n.nodeId])}
          title={`Node: ${n.nodeId}`}
          aria-label={`Jump to ${n.unitName} on canvas`}
          className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-100 hover:bg-green-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        >
          {n.unitName}
        </button>
      ))}
    </li>
  );
}

// ─── Story row ─────────────────────────────────────────────────────────────────

function StoryRow({
  story,
  bridge,
  bus,
}: {
  story: TraceStory;
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  const navigate = useNavigate();
  const [openError, setOpenError] = useState<string | null>(null);

  async function handleOpen(): Promise<void> {
    setOpenError(null);
    try {
      await bridge.openPath(story.filePath);
    } catch (err) {
      const msg =
        err instanceof BridgeError
          ? `Could not open file (error ${err.status})`
          : "Could not open file";
      setOpenError(msg);
    }
  }

  function handleGenerate(): void {
    useAppStore.getState().setPendingStoryRefs([story.storyId]);
    void navigate({ to: "/tabs/prompt" });
  }

  return (
    <div data-story-id={story.storyId} className="pl-4 py-1.5 border-l border-gray-100 ml-1">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-gray-800">
          <span className="font-medium">{story.storyId}</span>
          <span className="text-gray-500">
            {" — "}
            {story.actor !== "" ? `${story.actor} · ` : ""}
            {story.want}
          </span>
        </div>
        <div data-story-actions={story.storyId} className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => void handleOpen()}
            aria-label="Open story in editor"
            title="Open story in editor"
            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            aria-label="Generate design for story"
            title="Generate design for story"
            className="p-1 rounded text-gray-400 hover:text-primary-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <Wand2 className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      </div>
      {openError !== null && (
        <p className="text-[11px] text-warn-600 mt-1" role="alert">
          {openError}
        </p>
      )}
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
          <AcRow key={ac.acId} ac={ac} bus={bus} />
        ))}
      </ul>
    </div>
  );
}

// ─── Feature row ───────────────────────────────────────────────────────────────

function FeatureRow({
  feature,
  stories,
  isOpen,
  onToggle,
  bridge,
  bus,
}: {
  feature: TraceFeature;
  stories: TraceStory[];
  isOpen: boolean;
  onToggle: () => void;
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-2 py-1 text-left text-xs text-gray-800 hover:text-primary-700"
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-gray-400" aria-hidden="true" />
        ) : (
          <ChevronRight className="w-3 h-3 text-gray-400" aria-hidden="true" />
        )}
        <ConformanceDot conformed={feature.conformed} />
        <span className="font-medium">{feature.name}</span>
        <span className="text-gray-400">
          {stories.length} {stories.length === 1 ? "story" : "stories"}
        </span>
        {feature.plannedPages.length > 0 && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500"
            title="Sitemap pages planned to serve this feature"
          >
            planned: {feature.plannedPages.join(", ")}
          </span>
        )}
      </button>
      {isOpen &&
        stories.map((s) => <StoryRow key={s.storyId} story={s} bridge={bridge} bus={bus} />)}
    </div>
  );
}

// ─── Requirements ───────────────────────────────────────────────────────────────

export function Requirements({
  bridge,
  bus,
}: {
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  const traceResult = useQuery(traceQuery(bridge));
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const features = traceResult.data?.features ?? [];
  const unassigned = traceResult.data?.unassigned ?? [];

  const toggle = (id: string): void => setOpen((o) => ({ ...o, [id]: !(o[id] ?? true) }));
  const isOpen = (id: string): boolean => open[id] ?? true;

  const needle = q.trim().toLowerCase();

  const allStories = useMemo(
    () => [...features.flatMap((f) => f.stories), ...unassigned],
    [features, unassigned],
  );
  const allACs = useMemo(() => allStories.flatMap((s) => s.acceptanceCriteria), [allStories]);
  const uncoveredCount = allStories.filter(isUncoveredStory).length;
  const unverifiedCount = allACs.filter(isUnverifiedAc).length;

  function survivingStories(stories: TraceStory[], featureName: string | null): TraceStory[] {
    return stories.filter(
      (s) => storyPassesFilter(s, filter) && storyMatchesQuery(s, featureName, needle),
    );
  }

  function toggleFilter(next: Filter): void {
    setFilter((current) => (current === next ? "all" : next));
  }

  if (features.length === 0 && unassigned.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
        <div className="p-4">
          <Card>
            <p className="text-sm text-gray-500 px-4 py-6 text-center">
              No requirements yet — seed Features and Stories in the{" "}
              <Link to="/tabs/artifacts" className="text-primary-600 hover:underline font-medium">
                Artifacts
              </Link>{" "}
              tab.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const unassignedSurvivors = survivingStories(unassigned, null);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="flex flex-col gap-3 p-3">
        <Card>
          <div className="flex flex-col gap-2 p-3">
            <h2 className="text-sm font-semibold text-gray-900">
              {`${features.length} features · ${allStories.length} stories · ${allACs.length} ACs`}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={filter === "uncovered"}
                onClick={() => toggleFilter("uncovered")}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                  filter === "uncovered"
                    ? "bg-warn-50 border-warn-400 text-warn-700"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {`${uncoveredCount} uncovered ${uncoveredCount === 1 ? "story" : "stories"}`}
              </button>
              <button
                type="button"
                aria-pressed={filter === "unverified"}
                onClick={() => toggleFilter("unverified")}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                  filter === "unverified"
                    ? "bg-warn-50 border-warn-400 text-warn-700"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {`${unverifiedCount} unverified ${unverifiedCount === 1 ? "AC" : "ACs"}`}
              </button>
            </div>
            <input
              type="search"
              role="searchbox"
              aria-label="Search requirements"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search features, stories, ACs…"
              className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-600"
            />
          </div>
        </Card>

        <Card>
          <div className="px-3 pt-3 pb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Trace
            </span>
          </div>
          <div className="px-3 pb-2 space-y-1">
            {features.map((f) => {
              const survivors = survivingStories(f.stories, f.name);
              const visible = survivors.length > 0 || (filter === "all" && needle === "");
              if (!visible) return null;
              return (
                <FeatureRow
                  key={f.featureId}
                  feature={f}
                  stories={survivors}
                  isOpen={isOpen(f.featureId)}
                  onToggle={() => toggle(f.featureId)}
                  bridge={bridge}
                  bus={bus}
                />
              );
            })}
            {unassignedSurvivors.length > 0 && (
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
                  <span className="text-gray-400">{unassignedSurvivors.length}</span>
                </button>
                {isOpen("__unassigned") &&
                  unassignedSurvivors.map((s) => (
                    <StoryRow key={s.storyId} story={s} bridge={bridge} bus={bus} />
                  ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

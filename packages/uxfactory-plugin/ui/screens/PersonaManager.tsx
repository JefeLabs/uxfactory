/**
 * PersonaManager.tsx — in-panel CRUD for the personas SET artifact.
 *
 * Personas is a directory of instances (one JSON file per persona), so it has
 * no single-file ArtifactEditor (see SET_ARTIFACT_KEYS in artifact-mapping.ts).
 * This screen replaces the old Finder-open behavior for that row: it lists
 * every instance from GET /project/personas, and drives add/edit/delete
 * straight through the bridge's per-instance routes (Task 1) — no LLM
 * involved, this is local CRUD only. Regeneration of the WHOLE set stays on
 * the Artifacts inventory row's Regenerate button (unchanged, whole-set
 * generate-artifact job); this screen never enqueues anything.
 *
 * Add mints the next `P-NN` id client-side (nextPersonaId) and opens a blank
 * instance in JsonFormEditor with the personas field spec (Task 2); Edit opens
 * an existing instance the same way. Both save through JsonFormEditor's
 * injectable `saveFn` (Task 3), which PUTs the one instance instead of the
 * whole-artifact route. Delete confirms, then DELETEs the instance.
 *
 * Every mutation invalidates both the personas list query and the snapshot
 * query (a personas count/status change may shift the Artifacts row's meta).
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { Bridge, PersonaRecord } from "../lib/bridge.js";
import { personasQuery, queryKeys, activeRoot } from "../queries.js";
import { formSpecFor } from "../lib/artifact-forms.js";
import { Card, Row } from "../components/index.js";
import { JsonFormEditor } from "./JsonFormEditor.js";
import { useAppStore } from "../stores/app.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Next unused `P-NN` id — client-minted, matches the bridge's `/^P-\d+$/` guard. */
export function nextPersonaId(ids: string[]): string {
  const nums = ids.map((id) => Number(/^P-(\d+)$/.exec(id)?.[1] ?? 0));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `P-${String(next).padStart(2, "0")}`;
}

function displayName(p: PersonaRecord): string {
  const name = p["name"];
  return typeof name === "string" && name !== "" ? name : p.personaId;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Row meta: "archetype · N goals · M frustrations" (archetype omitted when blank). */
function metaFor(p: PersonaRecord): string {
  const archetype = typeof p["archetype"] === "string" ? p["archetype"] : "";
  const goals = asStringArray(p["goals"]).length;
  const frustrations = asStringArray(p["frustrations"]).length;
  const counts = `${goals} goal${goals === 1 ? "" : "s"} · ${frustrations} frustration${frustrations === 1 ? "" : "s"}`;
  return archetype !== "" ? `${archetype} · ${counts}` : counts;
}

/** A blank instance seeded from the personas field spec's shape (artifact-forms.ts). */
const BLANK_PERSONA: Record<string, unknown> = {
  name: "",
  archetype: "",
  segmentRef: null,
  goals: [],
  frustrations: [],
  context: { expertise: "intermediate", frequency: "", environment: "" },
  quote: null,
};

// ─── Header ─────────────────────────────────────────────────────────────────

function ManagerHeader({
  onBack,
  count,
  onAdd,
}: {
  onBack: () => void;
  count: number;
  /** Omit to hide the Add button (e.g. the personas field spec is unavailable). */
  onAdd?: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to artifacts"
        className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      >
        ← Back
      </button>
      <span className="flex-1 text-sm font-semibold text-gray-900">
        Manage personas ({count})
      </span>
      {onAdd !== undefined && (
        <button
          type="button"
          onClick={onAdd}
          className="text-xs px-2.5 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 shrink-0"
        >
          + Add persona
        </button>
      )}
    </div>
  );
}

// ─── PersonaManager ─────────────────────────────────────────────────────────

export function PersonaManager({
  bridge,
  onBack,
}: {
  bridge: Bridge;
  onBack: () => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const toast = useAppStore((s) => s.toast);
  const spec = formSpecFor("personas");
  const { data } = useQuery(personasQuery(bridge));
  const personas = data?.personas ?? [];
  const [editing, setEditing] = useState<{ id: string; value: Record<string, unknown> } | null>(
    null,
  );

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: queryKeys.personas(activeRoot(bridge)) });
    void qc.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
  }

  async function handleDelete(p: PersonaRecord): Promise<void> {
    const label = displayName(p);
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      await bridge.deletePersona!(p.personaId);
      invalidate();
      toast(`Deleted ${label}`);
    } catch {
      toast("Delete failed — is the bridge running?");
    }
  }

  // Legacy bridge without the personas routes — same "requires a newer
  // bridge version" treatment ArtifactEditor gives a missing getArtifact.
  if (typeof bridge.getPersonas !== "function") {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <ManagerHeader onBack={onBack} count={0} />
        <div className="flex flex-col flex-1 items-center justify-center p-8">
          <p className="text-sm text-red-500" role="alert">
            Persona editing requires a newer bridge version.
          </p>
        </div>
      </div>
    );
  }

  if (editing !== null && spec !== undefined) {
    return (
      <JsonFormEditor
        artifactKey="personas"
        label={
          typeof editing.value["name"] === "string" && editing.value["name"] !== ""
            ? String(editing.value["name"])
            : editing.id
        }
        status="up-to-date"
        spec={spec}
        value={editing.value}
        bridge={bridge}
        onBack={() => setEditing(null)}
        saveFn={async (content) => {
          await bridge.putPersona!(editing.id, JSON.parse(content) as Record<string, unknown>);
        }}
        onSaved={() => {
          invalidate();
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ManagerHeader
        onBack={onBack}
        count={personas.length}
        onAdd={
          spec === undefined
            ? undefined
            : () => {
                const id = nextPersonaId(personas.map((p) => p.personaId));
                setEditing({ id, value: { ...BLANK_PERSONA } });
              }
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {personas.length === 0 ? (
          <p className="text-xs text-gray-500">
            No personas yet. Add one, or regenerate from the Artifacts tab.
          </p>
        ) : (
          <Card>
            {personas.map((p) => (
              <Row
                key={p.personaId}
                name={displayName(p)}
                meta={metaFor(p)}
                action={
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing({ id: p.personaId, value: p })}
                      aria-label={`Edit ${displayName(p)}`}
                      className="text-xs text-primary-600 hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(p)}
                      aria-label={`Delete ${displayName(p)}`}
                      className="text-xs text-fail-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                    >
                      Delete
                    </button>
                  </div>
                }
              />
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

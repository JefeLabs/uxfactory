/**
 * runs.ts — Recent run index: tracks the last 20 generate/check runs,
 * persisted per-file via the plugin bus under key `runs:v1:<fileKey>`.
 *
 * IMPORTANT: `hydrate` uses the `api` parameter (third arg to the zustand
 * create callback) for subscription rather than referencing `useRunsStore`
 * inside its own initializer.  Referencing the exported constant inside the
 * `create` call creates a circular type dependency that TypeScript cannot
 * resolve.
 */

import { create } from "zustand";
import type { StoreApi } from "zustand";
import type { PluginBus } from "../lib/plugin-bus.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RunProgress {
  phase: string;
  note: string;
}

export type RunStatus = "generating" | "checked" | "warnings" | "failed";

export interface RunEntry {
  id: string;
  prompt: string;
  unitType: string;
  /**
   * Target platforms for this run (e.g. `["desktop", "mobile"]`).
   * Additive extension consumed by the Prompt screen's enqueue payload.
   */
  platforms: string[];
  status: RunStatus;
  warnings?: string[];
  progress?: RunProgress;
  /**
   * Node ids from the landing report — set by completion events when
   * available. Consumed by the Prompt screen's View action for run
   * scoping (and, once a main-thread select-nodes message exists, canvas
   * zoom).
   *
   * Persistence note: this field is an ADDITIVE extension of the
   * `runs:v1:<fileKey>` storage payload. Entries persisted before this
   * field existed simply lack it and hydrate cleanly.
   */
  nodeIds?: string[];
}

const MAX_RUNS = 20;

// ─── Store state ──────────────────────────────────────────────────────────────

/** Composer chip state — every field the Prompt composer persists across tab switches. */
export interface ComposerState {
  composerUnitType: string;
  /** Viewport tokens (device×orientation, e.g. "mobile-portrait"); [] = classification fallback. */
  composerPlatforms: string[];
  /** 1–3; 1 stays off the wire. */
  composerVariations: number;
  /** "low" | "medium" | "high" — "medium" stays off the wire. */
  composerFidelity: string;
}

export interface RunsState extends ComposerState {
  runs: RunEntry[];
  /*
   * Composer chip state lives here (rather than component local state) so the
   * Prompt screen restores its selections when re-mounted on tab switches.
   *
   * Design choice: runs store is the natural owner because both composer
   * state and the run list relate to generation jobs; no separate slice
   * was introduced to avoid store proliferation.
   */
}

export interface RunsActions {
  /** Add a new run entry (generates → prepends; older entries past cap-20 are dropped). */
  add(entry: Omit<RunEntry, "status"> & { status?: RunStatus }): void;
  /** Update live progress for a run. */
  progress(id: string, p: RunProgress): void;
  /**
   * Mark a run terminal. `nodeIds` (node ids from the landing report) is
   * stored when the completion event provides it; otherwise any previously
   * stored ids are preserved.
   */
  complete(
    id: string,
    status: Exclude<RunStatus, "generating">,
    warnings?: string[],
    nodeIds?: string[],
  ): void;
  /**
   * Hydrate from plugin storage and wire auto-persist.
   * Returns a teardown function that removes the persist subscription.
   * Async because it reads fileInfo + storage from the bus.
   */
  hydrate(bus: PluginBus): Promise<() => void>;
  /** Persist composer chip state across tab switches (partial update). */
  setComposerState(partial: Partial<ComposerState>): void;
}

export type RunsStore = RunsState & RunsActions;

// ─── Store ────────────────────────────────────────────────────────────────────

export const useRunsStore = create<RunsStore>(
  (set, get, api: StoreApi<RunsStore>) => ({
    runs: [],
    composerUnitType: "page",
    composerPlatforms: [],
    composerVariations: 1,
    composerFidelity: "medium",

    add(entry) {
      const run: RunEntry = { status: "generating", ...entry };
      set((s) => ({
        runs: [run, ...s.runs].slice(0, MAX_RUNS),
      }));
    },

    progress(id, p) {
      set((s) => ({
        runs: s.runs.map((r) =>
          r.id === id ? { ...r, progress: p } : r,
        ),
      }));
    },

    complete(id, status, warnings, nodeIds) {
      set((s) => ({
        runs: s.runs.map((r) =>
          r.id === id
            ? { ...r, status, warnings, nodeIds: nodeIds ?? r.nodeIds, progress: undefined }
            : r,
        ),
      }));
    },

    setComposerState(partial) {
      set(partial);
    },

    async hydrate(bus: PluginBus): Promise<() => void> {
      let fileKey: string;
      try {
        const fi = await bus.fileInfo();
        fileKey = fi.fileKey;
      } catch {
        // No fileKey available (e.g. test environment without Figma) — skip hydrate.
        return () => { /* noop */ };
      }

      const storageKey = `runs:v1:${fileKey}`;

      // Load existing runs from storage.
      try {
        const stored = await bus.storageGet<RunEntry[]>(storageKey);
        if (Array.isArray(stored)) {
          set({ runs: stored.slice(0, MAX_RUNS) });
        }
      } catch {
        // Storage read failure — start fresh.
      }

      // Auto-persist on every state change.
      // Use the api parameter to avoid a circular self-reference in the type.
      const unsubscribe: () => void = api.subscribe((state: RunsStore) => {
        bus
          .storageSet(storageKey, state.runs)
          .catch(() => { /* storage write failure — non-fatal */ });
      });

      // Trigger an immediate persist of the hydrated state.
      bus
        .storageSet(storageKey, get().runs)
        .catch(() => { /* non-fatal */ });

      return unsubscribe;
    },
  }),
);

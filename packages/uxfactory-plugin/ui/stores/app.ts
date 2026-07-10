/**
 * app.ts — Global app state: connection status, project snapshot, toasts.
 *
 * Kept bus-agnostic: the `connectSucceeded` action accepts an optional
 * `persist` callback (rather than importing the bus directly) so the store
 * can be tested without a live Figma sandbox.
 *
 * Navigation is owned exclusively by the TanStack Router (router.tsx).
 * This store holds only client-side state: connection, file info, snapshot,
 * and toasts. `cancelReconnect` resets connection.status; the router
 * navigates back to /connect independently (ContextBar's onClick does both).
 */

import { create } from "zustand";
import type { ManagedInfo, ProjectSnapshot, WorkerPresenceEntry } from "../lib/bridge.js";
import { anyUncovered } from "../lib/worker-coverage.js";

// ─── State types ──────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | "none"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type ConnectionMode = "local" | "cloud";

export interface ConnectionState {
  status: ConnectionStatus;
  endpoint: string;
  repoPath: string;
  mode: ConnectionMode;
}

export type Tab =
  | "prompt"
  | "requirements"
  | "artifacts"
  | "components"
  | "assets"
  | "checks"
  | "settings";

export interface ToastItem {
  id: string;
  message: string;
}

export interface AppState {
  connection: ConnectionState;
  fileInfo: { name: string; fileKey: string } | null;
  snapshot: ProjectSnapshot | null;
  toasts: ToastItem[];
  /** Live workers for the connected root; null = unknown (never warn on null). */
  workers: WorkerPresenceEntry[] | null;
  /** Set when a supervisor manages this root on-demand; null = not managed. */
  managedWorker: ManagedInfo | null;
  /** Session dismiss for the WorkerBanner; re-armed by a fresh covered→uncovered transition. */
  workerBannerDismissed: boolean;
  /**
   * One-shot handoff from Requirements' per-story Generate action: the story
   * ids to scope the Prompt tab's coverage contract to. Set right before
   * navigating to /tabs/prompt; Prompt consumes (reads + clears) it on mount.
   */
  pendingStoryRefs: string[] | null;
}

// ─── Action types ─────────────────────────────────────────────────────────────

export interface PersistPayload {
  mode: ConnectionMode;
  endpoint: string;
  repoPath: string;
}

export interface AppActions {
  setFileInfo(fi: { name: string; fileKey: string }): void;
  connectStart(): void;
  connectSucceeded(
    snapshot: ProjectSnapshot,
    repoPath: string,
    persist?: (payload: PersistPayload) => void,
  ): void;
  connectFailed(message: string): void;
  toast(message: string): void;
  dismissToast(id: string): void;
  /**
   * Cancel an in-progress reconnect attempt.
   * Resets `connection.status` to `"none"`. The caller (ContextBar) is
   * responsible for also calling `navigate({ to: "/connect" })` so the
   * router reflects the state change.
   */
  cancelReconnect(): void;
  workersChanged(workers: WorkerPresenceEntry[] | null, managed: ManagedInfo | null): void;
  dismissWorkerBanner(): void;
  setPendingStoryRefs(refs: string[]): void;
  /** Reads pendingStoryRefs, clears it, and returns what was read (one-shot). */
  consumePendingStoryRefs(): string[] | null;
}

export type AppStore = AppState & AppActions;

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_CONNECTION: ConnectionState = {
  status: "none",
  endpoint: `http://localhost:3779`,
  repoPath: "",
  mode: "local",
};

let toastCounter = 0;

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppStore>((set, get) => ({
  // State
  connection: INITIAL_CONNECTION,
  fileInfo: null,
  snapshot: null,
  toasts: [],
  workers: null,
  managedWorker: null,
  workerBannerDismissed: false,
  pendingStoryRefs: null,

  // Actions
  setFileInfo(fi) {
    set({ fileInfo: fi });
  },

  connectStart() {
    set((s) => ({
      connection: { ...s.connection, status: "connecting" },
    }));
  },

  connectSucceeded(snapshot, repoPath, persist) {
    const { connection } = get();

    set((s) => ({
      snapshot,
      connection: { ...s.connection, status: "connected", repoPath },
      workers: snapshot.workers ?? null,
      managedWorker: snapshot.managed ?? null,
      workerBannerDismissed: false,
    }));

    if (persist) {
      persist({
        mode: connection.mode,
        endpoint: connection.endpoint,
        repoPath,
      });
    }
  },

  connectFailed(message) {
    set((s) => ({
      connection: { ...s.connection, status: "error" },
      // Stale presence must not survive a lost connection: without a live
      // bridge we have no signal, so treat coverage as unknown, not uncovered.
      workers: null,
      managedWorker: null,
    }));
    get().toast(message);
  },

  toast(message) {
    const id = String(++toastCounter);
    set((s) => ({ toasts: [...s.toasts, { id, message }] }));
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  cancelReconnect() {
    set((s) => ({
      connection: { ...s.connection, status: "none" },
      // Stale presence must not survive a lost connection: without a live
      // bridge we have no signal, so treat coverage as unknown, not uncovered.
      workers: null,
      managedWorker: null,
    }));
  },

  workersChanged(workers, managed) {
    set((s) => {
      const freshOutage = anyUncovered(workers, managed) && !anyUncovered(s.workers, s.managedWorker);
      return {
        workers,
        managedWorker: managed,
        workerBannerDismissed: freshOutage ? false : s.workerBannerDismissed,
      };
    });
  },

  dismissWorkerBanner() {
    set({ workerBannerDismissed: true });
  },

  setPendingStoryRefs(refs) {
    set({ pendingStoryRefs: refs });
  },

  consumePendingStoryRefs() {
    const refs = get().pendingStoryRefs;
    set({ pendingStoryRefs: null });
    return refs;
  },
}));

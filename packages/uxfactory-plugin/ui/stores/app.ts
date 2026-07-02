/**
 * app.ts — Global app state: connection status, project snapshot, routing, toasts.
 *
 * Kept bus-agnostic: the `connectSucceeded` action accepts an optional
 * `persist` callback (rather than importing the bus directly) so the store
 * can be tested without a live Figma sandbox.
 */

import { create } from "zustand";
import type { Bridge } from "../lib/bridge.js";
import type { ProjectSnapshot } from "../lib/bridge.js";

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

export type Screen = "connect" | "setup-1" | "setup-2" | "tabs";
export type Tab =
  | "prompt"
  | "artifacts"
  | "components"
  | "assets"
  | "checks"
  | "settings";

export interface RouteState {
  screen: Screen;
  tab: Tab;
}

export interface ToastItem {
  id: string;
  message: string;
}

/**
 * Cross-tab focus intent — a one-shot "deep link" between tabs.
 *
 * Producers set it right before calling `setTab` (e.g. the Prompt screen's
 * View action sets `runId` before switching to Checks; a grounding chip
 * sets `artifactKey` before switching to Artifacts).
 *
 * Consumers read it on mount/focus — Checks refetches when `runId` arrives
 * (useEffect keyed on focus?.runId triggers init() + clearFocus()); Artifacts
 * consumes `artifactKey` on mount. Consumers clear via `clearFocus()`.
 */
export interface FocusIntent {
  runId?: string;
  artifactKey?: string;
}

export interface AppState {
  connection: ConnectionState;
  fileInfo: { name: string; fileKey: string } | null;
  snapshot: ProjectSnapshot | null;
  route: RouteState;
  toasts: ToastItem[];
  /** Pending cross-tab focus intent, or null when none. See {@link FocusIntent}. */
  focus: FocusIntent | null;
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
  refreshSnapshot(bridge: Bridge): Promise<void>;
  goto(screen: Screen): void;
  setTab(tab: Tab): void;
  /**
   * Set the pending cross-tab focus intent (see {@link FocusIntent}).
   * Consumed by Checks (`runId`) / Artifacts (`artifactKey`) on
   * mount/focus; the consumer clears it via `clearFocus()`.
   */
  setFocus(focus: FocusIntent): void;
  /** Clear the pending focus intent (called by the consuming tab). */
  clearFocus(): void;
  toast(message: string): void;
  dismissToast(id: string): void;
  /**
   * Cancel an in-progress reconnect attempt.
   * Resets both `route.screen` to `"connect"` AND `connection.status` to `"none"`
   * so the reconnect ContextBar does not linger over the Connect screen.
   */
  cancelReconnect(): void;
}

export type AppStore = AppState & AppActions;

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_CONNECTION: ConnectionState = {
  status: "none",
  endpoint: `http://localhost:3779`,
  repoPath: "",
  mode: "local",
};

const INITIAL_ROUTE: RouteState = {
  screen: "connect",
  tab: "prompt",
};

let toastCounter = 0;

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppStore>((set, get) => ({
  // State
  connection: INITIAL_CONNECTION,
  fileInfo: null,
  snapshot: null,
  route: INITIAL_ROUTE,
  toasts: [],
  focus: null,

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
    const nextScreen: Screen = snapshot.hasClassification ? "tabs" : "setup-1";

    set((s) => ({
      snapshot,
      connection: { ...s.connection, status: "connected", repoPath },
      route: { ...s.route, screen: nextScreen },
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
    }));
    get().toast(message);
  },

  async refreshSnapshot(bridge) {
    try {
      const snapshot = await bridge.snapshot();
      set({ snapshot });
    } catch {
      // Non-fatal: silently ignore refresh failures (connection pill shows status)
    }
  },

  goto(screen) {
    set((s) => ({ route: { ...s.route, screen } }));
  },

  setTab(tab) {
    set((s) => ({ route: { ...s.route, tab } }));
  },

  setFocus(focus) {
    set({ focus });
  },

  clearFocus() {
    set({ focus: null });
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
      route: { ...s.route, screen: "connect" },
    }));
  },
}));

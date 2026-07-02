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

export interface AppState {
  connection: ConnectionState;
  fileInfo: { name: string; fileKey: string } | null;
  snapshot: ProjectSnapshot | null;
  route: RouteState;
  toasts: ToastItem[];
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
  toast(message: string): void;
  dismissToast(id: string): void;
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

  toast(message) {
    const id = String(++toastCounter);
    set((s) => ({ toasts: [...s.toasts, { id, message }] }));
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

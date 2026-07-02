/**
 * main.tsx — Plugin UI entry point.
 *
 * Boot sequence (PRD 00 §5):
 * 1. createBus() → wire plugin message bridge to main thread.
 * 2. bus.fileInfo() → get {name, fileKey} for this Figma file.
 * 3. bus.storageGet("conn:v1:"+fileKey) → check for a previously persisted connection.
 *    • None → route to connect screen.
 *    • Found → set status "reconnecting" → GET /health + GET /project/snapshot.
 *              Success → route per snapshot.hasClassification.
 *              Failure → connect screen + toast "Could not reconnect — check bridge".
 * 4. Any unhandled boot error → connect screen + toast. Never white-screens.
 */

import "./panel.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBus } from "./lib/plugin-bus.js";
import { createBridge } from "./lib/bridge.js";
import { useAppStore } from "./stores/app.js";
import { useRunsStore } from "./stores/runs.js";
import { App } from "./app.js";

interface StoredConnection {
  mode: "local" | "cloud";
  endpoint: string;
  repoPath: string;
}

async function boot(): Promise<void> {
  const bus = createBus();
  const bridge = createBridge();

  const store = useAppStore.getState();

  try {
    // ── Step 1: Get file identity ─────────────────────────────────────────────
    const fi = await bus.fileInfo();
    store.setFileInfo(fi);

    // ── Step 2: Hydrate runs store (non-blocking, errors tolerated) ───────────
    useRunsStore.getState().hydrate(bus).catch(() => { /* non-fatal */ });

    // ── Step 3: Check for stored connection ───────────────────────────────────
    const connKey = `conn:v1:${fi.fileKey}`;
    const stored = await bus.storageGet<StoredConnection>(connKey);

    if (!stored || typeof stored.repoPath !== "string") {
      // No prior connection — show connect screen (default route is already "connect")
      return;
    }

    // ── Step 4: Auto-reconnect with a visible "Reconnecting…" state ──────────
    useAppStore.setState((s) => ({
      connection: {
        ...s.connection,
        status: "reconnecting",
        mode: stored.mode,
        endpoint: stored.endpoint,
        repoPath: stored.repoPath,
      },
    }));

    // health + snapshot in parallel for speed
    const [, snapshot] = await Promise.all([
      bridge.health(),
      bridge.snapshot(),
    ]);

    // Race guard: the user may have clicked Cancel while we were awaiting.
    // If status is no longer "reconnecting", skip connectSucceeded to avoid
    // yanking them off the Connect screen.
    if (useAppStore.getState().connection.status !== "reconnecting") {
      return;
    }

    store.connectSucceeded(snapshot, stored.repoPath, (payload) => {
      bus.storageSet(connKey, payload).catch(() => { /* non-fatal */ });
    });
  } catch (err) {
    // Any boot failure → connect screen + toast so the user can recover
    useAppStore.setState((s) => ({
      connection: { ...s.connection, status: "error" },
      route: { ...s.route, screen: "connect" },
    }));
    const msg =
      err instanceof Error ? err.message : "Boot failed — check the bridge";
    useAppStore.getState().toast(msg);
  }
}

// Kick off boot (errors are fully handled inside).
void boot();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

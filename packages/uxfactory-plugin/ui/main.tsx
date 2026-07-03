/**
 * main.tsx — Plugin UI entry point.
 *
 * Boot sequence (unchanged semantics; ends in router.navigate):
 * 1. createBus() + createBridge() + makeQueryClient() + createAppRouter().
 * 2. bus.fileInfo() → set file identity.
 * 3. bus.storageGet(conn key) → no prior connection ⇒ stay on /connect.
 * 4. else reconnecting → health + snapshot; race guard aborts if the user
 *    cancelled (connection.status left "reconnecting"); on success seed the
 *    snapshot query cache and navigate per hasClassification.
 * 5. Any boot error → /connect + toast. Never white-screens.
 */
import "./panel.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { createBus } from "./lib/plugin-bus.js";
import { createBridge } from "./lib/bridge.js";
import { useAppStore } from "./stores/app.js";
import { useRunsStore } from "./stores/runs.js";
import { makeQueryClient, queryKeys, activeRoot } from "./queries.js";
import { createAppRouter } from "./router.js";

interface StoredConnection {
  mode: "local" | "cloud";
  endpoint: string;
  repoPath: string;
}

const bus = createBus();
const bridge = createBridge();
const queryClient = makeQueryClient();
const router = createAppRouter({ bridge, bus, queryClient }, ["/connect"]);

async function boot(): Promise<void> {
  const store = useAppStore.getState();
  try {
    const fi = await bus.fileInfo();
    store.setFileInfo(fi);

    useRunsStore.getState().hydrate(bus).catch(() => {
      /* non-fatal */
    });

    const connKey = `conn:v1:${fi.fileKey}`;
    const stored = await bus.storageGet<StoredConnection>(connKey);

    if (!stored || typeof stored.repoPath !== "string") {
      return; // default route is /connect
    }

    useAppStore.setState((s) => ({
      connection: {
        ...s.connection,
        status: "reconnecting",
        mode: stored.mode,
        endpoint: stored.endpoint,
        repoPath: stored.repoPath,
      },
    }));

    const [, snapshot] = await Promise.all([bridge.health(), bridge.snapshot()]);

    // Race guard: user may have clicked Cancel while awaiting (status flips).
    if (useAppStore.getState().connection.status !== "reconnecting") {
      return;
    }

    queryClient.setQueryData(queryKeys.snapshot(activeRoot(bridge)), snapshot);
    store.connectSucceeded(snapshot, stored.repoPath, (payload) => {
      bus.storageSet(connKey, payload).catch(() => {
        /* non-fatal */
      });
    });
    void router.navigate({
      to: snapshot.hasClassification ? "/tabs/prompt" : "/setup/classification",
    });
  } catch (err) {
    useAppStore.setState((s) => ({
      connection: { ...s.connection, status: "error" },
    }));
    void router.navigate({ to: "/connect" });
    const msg =
      err instanceof Error ? err.message : "Boot failed — check the bridge";
    useAppStore.getState().toast(msg);
  }
}

void boot();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

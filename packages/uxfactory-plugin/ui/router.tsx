/**
 * router.tsx — Code-based TanStack Router tree (createMemoryHistory) + the
 * shell chrome (ContextBar, TabNav, toast overlay) formerly in app.tsx.
 *
 * The iframe has no URL bar, so we mount on memory history today; the same
 * tree runs on browser history in the future web shell.
 *
 * The router is the sole source of navigation truth. The app store holds only
 * client-side state (connection, snapshot, toasts). SnapshotSync polls while
 * the router is on /tabs/* and syncs the result into the store.
 *
 * SELECTOR DISCIPLINE: every useAppStore() call selects a single primitive or
 * a stable stored reference. Never return a new object literal from a selector.
 */
import React, { useEffect, useState } from "react";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  createMemoryHistory,
  redirect,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { snapshotQuery, renderQueueQuery } from "./queries.js";
import * as Tabs from "@radix-ui/react-tabs";
import { ChevronDown, ChevronUp, Inbox, Settings as SettingsIcon, Unplug } from "lucide-react";
import { useAppStore } from "./stores/app.js";
import type { Tab } from "./stores/app.js";
import { Chip, DesignStylePicker, StatusPill } from "./components/index.js";
import type { StatusPillStatus } from "./components/index.js";
import { designStyleLabel, suggestDesignStyle } from "./lib/design-styles.js";
import type { Bridge } from "./lib/bridge.js";
import type { PluginBus } from "./lib/plugin-bus.js";

import { Connect } from "./screens/Connect.js";
import { SetupClassification } from "./screens/SetupClassification.js";
import { SetupDefaults } from "./screens/SetupDefaults.js";
import { Prompt } from "./screens/Prompt.js";
import { Artifacts } from "./screens/Artifacts.js";
import { Components } from "./screens/Components.js";
import { Assets } from "./screens/Assets.js";
import { Checks } from "./screens/Checks.js";
import { Settings } from "./screens/Settings.js";
import { Queue } from "./screens/Queue.js";

// ─── Router context ───────────────────────────────────────────────────────────

export interface RouterContext {
  bridge: Bridge;
  bus: PluginBus;
  queryClient: QueryClient;
}

// ─── Typed search params (exported so test-utils reuses the validators) ───────

export interface ChecksSearch {
  run?: string;
}
export function validateChecksSearch(
  search: Record<string, unknown>,
): ChecksSearch {
  return { run: typeof search.run === "string" ? search.run : undefined };
}

export interface ArtifactsSearch {
  focus?: string;
}
export function validateArtifactsSearch(
  search: Record<string, unknown>,
): ArtifactsSearch {
  return { focus: typeof search.focus === "string" ? search.focus : undefined };
}

function SnapshotSync({ bridge }: { bridge: Bridge }): null {
  const status = useAppStore((s) => s.connection.status);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Only sync while on the main tabs — during /connect and /setup/* the snapshot
  // set by connectSucceeded is authoritative (controls new-project heading
  // etc.) and must not be overwritten by a background refetch.
  const enabled =
    (status === "connected" || status === "reconnecting") &&
    pathname.startsWith("/tabs");
  const { data } = useQuery({ ...snapshotQuery(bridge), enabled });
  useEffect(() => {
    if (data) useAppStore.setState({ snapshot: data });
  }, [data]);
  return null;
}

// ─── Toast overlay ────────────────────────────────────────────────────────────

function ToastOverlay(): React.JSX.Element | null {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="Notifications"
      className="absolute bottom-4 left-4 right-4 flex flex-col gap-2 z-50"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 bg-gray-900 text-white text-sm rounded-lg px-3 py-2 shadow-lg"
        >
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            aria-label={`Dismiss: ${t.message}`}
            onClick={() => dismissToast(t.id)}
            className="text-gray-400 hover:text-white"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── ContextBar (verbatim relocation from app.tsx) ────────────────────────────

function connectionStatusToPill(status: string): StatusPillStatus {
  switch (status) {
    case "connected":
      return "connected";
    case "connecting":
    case "reconnecting":
      return "reconnecting";
    case "error":
      return "down";
    default:
      return "disconnected";
  }
}

/** Icon-only connection indicator — same role/name contract the pill had. */
const CONNECTION_DOT: Record<string, { className: string; label: string }> = {
  connected: { className: "bg-success-600", label: "Connected" },
  reconnecting: { className: "bg-amber-500 animate-pulse", label: "Reconnecting" },
  down: { className: "bg-red-500", label: "Connection error" },
  disconnected: { className: "bg-gray-300", label: "Disconnected" },
};

function ConnectionDot({ status }: { status: StatusPillStatus }): React.JSX.Element {
  const dot = CONNECTION_DOT[status] ?? CONNECTION_DOT["disconnected"]!;
  return (
    <span
      role="status"
      aria-label={dot.label}
      title={dot.label}
      className="inline-flex items-center justify-center w-5 h-5 shrink-0"
    >
      <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full ${dot.className}`} />
    </span>
  );
}

function ContextBar(): React.JSX.Element {
  const { bridge } = rootRoute.useRouteContext();
  // Pending approvals badge — polls the root-scoped render queue.
  const queueResult = useQuery(renderQueueQuery(bridge));
  const queueCount = queueResult.data?.jobs.length ?? 0;
  const connection = useAppStore((s) => s.connection);
  const snapshot = useAppStore((s) => s.snapshot);
  const fileName = useAppStore((s) => s.fileInfo?.name);
  const cancelReconnect = useAppStore((s) => s.cancelReconnect);
  const toast = useAppStore((s) => s.toast);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  // Inline design-style editor deployed UNDER the bar (chip click toggles it).
  const [styleOpen, setStyleOpen] = useState(false);
  const [styleDraft, setStyleDraft] = useState("");
  const [styleSaving, setStyleSaving] = useState(false);

  // Disconnect: back to the Connect screen; stored connection stays for
  // one-click reconnect, but the client's root scoping is cleared.
  function handleDisconnect(): void {
    cancelReconnect(); // sets connection.status back to "none"
    bridge.setProjectRoot?.(null);
    void navigate({ to: "/connect" });
  }

  const pillStatus = connectionStatusToPill(connection.status);
  // Project name = the Figma file the user connected; the repo is a detail below.
  const projectName =
    fileName ??
    snapshot?.name ??
    (connection.repoPath
      ? connection.repoPath.split("/").pop() ?? "Project"
      : "Project");

  const cls = snapshot?.classification ?? null;
  const category = typeof cls?.["category"] === "string" ? cls["category"] : null;
  const layout = typeof cls?.["layout"] === "string" ? cls["layout"] : null;
  const industry = typeof cls?.["industry"] === "string" ? cls["industry"] : null;
  const locale = typeof cls?.["locale"] === "string" ? cls["locale"] : null;
  const ageGroup = typeof cls?.["ageGroup"] === "string" ? cls["ageGroup"] : null;
  const platforms = Array.isArray(cls?.["platforms"])
    ? (cls?.["platforms"] as string[])
    : [];

  const primaryChips = [category, layout].filter(Boolean) as string[];
  const secondaryChips = [industry, locale, ageGroup, ...platforms].filter(
    Boolean,
  ) as string[];
  const overflowCount = expanded ? 0 : secondaryChips.length;

  // Design style: a generative default, not a classification fact — its chip
  // is clickable and edits inline, while the fact chips stay read-only.
  const designStyle =
    typeof cls?.["designStyle"] === "string" ? (cls["designStyle"] as string) : "";
  const styleChipLabel = designStyle
    ? `Style: ${designStyleLabel(designStyle)}`
    : "Style: exploring";

  function handleStyleChipClick(): void {
    setStyleDraft(designStyle);
    setStyleOpen((v) => !v);
  }

  async function handleStyleSave(): Promise<void> {
    if (styleSaving || cls === null) return;
    setStyleSaving(true);
    // Set-or-clear: exploring ("") removes the key so the advisory style gate
    // is not owed and the composer override is the only style input.
    const { designStyle: _prev, ...rest } = cls as Record<string, unknown>;
    const body = { ...rest, ...(styleDraft ? { designStyle: styleDraft } : {}) };
    try {
      await bridge.putClassification(body);
    } catch {
      setStyleSaving(false);
      toast("Could not save style — is the bridge running?");
      return;
    }
    const current = useAppStore.getState().snapshot;
    if (current) {
      const updated = { ...current, classification: body };
      useAppStore.setState({ snapshot: updated });
      queryClient.setQueryData(snapshotQuery(bridge).queryKey, updated);
    }
    void queryClient.invalidateQueries({ queryKey: snapshotQuery(bridge).queryKey });
    setStyleSaving(false);
    setStyleOpen(false);
    toast(styleDraft ? "Design style updated" : "Exploring — set styles per generate");
  }

  if (connection.status === "reconnecting") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 text-sm shrink-0">
        <StatusPill status="reconnecting" />
        <button
          type="button"
          onClick={() => {
            cancelReconnect();
            void navigate({ to: "/connect" });
          }}
          className="ml-auto text-xs text-gray-500 hover:text-gray-700 underline"
          aria-label="Cancel reconnect"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border-b border-gray-200 shrink-0">
      {/* Project name bar — file name leads; repo path is a subtext + hover detail */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <div
          className="flex-1 min-w-0"
          title={connection.repoPath !== "" ? connection.repoPath : undefined}
        >
          <span className="block text-sm font-medium text-gray-900 truncate">
            {projectName}
          </span>
          {connection.repoPath !== "" && (
            <span className="block text-[10px] leading-tight text-gray-400 truncate">
              {connection.repoPath}
            </span>
          )}
        </div>
        <ConnectionDot status={pillStatus} />
        <button
          type="button"
          aria-label={queueCount > 0 ? `Render queue (${queueCount})` : "Render queue"}
          title="Render queue"
          onClick={() => void navigate({ to: "/tabs/queue" })}
          className="relative p-1 text-gray-400 hover:text-gray-600 shrink-0"
        >
          <Inbox size={14} />
          {queueCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-primary-600 text-white text-[9px] font-semibold flex items-center justify-center"
            >
              {queueCount}
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={() => void navigate({ to: "/tabs/settings" })}
          className="p-1 text-gray-400 hover:text-gray-600 shrink-0"
        >
          <SettingsIcon size={14} />
        </button>
        <button
          type="button"
          aria-label="Disconnect"
          title="Disconnect"
          onClick={handleDisconnect}
          className="p-1 text-gray-400 hover:text-red-600 shrink-0"
        >
          <Unplug size={14} />
        </button>
      </div>

      {/* Chips bar — compact chips in their own collapsible row */}
      {(cls !== null || primaryChips.length > 0 || secondaryChips.length > 0) && (
        <div className="flex items-start gap-1 px-3 pb-1.5">
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {cls !== null && (
              <Chip
                size="sm"
                label={styleChipLabel}
                selected={designStyle !== ""}
                tone="default"
                onSelect={handleStyleChipClick}
              />
            )}
            {primaryChips.map((label) => (
              <Chip key={label} size="sm" label={label} selected tone="default" />
            ))}
            {expanded &&
              secondaryChips.map((label) => (
                <Chip key={label} size="sm" label={label} selected tone="default" />
              ))}
            {overflowCount > 0 && (
              <Chip
                size="sm"
                label={`+${overflowCount}`}
                selected={false}
                tone="default"
                onSelect={() => setExpanded(true)}
              />
            )}
          </div>
          <button
            type="button"
            aria-label={
              expanded ? "Collapse project details" : "Expand project details"
            }
            onClick={() => setExpanded((v) => !v)}
            className="p-0.5 text-gray-400 hover:text-gray-600 shrink-0"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      )}

      {/* Inline design-style editor — deployed under the bar by the chip */}
      {styleOpen && cls !== null && (
        <div className="px-3 pt-2 pb-2 border-t border-gray-100 flex flex-col gap-1.5 bg-gray-50">
          <DesignStylePicker
            ariaLabel="Project design style"
            value={styleDraft}
            onChange={setStyleDraft}
            suggested={suggestDesignStyle(category ?? "", industry ?? "")}
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              aria-label="Cancel style edit"
              onClick={() => setStyleOpen(false)}
              className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              aria-label="Save style"
              disabled={styleSaving}
              onClick={() => void handleStyleSave()}
              className="text-xs px-2 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {styleSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TabNav ───────────────────────────────────────────────────────────────────

// NOTE: label "Generate" matches the existing test assertions (app.tsx used "Generate").
// Settings is NOT a tab — it opens via the ContextBar gear button.
const TAB_DEFS: { value: Tab; label: string }[] = [
  { value: "prompt", label: "Generate" },
  { value: "artifacts", label: "Artifacts" },
  { value: "components", label: "Components" },
  { value: "assets", label: "Assets" },
  { value: "checks", label: "Checks" },
];

function deriveTab(pathname: string): Tab {
  const rest = pathname.startsWith("/tabs/")
    ? pathname.slice("/tabs/".length)
    : "prompt";
  // "settings"/"queue" are valid /tabs routes without triggers: Tabs.Root holds
  // the value and simply highlights no tab while those screens are open.
  const known = [...TAB_DEFS.map((t) => t.value), "settings", "queue"] as string[];
  return (known.includes(rest) ? rest : "prompt") as Tab;
}

function TabNav(): React.JSX.Element {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const activeTab = deriveTab(pathname);
  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={(v) => void navigate({ to: `/tabs/${v as Tab}` })}
      className="flex flex-col flex-1 min-h-0"
    >
      <Tabs.List
        aria-label="Panel tabs"
        className="flex border-b border-primary-700 bg-primary-600 shrink-0 overflow-x-auto overflow-y-hidden"
      >
        {TAB_DEFS.map(({ value, label }) => (
          <Tabs.Trigger
            key={value}
            value={value}
            className={[
              "px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              "border-b-2 -mb-px",
              "data-[state=active]:border-white data-[state=active]:text-white data-[state=active]:font-semibold",
              "data-[state=inactive]:border-transparent data-[state=inactive]:text-white/70",
              "data-[state=inactive]:hover:text-white",
            ].join(" ")}
          >
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {/* Must be a flex column with min-h-0: a plain block gives the screen
          auto height, so its own overflow-y-auto never activates (clipped,
          unscrollable) — the tab-panel bug fixed pre-migration in app.tsx. */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <Outlet />
      </div>
    </Tabs.Root>
  );
}

// ─── Route tree ───────────────────────────────────────────────────────────────

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

/** Plugin-window size per route family — posted to the main thread, which
 * calls figma.ui.resize (code.ts opens at a small placeholder 540×220). */
const RESIZE_MAP: Array<[prefix: string, w: number, h: number]> = [
  ["/tabs", 560, 640],
  ["/connect", 540, 760],
  ["/setup", 540, 760],
];

function RootLayout(): React.JSX.Element {
  const { bridge } = rootRoute.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Resize the plugin window when the route family changes. Dropped in the
  // app.tsx → router.tsx move (T1) and caught by the live smoke: without it
  // the window stays at the 540×220 boot placeholder.
  useEffect(() => {
    const entry = RESIZE_MAP.find(([p]) => pathname.startsWith(p)) ?? RESIZE_MAP[1]!;
    const [, w, h] = entry;
    if (typeof parent !== "undefined" && parent !== window) {
      parent.postMessage({ pluginMessage: { type: "resize", width: w, height: h } }, "*");
    }
  }, [pathname]);

  return (
    <div className="flex flex-col h-screen bg-white text-gray-900 overflow-hidden">
      <SnapshotSync bridge={bridge} />
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </div>
      <ToastOverlay />
    </div>
  );
}

const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connect",
  component: ConnectRoute,
});
function ConnectRoute(): React.JSX.Element {
  const { bridge, bus } = connectRoute.useRouteContext();
  const status = useAppStore((s) => s.connection.status);
  return (
    <>
      {status === "reconnecting" && <ContextBar />}
      <Connect bridge={bridge} bus={bus} />
    </>
  );
}

const setupClassificationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup/classification",
  component: SetupClassificationRoute,
});
function SetupClassificationRoute(): React.JSX.Element {
  const { bridge } = setupClassificationRoute.useRouteContext();
  return <SetupClassification bridge={bridge} />;
}

const setupDefaultsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup/defaults",
  component: SetupDefaultsRoute,
});
function SetupDefaultsRoute(): React.JSX.Element {
  const { bridge } = setupDefaultsRoute.useRouteContext();
  return <SetupDefaults bridge={bridge} />;
}

const tabsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tabs",
  component: TabsLayout,
});

/**
 * RenderRelay — the report/error half of the render pipeline.
 *
 * Jobs REACH the canvas only through the Queue screen's explicit Approve
 * (bridge.approveRenderJob → bus.postRender) — the panel never auto-renders
 * queued work. This relay handles what comes back from the main thread:
 * {type:"rendered"} reports forward to POST /rendered (rooted wire), and
 * {type:"render-error"} messages surface as toasts, never silently.
 */
function RenderRelay(): null {
  const { bridge, bus } = tabsRoute.useRouteContext();
  const toast = useAppStore((s) => s.toast);
  useEffect(() => {
    const offRendered = bus.onRendered?.((report) => {
      // The canvas render already happened — a lost report must not be silent,
      // or downstream verify gates run against stale state with no explanation.
      void bridge.postRenderReport?.(report).catch(() => {
        toast("Render report failed to reach the bridge");
      });
    });

    const offRenderError = bus.onRenderError?.((message) => {
      toast(`Canvas render failed: ${message}`);
    });

    return () => {
      offRendered?.();
      offRenderError?.();
    };
  }, [bridge, bus, toast]);
  return null;
}

function TabsLayout(): React.JSX.Element {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <RenderRelay />
      <ContextBar />
      <TabNav />
    </div>
  );
}

const tabsIndexRoute = createRoute({
  getParentRoute: () => tabsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/tabs/prompt" });
  },
});

const promptRoute = createRoute({
  getParentRoute: () => tabsRoute,
  path: "prompt",
  component: PromptRoute,
});
function PromptRoute(): React.JSX.Element {
  const { bridge, bus } = promptRoute.useRouteContext();
  return <Prompt bridge={bridge} bus={bus} />;
}

const artifactsRoute = createRoute({
  getParentRoute: () => tabsRoute,
  path: "artifacts",
  validateSearch: validateArtifactsSearch,
  component: ArtifactsRoute,
});
function ArtifactsRoute(): React.JSX.Element {
  const { bridge } = artifactsRoute.useRouteContext();
  return <Artifacts bridge={bridge} />;
}

const componentsRoute = createRoute({
  getParentRoute: () => tabsRoute,
  path: "components",
  component: ComponentsRoute,
});
function ComponentsRoute(): React.JSX.Element {
  const { bridge, bus } = componentsRoute.useRouteContext();
  return <Components bridge={bridge} bus={bus} />;
}

const assetsRoute = createRoute({
  getParentRoute: () => tabsRoute,
  path: "assets",
  component: AssetsRoute,
});
function AssetsRoute(): React.JSX.Element {
  const { bridge, bus } = assetsRoute.useRouteContext();
  return <Assets bridge={bridge} bus={bus} />;
}

const checksRoute = createRoute({
  getParentRoute: () => tabsRoute,
  path: "checks",
  validateSearch: validateChecksSearch,
  component: ChecksRoute,
});
function ChecksRoute(): React.JSX.Element {
  const { bridge, bus } = checksRoute.useRouteContext();
  return <Checks bridge={bridge} bus={bus} />;
}

const settingsRoute = createRoute({
  getParentRoute: () => tabsRoute,
  path: "settings",
  component: SettingsRoute,
});
function SettingsRoute(): React.JSX.Element {
  const { bridge, bus } = settingsRoute.useRouteContext();
  return <Settings bridge={bridge} bus={bus} />;
}

const queueRoute = createRoute({
  getParentRoute: () => tabsRoute,
  path: "queue",
  component: QueueRoute,
});
function QueueRoute(): React.JSX.Element {
  const { bridge, bus } = queueRoute.useRouteContext();
  return <Queue bridge={bridge} bus={bus} />;
}

const routeTree = rootRoute.addChildren([
  connectRoute,
  setupClassificationRoute,
  setupDefaultsRoute,
  tabsRoute.addChildren([
    tabsIndexRoute,
    promptRoute,
    artifactsRoute,
    componentsRoute,
    assetsRoute,
    checksRoute,
    settingsRoute,
    queueRoute,
  ]),
]);

export function createAppRouter(
  ctx: RouterContext,
  initialEntries: string[] = ["/connect"],
) {
  return createRouter({
    routeTree,
    context: ctx,
    history: createMemoryHistory({ initialEntries }),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

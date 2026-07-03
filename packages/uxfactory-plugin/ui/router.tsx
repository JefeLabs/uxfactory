/**
 * router.tsx — Code-based TanStack Router tree (createMemoryHistory) + the
 * shell chrome (ContextBar, TabNav, toast overlay) formerly in app.tsx.
 *
 * The iframe has no URL bar, so we mount on memory history today; the same
 * tree runs on browser history in the future web shell.
 *
 * StoreRouteBridge is a TEMPORARY bridge: it mirrors the still-present
 * app-store route/focus into router navigation so screens not yet migrated
 * keep driving navigation. Deleted in Task 7 with the store route/focus.
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
  type NavigateOptions,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useAppStore } from "./stores/app.js";
import type { Tab, FocusIntent } from "./stores/app.js";
import { Chip, StatusPill } from "./components/index.js";
import type { StatusPillStatus } from "./components/index.js";
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

// ─── Interim store→router bridge (removed in Task 7) ──────────────────────────

export function mapStoreRouteToLocation(
  screen: "connect" | "setup-1" | "setup-2" | "tabs",
  tab: Tab,
  focus: FocusIntent | null,
): NavigateOptions {
  if (screen === "connect") return { to: "/connect" };
  if (screen === "setup-1") return { to: "/setup/classification" };
  if (screen === "setup-2") return { to: "/setup/defaults" };
  if (tab === "checks") {
    return {
      to: "/tabs/checks",
      search: focus?.runId ? { run: focus.runId } : {},
    };
  }
  if (tab === "artifacts") {
    return {
      to: "/tabs/artifacts",
      search: focus?.artifactKey ? { focus: focus.artifactKey } : {},
    };
  }
  return { to: `/tabs/${tab}` };
}

function StoreRouteBridge(): null {
  const navigate = useNavigate();
  const screen = useAppStore((s) => s.route.screen);
  const tab = useAppStore((s) => s.route.tab);
  const focus = useAppStore((s) => s.focus);
  useEffect(() => {
    void navigate(mapStoreRouteToLocation(screen, tab, focus));
  }, [screen, tab, focus, navigate]);
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

function ContextBar(): React.JSX.Element {
  const connection = useAppStore((s) => s.connection);
  const snapshot = useAppStore((s) => s.snapshot);
  const cancelReconnect = useAppStore((s) => s.cancelReconnect);
  const [expanded, setExpanded] = useState(false);

  const pillStatus = connectionStatusToPill(connection.status);
  const projectName =
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

  if (connection.status === "reconnecting") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 text-sm shrink-0">
        <StatusPill status="reconnecting" />
        <button
          type="button"
          onClick={cancelReconnect}
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
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-sm font-medium text-gray-900 truncate flex-1 min-w-0">
          {projectName}
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          {primaryChips.map((label) => (
            <Chip key={label} label={label} selected tone="default" />
          ))}
          {overflowCount > 0 && (
            <Chip label={`+${overflowCount}`} selected={false} tone="default" />
          )}
        </div>
        <StatusPill status={pillStatus} />
        <button
          type="button"
          aria-label={
            expanded ? "Collapse project details" : "Expand project details"
          }
          onClick={() => setExpanded((v) => !v)}
          className="p-1 text-gray-400 hover:text-gray-600 shrink-0"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {expanded && secondaryChips.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {secondaryChips.map((label) => (
            <Chip key={label} label={label} selected tone="default" />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TabNav ───────────────────────────────────────────────────────────────────

// NOTE: label "Generate" matches the existing test assertions (app.tsx used "Generate").
const TAB_DEFS: { value: Tab; label: string }[] = [
  { value: "prompt", label: "Generate" },
  { value: "artifacts", label: "Artifacts" },
  { value: "components", label: "Components" },
  { value: "assets", label: "Assets" },
  { value: "checks", label: "Checks" },
  { value: "settings", label: "Settings" },
];

function deriveTab(pathname: string): Tab {
  const rest = pathname.startsWith("/tabs/")
    ? pathname.slice("/tabs/".length)
    : "prompt";
  const known = TAB_DEFS.map((t) => t.value) as string[];
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
        className="flex border-b border-gray-200 bg-white shrink-0 overflow-x-auto"
      >
        {TAB_DEFS.map(({ value, label }) => (
          <Tabs.Trigger
            key={value}
            value={value}
            className={[
              "px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              "border-b-2 -mb-px",
              "data-[state=active]:border-primary-600 data-[state=active]:text-primary-600",
              "data-[state=inactive]:border-transparent data-[state=inactive]:text-gray-500",
              "data-[state=inactive]:hover:text-gray-700",
            ].join(" ")}
          >
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </Tabs.Root>
  );
}

// ─── Route tree ───────────────────────────────────────────────────────────────

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout(): React.JSX.Element {
  return (
    <div className="flex flex-col h-screen bg-white text-gray-900 overflow-hidden">
      <StoreRouteBridge />
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
function TabsLayout(): React.JSX.Element {
  return (
    <div className="flex flex-col flex-1 min-h-0">
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

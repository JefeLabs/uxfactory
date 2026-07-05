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
import {
  Chip,
  ContextChipEditor,
  CHIP_FIELD_LABEL,
  CLASSIFICATION_FIELDS,
  StatusPill,
} from "./components/index.js";
import type { ChipField, StatusPillStatus } from "./components/index.js";
import { designStyleLabel, suggestDesignStyle } from "./lib/design-styles.js";
import { engineToLabel } from "./lib/dials.js";
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

/** Narrow unknown to a plain object record (else empty). */
function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

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

  // Inline chip editor deployed UNDER the bar (any chip click toggles it).
  const [editing, setEditing] = useState<ChipField | null>(null);
  const [draft, setDraft] = useState<string | string[]>("");
  const [chipSaving, setChipSaving] = useState(false);

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

  // Generative-default dials — profile.scope.* + experimental.coherence, plus
  // tone which lives in classification.style. Only set dials get a chip.
  const profileRec = asRecord(snapshot?.profile);
  const scopeRec = asRecord(profileRec["scope"]);
  const experimentalRec = asRecord(profileRec["experimental"]);
  const dialChips: { field: ChipField; label: string; engine: string; display: string }[] = [];
  const pushDial = (field: ChipField, label: string, raw: unknown, map: Record<string, string>) => {
    if (typeof raw !== "string") return;
    dialChips.push({ field, label, engine: raw, display: map[raw] ?? raw });
  };
  pushDial("tone", "Tone", cls?.["style"], engineToLabel.style);
  pushDial("visual", "Visual", scopeRec["visual"], engineToLabel.visual);
  pushDial("editorial", "Editorial", scopeRec["editorial"], engineToLabel.editorial);
  pushDial("flow", "Flows", scopeRec["flow"], engineToLabel.flows);
  pushDial("coverage", "Coverage", scopeRec["coverage"], engineToLabel.coverage);
  pushDial("coherence", "Coherence", experimentalRec["coherence"], engineToLabel.coherence);

  // Design style: a generative default with an explicit exploring state.
  const designStyle =
    typeof cls?.["designStyle"] === "string" ? (cls["designStyle"] as string) : "";

  // One labelled chip per configured value, in the SAME order as project
  // setup: step-1 classification facts, then step-2 generative defaults.
  // Platforms fold into a single "Platform a|b" chip.
  const configChips: { field: ChipField; label: string; value: string }[] = [];
  const pushChip = (field: ChipField, label: string, value: string | null) => {
    if (value !== null && value !== "") configChips.push({ field, label, value });
  };
  pushChip("category", "Category", category);
  pushChip("industry", "Industry", industry);
  pushChip("locale", "Locale", locale);
  pushChip("platforms", "Platform", platforms.length > 0 ? platforms.join("|") : null);
  pushChip("layout", "Layout", layout);
  pushChip("ageGroup", "Age", ageGroup);
  configChips.push({
    field: "designStyle",
    label: "Style",
    value: designStyle ? designStyleLabel(designStyle) : "exploring",
  });
  for (const d of dialChips) {
    configChips.push({ field: d.field, label: d.label, value: d.display });
  }

  // Collapsed default: a "Project config:" label + ONE chip carrying the
  // total count. Expanding (+N or the chevron) reveals every chip, each
  // editable inline.
  const overflowCount = expanded ? 0 : configChips.length;

  /** Toggle the under-bar editor for a chip, seeding the draft from live state. */
  function openChip(field: ChipField): void {
    if (editing === field) {
      setEditing(null);
      return;
    }
    if (field === "platforms") {
      setDraft(Array.isArray(cls?.["platforms"]) ? [...(cls["platforms"] as string[])] : []);
    } else if (CLASSIFICATION_FIELDS.has(field)) {
      setDraft(typeof cls?.[field] === "string" ? (cls[field] as string) : "");
    } else {
      setDraft(dialChips.find((d) => d.field === field)?.engine ?? "");
    }
    setEditing(field);
  }

  /** Optimistically apply a snapshot patch to the store + query cache. */
  function patchSnapshot(
    patch: (snap: NonNullable<typeof snapshot>) => NonNullable<typeof snapshot>,
  ): void {
    const current = useAppStore.getState().snapshot;
    if (!current) return;
    const updated = patch(current);
    useAppStore.setState({ snapshot: updated });
    queryClient.setQueryData(snapshotQuery(bridge).queryKey, updated);
  }

  async function handleChipSave(): Promise<void> {
    if (chipSaving || editing === null || cls === null) return;
    const field = editing;
    setChipSaving(true);
    try {
      if (CLASSIFICATION_FIELDS.has(field)) {
        // One merged classification body. designStyle is set-or-clear:
        // exploring ("") removes the key so the advisory style gate is not
        // owed and the composer override is the only style input.
        const { designStyle: prevStyle, ...rest } = cls as Record<string, unknown>;
        const body: Record<string, unknown> =
          field === "designStyle"
            ? { ...rest, ...(typeof draft === "string" && draft !== "" ? { designStyle: draft } : {}) }
            : {
                ...rest,
                ...(prevStyle !== undefined ? { designStyle: prevStyle } : {}),
                [field]: draft,
              };
        await bridge.putClassification(body);
        patchSnapshot((snap) => ({ ...snap, classification: body }));
      } else if (field === "tone") {
        // Tone rides the profile endpoint's `style` key (it stamps
        // classification.style server-side — mirror that locally).
        await bridge.putProfile({ style: draft });
        patchSnapshot((snap) => ({
          ...snap,
          classification: { ...asRecord(snap.classification), style: draft },
        }));
      } else {
        await bridge.putProfile({ [field]: draft });
        patchSnapshot((snap) => {
          const p = asRecord(snap.profile);
          if (field === "coherence") {
            return {
              ...snap,
              profile: { ...p, experimental: { ...asRecord(p["experimental"]), coherence: draft } },
            };
          }
          return { ...snap, profile: { ...p, scope: { ...asRecord(p["scope"]), [field]: draft } } };
        });
      }
    } catch {
      setChipSaving(false);
      toast("Could not save — is the bridge running?");
      return;
    }
    void queryClient.invalidateQueries({ queryKey: snapshotQuery(bridge).queryKey });
    setChipSaving(false);
    setEditing(null);
    toast(`Updated ${CHIP_FIELD_LABEL[field]}`);
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
      <div className="flex items-center gap-2 px-3 pt-2 pb-2.5">
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

      {/* Chips bar — collapsed to a label + total count; expanded chips edit inline */}
      {cls !== null && (
        <div className="flex items-start gap-1 px-3 pb-3">
          <span className="text-[11px] text-gray-400 shrink-0 leading-5 select-none">
            Project config:
          </span>
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {expanded &&
              configChips.map((c) => (
                <Chip
                  key={c.field}
                  size="sm"
                  label={c.label}
                  value={c.value}
                  // Selection = this chip's editor is open (primary border).
                  selected={editing === c.field}
                  tone="dial"
                  onSelect={() => openChip(c.field)}
                />
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

      {/* Inline chip editor — deployed under the bar by whichever chip was clicked */}
      {editing !== null && cls !== null && (
        <div className="px-3 pt-2 pb-2 border-t border-gray-100 flex flex-col gap-1.5 bg-gray-50">
          <ContextChipEditor
            field={editing}
            draft={draft}
            onChange={setDraft}
            suggestedStyle={suggestDesignStyle(category ?? "", industry ?? "")}
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              aria-label={`Cancel ${CHIP_FIELD_LABEL[editing]} edit`}
              onClick={() => setEditing(null)}
              className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              aria-label={`Save ${CHIP_FIELD_LABEL[editing]}`}
              disabled={chipSaving}
              onClick={() => void handleChipSave()}
              className="text-xs px-2 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {chipSaving ? "Saving…" : "Save"}
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

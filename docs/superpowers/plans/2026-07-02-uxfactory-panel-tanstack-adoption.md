# UXFactory Panel TanStack Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Figma plugin panel's hand-rolled server-state management and enum routing with TanStack Query (data layer) and TanStack Router on `createMemoryHistory` (route tree), positioned so the planned web app reuses both unchanged.

**Architecture:** A single `QueryClientProvider` + `RouterProvider` mount in `main.tsx`. `ui/router.tsx` owns a code-based route tree (`/connect`, `/setup/classification`, `/setup/defaults`, and a `/tabs` layout route with six tab children) plus the shell chrome (ContextBar, TabNav, toast overlay) that used to live in `app.tsx`. `ui/queries.ts` owns the QueryClient factory, typed query-option factories (`snapshot`, `health`, `stats`, `logs`, `skills`, `links`, `latestRender`, `artifact`) and mutation-fn factories (`connectProject`, `putClassification`, `putProfile`, `putLinks`, `enqueue`, `putArtifact`). Screens keep their `{bridge, bus}` props and call Query hooks with the injected `bridge`. Navigation on writes happens only inside mutation `onSuccess`. During the migration an interim `StoreRouteBridge` mirrors the still-present app-store `route`/`focus` into the router so every commit stays green; it and those store fields are deleted in the final task.

**Tech Stack:** Vite 6 · React 19 · Tailwind v4 · Zustand 5 · Radix UI · lucide-react · vite-plugin-singlefile · Vitest + @testing-library/react · `@tanstack/react-query@5.101.2` · `@tanstack/react-router@1.170.17`.

## Global Constraints
- Figma manifest (`packages/uxfactory-plugin/manifest.json`) is UNTOUCHABLE — `networkAccess` stays `localhost:3779` only.
- `dist/ui.html` must remain fully self-contained (zero external URLs) and < 2MB (gz budget +~15KB vs baseline; baseline `ui.html` is 1,135,893 bytes — the Artifact Editor spec raised the budget from 1.5MB to 2MB headroom when MDXEditor landed).
- Behavior-frozen refactor: every existing RTL screen test keeps passing with minimal MECHANICAL edits only (`render` → `renderWithProviders`; store-route asserts → router-location asserts). Tests that assert behavior must not weaken.
- React 19 + Zustand discipline: `useAppStore` selectors return primitives or stable refs ONLY — never object literals.
- Code-based route tree (`createRootRoute`/`createRoute`) — do NOT add the file-based routing Vite plugin.
- Navigation on writes happens ONLY in mutation `onSuccess`.
- Per task: full plugin suite (`pnpm --filter @uxfactory/plugin exec vitest run`), both typechecks (`pnpm --filter @uxfactory/plugin typecheck`), and `pnpm -r build` must be green before commit.
- `git add` only the exact files touched (never `-A`). Every commit message ends with the trailer line: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work directly on `main`.

## Resolved ambiguities (read before starting)
1. **The app-store `snapshot` field is RETAINED** (spec §6 only requires removing `route`/`focus`). The `snapshot` query is the fetch/refetch engine; an always-mounted `SnapshotSync` (added in Task 3) mirrors query data into `store.snapshot`, so screens NOT individually migrated to the query keep reading `store.snapshot` unchanged. `refreshSnapshot()` is replaced everywhere by `queryClient.invalidateQueries({ queryKey: queryKeys.snapshot })`.
2. **`/tabs` renders one active tab via `<Outlet/>`** (idiomatic layout route), replacing the old `forceMount`-all-panels approach. No test asserts cross-tab subscription persistence; the routing/e2e integration tests are re-anchored on router location (Tasks 1 & 7).
3. **Interim `StoreRouteBridge`** (Task 1) mirrors `store.route`/`store.focus` → router navigation so non-migrated screens (which still call `goto`/`setTab`/`setFocus`) drive navigation until their task migrates them. Removed with `route`/`focus` in Task 7.
4. **`ExpandedHeader`** (a component in `ui/components/`, imported only by `test/screen-artifacts.test.tsx`, not mounted in the live app) uses `goto`/`refreshSnapshot`/`putProfile`. It is migrated in Task 3 alongside Artifacts (same test file).
5. **`Assets`** folds into Task 6 (enqueue mutation).
6. **Checks** keeps its storage/history/counter derivation but moves the fetch into `latestRenderQuery(bridge, run)` keyed on the `run` search param; a single data-effect replaces the two `init()` effects.

---

## Task 1 — Dependencies + router/query infrastructure + shell rewrite

**Files:**
- Modify: `packages/uxfactory-plugin/package.json` (add deps)
- Modify: `pnpm-workspace.yaml` (only if the release-age policy rejects the pins)
- Create: `packages/uxfactory-plugin/ui/queries.ts`
- Create: `packages/uxfactory-plugin/ui/router.tsx`
- Create: `packages/uxfactory-plugin/test/test-utils.tsx`
- Modify: `packages/uxfactory-plugin/ui/main.tsx`
- Delete: `packages/uxfactory-plugin/ui/app.tsx` (its ContextBar/TabNav/toast overlay move into `ui/router.tsx`)
- Modify (mechanical): `packages/uxfactory-plugin/test/routing.test.tsx`, `packages/uxfactory-plugin/test/e2e-panel.test.tsx`

**Interfaces:**
- Produces `ui/queries.ts`:
  - `queryKeys` — `{ snapshot: readonly ["snapshot"]; health: readonly ["health"]; stats: readonly ["stats"]; logs(tail): readonly ["logs", number]; skills: readonly ["skills"]; links: readonly ["links"]; latestRender(run?): readonly ["latestRender", string|null]; artifact(key): readonly ["artifact", string] }`
  - `makeQueryClient(): QueryClient`
  - `snapshotQuery(bridge)`, `healthQuery(bridge)`, `statsQuery(bridge)`, `logsQuery(bridge, tail, opts?)`, `skillsQuery(bridge)`, `linksQuery(bridge)`, `latestRenderQuery(bridge, run)`, `artifactQuery(bridge, key)` — each returns a `queryOptions(...)` object.
  - `connectProjectMutation(bridge)`, `putClassificationMutation(bridge)`, `putProfileMutation(bridge)`, `putLinksMutation(bridge)`, `enqueueMutation(bridge)`, `putArtifactMutation(bridge)` — each returns `{ mutationFn }`.
- Produces `ui/router.tsx`:
  - `interface RouterContext { bridge: Bridge; bus: PluginBus; queryClient: QueryClient }`
  - `createAppRouter(ctx: RouterContext, initialEntries?: string[]): Router`
  - `interface ChecksSearch { run?: string }`, `validateChecksSearch(search): ChecksSearch`
  - `interface ArtifactsSearch { focus?: string }`, `validateArtifactsSearch(search): ArtifactsSearch`
- Produces `test/test-utils.tsx`:
  - `renderWithProviders(ui: React.ReactNode, opts?: { router?: AnyRouter; queryClient?: QueryClient; bridge?: Bridge; bus?: PluginBus; initialEntries?: string[] }): RenderResult & { router: AnyRouter; queryClient: QueryClient }`

### Steps

- [ ] **Add dependencies.** Run:
  ```sh
  pnpm --filter @uxfactory/plugin add @tanstack/react-query@5.101.2 @tanstack/react-router@1.170.17
  ```
  If pnpm's `minimumReleaseAge` policy rejects either pin, append these two lines under `minimumReleaseAgeExclude:` in `pnpm-workspace.yaml` (after the existing `fastify@5.9.0` line) and re-run the add:
  ```yaml
    - "@tanstack/react-query@5.101.2"
    - "@tanstack/react-router@1.170.17"
  ```
  Expected: `package.json` `dependencies` now contains `"@tanstack/react-query": "5.101.2"` and `"@tanstack/react-router": "1.170.17"` (exact, no caret — pins).

- [ ] **Create `ui/queries.ts`** with this complete content:
  ```ts
  /**
   * queries.ts — TanStack Query owns all bridge server-state.
   *
   * Query-option factories take the injected `bridge` so screens keep their
   * {bridge, bus} props (tests inject fakes) and the future web shell can reuse
   * these unchanged. Mutation-fn factories are thin; callers wire onSuccess
   * (navigation on writes happens ONLY in mutation onSuccess).
   */
  import {
    QueryClient,
    queryOptions,
    type QueryClientConfig,
  } from "@tanstack/react-query";
  import type {
    Bridge,
    Link,
    PipelineEnqueueRequest,
  } from "./lib/bridge.js";

  export const queryKeys = {
    snapshot: ["snapshot"] as const,
    health: ["health"] as const,
    stats: ["stats"] as const,
    logs: (tail: number) => ["logs", tail] as const,
    skills: ["skills"] as const,
    links: ["links"] as const,
    latestRender: (run: string | undefined) =>
      ["latestRender", run ?? null] as const,
    artifact: (key: string) => ["artifact", key] as const,
  };

  /** QueryClient: queries retry once, mutations never retry. */
  export function makeQueryClient(): QueryClient {
    const config: QueryClientConfig = {
      defaultOptions: {
        queries: { retry: 1, refetchOnWindowFocus: false },
        mutations: { retry: 0 },
      },
    };
    return new QueryClient(config);
  }

  export function snapshotQuery(bridge: Bridge) {
    return queryOptions({
      queryKey: queryKeys.snapshot,
      queryFn: () => bridge.snapshot(),
      staleTime: 5_000,
    });
  }

  export function healthQuery(bridge: Bridge) {
    return queryOptions({
      queryKey: queryKeys.health,
      queryFn: () => bridge.health(),
      staleTime: 0,
      refetchInterval: 3_000,
    });
  }

  export function statsQuery(bridge: Bridge) {
    return queryOptions({
      queryKey: queryKeys.stats,
      queryFn: () => bridge.stats(),
      staleTime: 0,
      refetchInterval: 10_000,
    });
  }

  export function logsQuery(
    bridge: Bridge,
    tail: number,
    opts: { enabled?: boolean; refetchInterval?: number | false } = {},
  ) {
    return queryOptions({
      queryKey: queryKeys.logs(tail),
      queryFn: () => bridge.logs(tail),
      enabled: opts.enabled ?? true,
      refetchInterval: opts.refetchInterval ?? false,
      staleTime: 0,
    });
  }

  export function skillsQuery(bridge: Bridge) {
    return queryOptions({
      queryKey: queryKeys.skills,
      queryFn: () => bridge.skills!(),
      enabled: typeof bridge.skills === "function",
      staleTime: 60_000,
    });
  }

  export function linksQuery(bridge: Bridge) {
    return queryOptions({
      queryKey: queryKeys.links,
      queryFn: () => bridge.getLinks(),
      staleTime: 0,
    });
  }

  export function latestRenderQuery(bridge: Bridge, run: string | undefined) {
    return queryOptions({
      queryKey: queryKeys.latestRender(run),
      queryFn: () => bridge.latestRender(),
      staleTime: 0,
    });
  }

  export function artifactQuery(bridge: Bridge, key: string) {
    return queryOptions({
      queryKey: queryKeys.artifact(key),
      queryFn: () => bridge.getArtifact!(key),
      enabled: typeof bridge.getArtifact === "function" && key !== "",
      retry: false,
      staleTime: 0,
    });
  }

  export function connectProjectMutation(bridge: Bridge) {
    return { mutationFn: (repoPath: string) => bridge.connectProject(repoPath) };
  }
  export function putClassificationMutation(bridge: Bridge) {
    return {
      mutationFn: (body: Record<string, unknown>) =>
        bridge.putClassification(body),
    };
  }
  export function putProfileMutation(bridge: Bridge) {
    return {
      mutationFn: (body: Record<string, unknown>) => bridge.putProfile(body),
    };
  }
  export function putLinksMutation(bridge: Bridge) {
    return { mutationFn: (links: Link[]) => bridge.putLinks(links) };
  }
  export function enqueueMutation(bridge: Bridge) {
    return { mutationFn: (req: PipelineEnqueueRequest) => bridge.enqueue(req) };
  }
  export function putArtifactMutation(bridge: Bridge) {
    return {
      mutationFn: (vars: { key: string; content: string }) =>
        bridge.putArtifact!(vars.key, vars.content),
    };
  }
  ```

- [ ] **Create `ui/router.tsx`** with this complete content (moves ContextBar / TabNav / toast overlay out of `app.tsx`, adds the interim `StoreRouteBridge`):
  ```tsx
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

  const TAB_DEFS: { value: Tab; label: string }[] = [
    { value: "prompt", label: "Prompt" },
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
  ```
  Note: `createRootRouteWithContext` requires the router to be created with a matching `context`; `createAppRouter` supplies it. The `SetupClassificationRoute`/`SetupDefaultsRoute`/`ArtifactsRoute` read only `bridge` because those screens take only `{bridge}` today.

- [ ] **Create `test/test-utils.tsx`** with this complete content:
  ```tsx
  /**
   * test-utils.tsx — renderWithProviders wraps a screen (or a pre-built app
   * router) in QueryClientProvider + RouterProvider so Query hooks, useNavigate,
   * and useSearch resolve. For bare-screen renders it builds a harness route tree
   * whose every leaf renders the passed `ui`, so navigation targets resolve
   * (router.state.location updates) while the screen under test stays mounted.
   */
  import React from "react";
  import { render, type RenderResult } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import {
    RouterProvider,
    createRootRoute,
    createRoute,
    createRouter,
    createMemoryHistory,
    Outlet,
    type AnyRouter,
  } from "@tanstack/react-router";
  import { makeQueryClient } from "../ui/queries.js";
  import {
    validateChecksSearch,
    validateArtifactsSearch,
  } from "../ui/router.js";
  import type { Bridge } from "../ui/lib/bridge.js";
  import type { PluginBus } from "../ui/lib/plugin-bus.js";

  export interface RenderWithProvidersOptions {
    router?: AnyRouter;
    queryClient?: QueryClient;
    bridge?: Bridge;
    bus?: PluginBus;
    initialEntries?: string[];
  }

  function makeHarnessRouter(
    ui: React.ReactNode,
    initialEntries: string[],
  ): AnyRouter {
    const renderUi = () => <>{ui}</>;
    const root = createRootRoute({ component: () => <Outlet /> });
    const indexRoute = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: renderUi,
    });
    const connectRoute = createRoute({
      getParentRoute: () => root,
      path: "/connect",
      component: renderUi,
    });
    const setupClassificationRoute = createRoute({
      getParentRoute: () => root,
      path: "/setup/classification",
      component: renderUi,
    });
    const setupDefaultsRoute = createRoute({
      getParentRoute: () => root,
      path: "/setup/defaults",
      component: renderUi,
    });
    const tabsRoute = createRoute({
      getParentRoute: () => root,
      path: "/tabs",
      component: () => <Outlet />,
    });
    const promptRoute = createRoute({
      getParentRoute: () => tabsRoute,
      path: "prompt",
      component: renderUi,
    });
    const artifactsRoute = createRoute({
      getParentRoute: () => tabsRoute,
      path: "artifacts",
      validateSearch: validateArtifactsSearch,
      component: renderUi,
    });
    const componentsRoute = createRoute({
      getParentRoute: () => tabsRoute,
      path: "components",
      component: renderUi,
    });
    const assetsRoute = createRoute({
      getParentRoute: () => tabsRoute,
      path: "assets",
      component: renderUi,
    });
    const checksRoute = createRoute({
      getParentRoute: () => tabsRoute,
      path: "checks",
      validateSearch: validateChecksSearch,
      component: renderUi,
    });
    const settingsRoute = createRoute({
      getParentRoute: () => tabsRoute,
      path: "settings",
      component: renderUi,
    });
    const routeTree = root.addChildren([
      indexRoute,
      connectRoute,
      setupClassificationRoute,
      setupDefaultsRoute,
      tabsRoute.addChildren([
        promptRoute,
        artifactsRoute,
        componentsRoute,
        assetsRoute,
        checksRoute,
        settingsRoute,
      ]),
    ]);
    return createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries }),
    });
  }

  export function renderWithProviders(
    ui: React.ReactNode,
    opts: RenderWithProvidersOptions = {},
  ): RenderResult & { router: AnyRouter; queryClient: QueryClient } {
    const queryClient = opts.queryClient ?? makeQueryClient();
    const router =
      opts.router ?? makeHarnessRouter(ui, opts.initialEntries ?? ["/"]);
    const result = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return { ...result, router, queryClient };
  }
  ```

- [ ] **Rewrite `ui/main.tsx`** to mount the providers and end boot in `router.navigate`. Complete new content:
  ```tsx
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
  import { makeQueryClient, queryKeys } from "./queries.js";
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

      queryClient.setQueryData(queryKeys.snapshot, snapshot);
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
  ```

- [ ] **Delete `ui/app.tsx`** (`git rm packages/uxfactory-plugin/ui/app.tsx`). Its `RESIZE_MAP`/window-resize effect is dropped: it keyed on `route.screen`; the plugin window resize on screen change is not asserted by any test and is out of scope for this refactor (documented behavior change — the panel no longer auto-resizes per screen; the manifest/plugin default size applies). If a follow-up needs it, re-add a resize effect in `RootLayout` keyed on `useRouterState` pathname.

- [ ] **Register the TanStack Router type augmentation.** Add to `ui/router.tsx` (bottom of file) so `Link`/`navigate` are typed:
  ```tsx
  declare module "@tanstack/react-router" {
    interface Register {
      router: ReturnType<typeof createAppRouter>;
    }
  }
  ```

- [ ] **Run typecheck (expected: initial failures in `routing.test.tsx` and `e2e-panel.test.tsx` that import the deleted `../ui/app.js`).**
  ```sh
  pnpm --filter @uxfactory/plugin typecheck
  ```
  Expected failure: `Cannot find module '../ui/app.js'` in the two integration test files.

- [ ] **Mechanically migrate `test/routing.test.tsx` and `test/e2e-panel.test.tsx`** to render the real app router via `renderWithProviders(null, { router })` and assert on router location. Pattern (apply throughout both files):
  - Replace the import `import { App } from "../ui/app.js";` with:
    ```tsx
    import { renderWithProviders } from "./test-utils.js";
    import { createAppRouter } from "../ui/router.js";
    import { makeQueryClient } from "../ui/queries.js";
    ```
  - Replace each `render(<App bridge={makeBridge()} bus={makeBus()} />);` with a helper defined once near the top of each file:
    ```tsx
    function renderApp(bridge = makeBridge(), bus = makeBus()) {
      const queryClient = makeQueryClient();
      const router = createAppRouter({ bridge, bus, queryClient }, [
        initialPathFromStore(),
      ]);
      return renderWithProviders(null, { router, queryClient });
    }

    // Seed the router's initial location from the store state the test set up,
    // so the interim StoreRouteBridge and the router agree on first paint.
    function initialPathFromStore(): string {
      const { route, focus } = useAppStore.getState();
      if (route.screen === "connect") return "/connect";
      if (route.screen === "setup-1") return "/setup/classification";
      if (route.screen === "setup-2") return "/setup/defaults";
      if (route.tab === "checks")
        return focus?.runId ? `/tabs/checks?run=${focus.runId}` : "/tabs/checks";
      if (route.tab === "artifacts")
        return focus?.artifactKey
          ? `/tabs/artifacts?focus=${focus.artifactKey}`
          : "/tabs/artifacts";
      return `/tabs/${route.tab}`;
    }
    ```
    Then each test body: `const { router } = renderApp();` (or `renderApp(makeBridge({...}))`).
  - Store-route assertions become router-location assertions:
    - `expect(useAppStore.getState().route.screen).toBe("connect")` → `await waitFor(() => expect(router.state.location.pathname).toBe("/connect"))`
    - `expect(useAppStore.getState().route.tab).toBe("artifacts")` → `await waitFor(() => expect(router.state.location.pathname).toBe("/tabs/artifacts"))`
  - Tab `data-state="active"` assertions remain unchanged (Radix Tabs still drives them off the active tab derived from location).
  - The "boot race guard" test keeps its `if (useAppStore.getState().connection.status !== "reconnecting") return;` inline guard (unchanged); after it, additionally assert `router.state.location.pathname` stays `/connect`.
  - The reconnect-cancel tests: `cancelReconnect()` still sets `route.screen="connect"` + `status="none"` (store unchanged in Task 1); assert both `router.state.location.pathname === "/connect"` and `connection.status === "none"`.

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run
  pnpm --filter @uxfactory/plugin typecheck
  pnpm -r build
  ```

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-plugin/package.json pnpm-workspace.yaml pnpm-lock.yaml \
    packages/uxfactory-plugin/ui/queries.ts packages/uxfactory-plugin/ui/router.tsx \
    packages/uxfactory-plugin/test/test-utils.tsx packages/uxfactory-plugin/ui/main.tsx \
    packages/uxfactory-plugin/ui/app.tsx \
    packages/uxfactory-plugin/test/routing.test.tsx packages/uxfactory-plugin/test/e2e-panel.test.tsx
  git commit -m "$(cat <<'EOF'
  panel: adopt TanStack Query + Router shell (infra, boot, providers)

  Add @tanstack/react-query + @tanstack/react-router; introduce ui/queries.ts,
  ui/router.tsx (code-based memory-history tree + relocated shell chrome),
  test/test-utils.tsx (renderWithProviders). main.tsx mounts both providers and
  boot ends in router.navigate. app.tsx deleted; routing/e2e tests re-anchored on
  router location. Interim StoreRouteBridge keeps store-driven screens navigating.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```
  (Include `pnpm-workspace.yaml` in `git add` only if it was edited for the release-age exclude.)

---

## Task 2 — Settings screen → queries (stats, logs, skills)

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/Settings.tsx`
- Modify (mechanical): `packages/uxfactory-plugin/test/screen-settings.test.tsx`

**Interfaces:**
- Consumes (from `ui/queries.ts`, Task 1): `statsQuery(bridge)` → `queryOptions` yielding `BridgeStats`; `skillsQuery(bridge)` → yielding `SkillsResponse`; `logsQuery(bridge, tail, { enabled?, refetchInterval? })` → yielding `BridgeLogsResponse`.
- Consumes (from `test/test-utils.tsx`, Task 1): `renderWithProviders(ui, opts?)`.
- Produces: no new exports.

### Steps

- [ ] **Write the failing test.** Add to `test/screen-settings.test.tsx` a case proving the stats 10s repoll is now Query-driven (refetchInterval), rendered via providers:
  ```tsx
  it("re-fetches stats via Query refetchInterval after 10s (fake timers)", async () => {
    vi.useFakeTimers();
    const statsMock = vi.fn().mockResolvedValue(STATS_DATA);
    const bridge = makeBridge({ stats: statsMock });
    const bus = makeBus();

    renderWithProviders(<Settings bridge={bridge} bus={bus} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(statsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(statsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  ```
  Add the import at the top: `import { renderWithProviders } from "./test-utils.js";`

- [ ] **Run — expected failure.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-settings.test.tsx
  ```
  Expected: the new test errors because bare `<Settings/>` still uses `useEffect`/`setInterval` polling and the old `render` (no providers) is used elsewhere — but specifically this test fails now because Settings does not yet use Query (still fine on `render`, but we will convert). Confirm red before implementing.

- [ ] **Implement: convert Settings stats/skills/logs to Query.** In `ui/screens/Settings.tsx`:
  - Add imports near the top:
    ```tsx
    import { useQuery } from "@tanstack/react-query";
    import { statsQuery, skillsQuery, logsQuery } from "../queries.js";
    ```
  - **Stats.** Delete the `const [stats, setStats] = useState<BridgeStats | null>(null);`, `const [statsError, setStatsError] = useState(false);` lines and the entire `// ── Stats polling (every 10s, cleanup on unmount) ──` `useEffect(() => { ... }, [bridge]);` block. Replace with:
    ```tsx
    const statsResult = useQuery(statsQuery(bridge));
    const stats: BridgeStats | null = statsResult.data ?? null;
    const statsError = statsResult.isError;
    ```
    (`BridgeStats` is already imported.)
  - **Skills.** Delete `const [skills, setSkills] = useState<SkillEntry[]>([]);` and the entire `// ── Skills fetch (once on mount) ──` `useEffect(...)` block. Replace with:
    ```tsx
    const skillsResult = useQuery(skillsQuery(bridge));
    const skills: SkillEntry[] = skillsResult.data?.skills ?? [];
    ```
  - **Logs drawer.** Rewrite `LogsDrawer` to use `logsQuery`. Replace the body's `useState`/`useEffect` fetch machinery:
    - Remove `const [lines, setLines] = useState<string[]>([]);`, `const repollRef = useRef<...>(null);`, the `fetchLogs` `useCallback`, and both `useEffect` blocks.
    - Keep `const [autoRepoll, setAutoRepoll] = useState(false);`.
    - Add:
      ```tsx
      const logsResult = useQuery(
        logsQuery(bridge, 200, {
          enabled: open,
          refetchInterval: open && autoRepoll ? LOGS_REPOLL_MS : false,
        }),
      );
      const lines = logsResult.data?.lines ?? [];
      ```
    - Replace the Refresh button `onClick={() => void fetchLogs()}` with `onClick={() => void logsResult.refetch()}`.
    - The `Dialog.Root` `onOpenChange` handler keeps `setAutoRepoll(false); onClose();`.
  - `useCallback`/`useRef` imports may become unused — leave `useEffect` import (still used for the Escape-key popover effect) and remove `useCallback`, `useRef` from the React import only if the linter/typecheck flags them (both are otherwise unused after this change; update the import line `import React, { useCallback, useEffect, useId, useRef, useState } from "react";` to `import React, { useEffect, useId, useState } from "react";`).
  - Delete the now-unused constant `const LOGS_REPOLL_MS = 2_000;`? No — it is still referenced by the `refetchInterval` expression. Keep it. Delete `const STATS_INTERVAL_MS = 10_000;` (now unused; the 10s interval lives in `statsQuery`).

- [ ] **Run — expected pass.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-settings.test.tsx
  ```
  If any existing `screen-settings.test.tsx` case still uses bare `render(<Settings .../>)`, apply the mechanical edit `render(` → `renderWithProviders(` across the whole file (Settings now calls `useQuery`, which requires the `QueryClientProvider`). No store-route assertions exist in this file, so only the render swap is needed. The AC-1 fake-timer polling tests keep asserting `statsMock` call counts (now driven by `refetchInterval`); the "cleans up interval on unmount" test still passes because Query stops the interval when the observer unmounts.

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run
  pnpm --filter @uxfactory/plugin typecheck
  pnpm -r build
  ```

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-plugin/ui/screens/Settings.tsx packages/uxfactory-plugin/test/screen-settings.test.tsx
  git commit -m "$(cat <<'EOF'
  panel: Settings server-state via TanStack Query (stats/skills/logs)

  Replace hand-rolled stats 10s poll, skills fetch, and logs 2s repoll with
  statsQuery/skillsQuery/logsQuery. Tests render via renderWithProviders.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3 — Artifacts + ExpandedHeader → snapshot query, invalidation, editor mutations; add SnapshotSync

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/Artifacts.tsx`
- Modify: `packages/uxfactory-plugin/ui/screens/ArtifactEditor.tsx`
- Modify: `packages/uxfactory-plugin/ui/components/ExpandedHeader.tsx`
- Modify: `packages/uxfactory-plugin/ui/router.tsx` (mount `SnapshotSync`)
- Modify (mechanical): `packages/uxfactory-plugin/test/screen-artifacts.test.tsx`, `packages/uxfactory-plugin/test/screen-artifact-editor.test.tsx`

**Interfaces:**
- Consumes: `snapshotQuery(bridge)` (yields `ProjectSnapshot`); `queryKeys.snapshot`; `enqueueMutation(bridge)` (`{ mutationFn: (req: PipelineEnqueueRequest) => Promise<PipelineEnqueueResponse> }`); `artifactQuery(bridge, key)` (yields `ArtifactContent`); `putArtifactMutation(bridge)` (`{ mutationFn: (vars: { key: string; content: string }) => Promise<{ ok: boolean }> }`); `putProfileMutation(bridge)`; `useQueryClient`, `useMutation`, `useQuery` from `@tanstack/react-query`.
- Produces: `SnapshotSync` component (internal to `ui/router.tsx`).

### Steps

- [ ] **Add `SnapshotSync` to `ui/router.tsx`** so `store.snapshot` stays mirrored from the snapshot query app-wide (keeps unmigrated readers — Prompt/Components/Assets/Setup/ContextBar — fresh). Add near `StoreRouteBridge`:
  ```tsx
  import { useQuery } from "@tanstack/react-query";
  import { snapshotQuery } from "./queries.js";

  function SnapshotSync({ bridge }: { bridge: Bridge }): null {
    const status = useAppStore((s) => s.connection.status);
    const enabled = status === "connected" || status === "reconnecting";
    const { data } = useQuery({ ...snapshotQuery(bridge), enabled });
    useEffect(() => {
      if (data) useAppStore.setState({ snapshot: data });
    }, [data]);
    return null;
  }
  ```
  Mount it in `RootLayout` (it needs `bridge` from context — read it via the root route). Change `RootLayout` to:
  ```tsx
  function RootLayout(): React.JSX.Element {
    const { bridge } = rootRoute.useRouteContext();
    return (
      <div className="flex flex-col h-screen bg-white text-gray-900 overflow-hidden">
        <StoreRouteBridge />
        <SnapshotSync bridge={bridge} />
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </div>
        <ToastOverlay />
      </div>
    );
  }
  ```

- [ ] **Write the failing test.** In `test/screen-artifacts.test.tsx`, add a case proving mutation success invalidates the snapshot query (replacing `refreshSnapshot`) and pending rows refetch while pending. Since Artifacts tests render `<Artifacts bridge={...} />` in isolation (no SnapshotSync), assert the local query refetch:
  ```tsx
  it("invalidates the snapshot query after Generate resolves (refetch)", async () => {
    const user = userEvent.setup();
    const snapshotMock = vi.fn().mockResolvedValue(makeMeridianSnapshot());
    const bridge = makeBridge({
      enqueue: vi.fn().mockResolvedValue({ id: "req-1" }),
      snapshot: snapshotMock,
    });
    renderWithProviders(<Artifacts bridge={bridge} />, {
      initialEntries: ["/tabs/artifacts"],
    });
    await generateViaDialog(user, /Create Illustrations/i);
    await waitFor(() => expect(snapshotMock).toHaveBeenCalled());
  });
  ```
  Add import: `import { renderWithProviders } from "./test-utils.js";`

- [ ] **Run — expected failure.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-artifacts.test.tsx
  ```
  Expected: red — Artifacts still reads `store.snapshot` and calls `refreshSnapshot`, and the isolation render lacks the QueryClient once we convert it.

- [ ] **Implement Artifacts.** In `ui/screens/Artifacts.tsx`:
  - Add imports:
    ```tsx
    import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
    import { snapshotQuery, enqueueMutation, queryKeys } from "../queries.js";
    ```
  - Replace the snapshot/refresh selectors:
    ```tsx
    const snapshot = useAppStore((s) => s.snapshot);
    const refreshSnapshot = useAppStore((s) => s.refreshSnapshot);
    const focusArtifactKey = useAppStore((s) => s.focus?.artifactKey);
    const clearFocus = useAppStore((s) => s.clearFocus);
    ```
    with:
    ```tsx
    const queryClient = useQueryClient();
    const hasPendingRef = useRef(false); // set below from pendingKeys.size
    const snapshotResult = useQuery({
      ...snapshotQuery(bridge),
      refetchInterval: () => (hasPendingRef.current ? 5000 : false),
    });
    const snapshot = snapshotResult.data ?? null;
    ```
  - Focus consumption moves to the router search param. Add:
    ```tsx
    import { useSearch, useNavigate } from "@tanstack/react-router";
    ```
    and replace the `focusArtifactKey`/`clearFocus` selectors + effect. Read:
    ```tsx
    const navigate = useNavigate();
    const search = useSearch({ strict: false }) as { focus?: string };
    const focusArtifactKey = search.focus;
    ```
    In the `// ── Focus intent ──` effect, replace `clearFocus();` with:
    ```tsx
    void navigate({ to: "/tabs/artifacts", search: {} });
    ```
    and update the effect deps from `[focusArtifactKey, clearFocus]` to `[focusArtifactKey, navigate]`.
  - Keep `pendingKeys`, `genErrors`, `openErrors`, `dialogRow`, `highlightedKey`, `editingKey`, `rowRefs`, `pendingIdsRef`, `timersRef` exactly (these are domain state — which artifacts are generating — not hand-rolled request state). After the `pendingKeys` state declaration, keep the `hasPendingRef` in sync:
    ```tsx
    hasPendingRef.current = pendingKeys.size > 0;
    ```
    (Place this assignment right after `const [pendingKeys, setPendingKeys] = useState...`.)
  - **Delete** the entire `// ── Poll every 5s while any artifact is pending ──` `useEffect(() => { ... setInterval ... }, [pendingKeys.size, bridge, refreshSnapshot]);` block (the `refetchInterval` above replaces it).
  - **Enqueue via mutation.** Add:
    ```tsx
    const enqueue = useMutation(enqueueMutation(bridge));
    ```
    In `handleGenerate`, replace:
    ```tsx
    try {
      const { id } = await bridge.enqueue({
        kind: "generate-artifact",
        payload: { artifact: row.key, guidance },
      });
      pendingIdsRef.current[id] = row.key;
      void refreshSnapshot(bridge);
      setTimeout(() => void refreshSnapshot(bridge), 3000);
    } catch {
      // Enqueue failed silently — the 5-minute timeout surfaces the error
    }
    ```
    with:
    ```tsx
    try {
      const { id } = await enqueue.mutateAsync({
        kind: "generate-artifact",
        payload: { artifact: row.key, guidance },
      });
      pendingIdsRef.current[id] = row.key;
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot });
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot }),
        3000,
      );
    } catch {
      // Enqueue failed silently — the 5-minute timeout surfaces the error
    }
    ```
  - The "Loading…" guard `if (!snapshot) { ... }` stays (now driven by `snapshotResult.data` being undefined before first fetch). The pending-cleanup effect (`// ── Pending cleanup when snapshot updates ──`) is unchanged (still reads `snapshot`).
  - Update the module docstring line about `refreshSnapshot` to reference `invalidateQueries`.

- [ ] **Implement ArtifactEditor.** In `ui/screens/ArtifactEditor.tsx`:
  - Add imports:
    ```tsx
    import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
    import { artifactQuery, putArtifactMutation, queryKeys } from "../queries.js";
    import { BridgeError } from "../lib/bridge.js"; // already imported
    ```
  - Replace the `loadState` machinery. Delete `const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });` is kept as derived; instead compute from the query. Replace the load `useEffect` (the `bridge.getArtifact(...)` block) and the `LoadState`-driving state with:
    ```tsx
    const queryClient = useQueryClient();
    const artifactResult = useQuery(artifactQuery(bridge, artifactKey));

    const loadState: LoadState = !bridge.getArtifact
      ? { phase: "error", message: "Artifact editing requires a newer bridge version." }
      : artifactResult.isPending
        ? { phase: "loading" }
        : artifactResult.isError
          ? artifactResult.error instanceof BridgeError &&
            artifactResult.error.status === 404
            ? { phase: "not-found" }
            : { phase: "error", message: "Failed to load artifact." }
          : { phase: "ready", artifact: artifactResult.data };
    ```
    Keep `const [sections, setSections] = useState<Section[]>([]);` and `const [saving, setSaving] = useState(false);` — actually replace `saving` with the mutation state (below). Seed `sections` from query data via an effect:
    ```tsx
    useEffect(() => {
      if (
        artifactResult.data &&
        artifactResult.data.format === "markdown"
      ) {
        setSections(parseSections(artifactResult.data.content));
      } else {
        setSections([]);
      }
    }, [artifactResult.data]);
    ```
    Remove the old load `useEffect` entirely.
  - **Save via mutation.** Add:
    ```tsx
    const save = useMutation({
      ...putArtifactMutation(bridge),
      onSuccess: () => {
        setSections((prev) => prev.map((s) => ({ ...s, originalBody: s.currentBody })));
        void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot });
        void queryClient.invalidateQueries({ queryKey: queryKeys.artifact(artifactKey) });
        toast("Saved");
      },
      onError: () => toast("Save failed — is the bridge running?"),
    });
    const saving = save.isPending;
    ```
    Replace `handleSave`'s body with:
    ```tsx
    async function handleSave(): Promise<void> {
      if (!isDirty || saving || !bridge.putArtifact) return;
      const content = assembleSections(sections);
      await save.mutateAsync({ key: artifactKey, content }).catch(() => {
        /* onError handled the toast */
      });
    }
    ```
    Remove the now-unused `const [saving, setSaving] = useState(false);` line (replaced by `save.isPending`).

- [ ] **Implement ExpandedHeader.** In `ui/components/ExpandedHeader.tsx`:
  - Add imports:
    ```tsx
    import { useNavigate } from "@tanstack/react-router";
    import { useMutation, useQueryClient } from "@tanstack/react-query";
    import { putProfileMutation, queryKeys } from "../queries.js";
    ```
  - Replace the selectors:
    ```tsx
    const refreshSnapshot = useAppStore((s) => s.refreshSnapshot);
    const goto = useAppStore((s) => s.goto);
    ```
    with:
    ```tsx
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const putProfile = useMutation({
      ...putProfileMutation(bridge),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot });
        toast("Applies to new runs");
      },
    });
    ```
  - Replace `handleClassificationClick`:
    ```tsx
    function handleClassificationClick(): void {
      prefillFrom(snapshot!);
      void navigate({ to: "/setup/classification" });
    }
    ```
  - Replace `handleDialChange`:
    ```tsx
    async function handleDialChange(key: DialKey, engineValue: string): Promise<void> {
      const cfg = DIAL_CONFIGS[key];
      await putProfile.mutateAsync({ [cfg.wireKey]: engineValue });
    }
    ```

- [ ] **Run — expected pass** (apply the mechanical test edits first, see next step).
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-artifacts.test.tsx test/screen-artifact-editor.test.tsx
  ```

- [ ] **Mechanically migrate `test/screen-artifacts.test.tsx` and `test/screen-artifact-editor.test.tsx`.** Pattern:
  - Add `import { renderWithProviders } from "./test-utils.js";`
  - Every `render(<Artifacts bridge={...} />)`, `render(<ExpandedHeader bridge={...} />)`, and `render(<ArtifactEditor .../>)` → `renderWithProviders(<... />, { initialEntries: ["/tabs/artifacts"] })`.
  - The AC-6 focus test (`focus: { artifactKey: "illustrations" }` via `useAppStore.setState`) becomes a search-param render:
    - Before: sets `useAppStore.setState({ ..., focus: { artifactKey: "illustrations" } })` then `render(<Artifacts .../>)`.
    - After: `renderWithProviders(<Artifacts bridge={makeBridge()} />, { initialEntries: ["/tabs/artifacts?focus=illustrations"] })` and drop the `focus` setState.
    - The "clearFocus is called (focus becomes null)" assertion becomes a router-search assertion: `expect(result.router.state.location.search).toEqual({})` (capture `const result = renderWithProviders(...)`).
  - The ExpandedHeader AC-5 assertions `expect(useAppStore.getState().route.screen).toBe("setup-1")` → capture the router and assert `await waitFor(() => expect(router.state.location.pathname).toBe("/setup/classification"))`. The "dial chip click does NOT navigate to setup-1" → assert `router.state.location.pathname` stays `/tabs/artifacts` (render with `initialEntries: ["/tabs/artifacts"]`).
  - `putProfile` and `enqueue` call-arg assertions are unchanged (mutations call the same bridge methods).

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run
  pnpm --filter @uxfactory/plugin typecheck
  pnpm -r build
  ```

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-plugin/ui/screens/Artifacts.tsx \
    packages/uxfactory-plugin/ui/screens/ArtifactEditor.tsx \
    packages/uxfactory-plugin/ui/components/ExpandedHeader.tsx \
    packages/uxfactory-plugin/ui/router.tsx \
    packages/uxfactory-plugin/test/screen-artifacts.test.tsx \
    packages/uxfactory-plugin/test/screen-artifact-editor.test.tsx
  git commit -m "$(cat <<'EOF'
  panel: Artifacts/editor/ExpandedHeader on Query; SnapshotSync mirror

  snapshot query with refetchInterval-while-pending replaces the 5s poll;
  mutation-driven invalidateQueries replaces refreshSnapshot; ArtifactEditor
  load/save become query+mutation; ExpandedHeader dial=putProfile mutation,
  classification click navigates. SnapshotSync mirrors query→store for
  unmigrated readers. Artifacts focus intent → ?focus= search param.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4 — Connect + Setup screens → mutations with navigation only in onSuccess

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/Connect.tsx`
- Modify: `packages/uxfactory-plugin/ui/screens/SetupClassification.tsx`
- Modify: `packages/uxfactory-plugin/ui/screens/SetupDefaults.tsx`
- Modify: `packages/uxfactory-plugin/ui/stores/app.ts` (make `connectSucceeded` stop setting `route`)
- Modify (mechanical): `packages/uxfactory-plugin/test/screen-connect.test.tsx`, `packages/uxfactory-plugin/test/screen-setup1.test.tsx`, `packages/uxfactory-plugin/test/screen-setup2.test.tsx`

**Interfaces:**
- Consumes: `connectProjectMutation(bridge)` (`{ mutationFn: (repoPath: string) => Promise<ConnectResult> }`), `putClassificationMutation(bridge)`, `putProfileMutation(bridge)`, `healthQuery(bridge)` (yields `{ ok: boolean }`, refetchInterval 3s), `queryKeys.snapshot`; `useQuery`, `useMutation`, `useQueryClient`; `useNavigate` from `@tanstack/react-router`.
- Signature reminder: `connectSucceeded(snapshot: ProjectSnapshot, repoPath: string, persist?: (payload: PersistPayload) => void): void`. In this task it stops writing `route`.

### Steps

- [ ] **Write the failing test.** In `test/screen-connect.test.tsx`, add a case proving a FAILED write stays on the connect location (navigation only in onSuccess):
  ```tsx
  it("failed connect (ok:false) does not navigate away from /connect", async () => {
    const user = userEvent.setup();
    const bridge = makeBridge({
      connectProject: vi.fn().mockResolvedValue({ ok: false, reason: "not-found" }),
    });
    const bus = makeBus();
    const { router } = renderWithProviders(<Connect bridge={bridge} bus={bus} />, {
      initialEntries: ["/connect"],
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Running"),
    );
    await user.type(screen.getByRole("textbox"), "/bad/path");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Path not found"));
    expect(router.state.location.pathname).toBe("/connect");
  });
  ```
  Add import: `import { renderWithProviders } from "./test-utils.js";`

- [ ] **Run — expected failure.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-connect.test.tsx
  ```
  Expected: red — Connect still uses `store.connectSucceeded` (which sets `route`) and bare `render`.

- [ ] **Implement Connect.** In `ui/screens/Connect.tsx`:
  - Add imports:
    ```tsx
    import { useNavigate } from "@tanstack/react-router";
    import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
    import { healthQuery, connectProjectMutation, queryKeys } from "../queries.js";
    ```
  - Replace the health-poll `useEffect` (the `// ── Bridge health polling (every 3s, cleanup on unmount) ──` block and its `const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>("checking");`) with a query:
    ```tsx
    const healthResult = useQuery(healthQuery(bridge));
    const bridgeStatus: BridgeStatus = healthResult.isPending
      ? "checking"
      : healthResult.data?.ok
        ? "running"
        : "down";
    ```
    Remove the `setBridgeStatus` state line and the whole polling effect.
  - Keep `connectStart`/`connectSucceeded`/`connectFailed` selectors (still used to set connection/snapshot state and persist), but move navigation into the mutation `onSuccess`. Add:
    ```tsx
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const connect = useMutation({
      ...connectProjectMutation(bridge),
      onSuccess: (result) => {
        if (!result.ok) {
          let message: string;
          if (result.reason === "not-found") message = "Path not found";
          else if (result.reason === "not-a-root")
            message =
              "Not a repository root — pick the folder containing uxfactory.batch.json or .git";
          else if (result.reason === "bridge-serves-different-root")
            message = result.served
              ? `This bridge serves ${result.served} — start \`uxfactory bridge\` in your repo or connect to that path`
              : "Bridge serves a different repository root";
          else message = "Connection failed";
          setPathError(message);
          setIsConnecting(false);
          return;
        }
        const capturedMode = mode;
        const capturedEndpoint = connectionEndpoint;
        const trimmed = repoPath.trim();
        queryClient.setQueryData(queryKeys.snapshot, result.snapshot);
        connectSucceeded(result.snapshot, trimmed, (payload) => {
          void bus.storageSet(storageKey, {
            ...payload,
            mode: capturedMode,
            endpoint: capturedEndpoint,
          });
        });
        void navigate({
          to: result.snapshot.hasClassification
            ? "/tabs/prompt"
            : "/setup/classification",
        });
      },
      onError: () => {
        connectFailed(
          `Bridge not reachable at ${connectionEndpoint} — start it with \`uxfactory bridge\``,
        );
        setIsConnecting(false);
      },
    });
    ```
  - Replace `handleConnect` body's `try/catch` (the `bridge.connectProject` call and its result branching) with:
    ```tsx
    const handleConnect = async (): Promise<void> => {
      if (!ctaEnabled) return;
      setPathError(null);
      setIsConnecting(true);
      connectStart();
      connect.mutate(repoPath.trim());
    };
    ```
    (Navigation/error handling now lives in the mutation callbacks; the screen stays put on failure.)

- [ ] **Implement SetupClassification.** In `ui/screens/SetupClassification.tsx`:
  - Add imports:
    ```tsx
    import { useNavigate } from "@tanstack/react-router";
    import { useMutation } from "@tanstack/react-query";
    import { putClassificationMutation } from "../queries.js";
    ```
  - Replace the `goto` selector with `const navigate = useNavigate();`.
  - Add the mutation:
    ```tsx
    const putClassification = useMutation({
      ...putClassificationMutation(bridge),
      onSuccess: () => {
        applySuggestions({ category, industry });
        void navigate({ to: "/setup/defaults" });
      },
      onError: () => {
        toastFn("Could not save — is the bridge running?");
        setSaving(false);
      },
    });
    ```
  - Replace `handleContinue` body:
    ```tsx
    async function handleContinue() {
      if (!canContinue || saving) return;
      setSaving(true);
      putClassification.mutate({ category, industry, locale, platforms, layout, ageGroup });
    }
    ```
  - Replace `handleBack`:
    ```tsx
    function handleBack() {
      void navigate({ to: "/connect" });
    }
    ```

- [ ] **Implement SetupDefaults.** In `ui/screens/SetupDefaults.tsx`:
  - Add imports:
    ```tsx
    import { useNavigate } from "@tanstack/react-router";
    import { useMutation } from "@tanstack/react-query";
    import { putProfileMutation } from "../queries.js";
    ```
  - Replace the `goto` selector with `const navigate = useNavigate();`.
  - Add the mutation:
    ```tsx
    const putProfile = useMutation({
      ...putProfileMutation(bridge),
      onSuccess: () => {
        toastFn("Applies to new runs");
        void navigate({ to: "/tabs/prompt" });
      },
      onError: () => {
        toastFn("Could not save — is the bridge running?");
        setSaving(false);
      },
    });
    ```
  - Replace `handleSave` body:
    ```tsx
    async function handleSave() {
      if (saving) return;
      setSaving(true);
      putProfile.mutate({ style, visual, editorial, flow, coverage, coherence });
    }
    ```
  - Replace `handleBack`:
    ```tsx
    function handleBack() {
      void navigate({ to: "/setup/classification" });
    }
    ```

- [ ] **Stop `connectSucceeded` from writing `route`.** In `ui/stores/app.ts`, in `connectSucceeded`, change:
  ```tsx
  const { connection } = get();
  const nextScreen: Screen = snapshot.hasClassification ? "tabs" : "setup-1";

  set((s) => ({
    snapshot,
    connection: { ...s.connection, status: "connected", repoPath },
    route: { ...s.route, screen: nextScreen },
  }));
  ```
  to:
  ```tsx
  const { connection } = get();

  set((s) => ({
    snapshot,
    connection: { ...s.connection, status: "connected", repoPath },
  }));
  ```
  (Navigation is now the caller's responsibility — boot and the Connect mutation both navigate. The `route` field still exists and is still driven by the interim `StoreRouteBridge` for the not-yet-migrated Checks/Prompt/Components `setTab`/`setFocus`.)

- [ ] **Run — expected pass** (after the mechanical test edits below).
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-connect.test.tsx test/screen-setup1.test.tsx test/screen-setup2.test.tsx
  ```

- [ ] **Mechanically migrate the three test files.** Pattern:
  - Add `import { renderWithProviders } from "./test-utils.js";`
  - `render(<Connect .../>)` → `renderWithProviders(<Connect .../>, { initialEntries: ["/connect"] })`; capture the returned `router`.
  - `render(<SetupClassification .../>)` → `renderWithProviders(<SetupClassification .../>, { initialEntries: ["/setup/classification"] })`.
  - `render(<SetupDefaults .../>)` → `renderWithProviders(<SetupDefaults .../>, { initialEntries: ["/setup/defaults"] })`.
  - Store-route assertions → router-location assertions (use `await waitFor` because navigation happens in async `onSuccess`):
    - screen-connect: `expect(useAppStore.getState().route.screen).toBe("tabs")` → `await waitFor(() => expect(router.state.location.pathname).toBe("/tabs/prompt"))`; `...toBe("setup-1")` → `.toBe("/setup/classification")`.
    - screen-setup1: `expect(useAppStore.getState().route.screen).toBe("setup-2")` → `.toBe("/setup/defaults")`; the error-path "stays on setup-1" → `await waitFor(...)` then `expect(router.state.location.pathname).toBe("/setup/classification")`; the Back test `...toBe("connect")` → `.toBe("/connect")`.
    - screen-setup2: `...toBe("tabs")` → `.toBe("/tabs/prompt")`; error-path "stays on setup-2" → `/setup/defaults`; Back `...toBe("setup-1")` → `/setup/classification`.
  - `bridge.connectProject`/`putClassification`/`putProfile` call-arg assertions are unchanged (mutations call the same bridge methods with the same args).
  - The screen-connect AC-3b throw test asserts `connection.status === "error"` + toast — unchanged (the `onError` path sets these).
  - The screen-connect AC-4 "compact hero when store already has repoPath" and AC-2 health-flip tests: the 3s health flip is now `refetchInterval`; keep the fake-timer advance (`vi.advanceTimersByTime(3_001)`) — Query's `refetchInterval` fires the refetch. Wrap the render in `renderWithProviders`.

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run
  pnpm --filter @uxfactory/plugin typecheck
  pnpm -r build
  ```

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-plugin/ui/screens/Connect.tsx \
    packages/uxfactory-plugin/ui/screens/SetupClassification.tsx \
    packages/uxfactory-plugin/ui/screens/SetupDefaults.tsx \
    packages/uxfactory-plugin/ui/stores/app.ts \
    packages/uxfactory-plugin/test/screen-connect.test.tsx \
    packages/uxfactory-plugin/test/screen-setup1.test.tsx \
    packages/uxfactory-plugin/test/screen-setup2.test.tsx
  git commit -m "$(cat <<'EOF'
  panel: Connect/Setup writes as mutations; navigate only in onSuccess

  connectProject/putClassification/putProfile become mutations; failed writes
  stay on-screen with the existing toast/error; health poll → healthQuery(3s).
  connectSucceeded no longer sets route (boot + Connect navigate directly).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5 — Checks screen → typed `run` search param + latestRender query

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/Checks.tsx`
- Modify (mechanical): `packages/uxfactory-plugin/test/screen-checks.test.tsx`

**Interfaces:**
- Consumes: `latestRenderQuery(bridge, run)` (key `["latestRender", run ?? null]`, yields `unknown`); `useQuery`; `useSearch({ strict: false })` → `{ run?: string }`; `useNavigate`.
- Signature reminder: `toTierModel(input)` and the existing `init()` derivation (storage/history/counter) are preserved; the fetch trigger moves to the query keyed on `run`.

### Steps

- [ ] **Write the failing test.** In `test/screen-checks.test.tsx`, replace the "focus.runId intent" describe's first test with a search-param-driven refetch (add near the existing focus test):
  ```tsx
  it("re-fetches latestRender when the run search param changes", async () => {
    const latestRender = vi.fn().mockResolvedValue(null);
    const bridge = makeBridge({ latestRender });
    const bus = makeBus();
    const { router } = renderWithProviders(<Checks bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/checks"],
    });
    await waitFor(() => expect(latestRender).toHaveBeenCalledTimes(1));
    await act(async () => {
      await router.navigate({ to: "/tabs/checks", search: { run: "run-gen-1" } });
    });
    await waitFor(() => expect(latestRender).toHaveBeenCalledTimes(2));
  });
  ```
  Add import: `import { renderWithProviders } from "./test-utils.js";`

- [ ] **Run — expected failure.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-checks.test.tsx
  ```
  Expected: red — Checks still reads `focus?.runId` from the store and fetches in an effect (bare `render`, no providers).

- [ ] **Implement Checks.** In `ui/screens/Checks.tsx`, in the `Checks` container:
  - Add imports:
    ```tsx
    import { useSearch } from "@tanstack/react-router";
    import { useQuery } from "@tanstack/react-query";
    import { latestRenderQuery } from "../queries.js";
    ```
  - Replace the store focus selectors:
    ```tsx
    const setTab = useAppStore((s) => s.setTab);
    const focusRunId = useAppStore((s) => s.focus?.runId);
    const clearFocus = useAppStore((s) => s.clearFocus);
    ```
    with:
    ```tsx
    const setTab = useAppStore((s) => s.setTab); // still used by onComponentsLink until Task 6/7
    const search = useSearch({ strict: false }) as { run?: string };
    const run = search.run;
    const renderResult = useQuery(latestRenderQuery(bridge, run));
    ```
  - Delete BOTH the mount effect (`useEffect(() => { void init(); }, [])`) and the focus effect (`useEffect(() => { if (focusRunId !== undefined) { void init(); clearFocus(); } }, [focusRunId])`). Replace with a single data-effect that runs the existing derivation whenever the query settles:
    ```tsx
    useEffect(() => {
      if (renderResult.isPending) return;
      void applyRender(renderResult.data);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [renderResult.data, renderResult.isPending, renderResult.dataUpdatedAt]);
    ```
  - Rename `async function init()` to `async function applyRender(raw: unknown)` and, inside it, **delete** the `try { const raw = await bridge.latestRender(); ... } catch { ... }` fetch wrapper — replace the fetch with the passed `raw`. Concretely: the block
    ```tsx
    let gotLiveData = false;
    let liveTierModel: TierModel | null = null;
    try {
      const raw = await bridge.latestRender();
      if (raw !== null && raw !== undefined) {
        liveTierModel = toTierModel({ batchReport: raw, verifyResult: raw });
        ...
      }
    } catch {
      /* keep pending model */
    }
    ```
    becomes
    ```tsx
    let gotLiveData = false;
    let liveTierModel: TierModel | null = null;
    if (raw !== null && raw !== undefined) {
      liveTierModel = toTierModel({ batchReport: raw, verifyResult: raw });
      setModel(liveTierModel);
      setIsEmpty(false);
      gotLiveData = true;
      const latestRunUnitType = useRunsStore.getState().runs[0]?.unitType;
      setRunMeta({ unit: latestRunUnitType, escalationSkipped: true, runNumber: runCounter });
    }
    ```
    Everything else in `applyRender` (fileKey resolution, storage load, counter, history persist, "no live data but history exists" fallback) is unchanged.
  - The manual Refresh escape hatch: change `onRefresh={() => void init()}` to `onRefresh={() => void renderResult.refetch()}`.

- [ ] **Run — expected pass** (after the mechanical test edits).
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-checks.test.tsx
  ```

- [ ] **Mechanically migrate `test/screen-checks.test.tsx`.** Pattern:
  - Add `import { renderWithProviders } from "./test-utils.js";`
  - Every `render(<Checks bridge={...} bus={...} />)` → `renderWithProviders(<Checks bridge={...} bus={...} />, { initialEntries: ["/tabs/checks"] })`.
  - `render(<ChecksView {...props} />)` calls DO NOT need providers (ChecksView is purely presentational) — but wrapping in `renderWithProviders` is harmless; leave `render(<ChecksView .../>)` as-is to minimize churn.
  - The existing "re-fetches latestRender when focus.runId intent arrives" test: replace its `act(() => { useAppStore.getState().setFocus({ runId: "run-gen-1" }); })` + `expect(focus).toBeNull()` with the router-navigate version shown in the failing-test step (drive `router.navigate({ to: "/tabs/checks", search: { run: "run-gen-1" } })` and assert the second fetch). Remove the `expect(useAppStore.getState().focus).toBeNull()` assertion (focus no longer exists in this flow).
  - The AC-2/I-2/M-3/M-5 container tests that render `<Checks/>` and assert on `bus.postReview`/`storageSet`/banner text are unchanged except for the `render` → `renderWithProviders(..., { initialEntries: ["/tabs/checks"] })` swap.

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run
  pnpm --filter @uxfactory/plugin typecheck
  pnpm -r build
  ```

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-plugin/ui/screens/Checks.tsx packages/uxfactory-plugin/test/screen-checks.test.tsx
  git commit -m "$(cat <<'EOF'
  panel: Checks uses ?run= search param + latestRenderQuery

  Typed run search param replaces focus.runId; latestRenderQuery keyed on run
  refetches on navigation; the two init effects collapse to one data-effect.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6 — Prompt + Components + Assets → links query, enqueue mutations, router navigation

**Files:**
- Modify: `packages/uxfactory-plugin/ui/screens/Prompt.tsx`
- Modify: `packages/uxfactory-plugin/ui/screens/Components.tsx`
- Modify: `packages/uxfactory-plugin/ui/screens/Assets.tsx`
- Modify (mechanical): `packages/uxfactory-plugin/test/screen-prompt.test.tsx`, `packages/uxfactory-plugin/test/screen-components.test.tsx`, `packages/uxfactory-plugin/test/screen-assets.test.tsx`

**Interfaces:**
- Consumes: `linksQuery(bridge)` (yields `{ links: Link[] }`), `putLinksMutation(bridge)`, `enqueueMutation(bridge)`, `queryKeys.links`, `queryKeys.snapshot`; `useQuery`, `useMutation`, `useQueryClient`; `useNavigate` from `@tanstack/react-router`.

### Steps

- [ ] **Write the failing test.** In `test/screen-prompt.test.tsx`, prove grounding-chip click navigates to the artifacts route with the `focus` search param (replacing `setFocus`+`setTab`):
  ```tsx
  it("grounding chip click navigates to /tabs/artifacts?focus=<key>", async () => {
    const user = userEvent.setup();
    const { bridge } = makeBridge();
    const bus = makeBus();
    const { router } = renderWithProviders(<Prompt bridge={bridge} bus={bus} />, {
      initialEntries: ["/tabs/prompt"],
    });
    await user.click(
      screen.getByLabelText("Requirements — missing, generation proceeds with defaults"),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tabs/artifacts");
      expect(router.state.location.search).toEqual({ focus: "requirements" });
    });
  });
  ```
  Add import: `import { renderWithProviders } from "./test-utils.js";`

- [ ] **Run — expected failure.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-prompt.test.tsx
  ```
  Expected: red — Prompt still uses `setFocus`/`setTab` and bare `render`.

- [ ] **Implement Prompt.** In `ui/screens/Prompt.tsx`:
  - Add imports:
    ```tsx
    import { useNavigate } from "@tanstack/react-router";
    import { useMutation } from "@tanstack/react-query";
    import { enqueueMutation } from "../queries.js";
    ```
  - Replace the selectors:
    ```tsx
    const setTab = useAppStore((s) => s.setTab);
    const setFocus = useAppStore((s) => s.setFocus);
    ```
    with `const navigate = useNavigate();`.
  - Add the enqueue mutation:
    ```tsx
    const enqueue = useMutation(enqueueMutation(bridge));
    ```
  - In `handleSubmit`, replace `const { id } = await bridge.enqueue({ ... });` with `const { id } = await enqueue.mutateAsync({ kind: "generate-design", payload: { prompt: trimmed, unitType, platforms } });` (keep the surrounding try/catch, the `useRunsStore.getState().add(...)`, the textarea clear, and the failure toast unchanged).
  - Grounding chip `onClick`: replace
    ```tsx
    setFocus({ artifactKey: key });
    setTab("artifacts");
    ```
    with
    ```tsx
    void navigate({ to: "/tabs/artifacts", search: { focus: key } });
    ```
  - Empty-artifacts callout button: replace `onClick={() => setTab("artifacts")}` with `onClick={() => void navigate({ to: "/tabs/artifacts", search: {} })}`.
  - "View" button: replace
    ```tsx
    setFocus({ runId: run.id });
    setTab("checks");
    if (run.nodeIds && run.nodeIds.length > 0) {
      bus.selectNodes(run.nodeIds);
    }
    ```
    with
    ```tsx
    void navigate({ to: "/tabs/checks", search: { run: run.id } });
    if (run.nodeIds && run.nodeIds.length > 0) {
      bus.selectNodes(run.nodeIds);
    }
    ```

- [ ] **Implement Components.** In `ui/screens/Components.tsx`:
  - Add imports:
    ```tsx
    import { useNavigate } from "@tanstack/react-router";
    import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
    import { linksQuery, putLinksMutation, enqueueMutation, queryKeys } from "../queries.js";
    ```
  - Replace selectors `const setTab = useAppStore((s) => s.setTab);` and `const setFocus = useAppStore((s) => s.setFocus);` with `const navigate = useNavigate();`.
  - Replace `const [links, setLinks] = useState<Link[]>([]);` and the `// ── Load links on mount ──` `useEffect` with:
    ```tsx
    const queryClient = useQueryClient();
    const linksResult = useQuery(linksQuery(bridge));
    const links = linksResult.data?.links ?? [];
    const putLinks = useMutation({
      ...putLinksMutation(bridge),
      onError: () => toast("Failed to save link — is the bridge running?"),
    });
    const enqueue = useMutation(enqueueMutation(bridge));

    function commitLinks(next: Link[]): void {
      queryClient.setQueryData(queryKeys.links, { links: next });
      putLinks.mutate(next, {
        onError: () => {
          queryClient.setQueryData(queryKeys.links, { links });
        },
      });
    }
    ```
    (Optimistic write to the query cache preserves the immediate-update behavior the old local `setLinks` gave, and rolls back on error.)
  - Rewrite the three link handlers to use `commitLinks`:
    - `handleLink`: replace the `try { await bridge.putLinks(nextLinks); setLinks(nextLinks); } catch { toast(...); }` with `commitLinks(nextLinks);`.
    - `handleUnlink`: replace similarly with `commitLinks(nextLinks);` (keep the `nextLinks` computation).
    - `handleUnitTypeChange`: replace `try { await bridge.putLinks(nextLinks); setLinks(nextLinks); } catch { toast("Failed to update link — is the bridge running?"); }` with `commitLinks(nextLinks);`.
    - Adjust the unit/unlink error copy: `commitLinks` uses one message ("Failed to save link…"); to preserve the exact per-action messages the tests assert, pass an explicit message. Change `commitLinks` to accept an optional message:
      ```tsx
      function commitLinks(next: Link[], failMsg = "Failed to save link — is the bridge running?"): void {
        queryClient.setQueryData(queryKeys.links, { links: next });
        putLinks.mutate(next, {
          onError: () => {
            queryClient.setQueryData(queryKeys.links, { links });
            toast(failMsg);
          },
        });
      }
      ```
      and call `commitLinks(nextLinks, "Failed to remove link — is the bridge running?")` in `handleUnlink`, `commitLinks(nextLinks, "Failed to update link — is the bridge running?")` in `handleUnitTypeChange`. Remove the `onError` toast from the `useMutation(putLinksMutation(...))` definition (handled per-call).
  - `handleCheck`: replace
    ```tsx
    const { id } = await bridge.enqueue({ kind: "check-design", payload: { nodeIds } });
    setFocus({ runId: id });
    setTab("checks");
    ```
    with
    ```tsx
    const { id } = await enqueue.mutateAsync({ kind: "check-design", payload: { nodeIds } });
    void navigate({ to: "/tabs/checks", search: { run: id } });
    ```
    (keep the surrounding `setIsCheckLoading` try/catch/finally and the failure toast).
  - Zero-ACs callout button: replace `onClick={() => setTab("artifacts")}` with `onClick={() => void navigate({ to: "/tabs/artifacts", search: {} })}`.

- [ ] **Implement Assets.** In `ui/screens/Assets.tsx`:
  - Add imports:
    ```tsx
    import { useMutation } from "@tanstack/react-query";
    import { enqueueMutation } from "../queries.js";
    ```
  - Add `const enqueue = useMutation(enqueueMutation(bridge));`.
  - In `handleCreate`, replace `await bridge.enqueue({ kind: "generate-artifact", payload: { artifact: "illustrations" } });` with `await enqueue.mutateAsync({ kind: "generate-artifact", payload: { artifact: "illustrations" } });` (keep the surrounding `setIllusGenerating` try/catch and the failure toast). The snapshot read stays `useAppStore((s) => s.snapshot)` (mirrored by SnapshotSync).

- [ ] **Run — expected pass** (after the mechanical test edits).
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run test/screen-prompt.test.tsx test/screen-components.test.tsx test/screen-assets.test.tsx
  ```

- [ ] **Mechanically migrate the three test files.** Pattern:
  - Add `import { renderWithProviders } from "./test-utils.js";`
  - screen-prompt: `render(<Prompt .../>)` → `renderWithProviders(<Prompt .../>, { initialEntries: ["/tabs/prompt"] })`; capture `router`.
    - `expect(useAppStore.getState().focus).toEqual({ runId: "run-001" })` + `expect(useAppStore.getState().route.tab).toBe("checks")` → `await waitFor(() => { expect(router.state.location.pathname).toBe("/tabs/checks"); expect(router.state.location.search).toEqual({ run: "run-001" }); })`.
    - `expect(useAppStore.getState().focus).toEqual({ artifactKey: "requirements" })` + `route.tab === "artifacts"` → assert `/tabs/artifacts` + `search { focus: "requirements" }`.
    - `expect(useAppStore.getState().route.tab).toBe("artifacts")` (Create-artifacts callout) → `/tabs/artifacts`.
    - Enqueue call-arg assertions unchanged.
  - screen-components: `render(<Components .../>)` → `renderWithProviders(<Components .../>, { initialEntries: ["/tabs/components"] })`; capture `router`.
    - AC-7 `expect(useAppStore.getState().focus).toEqual({ runId: "run-abc" })` + `route.tab === "checks"` → assert `/tabs/checks` + `search { run: "run-abc" }`.
    - AC-5 `expect(useAppStore.getState().route.tab).toBe("artifacts")` → `/tabs/artifacts`.
    - `bridge.getLinks`/`putLinks`/`enqueue`/`openPath` call-arg assertions unchanged (the query calls `getLinks`; `commitLinks` calls `putLinks` with the same arrays).
  - screen-assets: `render(<Assets .../>)` → `renderWithProviders(<Assets .../>, { initialEntries: ["/tabs/assets"] })`. `bridge.enqueue` call-arg assertions unchanged.

- [ ] **Run the full gate. Expected: PASS.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run
  pnpm --filter @uxfactory/plugin typecheck
  pnpm -r build
  ```

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-plugin/ui/screens/Prompt.tsx \
    packages/uxfactory-plugin/ui/screens/Components.tsx \
    packages/uxfactory-plugin/ui/screens/Assets.tsx \
    packages/uxfactory-plugin/test/screen-prompt.test.tsx \
    packages/uxfactory-plugin/test/screen-components.test.tsx \
    packages/uxfactory-plugin/test/screen-assets.test.tsx
  git commit -m "$(cat <<'EOF'
  panel: Prompt/Components/Assets on links query + enqueue mutations

  Components links via linksQuery + optimistic putLinks mutation; enqueue is a
  mutation across Prompt/Components/Assets; cross-tab navigation uses the router
  (?focus=/?run= search params) instead of setFocus+setTab.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7 — Final sweep: delete store `route`/`focus`/polls, remove StoreRouteBridge, re-anchor e2e, measure bundle

**Files:**
- Modify: `packages/uxfactory-plugin/ui/stores/app.ts`
- Modify: `packages/uxfactory-plugin/ui/router.tsx`
- Modify: `packages/uxfactory-plugin/ui/screens/Checks.tsx` (drop the last `setTab`)
- Modify (mechanical): `packages/uxfactory-plugin/test/stores.test.ts`, `packages/uxfactory-plugin/test/routing.test.tsx`, `packages/uxfactory-plugin/test/e2e-panel.test.tsx`, and any screen test still setting `route`/`focus` in `setState`.

**Interfaces:**
- Removes from `ui/stores/app.ts`: `route`, `focus`, `RouteState`, `FocusIntent`, `setFocus`, `clearFocus`, `goto`, `setTab`, `refreshSnapshot`, and `route`/`focus` from `cancelReconnect`. Keeps `connection`, `fileInfo`, `snapshot`, `toasts`, and their actions plus `connectStart`/`connectSucceeded`/`connectFailed`/`toast`/`dismissToast`/`cancelReconnect`/`setFileInfo`. `Screen`/`Tab` types: `Tab` stays (used by router). `Screen` is removed.
- Removes from `ui/router.tsx`: `StoreRouteBridge`, `mapStoreRouteToLocation`, the `FocusIntent` import, and the `useAppStore` route/focus reads. `SnapshotSync` stays.

### Steps

- [ ] **Grep the current polling/route/focus surface (pre-cleanup baseline).**
  ```sh
  cd packages/uxfactory-plugin
  grep -rn "setInterval" ui/screens/ ; echo "---"
  grep -rn "refreshSnapshot\|setFocus\|clearFocus\|\.route\b\|\bgoto\b\|\bsetTab\b" ui/
  ```
  Expected before this task: `setInterval` appears 0 times in `ui/screens/`; the second grep still shows `route`/`focus`/`goto`/`setTab`/`refreshSnapshot` in `ui/stores/app.ts`, `ui/router.tsx` (StoreRouteBridge), and `ui/screens/Checks.tsx` (`setTab` for `onComponentsLink`).

- [ ] **Drop the last store-nav use in Checks.** In `ui/screens/Checks.tsx`, replace `const setTab = useAppStore((s) => s.setTab);` with `const navigate = useNavigate();` (import already present from Task 5 via `@tanstack/react-router`? add `import { useNavigate } from "@tanstack/react-router";` if not) and change `onComponentsLink={() => setTab("components")}` to `onComponentsLink={() => void navigate({ to: "/tabs/components" })}`.

- [ ] **Remove `route`/`focus` from the app store.** In `ui/stores/app.ts`:
  - Delete the `Screen` type, `RouteState` interface, `FocusIntent` interface, `INITIAL_ROUTE`, the `route` and `focus` fields from `AppState`, and the `route`/`focus` initial values from the store object.
  - Delete the actions `goto`, `setTab`, `setFocus`, `clearFocus`, `refreshSnapshot` (interface + impl).
  - In `connectSucceeded`, it already no longer sets `route` (Task 4) — no change needed.
  - In `cancelReconnect`, change:
    ```tsx
    cancelReconnect() {
      set((s) => ({
        connection: { ...s.connection, status: "none" },
        route: { ...s.route, screen: "connect" },
      }));
    },
    ```
    to:
    ```tsx
    cancelReconnect() {
      set((s) => ({
        connection: { ...s.connection, status: "none" },
      }));
    },
    ```
  - Keep `Tab` exported (the router `TabNav` imports it). Keep `PersistPayload`, `ConnectionState`, etc.

- [ ] **Make ContextBar's Cancel navigate.** Because `cancelReconnect` no longer sets a route, the reconnect Cancel button must navigate to `/connect`. In `ui/router.tsx`, inside `ContextBar`, add `const navigate = useNavigate();` and change the Cancel button `onClick={cancelReconnect}` to:
  ```tsx
  onClick={() => {
    cancelReconnect();
    void navigate({ to: "/connect" });
  }}
  ```

- [ ] **Remove `StoreRouteBridge` and its mapping.** In `ui/router.tsx`:
  - Delete `StoreRouteBridge`, `mapStoreRouteToLocation`, and the `import type { Tab, FocusIntent } from "./stores/app.js";` → change to `import type { Tab } from "./stores/app.js";`.
  - In `RootLayout`, remove `<StoreRouteBridge />` (keep `<SnapshotSync .../>`).

- [ ] **Run typecheck — expected failures enumerate remaining references.**
  ```sh
  pnpm --filter @uxfactory/plugin typecheck
  ```
  Expected: errors only in test files that still set `route`/`focus` in `useAppStore.setState({...})` and `test/stores.test.ts` (which tests `goto`/`setTab`/`setFocus`/`clearFocus`/`refreshSnapshot`).

- [ ] **Clean the tests.**
  - `test/stores.test.ts`: delete the `describe("app store — focus intent", ...)` block and the `goto`/`setTab` assertions in `describe("app store — misc actions", ...)` (delete the `it("goto changes route.screen", ...)` and `it("setTab changes route.tab", ...)` cases). In `describe("app store — cancelReconnect", ...)`, change `it("sets route.screen to 'connect'", ...)` to assert the router is untouched by the store — delete that single `it` (navigation is now the router's job; `cancelReconnect` only sets `status`). Remove `route`/`focus` from every `useAppStore.setState({...})` reset object in this file. The `connectSucceeded` routing tests (`it("routes to 'tabs' ...")`) now assert nothing about `route` — convert them to assert `snapshot`/`connection` only, e.g. `it("stores the snapshot and marks connected", () => { const s = makeSnapshot({ hasClassification: true }); useAppStore.getState().connectSucceeded(s, "/repo"); expect(useAppStore.getState().connection.status).toBe("connected"); })`. Delete the two `route.screen` expectations.
  - Remaining screen tests: grep for `route:` and `focus:` inside `useAppStore.setState({...})` reset objects and delete those two keys from each (they no longer exist on the state type). Run:
    ```sh
    grep -rln "route: { screen:" test/ ; grep -rln "focus: null" test/
    ```
    Files that still carry `route:`/`focus:` in a `setState` reset (e.g. `screen-settings.test.tsx` `BASE_STORE`, `screen-artifacts.test.tsx` `resetStores`, `screen-checks.test.tsx` `BASE_APP_STATE`, `screen-prompt.test.tsx` `BASE_APP_STATE`, `screen-components.test.tsx` `BASE_APP_STATE`, `screen-setup1/2.test.tsx`, `screen-assets.test.tsx`) — delete the `route: {...}` and `focus: ...` properties from each reset object.
  - `test/routing.test.tsx` and `test/e2e-panel.test.tsx`: the `resetToConnect`/`resetToTabs`/`resetToReconnecting` helpers set `route`/`focus` — delete those keys, and set the router's `initialEntries` (via `initialPathFromStore()` introduced in Task 1) to place the app at the right location instead. Update `initialPathFromStore()` to read `connection.status` + a `snapshot?.hasClassification` heuristic instead of `route` (since `route` is gone):
    ```tsx
    function initialPathFromStore(): string {
      const { connection, snapshot } = useAppStore.getState();
      if (connection.status === "reconnecting") return "/connect";
      if (connection.status !== "connected") return "/connect";
      if (snapshot && !snapshot.hasClassification) return "/setup/classification";
      return "/tabs/prompt";
    }
    ```
    Any test needing a specific tab (e.g. asserting Artifacts active) navigates after render via `router.navigate({ to: "/tabs/artifacts" })` or seeds `initialEntries` directly.

- [ ] **Run — expected pass.**
  ```sh
  pnpm --filter @uxfactory/plugin exec vitest run
  pnpm --filter @uxfactory/plugin typecheck
  ```

- [ ] **Grep-clean success criteria (spec §6). Expected: all empty / route+focus gone.**
  ```sh
  cd packages/uxfactory-plugin
  echo "=== §6.1 no setInterval in ui/screens (expect nothing) ===" ; grep -rn "setInterval" ui/screens/ || echo OK
  echo "=== §6.1 no manual poll refreshSnapshot anywhere (expect nothing) ===" ; grep -rn "refreshSnapshot" ui/ || echo OK
  echo "=== §6.2 route/focus gone from store (expect nothing) ===" ; grep -rn "setFocus\|clearFocus\|\bgoto\b\|\bsetTab\b\|route\.screen\|route\.tab\|s\.focus" ui/ || echo OK
  ```
  Each grep must print `OK` (no matches). If `s.focus` or `route.` still appears, it is a leftover to fix before committing.

- [ ] **Measure the bundle against the budget.**
  ```sh
  pnpm -r build
  ls -la packages/uxfactory-plugin/dist/ui.html
  ```
  Expected: `ui.html` size < 2,097,152 bytes (2MB). Record the delta vs the 1,135,893-byte baseline in the commit body; the two TanStack libs are pure JS and should add well under the +~15KB gz budget. If over 2MB, STOP and investigate (do not commit) — the likely cause is an accidental non-tree-shaken import; both libs are ESM and side-effect-light.

- [ ] **Commit.**
  ```sh
  git add packages/uxfactory-plugin/ui/stores/app.ts \
    packages/uxfactory-plugin/ui/router.tsx \
    packages/uxfactory-plugin/ui/screens/Checks.tsx \
    packages/uxfactory-plugin/test/stores.test.ts \
    packages/uxfactory-plugin/test/routing.test.tsx \
    packages/uxfactory-plugin/test/e2e-panel.test.tsx \
    packages/uxfactory-plugin/test/screen-settings.test.tsx \
    packages/uxfactory-plugin/test/screen-artifacts.test.tsx \
    packages/uxfactory-plugin/test/screen-checks.test.tsx \
    packages/uxfactory-plugin/test/screen-prompt.test.tsx \
    packages/uxfactory-plugin/test/screen-components.test.tsx \
    packages/uxfactory-plugin/test/screen-assets.test.tsx \
    packages/uxfactory-plugin/test/screen-setup1.test.tsx \
    packages/uxfactory-plugin/test/screen-setup2.test.tsx
  git commit -m "$(cat <<'EOF'
  panel: delete store route/focus/polls; router is the sole navigation source

  Remove route/focus fields, setFocus/clearFocus/goto/setTab/refreshSnapshot, and
  the interim StoreRouteBridge. Cancel navigates via router. e2e/routing walks
  re-anchored on router locations. Grep-clean: zero setInterval polling or route/
  focus in ui/. Bundle measured under the 2MB budget.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Open items

None. Every spec §2 architecture bullet and §6 success criterion maps to a task+step:
- §2 router via `createMemoryHistory` + route tree → Task 1 (`ui/router.tsx`, `createAppRouter`).
- §2 typed search params replace focus intents → Task 3 (`?focus=`), Task 5 (`?run=`), Task 7 (delete `focus`/`setFocus`/`clearFocus`).
- §2 Query owns server state (snapshot/health/stats/logs/skills/links/latestRender + mutations) → Tasks 2–6; navigation only in `onSuccess` → Task 4 (Connect/Setup), Task 6 (Components check).
- §2 `invalidateQueries` replaces `refreshSnapshot()` + Artifacts pending poll → Task 3.
- §2 Zustand keeps client state only; `route` moves out → Task 7 (snapshot retained per resolved-ambiguity 1).
- §2 boot ends in `router.navigate`, race guard preserved → Task 1 (`main.tsx`).
- §2 one `QueryClientProvider` + `RouterProvider` → Task 1 (`main.tsx`).
- §6.1 zero `setInterval`/manual pending flags in `ui/screens/**` → Task 7 grep-clean.
- §6.2 `route`/`focus` gone; router-only navigation → Task 7.
- §6.3 all suites green; bundle < 2MB → per-task gate + Task 7 measurement.
- §6.4 extractable `ui/router.tsx` + `ui/queries.ts` → Task 1.

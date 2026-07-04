/**
 * test-utils.tsx — renderWithProviders wraps a screen (or a pre-built app
 * router) in QueryClientProvider + RouterProvider so Query hooks, useNavigate,
 * and useSearch resolve. For bare-screen renders it builds a harness route tree
 * whose every leaf renders the passed `ui`, so navigation targets resolve
 * (router.state.location updates) while the screen under test stays mounted.
 *
 * renderWithProviders is async: it awaits router.load() before mounting so the
 * initial route is already matched and rendered on the first paint (no extra
 * waitFor needed for the initial DOM to appear).
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
  const queueRoute = createRoute({
    getParentRoute: () => tabsRoute,
    path: "queue",
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
      queueRoute,
    ]),
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
  });
}

export async function renderWithProviders(
  ui: React.ReactNode,
  opts: RenderWithProvidersOptions = {},
): Promise<RenderResult & { router: AnyRouter; queryClient: QueryClient }> {
  const queryClient = opts.queryClient ?? makeQueryClient();
  const router =
    opts.router ?? makeHarnessRouter(ui, opts.initialEntries ?? ["/"]);
  await router.load();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, router, queryClient };
}

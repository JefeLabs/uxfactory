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

/** The bridge's active project root (null on legacy fakes without the method). */
export function activeRoot(bridge: Bridge): string | null {
  return bridge.getProjectRoot?.() ?? null;
}

export const queryKeys = {
  snapshot: (root: string | null) => ["snapshot", root] as const,
  health: ["health"] as const,
  stats: ["stats"] as const,
  logs: (tail: number) => ["logs", tail] as const,
  skills: ["skills"] as const,
  links: (root: string | null) => ["links", root] as const,
  latestRender: (run: string | undefined) =>
    ["latestRender", run ?? null] as const,
  artifact: (root: string | null, key: string) => ["artifact", root, key] as const,
  renderQueue: (root: string | null) => ["renderQueue", root] as const,
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
    queryKey: queryKeys.snapshot(activeRoot(bridge)),
    queryFn: () => bridge.snapshot(),
    staleTime: 5_000,
  });
}

/** Pending render jobs awaiting approval — polled so the badge stays live. */
export function renderQueueQuery(bridge: Bridge) {
  return queryOptions({
    queryKey: queryKeys.renderQueue(activeRoot(bridge)),
    queryFn: () => bridge.listRenderQueue!(),
    enabled: typeof bridge.listRenderQueue === "function",
    staleTime: 0,
    refetchInterval: 5_000,
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
    queryKey: queryKeys.links(activeRoot(bridge)),
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
    queryKey: queryKeys.artifact(activeRoot(bridge), key),
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

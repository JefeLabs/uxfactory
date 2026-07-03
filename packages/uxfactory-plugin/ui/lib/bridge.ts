/**
 * bridge.ts — Typed fetch client for all UXFactory bridge routes.
 *
 * Types are mirrored from packages/uxfactory-bridge/src/project.ts.  The UI
 * MUST NOT import from the bridge package directly (boundary enforced by the
 * plugin's tsconfig which only resolves workspace packages that are explicitly
 * aliased in vitest.config.ts).
 *
 * SSE implementation mirrors pipeline-client.ts's fetch-stream reader pattern
 * so the plugin sandbox's null-origin iframe can consume the event stream
 * reliably without depending on EventSource.
 */

// ─── Mirrored types (do NOT import from @uxfactory/bridge) ───────────────────

export type ArtifactGroup = "product" | "ia-ux" | "design" | "assets";
export type ArtifactStatus = "up-to-date" | "draft" | "missing";

export interface ArtifactRow {
  key: string;
  group: ArtifactGroup;
  label: string;
  status: ArtifactStatus;
  meta: string;
  path: string | null;
}

export interface Requirement {
  id: string;
  title: string;
}

export interface ProjectSnapshot {
  name: string;
  root: string;
  hasClassification: boolean;
  hasProfile: boolean;
  classification: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  artifacts: ArtifactRow[];
  requirements: Requirement[];
}

export interface Link {
  nodeId: string;
  unitName: string;
  unitType: string;
  acId: string;
}

// ─── Bridge-specific types ────────────────────────────────────────────────────

export interface BridgeStats {
  version: string;
  uptimeMs: number;
  runsRelayed: number;
  tokenCount: number | null;
}

export interface BridgeLogsResponse {
  lines: string[];
}

export interface SkillEntry {
  name: string;
  rev: string;
  pinned: boolean;
}

export interface SkillsResponse {
  skills: SkillEntry[];
}

export interface PipelineEnqueueRequest {
  kind: string;
  payload?: unknown;
}

export interface PipelineEnqueueResponse {
  id: string;
}

export interface BridgeEvent {
  requestId: string;
  event: unknown;
  seq: number;
}

export interface ArtifactContent {
  key: string;
  path: string;
  format: "markdown" | "json";
  content: string;
}

export interface RepoListing {
  root: string;
  name: string;
  lastConnectedAt: number;
  live: boolean;
}

export interface ReposResponse {
  cwd: string;
  repos: RepoListing[];
}

export interface ConnectOk {
  ok: true;
  snapshot: ProjectSnapshot;
}

export interface ConnectError {
  ok: false;
  reason: "not-found" | "not-a-root" | "bridge-serves-different-root";
  served?: string;
}

export type ConnectResult = ConnectOk | ConnectError;

// ─── BridgeError ─────────────────────────────────────────────────────────────

export class BridgeError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Bridge error ${status}`);
    this.name = "BridgeError";
  }
}

// ─── Bridge interface ─────────────────────────────────────────────────────────

export interface Bridge {
  /** GET /health */
  health(): Promise<{ ok: boolean; pending?: number }>;
  /** POST /project/connect */
  connectProject(repoPath: string): Promise<ConnectResult>;
  /** GET /project/snapshot */
  snapshot(): Promise<ProjectSnapshot>;
  /** PUT /project/classification */
  putClassification(body: Record<string, unknown>): Promise<{ ok: boolean }>;
  /** PUT /project/profile */
  putProfile(body: Record<string, unknown>): Promise<{ ok: boolean }>;
  /** GET /project/links */
  getLinks(): Promise<{ links: Link[] }>;
  /** PUT /project/links */
  putLinks(links: Link[]): Promise<{ ok: boolean }>;
  /** POST /project/open */
  openPath(path: string): Promise<{ ok: boolean }>;
  /** GET /stats */
  stats(): Promise<BridgeStats>;
  /** GET /logs?tail=N */
  logs(tail?: number): Promise<BridgeLogsResponse>;
  /** GET /skills (optional — absent in legacy bridge builds) */
  skills?(): Promise<SkillsResponse>;
  /** POST /pipeline/request */
  enqueue(request: PipelineEnqueueRequest): Promise<PipelineEnqueueResponse>;
  /**
   * Subscribe to the /pipeline/events SSE stream.
   * Returns a teardown function that closes the stream.
   */
  events(onEvent: (event: BridgeEvent) => void): () => void;
  /** GET /rendered */
  latestRender(): Promise<unknown>;
  /** POST /verify */
  verify(body: unknown): Promise<unknown>;
  /** GET /project/artifact?key= → {key, path, format, content} (404 when missing) */
  getArtifact?(key: string): Promise<ArtifactContent>;
  /** PUT /project/artifact {key, content} → {ok} */
  putArtifact?(key: string, content: string): Promise<{ ok: boolean }>;
  /** GET /fs/cwd — bridge working directory, the Connect repo-path hint (optional — absent in legacy bridge builds) */
  getCwd?(): Promise<{ cwd: string }>;
  /** Set the active project root; appended as ?root= to root-scoped verbs. null clears it. */
  setProjectRoot?(root: string | null): void;
  /** The active project root, or null. Used to key root-scoped query cache entries. */
  getProjectRoot?(): string | null;
  /** GET /fs/repos — repo discovery list (optional — absent in legacy bridge builds). */
  getRepos?(): Promise<ReposResponse>;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export const BASE = "http://localhost:3779";

/**
 * Creates a typed Bridge client.
 *
 * @param fetchImpl - Optional fetch implementation for testing; defaults to
 *   the global `fetch`.
 */
export function createBridge(fetchImpl?: typeof fetch): Bridge {
  const doFetch = fetchImpl ?? fetch;
  const root = BASE.replace(/\/+$/, "");

  let projectRoot: string | null = null;

  /** Append ?root= / &root= to a path when a project root is set. */
  function rooted(p: string): string {
    if (projectRoot === null) return p;
    const sep = p.includes("?") ? "&" : "?";
    return `${p}${sep}root=${encodeURIComponent(projectRoot)}`;
  }

  async function request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const res = await doFetch(`${root}${path}`, init);
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => null);
      }
      throw new BridgeError(res.status, body);
    }
    return res.json() as Promise<T>;
  }

  function post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function put<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ── SSE helpers (mirrors pipeline-client.ts's fetch-stream reader) ──────────

  function parseFrame(frameText: string): BridgeEvent | null {
    let data = "";
    for (const rawLine of frameText.split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "" || line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        const piece = line.slice(5);
        data += piece.startsWith(" ") ? piece.slice(1) : piece;
      }
    }
    if (data === "") return null;
    try {
      return JSON.parse(data) as BridgeEvent;
    } catch {
      return null;
    }
  }

  function subscribeViaFetchStream(onEvent: (e: BridgeEvent) => void): () => void {
    let closed = false;
    let lastSeq = 0;
    let controller: AbortController | null = null;

    const deliver = (frameText: string): void => {
      if (closed) return;
      const frame = parseFrame(frameText);
      if (frame === null) return;
      if (typeof frame.seq === "number") {
        if (frame.seq <= lastSeq) return;
        lastSeq = frame.seq;
      }
      onEvent(frame);
    };

    const run = async (): Promise<void> => {
      while (!closed) {
        controller = new AbortController();
        const headers: Record<string, string> =
          lastSeq > 0 ? { "Last-Event-ID": String(lastSeq) } : {};
        let res: Response;
        try {
          res = await doFetch(`${root}/pipeline/events`, {
            headers,
            signal: controller.signal,
          });
        } catch {
          break;
        }
        const body = res.body;
        if (!body) break;
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const frameText = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              deliver(frameText);
            }
          }
        } catch {
          // stream error → reconnect
        }
      }
    };

    void run();

    return () => {
      closed = true;
      controller?.abort();
    };
  }

  // ── Public Bridge methods ────────────────────────────────────────────────────

  return {
    health() {
      return request<{ ok: boolean; pending?: number }>("/health");
    },

    connectProject(repoPath: string) {
      return post<ConnectResult>("/project/connect", { repoPath });
    },

    snapshot() {
      return request<ProjectSnapshot>(rooted("/project/snapshot"));
    },

    putClassification(body: Record<string, unknown>) {
      return put<{ ok: boolean }>(rooted("/project/classification"), body);
    },

    putProfile(body: Record<string, unknown>) {
      return put<{ ok: boolean }>(rooted("/project/profile"), body);
    },

    getLinks() {
      return request<{ links: Link[] }>(rooted("/project/links"));
    },

    putLinks(links: Link[]) {
      return put<{ ok: boolean }>(rooted("/project/links"), { links });
    },

    openPath(path: string) {
      return post<{ ok: boolean }>(rooted("/project/open"), { path });
    },

    stats() {
      return request<BridgeStats>("/stats");
    },

    logs(tail?: number) {
      const qs = tail !== undefined ? `?tail=${tail}` : "";
      return request<BridgeLogsResponse>(`/logs${qs}`);
    },

    skills() {
      return request<SkillsResponse>("/skills");
    },

    enqueue(requestBody: PipelineEnqueueRequest) {
      return post<PipelineEnqueueResponse>(rooted("/pipeline/request"), requestBody);
    },

    events(onEvent: (event: BridgeEvent) => void) {
      return subscribeViaFetchStream(onEvent);
    },

    latestRender() {
      return request<unknown>("/rendered");
    },

    verify(body: unknown) {
      return post<unknown>("/verify", body);
    },

    getArtifact(key: string) {
      return request<ArtifactContent>(
        rooted(`/project/artifact?key=${encodeURIComponent(key)}`),
      );
    },

    putArtifact(key: string, content: string) {
      return put<{ ok: boolean }>(rooted("/project/artifact"), { key, content });
    },

    getCwd() {
      return request<{ cwd: string }>("/fs/cwd");
    },

    setProjectRoot(next: string | null) {
      projectRoot = next;
    },

    getProjectRoot() {
      return projectRoot;
    },

    getRepos() {
      return request<ReposResponse>("/fs/repos");
    },
  };
}

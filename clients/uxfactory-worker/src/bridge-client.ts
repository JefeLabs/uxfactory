/**
 * WorkerBridgeClient — the worker's view of the bridge `/pipeline/*` relay.
 *
 * The bridge is a pure broker (no LLM, no helmsmith awareness): the worker PULLS
 * queued requests, POSTS terminal results, POSTS streamed events, and SUBSCRIBES
 * to the SSE stream. The SSE subscription is used ONLY as a low-latency "new work"
 * wake signal — the authoritative read is always `pullRequest()` draining to 204.
 *
 * Shapes mirror `packages/uxfactory-bridge/src/server.ts`:
 *   GET  /pipeline/request/next  → 204 (empty) | 200 PipelineRequest
 *   POST /pipeline/result        → { id, status, result }   → { ok:true }
 *   POST /pipeline/event         → { requestId, event }      → { ok:true }
 *   GET  /pipeline/events        → SSE (`id: <seq>\ndata: <json>\n\n` frames)
 */

/** One queued pipeline request, exactly as the bridge enqueues it. */
export interface PipelineRequest {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: number;
  /** Resolved project root this job is scoped to. */
  root?: string;
}

/**
 * The bridge surface the worker loop depends on. `WorkerBridgeClient` is the real
 * implementation; tests inject a fake so the loop is exercised without HTTP.
 */
export interface BridgeLike {
  pullRequest(): Promise<PipelineRequest | null>;
  postResult(id: string, status: number, result: unknown): Promise<void>;
  postEvent(requestId: string, event: unknown): Promise<void>;
  /** Subscribe to the SSE "new work" signal; returns an unsubscribe function. */
  subscribeEvents(onWake: () => void): () => void;
}

/** Backoff before reconnecting a dropped SSE stream. */
const SSE_RECONNECT_MS = 1000;

export class WorkerBridgeClient implements BridgeLike {
  private readonly base: string;
  private readonly projectRoot: string | null;
  private readonly kinds: readonly string[] | null;

  constructor(bridgeUrl: string, projectRoot?: string, kinds?: readonly string[]) {
    // Tolerate a trailing slash so `${base}/pipeline/...` never doubles up.
    this.base = bridgeUrl.replace(/\/+$/, '');
    this.projectRoot = projectRoot ?? null;
    this.kinds = kinds !== undefined && kinds.length > 0 ? kinds : null;
  }

  /** Pull the next queued request (FIFO); null when the bridge returns 204. */
  async pullRequest(): Promise<PipelineRequest | null> {
    const params = new URLSearchParams();
    if (this.projectRoot !== null) params.set('root', this.projectRoot);
    if (this.kinds !== null) params.set('kinds', this.kinds.join(','));
    const qs = params.toString() !== '' ? `?${params.toString()}` : '';
    const res = await fetch(`${this.base}/pipeline/request/next${qs}`);
    if (res.status === 204) return null;
    if (!res.ok) {
      throw new Error(`pullRequest: bridge returned ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as PipelineRequest;
  }

  /** Post the terminal result for a request (the CLI/adapter exit code as `status`). */
  async postResult(id: string, status: number, result: unknown): Promise<void> {
    const res = await fetch(`${this.base}/pipeline/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, status, result }),
    });
    if (!res.ok) {
      throw new Error(`postResult: bridge returned ${res.status} ${res.statusText}`);
    }
  }

  /** Forward a streamed event (an AgentChunk) for the panel; opaque to the bridge. */
  async postEvent(requestId: string, event: unknown): Promise<void> {
    const res = await fetch(`${this.base}/pipeline/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, event }),
    });
    if (!res.ok) {
      throw new Error(`postEvent: bridge returned ${res.status} ${res.statusText}`);
    }
  }

  /**
   * Subscribe to the SSE event stream as a wake signal. Every `data:` frame calls
   * `onWake()`; keep-alive comment frames (no `data:` line) are ignored. The stream
   * is reconnected after a drop until the returned unsubscribe is invoked.
   */
  subscribeEvents(onWake: () => void): () => void {
    const controller = new AbortController();
    let stopped = false;

    const run = async (): Promise<void> => {
      while (!stopped) {
        try {
          // Tag the subscription so the bridge can track worker presence
          // (spec 2026-07-09-worker-liveness): client=worker always; root/kinds
          // only when configured, so a bare client stays legacy-shaped.
          const params = new URLSearchParams({ client: 'worker' });
          if (this.projectRoot !== null) params.set('root', this.projectRoot);
          if (this.kinds !== null) params.set('kinds', this.kinds.join(','));
          const res = await fetch(`${this.base}/pipeline/events?${params.toString()}`, {
            headers: { accept: 'text/event-stream' },
            signal: controller.signal,
          });
          if (res.body === null) {
            await delay(SSE_RECONNECT_MS);
            continue;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let sep: number;
            while ((sep = buf.indexOf('\n\n')) !== -1) {
              const frame = buf.slice(0, sep);
              buf = buf.slice(sep + 2);
              if (frame.split('\n').some((line) => line.startsWith('data:'))) onWake();
            }
          }
        } catch {
          // AbortError on unsubscribe, or a transient network drop — both fall
          // through to the reconnect backoff below (unless we've been stopped).
        }
        if (!stopped) await delay(SSE_RECONNECT_MS);
      }
    };

    void run();
    return () => {
      stopped = true;
      controller.abort();
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Don't keep the process alive solely for a reconnect timer.
    t.unref?.();
  });
}

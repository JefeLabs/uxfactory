/**
 * pipeline-client.ts — the plugin UI's thin wrapper over the bridge's
 * `/pipeline/*` HTTP surface plus the `/pipeline/events` SSE stream. This is the
 * ONLY new bridge surface the pipeline panel talks to.
 *
 * BOUNDARY (load-bearing): this module is a pure HTTP relay client. It has no
 * agent-runtime, model, or remote-orchestration imports — only `fetch` and
 * (optionally) an injected `EventSource`. `kind`, `payload`, `result`, and
 * `event` are all opaque pass-throughs; the client never inspects them.
 *
 * SSE TRANSPORT CHOICE — fetch-stream reader (default), EventSource (opt-in):
 *   The Figma plugin UI runs inside a sandboxed, null-origin `<iframe>`. `fetch`
 *   is reliably available there (the existing `ui.ts` already uses it to reach
 *   the bridge), but `EventSource` is NOT dependable in that sandbox — and even
 *   where it exists it gives no control over the `Last-Event-ID` *request*
 *   header or the reconnect cadence the bridge's deterministic replay ring needs
 *   for clean de-dup by `seq`. So `subscribe` DEFAULTS to a `fetch`-stream
 *   reader (`response.body.getReader()`) with manual SSE framing: it parses
 *   `data:` frames, skips `:` keep-alive comments, de-dupes by `seq`, and
 *   reconnects on drop by re-issuing the request with `Last-Event-ID: <lastSeq>`.
 *   When a caller injects `deps.EventSourceCtor`, the native EventSource path is
 *   used instead — there keep-alive skipping and reconnect/Last-Event-ID are the
 *   platform's job; we still de-dupe by `seq` and `close()` on unsubscribe.
 */

/** One relayed pipeline event frame (mirrors the bridge's `PipelineEvent`). */
export interface PipelineEventFrame {
  requestId: string;
  event: unknown;
  seq: number;
}

/** Result of polling `GET /pipeline/result/:id`. */
export type PollResult =
  | { status: "pending" }
  | { status: "done"; result: { status: number; result: unknown } }
  | { status: "unknown" };

export interface PipelineClient {
  /** POST /pipeline/request {kind,payload} -> id */
  enqueue(kind: string, payload?: unknown): Promise<string>;
  /** GET /pipeline/result/:id mapped: 200 -> done, 202 -> pending, 404 -> unknown */
  pollResult(id: string): Promise<PollResult>;
  /** Subscribe to the SSE stream; returns an unsubscribe fn that closes it. */
  subscribe(onEvent: (e: PipelineEventFrame) => void): () => void;
}

export interface PipelineClientDeps {
  fetch?: typeof fetch;
  EventSourceCtor?: typeof EventSource;
}

export function createPipelineClient(
  baseUrl: string,
  deps: PipelineClientDeps = {},
): PipelineClient {
  const doFetch = deps.fetch ?? fetch;
  const EventSourceCtor = deps.EventSourceCtor;
  const root = baseUrl.replace(/\/+$/, "");

  async function enqueue(kind: string, payload?: unknown): Promise<string> {
    const res = await doFetch(`${root}/pipeline/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `payload: undefined` is dropped by JSON.stringify, matching the bridge
      // contract `{kind,payload?}`.
      body: JSON.stringify({ kind, payload }),
    });
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  async function pollResult(id: string): Promise<PollResult> {
    const res = await doFetch(`${root}/pipeline/result/${encodeURIComponent(id)}`);
    if (res.status === 200) {
      // The bridge returns the stored PipelineResult `{id,status,result}`; the
      // panel only needs `{status,result}`.
      const body = (await res.json()) as { status: number; result: unknown };
      return { status: "done", result: { status: body.status, result: body.result } };
    }
    if (res.status === 202) return { status: "pending" };
    return { status: "unknown" };
  }

  function subscribe(onEvent: (e: PipelineEventFrame) => void): () => void {
    return EventSourceCtor
      ? subscribeViaEventSource(EventSourceCtor, onEvent)
      : subscribeViaFetchStream(onEvent);
  }

  /** Parse one SSE frame's text into a PipelineEventFrame, or null to skip. */
  function parseFrame(frameText: string): PipelineEventFrame | null {
    let data = "";
    for (const rawLine of frameText.split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "" || line.startsWith(":")) continue; // blank or keep-alive comment
      if (line.startsWith("data:")) {
        const piece = line.slice(5);
        data += piece.startsWith(" ") ? piece.slice(1) : piece;
      }
      // `id:` lines carry the seq, but the seq is also inside the JSON payload,
      // so we read it from there once parsed.
    }
    if (data === "") return null;
    try {
      return JSON.parse(data) as PipelineEventFrame;
    } catch {
      return null;
    }
  }

  function subscribeViaFetchStream(onEvent: (e: PipelineEventFrame) => void): () => void {
    let closed = false;
    let lastSeq = 0;
    let controller: AbortController | null = null;

    const deliver = (frameText: string): void => {
      if (closed) return;
      const frame = parseFrame(frameText);
      if (frame === null) return;
      if (typeof frame.seq === "number") {
        if (frame.seq <= lastSeq) return; // de-dupe replayed/duplicate events
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
          break; // connection refused — stop (no busy-spin)
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
          // stream error → fall through and reconnect (unless unsubscribed)
        }
        // Stream ended: loop reconnects with the updated Last-Event-ID, unless
        // unsubscribe flipped `closed`.
      }
    };

    void run();

    return () => {
      closed = true;
      controller?.abort();
    };
  }

  function subscribeViaEventSource(
    Ctor: typeof EventSource,
    onEvent: (e: PipelineEventFrame) => void,
  ): () => void {
    let closed = false;
    let lastSeq = 0;
    const es = new Ctor(`${root}/pipeline/events`);
    // EventSource only fires `message` for `data:` events (keep-alive comments
    // are swallowed by the platform) and handles reconnect + Last-Event-ID
    // itself; we still de-dupe by seq in case of a replay on reconnect.
    es.onmessage = (ev: MessageEvent): void => {
      if (closed) return;
      let frame: PipelineEventFrame;
      try {
        frame = JSON.parse(String(ev.data)) as PipelineEventFrame;
      } catch {
        return;
      }
      if (typeof frame.seq === "number") {
        if (frame.seq <= lastSeq) return;
        lastSeq = frame.seq;
      }
      onEvent(frame);
    };
    return () => {
      closed = true;
      es.close();
    };
  }

  return { enqueue, pollResult, subscribe };
}

import { describe, it, expect, vi } from "vitest";
import { createPipelineClient } from "./pipeline-client.js";

const BASE = "http://localhost:3779";

/** Minimal Response-like object for enqueue/pollResult assertions. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

/**
 * A fake `ReadableStream` body whose reader yields `chunks` once, then either
 * reports `done` (stream ended) or stays pending until the AbortSignal fires.
 */
function bodyFromChunks(
  chunks: Uint8Array[],
  pendingAfter: boolean,
  signal?: AbortSignal,
): Response {
  let i = 0;
  const reader = {
    async read(): Promise<{ value: Uint8Array | undefined; done: boolean }> {
      if (i < chunks.length) {
        return { value: chunks[i++], done: false };
      }
      if (!pendingAfter) return { value: undefined, done: true };
      return new Promise((resolve) => {
        if (signal?.aborted) {
          resolve({ value: undefined, done: true });
          return;
        }
        signal?.addEventListener(
          "abort",
          () => resolve({ value: undefined, done: true }),
          { once: true },
        );
      });
    },
    cancel() {},
  };
  return { body: { getReader: () => reader } } as unknown as Response;
}

describe("createPipelineClient.enqueue", () => {
  it("POSTs {kind,payload} to /pipeline/request and returns the id", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { id: "req-1" });
    });
    const client = createPipelineClient(BASE, {
      fetch: fakeFetch as unknown as typeof fetch,
    });

    const id = await client.enqueue("classify", { kind: "page" });

    expect(id).toBe("req-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/pipeline/request`);
    expect(calls[0]!.init?.method).toBe("POST");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["content-type"]).toMatch(/application\/json/);
    expect(calls[0]!.init?.body).toBe(
      JSON.stringify({ kind: "classify", payload: { kind: "page" } }),
    );
  });

  it("omits payload from the body when not provided", async () => {
    let captured: RequestInit | undefined;
    const fakeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = init;
      return jsonResponse(200, { id: "r2" });
    });
    const client = createPipelineClient(BASE, {
      fetch: fakeFetch as unknown as typeof fetch,
    });

    await client.enqueue("gate");

    expect(captured?.body).toBe(JSON.stringify({ kind: "gate" }));
  });
});

describe("createPipelineClient.pollResult", () => {
  it("maps 200 to done with {status,result}", async () => {
    const calls: string[] = [];
    const fakeFetch = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonResponse(200, { id: "r1", status: 0, result: { artifacts: 3 } });
    });
    const client = createPipelineClient(BASE, {
      fetch: fakeFetch as unknown as typeof fetch,
    });

    const r = await client.pollResult("r1");

    expect(calls[0]).toBe(`${BASE}/pipeline/result/r1`);
    expect(r).toEqual({
      status: "done",
      result: { status: 0, result: { artifacts: 3 } },
    });
  });

  it("maps 202 to pending", async () => {
    const fakeFetch = vi.fn(async () => jsonResponse(202, { pending: true }));
    const client = createPipelineClient(BASE, {
      fetch: fakeFetch as unknown as typeof fetch,
    });
    expect(await client.pollResult("r1")).toEqual({ status: "pending" });
  });

  it("maps 404 to unknown", async () => {
    const fakeFetch = vi.fn(async () => jsonResponse(404, { error: "nope" }));
    const client = createPipelineClient(BASE, {
      fetch: fakeFetch as unknown as typeof fetch,
    });
    expect(await client.pollResult("nope")).toEqual({ status: "unknown" });
  });
});

describe("createPipelineClient.subscribe (fetch-stream)", () => {
  it("parses frames, skips keep-alives, dedupes by seq, reconnects with Last-Event-ID, and unsubscribe stops delivery", async () => {
    const enc = new TextEncoder();
    const fetchCalls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (fetchCalls.length === 1) {
        const chunks = [
          enc.encode(
            `id: 1\ndata: ${JSON.stringify({ requestId: "r1", event: { type: "a" }, seq: 1 })}\n\n`,
          ),
          enc.encode(`: keep-alive\n\n`),
          enc.encode(
            `id: 2\ndata: ${JSON.stringify({ requestId: "r1", event: { type: "b" }, seq: 2 })}\n\n`,
          ),
          // replayed/duplicate seq 2 — must be deduped
          enc.encode(
            `id: 2\ndata: ${JSON.stringify({ requestId: "r1", event: { type: "b-dup" }, seq: 2 })}\n\n`,
          ),
        ];
        return bodyFromChunks(chunks, false);
      }
      // reconnect: stay open until aborted by unsubscribe
      return bodyFromChunks([], true, init?.signal ?? undefined);
    });

    const events: { requestId: string; event: unknown; seq: number }[] = [];
    const client = createPipelineClient(BASE, {
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const unsubscribe = client.subscribe((e) => events.push(e));

    await vi.waitFor(() => expect(events.map((e) => e.seq)).toEqual([1, 2]));
    await vi.waitFor(() => expect(fetchCalls.length).toBe(2));

    expect(fetchCalls[0]!.url).toBe(`${BASE}/pipeline/events`);
    const h0 = (fetchCalls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(h0["Last-Event-ID"]).toBeUndefined();
    const h1 = (fetchCalls[1]!.init?.headers ?? {}) as Record<string, string>;
    expect(h1["Last-Event-ID"]).toBe("2");

    // events carry the parsed PipelineEvent frame
    expect(events[0]).toEqual({ requestId: "r1", event: { type: "a" }, seq: 1 });
    expect(events[1]).toEqual({ requestId: "r1", event: { type: "b" }, seq: 2 });

    const before = events.length;
    unsubscribe();
    await new Promise((r) => setTimeout(r, 15));
    expect(events.length).toBe(before); // no more delivery
    expect(fetchCalls.length).toBe(2); // no reconnect after unsubscribe
  });
});

describe("createPipelineClient.subscribe (injected EventSource)", () => {
  it("delivers parsed events, dedupes by seq, and unsubscribe closes + stops delivery", () => {
    const instances: {
      url: string;
      closed: boolean;
      onmessage: ((ev: MessageEvent) => void) | null;
      emit(obj: unknown): void;
      close(): void;
    }[] = [];

    class FakeEventSource {
      url: string;
      closed = false;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      constructor(url: string) {
        this.url = url;
        instances.push(this);
      }
      close() {
        this.closed = true;
      }
      emit(obj: unknown) {
        // Always fire, even after close, so the client's own guard is tested.
        this.onmessage?.({ data: JSON.stringify(obj) } as MessageEvent);
      }
    }

    const events: { requestId: string; event: unknown; seq: number }[] = [];
    const client = createPipelineClient(BASE, {
      EventSourceCtor: FakeEventSource as unknown as typeof EventSource,
    });
    const unsubscribe = client.subscribe((e) => events.push(e));

    expect(instances).toHaveLength(1);
    const es = instances[0]!;
    expect(es.url).toBe(`${BASE}/pipeline/events`);

    es.emit({ requestId: "r1", event: { n: 1 }, seq: 1 });
    es.emit({ requestId: "r1", event: { n: 1 }, seq: 1 }); // duplicate seq -> skipped
    es.emit({ requestId: "r1", event: { n: 2 }, seq: 2 });
    expect(events.map((e) => e.seq)).toEqual([1, 2]);

    unsubscribe();
    expect(es.closed).toBe(true);
    es.emit({ requestId: "r1", event: { n: 3 }, seq: 3 }); // after unsubscribe -> guarded
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });
});

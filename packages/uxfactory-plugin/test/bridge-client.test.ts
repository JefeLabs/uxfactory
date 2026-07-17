/**
 * bridge-client.test.ts — Tests for ui/lib/bridge.ts
 *
 * Coverage:
 *   - Each method: correct URL, HTTP verb, request body.
 *   - BridgeError: thrown on non-ok response, exposes status and body.
 *   - SSE reader: events() parses two events from a fake stream; de-dupes by seq.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { createBridge, BridgeError } from "../ui/lib/bridge.js";

const BASE = "http://localhost:3779";

// ─── Fake fetch helpers ───────────────────────────────────────────────────────

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response) as unknown as typeof fetch;
}

function errorFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response) as unknown as typeof fetch;
}

// ─── health() ─────────────────────────────────────────────────────────────────

describe("bridge health()", () => {
  it("makes a GET request to /health", async () => {
    const fakeFetch = jsonFetch({ ok: true, pending: 0 });
    const bridge = createBridge(fakeFetch);
    const result = await bridge.health();
    expect(fakeFetch).toHaveBeenCalledWith(`${BASE}/health`, undefined);
    expect(result).toEqual({ ok: true, pending: 0 });
  });
});

// ─── connectProject() ─────────────────────────────────────────────────────────

describe("bridge connectProject()", () => {
  it("POSTs repoPath to /project/connect", async () => {
    const snapshot = { name: "Demo Shop", root: "/repo", hasClassification: false, hasProfile: false, classification: null, profile: null, artifacts: [], requirements: [] };
    const fakeFetch = jsonFetch({ ok: true, snapshot });
    const bridge = createBridge(fakeFetch);
    await bridge.connectProject("/home/user/demo-shop");

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/project/connect`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ repoPath: "/home/user/demo-shop" }),
      }),
    );
  });
});

// ─── snapshot() ──────────────────────────────────────────────────────────────

describe("bridge snapshot()", () => {
  it("GETs /project/snapshot", async () => {
    const snapshot = { name: "Demo Shop", root: "/repo", hasClassification: true, hasProfile: false, classification: {}, profile: null, artifacts: [], requirements: [] };
    const fakeFetch = jsonFetch(snapshot);
    const bridge = createBridge(fakeFetch);
    const result = await bridge.snapshot();
    expect(fakeFetch).toHaveBeenCalledWith(`${BASE}/project/snapshot`, undefined);
    expect(result.name).toBe("Demo Shop");
  });
});

// ─── putClassification() ──────────────────────────────────────────────────────

describe("bridge putClassification()", () => {
  it("PUTs body to /project/classification", async () => {
    const fakeFetch = jsonFetch({ ok: true });
    const bridge = createBridge(fakeFetch);
    const body = { category: "ecommerce", industry: "corporate" };
    await bridge.putClassification(body);

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/project/classification`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(body),
      }),
    );
  });
});

// ─── putProfile() ─────────────────────────────────────────────────────────────

describe("bridge putProfile()", () => {
  it("PUTs body to /project/profile", async () => {
    const fakeFetch = jsonFetch({ ok: true });
    const bridge = createBridge(fakeFetch);
    const body = { visual: "high", coverage: "medium" };
    await bridge.putProfile(body);

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/project/profile`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(body),
      }),
    );
  });
});

// ─── getLinks() ───────────────────────────────────────────────────────────────

describe("bridge getLinks()", () => {
  it("GETs /project/links", async () => {
    const links = [{ nodeId: "1:1", unitName: "Hero", unitType: "organism", acId: "ac-1" }];
    const fakeFetch = jsonFetch({ links });
    const bridge = createBridge(fakeFetch);
    const result = await bridge.getLinks();
    expect(fakeFetch).toHaveBeenCalledWith(`${BASE}/project/links`, undefined);
    expect(result.links).toHaveLength(1);
  });
});

// ─── putLinks() ───────────────────────────────────────────────────────────────

describe("bridge putLinks()", () => {
  it("PUTs links array to /project/links", async () => {
    const fakeFetch = jsonFetch({ ok: true });
    const bridge = createBridge(fakeFetch);
    const links = [{ nodeId: "1:2", unitName: "Nav", unitType: "organism", acId: "ac-2" }];
    await bridge.putLinks(links);

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/project/links`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ links }),
      }),
    );
  });
});

// ─── openPath() ───────────────────────────────────────────────────────────────

describe("bridge openPath()", () => {
  it("POSTs path to /project/open", async () => {
    const fakeFetch = jsonFetch({ ok: true });
    const bridge = createBridge(fakeFetch);
    await bridge.openPath("design/brief.md");

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/project/open`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "design/brief.md" }),
      }),
    );
  });
});

// ─── stats() ──────────────────────────────────────────────────────────────────

describe("bridge stats()", () => {
  it("GETs /stats", async () => {
    const stats = { version: "1.0.0", uptimeMs: 12345, runsRelayed: 7, tokenCount: 42 };
    const fakeFetch = jsonFetch(stats);
    const bridge = createBridge(fakeFetch);
    const result = await bridge.stats();
    expect(fakeFetch).toHaveBeenCalledWith(`${BASE}/stats`, undefined);
    expect(result.version).toBe("1.0.0");
  });
});

// ─── logs() ───────────────────────────────────────────────────────────────────

describe("bridge logs()", () => {
  it("GETs /logs without query param when tail is omitted", async () => {
    const fakeFetch = jsonFetch({ lines: [] });
    const bridge = createBridge(fakeFetch);
    await bridge.logs();
    expect(fakeFetch).toHaveBeenCalledWith(`${BASE}/logs`, undefined);
  });

  it("GETs /logs?tail=50 when tail=50 is provided", async () => {
    const fakeFetch = jsonFetch({ lines: ["line 1", "line 2"] });
    const bridge = createBridge(fakeFetch);
    const result = await bridge.logs(50);
    expect(fakeFetch).toHaveBeenCalledWith(`${BASE}/logs?tail=50`, undefined);
    expect(result.lines).toHaveLength(2);
  });
});

// ─── enqueue() ────────────────────────────────────────────────────────────────

describe("bridge enqueue()", () => {
  it("POSTs {kind, payload} to /pipeline/request and returns id", async () => {
    const fakeFetch = jsonFetch({ id: "req-abc" });
    const bridge = createBridge(fakeFetch);
    const result = await bridge.enqueue({ kind: "generate-design", payload: { prompt: "hero" } });

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/pipeline/request`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ kind: "generate-design", payload: { prompt: "hero" } }),
      }),
    );
    expect(result.id).toBe("req-abc");
  });

  it("POSTs without payload when payload is undefined", async () => {
    const fakeFetch = jsonFetch({ id: "req-xyz" });
    const bridge = createBridge(fakeFetch);
    await bridge.enqueue({ kind: "check-design" });

    const calls = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const body = JSON.parse((calls[0]![1] as RequestInit).body as string) as {
      kind: string;
      payload?: unknown;
    };
    expect(body.kind).toBe("check-design");
    // payload key is not present in the serialized JSON
    expect("payload" in body).toBe(false);
  });
});

// ─── latestRender() ───────────────────────────────────────────────────────────

describe("bridge latestRender()", () => {
  it("GETs /rendered", async () => {
    const fakeFetch = jsonFetch({ report: { status: "ok" } });
    const bridge = createBridge(fakeFetch);
    await bridge.latestRender();
    expect(fakeFetch).toHaveBeenCalledWith(`${BASE}/rendered`, undefined);
  });
});

// ─── verify() ─────────────────────────────────────────────────────────────────

describe("bridge verify()", () => {
  it("POSTs body to /verify", async () => {
    const fakeFetch = jsonFetch({ verdict: "pass" });
    const bridge = createBridge(fakeFetch);
    const body = { nodeId: "1:1", checkType: "contrast" };
    await bridge.verify(body);

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/verify`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  });
});

// ─── putIdentityComponents() ──────────────────────────────────────────────────

describe("bridge putIdentityComponents()", () => {
  it("PUTs {components} to /project/identity/components", async () => {
    const fakeFetch = jsonFetch({ ok: true });
    const bridge = createBridge(fakeFetch);
    const components = [
      { key: "c1", roleName: "icon", source: "figma-document" as const, matchability: "matchable" as const },
    ];
    await bridge.putIdentityComponents!(components);

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/project/identity/components`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ components }),
      }),
    );
  });

  it("rejects with BridgeError on a 400 validation failure", async () => {
    const fakeFetch = errorFetch(400, { errors: ['"components" must be an array'] });
    const bridge = createBridge(fakeFetch);
    await expect(bridge.putIdentityComponents!([])).rejects.toBeInstanceOf(BridgeError);
  });
});

// ─── postIdentityExtraction() ─────────────────────────────────────────────────

describe("bridge postIdentityExtraction()", () => {
  it("POSTs { extraction } (wrapped, matching putIdentityComponents' { components } convention) to /project/identity/extraction", async () => {
    const fakeFetch = jsonFetch({ ok: true, count: 0, addresses: [] });
    const bridge = createBridge(fakeFetch);
    const extraction = {
      version: 1 as const,
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
      nodes: [],
    };
    await bridge.postIdentityExtraction!(extraction);

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/project/identity/extraction`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ extraction }),
      }),
    );
  });

  it("rejects with a BridgeError carrying status 404 against an older bridge build without this route", async () => {
    const fakeFetch = errorFetch(404, { error: "not found" });
    const bridge = createBridge(fakeFetch);
    const extraction = {
      version: 1 as const,
      page: { figmaNodeId: "0:1", name: "Page 1" },
      pageCount: 1,
      nodes: [],
    };
    try {
      await bridge.postIdentityExtraction!(extraction);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).status).toBe(404);
    }
  });
});

// ─── postIdentityCrops() ───────────────────────────────────────────────────

describe("bridge postIdentityCrops()", () => {
  it("POSTs { crops } to /project/identity/crops", async () => {
    const fakeFetch = jsonFetch({ ok: true, written: 1 });
    const bridge = createBridge(fakeFetch);
    const crops = [{ durableId: "n-abc123456789", base64: "iVBORw0KGgo=" }];
    const result = await bridge.postIdentityCrops!(crops);

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/project/identity/crops`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ crops }),
      }),
    );
    expect(result).toEqual({ ok: true, written: 1 });
  });

  it("rejects with a BridgeError carrying status 404 against an older bridge build without this route", async () => {
    const fakeFetch = errorFetch(404, { error: "not found" });
    const bridge = createBridge(fakeFetch);
    try {
      await bridge.postIdentityCrops!([]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).status).toBe(404);
    }
  });
});

// ─── getIdentityManifest() ─────────────────────────────────────────────────

describe("bridge getIdentityManifest() (Task 11)", () => {
  it("GETs /project/identity/manifest and returns {manifest}", async () => {
    const manifest = { version: 1 as const, records: { "n-1": { durableId: "n-1" } } };
    const fakeFetch = jsonFetch({ manifest });
    const bridge = createBridge(fakeFetch);

    const result = await bridge.getIdentityManifest!();

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/project/identity/manifest`,
      undefined,
    );
    expect(result).toEqual({ manifest });
  });

  it("appends ?root= when a project root is set", async () => {
    const fakeFetch = jsonFetch({ manifest: { version: 1, records: {} } });
    const bridge = createBridge(fakeFetch);
    bridge.setProjectRoot!("/repo/root");

    await bridge.getIdentityManifest!();

    expect(fakeFetch).toHaveBeenCalledWith(
      `${BASE}/project/identity/manifest?root=${encodeURIComponent("/repo/root")}`,
      undefined,
    );
  });
});

// ─── BridgeError ─────────────────────────────────────────────────────────────

describe("BridgeError", () => {
  it("is thrown on a non-ok response", async () => {
    const fakeFetch = errorFetch(404, { error: "not found" });
    const bridge = createBridge(fakeFetch);
    await expect(bridge.health()).rejects.toBeInstanceOf(BridgeError);
  });

  it("exposes status and body", async () => {
    const fakeFetch = errorFetch(422, { error: "repoPath required" });
    const bridge = createBridge(fakeFetch);
    try {
      await bridge.connectProject("/bad");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeError);
      const bridgeErr = err as BridgeError;
      expect(bridgeErr.status).toBe(422);
      expect(bridgeErr.body).toEqual({ error: "repoPath required" });
    }
  });

  it("is a BridgeError with name 'BridgeError'", async () => {
    const fakeFetch = errorFetch(500, { error: "internal error" });
    const bridge = createBridge(fakeFetch);
    try {
      await bridge.snapshot();
    } catch (err) {
      expect((err as Error).name).toBe("BridgeError");
    }
  });

  it("is thrown for any 4xx/5xx status", async () => {
    for (const status of [400, 401, 403, 500, 503]) {
      const fakeFetch = errorFetch(status, { error: "err" });
      const bridge = createBridge(fakeFetch);
      await expect(bridge.health()).rejects.toBeInstanceOf(BridgeError);
    }
  });
});

// ─── events() — SSE reader ────────────────────────────────────────────────────

describe("bridge events() — SSE fetch-stream reader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  it("parses two events from a fake SSE stream", async () => {
    const events: { seq: number }[] = [];
    const stream = makeStream([
      'data: {"requestId":"req-1","event":{},"seq":1}\n\n',
      'data: {"requestId":"req-2","event":{},"seq":2}\n\n',
    ]);

    let callCount = 0;
    const fakeFetch = vi.fn().mockImplementation(
      async (_url: string, opts?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return { ok: true, body: stream } as Response;
        }
        // Second call (reconnect): hang until aborted
        return new Promise<Response>((_resolve, reject) => {
          const signal = (opts as RequestInit | undefined)?.signal;
          if (signal) {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      },
    );

    const bridge = createBridge(fakeFetch as unknown as typeof fetch);
    const teardown = bridge.events((e) => events.push(e as { seq: number }));

    // Let the stream drain and events be parsed
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    teardown();

    expect(events).toHaveLength(2);
    expect(events[0]?.seq).toBe(1);
    expect(events[1]?.seq).toBe(2);
  });

  it("de-dupes events by seq (lower seq is dropped)", async () => {
    const events: { seq: number }[] = [];
    // Send event seq=2 first, then seq=1 (which should be dropped as duplicate/replay)
    const stream = makeStream([
      'data: {"requestId":"r1","event":{},"seq":2}\n\n',
      'data: {"requestId":"r2","event":{},"seq":1}\n\n',  // seq 1 < lastSeq 2 → drop
    ]);

    let callCount = 0;
    const fakeFetch = vi.fn().mockImplementation(
      async (_url: string, opts?: RequestInit) => {
        callCount++;
        if (callCount === 1) return { ok: true, body: stream } as Response;
        return new Promise<Response>((_resolve, reject) => {
          const signal = (opts as RequestInit | undefined)?.signal;
          if (signal) signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    );

    const bridge = createBridge(fakeFetch as unknown as typeof fetch);
    const teardown = bridge.events((e) => events.push(e as { seq: number }));

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    teardown();

    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(2);
  });

  it("skips keep-alive comment lines (lines starting with ':')", async () => {
    const events: { seq: number }[] = [];
    const stream = makeStream([
      ": keep-alive\n\n",
      'data: {"requestId":"r1","event":{},"seq":1}\n\n',
    ]);

    let callCount = 0;
    const fakeFetch = vi.fn().mockImplementation(
      async (_url: string, opts?: RequestInit) => {
        callCount++;
        if (callCount === 1) return { ok: true, body: stream } as Response;
        return new Promise<Response>((_resolve, reject) => {
          const signal = (opts as RequestInit | undefined)?.signal;
          if (signal) signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    );

    const bridge = createBridge(fakeFetch as unknown as typeof fetch);
    const teardown = bridge.events((e) => events.push(e as { seq: number }));

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    teardown();

    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(1);
  });

  it("teardown stops event delivery", async () => {
    const events: unknown[] = [];
    const encoder = new TextEncoder();

    // A stream that delivers one event then hangs indefinitely — the teardown
    // abort is what stops delivery, not closing the stream.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"requestId":"r1","event":{},"seq":1}\n\n'),
        );
        // Intentionally left open (never calls controller.close).
        // The AbortController abort from teardown() breaks the reader loop.
      },
    });

    let callCount = 0;
    const fakeFetch = vi.fn().mockImplementation(
      async (_url: string, opts?: RequestInit) => {
        callCount++;
        if (callCount === 1) return { ok: true, body: stream } as Response;
        return new Promise<Response>((_resolve, reject) => {
          const signal = (opts as RequestInit | undefined)?.signal;
          if (signal) signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    );

    const bridge = createBridge(fakeFetch as unknown as typeof fetch);
    const teardown = bridge.events((e) => events.push(e));

    // Let first event arrive
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(events).toHaveLength(1);

    teardown(); // aborts the pending reader

    // After teardown, no more events should arrive (loop exits via abort)
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(events).toHaveLength(1);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUi } from "../src/ui.js";
import type { UiToMain } from "../src/messages.js";
import type { PipelineClient } from "../src/pipeline-client.js";

const DOM = `
  <div id="panel" data-state="COMPACT">
    <div id="status"></div>
    <div id="actions">
      <details id="details"><summary>m</summary><textarea id="spec"></textarea><button id="render-manual"></button></details>
      <button id="undo">Undo (0)</button>
      <div id="errors"></div>
    </div>
    <button id="expand"></button>
  </div>`;

const okFetch = (body: unknown, status = 200) =>
  vi.fn(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as unknown as Response,
  );

beforeEach(() => {
  document.body.innerHTML = DOM;
});

describe("ui poll", () => {
  it("posts a render message (with jobId) when GET /next returns a job", async () => {
    const postToMain = vi.fn();
    const fetchImpl = okFetch({ jobId: "job_9", spec: { edits: [] } });
    const ui = createUi({ postToMain, fetchImpl });
    await ui.pollOnce();
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:3779/next");
    expect(postToMain).toHaveBeenCalledWith({
      type: "render",
      spec: { edits: [] },
      jobId: "job_9",
    });
  });

  it("does nothing on a 204 (empty queue)", async () => {
    const postToMain = vi.fn();
    const ui = createUi({ postToMain, fetchImpl: okFetch(null, 204) });
    await ui.pollOnce();
    expect(postToMain).not.toHaveBeenCalled();
  });
});

describe("ui main-message handling", () => {
  it("POSTs a render report (with jobId) to /rendered", async () => {
    const fetchImpl = okFetch({});
    const ui = createUi({ fetchImpl, postToMain: vi.fn() });
    const report = {
      renderId: "r_1",
      editor: "figma",
      page: "P",
      pageKey: "0:1",
      fileName: "F",
      fileKey: "k",
      counts: { frames: 0, sections: 0, objects: 0, connectors: 0 },
      nodes: [],
      jobId: "job_9",
    };
    await ui.onMainMessage({ type: "rendered", report } as Extract<UiToMain, never> extends never
      ? never
      : never extends never
        ? { type: "rendered"; report: typeof report }
        : never);
    const [url, init] = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3779/rendered");
    expect(JSON.parse(init.body as string).jobId).toBe("job_9");
  });

  it("updates the Undo (n) label on undo-count", async () => {
    const ui = createUi({ fetchImpl: okFetch({}), postToMain: vi.fn() });
    await ui.onMainMessage({ type: "undo-count", count: 3 });
    expect(document.getElementById("undo")!.textContent).toBe("Undo (3)");
  });
});

describe("ui manual textarea", () => {
  it("renders a valid manual spec", () => {
    const postToMain = vi.fn();
    const ui = createUi({ fetchImpl: okFetch({}), postToMain });
    (document.getElementById("spec") as HTMLTextAreaElement).value = JSON.stringify({
      edits: [{ id: "1:2", set: { x: 1 } }],
    });
    ui.submitManual();
    expect(postToMain).toHaveBeenCalledWith({
      type: "render",
      spec: { edits: [{ id: "1:2", set: { x: 1 } }] },
    });
  });

  it("shows errors and does NOT render an invalid manual spec", () => {
    const postToMain = vi.fn();
    const ui = createUi({ fetchImpl: okFetch({}), postToMain });
    (document.getElementById("spec") as HTMLTextAreaElement).value = JSON.stringify({
      frames: "not-an-array",
    });
    ui.submitManual();
    expect(document.getElementById("errors")!.textContent!.length).toBeGreaterThan(0);
    expect(postToMain).not.toHaveBeenCalled();
  });
});

describe("ui health-driven panel", () => {
  it("connects then disconnects, driving the panel state + a resize message", async () => {
    const postToMain = vi.fn();
    const up = createUi({ postToMain, fetchImpl: okFetch({ ok: true }) });
    await up.checkHealth();
    expect(up.panel).toBe("CONNECTED_MIN");
    expect(postToMain).toHaveBeenCalledWith({ type: "resize", width: 156, height: 72 });

    const down = createUi({ postToMain: vi.fn(), fetchImpl: okFetch(null, 503) });
    await down.checkHealth(); // starts disconnected, ok=false → stays COMPACT
    expect(down.panel).toBe("COMPACT");
  });

  it("single controller: COMPACT → CONNECTED_MIN on healthy, then CONNECTED_MIN → COMPACT on failing", async () => {
    const postToMain = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as unknown as Response);

    const ui = createUi({ postToMain, fetchImpl });

    // First check: healthy → connect
    await ui.checkHealth();
    expect(ui.panel).toBe("CONNECTED_MIN");
    expect(postToMain).toHaveBeenCalledWith({ type: "resize", width: 156, height: 72 });
    expect(document.getElementById("status")!.textContent).toBe("Connected");

    // Second check: failing → disconnect
    await ui.checkHealth();
    expect(ui.panel).toBe("COMPACT");
    expect(postToMain).toHaveBeenCalledWith({ type: "resize", width: 540, height: 220 });
    expect(document.getElementById("status")!.textContent).toBe("Disconnected");

    // Both transitions posted a resize
    const resizeCalls = postToMain.mock.calls.filter((c) => c[0].type === "resize");
    expect(resizeCalls).toHaveLength(2);
  });
});

describe("ui Cmd/Ctrl+Z shortcut (Fix 4)", () => {
  it("dispatches Cmd+Z → posts an undo message", () => {
    const postToMain = vi.fn();
    const ui = createUi({ fetchImpl: okFetch({}), postToMain });
    ui.start();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { metaKey: true, key: "z", bubbles: true }),
    );
    ui.stop();
    expect(postToMain).toHaveBeenCalledWith({ type: "undo" });
  });

  it("dispatches Ctrl+Z → posts an undo message", () => {
    const postToMain = vi.fn();
    const ui = createUi({ fetchImpl: okFetch({}), postToMain });
    ui.start();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "z", bubbles: true }),
    );
    ui.stop();
    expect(postToMain).toHaveBeenCalledWith({ type: "undo" });
  });

  it("does NOT post undo for unrelated keydown events", () => {
    const postToMain = vi.fn();
    const ui = createUi({ fetchImpl: okFetch({}), postToMain });
    ui.start();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    ui.stop();
    expect(postToMain).not.toHaveBeenCalledWith({ type: "undo" });
  });
});

describe("ui clickReview — network-error resets status (Fix M3)", () => {
  it("status is reset to Connected after a network error (not stuck at Reviewing…)", async () => {
    const postToMain = vi.fn();
    // fetchImpl rejects immediately (network unreachable)
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const ui = createUi({ fetchImpl, postToMain });

    // Prime the status element to a known value
    const statusEl = document.getElementById("status")!;
    statusEl.textContent = "Connected";

    await ui.clickReview();

    // Error must be shown
    expect(document.getElementById("errors")!.textContent).toMatch(/Could not reach bridge/);
    // Status must NOT be stuck at "Reviewing…"
    expect(statusEl.textContent).not.toBe("Reviewing…");
    // Status is reset to "Connected" (same text checkHealth sets on a successful connect)
    expect(statusEl.textContent).toBe("Connected");
  });
});

describe("ui selection main-message", () => {
  it("POSTs the selection payload to /selection", async () => {
    const fetchImpl = okFetch({});
    const ui = createUi({ fetchImpl, postToMain: vi.fn() });
    const selection = {
      page: "Page 1",
      fileName: "MyFile",
      fileKey: "abc123",
      nodes: [{ id: "1:2", name: "Rect", type: "RECTANGLE", x: 0, y: 0, w: 100, h: 50 }],
      stylesInUse: 0,
    };
    await ui.onMainMessage({ type: "selection", selection });
    const [url, init] = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3779/selection");
    expect(JSON.parse(init.body as string)).toEqual(selection);
  });
});

// ---------------------------------------------------------------------------
// Pipeline panel mount/teardown lifecycle (Task 6 integration)
// ---------------------------------------------------------------------------

/** A fake pipeline client whose subscribe returns a tracked unsubscribe spy. */
function makeFakeClient(): {
  client: PipelineClient;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(() => unsubscribe);
  const client: PipelineClient = {
    enqueue: vi.fn(async () => "req-1"),
    pollResult: vi.fn(async () => ({ status: "pending" }) as const),
    subscribe: subscribe as unknown as PipelineClient["subscribe"],
  };
  return { client, subscribe, unsubscribe };
}

describe("ui pipeline panel mount/teardown (Fix Task 6)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="panel" data-state="COMPACT"><div id="status"></div></div>
      <div id="pipeline"></div>`;
  });

  it("mounts the panel on connect, sizes to PIPELINE, and renders into #pipeline", async () => {
    const postToMain = vi.fn();
    const { client, subscribe } = makeFakeClient();
    const ui = createUi({
      postToMain,
      fetchImpl: okFetch({ ok: true }),
      createClient: () => client,
    });

    await ui.checkHealth();

    expect(subscribe).toHaveBeenCalledTimes(1); // one SSE subscription
    expect(ui.panel).toBe("PIPELINE");
    expect(postToMain).toHaveBeenCalledWith({ type: "resize", width: 600, height: 640 });
    // the intake rendered into the container
    expect(document.getElementById("pipeline")!.innerHTML).toContain('data-action="define"');
  });

  it("tears down the SSE subscription cleanly on disconnect (no leak)", async () => {
    const postToMain = vi.fn();
    const { client, unsubscribe } = makeFakeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as unknown as Response);
    const ui = createUi({ postToMain, fetchImpl, createClient: () => client });

    await ui.checkHealth(); // connect → mount
    expect(unsubscribe).not.toHaveBeenCalled();

    await ui.checkHealth(); // disconnect → teardown
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(ui.panel).toBe("COMPACT");
  });

  it("re-subscribes cleanly on reconnect without leaking the prior subscription", async () => {
    const postToMain = vi.fn();
    const { client, subscribe, unsubscribe } = makeFakeClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response);
    const ui = createUi({ postToMain, fetchImpl, createClient: () => client });

    await ui.checkHealth(); // connect
    await ui.checkHealth(); // disconnect (teardown #1)
    await ui.checkHealth(); // reconnect (subscribe #2)

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(ui.panel).toBe("PIPELINE");
  });
});

describe("ui review-selection", () => {
  it("clickReviewSelection posts review-selection to main", () => {
    const postToMain = vi.fn();
    const ui = createUi({ fetchImpl: okFetch({}), postToMain });
    ui.clickReviewSelection();
    expect(postToMain).toHaveBeenCalledWith({ type: "review-selection" });
  });

  it("review-selection-ready POSTs snapshot+screenshot to /canvas", async () => {
    const fetchImpl = okFetch({});
    const ui = createUi({ fetchImpl, postToMain: vi.fn() });
    const snapshot = {
      source: "canvas-inferred" as const,
      page: "Page 1",
      frames: [
        {
          name: "Screen",
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          children: [{ type: "shape", name: "bg", x: 0, y: 0, width: 800, height: 600 }],
        },
      ],
    };
    const screenshot = [137, 80, 78, 71];
    await ui.onMainMessage({ type: "review-selection-ready", snapshot, screenshot });
    const [url, init] = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3779/canvas");
    const body = JSON.parse(init.body as string) as {
      snapshot: typeof snapshot;
      screenshot: number[];
    };
    expect(body.snapshot.source).toBe("canvas-inferred");
    expect(body.screenshot).toEqual(screenshot);
  });

  it("review-selection-error shows an error message", async () => {
    const ui = createUi({ fetchImpl: okFetch({}), postToMain: vi.fn() });
    await ui.onMainMessage({ type: "review-selection-error", message: "Select a frame first" });
    expect(document.getElementById("errors")!.textContent).toMatch(/Select a frame first/);
  });
});

// ---------------------------------------------------------------------------
// Fix M3 — review-selection-ready: /canvas POST error handling
// ---------------------------------------------------------------------------

describe("ui review-selection-ready — /canvas POST error handling (Fix M3)", () => {
  it("shows an error message when the /canvas POST throws (network down)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const ui = createUi({ fetchImpl, postToMain: vi.fn() });

    const snapshot = {
      source: "canvas-inferred" as const,
      page: "Page 1",
      frames: [{ name: "Screen", x: 0, y: 0, width: 375, height: 812, children: [] }],
    };
    await ui.onMainMessage({ type: "review-selection-ready", snapshot, screenshot: [0, 1, 2] });

    // Error must surface to the user (not silently swallowed).
    const errors = document.getElementById("errors")!.textContent ?? "";
    expect(errors).toMatch(/Could not reach bridge/i);
  });

  it("shows an error message when the /canvas POST returns a non-ok status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal error" }),
    } as unknown as Response);
    const ui = createUi({ fetchImpl, postToMain: vi.fn() });

    const snapshot = {
      source: "canvas-inferred" as const,
      page: "Page 1",
      frames: [{ name: "Screen", x: 0, y: 0, width: 375, height: 812, children: [] }],
    };
    await ui.onMainMessage({ type: "review-selection-ready", snapshot, screenshot: [] });

    const errors = document.getElementById("errors")!.textContent ?? "";
    expect(errors).toMatch(/500/);
  });

  it("does NOT show an error when the /canvas POST succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);
    const ui = createUi({ fetchImpl, postToMain: vi.fn() });

    const snapshot = {
      source: "canvas-inferred" as const,
      page: "Page 1",
      frames: [{ name: "Screen", x: 0, y: 0, width: 375, height: 812, children: [] }],
    };
    await ui.onMainMessage({ type: "review-selection-ready", snapshot, screenshot: [1, 2, 3] });

    const errors = document.getElementById("errors")!.textContent ?? "";
    expect(errors).toBe("");
  });
});

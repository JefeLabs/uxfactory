// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUi } from "../src/ui.js";
import type { UiToMain } from "../src/messages.js";

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

describe("ui selection main-message", () => {
  it("POSTs the selection payload to /selection", async () => {
    const fetchImpl = okFetch({});
    const ui = createUi({ fetchImpl, postToMain: vi.fn() });
    const selection = {
      page: "Page 1",
      fileName: "MyFile",
      fileKey: "abc123",
      nodes: [{ id: "1:2", name: "Rect", type: "RECTANGLE", x: 0, y: 0, w: 100, h: 50 }],
    };
    await ui.onMainMessage({ type: "selection", selection });
    const [url, init] = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3779/selection");
    expect(JSON.parse(init.body as string)).toEqual(selection);
  });
});

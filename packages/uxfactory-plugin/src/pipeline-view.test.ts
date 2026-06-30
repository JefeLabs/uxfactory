// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderPanel, wirePanel } from "./pipeline-view.js";
import {
  reduce,
  initialState,
  type PanelState,
  type PanelAction,
  type JobId,
} from "./panel-state.js";
import type { PipelineClient, PollResult } from "./pipeline-client.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A fully-defined project state (has a manifest → the job view, not intake). */
function definedState(overrides: Partial<PanelState> = {}): PanelState {
  const base: PanelState = {
    connection: "connected",
    project: {
      classification: {
        category: "ecommerce",
        industry: "finance",
        age_demographic: "26-35",
        style: "formal",
        scope: { visual: "medium", editorial: "low", coverage: "high", flow: "medium" },
      },
      manifest: { manifest: [] },
    },
    jobs: {
      "user-story": { artifacts: [], gates: [] },
      "acceptance-criteria": { artifacts: [], gates: [] },
      "user-journey": { artifacts: [], gates: [] },
    },
    activeJob: "acceptance-criteria",
  };
  return { ...base, ...overrides };
}

/** A connected, project-less state (intake, but buttons/chips are enabled). */
function connectedIntake(): PanelState {
  return { ...initialState, connection: "connected" };
}

/** A tiny real store (uses the real reducer) so getState reflects dispatches. */
function makeStore(start: PanelState) {
  let state = start;
  const dispatch = vi.fn((a: PanelAction) => {
    state = reduce(state, a);
  });
  return { dispatch, getState: () => state };
}

/** A fake PipelineClient whose result/event behaviour each test configures. */
function makeClient(over: Partial<PipelineClient> = {}) {
  const enqueued: { kind: string; payload?: unknown }[] = [];
  let onEvent: ((e: { requestId: string; event: unknown; seq: number }) => void) | null = null;
  const unsubscribe = vi.fn();
  const client: PipelineClient = {
    enqueue: vi.fn(async (kind: string, payload?: unknown) => {
      enqueued.push({ kind, payload });
      return "req-1";
    }),
    pollResult: vi.fn(async (): Promise<PollResult> => ({ status: "pending" })),
    subscribe: vi.fn((cb: (e: { requestId: string; event: unknown; seq: number }) => void) => {
      onEvent = cb;
      return unsubscribe;
    }),
    ...over,
  };
  return {
    client,
    enqueued,
    unsubscribe,
    emit: (e: { requestId: string; event: unknown; seq: number }) => onEvent?.(e),
  };
}

// ---------------------------------------------------------------------------
// renderPanel — intake (project undefined)
// ---------------------------------------------------------------------------

describe("renderPanel — intake when the project is not defined", () => {
  it("renders the classification chips, the scope dials, and a Define button", () => {
    const html = renderPanel(initialState); // project === null
    // classification chip groups
    expect(html).toContain('data-chip-group="category"');
    expect(html).toContain('data-chip-group="industry"');
    expect(html).toContain('data-chip-group="age_demographic"');
    expect(html).toContain('data-chip-group="style"');
    // the verbatim category enum is offered
    for (const v of ["marketing", "ecommerce", "web_app", "news"]) {
      expect(html).toContain(`data-chip-value="${v}"`);
    }
    // the four scope dials
    for (const d of ["visual", "editorial", "coverage", "flow"]) {
      expect(html).toContain(`data-chip-group="${d}"`);
    }
    expect(html).toContain('data-dial-level="low"');
    // Define project action
    expect(html).toContain('data-action="define"');
    // no job tabs in intake
    expect(html).not.toContain('data-chip-group="job-tab"');
  });

  it("stays in intake once classification chips are picked but no manifest yet", () => {
    // setClassification creates project (non-null) but no manifest → still intake.
    const picked = reduce(initialState, {
      type: "setClassification",
      field: "category",
      value: "ecommerce",
    } as PanelAction);
    const html = renderPanel(picked);
    expect(html).toContain('data-action="define"');
    expect(html).not.toContain('data-chip-group="job-tab"');
    // the picked chip is reflected as selected
    expect(html).toMatch(/data-chip-value="ecommerce"[^>]*aria-pressed="true"/);
  });
});

// ---------------------------------------------------------------------------
// renderPanel — the job view (project defined)
// ---------------------------------------------------------------------------

describe("renderPanel — job view when the project is defined", () => {
  it("renders the 3 job tabs with the active one marked", () => {
    const html = renderPanel(definedState({ activeJob: "acceptance-criteria" }));
    expect(html).toContain('data-chip-group="job-tab"');
    for (const v of ["user-story", "acceptance-criteria", "user-journey"]) {
      expect(html).toContain(`data-chip-value="${v}"`);
    }
    // active tab marked
    expect(html).toMatch(/data-chip-value="acceptance-criteria"[^>]*aria-pressed="true"/);
    // the other tabs are not marked active
    expect(html).toMatch(/data-chip-value="user-story"[^>]*aria-pressed="false"/);
  });

  it("renders the gate strip, scope dials, stream line, artifact list, and actions", () => {
    const html = renderPanel(
      definedState({
        activeJob: "acceptance-criteria",
        jobs: {
          "user-story": { artifacts: [{ ref: "S-1" }, { ref: "S-2" }], gates: [] },
          "acceptance-criteria": {
            artifacts: [{ ref: "AC-1", title: "checkout success", seedRef: "S-1" }],
            gates: [{ gate: "requirement-coverage", status: "pass" }],
            streamLine: "drafting AC-2…",
          },
          "user-journey": { artifacts: [], gates: [] },
        },
      }),
    );
    // gate strip with the passing gate
    expect(html).toContain("requirement-coverage");
    expect(html).toContain("✓");
    // scope dials present in the inputs row
    expect(html).toContain('data-chip-group="visual"');
    // stream line
    expect(html).toContain("drafting AC-2");
    // artifact list with the AC and its cross-link to the seeding Story
    expect(html).toContain("AC-1");
    expect(html).toContain("S-1");
    // action buttons
    expect(html).toContain('data-action="generate"');
    expect(html).toContain('data-action="provide"');
    expect(html).toContain('data-action="run-gates"');
    // gate report expander
    expect(html).toContain("report");
  });

  // SEED INDICATOR = a pure selector off the user-story artifact count, NOT the
  // stale stored seedStatus field.
  it("computes the seed indicator from the user-story artifact count (2 → 'Stories: 2 ✓'), ignoring a stale stored seedStatus", () => {
    const html = renderPanel(
      definedState({
        activeJob: "acceptance-criteria",
        jobs: {
          "user-story": { artifacts: [{ ref: "S-1" }, { ref: "S-2" }], gates: [] },
          // deliberately WRONG stored value — proves the view does not read it
          "acceptance-criteria": { artifacts: [], gates: [], seedStatus: "STALE-WRONG" },
          "user-journey": { artifacts: [], gates: [] },
        },
      }),
    );
    expect(html).toContain("Stories: 2 ✓");
    expect(html).not.toContain("STALE-WRONG");
  });

  it("computes 'needs Stories' when there are zero user-story artifacts (ignoring a stale stored count)", () => {
    const html = renderPanel(
      definedState({
        activeJob: "user-journey",
        jobs: {
          "user-story": { artifacts: [], gates: [] },
          "acceptance-criteria": { artifacts: [], gates: [] },
          // stale stored value claims stories exist — must be ignored
          "user-journey": { artifacts: [], gates: [], seedStatus: "Stories: 99 ✓" },
        },
      }),
    );
    expect(html).toContain("needs Stories");
    expect(html).not.toContain("99");
  });

  it("disables the body when the bridge is disconnected", () => {
    const html = renderPanel(definedState({ connection: "disconnected" }));
    // the Generate action is disabled while disconnected
    expect(html).toMatch(/data-action="generate"[^>]*disabled/);
  });
});

// ---------------------------------------------------------------------------
// renderPanel — Generate screens indicator + button (the gate section)
// ---------------------------------------------------------------------------

describe("renderPanel — screens indicator + Generate screens button (gate section)", () => {
  it("shows 'no screens — generate to gate' and the Generate screens button when no screens are scaffolded", () => {
    const html = renderPanel(definedState({ activeJob: "acceptance-criteria" }));
    expect(html).toContain("no screens");
    expect(html).toContain('data-action="generate-screens"');
    expect(html).toContain("Generate screens");
  });

  it("shows 'screens: 2 ✓' when project.screens.written has length 2", () => {
    const html = renderPanel(
      definedState({
        project: {
          classification: { category: "ecommerce" },
          manifest: { manifest: [] },
          screens: { written: ["a.uxfactory.json", "b.uxfactory.json"] },
        },
      }),
    );
    expect(html).toContain("screens: 2 ✓");
    expect(html).not.toContain("no screens");
  });

  it("places the Generate screens button before Run gates", () => {
    const html = renderPanel(definedState());
    expect(html.indexOf('data-action="generate-screens"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('data-action="generate-screens"')).toBeLessThan(
      html.indexOf('data-action="run-gates"'),
    );
  });
});

// ---------------------------------------------------------------------------
// wirePanel
// ---------------------------------------------------------------------------

describe("wirePanel — job tab click", () => {
  it("dispatches setActiveJob for the clicked tab", () => {
    const root = document.createElement("div");
    const store = makeStore(definedState({ activeJob: "acceptance-criteria" }));
    const { client } = makeClient();
    wirePanel(root, { client, getState: store.getState, dispatch: store.dispatch });

    const tab = root.querySelector<HTMLElement>(
      '[data-chip-group="job-tab"][data-chip-value="user-journey"]',
    );
    expect(tab).not.toBeNull();
    tab!.click();

    expect(store.dispatch).toHaveBeenCalledWith({ type: "setActiveJob", job: "user-journey" });
    expect(store.getState().activeJob).toBe("user-journey");
  });
});

describe("wirePanel — intake chip click", () => {
  it("dispatches setClassification for a clicked classification chip", () => {
    const root = document.createElement("div");
    const store = makeStore(connectedIntake()); // intake
    const { client } = makeClient();
    wirePanel(root, { client, getState: store.getState, dispatch: store.dispatch });

    const chip = root.querySelector<HTMLElement>(
      '[data-chip-group="category"][data-chip-value="web_app"]',
    );
    expect(chip).not.toBeNull();
    chip!.click();

    expect(store.dispatch).toHaveBeenCalledWith({
      type: "setClassification",
      field: "category",
      value: "web_app",
    });
    expect(store.getState().project?.classification.category).toBe("web_app");
  });

  it("dispatches setClassification('scope', …) merging a clicked scope dial", () => {
    const root = document.createElement("div");
    const store = makeStore(connectedIntake());
    const { client } = makeClient();
    wirePanel(root, { client, getState: store.getState, dispatch: store.dispatch });

    const high = root.querySelector<HTMLElement>(
      '[data-chip-group="flow"][data-chip-value="high"]',
    );
    expect(high).not.toBeNull();
    high!.click();

    const scope = store.getState().project?.classification.scope;
    expect(scope?.flow).toBe("high");
  });
});

describe("wirePanel — Define project", () => {
  it("enqueues classify with the classification and dispatches setManifest from the result", async () => {
    const root = document.createElement("div");
    const start = reduce(connectedIntake(), {
      type: "setClassification",
      field: "category",
      value: "ecommerce",
    } as PanelAction);
    const store = makeStore(start);
    const manifest = { manifest: [{ artifact_kind: "AcceptanceCriterion", requirement: "requested", gate_effect: "hard" }] };
    const { client, enqueued } = makeClient({
      pollResult: vi.fn(async (): Promise<PollResult> => ({
        status: "done",
        result: { status: 0, result: manifest },
      })),
    });
    wirePanel(root, { client, getState: store.getState, dispatch: store.dispatch });

    root.querySelector<HTMLElement>('[data-action="define"]')!.click();

    await vi.waitFor(() => expect(store.getState().project?.manifest).toBeDefined());
    expect(enqueued[0]!.kind).toBe("classify");
    // version + flow_refs are required by the engine schema but not collected by
    // the chips — the view must add them, else live intake is rejected (status 2).
    expect(enqueued[0]!.payload).toMatchObject({
      classification: { version: 1, category: "ecommerce", flow_refs: [] },
    });
    expect(store.getState().project?.manifest).toEqual(manifest);
  });
});

describe("wirePanel — Generate", () => {
  it("enqueues generate-artifact for the active job and records jobEnqueued", async () => {
    const root = document.createElement("div");
    const store = makeStore(
      definedState({
        activeJob: "acceptance-criteria",
        jobs: {
          "user-story": { artifacts: [{ ref: "S-1" }, { ref: "S-2" }], gates: [] },
          "acceptance-criteria": { artifacts: [], gates: [] },
          "user-journey": { artifacts: [], gates: [] },
        },
      }),
    );
    const { client, enqueued } = makeClient();
    wirePanel(root, { client, getState: store.getState, dispatch: store.dispatch });

    root.querySelector<HTMLElement>('[data-action="generate"]')!.click();

    await vi.waitFor(() => expect(client.enqueue).toHaveBeenCalled());
    expect(enqueued[0]!.kind).toBe("generate-artifact");
    expect(enqueued[0]!.payload).toMatchObject({
      target: "acceptance-criteria",
      seedRefs: ["S-1", "S-2"], // upstream user-story ids for the downstream job
      classification: { category: "ecommerce" },
      scope: { flow: "medium" },
    });
    await vi.waitFor(() =>
      expect(store.getState().jobs["acceptance-criteria"].pendingId).toBe("req-1"),
    );
    expect(store.dispatch).toHaveBeenCalledWith({
      type: "jobEnqueued",
      job: "acceptance-criteria",
      id: "req-1",
    });
  });
});

describe("wirePanel — SSE routing by requestId → pendingId", () => {
  it("routes an event to the job whose pendingId matches, and not to siblings", async () => {
    const root = document.createElement("div");
    const store = makeStore(definedState({ activeJob: "user-story" }));
    // keep results pending so jobEvent is isolated from jobResult
    const { client, emit } = makeClient({
      pollResult: vi.fn(async (): Promise<PollResult> => ({ status: "pending" })),
    });
    wirePanel(root, { client, getState: store.getState, dispatch: store.dispatch });

    // Generate on user-story → pendingId = req-1
    root.querySelector<HTMLElement>('[data-action="generate"]')!.click();
    await vi.waitFor(() => expect(store.getState().jobs["user-story"].pendingId).toBe("req-1"));

    // an event for a NON-matching requestId is ignored
    emit({ requestId: "nope", event: { text: "ignored" }, seq: 1 });
    expect(store.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "jobEvent" }),
    );

    // the matching event routes to user-story only
    emit({ requestId: "req-1", event: { text: "drafting S-1…" }, seq: 2 });
    expect(store.dispatch).toHaveBeenCalledWith({
      type: "jobEvent",
      job: "user-story",
      event: { text: "drafting S-1…" },
    });
    expect(store.getState().jobs["user-story"].streamLine).toBe("drafting S-1…");
    expect(store.getState().jobs["acceptance-criteria"].streamLine).toBeUndefined();
    expect(store.getState().jobs["user-journey"].streamLine).toBeUndefined();
  });

  it("appends the artifact via poll-until-done — no SSE frame needed (3a)", async () => {
    // The completion/append is owned by Generate's own awaitResult poll loop,
    // NOT by an SSE-frame nudge. Proven here by emitting NO frame at all: the
    // artifact still lands once pollResult reports done. This is the 3a fix —
    // the real worker stores the result after the terminal frame, so a
    // frame-triggered single poll would race ahead of the store and strand it.
    const root = document.createElement("div");
    const store = makeStore(definedState({ activeJob: "user-story" }));
    const artifact = { ref: "S-1", content: "story body" };
    const { client } = makeClient({
      pollResult: vi.fn(async (): Promise<PollResult> => ({
        status: "done",
        result: { status: 0, result: artifact },
      })),
    });
    wirePanel(root, { client, getState: store.getState, dispatch: store.dispatch });

    root.querySelector<HTMLElement>('[data-action="generate"]')!.click();

    await vi.waitFor(() =>
      expect(store.getState().jobs["user-story"].artifacts).toHaveLength(1),
    );
    expect(store.getState().jobs["user-story"].artifacts[0]).toMatchObject(artifact);
    // pendingId cleared by jobResult
    expect(store.getState().jobs["user-story"].pendingId).toBeUndefined();
  });
});

describe("wirePanel — Run gates", () => {
  it("enqueues gate and dispatches gateResult from the result", async () => {
    const root = document.createElement("div");
    const store = makeStore(definedState({ activeJob: "acceptance-criteria" }));
    const gateResultBody = {
      status: 1,
      result: { gates: [{ gate: "requirement-coverage", status: "fail" }] },
    };
    const { client, enqueued } = makeClient({
      pollResult: vi.fn(async (): Promise<PollResult> => ({
        status: "done",
        result: gateResultBody,
      })),
    });
    wirePanel(root, { client, getState: store.getState, dispatch: store.dispatch });

    root.querySelector<HTMLElement>('[data-action="run-gates"]')!.click();

    await vi.waitFor(() =>
      expect(store.getState().jobs["acceptance-criteria"].gates.length).toBeGreaterThan(0),
    );
    expect(enqueued[0]!.kind).toBe("gate");
    expect(enqueued[0]!.payload).toMatchObject({ dir: "design" });
    const gates = store.getState().jobs["acceptance-criteria"].gates;
    expect(gates).toEqual([{ gate: "requirement-coverage", status: "fail" }]);
    // the strip renders the hard-fail marker
    expect(renderPanel(store.getState())).toContain("✗");
  });
});

describe("wirePanel — Generate screens", () => {
  it("enqueues generate-specs {dir:'design'} and dispatches screensScaffolded from the result", async () => {
    const root = document.createElement("div");
    const store = makeStore(definedState({ activeJob: "acceptance-criteria" }));
    const { client, enqueued } = makeClient({
      pollResult: vi.fn(async (): Promise<PollResult> => ({
        status: "done",
        result: { status: 0, result: { written: ["x.uxfactory.json"], skipped: [] } },
      })),
    });
    wirePanel(root, { client, getState: store.getState, dispatch: store.dispatch });

    root.querySelector<HTMLElement>('[data-action="generate-screens"]')!.click();

    await vi.waitFor(() =>
      expect(store.getState().project?.screens?.written).toEqual(["x.uxfactory.json"]),
    );
    // it enqueues the deterministic generate-specs kind against the gate dir
    expect(enqueued[0]!.kind).toBe("generate-specs");
    expect(enqueued[0]!.payload).toMatchObject({ dir: "design" });
    // and NEVER the gate / generate-artifact kinds (screens is its own step)
    expect(enqueued.some((e) => e.kind === "gate")).toBe(false);
    expect(enqueued.some((e) => e.kind === "generate-artifact")).toBe(false);
    // the indicator updates after the dispatch
    expect(renderPanel(store.getState())).toContain("screens: 1 ✓");
  });
});

describe("wirePanel — teardown (SSE lifecycle)", () => {
  it("returns the client.subscribe unsubscribe so the caller can close the stream", () => {
    const root = document.createElement("div");
    const store = makeStore(definedState());
    const { client, unsubscribe } = makeClient();
    const teardown = wirePanel(root, {
      client,
      getState: store.getState,
      dispatch: store.dispatch,
    });
    expect(client.subscribe).toHaveBeenCalledTimes(1);
    expect(typeof teardown).toBe("function");
    expect(unsubscribe).not.toHaveBeenCalled();
    teardown();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Boundary (load-bearing): the module imports only sibling panel code + DOM.
// ---------------------------------------------------------------------------

describe("boundary — pipeline-view stays a pure relay + UI", () => {
  it("contains no forbidden runtime/orchestration tokens", () => {
    // cwd is the plugin dir under `pnpm --filter`, but the repo root under the
    // root vitest config — try both so the read is environment-agnostic (jsdom's
    // import.meta.url is not a file URL, so we can't anchor on it here).
    const candidates = [
      resolve(process.cwd(), "src/pipeline-view.ts"),
      resolve(process.cwd(), "packages/uxfactory-plugin/src/pipeline-view.ts"),
    ];
    const file = candidates.find((p) => existsSync(p));
    expect(file, "pipeline-view.ts source must be locatable").toBeDefined();
    const src = readFileSync(file!, "utf8");
    for (const forbidden of ["@helmsmith", "agentcore", "runpod", "cloud", "@uxfactory/cli", "LLM"]) {
      expect(src).not.toContain(forbidden);
    }
    // imports only the three sibling panel modules
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec).toMatch(/^\.\/(chips|panel-state|pipeline-client)\.js$/);
    }
  });
});

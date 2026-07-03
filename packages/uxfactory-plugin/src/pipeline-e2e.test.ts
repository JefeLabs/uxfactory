// @vitest-environment jsdom
//
// pipeline-e2e.test.ts — the Task 6 proof. Stands up an in-process bridge
// (`startBridge`) plus a FAKE worker loop (drains GET /pipeline/request/next and
// posts canned POST /pipeline/result + POST /pipeline/event per kind), mounts the
// REAL panel (real `createPipelineClient` against the in-process bridge URL) into
// a jsdom root, and drives the full project → job → gates flow, asserting the
// store transitions AND the rendered DOM at each step. NO real LLM/worker — every
// result/event the panel sees is canned data the fake worker posts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import { renderPanel, wirePanel } from "./pipeline-view.js";
import { createPipelineClient } from "./pipeline-client.js";
import {
  reduce,
  initialState,
  setConnection,
  type PanelState,
  type PanelAction,
} from "./panel-state.js";

// `@uxfactory/bridge` is typed via the ambient declaration in
// `src/bridge-ambient.d.ts` (its node-only source can't be compiled under the
// plugin's DOM tsconfig) and resolved at RUNTIME via Vitest's alias.

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// The fake worker: canned data per request kind/target.
// ---------------------------------------------------------------------------

/** Canned, deterministic results — the richer "batch" shape (refs + cross-links). */
const CANNED = {
  classify: {
    manifest: [
      { artifact_kind: "AcceptanceCriterion", requirement: "requested", gate_effect: "hard" },
    ],
    dir: "design",
  },
  "user-story": [
    { ref: "S-1", title: "Browse the catalog" },
    { ref: "S-2", title: "Complete checkout" },
  ],
  "acceptance-criteria": [{ ref: "AC-1", title: "valid card succeeds", seedRef: "S-1" }],
  "user-journey": [{ ref: "UJ-1", title: "guest checkout flow", seedRef: "S-2" }],
  gate: {
    gates: [
      { gate: "requirement-coverage", status: "pass" },
      { gate: "reuse", status: "soft" },
    ],
  },
} as const;

interface SeenRequest {
  kind: string;
  payload: { target?: string; seedRefs?: string[]; classification?: unknown } | undefined;
}

/** Start a background loop that fulfils pipeline requests with canned data. */
function startFakeWorker(baseUrl: string): { seen: SeenRequest[]; stop: () => void } {
  let stopped = false;
  const seen: SeenRequest[] = [];

  const post = (p: string, body: unknown): Promise<Response> =>
    fetch(`${baseUrl}${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  async function handle(req: {
    id: string;
    kind: string;
    payload?: SeenRequest["payload"];
  }): Promise<void> {
    const { id, kind, payload } = req;
    seen.push({ kind, payload });
    if (kind === "classify") {
      await post("/pipeline/result", { id, status: 0, result: CANNED.classify });
      return;
    }
    if (kind === "generate-artifact") {
      const target = (payload?.target ?? "user-story") as keyof typeof CANNED;
      const artifacts = CANNED[target] ?? [];
      // Real-worker ordering: stream the event(s) DURING the run, then store the
      // result AFTER. The panel's poll-until-done must still append the artifact
      // even though the frame precedes the stored result (the 3a race).
      await post("/pipeline/event", { requestId: id, event: { text: `drafting ${target}…` } });
      await post("/pipeline/result", { id, status: 0, result: artifacts });
      return;
    }
    if (kind === "gate") {
      await post("/pipeline/result", { id, status: 0, result: CANNED.gate });
      return;
    }
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/pipeline/request/next`);
      } catch {
        break; // bridge closed
      }
      if (res.status === 204) {
        await delay(10);
        continue;
      }
      const req = (await res.json()) as {
        id: string;
        kind: string;
        payload?: SeenRequest["payload"];
      };
      await handle(req);
    }
  }

  void loop();
  return { seen, stop: () => (stopped = true) };
}

// ---------------------------------------------------------------------------
// A tiny real store (the real reducer) so getState reflects every dispatch.
// ---------------------------------------------------------------------------

function makeStore(start: PanelState) {
  let state = start;
  return {
    getState: () => state,
    dispatch: (a: PanelAction) => {
      state = reduce(state, a);
    },
  };
}

const WAIT = { timeout: 8000, interval: 30 } as const;

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + WAIT.timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(WAIT.interval);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const click = (root: HTMLElement, selector: string): void => {
  const elx = root.querySelector<HTMLElement>(selector);
  if (elx === null) throw new Error(`no element for ${selector}`);
  elx.click();
};

// ---------------------------------------------------------------------------
// The e2e
// ---------------------------------------------------------------------------

describe("pipeline panel e2e (in-process bridge + fake worker)", () => {
  let bridge: { url: string; close: () => Promise<void> };
  let dataRoot: string;
  let worker: { seen: SeenRequest[]; stop: () => void };
  let teardown: (() => void) | undefined;

  beforeEach(async () => {
    dataRoot = await mkdtemp(path.join(os.tmpdir(), "uxf-plugin-e2e-"));
    await mkdir(path.join(dataRoot, ".git"), { recursive: true });
    bridge = await startBridge({ dataDir: path.join(dataRoot, ".uxfactory"), port: 0 });
    worker = startFakeWorker(bridge.url);
  });

  afterEach(async () => {
    teardown?.();
    worker.stop();
    await bridge.close();
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("drives intake → classify → manifest → Stories → Generate → ACs (seeded) → Generate → Run gates", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const store = makeStore(reduce(initialState, setConnection("connected")));
    const client = createPipelineClient(bridge.url, { fetch: globalThis.fetch });
    teardown = wirePanel(root, { client, getState: store.getState, dispatch: store.dispatch });

    // --- intake: the classification chips + Define are rendered -------------
    expect(root.innerHTML).toContain('data-action="define"');
    expect(root.innerHTML).toContain('data-chip-group="category"');
    expect(root.innerHTML).not.toContain('data-chip-group="job-tab"');

    // pick a category, then Define the project
    click(root, '[data-chip-group="category"][data-chip-value="ecommerce"]');
    expect(store.getState().project?.classification.category).toBe("ecommerce");

    click(root, '[data-action="define"]');
    await waitFor(() => store.getState().project?.manifest !== undefined, "manifest set");

    // classify was enqueued with the chip classification
    expect(worker.seen.some((r) => r.kind === "classify")).toBe(true);
    expect(worker.seen.find((r) => r.kind === "classify")?.payload).toMatchObject({
      classification: { category: "ecommerce" },
    });
    // the view switched from intake → job view
    expect(root.innerHTML).toContain('data-chip-group="job-tab"');

    // --- switch to Stories, then Generate ----------------------------------
    click(root, '[data-chip-group="job-tab"][data-chip-value="user-story"]');
    expect(store.getState().activeJob).toBe("user-story");

    click(root, '[data-action="generate"]');
    await waitFor(() => store.getState().jobs["user-story"].artifacts.length === 2, "2 stories");

    // events streamed in (live line) + artifacts rendered with their refs
    expect(store.getState().jobs["user-story"].streamLine).toContain("drafting");
    expect(root.innerHTML).toContain("S-1");
    expect(root.innerHTML).toContain("S-2");
    const genStory = worker.seen.find((r) => r.kind === "generate-artifact");
    expect(genStory?.payload).toMatchObject({ target: "user-story" });

    // --- switch to ACs: the seed indicator reflects the 2 stories ----------
    click(root, '[data-chip-group="job-tab"][data-chip-value="acceptance-criteria"]');
    expect(store.getState().activeJob).toBe("acceptance-criteria");
    expect(root.innerHTML).toContain("Stories: 2 ✓");

    // --- Generate ACs: seeded by the upstream story refs -------------------
    click(root, '[data-action="generate"]');
    await waitFor(
      () => store.getState().jobs["acceptance-criteria"].artifacts.length === 1,
      "1 acceptance-criteria",
    );
    // the AC carries its cross-link back to the seeding story
    expect(root.innerHTML).toContain("AC-1");
    expect(root.innerHTML).toContain("S-1");
    const genAc = worker.seen.find(
      (r) => r.kind === "generate-artifact" && r.payload?.target === "acceptance-criteria",
    );
    expect(genAc?.payload?.seedRefs).toEqual(["S-1", "S-2"]);

    // --- Run gates: the gate strip updates ---------------------------------
    click(root, '[data-action="run-gates"]');
    await waitFor(
      () => store.getState().jobs["acceptance-criteria"].gates.length > 0,
      "gate strip populated",
    );
    expect(worker.seen.some((r) => r.kind === "gate")).toBe(true);
    const gates = store.getState().jobs["acceptance-criteria"].gates;
    expect(gates.map((g) => g.gate)).toContain("requirement-coverage");
    // the strip renders the pass + soft glyphs
    const finalHtml = renderPanel(store.getState());
    expect(finalHtml).toContain("requirement-coverage");
    expect(finalHtml).toContain("✓"); // pass glyph
    expect(finalHtml).toContain("⚠"); // soft glyph

    document.body.removeChild(root);
  }, 20000);
});

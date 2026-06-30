import { describe, it, expect } from "vitest";
import {
  reduce,
  initialState,
  setConnection,
  setClassification,
  setManifest,
  setActiveJob,
  jobEnqueued,
  jobEvent,
  jobResult,
  gateResult,
  screensScaffolded,
  designStarted,
  designProgress,
  designUsage,
  designLog,
  designDone,
  type PanelState,
  type Manifest,
  type GateResult,
} from "./panel-state.js";

/** A deep snapshot used to prove `reduce` never mutates its input. */
function snapshot<T>(v: T): T {
  return structuredClone(v);
}

/** A small Manifest fixture (loose by design). */
const MANIFEST: Manifest = {
  manifest: [
    { artifact_kind: "AcceptanceCriterion", requirement: "requested", gate_effect: "hard" },
    { artifact_kind: "UserFlow", requirement: "generatable", gate_effect: "soft" },
  ],
};

describe("initialState", () => {
  it("is disconnected, project-less, with three empty jobs and user-story active", () => {
    expect(initialState.connection).toBe("disconnected");
    expect(initialState.project).toBeNull();
    expect(initialState.activeJob).toBe("user-story");
    for (const id of ["user-story", "acceptance-criteria", "user-journey"] as const) {
      expect(initialState.jobs[id]).toEqual({ artifacts: [], gates: [] });
    }
  });
});

describe("reduce — purity / immutability", () => {
  it("returns a NEW object and never mutates the input (setActiveJob)", () => {
    const before = snapshot(initialState);
    const next = reduce(initialState, setActiveJob("acceptance-criteria"));
    expect(next).not.toBe(initialState);
    expect(initialState).toEqual(before); // input untouched
    expect(next.activeJob).toBe("acceptance-criteria");
  });

  it("never mutates the input job arrays when appending artifacts", () => {
    const start = reduce(initialState, setActiveJob("user-story"));
    const before = snapshot(start);
    const next = reduce(start, jobResult("user-story", { status: 0, result: { content: "x" } }));
    expect(start).toEqual(before); // input deep-unchanged
    expect(next.jobs["user-story"].artifacts.length).toBe(1);
    expect(start.jobs["user-story"].artifacts.length).toBe(0);
  });

  it("ignores an unrecognized runtime action (returns the same state)", () => {
    const unknownAction = { type: "totally-unknown" } as unknown as Parameters<typeof reduce>[1];
    expect(reduce(initialState, unknownAction)).toBe(initialState);
  });
});

describe("reduce — setConnection", () => {
  it("sets the connection flag", () => {
    expect(reduce(initialState, setConnection("connected")).connection).toBe("connected");
    const c = reduce(initialState, setConnection("connected"));
    expect(reduce(c, setConnection("disconnected")).connection).toBe("disconnected");
  });
});

describe("reduce — setClassification", () => {
  it("creates the project from null and records a field", () => {
    const next = reduce(initialState, setClassification("category", "ecommerce"));
    expect(next.project).not.toBeNull();
    expect(next.project?.classification).toEqual({ category: "ecommerce" });
  });

  it("merges fields and preserves an existing manifest", () => {
    let s = reduce(initialState, setClassification("category", "ecommerce"));
    s = reduce(s, setManifest(MANIFEST));
    s = reduce(s, setClassification("industry", "finance"));
    expect(s.project?.classification).toEqual({ category: "ecommerce", industry: "finance" });
    expect(s.project?.manifest).toBe(MANIFEST); // manifest preserved across setClassification
  });
});

describe("reduce — setActiveJob", () => {
  it("switches the active job", () => {
    expect(reduce(initialState, setActiveJob("user-journey")).activeJob).toBe("user-journey");
  });
});

describe("reduce — jobEnqueued", () => {
  it("records pendingId on the target job only", () => {
    const next = reduce(initialState, jobEnqueued("acceptance-criteria", "req-42"));
    expect(next.jobs["acceptance-criteria"].pendingId).toBe("req-42");
    expect(next.jobs["user-story"].pendingId).toBeUndefined();
    expect(next.jobs["user-journey"].pendingId).toBeUndefined();
  });
});

describe("reduce — jobEvent (job-scoped routing)", () => {
  it("updates streamLine for the right job and leaves siblings byte-for-byte identical", () => {
    const next = reduce(
      initialState,
      jobEvent("user-story", { type: "text-delta", text: "drafting S-1…" }),
    );
    expect(next.jobs["user-story"].streamLine).toBe("drafting S-1…");
    // siblings: same reference (never touched) AND no streamLine
    expect(next.jobs["acceptance-criteria"]).toBe(initialState.jobs["acceptance-criteria"]);
    expect(next.jobs["user-journey"]).toBe(initialState.jobs["user-journey"]);
    expect(next.jobs["acceptance-criteria"].streamLine).toBeUndefined();
  });

  it("an event for job A never mutates job B", () => {
    const seeded = reduce(initialState, jobEvent("acceptance-criteria", { text: "AC line" }));
    const before = snapshot(seeded);
    const next = reduce(seeded, jobEvent("user-journey", { text: "journey line" }));
    expect(seeded).toEqual(before); // input untouched
    expect(next.jobs["acceptance-criteria"].streamLine).toBe("AC line"); // job A preserved
    expect(next.jobs["user-journey"].streamLine).toBe("journey line");
    expect(next.jobs["acceptance-criteria"]).toBe(seeded.jobs["acceptance-criteria"]); // ref kept
  });

  it("derives a stream line from event.text, event.message, event.type, or JSON", () => {
    expect(reduce(initialState, jobEvent("user-story", { text: "t" })).jobs["user-story"].streamLine).toBe("t");
    expect(reduce(initialState, jobEvent("user-story", { message: "m" })).jobs["user-story"].streamLine).toBe("m");
    expect(reduce(initialState, jobEvent("user-story", { type: "done" })).jobs["user-story"].streamLine).toBe("done");
    expect(reduce(initialState, jobEvent("user-story", "raw")).jobs["user-story"].streamLine).toBe("raw");
  });
});

describe("reduce — jobResult", () => {
  it("appends artifacts and clears pendingId for the target job only", () => {
    let s = reduce(initialState, jobEnqueued("user-story", "req-1"));
    s = reduce(s, jobResult("user-story", { status: 0, result: { content: "S-1 body", artifactPath: "design/x.json" } }));
    expect(s.jobs["user-story"].artifacts).toHaveLength(1);
    expect(s.jobs["user-story"].artifacts[0]).toMatchObject({ content: "S-1 body", artifactPath: "design/x.json" });
    expect(s.jobs["user-story"].pendingId).toBeUndefined();
    // a second result appends (does not replace)
    s = reduce(s, jobResult("user-story", { status: 0, result: { content: "S-2 body" } }));
    expect(s.jobs["user-story"].artifacts).toHaveLength(2);
  });

  it("supports a result carrying an artifacts[] array", () => {
    const next = reduce(
      initialState,
      jobResult("acceptance-criteria", {
        status: 0,
        result: { artifacts: [{ ref: "AC-1" }, { ref: "AC-2" }] },
      }),
    );
    expect(next.jobs["acceptance-criteria"].artifacts).toEqual([{ ref: "AC-1" }, { ref: "AC-2" }]);
    // sibling untouched
    expect(next.jobs["user-story"]).toBe(initialState.jobs["user-story"]);
  });

  it("appends nothing for a null/empty result but still clears pendingId", () => {
    let s = reduce(initialState, jobEnqueued("user-journey", "req-9"));
    s = reduce(s, jobResult("user-journey", { status: 2, result: null }));
    expect(s.jobs["user-journey"].artifacts).toHaveLength(0);
    expect(s.jobs["user-journey"].pendingId).toBeUndefined();
  });
});

describe("reduce — gateResult", () => {
  it("sets the gates on the target job only", () => {
    const gates: GateResult[] = [
      { gate: "requirement-coverage", status: "pass" },
      { gate: "coverage-orphans", status: "fail" },
    ];
    const next = reduce(initialState, gateResult("acceptance-criteria", gates));
    expect(next.jobs["acceptance-criteria"].gates).toEqual(gates);
    expect(next.jobs["user-story"].gates).toEqual([]);
    expect(next.jobs["user-story"]).toBe(initialState.jobs["user-story"]); // sibling ref kept
  });
});

describe("reduce — screensScaffolded (PROJECT-level)", () => {
  it("sets project.screens.written from the scaffolded list", () => {
    let s = reduce(initialState, setClassification("category", "ecommerce"));
    s = reduce(s, screensScaffolded(["a.uxfactory.json", "b.uxfactory.json"]));
    expect(s.project?.screens?.written).toEqual(["a.uxfactory.json", "b.uxfactory.json"]);
    expect(s.project?.screens?.written).toHaveLength(2);
  });

  it("is pure / immutable (new object, input untouched)", () => {
    const start = reduce(initialState, setClassification("category", "ecommerce"));
    const before = snapshot(start);
    const next = reduce(start, screensScaffolded(["x.uxfactory.json"]));
    expect(next).not.toBe(start);
    expect(start).toEqual(before); // input deep-unchanged
    expect(next.project?.screens?.written).toEqual(["x.uxfactory.json"]);
  });

  it("preserves the existing classification and manifest", () => {
    let s = reduce(initialState, setClassification("category", "ecommerce"));
    s = reduce(s, setManifest(MANIFEST));
    s = reduce(s, screensScaffolded(["a.uxfactory.json", "b.uxfactory.json"]));
    expect(s.project?.classification).toEqual({ category: "ecommerce" });
    expect(s.project?.manifest).toBe(MANIFEST);
    expect(s.project?.screens?.written).toHaveLength(2);
  });

  it("is a no-op when the project is null (state returned unchanged)", () => {
    const next = reduce(initialState, screensScaffolded(["a.uxfactory.json"]));
    expect(next.project).toBeNull();
    expect(next).toBe(initialState);
  });
});

describe("reduce — generate-design (PROJECT-level design block)", () => {
  /** A project state (so the design actions are not no-ops). */
  function withProject(): PanelState {
    return reduce(initialState, setClassification("category", "ecommerce"));
  }

  it("designStarted sets pendingId and clears progress/log/usage with done:false", () => {
    let s = withProject();
    // seed some stale design content first
    s = reduce(s, designProgress({ iter: 9, phase: "revise", note: "old" }));
    s = reduce(s, designUsage({ inputTokens: 7, outputTokens: 3 }));
    s = reduce(s, designStarted("req-d1"));
    const d = s.project?.design;
    expect(d?.pendingId).toBe("req-d1");
    expect(d?.progress).toBeUndefined();
    expect(d?.usage).toBeUndefined();
    expect(d?.log).toEqual([]);
    expect(d?.done).toBe(false);
  });

  it("designProgress sets progress and appends the note to the log", () => {
    let s = withProject();
    s = reduce(s, designStarted("req-d1"));
    s = reduce(s, designProgress({ iter: 1, phase: "draft", note: "drafting screen 1" }));
    expect(s.project?.design?.progress).toEqual({ iter: 1, phase: "draft", note: "drafting screen 1" });
    expect(s.project?.design?.log).toEqual(["drafting screen 1"]);
    // a second progress with a gate/status/findings updates the header marker + appends
    s = reduce(s, designProgress({ iter: 2, phase: "gate", gate: "flow-reachability", status: "fail", findings: 3, note: "gate failed" }));
    expect(s.project?.design?.progress).toMatchObject({ iter: 2, phase: "gate", gate: "flow-reachability", status: "fail", findings: 3 });
    expect(s.project?.design?.log).toEqual(["drafting screen 1", "gate failed"]);
  });

  it("designProgress without a note leaves the log unchanged", () => {
    let s = withProject();
    s = reduce(s, designStarted("req-d1"));
    s = reduce(s, designProgress({ iter: 2, phase: "gate", status: "fail", findings: 3 }));
    expect(s.project?.design?.progress).toMatchObject({ iter: 2, phase: "gate", findings: 3 });
    expect(s.project?.design?.log).toEqual([]);
  });

  it("designUsage sets the cumulative token usage", () => {
    let s = withProject();
    s = reduce(s, designStarted("req-d1"));
    s = reduce(s, designUsage({ inputTokens: 100, outputTokens: 50 }));
    expect(s.project?.design?.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    // a later usage event replaces it (cumulative)
    s = reduce(s, designUsage({ inputTokens: 220, outputTokens: 130 }));
    expect(s.project?.design?.usage).toEqual({ inputTokens: 220, outputTokens: 130 });
  });

  it("designLog appends a raw narration line", () => {
    let s = withProject();
    s = reduce(s, designStarted("req-d1"));
    s = reduce(s, designLog("narration A"));
    s = reduce(s, designLog("narration B"));
    expect(s.project?.design?.log).toEqual(["narration A", "narration B"]);
  });

  it("caps the log at ~50 lines (keeps the most recent)", () => {
    let s = withProject();
    s = reduce(s, designStarted("req-d1"));
    for (let i = 0; i < 70; i++) s = reduce(s, designLog(`line ${i}`));
    const log = s.project?.design?.log ?? [];
    expect(log.length).toBeLessThanOrEqual(50);
    // the most recent line is retained; the oldest are dropped
    expect(log[log.length - 1]).toBe("line 69");
    expect(log).not.toContain("line 0");
  });

  it("designDone sets done:true, clears pendingId, and keeps the final usage/progress", () => {
    let s = withProject();
    s = reduce(s, designStarted("req-d1"));
    s = reduce(s, designProgress({ iter: 3, phase: "done", note: "complete" }));
    s = reduce(s, designUsage({ inputTokens: 300, outputTokens: 200 }));
    s = reduce(s, designDone({ status: 0, result: { content: "html" } }));
    const d = s.project?.design;
    expect(d?.done).toBe(true);
    expect(d?.pendingId).toBeUndefined();
    expect(d?.usage).toEqual({ inputTokens: 300, outputTokens: 200 });
    expect(d?.progress).toMatchObject({ iter: 3, phase: "done" });
  });

  it("is pure / immutable (new object, input untouched)", () => {
    const start = reduce(withProject(), designStarted("req-d1"));
    const before = snapshot(start);
    const next = reduce(start, designProgress({ iter: 1, phase: "draft", note: "x" }));
    expect(next).not.toBe(start);
    expect(start).toEqual(before); // input deep-unchanged
    expect(next.project?.design?.progress).toEqual({ iter: 1, phase: "draft", note: "x" });
  });

  it("preserves classification / manifest / screens alongside the design block", () => {
    let s = withProject();
    s = reduce(s, setManifest(MANIFEST));
    s = reduce(s, screensScaffolded(["a.uxfactory.json"]));
    s = reduce(s, designStarted("req-d1"));
    s = reduce(s, designProgress({ iter: 1, phase: "draft", note: "x" }));
    expect(s.project?.classification).toEqual({ category: "ecommerce" });
    expect(s.project?.manifest).toBe(MANIFEST);
    expect(s.project?.screens?.written).toEqual(["a.uxfactory.json"]);
    expect(s.project?.design?.pendingId).toBe("req-d1");
  });

  it("every design action is a no-op when the project is null (same state ref)", () => {
    expect(reduce(initialState, designStarted("req-d1"))).toBe(initialState);
    expect(reduce(initialState, designProgress({ iter: 1, phase: "draft" }))).toBe(initialState);
    expect(reduce(initialState, designUsage({ inputTokens: 1, outputTokens: 2 }))).toBe(initialState);
    expect(reduce(initialState, designLog("x"))).toBe(initialState);
    expect(reduce(initialState, designDone({ status: 0, result: {} }))).toBe(initialState);
    expect(initialState.project).toBeNull();
  });
});

describe("reduce — setManifest derives downstream seedStatus", () => {
  it("shows 'needs Stories' downstream when no user-story artifacts exist", () => {
    const next = reduce(initialState, setManifest(MANIFEST));
    expect(next.project?.manifest).toBe(MANIFEST);
    expect(next.jobs["acceptance-criteria"].seedStatus).toBe("needs Stories");
    expect(next.jobs["user-journey"].seedStatus).toBe("needs Stories");
    // the seeding (upstream) job carries no seedStatus
    expect(next.jobs["user-story"].seedStatus).toBeUndefined();
  });

  it("derives 'Stories: N ✓' downstream from the user-story artifact count", () => {
    // seed 4 user-story artifacts
    let s: PanelState = initialState;
    s = reduce(s, jobResult("user-story", { status: 0, result: { artifacts: [1, 2, 3, 4].map((n) => ({ ref: `S-${n}` })) } }));
    expect(s.jobs["user-story"].artifacts).toHaveLength(4);
    s = reduce(s, setManifest(MANIFEST));
    expect(s.jobs["acceptance-criteria"].seedStatus).toBe("Stories: 4 ✓");
    expect(s.jobs["user-journey"].seedStatus).toBe("Stories: 4 ✓");
    expect(s.jobs["user-story"].seedStatus).toBeUndefined();
  });

  it("creates a project (classification {}) when setManifest arrives before any classification", () => {
    const next = reduce(initialState, setManifest(MANIFEST));
    expect(next.project).toEqual({ classification: {}, manifest: MANIFEST });
  });
});

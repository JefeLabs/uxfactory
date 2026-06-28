import {
  StateGraph,
  Annotation,
  START,
  END,
  MemorySaver,
  interrupt,
  Command,
} from "@langchain/langgraph";
import type { GateResult, RenderReport } from "@uxfactory/gate";
import type {
  FidelityLevel,
  HitlDecision,
  JobInput,
  JobOutput,
  RunVerdict,
  TierResult,
} from "./types.js";
import { echoGenerate, approveJudge, type GenerateFn, type JudgeFn } from "./models.js";
import { evaluate } from "./gate-tiers.js";
import { fidelityRank, nextFidelity } from "./fidelity.js";

/** last-value-wins reducer. */
function last<T>(_current: T, update: T): T {
  return update;
}

/**
 * The harness state — the "iterate-to-threshold loop" + fidelity ramp + HITL, as a LangGraph graph
 * (Implementation PRD §13.3, Artifacts PRD §6).
 */
const HarnessState = Annotation.Root({
  job: Annotation<JobInput>(),
  fidelity: Annotation<FidelityLevel>({ reducer: last, default: () => "WIREFRAME" }),
  render: Annotation<RenderReport | null>({ reducer: last, default: () => null }),
  gate: Annotation<GateResult | null>({ reducer: last, default: () => null }),
  tiers: Annotation<TierResult[]>({ reducer: last, default: () => [] }),
  attempts: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  verdict: Annotation<RunVerdict | null>({ reducer: last, default: () => null }),
  hitl: Annotation<HitlDecision | null>({ reducer: last, default: () => null }),
  log: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});
type State = typeof HarnessState.State;

export interface HarnessDeps {
  /** Generation tier (model-backed). Defaults to {@link echoGenerate}. */
  generate?: GenerateFn;
  /** Judgment tiers (VLM/LLM-judge). Defaults to {@link approveJudge}. */
  judge?: JudgeFn;
  /** Max generate attempts before a hard failure is final. Default 3. */
  maxAttempts?: number;
}

/** Where the router can send the flow next. */
type Route = "generate" | "hitl" | "promote" | "pass" | "fail";

/**
 * Build (and compile) the harness graph. Exposed for advanced use/tests; most callers use
 * {@link createAgent}, which shares one checkpointer across submit + HITL resume.
 */
export function buildHarness(deps: HarnessDeps = {}) {
  const generate = deps.generate ?? echoGenerate;
  const judge = deps.judge ?? approveJudge;
  const maxAttempts = deps.maxAttempts ?? 3;

  async function generateNode(state: State): Promise<Partial<State>> {
    const render = await generate({
      job: state.job,
      fidelity: state.fidelity,
      previous: state.render,
      attempt: state.attempts,
    });
    // attempts:1 increments via the reducer; hitl resets for the new attempt.
    return { render, attempts: 1, hitl: null, log: [`generate: attempt ${state.attempts + 1} @ ${state.fidelity}`] };
  }

  async function evaluateNode(state: State): Promise<Partial<State>> {
    if (state.render === null) return { tiers: [], log: ["evaluate: no render"] };
    const { tiers, gate } = await evaluate(state.job, state.render, state.fidelity, judge);
    return { tiers, gate, log: [`evaluate @ ${state.fidelity}: ${tiers.map((t) => `${t.name}=${t.verdict}`).join(", ")}`] };
  }

  function hitlNode(state: State): Partial<State> {
    const escalations = state.tiers.filter((t) => t.verdict === "ESCALATE");
    // Pause for a human; the control plane routes by escalation owner and resumes with the decision.
    const decision = interrupt({ kind: "HITL", jobId: state.job.jobId, escalations }) as HitlDecision;
    return { hitl: decision, log: [`hitl: ${decision.approved ? "approved" : "rejected"}`] };
  }

  function promoteNode(state: State): Partial<State> {
    const next = nextFidelity(state.fidelity)!; // route only sends here when a higher level exists
    return { fidelity: next, tiers: [], hitl: null, log: [`promote -> ${next}`] };
  }

  function finalizePass(): Partial<State> {
    return { verdict: "PASSED", log: ["verdict: PASSED"] };
  }
  function finalizeFail(): Partial<State> {
    return { verdict: "FAILED", log: ["verdict: FAILED"] };
  }

  /** Pure router shared by `evaluate` and `hitl` (Artifacts PRD §6.4 compile/route). */
  function route(state: State): Route {
    const hardFail = state.tiers.some((t) => t.hardness === "HARD" && t.verdict === "FAIL");
    const escalations = state.tiers.filter((t) => t.verdict === "ESCALATE");
    if (hardFail) return state.attempts < maxAttempts ? "generate" : "fail";
    if (escalations.length > 0) {
      if (state.hitl === null) return "hitl"; // not yet reviewed
      if (!state.hitl.approved) return state.attempts < maxAttempts ? "generate" : "fail"; // rejected → revise
    }
    // no hard failures; any escalations have been approved → ramp up or finish.
    return fidelityRank(state.fidelity) < fidelityRank(state.job.fidelity) ? "promote" : "pass";
  }

  // Node names must not collide with state channel names (e.g. `hitl`), so the human node is "humanReview".
  const pathMap = {
    generate: "generate",
    hitl: "humanReview",
    promote: "promote",
    pass: "finalizePass",
    fail: "finalizeFail",
  } as const satisfies Record<Route, string>;

  const builder = new StateGraph(HarnessState)
    .addNode("generate", generateNode)
    .addNode("evaluate", evaluateNode)
    .addNode("humanReview", hitlNode)
    .addNode("promote", promoteNode)
    .addNode("finalizePass", finalizePass)
    .addNode("finalizeFail", finalizeFail)
    .addEdge(START, "generate")
    .addEdge("generate", "evaluate")
    .addConditionalEdges("evaluate", route, pathMap)
    .addConditionalEdges("humanReview", route, pathMap)
    .addEdge("promote", "generate")
    .addEdge("finalizePass", END)
    .addEdge("finalizeFail", END);

  return builder.compile({ checkpointer: new MemorySaver() });
}

function toOutput(v: State): JobOutput {
  return {
    jobId: v.job.jobId,
    verdict: v.verdict ?? "FAILED",
    fidelity: v.fidelity,
    attempts: v.attempts,
    tiers: v.tiers,
    gate: v.gate,
    log: v.log,
  };
}

/** Result of submitting/resuming a job: either complete, or paused awaiting a human decision. */
export type JobResult =
  | { status: "complete"; output: JobOutput }
  | { status: "pending_hitl"; threadId: string; escalations: TierResult[] };

export interface Agent {
  submit(input: JobInput): Promise<JobResult>;
  resume(threadId: string, decision: HitlDecision): Promise<JobResult>;
}

/**
 * Create an agent sharing one compiled harness (one checkpointer), so a job that pauses for HITL can be
 * resumed later by thread id. This is what the AgentCore server hosts.
 */
export function createAgent(deps: HarnessDeps = {}): Agent {
  const app = buildHarness(deps);

  async function collect(threadId: string): Promise<JobResult> {
    const config = { configurable: { thread_id: threadId } };
    const snap = await app.getState(config);
    const values = snap.values as State;
    if ((snap.next ?? []).length > 0) {
      // The graph paused at an interrupt (HITL).
      return {
        status: "pending_hitl",
        threadId,
        escalations: (values.tiers ?? []).filter((t) => t.verdict === "ESCALATE"),
      };
    }
    return { status: "complete", output: toOutput(values) };
  }

  return {
    async submit(input) {
      const config = { configurable: { thread_id: input.jobId } };
      await app.invoke({ job: input, fidelity: "WIREFRAME" }, config);
      return collect(input.jobId);
    },
    async resume(threadId, decision) {
      const config = { configurable: { thread_id: threadId } };
      await app.invoke(new Command({ resume: decision }), config);
      return collect(threadId);
    },
  };
}

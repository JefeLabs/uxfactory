import type { RenderReport } from "@uxfactory/gate";
import type { EscalationOwner, FidelityLevel, JobInput, Verdict } from "./types.js";

/**
 * Produce or refine a candidate render for the job at the given fidelity. This is the generation tier —
 * the deep, model-backed step (text → Figma spec → render). It is injected so the harness is testable
 * without a model; a production impl calls a Bedrock model (e.g. via @langchain/aws) and the renderer.
 */
export type GenerateFn = (ctx: {
  job: JobInput;
  fidelity: FidelityLevel;
  previous: RenderReport | null;
  attempt: number;
}) => Promise<RenderReport>;

/** Judge one soft/judgment tier (craft, brand, …) against the render — a VLM/LLM-judge (injected). */
export type JudgeFn = (ctx: {
  job: JobInput;
  render: RenderReport;
  tier: { tier: number; name: string; owner?: EscalationOwner };
  fidelity: FidelityLevel;
}) => Promise<{ verdict: Verdict; evidence?: string }>;

/**
 * Default generation: echo the provided report (REVIEW) or the previous render, else emit a minimal empty
 * render. The empty render fails the deterministic gate against any non-empty spec, which exercises the
 * iterate-to-threshold loop. Replace with a real Bedrock-backed generator.
 */
export const echoGenerate: GenerateFn = async ({ job, previous }) => {
  if (job.report) return job.report;
  if (previous) return previous;
  return {
    renderId: `${job.jobId}-r0`,
    editor: "figma",
    page: "Page 1",
    pageKey: "0:0",
    fileName: "uxfactory-agent",
    fileKey: "uxfactory-agent",
    counts: { frames: 0, sections: 0, objects: 0, connectors: 0 },
    nodes: [],
  };
};

/** Default judge: approve everything (no real VLM). Replace with a Bedrock VLM/LLM-judge per tier. */
export const approveJudge: JudgeFn = async () => ({ verdict: "PASS" });

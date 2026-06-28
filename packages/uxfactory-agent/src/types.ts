import type { Spec } from "@uxfactory/spec";
import type { RenderReport, GateResult } from "@uxfactory/gate";

/** Generation produces a render then gates it; review gates an existing render. */
export type JobType = "GENERATE" | "REVIEW";

/** The fidelity ramp (ordinal) — checks bind progressively as a render matures (Artifacts PRD §6.5). */
export type FidelityLevel = "WIREFRAME" | "CONTENT" | "VISUAL" | "INTERACTIVE" | "PRODUCTION";

/** Per-check hardness (Artifacts PRD §6.2). */
export type Hardness = "HARD" | "SOFT" | "ESCALATE";

/** Per-check verdict. */
export type Verdict = "PASS" | "FAIL" | "ESCALATE";

/** How a tier is verified. */
export type Verifier =
  | "DETERMINISTIC"
  | "INTEGRATION_TEST"
  | "VISUAL_DIFF"
  | "VLM_JUDGE"
  | "AXE"
  | "LLM_JUDGE";

/** Role-based HITL escalation owner (Artifacts PRD §6.2). */
export type EscalationOwner = "ENG" | "BRAND" | "TENANT_ADMIN" | "CONTENT" | "SEO";

/** Overall run verdict (mirrors the control plane's gate_run.status). */
export type RunVerdict = "PASSED" | "FAILED" | "PENDING_HITL" | "ESCALATED";

/** One tier's outcome within an evaluation pass. */
export interface TierResult {
  tier: number;
  name: string;
  hardness: Hardness;
  verifier: Verifier;
  minFidelity: FidelityLevel;
  verdict: Verdict;
  owner?: EscalationOwner;
  evidence?: string;
  compiledFrom?: string;
}

/** The job handed to the agent — the control plane's InvokeAgentRuntime payload (Infra PRD §3 flow B). */
export interface JobInput {
  jobId: string;
  tenantId: string;
  projectId?: string;
  type: JobType;
  /** Target fidelity the ramp climbs to. */
  fidelity: FidelityLevel;
  spec: Spec;
  /** The rendered artifact under test (required for REVIEW; optional seed for GENERATE). */
  report?: RenderReport;
}

/** A human's decision when a tier escalates (resolved out-of-band by the control plane's HITL ladder). */
export interface HitlDecision {
  approved: boolean;
  by?: string;
  note?: string;
}

/** The agent's result for a completed job. */
export interface JobOutput {
  jobId: string;
  verdict: RunVerdict;
  fidelity: FidelityLevel;
  attempts: number;
  tiers: TierResult[];
  gate?: GateResult | null;
  log: string[];
}

import { gate } from "@uxfactory/gate";
import type { GateResult, RenderReport } from "@uxfactory/gate";
import type { JudgeFn } from "./models.js";
import type { EscalationOwner, FidelityLevel, JobInput, TierResult } from "./types.js";
import { fidelityGte } from "./fidelity.js";

/** Judgment tiers (the soft/escalate ladder) and the fidelity at which each becomes binding. */
const JUDGMENT_TIERS: ReadonlyArray<{
  tier: number;
  name: string;
  minFidelity: FidelityLevel;
  owner: EscalationOwner;
}> = [
  { tier: 6, name: "craft", minFidelity: "VISUAL", owner: "ENG" },
  { tier: 7, name: "brand", minFidelity: "VISUAL", owner: "BRAND" },
];

/**
 * Run one evaluation pass over a render at a given fidelity:
 *  - the deterministic tier reuses the real {@link gate} (spec ↔ render: presence/geometry/counts/…),
 *    exactly the checks the local CLI runs;
 *  - each judgment tier whose min_fidelity ≤ fidelity is judged by the injected {@link JudgeFn}.
 */
export async function evaluate(
  job: JobInput,
  render: RenderReport,
  fidelity: FidelityLevel,
  judge: JudgeFn,
): Promise<{ tiers: TierResult[]; gate: GateResult }> {
  const g = gate(job.spec, render);

  const tiers: TierResult[] = [
    {
      tier: 1,
      name: "coverage/conformance",
      hardness: "HARD",
      verifier: "DETERMINISTIC",
      minFidelity: "WIREFRAME",
      verdict: g.status === "PASS" ? "PASS" : "FAIL",
      evidence: g.failures.length > 0 ? JSON.stringify(g.failures.slice(0, 5)) : undefined,
    },
  ];

  for (const t of JUDGMENT_TIERS) {
    if (!fidelityGte(fidelity, t.minFidelity)) continue;
    const r = await judge({
      job,
      render,
      tier: { tier: t.tier, name: t.name, owner: t.owner },
      fidelity,
    });
    tiers.push({
      tier: t.tier,
      name: t.name,
      hardness: "ESCALATE",
      verifier: "VLM_JUDGE",
      minFidelity: t.minFidelity,
      verdict: r.verdict,
      owner: t.owner,
      evidence: r.evidence,
    });
  }

  return { tiers, gate: g };
}

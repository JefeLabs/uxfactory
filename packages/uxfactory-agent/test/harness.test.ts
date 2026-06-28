import { describe, it, expect } from "vitest";
import { createAgent } from "../src/harness.js";
import type { JudgeFn } from "../src/models.js";
import { makeJob, matchingReport } from "./fixtures.js";

describe("harness graph", () => {
  it("REVIEW of a matching render passes the deterministic gate", async () => {
    const agent = createAgent();
    const r = await agent.submit(makeJob({ type: "REVIEW", report: matchingReport, fidelity: "WIREFRAME" }));

    expect(r.status).toBe("complete");
    if (r.status === "complete") {
      expect(r.output.verdict).toBe("PASSED");
      expect(r.output.tiers.find((t) => t.tier === 1)?.verdict).toBe("PASS");
    }
  });

  it("GENERATE with no render fails the gate and exhausts the iterate-to-threshold loop", async () => {
    const agent = createAgent({ maxAttempts: 3 });
    const r = await agent.submit(makeJob({ jobId: "j2", type: "GENERATE", fidelity: "WIREFRAME" }));

    expect(r.status).toBe("complete");
    if (r.status === "complete") {
      expect(r.output.verdict).toBe("FAILED");
      expect(r.output.attempts).toBe(3);
    }
  });

  it("escalates a judgment tier to HITL, then completes on human approval", async () => {
    // craft escalates at VISUAL fidelity; everything else passes.
    const escalateCraft: JudgeFn = async ({ tier }) =>
      tier.name === "craft" ? { verdict: "ESCALATE" } : { verdict: "PASS" };
    const agent = createAgent({ judge: escalateCraft });

    const submitted = await agent.submit(
      makeJob({ jobId: "j3", type: "REVIEW", report: matchingReport, fidelity: "VISUAL" }),
    );
    expect(submitted.status).toBe("pending_hitl");
    if (submitted.status === "pending_hitl") {
      expect(submitted.escalations.some((e) => e.name === "craft")).toBe(true);

      const resumed = await agent.resume(submitted.threadId, { approved: true });
      expect(resumed.status).toBe("complete");
      if (resumed.status === "complete") {
        expect(resumed.output.verdict).toBe("PASSED");
        expect(resumed.output.fidelity).toBe("VISUAL");
      }
    }
  });
});

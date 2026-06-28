import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";
import { createAgent } from "../src/harness.js";
import { makeJob, matchingReport } from "./fixtures.js";

describe("AgentCore Runtime HTTP contract", () => {
  it("GET /ping returns Healthy with time_of_last_update", async () => {
    const app = buildServer(createAgent());
    const res = await app.inject({ method: "GET", url: "/ping" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; time_of_last_update: number };
    expect(body.status).toBe("Healthy");
    expect(typeof body.time_of_last_update).toBe("number");
    await app.close();
  });

  it("POST /invocations runs a job to completion", async () => {
    const app = buildServer(createAgent());
    const res = await app.inject({
      method: "POST",
      url: "/invocations",
      payload: { job: makeJob({ type: "REVIEW", report: matchingReport, fidelity: "WIREFRAME" }) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; output?: { verdict: string } };
    expect(body.status).toBe("complete");
    expect(body.output?.verdict).toBe("PASSED");
    await app.close();
  });

  it("POST /invocations without a job returns 400", async () => {
    const app = buildServer(createAgent());
    const res = await app.inject({ method: "POST", url: "/invocations", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createAgent, type Agent } from "./harness.js";
import type { HitlDecision, JobInput } from "./types.js";

const PORT = Number(process.env.PORT ?? 8080);

/** Unix seconds of the last activity — surfaced in /ping so AgentCore's reaper sees liveness. */
let timeOfLastUpdate = Math.floor(Date.now() / 1000);

interface InvocationBody {
  action?: "submit" | "resume";
  job?: JobInput;
  threadId?: string;
  decision?: HitlDecision;
}

/**
 * The AgentCore Runtime HTTP contract (Bedrock AgentCore): a service exposing `GET /ping` and
 * `POST /invocations` on port 8080. The runtime is framework-agnostic — this hosts the LangGraph harness.
 */
export function buildServer(agent: Agent = createAgent()): FastifyInstance {
  const app = Fastify({ logger: false });

  // Health check. `time_of_last_update` is REQUIRED: without it AgentCore's idle reaper can terminate the
  // microVM mid-execution even while busy (AgentCore HTTP protocol contract).
  app.get("/ping", async () => ({ status: "Healthy", time_of_last_update: timeOfLastUpdate }));

  // Primary entrypoint. Accepts a job to submit, or a HITL resume (threadId + decision).
  app.post("/invocations", async (req, reply) => {
    timeOfLastUpdate = Math.floor(Date.now() / 1000);
    const body = (req.body ?? {}) as InvocationBody;

    if (body.action === "resume") {
      if (!body.threadId || !body.decision) {
        return reply.code(400).send({ error: "resume requires threadId and decision" });
      }
      return reply.send(await agent.resume(body.threadId, body.decision));
    }

    if (!body.job) return reply.code(400).send({ error: "missing job" });
    return reply.send(await agent.submit(body.job));
  });

  return app;
}

async function main(): Promise<void> {
  const app = buildServer();
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`uxfactory-agent listening on :${PORT} (AgentCore /ping, /invocations)`);
}

// Run as the container entrypoint, but not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

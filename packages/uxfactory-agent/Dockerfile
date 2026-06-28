# Container for Amazon Bedrock AgentCore Runtime.
# Build context = the uxfactory monorepo ROOT (workspace deps must be present):
#   docker build -f packages/uxfactory-agent/Dockerfile -t uxfactory-agent .
# Then push to ECR and register with `aws bedrock-agentcore-control create-agent-runtime`.

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm -r build

FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app /app
EXPOSE 8080
# AgentCore Runtime invokes POST /invocations and health-checks GET /ping on :8080.
CMD ["node", "packages/uxfactory-agent/dist/src/server.js"]
